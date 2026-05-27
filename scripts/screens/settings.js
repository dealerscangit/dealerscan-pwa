// scripts/screens/settings.js
// Settings screen wiring: accent color picker, behavior toggles, account info.
// State persists in localStorage so it survives reloads. Defaults are applied
// at boot in scripts/settings/applyOnBoot.js so the UI matches the saved state
// before the first paint.

import { getCurrentSalesperson, clearCurrentSalesperson } from "../currentUser.js";
import { EXPECTED_BACKEND_VERSION } from "../versionCheck.js";
import { count as queueCount, processQueue, getAll as getQueueAll } from "../offlineQueue.js";

const STORAGE_KEY = "ds.settings.v1";

// Detect whether the platform supports navigator.vibrate. iOS Safari
// (including PWA standalone mode) does NOT support it — Apple removed
// the Vibration API from WebKit. So the toggle is hidden on iOS to
// avoid the appearance of a broken control.
function isHapticSupported() {
  if (typeof navigator.vibrate !== "function") return false;
  // iOS Safari has navigator.vibrate defined-but-no-op. The only reliable
  // way to detect iOS is the user agent + platform combo.
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !isIOS;
}

// Default settings shape. New keys can be added without breaking existing
// users because readSettings() merges with these defaults on every load.
export const DEFAULT_SETTINGS = {
  accent: "blue",
  hapticsEnabled: true,
  nudgeEnabled: true,
  titleCaseEnabled: true,
};

// Accent color definitions — each ramp is the same shape so apply() can
// pump the values into CSS variables generically.
const ACCENT_RAMPS = {
  blue: {
    grad: "linear-gradient(135deg, #4285f4, #2b6ed4)",
    base: "#4285f4",
    soft: "#6ca0f7",
    deep: "#2b6ed4",
    glow: "rgba(66, 133, 244, 0.5)",
  },
  purple: {
    grad: "linear-gradient(135deg, #a78bfa, #7c3aed)",
    base: "#8b5cf6",
    soft: "#a78bfa",
    deep: "#6d28d9",
    glow: "rgba(139, 92, 246, 0.5)",
  },
  teal: {
    grad: "linear-gradient(135deg, #5eead4, #14b8a6)",
    base: "#14b8a6",
    soft: "#5eead4",
    deep: "#0d9488",
    glow: "rgba(20, 184, 166, 0.5)",
  },
  amber: {
    grad: "linear-gradient(135deg, #fbbf24, #d97706)",
    base: "#f59e0b",
    soft: "#fbbf24",
    deep: "#b45309",
    glow: "rgba(245, 158, 11, 0.5)",
  },
  rose: {
    grad: "linear-gradient(135deg, #fb7185, #e11d48)",
    base: "#f43f5e",
    soft: "#fb7185",
    deep: "#be123c",
    glow: "rgba(244, 63, 94, 0.5)",
  },
};

// ──────────────────────────────────────────────────────────────────
// Read / write settings
// ──────────────────────────────────────────────────────────────────
export function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[settings] write failed:", err);
  }
}

// ──────────────────────────────────────────────────────────────────
// Apply settings to the DOM (CSS variables, toggle states)
// ──────────────────────────────────────────────────────────────────
export function applyAccent(accent) {
  const ramp = ACCENT_RAMPS[accent] || ACCENT_RAMPS.blue;
  const root = document.documentElement.style;
  root.setProperty("--accent-grad", ramp.grad);
  root.setProperty("--accent", ramp.base);
  root.setProperty("--accent-soft", ramp.soft);
  root.setProperty("--accent-deep", ramp.deep);
  root.setProperty(
    "--shadow-glow-accent",
    `0 8px 24px ${ramp.glow}, 0 1px 2px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.22)`
  );
}

export function applySettingsOnBoot() {
  const s = readSettings();
  applyAccent(s.accent);
}

// ──────────────────────────────────────────────────────────────────
// Screen lifecycle
// ──────────────────────────────────────────────────────────────────
let _showScreen = null;
let _session = null;

export function attachSettingsHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;
}

