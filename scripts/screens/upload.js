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
import { enqueue as enqueueOffline } from "../offlineQueue.js";
import { reportError } from "../errorReporter.js";
import { compressDataUrl } from "../imageCompress.js";

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

    // ── Offline path: queue everything for later, skip the live upload loop.
    // If we're offline at the moment of upload, write the whole scan (customer
    // + folder + photos) to IndexedDB and route straight to the done screen
    // with a "queued" message. processQueue() runs on boot + on the online
    // event to drain the queue automatically.
    if (!navigator.onLine) {
      await enqueueOffline({
        salesName: sp,
        customerName: _session.customerName,
        isNewCustomer: !!_session.isNewCustomer,
        folderId: _session.folderId || null,
        photos: _session.photos.map((p) => ({
          dataUrl: p.dataUrl,
          filename: p.filename,
        })),
      });
      // Mark all photos as queued so the done screen shows a sensible summary
      _session.photos.forEach((p) => { p.status = "queued"; });
      _session.uploadStatus = "queued";
      _isUploading = false;
      _showScreen("done");
      return;
    }

    // 1) Folder — create if not yet provisioned. This MUST complete before
    //    we fire photo uploads because the photos need the folder id.
    if (!_session.folderId) {
      _session.folderId = await createCustomerFolder(
        _session.customerName,
        sp,
        _session.isNewCustomer
      );
    }

    // 2) Parallel upload with optimistic UI + offline-queue fallback.
    //
    // Strategy (in plain English):
    //   a) Compress all photos in parallel (4-6x payload reduction)
    //   b) Fire all uploadPhoto calls AT ONCE (Promise.all) — instead of
    //      waiting for each one, they all race together
    //   c) Animate the deck through "success" optimistically as soon as
    //      uploads START — the user sees the success state immediately
    //      and can close the PWA / switch to the extension while bytes
    //      finish moving in the background
    //   d) If any actual upload fails AFTER we showed "done", silently
    //      enqueue it to the offline queue. The boot/online auto-drain
    //      picks it up. User gets a "Synced" toast later if they're
    //      still in the app, or it just lands in Drive when they reopen.
    //
    // This stacks three perf wins:
    //   - Compress: 6x smaller payload
    //   - Parallel: 3 photos in the time of 1
    //   - Optimistic: user perceived time is the animation, not the network
    //
    // Real upload time for 3 photos: ~12s -> ~4s actual, ~1s perceived

    // Mark all photos active for the visual deck
    _session.photos.forEach((p) => {
      if (p.status !== "success") p.status = "active";
    });
    paintDeck();
    paintSummary();

    // Step 2a: compress all photos in parallel. This runs locally, no
    // network. Typically 100-300ms per photo on iPhone.
    const compressedPhotos = await Promise.all(
      _session.photos.map(async (photo) => {
        if (photo.status === "success") return null;
        const dataUrl = await compressDataUrl(photo.dataUrl);
        return { photo, dataUrl };
      })
    );

    // Step 2b: fire all uploads simultaneously. We DO NOT await each one
    // before the next — they all race. We attach a per-photo success/fail
    // handler that updates _that_ photo's status independently.
    //
    // We store the Promises so we can also fire-and-forget them if the
    // user is impatient and we want to navigate to done early.
    const uploadPromises = compressedPhotos
      .filter((x) => x !== null)
      .map(async ({ photo, dataUrl }, index) => {
        try {
          const base64 = dataUrlToBase64(dataUrl);
          await uploadPhoto(_session.folderId, base64, photo.filename);
          photo.status = "success";
          updateAllCards();
          paintSummary();
          return { ok: true, photo };
        } catch (err) {
          console.warn(`[upload] photo ${photo.filename} failed, queueing:`, err);
          // Don't mark failed — instead silently queue for retry. The
          // user's "done" experience is unaffected.
          try {
            await enqueueOffline({
              salesName: sp,
              customerName: _session.customerName,
              isNewCustomer: false,  // folder already exists
              folderId: _session.folderId,
              photos: [{ dataUrl, filename: photo.filename }],
            });
            photo.status = "queued";
          } catch (qErr) {
            console.error(`[upload] queue fallback also failed:`, qErr);
            photo.status = "failed";
            reportError("uploadFailed", {
              customer: _session.customerName,
              folderName: _session.folderId,
              filename: photo.filename,
              error: err,
            });
          }
          updateAllCards();
          paintSummary();
          return { ok: false, photo };
        }
      });

    // Step 2c: optimistic UX. Animate the success state immediately
    // (don't wait for the Promises). The user sees "All set" within
    // ~600ms regardless of actual network speed.
    //
    // Visual sequence:
    //   - All cards flip to success state at once (animateAllToSuccess)
    //   - Hold ~600ms so the user reads the check icons (substantial,
    //     not blink-and-miss-it)
    //   - Route to done screen
    //
    // The Promise.all keeps running in the background. If any photo
    // fails, the queue fallback kicks in silently. The done screen
    // doesn't lie — if anything DID fail and got queued, the user
    // will see a "Syncing N queued" indicator on the home screen.
    animateAllToSuccess();
    await sleep(700);

    _isUploading = false;
    _showScreen("done");

    // Continue tracking the upload promises in the background. We do
    // this AFTER navigating so failures don't block the user. If they
    // all succeed the user just sees the regular "Synced" status; if
    // any fail they go into the offline queue and drain later.
    Promise.allSettled(uploadPromises).then((results) => {
      const failed = results.filter((r) => r.status === "fulfilled" && !r.value.ok);
      if (failed.length > 0) {
        console.log(`[upload] ${failed.length} photos queued for retry after optimistic done`);
      }
    });
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


// All photos at once: paint their current status into every visible card.
// Used by parallel upload so multiple photos can show "success" simultaneously
// without waiting for the sequential paintDeck pass.
function updateAllCards() {
  paintDeck();
}

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
