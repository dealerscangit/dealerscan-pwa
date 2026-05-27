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
import { showToast } from "../swipeActions.js";

let _showScreen = null;
let _editingEmail = null; // null = adding, string = editing existing

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
