// scripts/screens/dashboard.js
// Dashboard screen — paints the week chart, stat row, and top customers
// from the data returned by getHomeOverview (which the home screen has
// already fetched and cached in _overviewCache via getCachedHistory()).
//
// If no cache exists yet, we re-fetch. Otherwise we paint instantly so
// switching from home → dashboard feels free.

import { getCurrentSalesperson } from "../currentUser.js";
import { getHomeOverview, getTeamOverview } from "../apiClient.js";
import { getOrFetch, invalidate as invalidateCache } from "../dataCache.js";
import { hasPermissionSync, loadRegistry } from "../roles.js";

let _showScreen = null;
let _session = null;
let _lastData = null;

export function attachDashboardHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  // Collapse / expand wiring for the three collapsible team cards.
  // Header has data-collapse-toggle="cardId" pointing at the wrapper id;
  // tapping toggles the dashboard-card--collapsed class.
  document.querySelectorAll("[data-collapse-toggle]").forEach((header) => {
    header.addEventListener("click", () => {
      const targetId = header.dataset.collapseToggle;
      const card = document.getElementById(targetId);
      if (card) card.classList.toggle("dashboard-card--collapsed");
    });
  });
}

export async function renderDashboard() {
  const sp = getCurrentSalesperson();
  if (!sp) {
    paintEmpty();
    return;
  }

  // Pull from the SAME shared cache the home screen uses. This is the
  // big win: opening home -> dashboard reuses the data already fetched
  // by home, with no second call.
  const cacheKey = `homeOverview:${sp}`;
  const { value: cached, freshPromise } = await getOrFetch(
    cacheKey,
    () => getHomeOverview(sp)
  );

  if (cached) {
    _lastData = cached;
    paint(cached);
  } else {
    paintLoadingSpinners();
  }

  if (freshPromise) {
    try {
      const data = await freshPromise;
      _lastData = data;
      paint(data);
    } catch (err) {
      console.error("[dashboard] fetch failed:", err);
      if (!cached) paintEmpty();
    }
  }

  // After personal data renders, paint team section if user has the
  // viewAllData permission (manager + dev). The team section's own
  // visibility starts hidden; we unhide and populate it here.
  renderTeamSection();
}

// ──────────────────────────────────────────────────────────────────
// Team section (manager + dev)
// Gated by hasPermissionSync("viewAllData"). Hidden for sales role.
// ──────────────────────────────────────────────────────────────────
async function renderTeamSection() {
  const teamSection = document.getElementById("dashboard-team-section");
  if (!teamSection) return;

  await loadRegistry().catch((err) => console.warn("[dash team] registry load failed:", err));

  if (!hasPermissionSync("viewAllData")) {
    teamSection.hidden = true;
    return;
  }
  teamSection.hidden = false;

  // Force-fresh team data on every visit until cache architecture stabilizes
  invalidateCache("teamOverview:all");
  const { value: cached, freshPromise } = await getOrFetch(
    "teamOverview:all",
    () => getTeamOverview()
  );

  if (cached) paintTeam(cached);

  if (freshPromise) {
    try {
      const data = await freshPromise;
      paintTeam(data);
    } catch (err) {
      console.warn("[dashboard] team fetch failed:", err);
    }
  }
}

