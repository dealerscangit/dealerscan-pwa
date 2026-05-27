// scripts/screens/home.js
// Redesigned home screen (2026-05-26): status strip + profile card +
// tab-pill counters + threaded vertical timeline + red CTA beacon +
// secondary list button.
//
// Talks to the backend via a single getHomeOverview round trip that
// returns { today, week, total, timeline }.

import { getCurrentSalesperson } from "../currentUser.js";
import {
  getHomeOverview,
  hideCustomer,
  unhideCustomer,
} from "../apiClient.js";
import { makeSwipeable, showToast } from "../swipeActions.js";
import { reportError } from "../errorReporter.js";

let _showScreen = null;
let _session = null;

// Cached overview from the last successful fetch, so screen re-entry is instant
// while we refresh in the background.
let _overviewCache = null;

// Network/sync UI state — drives the status dot pulse + label
let _isSyncing = false;

export function attachHomeHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const btnNewScan = document.getElementById("btn-new-scan");
  if (btnNewScan) {
    btnNewScan.addEventListener("click", () => {
      _session.reset();
      _showScreen("customer");
    });
  }

  // Quick menu trigger is now handled by attachQuickMenuHandlers in
  // scripts/screens/quickMenu.js. The old btn-all-customers element
  // was replaced by btn-quick-menu when the design changed to a kebab.

  const btnSettings = document.getElementById("btn-settings");
  if (btnSettings) {
    btnSettings.addEventListener("click", () => {
      _showScreen("settings");
    });
  }

  // Track connection state so the status dot reflects reality
  window.addEventListener("online", () => updateStatusDot());
  window.addEventListener("offline", () => updateStatusDot());
}

export function renderHome() {
  paintIdentity();
  updateStatusDot();
  renderOverview();
}

// ──────────────────────────────────────────────────────────────────
// Identity (top profile card)
// ──────────────────────────────────────────────────────────────────
function paintIdentity() {
  const sp = getCurrentSalesperson() || "Salesperson";
  const avatar = document.getElementById("profile-card-avatar");
  const name = document.getElementById("profile-card-name");
  if (avatar) avatar.textContent = sp.charAt(0).toUpperCase();
  if (name) name.textContent = sp;
}

// ──────────────────────────────────────────────────────────────────
// Status dot (pinned strip, top-left)
// ──────────────────────────────────────────────────────────────────
function updateStatusDot() {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  if (!dot || !label) return;

  dot.classList.remove("syncing", "offline");

  if (!navigator.onLine) {
    dot.classList.add("offline");
    label.textContent = "Offline";
    return;
  }
  if (_isSyncing) {
    dot.classList.add("syncing");
    label.textContent = "Syncing";
    return;
  }
  label.textContent = "Synced";
}

function setSyncing(isSyncing) {
  _isSyncing = isSyncing;
  updateStatusDot();
}

// ──────────────────────────────────────────────────────────────────
// Overview (counters + timeline) — single fetch, single paint
// ──────────────────────────────────────────────────────────────────
async function renderOverview() {
  // Paint from cache immediately if we have it; this is what makes
  // re-entering the screen feel instant.
  if (_overviewCache) {
    paintCounters(_overviewCache);
    paintTimeline(_overviewCache.timeline);
  } else {
    // No cache — show spinners in all counters and a skeleton timeline.
    // Loading state must be immediately visible, even if the network is fast.
    paintLoadingSpinners();
    paintSkeleton();
  }

  const sp = getCurrentSalesperson();
  if (!sp) {
    paintEmpty();
    return;
  }

  setSyncing(true);
  const fetchStart = Date.now();
  try {
    const data = await getHomeOverview(sp);
    // Enforce minimum spinner visible time so very fast fetches still
    // show a perceptible loading state. 400ms = the just-noticeable
    // threshold for state changes; lower feels jarringly instant.
    if (!_overviewCache) {
      const elapsed = Date.now() - fetchStart;
      if (elapsed < 400) {
        await new Promise((r) => setTimeout(r, 400 - elapsed));
      }
    }
    _overviewCache = data;
    paintCounters(data);
    paintTimeline(data.timeline);
  } catch (err) {
    console.error("[home] getHomeOverview failed:", err);
    reportError("getHomeOverviewFailed", { error: err });
    // If we have no cache to fall back on, show empty rather than skeleton
    if (!_overviewCache) paintEmpty();
  } finally {
    setSyncing(false);
  }
}

// Paint loading spinners into every counter field. Called when there is no
// cached data yet so the screen has a clear "loading" state even on slow nets.
function paintLoadingSpinners() {
  const big = document.getElementById("stat-today-value");
  if (big) big.innerHTML = '<span class="loading-spinner lg"></span>';
  ["pill-today-value", "pill-week-value", "pill-total-value"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="loading-spinner"></span>';
  });
}

function paintCounters({ today, week, total }) {
  const fields = [
    ["stat-today-value", today],
    ["pill-today-value", today],
    ["pill-week-value", week],
    ["pill-total-value", total],
  ];
  fields.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
}

function paintSkeleton() {
  const list = document.getElementById("timeline-list");
  if (!list) return;
  list.innerHTML = `
    <div class="skeleton skeleton-timeline-row"></div>
    <div class="skeleton skeleton-timeline-row"></div>
    <div class="skeleton skeleton-timeline-row"></div>`;
}

