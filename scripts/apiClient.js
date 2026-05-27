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
  };
}
