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
import { createCustomerFolder, listFolderFiles } from "../apiClient.js";
import { enqueue as enqueueOffline, newUploadId } from "../offlineQueue.js";
import { reportError } from "../errorReporter.js";
import { compressDataUrl } from "../imageCompress.js";
import { invalidate as invalidateCache } from "../dataCache.js";

let _showScreen = null;
let _session = null;
let _isUploading = false;

// Live upload tracking for the scan on screen (see trackUpload()).
let _track = null;
let _wakeLock = null;

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

    const itemId = await enqueueOffline({
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

    // Start uploading now and STAY on this screen until the backend has
    // confirmed every photo is saved in Drive and the folder check passes.
    // (Before 2026-11-10 this screen showed green checks right away and the
    // done screen said "safe to close", but iOS pauses the app when it's
    // closed, so uploads stalled.)
    _session.uploadStatus = "sending";
    const result = await trackUpload(itemId, toSend, folderId, Date.now());
    _isUploading = false;
    if (result === "verified" || result === "saved") {
      _session.uploadStatus = result;
      _showScreen("done");
    }
    // "failed" and "later" leave the user on this screen with choices,
    // or they chose to go home; nothing else to do here.
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
  if (!summary || _track) return;

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
  if (fname) fname.textContent = cardStatusText(photo) || photo.filename;
}

function cardStatusText(photo) {
  switch (photo.progressState) {
    case "waiting": return "Waiting…";
    case "sending": return photo.progress > 0 ? `Sending… ${Math.round(photo.progress * 100)}%` : "Sending…";
    case "saving": return "Saving to Drive…";
    case "saved": return "In Drive";
    case "failed": return "Didn't go through";
    default: return "";
  }
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
  fname.textContent = cardStatusText(photo) || photo.filename;
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



// ─────────────────────────────────────────────────────────────
// Live, verified upload progress
// ─────────────────────────────────────────────────────────────

// Follow one queued scan until every photo is confirmed in Drive.
// Resolves to "verified" (saved + folder check passed), "saved" (saved, but
// the folder check couldn't run), or "later" (user chose to leave).
// On failure it shows retry choices and keeps waiting.
function trackUpload(itemId, photos, folderId, startedAt) {
  return new Promise((resolve) => {
    const n = photos.length;
    const t = {
      itemId, photos, folderId, startedAt, resolve,
      state: photos.map(() => ({ state: "waiting", fraction: 0 })),
      wasHidden: false, failed: false, finished: false,
    };
    _track = t;
    photos.forEach((p) => { p.status = "active"; p.progressState = "waiting"; p.progress = 0; });
    _activeIndex = 0;
    ensureProgressUi();
    paintDeck();
    paintLive();
    keepAwake(true);

    t.onPhoto = (e) => {
      const d = e.detail || {};
      if (d.itemId !== itemId || d.index == null || !t.state[d.index]) return;
      t.state[d.index] = { state: d.state, fraction: d.fraction || 0 };
      const photo = photos[d.index];
      if (photo) {
        photo.progressState = d.state;
        photo.progress = d.fraction || 0;
        photo.status = d.state === "saved" ? "success" : d.state === "failed" ? "failed" : "active";
      }
      advanceDeck();
      paintLive();
    };
    t.onItem = async (e) => {
      const d = e.detail || {};
      if (d.itemId !== itemId) return;
      if (d.state === "uploading") {
        t.failed = false;
        hideFailureActions();
        paintLive();
      } else if (d.state === "failed") {
        t.failed = true;
        paintLive();
        showFailureActions(navigator.onLine ? "Trying again in 15 seconds. Check your signal if it keeps failing." : "No signal. It'll pick up as soon as you're back online.");
        clearTimeout(t.retryTimer);
        if (navigator.onLine) t.retryTimer = setTimeout(forceRetry, 15000);
      } else if (d.state === "done") {
        t.folderId = d.folderId || t.folderId;
        photos.forEach((p, i) => { p.status = "success"; p.progressState = "saved"; t.state[i] = { state: "saved", fraction: 1 }; });
        advanceDeck();
        paintLive("verifying");
        const verified = await verifyInDrive(t.folderId, n, t.startedAt);
        finish(verified ? "verified" : "saved");
      }
    };
    t.onVisible = () => {
      if (document.visibilityState === "hidden") { t.wasHidden = true; keepAwake(false); return; }
      if (t.finished) return;
      keepAwake(true);
      if (t.wasHidden) {
        t.wasHidden = false;
        // app.js also drains on foreground; this banner tells them why it paused.
        flashNote("Upload paused while DealerScan was closed. Resuming now…");
      }
    };

    t.onOffline = () => {
      if (t.finished) return;
      t.failed = true;
      paintLive();
      showFailureActions("No signal. It'll pick up as soon as you're back online.");
    };
    t.onOnline = () => {
      if (t.finished) return;
      hideFailureActions();
      t.failed = false;
      paintLive();
      // app.js drains on "online" too; force it in case this scan is in backoff.
      forceRetry();
    };
    window.addEventListener("offline", t.onOffline);
    window.addEventListener("online", t.onOnline);
    window.addEventListener("dealerscan:photo-progress", t.onPhoto);
    window.addEventListener("dealerscan:item-progress", t.onItem);
    document.addEventListener("visibilitychange", t.onVisible);

    function finish(result) {
      if (t.finished) return;
      t.finished = true;
      window.removeEventListener("dealerscan:photo-progress", t.onPhoto);
      window.removeEventListener("dealerscan:item-progress", t.onItem);
      document.removeEventListener("visibilitychange", t.onVisible);
      window.removeEventListener("offline", t.onOffline);
      window.removeEventListener("online", t.onOnline);
      clearTimeout(t.retryTimer);
      keepAwake(false);
      hideFailureActions();
      if (_track === t) _track = null;
      if (result === "verified" || result === "saved") {
        paintLive(result);
        setTimeout(() => resolve(result), 900);
      } else {
        resolve(result);
      }
    }
    t.finish = finish;

    // Kick off the upload. If another pass is already running it picks this
    // scan up after the one in front of it ("Waiting for an earlier upload").
    window.dispatchEvent(new CustomEvent("dealerscan:drain"));
  });
}

async function forceRetry() {
  const t = _track;
  if (!t || t.finished || !navigator.onLine) return;
  hideFailureActions();
  t.failed = false;
  paintLive();
  try {
    const { processQueue } = await import("../offlineQueue.js");
    await processQueue(null, { force: true });
  } catch (err) {
    console.warn("[upload] retry failed:", err);
  }
}

// Double-check Drive: the folder should now hold at least `expected` photos
// added since this scan started. Uses the same read-only folder listing as
// the dev panel. Returns false if the check couldn't run.
async function verifyInDrive(folderId, expected, startedAt) {
  if (!folderId) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await listFolderFiles(folderId);
      const files = (res && res.files) || [];
      const since = startedAt - 2 * 60 * 1000; // allow for clock differences
      const fresh = files.filter((f) => !f.trashed && Date.parse(f.created) >= since);
      if (fresh.length >= expected) return true;
    } catch (err) {
      console.warn("[upload] Drive check failed:", err);
    }
    await sleep(1500);
  }
  return false;
}

