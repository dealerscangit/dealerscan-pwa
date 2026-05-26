// scripts/screens/upload.js
// Screen 6: actually upload the photos. Creates the customer folder first,
// then uploads each photo sequentially. Per-photo status visible in the list.
//
// On full success → screen 7 (done).
// On any failure → stay here, mark failures, let user retry or go back.

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
  if (_isUploading) return; // guard against double-render re-firing the upload
  _isUploading = true;

  renderSummaryAndList();

  try {
    const sp = getCurrentSalesperson();
    if (!sp) throw new Error("No signed-in salesperson");
    if (!_session.customerName) throw new Error("No customer selected");

    // 1) Create or find the customer folder
    if (!_session.folderId) {
      _session.folderId = await createCustomerFolder(
        _session.customerName,
        sp,
        _session.isNewCustomer
      );
    }

    // 2) Upload photos one at a time. Sequential to avoid hammering the
    //    Apps Script execution quota (~30 concurrent requests per user).
    for (let i = 0; i < _session.photos.length; i++) {
      const photo = _session.photos[i];
      if (photo.status === "success") continue; // resumable: skip already-done
      photo.status = "active";
      renderSummaryAndList();

      try {
        const base64 = dataUrlToBase64(photo.dataUrl);
        await uploadPhoto(_session.folderId, base64, photo.filename);
        photo.status = "success";
      } catch (err) {
        console.error(`[upload] photo ${photo.filename} failed:`, err);
        photo.status = "failed";
      }
      renderSummaryAndList();
    }

    const allOk = _session.photos.every((p) => p.status === "success");
    _isUploading = false;
    if (allOk) {
      _showScreen("done");
    }
    // If not all OK, we stay on the screen so the user can see which failed.
    // Add a retry button to the list footer.
    if (!allOk) {
      addRetryAffordance();
    }
  } catch (err) {
    console.error("[upload] flow failed:", err);
    _isUploading = false;
    // Mark every pending/active photo as failed so the user sees the state
    _session.photos.forEach((p) => {
      if (p.status === "pending" || p.status === "active") p.status = "failed";
    });
    renderSummaryAndList();
    addRetryAffordance();
  }
}

function renderSummaryAndList() {
  const summary = document.getElementById("upload-summary");
  const list = document.getElementById("upload-list");
  if (!list) return;

  const photos = _session.photos || [];
  const done = photos.filter((p) => p.status === "success").length;
  const failed = photos.filter((p) => p.status === "failed").length;

  if (summary) {
    const customerLabel = _session.customerName ? ` to ${_session.customerName}` : "";
    let txt = `${done} / ${photos.length} uploaded${customerLabel}`;
    if (failed > 0) txt += ` · ${failed} failed`;
    summary.textContent = txt;
  }

  list.innerHTML = "";
  photos.forEach((p) => {
    const li = document.createElement("li");
    li.className = `upload-item ${p.status}`;
    const name = document.createElement("span");
    name.className = "upload-item-name";
    name.textContent = p.filename;
    const status = document.createElement("span");
    status.className = "upload-item-status";
    li.appendChild(name);
    li.appendChild(status);
    list.appendChild(li);
  });
}

function addRetryAffordance() {
  const screen = document.querySelector('[data-screen="upload"]');
  if (!screen) return;
  // Don't double-add
  if (screen.querySelector("[data-retry-block]")) return;

  const wrap = document.createElement("div");
  wrap.setAttribute("data-retry-block", "");
  wrap.className = "sticky-action";

  const retry = document.createElement("button");
  retry.className = "primary-button";
  retry.type = "button";
  retry.textContent = "Retry failed";
  retry.addEventListener("click", () => {
    // Reset failed back to pending so the renderer picks them up.
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
  // Real captures will be data:image/jpeg;base64,XXXX — strip prefix.
  // Stub captures are data:image/svg+xml;utf8,... — need to base64 that too.
  if (dataUrl.startsWith("data:image/svg+xml")) {
    const utf8 = decodeURIComponent(dataUrl.split(",")[1] || "");
    return btoa(unescape(encodeURIComponent(utf8)));
  }
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
