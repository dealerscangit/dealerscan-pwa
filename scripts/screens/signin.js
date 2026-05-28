// scripts/screens/signin.js
// Sign-In screen: Google Identity Services button + verifyToken flow.
//
// FLOW:
//   1. User opens app → if no token in sessionStorage, this screen renders
//   2. GIS button is rendered into #gis-button-container
//   3. User taps Sign in with Google → Google popup → returns JWT
//   4. JWT is POSTed to backend verifyToken
//   5. Backend validates with Google + looks up email in registry
//   6. On success: persist session, navigate to home
//   7. On failure: show error message + let them retry
//
// LEGACY 19-tile picker is still defined (renderSigninPicker, attached
// via the legacy code path) but no longer the primary flow. Dev can
// access it via "View as" picker post-Sign-In.

import { renderSigninButton } from "../auth/google.js";
import { verifyTokenWithBackend } from "../auth/verify.js";
import { setSession, clearSession } from "../auth/session.js";
import { setCurrentSalesperson, SALESPEOPLE } from "../currentUser.js";

let _showScreen = null;

export function attachSigninHandlers(showScreen) {
  _showScreen = showScreen;
}

/**
 * Render the GIS sign-in button into the sign-in screen.
 * Called when the sign-in screen becomes visible (either initial boot
 * or after a sign-out).
 */
export async function renderSigninGoogle() {
  const container = document.getElementById("gis-button-container");
  const errorEl = document.getElementById("signin-error");
  const statusEl = document.getElementById("signin-status");

  if (!container) {
    console.error("[signin] #gis-button-container not found in DOM");
    return;
  }

  // Reset any prior error from a previous attempt
  if (errorEl) errorEl.hidden = true;
  if (statusEl) statusEl.hidden = true;
  container.innerHTML = "";

  try {
    await renderSigninButton(container, async (jwt) => {
      // User completed Google's popup. Now verify with our backend.
      await handleCredential(jwt);
    });
  } catch (err) {
    console.error("[signin] failed to render GIS button:", err);
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent =
        "Could not load Google Sign-In. Check your network connection and reload.";
    }
  }
}

/**
 * Handle a Google JWT credential — verify with backend, persist session,
 * navigate home. Shows error if backend rejects (not in registry, inactive,
 * etc) and stays on sign-in screen.
 */
async function handleCredential(jwt) {
  const container = document.getElementById("gis-button-container");
  const errorEl = document.getElementById("signin-error");
  const statusEl = document.getElementById("signin-status");

  // Show "verifying..." state — hide the button so user doesn't double-tap
  if (container) container.style.opacity = "0.4";
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = "Verifying…";
  }
  if (errorEl) errorEl.hidden = true;

  try {
    const result = await verifyTokenWithBackend(jwt);

    if (!result.ok) {
      // Backend rejected the token. Show a friendly error and let them retry.
      let msg = "Sign-in failed.";
      if (result.error === "not_in_registry") {
        msg = `${result.email || "This account"} isn't authorized. Contact your admin.`;
      } else if (result.error === "inactive") {
        msg = "Your account has been deactivated. Contact your admin.";
      } else if (result.error === "email_not_verified") {
        msg = "Your Google account email isn't verified.";
      } else if (result.error === "invalid_token") {
        msg = "Sign-in expired. Please try again.";
      }
      throw new Error(msg);
    }

    // Success: persist session + navigate
    setSession(jwt, {
      email: result.email,
      name: result.name,
      role: result.role,
      picture: result.picture,
      tokenExpiresAt: result.tokenExpiresAt,
    });

    // Also write the legacy "current salesperson" key so existing code
    // that reads getCurrentSalesperson() keeps working until we fully
    // migrate to email-based identity everywhere.
    setCurrentSalesperson(result.name);

    if (_showScreen) _showScreen("home");
  } catch (err) {
    console.error("[signin] verification failed:", err);
    clearSession();
    if (container) container.style.opacity = "1";
    if (statusEl) statusEl.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = String(err.message || err);
    }
    // Re-render the button so the user can try again
    await renderSigninGoogle();
  }
}

// ──────────────────────────────────────────────────────────────────
// LEGACY: 19-tile picker (kept for "View as" feature post-Sign-In)
// Dev only — see Settings → View as for the entry point.
// ──────────────────────────────────────────────────────────────────


export function renderSigninPicker() {
  const grid = document.getElementById("picker-grid");
  if (!grid) return;
  grid.innerHTML = "";
  SALESPEOPLE.forEach((name) => {
    const tile = document.createElement("button");
    tile.className = "picker-tile";
    tile.type = "button";
    const initial = document.createElement("span");
    initial.className = "picker-tile-initial";
    initial.textContent = name.charAt(0).toUpperCase();
    const label = document.createElement("span");
    label.className = "picker-tile-name";
    label.textContent = name;
    tile.appendChild(initial);
    tile.appendChild(label);
    tile.addEventListener("click", () => {
      setCurrentSalesperson(name);
      if (_showScreen) _showScreen("home");
    });
    grid.appendChild(tile);
  });
}