export function renderSettings() {
  const s = readSettings();

  // Accent swatches
  document.querySelectorAll(".accent-swatch").forEach((btn) => {
    const isSelected = btn.dataset.accent === s.accent;
    btn.classList.toggle("selected", isSelected);
    btn.onclick = () => {
      const next = { ...readSettings(), accent: btn.dataset.accent };
      writeSettings(next);
      applyAccent(next.accent);
      // Refresh swatch selection state
      document.querySelectorAll(".accent-swatch").forEach((b) => {
        b.classList.toggle("selected", b.dataset.accent === next.accent);
      });
    };
  });

  // Hide the haptic toggle row if the platform can't actually vibrate.
  // iOS Safari has no vibration support, so showing the toggle there
  // would imply functionality we can't deliver.
  const hapticRow = document.getElementById("toggle-haptics")?.closest(".settings-row");
  if (hapticRow && !isHapticSupported()) {
    hapticRow.hidden = true;
  }

  // Toggle wiring
  bindToggle("toggle-haptics", "hapticsEnabled");
  bindToggle("toggle-nudge", "nudgeEnabled");
  bindToggle("toggle-titlecase", "titleCaseEnabled");

  // Account info
  const currentUser = document.getElementById("settings-current-user");
  if (currentUser) currentUser.textContent = getCurrentSalesperson() || "(not signed in)";

  // Switch user wiring
  const switchBtn = document.getElementById("settings-switch-user");
  if (switchBtn) {
    switchBtn.onclick = () => {
      clearCurrentSalesperson();
      _showScreen("signin");
    };
  }

  // Health diagnostics
  paintHealth();

  // About / version info
  const backendV = document.getElementById("settings-backend-version");
  if (backendV) {
    backendV.textContent = `expected ${EXPECTED_BACKEND_VERSION}`;
    // Real-time backend check
    pingBackendVersion().then((reported) => {
      if (reported) {
        const matches = reported === EXPECTED_BACKEND_VERSION;
        if (matches) {
          backendV.textContent = `deployed ${reported} ✓`;
          backendV.style.color = "var(--success)";
        } else {
          backendV.innerHTML = `<strong>Redeploy needed</strong> &middot; deployed ${reported}, expected ${EXPECTED_BACKEND_VERSION}`;
          backendV.style.color = "var(--danger)";
        }
      } else {
        backendV.textContent = "unable to check";
      }
    });
  }
}

function bindToggle(toggleId, settingsKey) {
  const input = document.getElementById(toggleId);
  if (!input) return;
  const s = readSettings();
  input.checked = !!s[settingsKey];
  input.onchange = () => {
    const next = { ...readSettings(), [settingsKey]: input.checked };
    writeSettings(next);
  };
}

async function pingBackendVersion() {
  try {
    const url =
      "https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec?action=getVersion";
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}


// ──────────────────────────────────────────────────────────────────
// Health diagnostics
// ──────────────────────────────────────────────────────────────────
async function paintHealth() {
  // Connection
  const conn = document.getElementById("health-connection");
  if (conn) {
    if (navigator.onLine) {
      conn.textContent = "Online";
      conn.style.color = "var(--success)";
    } else {
      conn.textContent = "Offline — scans will queue";
      conn.style.color = "var(--warning, #fbbf24)";
    }
  }

  // Offline queue
  const queueEl = document.getElementById("health-queue");
  const drainBtn = document.getElementById("health-drain-btn");
  let queued = 0;
  try { queued = await queueCount(); } catch {}
  if (queueEl) {
    if (queued === 0) {
      queueEl.textContent = "Empty";
      queueEl.style.color = "";
    } else {
      const items = await getQueueAll().catch(() => []);
      const customers = items.map((i) => i.customerName).slice(0, 3).join(", ");
      const more = items.length > 3 ? ` +${items.length - 3} more` : "";
      queueEl.textContent = `${queued} pending: ${customers}${more}`;
      queueEl.style.color = "var(--warning, #fbbf24)";
    }
  }
  if (drainBtn) {
    drainBtn.hidden = queued === 0 || !navigator.onLine;
    drainBtn.onclick = async () => {
      drainBtn.disabled = true;
      drainBtn.querySelector("span").textContent = "Draining…";
      try {
        await processQueue();
      } catch (err) {
        console.warn("[settings] manual drain failed:", err);
      }
      drainBtn.disabled = false;
      paintHealth();
    };
  }

  // Storage estimate (best-effort; not supported on all browsers)
  const storageEl = document.getElementById("health-storage");
  if (storageEl) {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      try {
        const est = await navigator.storage.estimate();
        const usedMB = (est.usage || 0) / 1024 / 1024;
        const quotaMB = (est.quota || 0) / 1024 / 1024;
        storageEl.textContent = quotaMB
          ? `${usedMB.toFixed(1)} MB of ${(quotaMB / 1024).toFixed(0)} GB available`
          : `${usedMB.toFixed(1)} MB`;
      } catch {
        storageEl.textContent = "unavailable";
      }
    } else {
      storageEl.textContent = "unavailable";
    }
  }
}