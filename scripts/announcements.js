// scripts/announcements.js
// Announcement system: compose + display banner + dismiss tracking.
//
// Roles:
//   - dev + manager: can compose (hasPermission "managerActions")
//   - everyone: receives banners targeted at them or "all"
//
// Lifecycle:
//   1. On home screen entry, fetch announcements visible to current user
//   2. Filter out ones already dismissed (tracked in localStorage)
//   3. Show the NEWEST undismissed banner
//   4. Auto-dismiss after 6 seconds (or on tap)
//   5. Dismissal marks the id in localStorage so same announcement
//      doesn't re-appear on next home visit
//
// Storage key: "ds.dismissed_announcements" -> array of ids
//
// Compose UX (modal opens from quick menu):
//   - Message textarea (max 280 chars, mirrors a tweet/text length)
//   - Audience: Everyone (default) or Specific people (multi-select)
//   - TTL: 1h / 4h / 24h (default) / 3d
//   - Send button POSTs to backend, closes modal, toasts success

import {
  listAnnouncements,
  createAnnouncement,
} from "./apiClient.js";
import {
  hasPermissionSync,
  loadRegistry,
  getCurrentUserRecord,
} from "./roles.js";
import { getCurrentSalesperson } from "./currentUser.js";
import { showToast } from "./swipeActions.js";

const DISMISSED_KEY_PREFIX = "ds.dismissed_announcements.";
const BANNER_AUTO_DISMISS_MS = 6000;

// Returns the localStorage key scoped to the current user. Without this,
// all users on the same device share dismissed-ids (one person dismisses
// for everyone). Once Sign-In ships well key by email instead of name.
function dismissedKey() {
  const sp = (getCurrentSalesperson() || "anon").toLowerCase().trim().replace(/\s+/g, "_");
  return DISMISSED_KEY_PREFIX + sp;
}

let _bannerTimer = null;
let _audienceMode = "all";

// ──────────────────────────────────────────────────────────────────
// Dismissed-id tracking (localStorage)
// ──────────────────────────────────────────────────────────────────
function getDismissedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissedKey()) || "[]"));
  } catch {
    return new Set();
  }
}
function markDismissed(id) {
  const set = getDismissedIds();
  set.add(id);
  // Cap stored ids to most recent 200 so localStorage doesn't grow forever
  const arr = Array.from(set).slice(-200);
  try { localStorage.setItem(dismissedKey(), JSON.stringify(arr)); } catch {}
}

// ──────────────────────────────────────────────────────────────────
// Banner display (called by home.js on screen entry)
// ──────────────────────────────────────────────────────────────────
export async function maybeShowBanner() {
  try {
    const sp = getCurrentSalesperson() || "";
    const record = await getCurrentUserRecord();
    const email = record?.email || "";

    const { items } = await listAnnouncements(sp, email);
    if (!items || items.length === 0) return;

    const dismissed = getDismissedIds();
    const fresh = items.find((a) => !dismissed.has(a.id));
    if (!fresh) return;

    showBanner(fresh);
  } catch (err) {
    console.warn("[announcements] maybeShowBanner failed:", err);
  }
}

function showBanner(announcement) {
  const banner = document.getElementById("announcement-banner");
  const fromEl = document.getElementById("announcement-banner-from");
  const textEl = document.getElementById("announcement-banner-text");
  const closeBtn = document.getElementById("announcement-banner-close");
  if (!banner) return;

  if (fromEl) {
    fromEl.textContent = announcement.createdByName
      ? `From ${announcement.createdByName}`
      : "Announcement";
  }
  if (textEl) textEl.textContent = announcement.body || "";
  banner.hidden = false;
  banner.classList.remove("announcement-banner--leaving");

  // Dismiss handlers — both manual (close tap, banner tap) and timer
  const dismiss = () => dismissBanner(announcement.id);
  if (closeBtn) closeBtn.onclick = (ev) => { ev.stopPropagation(); dismiss(); };
  banner.onclick = dismiss;

  if (_bannerTimer) clearTimeout(_bannerTimer);
  _bannerTimer = setTimeout(dismiss, BANNER_AUTO_DISMISS_MS);
}

function dismissBanner(id) {
  const banner = document.getElementById("announcement-banner");
  if (!banner) return;
  if (_bannerTimer) { clearTimeout(_bannerTimer); _bannerTimer = null; }
  banner.classList.add("announcement-banner--leaving");
  // Wait for the leave animation, then fully hide
  setTimeout(() => {
    banner.hidden = true;
    banner.classList.remove("announcement-banner--leaving");
  }, 320);
  markDismissed(id);
}

