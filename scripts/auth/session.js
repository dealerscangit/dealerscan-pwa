// scripts/auth/session.js
// Single source of truth for "who is currently signed in" state.
//
// STORAGE STRATEGY:
//   Default: sessionStorage (per-tab, dies on tab close)
//   Opt-in: localStorage (persists across tab/app close — "Remember me")
//
//   The user opts in during sign-in. We mirror writes to both stores
//   when persistent mode is active, and read from localStorage first
//   on boot (then fall back to sessionStorage).
//
//   Persistent mode is paired with Face ID lock (if available) so the
//   stored token is gated behind biometric unlock on subsequent launches.

import {
  TOKEN_KEY, EMAIL_KEY, NAME_KEY, ROLE_KEY, PICTURE_KEY, EXPIRES_AT_KEY,
  VIEW_AS_EMAIL_KEY, VIEW_AS_NAME_KEY,
} from "./config.js";

const PERSISTENT_FLAG_KEY = "ds.auth.persistent";

// ──────────────────────────────────────────────────────────────────
// Storage adapter: reads localStorage first if persistent, else session
// ──────────────────────────────────────────────────────────────────

function isPersistent() {
  return localStorage.getItem(PERSISTENT_FLAG_KEY) === "1";
}

function readKey(key) {
  // Prefer localStorage when persistent — sessionStorage is empty after
  // tab close so it's the wrong source if user opted in.
  if (isPersistent()) {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  }
  return sessionStorage.getItem(key);
}

function writeKey(key, value) {
  // Always write to sessionStorage for current-tab consistency
  sessionStorage.setItem(key, value);
  // Mirror to localStorage if user opted into persistent
  if (isPersistent()) {
    localStorage.setItem(key, value);
  }
}

function removeKey(key) {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

// ──────────────────────────────────────────────────────────────────
// Session reads
// ──────────────────────────────────────────────────────────────────

export function getToken() { return readKey(TOKEN_KEY); }
export function getEmail() { return readKey(EMAIL_KEY); }
export function getName()  { return readKey(NAME_KEY); }
export function getRole()  { return readKey(ROLE_KEY) || "sales"; }
export function getPicture() { return readKey(PICTURE_KEY); }

export function getExpiresAt() {
  const v = readKey(EXPIRES_AT_KEY);
  return v ? parseInt(v, 10) : 0;
}

export function isSignedIn() {
  return !!getToken() && !isExpired();
}

export function isExpired() {
  const exp = getExpiresAt();
  if (!exp) return false;
  return Date.now() >= exp;
}

// ──────────────────────────────────────────────────────────────────
// Session writes
// ──────────────────────────────────────────────────────────────────

/**
 * Persist a verified sign-in. The persistent flag should be set BEFORE
 * calling this if the user opted in, so the writes go to both stores.
 */
export function setSession(token, profile, { persistent = false } = {}) {
  // Set the persistence flag FIRST so writeKey mirrors to localStorage
  if (persistent) {
    localStorage.setItem(PERSISTENT_FLAG_KEY, "1");
  } else {
    localStorage.removeItem(PERSISTENT_FLAG_KEY);
  }

  writeKey(TOKEN_KEY, token);
  writeKey(EMAIL_KEY, profile.email || "");
  writeKey(NAME_KEY, profile.name || "");
  writeKey(ROLE_KEY, profile.role || "sales");
  if (profile.picture) writeKey(PICTURE_KEY, profile.picture);
  if (profile.tokenExpiresAt) {
    writeKey(EXPIRES_AT_KEY, String(profile.tokenExpiresAt));
  }
}

export function clearSession() {
  [TOKEN_KEY, EMAIL_KEY, NAME_KEY, ROLE_KEY, PICTURE_KEY, EXPIRES_AT_KEY,
   VIEW_AS_EMAIL_KEY, VIEW_AS_NAME_KEY].forEach(removeKey);
  localStorage.removeItem(PERSISTENT_FLAG_KEY);

  // Also clear legacy localStorage keys so the next sign-in doesn't
  // inherit stale identity. These are the bridges to pre-Sign-In code
  // that reads getCurrentSalesperson() directly from localStorage.
  localStorage.removeItem("ds.salesperson");
  sessionStorage.removeItem("ds.original_sp");
  sessionStorage.removeItem("ds.dev_session");
}

export function isPersistentMode() {
  return isPersistent();
}

// ──────────────────────────────────────────────────────────────────
// "View as" override (dev only)
// ──────────────────────────────────────────────────────────────────

export function getViewAsEmail() { return sessionStorage.getItem(VIEW_AS_EMAIL_KEY); }
export function getViewAsName()  { return sessionStorage.getItem(VIEW_AS_NAME_KEY); }

export function setViewAs(email, name) {
  if (!email) { clearViewAs(); return; }
  sessionStorage.setItem(VIEW_AS_EMAIL_KEY, email);
  sessionStorage.setItem(VIEW_AS_NAME_KEY, name || "");
}

export function clearViewAs() {
  sessionStorage.removeItem(VIEW_AS_EMAIL_KEY);
  sessionStorage.removeItem(VIEW_AS_NAME_KEY);
}

export function isViewingAsOther() { return !!getViewAsEmail(); }

// ──────────────────────────────────────────────────────────────────
// Identity resolution
// ──────────────────────────────────────────────────────────────────

export function getEffectiveEmail() { return getViewAsEmail() || getEmail(); }
export function getEffectiveName()  { return getViewAsName() || getName(); }
