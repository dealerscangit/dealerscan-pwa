// scripts/apiClient.js
// Thin wrapper around the DealerScan Apps Script Web App endpoints.
// This is the ONLY file that knows about the backend response shapes.
// The backend URL itself lives in auth/config.js (single source of truth).

import { APPS_SCRIPT_URL } from "./auth/config.js";
import {
  getToken, getViewAsEmail,
} from "./auth/session.js";

// Internal helper: attach auth token + view-as email to a URL.
// Every endpoint calls this so all requests are consistently authenticated.
//
// What gets attached:
//   - token: the Google ID JWT from sessionStorage. Backend's verifyToken
//     gate validates it. If missing, backend returns 401 / auth error.
//   - viewAsEmail: only set when dev is impersonating another user via the
//     "View as" picker. Backend honors this only if the verified token's
//     user is dev; ignored otherwise (security: non-dev can't spoof).
function _attachAuth(url) {
  const token = getToken();
  if (token) url.searchParams.set("token", token);
  const viewAs = getViewAsEmail();
  if (viewAs) url.searchParams.set("viewAsEmail", viewAs);
  return url;
}

// Time limits so a stuck request fails and gets retried instead of hanging
// forever. Uploads get longer: the backend may briefly wait its turn when
// several photos land at once.
const UPLOAD_TIMEOUT_MS = 60000;
const FOLDER_TIMEOUT_MS = 30000;

async function fetchWithTimeout(resource, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}



/**
 * Create (or get existing) customer folder for today.
 * @returns {Promise<string>} Drive folder ID
 */
export async function createCustomerFolder(customerName, salesName, isNew) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "createFolder");
  _attachAuth(url);
  url.searchParams.set("customerName", customerName);
  url.searchParams.set("salesName", salesName);
  url.searchParams.set("isNew", isNew ? "true" : "false");
  const res = await fetchWithTimeout(url.toString(), { method: "GET" }, FOLDER_TIMEOUT_MS);
  if (!res.ok) throw new Error(`createFolder HTTP ${res.status}`);
  const folderId = (await res.text()).trim();
  if (!folderId || folderId.startsWith("ERROR")) {
    throw new Error(`createFolder backend error: ${folderId}`);
  }
  return folderId;
}

/**
 * Upload one photo to the folder.
 * @param {string} folderId  - from createCustomerFolder
 * @param {string} photoBase64 - base64 WITHOUT data: prefix (backend strips either way)
 * @param {string} filename  - informational; backend names files "Doc N.jpg"
 * @param {object} [opts]
 * @param {string} [opts.uploadId] - unique per photo; backend ignores re-sends
 * @param {boolean} [opts.retry]   - true when re-sending from the queue
 */
// The backend answers "OK" only after the photo is saved in Drive, so a
// resolved call means the photo is really there.
// opts.onProgress(fraction 0..1) reports how much of the photo has been sent;
// when given, the upload uses XHR (fetch can't report upload progress).
export async function uploadPhoto(folderId, photoBase64, filename = "scan.jpg", opts = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "uploadPhoto");
  _attachAuth(url);
  const body = JSON.stringify({
    folderId,
    photoData: photoBase64,
    filename,
    uploadId: opts.uploadId || "",
    retry: !!opts.retry,
  });

  let txt;
  if (typeof opts.onProgress === "function" && typeof XMLHttpRequest !== "undefined") {
    txt = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url.toString());
      // Apps Script doPost is finicky with Content-Type; text/plain avoids CORS preflight
      xhr.setRequestHeader("Content-Type", "text/plain;charset=utf-8");
      xhr.timeout = UPLOAD_TIMEOUT_MS;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          try { opts.onProgress(Math.min(1, e.loaded / e.total)); } catch {}
        }
      };
      xhr.upload.onload = () => { try { opts.onProgress(1); } catch {} };
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`uploadPhoto HTTP ${xhr.status}`));
        } else {
          resolve(String(xhr.responseText || "").trim());
        }
      };
      xhr.onerror = () => reject(new Error("uploadPhoto network error"));
      xhr.ontimeout = () => reject(new Error("uploadPhoto timed out"));
      xhr.onabort = () => reject(new Error("uploadPhoto aborted"));
      xhr.send(body);
    });
  } else {
    const res = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    }, UPLOAD_TIMEOUT_MS);
    if (!res.ok) throw new Error(`uploadPhoto HTTP ${res.status}`);
    txt = (await res.text()).trim();
  }
  if (!txt.startsWith("OK")) throw new Error(`uploadPhoto backend: ${txt}`);
  return txt;
}

