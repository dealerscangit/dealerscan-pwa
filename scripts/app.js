// scripts/app.js
// Entry point. Wires up screens, injects the picker grid, handles sign-in.

import {
  createCustomerFolder,
  uploadPhoto,
  getCustomerHistory,
} from "./apiClient.js";
import {
  SALESPEOPLE,
  getCurrentSalesperson,
  setCurrentSalesperson,
  clearCurrentSalesperson,
  isSignedIn,
} from "./currentUser.js";

// Dev debug helper — window.DS.user.clearCurrentSalesperson() also works from console.
window.DS = {
  api: { createCustomerFolder, uploadPhoto, getCustomerHistory },
  user: { SALESPEOPLE, getCurrentSalesperson, setCurrentSalesperson, clearCurrentSalesperson, isSignedIn },
};

console.log("[DealerScan PWA] booted. Signed in as:", getCurrentSalesperson() || "(none)");

// ───────────────────────────────────────────────────────────
// Screen routing
// ───────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll("[data-screen]").forEach((el) => {
    el.hidden = el.dataset.screen !== id;
  });
}

// ───────────────────────────────────────────────────────────
// Sign-in screen — picker tile grid
// ───────────────────────────────────────────────────────────
function renderSigninPicker() {
  const grid = document.getElementById("picker-grid");
  if (!grid) return;
  grid.innerHTML = "";
  SALESPEOPLE.forEach((name) => {
    const tile = document.createElement("button");
    tile.className = "picker-tile";
    tile.type = "button";
    tile.setAttribute("aria-label", `Sign in as ${name}`);

    const initial = document.createElement("span");
    initial.className = "picker-tile-initial";
    initial.textContent = name.charAt(0);

    const label = document.createElement("span");
    label.className = "picker-tile-name";
    label.textContent = name;

    tile.appendChild(initial);
    tile.appendChild(label);
    tile.addEventListener("click", () => handleSignIn(name));
    grid.appendChild(tile);
  });
}

function handleSignIn(name) {
  setCurrentSalesperson(name);
  renderHomeGreeting();
  showScreen("home");
}

// ───────────────────────────────────────────────────────────
// Home screen
// ───────────────────────────────────────────────────────────
function renderHomeGreeting() {
  const el = document.getElementById("home-greeting");
  if (!el) return;
  const sp = getCurrentSalesperson();
  el.textContent = sp ? `Hi, ${sp} 👋` : "Hi 👋";
}

// ───────────────────────────────────────────────────────────
// DEV affordance — visible "Sign out" button on home screen.
// TODO: remove this and the dev-footer in index.html before public launch.
// ───────────────────────────────────────────────────────────
function attachSignoutButton() {
  const btn = document.getElementById("signout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    clearCurrentSalesperson();
    location.reload();
  });
}

// ───────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  renderSigninPicker();
  renderHomeGreeting();
  attachSignoutButton();
  showScreen(isSignedIn() ? "home" : "signin");
});
