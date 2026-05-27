// scripts/app.js
// Entry point. Orchestrates screen routing and shared state.

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
import { renderSigninPicker, attachSigninHandlers } from "./screens/signin.js";
import { renderHome, attachHomeHandlers } from "./screens/home.js";
import { renderCustomer, attachCustomerHandlers } from "./screens/customer.js";
import { renderCamera, attachCameraHandlers } from "./screens/camera.js";
import { renderReview, attachReviewHandlers } from "./screens/review.js";
import { renderUpload, attachUploadHandlers } from "./screens/upload.js";
import { renderDone, attachDoneHandlers } from "./screens/done.js";
import "./errorReporter.js"; // side-effect: installs global window error handlers

// ───────────────────────────────────────────────────────────
// Shared session state
// Lives only in memory; cleared on full page reload.
// Persists across screen transitions within a single "scan session."
// ───────────────────────────────────────────────────────────
export const session = {
  // Customer info populated on screen 3, used by 4/5/6/7
  customerName: null,
  isNewCustomer: false,
  folderId: null, // populated lazily after first upload attempt

  // Photos populated by camera (or stub) on screen 4
  // Each entry: { id, dataUrl, filename, status: 'pending'|'active'|'success'|'failed' }
  photos: [],

  reset() {
    this.customerName = null;
    this.isNewCustomer = false;
    this.folderId = null;
    this.photos = [];
  },
};

// Debug helpers — gated behind localStorage.ds.debug flag so they don't
// clutter the global namespace in production. To enable on a phone:
//   1. Open Safari, visit https://dealerscan.live
//   2. Use the share menu → Add to Home Screen (or just stay in Safari)
//   3. In Safari's URL bar enter: javascript:localStorage.setItem('ds.debug','1');location.reload()
//   4. Reload the PWA, then connect Mac Safari → Develop → [iPhone] → console
if (localStorage.getItem("ds.debug") === "1") {
  window.DS = {
    api: { createCustomerFolder, uploadPhoto, getCustomerHistory },
    user: { SALESPEOPLE, getCurrentSalesperson, setCurrentSalesperson, clearCurrentSalesperson, isSignedIn },
    session,
    go: (screen) => showScreen(screen),
  };
  console.log("[DealerScan PWA] booted. Signed in as:", getCurrentSalesperson() || "(none)");
}

// ───────────────────────────────────────────────────────────
// Screen routing
// ───────────────────────────────────────────────────────────
const SCREEN_RENDERERS = {
  signin:   renderSigninPicker,
  home:     renderHome,
  customer: renderCustomer,
  camera:   renderCamera,
  review:   renderReview,
  upload:   renderUpload,
  done:     renderDone,
  settings: () => {},  // stub — full settings screen builds in step 5
};

export function showScreen(id) {
  // If we're navigating AWAY from the camera, ensure its stream is stopped.
  // The camera module owns its own lifecycle but the universal router is the
  // only place that catches every exit path (back button, programmatic, etc).
  const camWasOpen = !document.querySelector('[data-screen="camera"]').hidden;
  if (camWasOpen && id !== "camera") {
    // Dynamic import to avoid a circular dep if camera ever imports app.js.
    import("./screens/camera.js").then((mod) => {
      if (typeof mod._teardown === "function") mod._teardown();
    }).catch(() => {});
  }

  document.querySelectorAll("[data-screen]").forEach((el) => {
    el.hidden = el.dataset.screen !== id;
  });
  // Re-render the screen we're entering so it reflects current state.
  const renderer = SCREEN_RENDERERS[id];
  if (renderer) renderer();
  // Scroll back to top whenever we change screens.
  window.scrollTo(0, 0);
}

// ───────────────────────────────────────────────────────────
// Universal back-button wiring
// Any <button data-back="screenId"> sends us to that screen.
// ───────────────────────────────────────────────────────────
function attachBackButtons() {
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });
}

// ───────────────────────────────────────────────────────────
// DEV: visible Sign out button on the home screen.
// TODO: remove before public launch (see DEV-AFFORDANCES.md)
// ───────────────────────────────────────────────────────────
function attachSignoutButton() {
  const btn = document.getElementById("signout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    clearCurrentSalesperson();
    session.reset();
    location.reload();
  });
}

// ───────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  // One-time wiring (event listeners that don't change between renders)
  attachSigninHandlers(showScreen);
  attachHomeHandlers(showScreen, session);
  attachCustomerHandlers(showScreen, session);
  attachCameraHandlers(showScreen, session);
  attachReviewHandlers(showScreen, session);
  attachUploadHandlers(showScreen, session);
  attachDoneHandlers(showScreen, session);
  attachBackButtons();
  attachSignoutButton();

  // Route to initial screen
  showScreen(isSignedIn() ? "home" : "signin");
});
