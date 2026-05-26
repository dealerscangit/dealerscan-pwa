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