function paintEmpty() {
  const list = document.getElementById("timeline-list");
  if (list) {
    list.innerHTML =
      '<div class="timeline-empty">No scans yet today. Tap New scan to start.</div>';
  }
  const meta = document.getElementById("timeline-meta");
  if (meta) meta.textContent = "";
  // Also clear the spinner state on counters by setting them to 0.
  // Important: this is the "no data after fetch" path, not the
  // "still loading" path. paintCounters handles the success path.
  ["stat-today-value", "pill-today-value", "pill-week-value", "pill-total-value"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "0";
    });
}

function paintTimeline(timeline) {
  const list = document.getElementById("timeline-list");
  const meta = document.getElementById("timeline-meta");
  if (!list) return;

  if (!timeline || timeline.length === 0) {
    paintEmpty();
    return;
  }

  if (meta) meta.textContent = `${timeline.length} today`;

  // Show up to 5 in the home view; the rest live on the customer screen.
  const visible = timeline.slice(0, 5);

  list.innerHTML = "";
  visible.forEach((entry) => {
    const { row, swipeTarget } = buildTimelineRow(entry);
    list.appendChild(row);
    // Wrap only the inner card with swipe actions, leaving the dot
    // (a sibling of the card inside the row) outside the wrap.
    makeSwipeable(swipeTarget, {
      actions: [
        {
          label: "Remove",
          style: "destructive",
          onTap: () => handleRemove(entry.customer),
        },
      ],
    });
  });
}

function buildTimelineRow(entry) {
  const row = document.createElement("div");
  row.className = "timeline-row";

  // Dot sits OUTSIDE the swipe-wrap so it stays visible when the row's
  // card gets wrapped. Without this, .swipe-wrap's overflow:hidden
  // clipped the dot (it lives at left: -16px outside the card).
  const dot = document.createElement("span");
  dot.className = "timeline-row-dot";
  dot.setAttribute("aria-hidden", "true");
  row.appendChild(dot);

  const card = document.createElement("button");
  card.className = "timeline-row-card";
  card.type = "button";

  const avatar = document.createElement("span");
  avatar.className = "timeline-row-avatar";
  avatar.textContent = (entry.customer || "?").charAt(0).toUpperCase();

  // Text block (two lines): name on top, photo count subtitle on bottom.
  // This eliminates the visual "weird gap" when names are short because
  // the subtitle naturally fills the bottom line even when the customer
  // has a 4-character name.
  const textBlock = document.createElement("span");
  textBlock.className = "timeline-row-text";

  const name = document.createElement("span");
  name.className = "timeline-row-name";
  name.textContent = entry.customer || "(unknown)";

  const subtitle = document.createElement("span");
  subtitle.className = "timeline-row-subtitle";
  const photoCount = entry.photoCount || 0;
  subtitle.textContent = photoCount
    ? `${photoCount} ${photoCount === 1 ? "doc" : "docs"}`
    : "scan";

  textBlock.appendChild(name);
  textBlock.appendChild(subtitle);

  const time = document.createElement("span");
  time.className = "timeline-row-time";
  time.textContent = formatTimestamp(entry.timestamp);

  card.appendChild(avatar);
  card.appendChild(textBlock);
  card.appendChild(time);
  row.appendChild(card);

  card.addEventListener("click", () => {
    _session.reset();
    _session.customerName = entry.customer;
    _session.isNewCustomer = false;
    _showScreen("camera");
  });

  // Return BOTH the row (for DOM insertion) and the swipe target
  // (the inner card, so the dot is preserved outside the swipe-wrap).
  return { row, swipeTarget: card };
}

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    const am = h < 12;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")}${am ? "a" : "p"}`;
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────────
// Remove customer (swipe action on timeline row)
// ──────────────────────────────────────────────────────────────────
async function handleRemove(name) {
  const sp = getCurrentSalesperson();
  if (!sp) return;

  // Optimistic local update
  const before = _overviewCache;
  if (_overviewCache) {
    _overviewCache = {
      ..._overviewCache,
      timeline: _overviewCache.timeline.filter((e) => e.customer !== name),
    };
    paintTimeline(_overviewCache.timeline);
  }

  try {
    await hideCustomer(sp, name);
  } catch (err) {
    console.error("[home] hideCustomer failed, restoring:", err);
    reportError("hideCustomerFailed", { customer: name, error: err });
    _overviewCache = before;
    if (_overviewCache) paintTimeline(_overviewCache.timeline);
    showToast(`Couldn't remove ${name} — try again`);
    return;
  }

  showToast(`Removed ${name}`, {
    actionLabel: "Undo",
    onAction: async () => {
      try {
        await unhideCustomer(sp, name);
        // Re-fetch so server is the source of truth for ordering
        _overviewCache = null;
        renderOverview();
      } catch (err) {
        console.error("[home] unhideCustomer failed:", err);
        showToast(`Couldn't restore ${name}`);
      }
    },
  });
}

// ──────────────────────────────────────────────────────────────────
// Cache management — exported so customer.js can invalidate after
// its own swipe-remove (kept for backward compatibility).
// ──────────────────────────────────────────────────────────────────
export function getCachedHistory() {
  if (!_overviewCache) return null;
  return _overviewCache.timeline.map((e) => e.customer);
}

export function invalidateHistoryCache() {
  _overviewCache = null;
}
