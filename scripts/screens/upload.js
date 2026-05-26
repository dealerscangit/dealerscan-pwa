// scripts/screens/upload.js
// Screen 6: upload progress with card-grid preview.
// Each photo card shows the actual thumbnail with a status overlay (spinner,
// check, X) and is dimmed-then-revealed as upload completes. Live progress
// bar at top tracks overall completion. Mirrors the extension's upload UX.

import { getCurrentSalesperson } from "../currentUser.js";
import { createCustomerFolder, uploadPhoto } from "../apiClient.js";

let _showScreen = null;
let _session = null;
let _isUploading = false;

export function attachUploadHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;
}

export async function renderUpload() {
  if (_isUploading) return;
  _isUploading = true;

  // Initial paint — all cards visible, all pending
  paintGrid();
  paintMeta();

  try {
    const sp = getCurrentSalesperson();
    if (!sp) throw new Error("No signed-in salesperson");
    if (!_session.customerName) throw new Error("No customer selected");

    // 1) Create or find customer folder
    if (!_session.folderId) {
      _session.folderId = await createCustomerFolder(
        _session.customerName,
        sp,
        _session.isNewCustomer
      );
    }

    // 2) Upload sequentially to respect Apps Script quotas
    for (let i = 0; i < _session.photos.length; i++) {
      const photo = _session.photos[i];
      if (photo.status === "success") continue; // resumable
      photo.status = "active";
      paintGrid();
      paintMeta();

      try {
        const base64 = dataUrlToBase64(photo.dataUrl);
        await uploadPhoto(_session.folderId, base64, photo.filename);
        photo.status = "success";
      } catch (err) {
        console.error(`[upload] photo ${photo.filename} failed:`, err);
        photo.status = "failed";
      }
      paintGrid();
      paintMeta();
    }

    const allOk = _session.photos.every((p) => p.status === "success");
    _isUploading = false;
    if (allOk) {
      // Tiny pause so the user sees the last check land before transitioning
      setTimeout(() => _showScreen("done"), 450);
    } else {
      addRetryAffordance();
    }
  } catch (err) {
    console.error("[upload] flow failed:", err);
    _isUploading = false;
    _session.photos.forEach((p) => {
      if (p.status === "pending" || p.status === "active") p.status = "failed";
    });
    paintGrid();
    paintMeta();
    addRetryAffordance();
  }
}

function paintMeta() {
  const summary = document.getElementById("upload-summary");
  const bar = document.getElementById("upload-progress-bar");

  const photos = _session.photos || [];
  const done = photos.filter((p) => p.status === "success").length;
  const failed = photos.filter((p) => p.status === "failed").length;
  const total = photos.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  if (bar) bar.style.width = `${pct}%`;
  if (summary) {
    const customerLabel = _session.customerName ? ` to ${_session.customerName}` : "";
    let txt = `${done} of ${total} uploaded${customerLabel}`;
    if (failed > 0) txt += ` · ${failed} failed`;
    summary.textContent = txt;
  }
}

function paintGrid() {
  const grid = document.getElementById("upload-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const photos = _session.photos || [];
  photos.forEach((photo, i) => {
    const card = document.createElement("div");
    card.className = `upload-card ${photo.status}`;

    // Real thumbnail of the photo being uploaded
    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = `Photo ${i + 1}`;
    card.appendChild(img);

    // Per-card status overlay
    const overlay = document.createElement("div");
    overlay.className = "upload-card-overlay";

    const icon = document.createElement("div");
    icon.className = "upload-card-icon";
    if (photo.status === "pending") {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.4"/></svg>';
    } else if (photo.status === "active") {
      icon.innerHTML = '<div class="upload-card-spinner"></div>';
    } else if (photo.status === "success") {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (photo.status === "failed") {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }
    overlay.appendChild(icon);

    const label = document.createElement("div");
    label.className = "upload-card-label";
    label.textContent = photo.filename;
    overlay.appendChild(label);

    card.appendChild(overlay);
    grid.appendChild(card);
  });
}

function addRetryAffordance() {
  const screen = document.querySelector('[data-screen="upload"]');
  if (!screen) return;
  if (screen.querySelector("[data-retry-block]")) return;

  const wrap = document.createElement("div");
  wrap.setAttribute("data-retry-block", "");
  wrap.className = "sticky-action";

  const retry = document.createElement("button");
  retry.className = "primary-button";
  retry.type = "button";
  retry.textContent = "Retry failed";
  retry.addEventListener("click", () => {
    _session.photos.forEach((p) => {
      if (p.status === "failed") p.status = "pending";
    });
    wrap.remove();
    renderUpload();
  });

  const back = document.createElement("button");
  back.className = "secondary-button";
  back.type = "button";
  back.textContent = "Back to review";
  back.style.marginTop = "8px";
  back.addEventListener("click", () => {
    wrap.remove();
    _showScreen("review");
  });

  wrap.appendChild(retry);
  wrap.appendChild(back);
  screen.appendChild(wrap);
}

function dataUrlToBase64(dataUrl) {
  if (dataUrl.startsWith("data:image/svg+xml")) {
    const utf8 = decodeURIComponent(dataUrl.split(",")[1] || "");
    return btoa(unescape(encodeURIComponent(utf8)));
  }
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
