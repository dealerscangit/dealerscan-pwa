// scripts/roles.js
// Single source of truth for the current user's role + permissions.
//
// The registry (from backend getRegistry) defines what permissions each
// role has. We cache the registry in memory at boot, then look up the
// current user's role from it.
//
// In TODAY's world (pre-Sign-In), the current user is whoever's picked
// in the 19-tile picker. We match by NAME (since we don't have email
// yet). Once Sign-In ships, we'll match by email instead.

import { getRegistry } from "./apiClient.js";
import { getCurrentSalesperson } from "./currentUser.js";

let _registryCache = null;
let _registryPromise = null;

// Returns the full registry. Cached after first call. Force refresh by
// passing { force: true }.
export async function loadRegistry({ force = false } = {}) {
  if (_registryCache && !force) return _registryCache;
  if (_registryPromise && !force) return _registryPromise;
  _registryPromise = getRegistry()
    .then((reg) => {
      _registryCache = reg;
      _registryPromise = null;
      return reg;
    })
    .catch((err) => {
      _registryPromise = null;
      throw err;
    });
  return _registryPromise;
}

export function invalidateRegistry() {
  _registryCache = null;
  _registryPromise = null;
}

// Find the registry entry for the current user. PRE-SIGN-IN: matches
// by name. POST-SIGN-IN: will match by email instead (TODO).
export async function getCurrentUserRecord() {
  try {
    const reg = await loadRegistry();
    const sp = (getCurrentSalesperson() || "").trim();
    if (!sp) return null;
    return (reg.users || []).find(
      (u) => (u.name || "").trim().toLowerCase() === sp.toLowerCase()
    ) || null;
  } catch (err) {
    console.warn("[roles] getCurrentUserRecord failed:", err);
    return null;
  }
}

export async function getCurrentRole() {
  const rec = await getCurrentUserRecord();
  return rec?.role || "sales";  // default sales (least privilege)
}

// Check whether the current user has a given permission. Reads role from
// the cached registry. Returns false safely on any error.
export async function hasPermission(perm) {
  try {
    const reg = await loadRegistry();
    const rec = await getCurrentUserRecord();
    if (!rec) return false;
    const role = reg.roles?.[rec.role];
    if (!role) return false;
    return (role.permissions || []).includes(perm);
  } catch {
    return false;
  }
}

// Synchronous version using the cache only. Returns false if cache is
// not loaded yet — call after a loadRegistry() awaited at boot.
export function hasPermissionSync(perm) {
  if (!_registryCache) return false;
  const sp = (getCurrentSalesperson() || "").trim();
  const rec = (_registryCache.users || []).find(
    (u) => (u.name || "").trim().toLowerCase() === sp.toLowerCase()
  );
  if (!rec) return false;
  const role = _registryCache.roles?.[rec.role];
  if (!role) return false;
  return (role.permissions || []).includes(perm);
}

// Conveniences
export function isDev()     { return hasPermissionSync("manageUsers"); }
export function isManager() { return hasPermissionSync("viewAllData"); }
