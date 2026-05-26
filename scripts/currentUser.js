// scripts/currentUser.js
// Single source of truth for "who is using the app right now."
//
// v1 (today): salesperson picks their name from a list on first launch;
//             choice is persisted in localStorage.
// v2 (later): Google Sign-In replaces the picker. Same getCurrentSalesperson()
//             call — everything downstream is unchanged.

const STORAGE_KEY = "dealerscan.salesperson";

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
 * Returns the currently-signed-in salesperson name, or null if none chosen.
 */
export function getCurrentSalesperson() {
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
