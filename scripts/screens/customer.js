// scripts/screens/customer.js
// Screen 3: customer picker — text input + history list + "+ New" sticky CTA.

import { getCurrentSalesperson } from "../currentUser.js";
import { getCustomerHistory } from "../apiClient.js";
import { getCachedHistory } from "./home.js";

let _showScreen = null;
let _session = null;
let _allCustomers = []; // current snapshot for filtering

export function attachCustomerHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const input = document.getElementById("customer-input");
  const newCta = document.getElementById("new-customer-cta");
  const newBtn = document.getElementById("btn-new-customer");

  if (input) {
    input.addEventListener("input", () => {
      const q = input.value.trim();
      filterAndPaint(q);
      // Show the "+ Use as new customer" CTA only when typed text doesn't
      // match an existing customer (case-insensitive).
      const matchesExisting = _allCustomers.some(
        (n) => n.toLowerCase() === q.toLowerCase()
      );
      if (newCta) newCta.hidden = !(q.length > 0 && !matchesExisting);
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", () => {
      const typed = (input?.value || "").trim();
      if (!typed) return;
      _session.customerName = typed;
      _session.isNewCustomer = true;
      _showScreen("camera");
    });
  }
}

export async function renderCustomer() {
  const input = document.getElementById("customer-input");
  const newCta = document.getElementById("new-customer-cta");
  if (input) input.value = "";
  if (newCta) newCta.hidden = true;

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
      paintError();
    }
  }

  // Focus the input shortly after the screen settles so the user can just
  // start typing if they want to. Skip on touch devices to avoid the
  // keyboard popping up unprompted.
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
  if (list) list.innerHTML = '<div class="recent-empty muted small">Loading…</div>';
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

    list.appendChild(row);
  });
}
