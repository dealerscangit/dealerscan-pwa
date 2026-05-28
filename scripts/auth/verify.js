// scripts/auth/verify.js
// Posts the Google ID token to our backend verifyToken endpoint.
// Backend validates with Google, looks up email in registry,
// returns the user's profile or an error reason.

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec";

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
export async function verifyTokenWithBackend(token) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "verifyToken");
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`verifyToken HTTP ${res.status}`);
  }
  return await res.json();
}
