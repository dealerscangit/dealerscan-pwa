// scripts/versionCheck.js
// On boot, pings the backend's getVersion endpoint and compares against
// the version this PWA build expects. If they mismatch, fires an
// errorReporter event so we see it in the backend event log.
//
// Why this exists: earlier this session we lost an hour to a stale
// Apps Script deployment that the PWA was happily calling — there was
// no signal anywhere that the deployed code didn't match what we
// thought was running. Now there is.

import { reportError } from "./errorReporter.js";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec";

// Bump this when the PWA expects a new backend feature. The backend's
// getVersion endpoint should be updated in lockstep with this constant.
// Mismatches are logged but never block the UI — the PWA degrades to
// whatever features the deployed backend supports.
export const EXPECTED_BACKEND_VERSION = "1.14";

// Fire-and-forget. Runs in the background after boot.
export async function checkBackendVersion() {
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set("action", "getVersion");
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      // Don't report — could be intermittent network. We only care about
      // confirmed mismatches.
      return;
    }
    const reported = (await res.text()).trim();
    if (reported !== EXPECTED_BACKEND_VERSION) {
      console.warn(
        `[versionCheck] backend version mismatch: deployed=${reported}, expected=${EXPECTED_BACKEND_VERSION}`
      );
      reportError("backendVersionMismatch", {
        deployed: reported,
        expected: EXPECTED_BACKEND_VERSION,
      });
    } else if (localStorage.getItem("ds.debug") === "1") {
      console.log(`[versionCheck] backend version OK: ${reported}`);
    }
  } catch (err) {
    // Network failure is silent — only deployed-version mismatches matter.
    if (localStorage.getItem("ds.debug") === "1") {
      console.warn("[versionCheck] check failed:", err);
    }
  }
}
