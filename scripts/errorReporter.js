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
import { APPS_SCRIPT_URL } from "./auth/config.js";

const RATE_LIMIT_MS = 10000;
const _recentReports = new Map(); // type → last-sent timestamp

// Strip auth-bearing values out of arbitrary detail objects before they're
// logged to the event sheet. Callers pass freeform `details`, and a stray
// token or a full API URL (with ?token=...) could otherwise land in logs.
// Redacts any key that looks auth-related, and scrubs token query params
// from any string value that looks like a URL.
const _SENSITIVE_KEY = /token|auth|secret|password|jwt|credential/i;
const _TOKEN_PARAM = /([?&](?:token|access_token|id_token|auth)=)[^&#]*/gi;

function _redactSensitive(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (_SENSITIVE_KEY.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string") {
      out[k] = v.replace(_TOKEN_PARAM, "$1[redacted]");
    } else {
      out[k] = v;
    }
  }
  return out;
}

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
        ..._redactSensitive(details),
        // Don't double-serialize the Error object; the message is captured above
        error: undefined,
        // Log the path only — never the query string, which can carry auth
        // tokens or other sensitive params into the event sheet.
        url: location.pathname,
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
// Global handlers are registered once, at the bottom of this module, after
// both reportError and showErrorOverlay are defined — see the single pair
// of addEventListener calls there. (Previously there were two separate
// pairs; merged to avoid double-handling each event.)


// ──────────────────────────────────────────────────────────────────
// VISIBLE ERROR OVERLAY — added 2026-05-27 after multiple silent
// blank-screen bugs (syntax errors in app.js / settings.js / dataCache.js
// that broke the module graph and left a navy void).
//
// When an uncaught error fires, in addition to reporting it, paint a
// visible overlay over the app with:
//   - The error name + message
//   - File + line where it happened (if available)
//   - First 3 lines of stack trace
//   - Reload + Copy buttons
//
// This is shown ONLY for uncaught errors / unhandled rejections that
// happen during boot OR that prevent a screen from rendering. Normal
// runtime errors caught by try/catch dont trigger it.
//
// Auto-toggleable via localStorage flag — set ds.error_overlay = "0"
// to disable if it gets noisy in production. Default: enabled.
// ──────────────────────────────────────────────────────────────────

const ERROR_OVERLAY_ENABLED_DEFAULT = true;
let _overlayShown = false;

function showErrorOverlay(err, source) {
  // Only show once per session — repeated errors get reported but only
  // the first paints. User can reload to see new ones.
  if (_overlayShown) return;
  // Honor opt-out flag
  if (localStorage.getItem("ds.error_overlay") === "0") return;

  _overlayShown = true;

  const errName = (err && err.name) || "Error";
  const errMsg = (err && err.message) || String(err) || "(no message)";
  const stack = (err && err.stack) ? String(err.stack).split("\n").slice(0, 4).join("\n") : "";
  const sourceInfo = source ? `${source.filename || ""}:${source.lineno || ""}:${source.colno || ""}` : "";

  // Build the overlay DOM. Inline styles so it works even if main.css
  // failed to load (which would itself cause a blank screen).
  const overlay = document.createElement("div");
  overlay.id = "ds-error-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(13, 38, 84, 0.97);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    color: #fff;
    overflow-y: auto;
  `;

  const wrap = document.createElement("div");
  wrap.style.cssText = `
    max-width: 480px;
    margin: 0 auto;
    background: rgba(231, 69, 96, 0.12);
    border: 1px solid rgba(231, 69, 96, 0.4);
    border-radius: 16px;
    padding: 20px;
  `;

  const title = document.createElement("h2");
  title.textContent = "Something broke";
  title.style.cssText = "margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #fda4af;";

  const sub = document.createElement("p");
  sub.textContent = "The app hit an error and stopped loading. Details below.";
  sub.style.cssText = "margin: 0 0 16px; font-size: 13px; color: rgba(255,255,255,0.7);";

  const errBox = document.createElement("pre");
  errBox.style.cssText = `
    background: rgba(0,0,0,0.35);
    border-radius: 8px;
    padding: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 11px;
    color: #fcd34d;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 16px;
    max-height: 220px;
    overflow-y: auto;
  `;
  errBox.textContent =
    `${errName}: ${errMsg}` +
    (sourceInfo ? `\nAt: ${sourceInfo}` : "") +
    (stack ? `\n\n${stack}` : "");

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px;";

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = "Reload";
  reloadBtn.style.cssText = `
    flex: 1;
    background: #5a9eff;
    color: #fff;
    border: none;
    border-radius: 99px;
    padding: 12px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  `;
  reloadBtn.onclick = () => location.reload();

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy details";
  copyBtn.style.cssText = `
    flex: 1;
    background: rgba(255,255,255,0.08);
    color: #fff;
    border: 0.5px solid rgba(255,255,255,0.18);
    border-radius: 99px;
    padding: 12px;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  `;
  copyBtn.onclick = () => {
    const text = errBox.textContent + "\nUA: " + navigator.userAgent;
    try {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy details", 1500);
      });
    } catch {
      copyBtn.textContent = "Copy failed";
    }
  };

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.style.cssText = `
    flex: 1;
    background: transparent;
    color: rgba(255,255,255,0.6);
    border: 0.5px solid rgba(255,255,255,0.18);
    border-radius: 99px;
    padding: 12px;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  `;
  dismissBtn.onclick = () => {
    overlay.remove();
    _overlayShown = false;
  };

  btnRow.appendChild(reloadBtn);
  btnRow.appendChild(copyBtn);
  btnRow.appendChild(dismissBtn);

  wrap.appendChild(title);
  wrap.appendChild(sub);
  wrap.appendChild(errBox);
  wrap.appendChild(btnRow);
  overlay.appendChild(wrap);

  // Insert into document — handle case where body isnt ready yet
  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(overlay));
  }
}

// Single global handler per event type: report to the backend AND paint
// the visible overlay. Defined here at the bottom so both reportError and
// showErrorOverlay are in scope.
window.addEventListener("error", (e) => {
  reportError("unexpectedError", {
    error: e.error || e.message,
    source: e.filename,
    line: e.lineno,
    col: e.colno,
  });
  showErrorOverlay(e.error || new Error(e.message || "Unknown error"), {
    filename: e.filename, lineno: e.lineno, colno: e.colno,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  reportError("unexpectedError", {
    error: e.reason,
    kind: "unhandledrejection",
  });
  showErrorOverlay(e.reason || new Error("Unhandled promise rejection"), null);
});
