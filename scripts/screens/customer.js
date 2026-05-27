// scripts/screens/customer.js
// Screen 3: customer picker — text input + history list + inline "+ New" CTA.

import { getCurrentSalesperson } from "../currentUser.js";
import { getCustomerHistory, hideCustomer, unhideCustomer } from "../apiClient.js";
import { getCachedHistory, invalidateHistoryCache } from "./home.js";
import { makeSwipeable, showToast } from "../swipeActions.js";
import { titleCaseName } from "../textCase.js";
import { readSettings } from "./settings.js";
import { reportError } from "../errorReporter.js";

let _showScreen = null;
let _session = null;
let _allCustomers = []; // current snapshot for filtering

export function attachCustomerHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const input = document.getElementById("customer-input");
  const newBtn = document.getElementById("btn-new-customer");
  const echo = document.getElementById("new-customer-name-echo");

  const clearBtn = document.getElementById("customer-input-clear");

  if (input) {
    input.addEventListener("input", () => {
      const q = input.value.trim();
      filterAndPaint(q);
      const matchesExisting = _allCustomers.some(
        (n) => n.toLowerCase() === q.toLowerCase()
      );
      const shouldShow = q.length > 0 && !matchesExisting;
      if (newBtn) newBtn.hidden = !shouldShow;
      // Show the title-cased preview in the "+ Use as new customer" button
      // so the user sees exactly how the name will be stored.
      if (echo) echo.textContent = readSettings().titleCaseEnabled ? titleCaseName(q) : q;
      // Show the clear-X button only when there's text to clear
      if (clearBtn) clearBtn.hidden = q.length === 0;
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!input) return;
      input.value = "";
      clearBtn.hidden = true;
      if (newBtn) newBtn.hidden = true;
      // Trigger paint with empty query, then refocus the input
      filterAndPaint("");
      input.focus();
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", () => {
      const typed = (input?.value || "").trim();
      if (!typed) return;
      // Title-case before sending to backend so folder names are consistent:
      // "smith family" → "Smith Family" matches what the extension creates.
      _session.customerName = readSettings().titleCaseEnabled ? titleCaseName(typed) : typed;
      _session.isNewCustomer = true;
      _showScreen("camera");
    });
  }
}

export async function renderCustomer() {
  const input = document.getElementById("customer-input");
  const newBtn = document.getElementById("btn-new-customer");
  const clearBtn = document.getElementById("customer-input-clear");
  if (input) input.value = "";
  if (newBtn) newBtn.hidden = true;
  if (clearBtn) clearBtn.hidden = true;

  // Use cached history if available; refresh in background
  const cached = getCachedHistory();
  if (cached) {
    _allCustomers = cached;
    paintRecentList(_allCustomers);
  } else {
    paintLoading();
    try {
      const sp = getCurrentSalesperson();
      const all = await getCustomerHistory(sp);
      _allCustomers = all.filter((n) => n && n !== "New Customer");
      paintRecentList(_allCustomers);
    } catch (err) {
      console.error("[customer] getCustomerHistory failed:", err);
      reportError("getHistoryFailed", { error: err });
      paintError();
    }
  }

  // Focus the input shortly after the screen settles (skip on touch to avoid keyboard pop)
  if (input && !("ontouchstart" in window)) {
    setTimeout(() => input.focus(), 100);
  }
}

function filterAndPaint(query) {
  if (!query) {
    paintRecentList(_allCustomers);
    return;
  }
  const q = query.toLowerCase();
  const filtered = _allCustomers.filter((n) => n.toLowerCase().includes(q));
  paintRecentList(filtered);
}

function paintLoading() {
  const list = document.getElementById("customer-recent-list");
  if (list) {
    list.innerHTML = `
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>`;
  }
}
function paintError() {
  const list = document.getElementById("customer-recent-list");
  if (list) list.innerHTML = '<div class="recent-empty muted small">Couldn\'t load customer list.</div>';
}

function paintRecentList(customers) {
  const list = document.getElementById("customer-recent-list");
  if (!list) return;
  list.innerHTML = "";
  if (customers.length === 0) {
    list.innerHTML = '<div class="recent-empty muted small">No matches. Type a new name to create one.</div>';
    return;
  }
  customers.forEach((name) => {
    const row = buildRecentRow(name);
    list.appendChild(row);
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
    _session.customerName = name;
    _session.isNewCustomer = false;
    _showScreen("camera");
  });

  return row;
}

// ────────────────────────────────────────────────
// Remove customer (swipe action) — mirrors home screen behavior
// ────────────────────────────────────────────────
async function handleRemove(name) {
  const sp = getCurrentSalesperson();
  if (!sp) return;

  // Optimistic local update
  const before = [..._allCustomers];
  _allCustomers = _allCustomers.filter((n) => n !== name);
  paintRecentList(_allCustomers);
  // Also invalidate the home cache so it doesn't show the removed customer
  invalidateHistoryCache();

  // Fire backend hide
  try {
    await hideCustomer(sp, name);
  } catch (err) {
    console.error("[customer] hideCustomer failed, restoring:", err);
    reportError("hideCustomerFailed", { customer: name, error: err });
    _allCustomers = before;
    paintRecentList(_allCustomers);
    showToast(`Couldn't remove ${name} — try again`);
    return;
  }

  showToast(`Removed ${name}`, {
    actionLabel: "Undo",
    onAction: async () => {
      try {
        await unhideCustomer(sp, name);
        // Re-fetch to pick up server-side ordering
        try {
          const all = await getCustomerHistory(sp);
          _allCustomers = all.filter((n) => n && n !== "New Customer");
          paintRecentList(_allCustomers);
        } catch (refreshErr) {
          // If re-fetch fails, just put it back at the top locally
          _allCustomers = [name, ..._allCustomers];
          paintRecentList(_allCustomers);
        }
      } catch (err) {
        console.error("[customer] unhideCustomer failed:", err);
        showToast(`Couldn't restore ${name}`);
      }
    },
  });
}
