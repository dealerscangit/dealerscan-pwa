// scripts/screens/devPanel.js
// Dev role panel — user management UI on top of the backend registry
// endpoints. Only accessible to users whose role grants the "manageUsers"
// permission (currently just "dev").
//
// Important caveat: today this is gated client-side only (the dev panel
// menu item is hidden for non-dev users). Once Sign-In + verifyToken ship,
// the backend will also enforce role on every getRegistry/updateUser/
// deleteUser call. Until then, anyone who knows the API URL can hit those
// endpoints directly. We accept this for now because the URL isn't public.

import {
  loadRegistry,
  invalidateRegistry,
  hasPermissionSync,
} from "../roles.js";
import { updateUser, deleteUser } from "../apiClient.js";
import {
  listDriveFolders, listFolderFiles, readFileContent,
  trashFile, archiveFolder, emptyDriveTrash,
  getOverview, getEventLog, getScanLog,
} from "../apiClient.js";
import { listSystemFiles, readSystemFile, writeSystemFile } from "../apiClient.js";
import { showToast } from "../swipeActions.js";

let _showScreen = null;
let _editingEmail = null; // null = adding, string = editing existing
let _devTabsWired = false;

export function attachDevPanelHandlers(showScreen, session) {
  _showScreen = showScreen;

  // Add user button
  const addBtn = document.getElementById("dev-add-user");
  if (addBtn) addBtn.addEventListener("click", () => openModal(null));

  // Refresh button
  const refreshBtn = document.getElementById("dev-refresh-registry");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      invalidateRegistry();
      await renderDevPanel();
      showToast("Registry refreshed");
    });
  }

  // Modal close + cancel
  const closeBtn = document.getElementById("dev-user-modal-close");
  const cancelBtn = document.getElementById("dev-user-modal-cancel");
  const backdrop = document.getElementById("dev-user-modal-backdrop");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  if (backdrop) backdrop.addEventListener("click", closeModal);

  // Modal save
  const saveBtn = document.getElementById("dev-user-modal-save");
  if (saveBtn) saveBtn.addEventListener("click", handleSave);

  // Modal deactivate (only shown when editing)
  const delBtn = document.getElementById("dev-user-modal-delete");
  if (delBtn) delBtn.addEventListener("click", handleDeactivate);

  // Wire the advanced tabs (Drive / Activity / Errors / Config).
  wireDevTabs();
}

// ──────────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────────
function wireDevTabs() {
  if (_devTabsWired) return;
  _devTabsWired = true;

  const tabs = document.querySelectorAll(".dev-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchDevTab(tab.dataset.devtab));
  });

  // Drive tab controls
  document.getElementById("dev-drive-refresh")?.addEventListener("click", () => renderDriveRoot(true));
  document.getElementById("dev-empty-trash")?.addEventListener("click", confirmEmptyTrash);

  // Errors tab filter
  document.getElementById("dev-error-filter")?.addEventListener("change", renderEventLog);

  // Config / system-files tab controls
  document.getElementById("dev-config-reload")?.addEventListener("click", initFilesTab);
  document.getElementById("dev-config-save")?.addEventListener("click", saveCurrentFile);
  document.getElementById("dev-file-picker")?.addEventListener("change", (ev) => loadSystemFile(ev.target.value));
  document.getElementById("dev-file-advanced-toggle")?.addEventListener("click", toggleRawMode);
}

let _devTabLoaded = {}; // lazy-load each tab's data once on first open