/**
 * Customer history list (most-recent-first) for autocomplete.
 * Returns array of customer name strings. First entry will be "New Customer".
 */
export async function getCustomerHistory(salesName) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getHistory");
  _attachAuth(url);
  url.searchParams.set("salesName", salesName);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getHistory HTTP ${res.status}`);
  const txt = (await res.text()).trim();
  return txt.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Remove a customer from a salesperson's history list.
 * Server-side: rewrites the salesperson's row in CustomerHistory with the
 * customer filtered out. Drive folders and scan logs are NOT touched.
 * Idempotent: removing a customer that isn't there is a successful no-op.
 *
 * Requires the Apps Script deployment to include the `hideCustomer` action.
 * If the action isn't deployed yet, this call fails with a non-OK response —
 * caller should treat that gracefully (UI can still optimistically hide).
 */
export async function hideCustomer(salesName, customerName) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "hideCustomer");
  _attachAuth(url);
  url.searchParams.set("salesName", salesName);
  url.searchParams.set("customerName", customerName);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`hideCustomer HTTP ${res.status}`);
  const txt = (await res.text()).trim();
  if (!txt.startsWith("OK")) throw new Error(`hideCustomer backend: ${txt}`);
  return txt;
}

/**
 * Re-add a customer to the front of a salesperson's history list.
 * Used by the undo-toast after swipe-remove. Server-side reuses
 * saveToHistory() which de-dupes and bumps-to-front.
 */
export async function unhideCustomer(salesName, customerName) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "unhideCustomer");
  _attachAuth(url);
  url.searchParams.set("salesName", salesName);
  url.searchParams.set("customerName", customerName);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`unhideCustomer HTTP ${res.status}`);
  const txt = (await res.text()).trim();
  if (!txt.startsWith("OK")) throw new Error(`unhideCustomer backend: ${txt}`);
  return txt;
}


/**
 * Get all data needed by the redesigned PWA home screen.
 *
 * Tries the new single-round-trip getHomeOverview endpoint first.
 * If the backend hasn't been redeployed yet (returns "Unknown action"
 * as plain text instead of JSON), falls back to getHistory and
 * synthesizes the structure with whatever data is available.
 *
 * Returns { today, week, total, timeline: [{ customer, timestamp, photoCount, folderId }, ...] }.
 */
export async function getHomeOverview(salesName) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getHomeOverview");
  _attachAuth(url);
  url.searchParams.set("salesName", salesName);
  try {
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`getHomeOverview HTTP ${res.status}`);
    const text = await res.text();
    // The backend either returns JSON (new endpoint) or "Unknown action"
    // text (stale deployment). Detect and fall back accordingly.
    if (text.trim().startsWith("Unknown")) {
      return await fallbackHomeOverview(salesName);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response — backend is stale, fall back gracefully.
      return await fallbackHomeOverview(salesName);
    }
    if (data.error) throw new Error(`getHomeOverview: ${data.error}`);
    return {
      today: data.today || 0,
      week: data.week || 0,
      total: data.total || 0,
      timeline: Array.isArray(data.timeline) ? data.timeline : [],
      // Dashboard fields — only present when backend is >= 1.2. Defaults
      // are safe zeros / nulls so the dashboard renders an empty state
      // gracefully when the backend is stale.
      dailyCounts: Array.isArray(data.dailyCounts) ? data.dailyCounts : [0,0,0,0,0,0,0],
      weekTotalPhotos: data.weekTotalPhotos || 0,
      peakHour: typeof data.peakHour === "number" ? data.peakHour : null,
      topCustomers: Array.isArray(data.topCustomers) ? data.topCustomers : [],
    };
  } catch (err) {
    // If anything threw (network, parse, etc.), try the fallback as a last
    // resort before giving up. Better stale data than no data.
    try {
      return await fallbackHomeOverview(salesName);
    } catch {
      throw err;
    }
  }
}

/**
 * Fallback: synthesize a home-overview-shaped object using only the legacy
 * getHistory endpoint, which is guaranteed to exist on every deployed
 * version of the backend. Counts are approximate (we get a list of recent
 * customer NAMES but not timestamps), so today/week/total all equal the
 * count of returned names. Timeline timestamps are stamped as "now" since
 * we have no real ones. This is a degraded experience but better than blank.
 */
async function fallbackHomeOverview(salesName) {
  const names = await getCustomerHistory(salesName);
  const real = names.filter((n) => n && n !== "New Customer");
  const now = new Date().toISOString();
  const timeline = real.slice(0, 5).map((customer) => ({
    customer,
    timestamp: now,
    photoCount: 0,
    folderId: "",
  }));
  return {
    today: real.length,
    week: real.length,
    total: real.length,
    timeline,
    dailyCounts: [0,0,0,0,0,0,0],
    weekTotalPhotos: 0,
    peakHour: null,
    topCustomers: [],
  };
}


// ────────── User registry (dev panel) ──────────
// All three of these need to be gated by role=dev once Sign-In + role
// enforcement ships. Today they're callable by anyone with the URL.

export async function getRegistry() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getRegistry");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getRegistry HTTP ${res.status}`);
  return await res.json();
}

