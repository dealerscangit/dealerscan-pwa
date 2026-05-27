// scripts/apiClient.js
// Thin wrapper around the DealerScan Apps Script Web App endpoints.
// This is the ONLY file that knows about the backend URL or response shapes.

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec";

/**
 * Create (or get existing) customer folder for today.
 * @returns {Promise<string>} Drive folder ID
 */
export async function createCustomerFolder(customerName, salesName, isNew) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "createFolder");
  url.searchParams.set("customerName", customerName);
  url.searchParams.set("salesName", salesName);
  url.searchParams.set("isNew", isNew ? "true" : "false");
  const res = await fetch(url.toString(), { method: "GET" });
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
 * @param {string} filename  - server may override based on Vision API document detection
 */
export async function uploadPhoto(folderId, photoBase64, filename = "scan.jpg") {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "uploadPhoto");
  const res = await fetch(url.toString(), {
    method: "POST",
    // Apps Script doPost is finicky with Content-Type; text/plain avoids CORS preflight
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ folderId, photoData: photoBase64, filename }),
  });
  if (!res.ok) throw new Error(`uploadPhoto HTTP ${res.status}`);
  const txt = (await res.text()).trim();
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
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getRegistry HTTP ${res.status}`);
  return await res.json();
}

export async function updateUser(user) {
  // user shape: { email, name, role, active? }
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "updateUser");
  const formData = new FormData();
  formData.set("payload", JSON.stringify(user));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`updateUser HTTP ${res.status}`);
  return await res.json();
}

export async function deleteUser(email, hard = false) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "deleteUser");
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
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`getTeamOverview HTTP ${res.status}`);
  return await res.json();
}


// ────────── Announcements (manager + dev compose, all read) ──────────

export async function listAnnouncements(salesName, email = "") {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "listAnnouncements");
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
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`createAnnouncement HTTP ${res.status}`);
  return await res.json();
}

export async function deleteAnnouncement(id) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "deleteAnnouncement");
  const formData = new FormData();
  formData.set("payload", JSON.stringify({ id }));
  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) throw new Error(`deleteAnnouncement HTTP ${res.status}`);
  return await res.json();
}
