// scripts/errorReporter.js
// Best-effort error reporting to the Apps Script `logEvent` endpoint.
//
// Design constraints:
//   - NEVER blocks the UI. All reports are fire-and-forget.
//   - NEVER throws back. If reporting itself fails, swallow it — we already
//     have the original error; making it worse by failing the report is silly.
//   - Always includes enough context to be useful: timestamp, salesperson,
//     screen, user-agent, and the raw error message + name.
//   - Rate-limits to avoid spamming the sheet if something gets stuck in a
//     retry loop (max 1 report per type per 10 seconds).

import { getCurrentSalesperson } from "./currentUser.js";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec";

const RATE_LIMIT_MS = 10000;
const _recentReports = new Map(); // type → last-sent timestamp

/**
 * Report an error to the backend event log.
 *
 * @param {string} type
 *   One of: "uploadFailed", "createFolderFailed", "getHistoryFailed",
 *   "hideCustomerFailed", "cameraPermissionDenied", "cameraStartFailed",
 *   "unexpectedError"
 * @param {Object} [details]
 *   Extra context. Keys: customer, folderName, error (Error object or string),
 *   and any other useful debugging info.
 */
export function reportError(type, details = {}) {
  try {
    // Rate-limit: skip if same type sent within RATE_LIMIT_MS
    const now = Date.now();
    const last = _recentReports.get(type);
    if (last && now - last < RATE_LIMIT_MS) return;
    _recentReports.set(type, now);

    const errObj = details.error;
    let errorString = "";
    if (errObj) {
      if (typeof errObj === "string") errorString = errObj;
      else if (errObj.message) errorString = errObj.message;
      else if (errObj.toString) errorString = errObj.toString();
    }
    if (errObj && errObj.name) {
      errorString = errObj.name + ": " + errorString;
    }

    const payload = {
      type,
      salesperson: getCurrentSalesperson() || "(unknown)",
      customer: details.customer || "",
      folderName: details.folderName || "",
      error: errorString,
      details: JSON.stringify({
        ...details,
        // Don't double-serialize the Error object; the message is captured above
        error: undefined,
        url: location.pathname + location.search,
        ua: navigator.userAgent,
        viewport: window.innerWidth + "x" + window.innerHeight,
        online: navigator.onLine,
        ts: new Date().toISOString(),
      }),
    };

    // Fire-and-forget POST. Use GET with payload param so we don't trigger
    // a CORS preflight (Apps Script handles GET cleanly).
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set("action", "logEvent");
    url.searchParams.set("payload", JSON.stringify(payload));

    // Use keepalive so the request survives if the user closes/backgrounds
    // the page right after triggering the error.
    fetch(url.toString(), { method: "GET", keepalive: true }).catch(() => {
      // Reporting failure is logged to console only — silent in prod.
      if (localStorage.getItem("ds.debug") === "1") {
        console.warn("[errorReporter] failed to report:", type);
      }
    });
  } catch (innerErr) {
    // Defensive: if anything in this function itself throws, just give up.
    // We must never make the original error worse by failing the report.
    if (localStorage.getItem("ds.debug") === "1") {
      console.warn("[errorReporter] internal failure:", innerErr);
    }
  }
}

// Catch any uncaught errors anywhere in the app and report them
window.addEventListener("error", (e) => {
  reportError("unexpectedError", {
    error: e.error || e.message,
    source: e.filename,
    line: e.lineno,
    col: e.colno,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  reportError("unexpectedError", {
    error: e.reason,
    kind: "unhandledrejection",
  });
});
