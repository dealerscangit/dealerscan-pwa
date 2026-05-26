// scripts/screens/camera.js
// Screen 4: real camera capture using getUserMedia + canvas.
//
// Flow:
//   1. On screen enter, request rear-facing camera at a reasonable resolution.
//   2. Show live viewfinder, big shutter button, customer chip up top, X to cancel.
//   3. Each shutter tap → grab frame → resize → JPEG-encode → push to session.photos
//      with status: 'pending'. Flash overlay fires for tactile feedback.
//   4. Tiny thumbnail of the latest capture appears bottom-left with a count badge.
//   5. Tap "Done" → stop camera stream → navigate to review.
//   6. If permission denied or no camera: show fallback panel with file picker.

let _showScreen = null;
let _session = null;
let _stream = null;          // MediaStream from getUserMedia, kept so we can stop tracks
let _capturing = false;      // guard against double-tap during the capture pipeline

// Resize cap — longest dimension. Big enough to keep documents legible,
// small enough to upload over LTE without pain.
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

export function attachCameraHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const shutter = document.getElementById("btn-shutter");
  const done = document.getElementById("btn-camera-done");
  const fallbackRetry = document.getElementById("btn-camera-fallback-retry");
  const fallbackPicker = document.getElementById("camera-file-fallback");
  const peek = document.getElementById("camera-thumb-peek");

  if (shutter) shutter.addEventListener("click", handleShutter);
  if (done) done.addEventListener("click", handleDone);
  if (fallbackRetry) fallbackRetry.addEventListener("click", () => startCamera());
  if (fallbackPicker) fallbackPicker.addEventListener("change", handleFallbackFiles);
  if (peek) peek.addEventListener("click", handleDone); // tap peek = same as Done (preview)

  // Back button (the X in the top-left) also stops the camera before navigating.
  // The universal [data-back] handler in app.js navigates; we hook beforeunload-style.
  const cancelBtn = document.querySelector('[data-screen="camera"] [data-back]');
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      stopCamera();
      // Cancel discards any captures from this session
      _session.photos = [];
    }, true);
  }
}

export function renderCamera() {
  // Reset photos for a fresh capture session every time we enter the screen
  _session.photos = [];
  paintCustomerChip();
  paintCountAndThumb();
  hideFallback();
  startCamera();
}

function paintCustomerChip() {
  const chip = document.getElementById("camera-customer-chip");
  if (!chip) return;
  if (_session?.customerName) {
    chip.textContent = `${_session.customerName}${_session.isNewCustomer ? " · new" : ""}`;
  } else {
    chip.textContent = "";
  }
}

// ────────────────────────────────────────────────
// Camera lifecycle
// ────────────────────────────────────────────────

async function startCamera() {
  hideFallback();

  // Stop any previous stream first (e.g., if user retries after denial)
  stopCamera();

  const video = document.getElementById("camera-video");
  if (!video) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showFallback("Your browser doesn't support camera access. Use the library picker below.");
    return;
  }

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // rear camera for documents
        width:  { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
    video.srcObject = _stream;
    // iOS sometimes needs an explicit play() after srcObject assign in PWA mode
    try { await video.play(); } catch (_) { /* autoplay is muted+playsinline, will resolve */ }
  } catch (err) {
    console.warn("[camera] getUserMedia failed:", err);
    if (err?.name === "NotAllowedError") {
      showFallback("Camera permission was denied. Enable it in Settings → Safari → Camera, or pick from your library.");
    } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
      showFallback("No camera found on this device. You can pick photos from your library instead.");
    } else {
      showFallback("Couldn't open the camera. You can pick photos from your library instead.");
    }
  }
}

function stopCamera() {
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
  const video = document.getElementById("camera-video");
  if (video) video.srcObject = null;
}

// Called by the router when navigating away from the camera screen.
// Ensures the camera stream is always stopped even if the user reaches
// review/done by some path we didn't anticipate.
export function _teardown() {
  stopCamera();
  _capturing = false;
}