function switchDevTab(name) {
  document.querySelectorAll(".dev-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.devtab === name));
  document.querySelectorAll(".dev-tab-panel").forEach((p) =>
    { p.hidden = p.dataset.devtabpanel !== name; });

  // Lazy-load the tab's data the first time it's shown.
  if (_devTabLoaded[name]) return;
  _devTabLoaded[name] = true;
  if (name === "drive") renderDriveRoot();
  else if (name === "activity") renderActivity();
  else if (name === "errors") renderEventLog();
  else if (name === "config") initFilesTab();
}


export async function renderDevPanel() {
  const list = document.getElementById("dev-user-list");
  const rolesList = document.getElementById("dev-role-list");

  try {
    const reg = await loadRegistry({ force: true });

    // Render user list
    if (list) {
      const users = (reg.users || []).slice().sort((a, b) => {
        // Active before inactive, then alphabetical
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });

      if (users.length === 0) {
        list.innerHTML =
          '<p class="muted" style="text-align: center; padding: 24px 8px; font-size: 13px;">No users yet. Tap Add user to start.</p>';
      } else {
        list.innerHTML = "";
        users.forEach((u) => list.appendChild(buildUserRow(u)));
      }
    }

    // Render roles
    if (rolesList) {
      const roles = reg.roles || {};
      rolesList.innerHTML = "";
      Object.entries(roles).forEach(([key, def]) => {
        const row = document.createElement("div");
        row.className = "dev-role-row";
        const name = document.createElement("p");
        name.className = "dev-role-row-name";
        name.textContent = def.label || key;
        const perms = document.createElement("p");
        perms.className = "dev-role-row-perms";
        perms.textContent = (def.permissions || []).join(", ") || "(no permissions)";
        row.appendChild(name);
        row.appendChild(perms);
        rolesList.appendChild(row);
      });
    }
  } catch (err) {
    console.error("[devPanel] renderDevPanel failed:", err);
    if (list) {
      list.innerHTML =
        '<p class="muted" style="text-align: center; padding: 24px 8px; font-size: 13px;">Failed to load registry. Check connection.</p>';
    }
  }
}

function buildUserRow(user) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "dev-user-row";
  if (!user.active) row.classList.add("dev-user-row-inactive");

  const avatar = document.createElement("span");
  avatar.className = "dev-user-row-avatar";
  avatar.textContent = (user.name || user.email || "?").charAt(0).toUpperCase();

  const info = document.createElement("span");
  info.className = "dev-user-row-info";

  const name = document.createElement("p");
  name.className = "dev-user-row-name";
  name.textContent = user.name || "(no name)";
  if (!user.active) {
    const tag = document.createElement("span");
    tag.className = "dev-user-row-inactive-tag";
    tag.textContent = "  · inactive";
    name.appendChild(tag);
  }

  const email = document.createElement("p");
  email.className = "dev-user-row-email";
  email.textContent = user.email || "";

  info.appendChild(name);
  info.appendChild(email);

  const role = document.createElement("span");
  role.className = `dev-user-row-role dev-user-row-role-${user.role || "sales"}`;
  role.textContent = user.role || "sales";

  row.appendChild(avatar);
  row.appendChild(info);
  row.appendChild(role);

  row.addEventListener("click", () => openModal(user));
  return row;
}

// ──────────────────────────────────────────────────────────────────
// Modal: add or edit user
// ──────────────────────────────────────────────────────────────────
function openModal(user) {
  _editingEmail = user?.email || null;

  const titleEl = document.getElementById("dev-user-modal-title");
  const emailIn = document.getElementById("dev-user-email");
  const nameIn = document.getElementById("dev-user-name");
  const roleIn = document.getElementById("dev-user-role");
  const activeIn = document.getElementById("dev-user-active");
  const delBtn = document.getElementById("dev-user-modal-delete");

  if (titleEl) titleEl.textContent = user ? "Edit user" : "Add user";
  if (emailIn) {
    emailIn.value = user?.email || "";
    emailIn.disabled = !!user; // can't change email of existing user (matches by email)
  }
  if (nameIn) nameIn.value = user?.name || "";
  if (roleIn) roleIn.value = user?.role || "sales";
  if (activeIn) activeIn.checked = user ? user.active !== false : true;
  if (delBtn) delBtn.hidden = !user || !user.active;

  const modal = document.getElementById("dev-user-modal");
  if (modal) modal.hidden = false;
}

function closeModal() {
  const modal = document.getElementById("dev-user-modal");
  if (modal) modal.hidden = true;
  _editingEmail = null;
}

