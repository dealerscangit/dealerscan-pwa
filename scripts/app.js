// scripts/app.js
// Main app entry. Imports the API client and the user/identity module.
// Screens, state machine, and camera flow get filled in next.

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

// Expose modules to window for easy console debugging during dev.
// Remove or guard behind a debug flag before public launch.
window.DS = {
  api: { createCustomerFolder, uploadPhoto, getCustomerHistory },
  user: { SALESPEOPLE, getCurrentSalesperson, setCurrentSalesperson, clearCurrentSalesperson, isSignedIn },
};

// Tiny diagnostic to confirm the bundle loaded.
console.log("[DealerScan PWA] booted. Signed in as:", getCurrentSalesperson() || "(none)");

// ───────────────────────────────────────────────────────────
// SCREENS (TODO — pending Shortcut walkthrough integration)
// ───────────────────────────────────────────────────────────
// 1. Sign-in: pick salesperson from SALESPEOPLE (first launch only)
// 2. Home: "New Scan" button + recent activity
// 3. Customer: type or pick from history
// 4. Camera: capture photos with thumbnail strip
// 5. Review: retake / delete / reorder before upload
// 6. Upload: per-photo progress
// 7. Done: success + auto-return to home

// Placeholder screen-switch helper — gets fleshed out when screens land.
function showScreen(id) {
  document.querySelectorAll("[data-screen]").forEach((el) => {
    el.hidden = el.dataset.screen !== id;
  });
}

// Initial route
window.addEventListener("DOMContentLoaded", () => {
  showScreen(isSignedIn() ? "home" : "signin");
});
