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
console.log("[DealerScan PWA] DEV: long-press the greeting on the home screen to reset sign-in.");

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
// DEV affordance — long-press the greeting to reset sign-in.
// TODO: remove before public launch (or gate behind a debug flag).
// ───────────────────────────────────────────────────────────
function attachDevResetGesture() {
  const greeting = document.getElementById("home-greeting");
  if (!greeting) return;

  const HOLD_MS = 1000;
  let pressTimer = null;

  function startPress() {
    greeting.style.transition = `opacity ${HOLD_MS}ms linear`;
    greeting.style.opacity = "0.35";
    pressTimer = setTimeout(() => {
      clearCurrentSalesperson();
      location.reload();
    }, HOLD_MS);
  }

  function cancelPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    greeting.style.transition = "opacity 0.15s ease";
    greeting.style.opacity = "";
  }

  // Touch (mobile)
  greeting.addEventListener("touchstart", startPress, { passive: true });
  greeting.addEventListener("touchend",   cancelPress);
  greeting.addEventListener("touchcancel",cancelPress);
  greeting.addEventListener("touchmove",  cancelPress);

  // Mouse (desktop dev)
  greeting.addEventListener("mousedown",  startPress);
  greeting.addEventListener("mouseup",    cancelPress);
  greeting.addEventListener("mouseleave", cancelPress);
}

// ───────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  renderSigninPicker();
  renderHomeGreeting();
  attachDevResetGesture();
  showScreen(isSignedIn() ? "home" : "signin");
});