async function handleSave() {
  const email = document.getElementById("dev-user-email")?.value.trim();
  const name = document.getElementById("dev-user-name")?.value.trim();
  const role = document.getElementById("dev-user-role")?.value;
  const active = document.getElementById("dev-user-active")?.checked;

  if (!email) return showToast("Email required");
  if (!name) return showToast("Name required");

  const saveBtn = document.getElementById("dev-user-modal-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    await updateUser({ email, name, role, active });
    invalidateRegistry();
    closeModal();
    await renderDevPanel();
    showToast(_editingEmail ? "User updated" : "User added");
  } catch (err) {
    console.error("[devPanel] save failed:", err);
    showToast("Save failed");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }
}

async function handleDeactivate() {
  if (!_editingEmail) return;
  if (!confirm(`Deactivate ${_editingEmail}? They will no longer be able to sign in.`)) return;

  const delBtn = document.getElementById("dev-user-modal-delete");
  if (delBtn) {
    delBtn.disabled = true;
    delBtn.textContent = "Deactivating…";
  }

  try {
    await deleteUser(_editingEmail, false); // soft delete
    invalidateRegistry();
    closeModal();
    await renderDevPanel();
    showToast("User deactivated");
  } catch (err) {
    console.error("[devPanel] deactivate failed:", err);
    showToast("Deactivate failed");
  } finally {
    if (delBtn) {
      delBtn.disabled = false;
      delBtn.textContent = "Deactivate";
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Helper for settings.js: should we show the "Dev panel" entry?
// ──────────────────────────────────────────────────────────────────
export function shouldShowDevEntry() {
  return hasPermissionSync("manageUsers");
}

// ══════════════════════════════════════════════════════════════════
// TAB: Drive browser
// ══════════════════════════════════════════════════════════════════
function fmtBytes(n) {
  if (!n || n < 1024) return (n || 0) + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return ""; }
}

async function renderDriveRoot(force) {
  const list = document.getElementById("dev-drive-list");
  const crumb = document.getElementById("dev-drive-breadcrumb");
  if (crumb) crumb.textContent = "Customer folders";
  if (!list) return;
  if (force) list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Loading…</p>';
  try {
    const res = await listDriveFolders();
    const folders = (res.folders || []);
    if (folders.length === 0) {
      list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">No customer folders.</p>';
      return;
    }
    list.innerHTML = "";
    folders.forEach((f) => list.appendChild(buildFolderRow(f)));
  } catch (err) {
    console.error("[devPanel] renderDriveRoot failed:", err);
    list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Failed to load folders.</p>';
  }
}

function buildFolderRow(folder) {
  const row = document.createElement("div");
  row.className = "dev-drive-row";

  const icon = document.createElement("span");
  icon.className = "dev-drive-row-icon";
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  const info = document.createElement("button");
  info.type = "button";
  info.className = "dev-drive-row-info";
  info.style.cssText = "all:unset;flex:1;min-width:0;cursor:pointer;";
  info.innerHTML =
    `<p class="dev-drive-row-name">${escapeHtml(folder.name)}</p>` +
    `<p class="dev-drive-row-meta">${folder.fileCount} file${folder.fileCount === 1 ? "" : "s"} · ${fmtDate(folder.created)}</p>`;
  info.addEventListener("click", () => renderFolderContents(folder));

  const actions = document.createElement("span");
  actions.className = "dev-drive-row-actions";
  const archiveBtn = document.createElement("button");
  archiveBtn.className = "dev-chip dev-chip-archive";
  archiveBtn.textContent = "Archive";
  archiveBtn.addEventListener("click", (ev) => { ev.stopPropagation(); doArchiveFolder(folder); });
  actions.appendChild(archiveBtn);

  row.appendChild(icon);
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

async function renderFolderContents(folder) {
  const list = document.getElementById("dev-drive-list");
  const crumb = document.getElementById("dev-drive-breadcrumb");
  if (crumb) crumb.textContent = folder.name;
  if (!list) return;
  list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Loading files…</p>';

  // Back row
  try {
    const res = await listFolderFiles(folder.id);
    const files = (res.files || []);
    list.innerHTML = "";

    const back = document.createElement("button");
    back.className = "dev-drive-row";
    back.style.cssText = "border:none;background:transparent;";
    back.innerHTML = '<span class="dev-drive-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="dev-drive-row-info"><p class="dev-drive-row-name" style="color:var(--accent-soft)">Back to folders</p></span>';
    back.addEventListener("click", () => renderDriveRoot());
    list.appendChild(back);

    if (files.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.style.cssText = "text-align:center;padding:18px 8px;font-size:13px;";
      empty.textContent = "Folder is empty.";
      list.appendChild(empty);
      return;
    }
    files.forEach((file) => list.appendChild(buildFileRow(file)));
  } catch (err) {
    console.error("[devPanel] renderFolderContents failed:", err);
    list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Failed to load files.</p>';
  }
}

function buildFileRow(file) {
  const row = document.createElement("div");
  row.className = "dev-drive-row";

  const icon = document.createElement("span");
  icon.className = "dev-drive-row-icon";
  const isImg = (file.mimeType || "").indexOf("image/") === 0;
  icon.innerHTML = isImg
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

  const info = document.createElement("button");
  info.type = "button";
  info.className = "dev-drive-row-info";
  info.style.cssText = "all:unset;flex:1;min-width:0;cursor:pointer;";
  info.innerHTML =
    `<p class="dev-drive-row-name">${escapeHtml(file.name)}</p>` +
    `<p class="dev-drive-row-meta">${fmtBytes(file.size)} · ${fmtDate(file.created)}</p>`;
  info.addEventListener("click", () => openFilePreview(file));

  const actions = document.createElement("span");
  actions.className = "dev-drive-row-actions";
  const trashBtn = document.createElement("button");
  trashBtn.className = "dev-chip dev-chip-trash";
  trashBtn.textContent = "Trash";
  trashBtn.addEventListener("click", (ev) => { ev.stopPropagation(); doTrashFile(file, row); });
  actions.appendChild(trashBtn);

  row.appendChild(icon);
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

async function doArchiveFolder(folder) {
  if (!confirm(`Archive "${folder.name}"? It moves to the Archive folder (reversible).`)) return;
  try {
    const res = await archiveFolder(folder.id);
    if (res && res.success) {
      showToast("Folder archived");
      renderDriveRoot(true);
    } else {
      showToast("Archive failed");
    }
  } catch (err) {
    console.error("[devPanel] archive failed:", err);
    showToast("Archive failed");
  }
}

async function doTrashFile(file, rowEl) {
  if (!confirm(`Move "${file.name}" to Drive trash? Recoverable for ~30 days.`)) return;
  try {
    const res = await trashFile(file.id);
    if (res && res.success) {
      showToast("Moved to trash");
      if (rowEl) rowEl.remove();
    } else {
      showToast("Trash failed");
    }
  } catch (err) {
    console.error("[devPanel] trash failed:", err);
    showToast("Trash failed");
  }
}

async function openFilePreview(file) {
  const modal = document.createElement("div");
  modal.className = "dev-preview-modal";
  modal.innerHTML =
    '<div class="dev-preview-backdrop"></div>' +
    '<div class="dev-preview-panel">' +
      `<h2 style="margin:0;font-size:16px;color:var(--text);text-transform:none;letter-spacing:0;">${escapeHtml(file.name)}</h2>` +
      `<p class="dev-preview-meta">${file.mimeType} · ${fmtBytes(file.size)}</p>` +
      '<div class="dev-preview-content"><p class="muted" style="padding:16px 0;font-size:13px;">Loading…</p></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector(".dev-preview-backdrop").addEventListener("click", () => modal.remove());

  const content = modal.querySelector(".dev-preview-content");
  try {
    const res = await readFileContent(file.id);
    if (!res.success) {
      content.innerHTML = `<p class="muted" style="padding:16px 0;font-size:13px;">${escapeHtml(res.error || "Preview unavailable.")}</p>`;
      return;
    }
    if (res.kind === "image") {
      const img = document.createElement("img");
      img.className = "dev-preview-img";
      img.src = `data:${res.mimeType};base64,${res.base64}`;
      content.innerHTML = "";
      content.appendChild(img);
    } else if (res.kind === "text") {
      const pre = document.createElement("pre");
      pre.className = "dev-preview-pre";
      pre.textContent = res.content || "(empty)";
      content.innerHTML = "";
      content.appendChild(pre);
    } else {
      content.innerHTML = `<p class="muted" style="padding:16px 0;font-size:13px;">${escapeHtml(res.note || "Preview not supported.")}</p>`;
    }
  } catch (err) {
    console.error("[devPanel] preview failed:", err);
    content.innerHTML = '<p class="muted" style="padding:16px 0;font-size:13px;">Failed to load preview.</p>';
  }
}

function confirmEmptyTrash() {
  // Type-to-confirm: permanent and irreversible, so we require the user to
  // type EMPTY before the call is allowed. The backend ALSO requires the
  // confirm=EMPTY guard, so a stray tap can't trigger a purge.
  const modal = document.createElement("div");
  modal.className = "dev-confirm-modal";
  modal.innerHTML =
    '<div class="dev-confirm-backdrop"></div>' +
    '<div class="dev-confirm-panel">' +
      '<p class="dev-confirm-title">Empty Drive trash?</p>' +
      '<p class="dev-confirm-body">This permanently deletes everything in the trash. <strong>It cannot be undone.</strong> Type EMPTY to confirm.</p>' +
      '<input class="dev-confirm-input" id="dev-empty-confirm-input" placeholder="Type EMPTY" autocapitalize="characters" autocomplete="off" />' +
      '<div class="dev-confirm-actions">' +
        '<button class="dev-button-secondary" id="dev-empty-cancel" type="button" style="flex:1">Cancel</button>' +
        '<button class="dev-button-danger" id="dev-empty-go" type="button" style="flex:1" disabled>Empty trash</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  const input = modal.querySelector("#dev-empty-confirm-input");
  const goBtn = modal.querySelector("#dev-empty-go");
  const close = () => modal.remove();
  modal.querySelector(".dev-confirm-backdrop").addEventListener("click", close);
  modal.querySelector("#dev-empty-cancel").addEventListener("click", close);
  input.addEventListener("input", () => { goBtn.disabled = input.value.trim() !== "EMPTY"; });
  goBtn.addEventListener("click", async () => {
    goBtn.disabled = true;
    goBtn.textContent = "Emptying…";
    try {
      const res = await emptyDriveTrash("EMPTY");
      if (res && res.success) showToast("Trash emptied");
      else showToast(res?.error || "Empty failed");
    } catch (err) {
      console.error("[devPanel] empty trash failed:", err);
      showToast("Empty failed");
    } finally {
      close();
    }
  });
  setTimeout(() => input.focus(), 50);
}

// ══════════════════════════════════════════════════════════════════
// TAB: Activity
// ══════════════════════════════════════════════════════════════════
async function renderActivity() {
  const grid = document.getElementById("dev-stat-grid");
  const scanList = document.getElementById("dev-scan-list");
  try {
    const ov = await getOverview();
    if (grid) {
      const stats = [
        ["Scans today", ov.scansToday ?? 0],
        ["Uploads today", ov.uploadsToday ?? 0],
        ["Active today", ov.activeSalespeopleToday ?? 0],
        ["Folders in Drive", ov.foldersInDrive ?? 0],
      ];
      grid.innerHTML = "";
      stats.forEach(([label, val]) => {
        const card = document.createElement("div");
        card.className = "dev-stat-card";
        card.innerHTML = `<div class="dev-stat-value">${val}</div><div class="dev-stat-label">${label}</div>`;
        grid.appendChild(card);
      });
    }
    if (scanList) {
      const scans = (ov.recentScans || []);
      if (scans.length === 0) {
        scanList.innerHTML = '<p class="muted" style="text-align:center;padding:14px;font-size:12.5px;">No recent scans.</p>';
      } else {
        scanList.innerHTML = "";
        scans.forEach((s) => {
          const row = document.createElement("div");
          row.className = "dev-scan-row";
          row.innerHTML =
            `<span><span class="dev-scan-row-cust">${escapeHtml(s.customer || "—")}</span> ` +
            `<span class="dev-scan-row-sp">${escapeHtml(s.salesperson || "")}</span></span>` +
            `<span class="dev-scan-row-time">${fmtTime(s.timestamp)}</span>`;
          scanList.appendChild(row);
        });
      }
    }
  } catch (err) {
    console.error("[devPanel] renderActivity failed:", err);
    if (grid) grid.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:16px;font-size:13px;">Failed to load activity.</p>';
  }
}

function fmtTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}

// ══════════════════════════════════════════════════════════════════
// TAB: Errors / event log
// ══════════════════════════════════════════════════════════════════
async function renderEventLog() {
  const list = document.getElementById("dev-event-list");
  const filter = document.getElementById("dev-error-filter")?.value || "all";
  if (!list) return;
  list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Loading…</p>';
  try {
    const res = await getEventLog();
    let events = (res.events || []);
    if (filter === "error") {
      events = events.filter((e) => /fail|error/i.test(e.type || ""));
    } else if (filter !== "all") {
      events = events.filter((e) => e.type === filter);
    }
    if (events.length === 0) {
      list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">No matching events.</p>';
      return;
    }
    list.innerHTML = "";
    events.slice(0, 100).forEach((ev) => {
      const isErr = /fail|error/i.test(ev.type || "");
      const row = document.createElement("div");
      row.className = "dev-event-row" + (isErr ? " is-error" : "");
      const msg = ev.error || ev.message || (ev.details ? JSON.stringify(ev.details) : "");
      row.innerHTML =
        `<div class="dev-event-type">${escapeHtml(ev.type || "event")}</div>` +
        (msg ? `<div class="dev-event-msg">${escapeHtml(String(msg).slice(0, 240))}</div>` : "") +
        `<div class="dev-event-time">${escapeHtml(ev.salesperson || "")} · ${fmtDateTime(ev.timestamp || ev.ts)}</div>`;
      list.appendChild(row);
    });
  } catch (err) {
    console.error("[devPanel] renderEventLog failed:", err);
    list.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Failed to load events.</p>';
  }
}

function fmtDateTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return String(iso); }
}

// ══════════════════════════════════════════════════════════════════
// TAB: System files — generic JSON editor with friendly controls
// ══════════════════════════════════════════════════════════════════
//
// A structural editor: it renders whatever JSON the file contains by type
// (bool→toggle, string→input, number→number field, array→add/remove list,
// object→nested group). It doesn't need to know the file's schema. The raw
// JSON textarea remains as an "Advanced" fallback. Save is gated server-side
// to editable files (config + users); logs open read-only.

let _currentFile = null;     // { name, editable }
let _currentJson = null;     // live edited copy
let _rawMode = false;

async function initFilesTab() {
  const picker = document.getElementById("dev-file-picker");
  const note = document.getElementById("dev-file-note");
  if (!picker) return;
  picker.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await listSystemFiles();
    const files = (res.files || []);
    if (files.length === 0) {
      picker.innerHTML = '<option value="">No JSON files found</option>';
      return;
    }
    picker.innerHTML = "";
    files.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = f.name.replace(/^_DealerScan_/, "").replace(/\.json$/, "") +
        (f.editable ? "" : " (read-only)");
      opt.dataset.editable = f.editable ? "1" : "0";
      picker.appendChild(opt);
    });
    if (note) note.textContent = `${files.length} JSON file${files.length === 1 ? "" : "s"} in system folder.`;
    // Auto-load the first file.
    loadSystemFile(picker.value);
  } catch (err) {
    console.error("[devPanel] initFilesTab failed:", err);
    picker.innerHTML = '<option value="">Failed to load files</option>';
  }
}

