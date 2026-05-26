// scripts/screens/home.js
// Screen 2: home — greeting + primary "New Scan" card + recent customers.

import { getCurrentSalesperson } from "../currentUser.js";
import { getCustomerHistory } from "../apiClient.js";

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

  // Show cached results immediately if we have them
  if (_historyCache) {
    paintRecentList(list, count, _historyCache);
  } else {
    // First load: show skeleton placeholders (matches the HTML initial state).
    // If we re-render from a prior visit, the skeletons may have been replaced;
    // restore them so the user sees "something is loading" feedback.
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
    // Strip "New Customer" sentinel — that's a UI affordance, not a real customer.
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

  // Show top 5 on home; full list available on customer screen
  const top = customers.slice(0, 5);
  top.forEach((name) => {
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

    list.appendChild(row);
  });
}

// Export so customer screen can share the cache without re-fetching.
export function getCachedHistory() {
  return _historyCache;
}