// ──────────────────────────────────────────────────────────────────
// Compose modal handlers
// ──────────────────────────────────────────────────────────────────
export function attachAnnouncementHandlers() {
  // Quick menu "New announcement" item — only visible for users with
  // managerActions permission. The home screen shows/hides this based
  // on registry data.
  const qmItem = document.getElementById("qm-announce-item");
  if (qmItem) {
    qmItem.addEventListener("click", () => {
      // Close the quick menu first, then open the announce modal
      const qm = document.getElementById("quick-menu");
      if (qm) qm.hidden = true;
      openComposeModal();
    });
  }

  // Modal close + cancel
  const closeBtn = document.getElementById("ann-modal-close");
  const cancelBtn = document.getElementById("ann-modal-cancel");
  const backdrop = document.getElementById("ann-modal-backdrop");
  const sendBtn = document.getElementById("ann-modal-send");

  if (closeBtn) closeBtn.addEventListener("click", closeComposeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeComposeModal);
  if (backdrop) backdrop.addEventListener("click", closeComposeModal);
  if (sendBtn) sendBtn.addEventListener("click", handleSend);

  // Audience toggle
  const toggle = document.getElementById("ann-audience-toggle");
  if (toggle) {
    toggle.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-aud]");
      if (!btn) return;
      _audienceMode = btn.dataset.aud;
      toggle.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      const picker = document.getElementById("ann-users-picker");
      if (picker) picker.hidden = _audienceMode !== "users";
    });
  }

  // Live char count
  const body = document.getElementById("ann-body");
  const count = document.getElementById("ann-char-count");
  if (body && count) {
    body.addEventListener("input", () => {
      count.textContent = `${body.value.length} / 280`;
    });
  }
}

// Show / hide the quick menu entry based on permission. Called from
// home.js whenever the menu is about to open.
export function updateAnnouncementMenuVisibility() {
  const qmItem = document.getElementById("qm-announce-item");
  if (qmItem) qmItem.hidden = !hasPermissionSync("managerActions");
}

async function openComposeModal() {
  // Reset state
  _audienceMode = "all";
  const body = document.getElementById("ann-body");
  const count = document.getElementById("ann-char-count");
  const ttl = document.getElementById("ann-ttl");
  const toggle = document.getElementById("ann-audience-toggle");
  const picker = document.getElementById("ann-users-picker");

  if (body) body.value = "";
  if (count) count.textContent = "0 / 280";
  if (ttl) ttl.value = "24";
  if (toggle) {
    toggle.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b.dataset.aud === "all")
    );
  }
  if (picker) picker.hidden = true;

  // Populate users list (everyone except self)
  const list = document.getElementById("ann-users-list");
  if (list) {
    list.innerHTML = '<p class="muted" style="text-align: center; padding: 8px; font-size: 12px;">Loading…</p>';
    try {
      const reg = await loadRegistry();
      const me = await getCurrentUserRecord();
      const myEmail = (me?.email || "").toLowerCase();
      const users = (reg.users || [])
        .filter((u) => u.active !== false && (u.email || "").toLowerCase() !== myEmail)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      list.innerHTML = "";
      users.forEach((u) => {
        const row = document.createElement("label");
        row.className = "ann-user-row";
        row.innerHTML = `
          <input type="checkbox" data-email="${escapeAttr(u.email)}" data-name="${escapeAttr(u.name)}" />
          <span class="ann-user-row-name">${escapeHtml(u.name)}</span>
          <span class="ann-user-row-role">${escapeHtml(u.role || "sales")}</span>
        `;
        const cb = row.querySelector("input");
        cb.addEventListener("change", () => {
          row.classList.toggle("checked", cb.checked);
        });
        list.appendChild(row);
      });
    } catch (err) {
      list.innerHTML = '<p class="muted" style="text-align: center; padding: 8px; font-size: 12px;">Failed to load users.</p>';
    }
  }

  const modal = document.getElementById("ann-modal");
  if (modal) modal.hidden = false;
  if (body) setTimeout(() => body.focus(), 100);
}

function closeComposeModal() {
  const modal = document.getElementById("ann-modal");
  if (modal) modal.hidden = true;
}

async function handleSend() {
  const body = document.getElementById("ann-body")?.value.trim();
  const ttl = parseInt(document.getElementById("ann-ttl")?.value || "24", 10);
  const sendBtn = document.getElementById("ann-modal-send");

  if (!body) return showToast("Message required");
  if (body.length > 280) return showToast("Message too long");

  let audience = { type: "all" };
  if (_audienceMode === "users") {
    const checks = document.querySelectorAll("#ann-users-list input[type=checkbox]:checked");
    const emails = Array.from(checks).map((c) => c.dataset.email).filter(Boolean);
    const names = Array.from(checks).map((c) => c.dataset.name).filter(Boolean);
    if (emails.length === 0 && names.length === 0) {
      return showToast("Select at least one person");
    }
    audience = { type: "users", emails, names };
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
  }

  try {
    const me = await getCurrentUserRecord();
    await createAnnouncement({
      body,
      audience,
      ttlHours: ttl,
      createdBy: me?.email || "",
      createdByName: me?.name || getCurrentSalesperson() || "",
    });
    closeComposeModal();
    showToast(audience.type === "all" ? "Sent to everyone" : `Sent to ${audience.emails.length || audience.names.length}`);
  } catch (err) {
    console.error("[announcements] send failed:", err);
    showToast("Send failed");
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;");
}
