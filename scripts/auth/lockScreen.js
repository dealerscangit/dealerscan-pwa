// scripts/auth/lockScreen.js
// On boot, if we have a persistent session AND a biometric credential,
// gate the app behind a Face ID prompt. Successful unlock → reveal app.
// Failed unlock → clear session + show sign-in.

import {
  isPersistentMode, isSignedIn, clearSession, getName,
} from "./session.js";
import {
  isBiometricSupported, hasBiometricEnrolled, verifyBiometric, biometricLabel,
} from "./biometric.js";

/**
 * Returns true if the app should show the lock screen (biometric prompt)
 * before rendering normal content.
 */
export function needsBiometricUnlock() {
  return (
    isSignedIn() &&
    isPersistentMode() &&
    isBiometricSupported() &&
    hasBiometricEnrolled()
  );
}

/**
 * Show the lock screen overlay and prompt for biometric. Returns a Promise
 * that resolves true on successful unlock, false on failure.
 *
 * On failure we clear the session and the caller should route to sign-in.
 */
export async function showLockScreenAndUnlock() {
  paintLockScreen();
  // Small delay so the lock screen has time to render before iOS shows
  // the Face ID prompt. Without this, the WebAuthn modal fires
  // immediately and the user sees a flash of unstyled content.
  await new Promise((r) => setTimeout(r, 100));

  const success = await verifyBiometric();

  if (success) {
    hideLockScreen();
    return true;
  } else {
    // Failed or cancelled. Clear session and show retry UI.
    paintLockFailure();
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────
// Lock screen UI
// ──────────────────────────────────────────────────────────────────

function paintLockScreen() {
  let overlay = document.getElementById("ds-lock-screen");
  if (overlay) {
    overlay.hidden = false;
    return;
  }
  overlay = document.createElement("div");
  overlay.id = "ds-lock-screen";
  overlay.className = "ds-lock-screen";
  overlay.innerHTML = `
    <div class="ds-lock-content">
      <div class="ds-lock-avatar">${escapeHtml((getName() || "?").charAt(0).toUpperCase())}</div>
      <h1 class="ds-lock-title">Welcome back, ${escapeHtml((getName() || "").split(" ")[0])}</h1>
      <p class="ds-lock-sub" id="ds-lock-sub">Tap below to unlock with ${escapeHtml(biometricLabel())}</p>
      <button class="ds-lock-button" id="ds-lock-button" type="button">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        Unlock
      </button>
      <button class="ds-lock-signout" id="ds-lock-signout" type="button">Use a different account</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("ds-lock-button").onclick = () => retryUnlock();
  document.getElementById("ds-lock-signout").onclick = () => {
    clearSession();
    window.location.reload();
  };
}

function paintLockFailure() {
  const sub = document.getElementById("ds-lock-sub");
  if (sub) {
    sub.textContent = "Authentication failed. Tap Unlock to try again.";
    sub.style.color = "#fda4af";
  }
}

async function retryUnlock() {
  const sub = document.getElementById("ds-lock-sub");
  if (sub) {
    sub.textContent = "Tap below to unlock with " + biometricLabel();
    sub.style.color = "";
  }
  const ok = await verifyBiometric();
  if (ok) {
    hideLockScreen();
    // Trigger a re-render of the current screen — the app boot logic
    // hasn't run yet because we gated it.
    document.dispatchEvent(new CustomEvent("ds:unlocked"));
  } else {
    paintLockFailure();
  }
}

function hideLockScreen() {
  const overlay = document.getElementById("ds-lock-screen");
  if (overlay) {
    overlay.classList.add("ds-lock-screen--exiting");
    setTimeout(() => overlay.remove(), 250);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