// Move the front card off the deck once it's saved, so the deck shows the
// first photo still in flight.
function advanceDeck() {
  const photos = _session.photos || [];
  let moved = false;
  while (_activeIndex < photos.length && photos[_activeIndex].status === "success") {
    _activeIndex++;
    moved = true;
  }
  if (moved) paintDeck();
  else updateActiveCard();
}

function ensureProgressUi() {
  const screen = document.querySelector('[data-screen="upload"]');
  if (!screen || screen.querySelector("#upload-live")) return;
  const summary = document.getElementById("upload-summary");
  const wrap = document.createElement("div");
  wrap.id = "upload-live";
  wrap.className = "upload-live";
  wrap.innerHTML =
    '<div class="upload-bar" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="upload-bar-fill" id="upload-bar-fill"></div>' +
    '</div>' +
    '<div class="upload-bar-row"><span id="upload-bar-label">Starting…</span><span id="upload-bar-pct">0%</span></div>' +
    '<div class="upload-keep-open" id="upload-keep-open">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>Keep DealerScan open until this finishes. Closing the app or locking the phone pauses the upload.</span>' +
    '</div>' +
    '<p class="upload-note" id="upload-note" hidden></p>';
  if (summary && summary.nextSibling) summary.parentNode.insertBefore(wrap, summary.nextSibling);
  else screen.appendChild(wrap);
}

