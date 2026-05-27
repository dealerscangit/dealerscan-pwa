// scripts/screens/upload.js
// Screen 6: upload as a stacked card deck.
//
// Design: the user sees ONE active card at a time, with up to two queued
// cards peeking behind it (back-stack). When a card finishes uploading, it
// animates off-screen to the top, the back-stack advances forward, and the
// next card becomes active. Visually the stack shrinks to nothing.
//
// Active card carries a "2 of 5" count badge + status icon (spinner/check/X)
// + filename. Pending/back-stack cards are dimmed.

import { getCurrentSalesperson } from "../currentUser.js";
import { createCustomerFolder, uploadPhoto } from "../apiClient.js";
import { reportError } from "../errorReporter.js";

let _showScreen = null;
let _session = null;
let _isUploading = false;

// Tracks which photo is currently the front of the deck.
// Photos at index < _activeIndex are completed (off-stage).
let _activeIndex = 0;

export function attachUploadHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;
}

export async function renderUpload() {
  if (_isUploading) return;
  _isUploading = true;

  _activeIndex = 0;
  paintDeck();
  paintSummary();

  try {
    const sp = getCurrentSalesperson();
    if (!sp) throw new Error("No signed-in salesperson");
    if (!_session.customerName) throw new Error("No customer selected");

    // 1) Folder
    if (!_session.folderId) {
      _session.folderId = await createCustomerFolder(
        _session.customerName,
        sp,
        _session.isNewCustomer
      );
    }

    // 2) Sequential per-photo upload
    for (let i = 0; i < _session.photos.length; i++) {
      const photo = _session.photos[i];
      if (photo.status === "success") {
        _activeIndex = i + 1;
        continue;
      }
      _activeIndex = i;
      photo.status = "active";
      updateActiveCard();
      paintSummary();

      try {
        const base64 = dataUrlToBase64(photo.dataUrl);
        await uploadPhoto(_session.folderId, base64, photo.filename);
        photo.status = "success";
        updateActiveCard();
        paintSummary();
        // Hold on the success state long enough to land the check pop,
        // then animate this card off and advance the stack.
        await sleep(450);
        await flyOffActive();
        _activeIndex = i + 1;
        paintDeck();
        paintSummary();
      } catch (err) {
        console.error(`[upload] photo ${photo.filename} failed:`, err);
        reportError("uploadFailed", {
          customer: _session.customerName,
          folderName: _session.folderId,
          filename: photo.filename,
          error: err,
        });
        photo.status = "failed";
        updateActiveCard();
        paintSummary();
        // Don't auto-advance on failure — let the user see it and decide
        await sleep(900);
      }
    }

    const allOk = _session.photos.every((p) => p.status === "success");
    _isUploading = false;
    if (allOk) {
      await sleep(200);
      _showScreen("done");
    } else {
      addRetryAffordance();
    }
  } catch (err) {
    console.error("[upload] flow failed:", err);
    reportError("createFolderFailed", {
      customer: _session.customerName,
      error: err,
    });
    _isUploading = false;
    _session.photos.forEach((p) => {
      if (p.status === "pending" || p.status === "active") p.status = "failed";
    });
    paintDeck();
    paintSummary();
    addRetryAffordance();
  }
}

function paintSummary() {
  const summary = document.getElementById("upload-summary");
  if (!summary) return;

  const photos = _session.photos || [];
  const done = photos.filter((p) => p.status === "success").length;
  const failed = photos.filter((p) => p.status === "failed").length;
  const total = photos.length;
  const customerLabel = _session.customerName ? ` to ${_session.customerName}` : "";

  let txt = `${done} of ${total} uploaded${customerLabel}`;
  if (failed > 0) txt += ` · ${failed} failed`;
  summary.textContent = txt;
}

function paintDeck() {
  const stage = document.getElementById("upload-deck");
  if (!stage) return;
  stage.innerHTML = "";

  const photos = _session.photos || [];
  // Render active + up to 3 cards behind it. Iterating back-to-front so
  // DOM order matches z-index (the active card ends up last/on-top).
  const maxVisible = 4;
  const remainingStart = _activeIndex;
  const remainingEnd = Math.min(photos.length, _activeIndex + maxVisible);

  for (let i = remainingEnd - 1; i >= remainingStart; i--) {
    const photo = photos[i];
    const pos = i - _activeIndex;
    const card = buildCardElement(photo, pos, i);
    stage.appendChild(card);
  }
}

// Surgical update of the active card's status without re-painting the whole
// deck (which would flash back-stack cards on every status change).
function updateActiveCard() {
  const card = document.querySelector(`.deck-card[data-pos="0"]`);
  if (!card) return;
  const photos = _session.photos || [];
  const photo = photos[_activeIndex];
  if (!photo) return;

  card.classList.remove("pending", "active", "success", "failed");
  card.classList.add(photo.status);

  const iconWrap = card.querySelector(".deck-card-status-icon");
  if (iconWrap) {
    iconWrap.innerHTML = statusIconHtml(photo.status);
  }
  const fname = card.querySelector(".deck-card-filename");
  if (fname) fname.textContent = photo.filename;
}

function buildCardElement(photo, pos, indexInPhotos) {
  const photos = _session.photos || [];
  const total = photos.length;

  const card = document.createElement("div");
  card.className = `deck-card ${photo.status}`;
  card.setAttribute("data-pos", String(pos));
  card.setAttribute("data-photo-index", String(indexInPhotos));

  const img = document.createElement("img");
  img.src = photo.dataUrl;
  img.alt = `Photo ${indexInPhotos + 1}`;
  card.appendChild(img);

  const overlay = document.createElement("div");
  overlay.className = "deck-card-overlay";

  const topRow = document.createElement("div");
  topRow.className = "deck-card-top-row";

  const count = document.createElement("span");
  count.className = "deck-card-count";
  count.textContent = `${indexInPhotos + 1} of ${total}`;
  topRow.appendChild(count);

  const statusIcon = document.createElement("div");
  statusIcon.className = "deck-card-status-icon";
  statusIcon.innerHTML = statusIconHtml(photo.status);
  topRow.appendChild(statusIcon);

  overlay.appendChild(topRow);

  const fname = document.createElement("div");
  fname.className = "deck-card-filename";
  fname.textContent = photo.filename;
  overlay.appendChild(fname);

  card.appendChild(overlay);
  return card;
}

function statusIconHtml(status) {
  if (status === "active") {
    return '<div class="deck-card-spinner"></div>';
  }
  if (status === "success") {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  if (status === "failed") {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"><circle cx="12" cy="12" r="8"/></svg>';
}

// Trigger the fly-off animation on the current active card and resolve
// when the transition has finished.
function flyOffActive() {
  return new Promise((resolve) => {
    const card = document.querySelector(`.deck-card[data-pos="0"]`);
    if (!card) { resolve(); return; }
    card.classList.add("flying-off");
    const done = () => resolve();
    card.addEventListener("transitionend", done, { once: true });
    // Safety net in case transitionend doesn't fire on iOS standalone mode
    setTimeout(done, 700);
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function dataUrlToBase64(dataUrl) {
  if (dataUrl.startsWith("data:image/svg+xml")) {
    const utf8 = decodeURIComponent(dataUrl.split(",")[1] || "");
    return btoa(unescape(encodeURIComponent(utf8)));
  }
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