async function loadSystemFile(name) {
  if (!name) return;
  const form = document.getElementById("dev-file-form");
  const saveBtn = document.getElementById("dev-config-save");
  const saveNote = document.getElementById("dev-file-save-note");
  const title = document.getElementById("dev-file-title");
  const ta = document.getElementById("dev-config-editor");
  if (form) form.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Loading…</p>';

  try {
    const res = await readSystemFile(name);
    if (!res.success) {
      if (form) form.innerHTML = `<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">${escapeHtml(res.error || "Failed to read file.")}</p>`;
      return;
    }
    _currentFile = { name: res.name, editable: !!res.editable };
    _currentJson = res.json;
    _rawMode = false;

    if (title) {
      title.innerHTML = escapeHtml(name.replace(/^_DealerScan_/, "").replace(/\.json$/, "")) +
        (res.editable ? "" : '<span class="dev-form-readonly-badge">READ-ONLY</span>');
    }
    if (ta) { ta.hidden = true; ta.value = JSON.stringify(res.json, null, 2); }

    // Save button only for editable files.
    if (saveBtn) saveBtn.hidden = !res.editable;
    if (saveNote) {
      saveNote.textContent = res.editable
        ? "Changes write to this file. Malformed values are rejected before saving."
        : "This is an operational log written by the app — view only.";
    }
    renderForm();
  } catch (err) {
    console.error("[devPanel] loadSystemFile failed:", err);
    if (form) form.innerHTML = '<p class="muted" style="text-align:center;padding:24px 8px;font-size:13px;">Failed to load file.</p>';
  }
}