// ────────── Dev panel: Drive browser ──────────
// Read-only listing + recoverable mutations on customer folders/files.
// emptyDriveTrash is permanent and is gated client-side by type-to-confirm.

// Top-level customer folders (name, created, fileCount).
export async function listDriveFolders() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getFolders");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getFolders HTTP ${res.status}`);
  return await res.json(); // { folders: [{id,name,created,fileCount}] }
}

// Files within one folder, with metadata.
export async function listFolderFiles(folderId) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "listFolderFiles");
  _attachAuth(url);
  url.searchParams.set("folderId", folderId);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`listFolderFiles HTTP ${res.status}`);
  return await res.json(); // { success, folderName, files: [...] }
}

// Viewable content for a single file (text string or base64 image).
export async function readFileContent(fileId) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "readFileContent");
  _attachAuth(url);
  url.searchParams.set("fileId", fileId);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`readFileContent HTTP ${res.status}`);
  return await res.json(); // { success, kind, mimeType, size, content?|base64? }
}

// Recoverable delete (Drive trash, ~30 days).
export async function trashFile(fileId) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "trashFile");
  _attachAuth(url);
  url.searchParams.set("fileId", fileId);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`trashFile HTTP ${res.status}`);
  return await res.json(); // { success, id, name, trashed }
}

// Archive one folder (reversible move to Archive folder).
export async function archiveFolder(folderId) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "archiveFolder");
  _attachAuth(url);
  url.searchParams.set("folderId", folderId);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`archiveFolder HTTP ${res.status}`);
  return await res.json(); // { success }
}

// PERMANENT: empty Drive trash. Caller MUST pass confirm="EMPTY"; the
// backend rejects the call otherwise. Never call without an explicit
// type-to-confirm gate in the UI.
export async function emptyDriveTrash(confirm) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "emptyDriveTrash");
  _attachAuth(url);
  url.searchParams.set("confirm", confirm || "");
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`emptyDriveTrash HTTP ${res.status}`);
  return await res.json(); // { success, emptied } | { success:false, error }
}