function paintTeam(data) {
  // Top stats: total today, active today, total week
  const totalTodayEl = document.getElementById("team-total-today");
  const activeCountEl = document.getElementById("team-active-count");
  const totalWeekEl = document.getElementById("team-total-week");
  if (totalTodayEl) totalTodayEl.textContent = data.teamTotalToday || 0;
  if (activeCountEl) activeCountEl.textContent = (data.todayBySalesperson || []).length;
  if (totalWeekEl) totalWeekEl.textContent = data.teamTotalWeek || 0;

  // Per-salesperson bars
  const barsEl = document.getElementById("team-bars");
  if (barsEl) {
    const list = data.todayBySalesperson || [];
    if (list.length === 0) {
      barsEl.innerHTML = '<p class="dashboard-empty">No team scans yet today.</p>';
    } else {
      const maxScans = Math.max(...list.map((s) => s.scans), 1);
      barsEl.innerHTML = list.map((sp) => {
        const pct = Math.round((sp.scans / maxScans) * 100);
        return `
          <div class="team-bar-row">
            <span class="team-bar-name">${escapeHtml(sp.name)}</span>
            <div class="team-bar-track">
              <div class="team-bar-fill" style="width: ${pct}%"></div>
            </div>
            <span class="team-bar-count">${sp.scans}</span>
          </div>
        `;
      }).join("");
    }
  }

  // Recent scans across team
  const recentEl = document.getElementById("team-recent-list");
  if (recentEl) {
    const list = data.recentScans || [];
    if (list.length === 0) {
      recentEl.innerHTML = '<p class="dashboard-empty">No recent scans.</p>';
    } else {
      recentEl.innerHTML = list.map((s) => {
        const time = formatTimeShort(s.timestamp);
        const photoLabel = s.photoCount === 1 ? "1 doc" : `${s.photoCount} docs`;
        return `
          <div class="team-recent-row">
            <div class="team-recent-avatar">${initial(s.salesperson)}</div>
            <div class="team-recent-text">
              <p class="team-recent-name">${escapeHtml(s.customer || "(no customer)")}</p>
              <p class="team-recent-sub">${escapeHtml(s.salesperson)} · ${photoLabel}</p>
            </div>
            <span class="team-recent-time">${time}</span>
          </div>
        `;
      }).join("");
    }
  }

  // Inactive salespeople today
  const inactiveEl = document.getElementById("team-inactive-list");
  if (inactiveEl) {
    const list = data.inactiveToday || [];
    if (list.length === 0) {
      inactiveEl.innerHTML = '<p class="dashboard-empty">Everyone has scanned today.</p>';
    } else {
      inactiveEl.innerHTML = list.map((u) => `
        <div class="team-inactive-row">
          <div class="team-recent-avatar">${initial(u.name)}</div>
          <p class="team-inactive-name">${escapeHtml(u.name)}</p>
          <span class="team-inactive-role">${u.role || "sales"}</span>
        </div>
      `).join("");
    }
  }

  // Customer search wiring
  const searchInput = document.getElementById("team-customer-search");
  const resultsEl = document.getElementById("team-search-results");
  if (searchInput && resultsEl) {
    const customers = data.searchableCustomers || [];
    // Stash on the input so the handler can read it without closure traps
    searchInput._customers = customers;
    // One-time handler (clean up any previous on re-render)
    searchInput.oninput = (ev) => {
      const q = (ev.target.value || "").trim().toLowerCase();
      if (!q) {
        // Hide the floating results card entirely when query is empty so
        // it doesnt take up space above the team data.
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
        return;
      }
      resultsEl.hidden = false;
      const matches = (searchInput._customers || [])
        .filter((c) => (c.name || "").toLowerCase().includes(q))
        .slice(0, 10);
      if (matches.length === 0) {
        resultsEl.innerHTML = `<p class="dashboard-empty" style="font-size: 12px;">No matches for “${escapeHtml(q)}”</p>`;
        return;
      }
      resultsEl.innerHTML = matches.map((c) => {
        const photoLabel = c.photoCount === 1 ? "1 doc" : `${c.photoCount} docs`;
        return `
          <div class="team-search-row">
            <div class="team-recent-text">
              <p class="team-recent-name">${escapeHtml(c.name)}</p>
              <p class="team-recent-sub">${escapeHtml(c.salesperson)} · ${photoLabel}</p>
            </div>
          </div>
        `;
      }).join("");
    };
  }

  // Surface live counts in the COLLAPSED header so a glance gives info
  // without expanding the card.
  const barsMeta = document.getElementById("team-bars-meta");
  if (barsMeta) {
    const n = (data.todayBySalesperson || []).length;
    barsMeta.textContent = n === 0
      ? "no scans yet today"
      : `${n} active today`;
  }
  const inactiveMeta = document.getElementById("team-inactive-meta");
  if (inactiveMeta) {
    const n = (data.inactiveToday || []).length;
    inactiveMeta.textContent = n === 0
      ? "everyone has scanned"
      : `${n} havent scanned`;
  }
}

function initial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimeShort(iso) {
  try {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "p" : "a";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
  } catch {
    return "";
  }
}

// Paint loading spinners into the stat fields. Mirrors home.js's
// paintLoadingSpinners shape so the two screens feel consistent.
function paintLoadingSpinners() {
  const totalEl = document.getElementById("dash-week-total");
  if (totalEl) totalEl.innerHTML = '<span class="loading-spinner"></span>';
  ["dash-peak-hour", "dash-avg-docs", "dash-week-scans"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="loading-spinner lg"></span>';
  });
}

