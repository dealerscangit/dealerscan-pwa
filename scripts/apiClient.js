// scripts/apiClient.js
// Thin wrapper around the DealerScan Apps Script Web App endpoints.
// This is the ONLY file that knows about the backend URL or response shapes.

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec";

/**
 * Create (or get existing) customer folder for today.
 * Mirrors the Siri Shortcut's first backend call.
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