// ────────── Dev panel: dashboard / logs ──────────
export async function getOverview() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getOverview");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getOverview HTTP ${res.status}`);
  return await res.json();
}

export async function getEventLog() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getEventLog");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getEventLog HTTP ${res.status}`);
  return await res.json(); // { events: [...] }
}

export async function getScanLog() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getScanLog");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getScanLog HTTP ${res.status}`);
  return await res.json(); // { entries: [...] }
}

// System config read/write (dev panel Config tab).
export async function getConfig() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getConfig");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getConfig HTTP ${res.status}`);
  return await res.json();
}

// Save config. Posts via FormData so the body populates e.parameter on the
// backend (saveDashConfigPost reads e.postData.contents). configObj is the
// full config object; caller validates JSON before calling.
export async function saveConfig(configObj) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "saveConfig");
  _attachAuth(url);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ config: configObj }),
  });
  if (!res.ok) throw new Error(`saveConfig HTTP ${res.status}`);
  return await res.json(); // { success } | { error }
}

// ────────── Dev panel: generic system JSON file editor ──────────
// List JSON files in the system folder (name, size, editable flag).
export async function listSystemFiles() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "listSystemFiles");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`listSystemFiles HTTP ${res.status}`);
  return await res.json(); // { success, files: [{name,size,updated,editable}] }
}

// Read one system JSON file by name → parsed content + editability.
export async function readSystemFile(name) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "readSystemFile");
  _attachAuth(url);
  url.searchParams.set("name", name);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`readSystemFile HTTP ${res.status}`);
  return await res.json(); // { success, name, json, editable }
}

// Write one system JSON file by name. Backend rejects view-only files and
// invalid JSON. contentObj must be a serializable object/array.
export async function writeSystemFile(name, contentObj) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "writeSystemFile");
  _attachAuth(url);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ name, content: contentObj }),
  });
  if (!res.ok) throw new Error(`writeSystemFile HTTP ${res.status}`);
  return await res.json(); // { success, name } | { success:false, error }
}

export async function updateUser(user) {
  // user shape: { email, name, role, active? }
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "updateUser");
  _attachAuth(url);
  const formData = new FormData();
  formData.set("payload", JSON.stringify(user));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`updateUser HTTP ${res.status}`);
  return await res.json();
}

export async function deleteUser(email, hard = false) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "deleteUser");
  _attachAuth(url);
  const formData = new FormData();
  formData.set("payload", JSON.stringify({ email, hard }));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`deleteUser HTTP ${res.status}`);
  return await res.json();
}

// ────────── Team overview (manager + dev) ──────────
// Aggregates ScanLog across all salespeople. Returns todayBySalesperson,
// recentScans, inactiveToday, teamTotalToday, teamTotalWeek,
// searchableCustomers. See backend Code.gs getTeamOverview for the
// full response shape.
export async function getTeamOverview() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getTeamOverview");
  _attachAuth(url);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getTeamOverview HTTP ${res.status}`);
  return await res.json();
}


// ────────── Announcements (manager + dev compose, all read) ──────────

export async function listAnnouncements(salesName, email = "") {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "listAnnouncements");
  _attachAuth(url);
  if (salesName) url.searchParams.set("salesName", salesName);
  if (email) url.searchParams.set("email", email);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`listAnnouncements HTTP ${res.status}`);
  return await res.json();
}

export async function createAnnouncement(payload) {
  // payload: { body, audience: { type, emails?, names? }, ttlHours?, createdBy, createdByName }
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "createAnnouncement");
  _attachAuth(url);
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`createAnnouncement HTTP ${res.status}`);
  return await res.json();
}

export async function deleteAnnouncement(id) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "deleteAnnouncement");
  _attachAuth(url);
  const formData = new FormData();
  formData.set("payload", JSON.stringify({ id }));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`deleteAnnouncement HTTP ${res.status}`);
  return await res.json();
}
