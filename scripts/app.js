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
import { attachQuickMenuHandlers } from "./screens/quickMenu.js";
import { renderDashboard, attachDashboardHandlers } from "./screens/dashboard.js";
import { renderDevPanel, attachDevPanelHandlers } from "./screens/devPanel.js";
import { loadRegistry } from "./roles.js";
import {
  renderSettings,
  attachSettingsHandlers,
  applySettingsOnBoot,
} from "./screens/settings.js";
import "./errorReporter.js"; // side-effect: installs global window error handlers
import { checkBackendVersion } from "./versionCheck.js";
import { processQueue, count as queueCount } from "./offlineQueue.js";
import { getHomeOverview } from "./apiClient.js";
import { getOrFetch } from "./dataCache.js";
import { getCurrentSalesperson } from "./currentUser.js";

// Apply saved accent + behavior settings before any screen renders so the
// initial paint uses the user's chosen accent color (no flash of default blue).
applySettingsOnBoot();

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

// Parallel prefetch — kick off all the slow API calls AT ONCE rather
// than letting each screen wait for its own. By the time the user lands
// on home or opens the dev panel, the data is already in the cache.
//
// Apps Script has a ~1.5s cold-start floor per request, so running 3
// requests in parallel saves ~3s of total wait time vs sequential.
setTimeout(() => {
  const sp = getCurrentSalesperson();
  // All three fire simultaneously; we don't await them. Each populates
  // its own cache so screens can paint instantly when navigated to.
  if (sp) {
    getOrFetch(`homeOverview:${sp}`, () => getHomeOverview(sp))
      .catch((err) => console.warn("[app] home prefetch failed:", err));
  }
  loadRegistry().catch((err) => console.warn("[app] loadRegistry failed:", err));
  checkBackendVersion();
}, 100);

// Process the offline queue on boot (delayed so it doesn't compete with
// first-paint) and again whenever the network comes back online. The
// queue is a no-op when empty so this is cheap.
async function drainQueue() {
  try {
    const c = await queueCount();
    if (c === 0) return;
    console.log(`[app] draining offline queue: ${c} items`);

    // While draining, update the status strip label to show progress.
    // The label format is "Syncing N of M" where N is the in-flight item.
    let processed = 0;
    const total = c;
    const result = await processQueue((progress) => {
      // onProgress fires for each item's stages: starting, uploading, done.
      // We only update the label on "starting" so the count is the
      // index of the item currently in flight.
      if (progress.stage === "starting") {
        processed++;
        const label = document.getElementById("status-label");
        if (label) label.textContent = `Syncing ${processed} of ${total}`;
      }
    });

    console.log("[app] queue drain result:", result);

    // If we successfully uploaded any, refresh the home overview so the
    // counts and timeline reflect what just synced.
    if (result.uploaded > 0) {
      const { renderHome } = await import("./screens/home.js");
      if (typeof renderHome === "function") renderHome();
      // Also show a toast so user sees the drain success
      const { showToast } = await import("./swipeActions.js");
      if (typeof showToast === "function") {
        const word = result.uploaded === 1 ? "scan" : "scans";
        showToast(`Synced ${result.uploaded} ${word}`);
      }
    }
  } catch (err) {
    console.warn("[app] queue drain failed:", err);
  }
}
// Initial drain after boot settle
setTimeout(drainQueue, 2500);
// Drain on reconnect — fires when offline -> online
window.addEventListener("online", () => {
  console.log("[app] back online — draining queue");
  drainQueue();
});

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
  dashboard: renderDashboard,
  "dev-panel": renderDevPanel,
  settings: renderSettings,
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
  attachSettingsHandlers(showScreen, session);
  attachQuickMenuHandlers(showScreen, session);
  attachDashboardHandlers(showScreen, session);
  attachDevPanelHandlers(showScreen, session);
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
