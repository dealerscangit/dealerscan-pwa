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
import { count as queueCount, processQueue } from "../offlineQueue.js";
import { hasPermissionSync, getCurrentUserRecord, loadRegistry } from "../roles.js";
import { maybeShowBanner } from "../announcements.js";
import { getTeamOverview } from "../apiClient.js";
import { getOrFetch, invalidate as invalidateCache } from "../dataCache.js";

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
  maybeShowBanner();  // fire-and-forget; banner paints when ready
  paintIdentity();
  updateStatusDot();
  renderOverview();
}

// ──────────────────────────────────────────────────────────────────
// Identity (top profile card)
// ──────────────────────────────────────────────────────────────────
async function paintIdentity() {
  const sp = getCurrentSalesperson() || "Salesperson";
  const avatar = document.getElementById("profile-card-avatar");
  const name = document.getElementById("profile-card-name");
  const sub = document.getElementById("profile-card-sub");
  if (avatar) avatar.textContent = sp.charAt(0).toUpperCase();
  if (name) name.textContent = sp;

  // Role label from registry. Cascade: cached lookup -> async load -> fallback.
  // The label uses the human-friendly "label" field from the registrys roles
  // map (Salesperson / Manager / Dev) rather than the raw role key.
  if (sub) {
    try {
      const reg = await loadRegistry();
      const record = await getCurrentUserRecord();
      const roleKey = record?.role || "sales";
      const label = reg?.roles?.[roleKey]?.label || roleKey;
      sub.textContent = label;
    } catch {
      sub.textContent = "Salesperson"; // safe fallback
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Status dot (pinned strip, top-left)
// ──────────────────────────────────────────────────────────────────
async function updateStatusDot() {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  if (!dot || !label) return;

  dot.classList.remove("syncing", "offline");

  // When offline, also report how many scans are queued so the user
  // knows their work is safe and will sync later.
  if (!navigator.onLine) {
    dot.classList.add("offline");
    let queued = 0;
    try { queued = await queueCount(); } catch {}
    label.textContent = queued > 0 ? `Offline · ${queued} queued` : "Offline";
    return;
  }
  if (_isSyncing) {
    dot.classList.add("syncing");
    label.textContent = "Syncing";
    return;
  }
  // When online but with pending queue items, show "Syncing N queued"
  // so the user sees the auto-drain happening.
  let queued = 0;
  try { queued = await queueCount(); } catch {}
  if (queued > 0) {
    dot.classList.add("syncing");
    label.textContent = `Syncing · ${queued} queued`;
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
  const sp = getCurrentSalesperson();
  if (!sp) {
    paintEmpty();
    return;
  }

  // CRITICAL: must wait for registry before deciding view mode, otherwise
  // first paint uses personal view (sync check returns false for missing
  // registry) and second paint uses team view (registry has loaded by then),
  // causing the timeline to flip-flop between visits to dashboard and back.
  await loadRegistry().catch(() => {});

  // Managers + dev see a TEAM timeline (everyones scans, with salesperson
  // chip on each row). Sales role sees ONLY their own scans.
  const isTeamView = hasPermissionSync("viewAllData");
  const cacheKey = isTeamView
    ? `teamOverview:all`
    : `homeOverview:${sp}`;

  const fetcher = isTeamView
    ? () => mergeTeamWithPersonal(sp)
    : () => getHomeOverview(sp);

  const { value: cached, isStale, freshPromise } = await getOrFetch(
    cacheKey,
    fetcher
  );

  // Initial paint from cache (or spinners if no cache yet)
  if (cached) {
    paintCounters(cached);
    paintTimeline(cached.timeline);
    _overviewCache = cached;
  } else {
    paintLoadingSpinners();
    paintSkeleton();
  }

  // If a fetch is in flight, await it (silently, no spinner) and re-paint
  // when it completes. setSyncing flips the status dot to syncing while
  // we wait, so the user gets visual confirmation that data is loading.
  if (freshPromise) {
    setSyncing(true);
    try {
      const data = await freshPromise;
      _overviewCache = data;
      paintCounters(data);
      paintTimeline(data.timeline);
    } catch (err) {
      console.error("[home] overview refresh failed:", err);
      reportError("getHomeOverviewFailed", { error: err });
      // If we had nothing cached, fall back to empty rather than skeleton
      if (!cached) paintEmpty();
    } finally {
      setSyncing(false);
    }
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
  const docsText = photoCount
    ? `${photoCount} ${photoCount === 1 ? "doc" : "docs"}`
    : "scan";
  // For managers / dev viewing team timeline, prefix subtitle with salesperson
  // name so they see "Brandon · 2 docs" instead of just "2 docs". Falls back
  // to plain docs text if entry has no salesperson (own-data only mode).
  subtitle.textContent = entry.salesperson
    ? `${entry.salesperson} · ${docsText}`
    : docsText;

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


// Manager-tier home: blends the personal counters (their OWN today/week/total)
// with a team-wide timeline (everyones recent scans). The personal counters
// stay personal because the manager still wants to see their own work; only
// the timeline shows the whole team.
//
// Returns the same shape as getHomeOverview so paintCounters/paintTimeline
// don't need to know the difference.
async function mergeTeamWithPersonal(salesName) {
  // Fire both in parallel — minimizes total wait
  const [personal, team] = await Promise.all([
    getHomeOverview(salesName),
    getTeamOverview(),
  ]);

  // Build a unified timeline. Dedupe by salesperson+customer so the same
  // person scanning the same customer multiple times shows once (newest
  // entry, with summed photoCount). Matches the dedup behavior of the
  // personal-view timeline.
  const dedupMap = new Map();
  (team?.recentScans || []).forEach((s) => {
    const key = `${s.salesperson || ""}::${(s.customer || "").toLowerCase()}`;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, {
        customer: s.customer,
        photoCount: s.photoCount || 0,
        timestamp: s.timestamp,
        folderId: s.folderId,
        salesperson: s.salesperson,
      });
    } else {
      // Keep latest timestamp + sum the photo counts
      const ts1 = new Date(existing.timestamp || 0).getTime();
      const ts2 = new Date(s.timestamp || 0).getTime();
      existing.photoCount = (existing.photoCount || 0) + (s.photoCount || 0);
      if (ts2 > ts1) {
        existing.timestamp = s.timestamp;
        existing.folderId = s.folderId;
      }
    }
  });
  const teamTimeline = Array.from(dedupMap.values())
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 12);

  // Personal counters stay personal; timeline becomes team-wide.
  return {
    ...personal,
    timeline: teamTimeline,
  };
}