function renderForm() {
  const form = document.getElementById("dev-file-form");
  const ta = document.getElementById("dev-config-editor");
  if (!form) return;
  if (_rawMode) {
    form.hidden = true;
    if (ta) ta.hidden = false;
    return;
  }
  form.hidden = false;
  if (ta) ta.hidden = true;
  form.innerHTML = "";
  const editable = _currentFile?.editable;
  // Build the recursive form bound to _currentJson. Mutations write back
  // into _currentJson directly via the provided setter closures.
  form.appendChild(buildNode(_currentJson, (nv) => { _currentJson = nv; }, "", editable));
}

// Recursively build a control for `value`. `setter(newValue)` writes the
// edited value back into the parent structure. `path` is for display only.
function buildNode(value, setter, path, editable) {
  const type = Array.isArray(value) ? "array" : (value === null ? "null" : typeof value);

  if (type === "boolean") return boolField(value, setter, path, editable);
  if (type === "number")  return numberField(value, setter, path, editable);
  if (type === "string")  return stringField(value, setter, path, editable);
  if (type === "array")   return arrayField(value, setter, path, editable);
  if (type === "object")  return objectField(value, setter, path, editable);
  // null / undefined → editable string that can be set
  return stringField(value == null ? "" : String(value), setter, path, editable);
}