// Overall bar: each photo counts 85% for sending and 15% for being saved,
// so the bar only reaches 100% when Drive has confirmed every photo.
function paintLive(phase) {
  const t = _track;
  const photos = _session.photos || [];
  const label = document.getElementById("upload-bar-label");
  const pctEl = document.getElementById("upload-bar-pct");
  const fill = document.getElementById("upload-bar-fill");
  const bar = fill && fill.parentElement;
  const summary = document.getElementById("upload-summary");
  const keepOpen = document.getElementById("upload-keep-open");
  const customer = _session.customerName ? ` for ${_session.customerName}` : "";

  const states = t ? t.state : photos.map((p) => ({ state: p.status === "success" ? "saved" : "waiting", fraction: p.status === "success" ? 1 : 0 }));
  const n = states.length || 1;
  let units = 0, saved = 0, sending = 0;
  states.forEach((st) => {
    if (st.state === "saved") { units += 1; saved++; }
    else if (st.state === "saving") { units += 0.85; sending++; }
    else if (st.state === "sending") { units += 0.85 * (st.fraction || 0); sending++; }
  });
  let pct = Math.round((units / n) * 100);
  if (phase !== "verified" && phase !== "saved" && pct >= 100) pct = 99;
  if (phase === "verified" || phase === "saved") pct = 100;

  if (fill) fill.style.width = pct + "%";
  if (bar) bar.setAttribute("aria-valuenow", String(pct));
  if (pctEl) pctEl.textContent = pct + "%";
  if (fill) fill.classList.toggle("is-done", phase === "verified" || phase === "saved");
  if (fill) fill.classList.toggle("is-failed", !!(t && t.failed));

  let text;
  if (phase === "verified") text = `All ${n} in Drive · verified`;
  else if (phase === "saved") text = `All ${n} saved in Drive`;
  else if (phase === "verifying") text = "Checking Drive…";
  else if (t && t.failed) text = `${saved} of ${n} in Drive · some didn't go through`;
  else if (saved === 0 && sending === 0) text = "Waiting to start…";
  else text = `${saved} of ${n} in Drive`;
  if (label) label.textContent = text;

  if (summary) {
    if (phase === "verified" || phase === "saved") summary.textContent = `Done${customer}.`;
    else if (t && t.failed) summary.textContent = `Upload stopped${customer}. Your photos are still saved on this phone.`;
    else summary.textContent = `Uploading ${n} ${n === 1 ? "photo" : "photos"}${customer}…`;
  }
  if (keepOpen) keepOpen.hidden = phase === "verified" || phase === "saved" || !!(t && t.failed);
  updateActiveCard();
}

function flashNote(text) {
  const note = document.getElementById("upload-note");
  if (!note) return;
  note.textContent = text;
  note.hidden = false;
  clearTimeout(flashNote._t);
  flashNote._t = setTimeout(() => { note.hidden = true; }, 6000);
}

function showFailureActions(message) {
  const screen = document.querySelector('[data-screen="upload"]');
  if (!screen) return;
  const existing = screen.querySelector("[data-upload-fail] .upload-fail-msg");
  if (existing) { existing.textContent = message || existing.textContent; return; }
  const wrap = document.createElement("div");
  wrap.setAttribute("data-upload-fail", "");
  wrap.className = "sticky-action";

  const msg = document.createElement("p");
  msg.className = "muted upload-fail-msg";
  msg.textContent = message || "Check your signal, then try again.";

  const retry = document.createElement("button");
  retry.className = "primary-button";
  retry.type = "button";
  retry.textContent = "Try again now";
  retry.addEventListener("click", () => {
    if (_track) clearTimeout(_track.retryTimer);
    forceRetry();
  });

  const later = document.createElement("button");
  later.className = "secondary-button";
  later.type = "button";
  later.textContent = "Finish later";
  later.style.marginTop = "8px";
  later.addEventListener("click", () => {
    const t = _track;
    if (t && t.finish) t.finish("later");
    // Photos stay saved on the phone; the queue sends them next time the
    // app is open with signal (or from Settings > Drain now).
    _isUploading = false;
    _session.uploadStatus = "queued";
    _showScreen("home");
  });

  wrap.append(msg, retry, later);
  screen.appendChild(wrap);
}

function hideFailureActions() {
  const el = document.querySelector("[data-upload-fail]");
  if (el) el.remove();
}

// Keep the screen from dimming and locking while photos upload. Supported on
// iOS 16.4+ and Android Chrome; silently skipped elsewhere.
async function keepAwake(on) {
  try {
    if (on) {
      if (_wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      _wakeLock = await navigator.wakeLock.request("screen");
      _wakeLock.addEventListener("release", () => { _wakeLock = null; });
    } else if (_wakeLock) {
      const l = _wakeLock; _wakeLock = null;
      await l.release();
    }
  } catch (err) {
    _wakeLock = null;
  }
}
