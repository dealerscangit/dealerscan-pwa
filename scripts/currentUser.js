// scripts/currentUser.js
// Single source of truth for "who is using the app right now."
//
// v1 (today): salesperson picks their name from a list on first launch;
//             choice is persisted in localStorage.
// v2 (later): Google Sign-In replaces the picker. Same getCurrentSalesperson()
//             call — everything downstream is unchanged.

const STORAGE_KEY = "dealerscan.salesperson";

// View-as override (dev only). When a dev is inspecting another user via
// Settings → View as, getViewAsName() returns that name and we surface it
// here so EVERY screen and data fetch keyed off getCurrentSalesperson()
// shows the impersonated user — without changing the dev's real identity
// or auth token. Imported lazily-safe: session.js has no dependency on this
// module, so there's no import cycle.
import { getViewAsName } from "./auth/session.js";

// Team roster — controls who can sign in to the app in v1.
// Anyone NOT in this list cannot use the app.
// Sorted alphabetically for the picker; tweak display names here anytime.
// When we move to Google Sign-In (v2), this list is replaced by the backend
// users data bank — the picker UI goes away entirely.
export const SALESPEOPLE = [
  "Brandon",
  "Bryant",
  "Cheyne",
  "Chris",
  "Eric",
  "Frank",
  "Jake",
  "Kaufee",
  "Keith",
  "Kyle G.",
  "Kyle H.",
  "Maria",
  "Michael",
  "Neil",
  "Rashon",
  "Raymond",
  "Ryan",
  "Will",
  "Yusuf",
];

/**
 * Returns the salesperson name the app should act as right now.
 * If a dev has a "View as" override active, that name wins; otherwise it's
 * the real signed-in salesperson. Returns null if none chosen.
 */
export function getCurrentSalesperson() {
  const viewAs = getViewAsName();
  if (viewAs) return viewAs;
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * The dev's REAL identity, ignoring any view-as override. Use this only
 * where the actual signed-in user matters (e.g. permission checks that must
 * not be spoofed by impersonation, or the view-as banner).
 */
export function getRealSalesperson() {
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Persist the picked salesperson name. No validation here — UI should constrain
 * to the SALESPEOPLE list before calling.
 */
export function setCurrentSalesperson(name) {
  if (!name || typeof name !== "string") {
    throw new Error("setCurrentSalesperson requires a non-empty string");
  }
  localStorage.setItem(STORAGE_KEY, name.trim());
}

/**
 * Clear the stored salesperson (e.g., "sign out" / "switch user" affordance).
 */
export function clearCurrentSalesperson() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Convenience: returns true if we have a salesperson on file.
 */
export function isSignedIn() {
  return !!getCurrentSalesperson();
}