function fieldShell(labelText) {
  const wrap = document.createElement("div");
  wrap.className = "dev-form-field";
  if (labelText !== null) {
    const row = document.createElement("div");
    row.className = "dev-form-field-row";
    const label = document.createElement("span");
    label.className = "dev-form-label";
    label.textContent = labelText;
    row.appendChild(label);
    wrap._row = row;
    wrap.appendChild(row);
  }
  return wrap;
}

function boolField(value, setter, path, editable) {
  const wrap = fieldShell(path || "value");
  const toggle = document.createElement("label");
  toggle.className = "dev-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!value;
  input.disabled = !editable;
  input.addEventListener("change", () => setter(input.checked));
  const track = document.createElement("span");
  track.className = "dev-toggle-track";
  toggle.appendChild(input);
  toggle.appendChild(track);
  (wrap._row || wrap).appendChild(toggle);
  return wrap;
}

function numberField(value, setter, path, editable) {
  const wrap = fieldShell(path || "value");
  const input = document.createElement("input");
  input.type = "number";
  input.className = "dev-form-input";
  input.value = value;
  input.disabled = !editable;
  input.addEventListener("input", () => {
    const n = input.value === "" ? null : Number(input.value);
    setter(Number.isNaN(n) ? value : n);
  });
  (wrap._row || wrap).appendChild(input);
  return wrap;
}

