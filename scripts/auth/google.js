// scripts/auth/google.js
// Google Identity Services (GIS) wiring.
//
// What GIS does:
//   1. We render a Google button onto a div
//   2. User taps it → Google handles the popup
//   3. We get back an ID token (JWT) via a callback
//   4. We POST that token to our backend verifyToken endpoint
//   5. Backend validates with Google, looks up email in registry,
//      returns user profile or rejects
//
// We DO NOT decode the JWT client-side ourselves. The backend's
// verifyToken is the only authoritative validator. Client just
// carries the token.

import { OAUTH_CLIENT_ID } from "./config.js";

// Lazy-loaded GIS library promise. The actual <script> tag lives in
// index.html with async defer; this promise resolves once google.accounts
// is available.
let _gisReady = null;

function waitForGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve, reject) => {
    // Already loaded?
    if (window.google && window.google.accounts && window.google.accounts.id) {
      resolve(window.google.accounts.id);
      return;
    }
    // Poll for up to 10 seconds — GIS script is async so may not be ready
    // immediately. Polling is the recommended pattern (no load event from GIS).
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        clearInterval(interval);
        resolve(window.google.accounts.id);
      } else if (Date.now() - startTime > 10000) {
        clearInterval(interval);
        reject(new Error("Google Identity Services script failed to load"));
      }
    }, 100);
  });
  return _gisReady;
}

/**
 * Initialize GIS and render the sign-in button into the given container.
 * onCredential receives the raw JWT — caller is responsible for sending
 * it to backend verifyToken.
 *
 * Returns a promise that resolves when the button is rendered.
 */
export async function renderSigninButton(containerEl, onCredential) {
  if (!containerEl) {
    throw new Error("renderSigninButton: container element is required");
  }

  const gisId = await waitForGis();

  gisId.initialize({
    client_id: OAUTH_CLIENT_ID,
    callback: (response) => {
      // response.credential is the JWT ID token
      if (response && response.credential) {
        onCredential(response.credential);
      } else {
        console.error("[gis] no credential in response", response);
      }
    },
    // Don't auto-prompt with One Tap — keep it explicit so the user
    // always sees an intentional sign-in step. We can enable One Tap
    // later if Brandon wants the auto-login UX.
    auto_select: false,
    cancel_on_tap_outside: true,
    // Use FedCM API where available (Chrome). Falls back gracefully.
    use_fedcm_for_prompt: false,
  });

  // Render the button. Theme + size tuned for our dark UI.
  gisId.renderButton(containerEl, {
    type: "standard",
    theme: "filled_blue",        // matches our accent color
    size: "large",
    text: "signin_with",
    shape: "pill",               // matches our CTA shape
    logo_alignment: "left",
    width: 280,
  });
}

/**
 * Programmatic sign-out — revokes the token client-side so subsequent
 * sign-ins force account picker. Useful for "Sign out" buttons that
 * shouldn't auto-relogin the same account.
 */
export async function gisSignOut(email) {
  try {
    const gisId = await waitForGis();
    if (email) gisId.revoke(email, () => {});
    gisId.disableAutoSelect();
  } catch (err) {
    console.warn("[gis] sign-out non-fatal error:", err);
  }
}
