// scripts/auth/verify.js
// Posts the Google ID token to our backend verifyToken endpoint.
// Backend validates with Google, looks up email in registry,
// returns the user's profile or an error reason.

import { APPS_SCRIPT_URL } from "./config.js";

/**
 * Send a Google ID token to the backend for verification.
 *
 * Returns a profile object on success:
 *   { ok: true, email, name, role, picture, tokenExpiresAt }
 *
 * On failure:
 *   { ok: false, error: "invalid_token" | "not_in_registry" | "inactive" | ... }
 *
 * Network errors throw — caller catches.
 */
export async function verifyTokenWithBackend(token, { persistent = false } = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "verifyToken");
  url.searchParams.set("token", token);
  // Tell the backend whether this is a "Save login" sign-in so it can
  // issue a 30-day session horizon instead of the JWT's 1-hour expiry.
  if (persistent) url.searchParams.set("persistent", "1");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`verifyToken HTTP ${res.status}`);
  }
  return await res.json();
}