function stringField(value, setter, path, editable) {
  const wrap = fieldShell(path || "value");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "dev-form-input";
  input.value = value;
  input.disabled = !editable;
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("input", () => setter(input.value));
  wrap.appendChild(input);
  return wrap;
}

function arrayField(value, setter, path, editable) {
  const group = document.createElement("div");
  group.className = "dev-form-group";
  const title = document.createElement("p");
  title.className = "dev-form-group-title";
  title.textContent = (path || "list") + ` (${value.length})`;
  group.appendChild(title);

  // Work on a live array reference so item edits/removals persist.
  const arr = value;

  function repaint() {
    // Remove existing item rows (keep title) and rebuild.
    [...group.querySelectorAll(".dev-array-item, .dev-array-add, .dev-form-group, .dev-form-field")].forEach((n) => n.remove());
    arr.forEach((item, i) => {
      const isScalar = item === null || typeof item !== "object";
      if (isScalar) {
        const row = document.createElement("div");
        row.className = "dev-array-item";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "dev-form-input";
        input.value = item == null ? "" : item;
        input.disabled = !editable;
        input.addEventListener("input", () => { arr[i] = input.value; });
        row.appendChild(input);
        if (editable) {
          const rm = document.createElement("button");
          rm.className = "dev-array-remove";
          rm.textContent = "×";
          rm.title = "Remove";
          rm.addEventListener("click", () => { arr.splice(i, 1); repaint(); });
          row.appendChild(rm);
        }
        group.appendChild(row);
      } else {
        // Nested object/array element
        const node = buildNode(item, (nv) => { arr[i] = nv; }, `[${i}]`, editable);
        group.appendChild(node);
      }
    });
    if (editable) {
      const add = document.createElement("button");
      add.className = "dev-array-add";
      add.textContent = "+ Add item";
      add.addEventListener("click", () => { arr.push(""); repaint(); });
      group.appendChild(add);
    }
  }
  repaint();
  return group;
}

