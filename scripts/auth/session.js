// scripts/auth/session.js
// Single source of truth for "who is currently signed in" state.
// Wraps sessionStorage so the rest of the app doesn't reach into
// browser APIs directly.
//
// Why sessionStorage and not localStorage:
//   sessionStorage dies on tab close → fresh sign-in on next visit.
//   This is the right default for a tool used on shared dealership
//   iPads where you don't want stale identity sticking around.
//   The user explicitly opts into "remember me" later if we add it.

import {
  TOKEN_KEY, EMAIL_KEY, NAME_KEY, ROLE_KEY, PICTURE_KEY, EXPIRES_AT_KEY,
  VIEW_AS_EMAIL_KEY, VIEW_AS_NAME_KEY,
} from "./config.js";

// ──────────────────────────────────────────────────────────────────
// Session reads
// ──────────────────────────────────────────────────────────────────

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getEmail() {
  return sessionStorage.getItem(EMAIL_KEY);
}

export function getName() {
  return sessionStorage.getItem(NAME_KEY);
}

export function getRole() {
  return sessionStorage.getItem(ROLE_KEY) || "sales";
}

export function getPicture() {
  return sessionStorage.getItem(PICTURE_KEY);
}

export function getExpiresAt() {
  const v = sessionStorage.getItem(EXPIRES_AT_KEY);
  return v ? parseInt(v, 10) : 0;
}

export function isSignedIn() {
  return !!getToken() && !isExpired();
}

export function isExpired() {
  const exp = getExpiresAt();
  if (!exp) return false;  // no expiration set, assume valid
  return Date.now() >= exp;
}

// ──────────────────────────────────────────────────────────────────
// Session writes
// ──────────────────────────────────────────────────────────────────

/**
 * Persist a verified sign-in. Called after verifyToken succeeds.
 * profile shape: { email, name, role, picture, tokenExpiresAt }
 */
export function setSession(token, profile) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EMAIL_KEY, profile.email || "");
  sessionStorage.setItem(NAME_KEY, profile.name || "");
  sessionStorage.setItem(ROLE_KEY, profile.role || "sales");
  if (profile.picture) sessionStorage.setItem(PICTURE_KEY, profile.picture);
  if (profile.tokenExpiresAt) {
    sessionStorage.setItem(EXPIRES_AT_KEY, String(profile.tokenExpiresAt));
  }
}

export function clearSession() {
  [TOKEN_KEY, EMAIL_KEY, NAME_KEY, ROLE_KEY, PICTURE_KEY, EXPIRES_AT_KEY,
   VIEW_AS_EMAIL_KEY, VIEW_AS_NAME_KEY].forEach((k) =>
    sessionStorage.removeItem(k)
  );
}

// ──────────────────────────────────────────────────────────────────
// "View as" override (dev only)
// ──────────────────────────────────────────────────────────────────
// When dev wants to inspect another user's view of the app, they pick
// from a list and we set these override values. Auth token stays the
// dev's; only the data layer impersonates the target.

export function getViewAsEmail() {
  return sessionStorage.getItem(VIEW_AS_EMAIL_KEY);
}

export function getViewAsName() {
  return sessionStorage.getItem(VIEW_AS_NAME_KEY);
}

export function setViewAs(email, name) {
  if (!email) {
    clearViewAs();
    return;
  }
  sessionStorage.setItem(VIEW_AS_EMAIL_KEY, email);
  sessionStorage.setItem(VIEW_AS_NAME_KEY, name || "");
}

export function clearViewAs() {
  sessionStorage.removeItem(VIEW_AS_EMAIL_KEY);
  sessionStorage.removeItem(VIEW_AS_NAME_KEY);
}

export function isViewingAsOther() {
  return !!getViewAsEmail();
}

// ──────────────────────────────────────────────────────────────────
// Identity resolution (what should the rest of the app use?)
// ──────────────────────────────────────────────────────────────────
// If dev is viewing-as someone else, return that identity.
// Otherwise return the signed-in user's identity.
//
// This is what home.js, dashboard.js etc should call when they need
// "whose data do I show?" — NOT getEmail()/getName() directly.

export function getEffectiveEmail() {
  return getViewAsEmail() || getEmail();
}

export function getEffectiveName() {
  return getViewAsName() || getName();
}
