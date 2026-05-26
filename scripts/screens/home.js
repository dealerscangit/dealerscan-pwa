// scripts/screens/home.js
// Screen 2: home — greeting + primary "New Scan" card + recent customers.

import { getCurrentSalesperson } from "../currentUser.js";
import { getCustomerHistory, hideCustomer, unhideCustomer } from "../apiClient.js";
import { makeSwipeable, showToast } from "../swipeActions.js";

let _showScreen = null;
let _session = null;
let _historyCache = null; // cache for the session so we don't re-fetch every screen change

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
}

export function renderHome() {
  renderGreeting();
  renderRecentList();
}

function renderGreeting() {
  const el = document.getElementById("home-greeting");
  if (!el) return;
  const sp = getCurrentSalesperson();
  el.textContent = sp ? `Hi, ${sp} 👋` : "Hi 👋";
}

async function renderRecentList() {
  const list = document.getElementById("recent-list");
  const count = document.getElementById("recent-count");
  if (!list) return;

  if (_historyCache) {
    paintRecentList(list, count, _historyCache);
  } else {
    // First load: skeleton placeholders
    list.innerHTML = `
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>`;
    if (count) count.textContent = "";
  }

  // Always re-fetch in background to stay fresh
  try {
    const sp = getCurrentSalesperson();
    if (!sp) return;
    const all = await getCustomerHistory(sp);
    const real = all.filter((n) => n && n !== "New Customer");
    _historyCache = real;
    paintRecentList(list, count, real);
  } catch (err) {
    console.error("[home] getCustomerHistory failed:", err);
    if (!_historyCache) {
      list.innerHTML = '<div class="recent-empty muted small">Couldn\'t load recent customers.</div>';
    }
  }
}

function paintRecentList(list, count, customers) {
  list.innerHTML = "";
  if (customers.length === 0) {
    list.innerHTML = '<div class="recent-empty muted small">No recent customers yet. Tap New Scan to start.</div>';
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = `${customers.length} total`;

  const top = customers.slice(0, 5);
  top.forEach((name) => {
    const row = buildRecentRow(name);
    list.appendChild(row);
    // Wrap it in swipe-to-remove after it's in the DOM
    makeSwipeable(row, {
      actions: [
        {
          label: "Remove",
          style: "destructive",
          onTap: () => handleRemove(name),
        },
      ],
    });
  });
}

function buildRecentRow(name) {
  const row = document.createElement("button");
  row.className = "recent-item";
  row.type = "button";

  const icon = document.createElement("span");
  icon.className = "recent-item-icon";
  icon.textContent = name.charAt(0).toUpperCase();

  const label = document.createElement("span");
  label.className = "recent-item-name";
  label.textContent = name;

  const chev = document.createElement("span");
  chev.className = "recent-item-chev";
  chev.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  row.appendChild(icon);
  row.appendChild(label);
  row.appendChild(chev);

  row.addEventListener("click", () => {
    _session.reset();
    _session.customerName = name;
    _session.isNewCustomer = false;
    _showScreen("camera");
  });

  return row;
}

// ────────────────────────────────────────────────
// Remove customer (swipe action)
// ────────────────────────────────────────────────
// Optimistic: remove from cache + UI immediately so the user sees instant
// feedback, then fire the backend call. If the call fails, restore.
// Show an undo toast that calls unhideCustomer.
async function handleRemove(name) {
  const sp = getCurrentSalesperson();
  if (!sp) return;

  // Optimistic cache update
  const before = _historyCache ? [..._historyCache] : null;
  if (_historyCache) {
    _historyCache = _historyCache.filter((n) => n !== name);
  }
  renderRecentList();

  // Fire backend hide
  try {
    await hideCustomer(sp, name);
  } catch (err) {
    console.error("[home] hideCustomer failed, restoring:", err);
    _historyCache = before;
    renderRecentList();
    showToast(`Couldn't remove ${name} — try again`);
    return;
  }

  // Undo toast
  showToast(`Removed ${name}`, {
    actionLabel: "Undo",
    onAction: async () => {
      try {
        await unhideCustomer(sp, name);
        // Re-fetch to pick up server-side ordering
        _historyCache = null;
        renderRecentList();
      } catch (err) {
        console.error("[home] unhideCustomer failed:", err);
        showToast(`Couldn't restore ${name}`);
      }
    },
  });
}

// Export so customer screen can share the cache without re-fetching.
export function getCachedHistory() {
  return _historyCache;
}

// Allow customer screen to invalidate the cache after its own swipe-remove
export function invalidateHistoryCache() {
  _historyCache = null;
}