function paint(data) {
  paintWeekChart(data.dailyCounts || [0,0,0,0,0,0,0], data.weekTotalPhotos || 0);
  paintStats(data);
  paintTopCustomers(data.topCustomers || []);
}

function paintWeekChart(dailyCounts, weekTotalPhotos) {
  const chart = document.getElementById("week-chart");
  const labels = document.getElementById("week-chart-labels");
  const totalEl = document.getElementById("dash-week-total");
  if (!chart || !labels) return;

  // Cap chart at the max of the daily counts so the tallest bar fills
  // the chart vertically. If all zero, height is just the min (4px).
  const max = Math.max(1, ...dailyCounts);

  // Compute day labels: [6 days ago, ..., yesterday, today].
  // dailyCounts[0] is 6 days ago, [6] is today.
  const now = new Date();
  const todayDow = now.getDay(); // 0=Sun
  const dowLabels = ["S","M","T","W","T","F","S"];
  const labelOrder = [];
  for (let i = 6; i >= 0; i--) {
    // 6 days ago first → today last
    const dow = (todayDow - i + 7) % 7;
    labelOrder.push(dowLabels[dow]);
  }

  chart.innerHTML = "";
  labels.innerHTML = "";
  dailyCounts.forEach((count, i) => {
    const isToday = i === dailyCounts.length - 1;
    const bar = document.createElement("div");
    bar.className = `week-chart-bar${isToday ? " today" : ""}`;
    // Start at 0 and animate to target height for a satisfying paint
    bar.style.height = "0px";
    if (count > 0) {
      const val = document.createElement("span");
      val.className = "week-chart-bar-value";
      val.textContent = count;
      bar.appendChild(val);
    }
    chart.appendChild(bar);
    // Animate to final height next frame
    requestAnimationFrame(() => {
      bar.style.height = `${Math.max(4, (count / max) * 100)}%`;
    });

    const label = document.createElement("span");
    label.className = `week-chart-label${isToday ? " today" : ""}`;
    label.textContent = labelOrder[i];
    labels.appendChild(label);
  });

  if (totalEl) {
    totalEl.textContent = `${weekTotalPhotos} ${weekTotalPhotos === 1 ? "doc" : "docs"}`;
  }
}

function paintStats(data) {
  const peakEl = document.getElementById("dash-peak-hour");
  const avgEl = document.getElementById("dash-avg-docs");
  const weekEl = document.getElementById("dash-week-scans");

  if (peakEl) {
    if (typeof data.peakHour === "number") {
      const h = data.peakHour;
      const am = h < 12;
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      peakEl.textContent = `${h12}${am ? "a" : "p"}`;
    } else {
      peakEl.textContent = "—";
    }
  }
  if (avgEl) {
    if (data.week && data.weekTotalPhotos) {
      avgEl.textContent = (data.weekTotalPhotos / data.week).toFixed(1);
    } else {
      avgEl.textContent = "—";
    }
  }
  if (weekEl) {
    weekEl.textContent = data.week || 0;
  }
}

function paintTopCustomers(topCustomers) {
  const list = document.getElementById("dash-top-list");
  if (!list) return;
  if (!topCustomers || topCustomers.length === 0) {
    list.innerHTML = '<p class="dashboard-empty">No customers this week yet.</p>';
    return;
  }
  list.innerHTML = "";
  topCustomers.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "dashboard-top-row";
    row.innerHTML = `
      <span class="dashboard-top-rank">${i + 1}</span>
      <span class="dashboard-top-name"></span>
      <span class="dashboard-top-count">${c.photoCount} ${c.photoCount === 1 ? "doc" : "docs"}</span>
    `;
    // Set name via textContent for XSS safety
    row.querySelector(".dashboard-top-name").textContent = c.customer || "(unknown)";
    list.appendChild(row);
  });
}

function paintEmpty() {
  const chart = document.getElementById("week-chart");
  if (chart) chart.innerHTML = "";
  const labels = document.getElementById("week-chart-labels");
  if (labels) labels.innerHTML = "";
  const totalEl = document.getElementById("dash-week-total");
  if (totalEl) totalEl.textContent = "—";
  ["dash-peak-hour", "dash-avg-docs", "dash-week-scans"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });
  const list = document.getElementById("dash-top-list");
  if (list) list.innerHTML = '<p class="dashboard-empty">No customers this week yet.</p>';
}