function showFallback(msg) {
  const panel = document.getElementById("camera-fallback");
  const msgEl = document.getElementById("camera-fallback-msg");
  if (!panel) return;
  if (msgEl && msg) msgEl.textContent = msg;
  panel.hidden = false;
}
function hideFallback() {
  const panel = document.getElementById("camera-fallback");
  if (panel) panel.hidden = true;
}

// ────────────────────────────────────────────────
// Capture pipeline
// ────────────────────────────────────────────────

async function handleShutter() {
  if (_capturing) return;
  const video = document.getElementById("camera-video");
  const canvas = document.getElementById("camera-canvas");
  if (!video || !canvas || !_stream) return;
  if (!video.videoWidth) return; // not yet streaming

  _capturing = true;
  fireFlash();

  try {
    const dataUrl = grabAndEncode(video, canvas);
    addPhotoToSession(dataUrl);
    paintCountAndThumb();
  } catch (err) {
    console.error("[camera] capture failed:", err);
  } finally {
    // Brief lockout so rapid taps don't queue multiples
    setTimeout(() => { _capturing = false; }, 250);
  }
}

function fireFlash() {
  const flash = document.getElementById("camera-flash");
  if (!flash) return;
  flash.classList.add("firing");
  setTimeout(() => flash.classList.remove("firing"), 140);
}

// Resize-on-capture: figure out scaled dimensions that cap the long edge at
// MAX_DIMENSION but preserve aspect ratio. Then encode as JPEG.
function grabAndEncode(video, canvas) {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  let dstW = srcW;
  let dstH = srcH;
  const longEdge = Math.max(srcW, srcH);
  if (longEdge > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longEdge;
    dstW = Math.round(srcW * scale);
    dstH = Math.round(srcH * scale);
  }
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, dstW, dstH);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function addPhotoToSession(dataUrl) {
  const n = _session.photos.length + 1;
  _session.photos.push({
    id: `photo-${Date.now()}-${n}`,
    dataUrl,
    filename: `scan-${String(n).padStart(2, "0")}.jpg`,
    status: "pending",
  });
}

function paintCountAndThumb() {
  const peek = document.getElementById("camera-thumb-peek");
  const peekImg = document.getElementById("camera-thumb-peek-img");
  const count = document.getElementById("camera-thumb-peek-count");
  const done = document.getElementById("btn-camera-done");
  const doneLabel = document.getElementById("camera-done-label");

  const photos = _session.photos || [];
  const n = photos.length;

  if (peek && peekImg && count) {
    if (n === 0) {
      peek.hidden = true;
    } else {
      peek.hidden = false;
      peekImg.src = photos[n - 1].dataUrl;
      count.textContent = String(n);
    }
  }

  if (done) done.disabled = n === 0;
  if (doneLabel) doneLabel.textContent = n === 0 ? "Done" : `Done (${n})`;
}

// ────────────────────────────────────────────────
// Done / fallback
// ────────────────────────────────────────────────

function handleDone() {
  if (!_session.photos.length) return;
  stopCamera();
  _showScreen("review");
}

// Library-picker fallback: read each File as a data URL, run it through the
// same resize pipeline (using an offscreen image), then route to review.
async function handleFallbackFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  for (const file of files) {
    try {
      const dataUrl = await fileToResizedJpeg(file);
      addPhotoToSession(dataUrl);
    } catch (err) {
      console.error("[camera] fallback file failed:", err);
    }
  }
  paintCountAndThumb();
  if (_session.photos.length > 0) {
    _showScreen("review");
  }
  // Clear the input so picking the same file again retriggers
  e.target.value = "";
}

function fileToResizedJpeg(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.getElementById("camera-canvas") || document.createElement("canvas");
        const longEdge = Math.max(img.width, img.height);
        const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
