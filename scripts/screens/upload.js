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
import { createCustomerFolder } from "../apiClient.js";
import { enqueue as enqueueOffline, newUploadId } from "../offlineQueue.js";
import { reportError } from "../errorReporter.js";
import { compressDataUrl } from "../imageCompress.js";
import { invalidate as invalidateCache } from "../dataCache.js";

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

    // Flow (2026-10-27 rewrite):
    //   1) Compress photos on the phone. If online and this is the first
    //      batch for the customer, create the Drive folder at the same time.
    //   2) SAVE the scan to the on-phone queue (IndexedDB) before any
    //      upload. Nothing can be lost after this point — not by locking
    //      the phone, switching apps, or iOS closing the PWA.
    //   3) Hand off to the queue, which uploads 2 photos at a time and
    //      deletes each one from the phone once it's in Drive.
    //   4) Show the done screen right away. The status strip on Home
    //      shows "Syncing" until the queue is empty.
    //
    // Previously photos were only queued AFTER an upload failed, so if iOS
    // suspended the app mid-upload the photos could vanish, and every
    // interrupted upload got re-sent in full.
    _session.photos.forEach((p) => {
      if (p.status !== "success") p.status = "active";
    });
    paintDeck();
    paintSummary();

    const toSend = _session.photos.filter((p) => p.status !== "success");
    const online = navigator.onLine;

    const folderPromise = (online && !_session.folderId)
      ? createCustomerFolder(_session.customerName, sp, _session.isNewCustomer)
          .then((id) => { _session.folderId = id; return id; })
          .catch((err) => {
            // Not fatal: the queue creates the folder when it drains.
            console.warn("[upload] createFolder failed, queue will retry:", err);
            return null;
          })
      : Promise.resolve(_session.folderId || null);

    const compressed = await Promise.all(
      toSend.map(async (photo) => ({
        dataUrl: await compressDataUrl(photo.dataUrl),
        filename: photo.filename,
        uploadId: newUploadId(),
        compressed: true,
      }))
    );
    const folderId = await folderPromise;

    await enqueueOffline({
      salesName: sp,
      customerName: _session.customerName,
      isNewCustomer: !!_session.isNewCustomer,
      folderId,
      photos: compressed,
    });
    // New scan activity — drop the cached home overview so counts refresh.
    invalidateCache(`homeOverview:${sp}`);

    if (!online) {
      _session.photos.forEach((p) => { p.status = "queued"; });
      _session.uploadStatus = "queued";
      _isUploading = false;
      _showScreen("done");
      return;
    }

    // Start uploading now (app.js runs the queue and shows progress + a
    // "Synced" toast). Safe to call while another drain is running — that
    // pass picks the new scan up.
    window.dispatchEvent(new CustomEvent("dealerscan:drain"));

    _session.uploadStatus = "sending";
    animateAllToSuccess();
    await sleep(700);
    _isUploading = false;
    _showScreen("done");
  } catch (err) {
    // Only reached if the phone couldn't save the scan at all (e.g. storage
    // blocked). Photos are still in the session, so Retry is safe.
    console.error("[upload] could not save scan:", err);
    reportError("uploadFailed", {
      customer: _session.customerName,
      folderName: _session.folderId,
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

// Optimistic UX: flip every active photo to success and play the check
// animation, regardless of whether the actual network call has resolved.
// The real upload promises continue in the background.
function animateAllToSuccess() {
  _session.photos.forEach((p) => {
    if (p.status === "active" || p.status === "pending") p.status = "success";
  });
  paintDeck();
  paintSummary();
}