function objectField(value, setter, path, editable) {
  const group = document.createElement("div");
  group.className = "dev-form-group";
  if (path) {
    const title = document.createElement("p");
    title.className = "dev-form-group-title";
    title.textContent = path;
    group.appendChild(title);
  }
  Object.keys(value).forEach((key) => {
    const node = buildNode(value[key], (nv) => { value[key] = nv; }, key, editable);
    group.appendChild(node);
  });
  return group;
}

function toggleRawMode() {
  const ta = document.getElementById("dev-config-editor");
  const btn = document.getElementById("dev-file-advanced-toggle");
  if (!_rawMode) {
    // Entering raw mode: serialize current edited state into the textarea.
    if (ta) ta.value = JSON.stringify(_currentJson, null, 2);
    ta.disabled = !_currentFile?.editable;
    _rawMode = true;
    if (btn) btn.querySelector("span").textContent = "Friendly view";
  } else {
    // Leaving raw mode: parse textarea back into _currentJson (if valid).
    if (ta) {
      try {
        _currentJson = JSON.parse(ta.value);
      } catch {
        showToast("Raw JSON is invalid — fix or it won't sync to the form");
        return; // stay in raw mode so they can fix it
      }
    }
    _rawMode = false;
    if (btn) btn.querySelector("span").textContent = "Advanced (raw)";
  }
  renderForm();
}

async function saveCurrentFile() {
  if (!_currentFile || !_currentFile.editable) {
    showToast("This file is read-only");
    return;
  }
  // If in raw mode, sync the textarea into _currentJson first.
  if (_rawMode) {
    const ta = document.getElementById("dev-config-editor");
    try { _currentJson = JSON.parse(ta.value); }
    catch { showToast("Invalid JSON — fix before saving"); return; }
  }
  const btn = document.getElementById("dev-config-save");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const res = await writeSystemFile(_currentFile.name, _currentJson);
    if (res && res.success) showToast("Saved");
    else showToast(res?.error || "Save failed");
  } catch (err) {
    console.error("[devPanel] saveCurrentFile failed:", err);
    showToast("Save failed");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

// Shared HTML-escape for all dynamic strings rendered via innerHTML.
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
