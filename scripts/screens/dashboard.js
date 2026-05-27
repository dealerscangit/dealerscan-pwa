// scripts/screens/dashboard.js
// Dashboard screen — paints the week chart, stat row, and top customers
// from the data returned by getHomeOverview (which the home screen has
// already fetched and cached in _overviewCache via getCachedHistory()).
//
// If no cache exists yet, we re-fetch. Otherwise we paint instantly so
// switching from home → dashboard feels free.

import { getCurrentSalesperson } from "../currentUser.js";
import { getHomeOverview } from "../apiClient.js";

let _showScreen = null;
let _session = null;
let _lastData = null;

export function attachDashboardHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;
}

export async function renderDashboard() {
  // Try cache first for instant paint
  if (_lastData) paint(_lastData);
  else paintEmpty();

  // Then refresh in background
  const sp = getCurrentSalesperson();
  if (!sp) {
    paintEmpty();
    return;
  }
  try {
    const data = await getHomeOverview(sp);
    _lastData = data;
    paint(data);
  } catch (err) {
    console.error("[dashboard] fetch failed:", err);
    if (!_lastData) paintEmpty();
  }
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
