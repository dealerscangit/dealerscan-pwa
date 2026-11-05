// scripts/scanTest/main.js
// DealerScan license scan TEST page (dev only). Front = OCR of printed text,
// back = PDF417 barcode. Results are encrypted and sent to the desktop test
// extension so the two can be compared. Nothing is stored on a server
// except the encrypted mailbox message, which expires in 10 minutes.
// Photos never leave this phone; the preview is drawn locally.

import { parseFront, parseAamva, FIELD_ORDER } from "./parse.js";
import { readSession, importKey, sendMessage } from "./relay.js";

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
const ZXING_URL = "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.4/dist/iife/reader/index.js";
const ZXING_WASM_DIR = "https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.4/dist/reader/";

// Quality thresholds (measured on a 320px-wide copy of the frame area).
// Shown live on screen so they can be tuned from real-world tests.
const SHARP_MIN = 80;      // variance of the Laplacian; higher = sharper
const BRIGHT_MIN = 70;     // mean brightness 0-255
const BRIGHT_MAX = 220;
const GLARE_MAX = 0.012;   // share of near-white (blown-out) pixels
const EDGES_MIN = 3;       // card edges (of 4) that must line up with the frame
const MOTION_MAX = 7;      // average change between samples; above = still moving
const HOLD_MS = 1100;      // how long everything must stay green before the photo
const GRACE_MS = 1500;     // no auto-capture in the first moments after the camera opens
const EDGE_PAD = 0.18;     // look this far outside the frame for the card's edges
const FLOW_KEY = "dsst_flow";

const $ = (id) => document.getElementById(id);
const screens = ["nosession", "home", "camera", "working", "result"];
function show(name) {
  for (const s of screens) $("screen-" + s).hidden = s !== name;
  window.scrollTo(0, 0);
}

let session = null;
let key = null;
let stream = null;
let loopTimer = null;
let mode = null;          // "front" | "back" | "qr"
let flow = "front";       // "front" (front only) | "both" (front + back) | "backonly" (dev)
let camOpenedAt = 0;
let busy = false;
let holdStart = 0;
let lastQuality = null;
let prevThumb = null;
let autoOn = true;
let run = null;           // current scan: { front: {...}, back: {...}, frontPromise }

// ───────────────────────── helpers ─────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous"; s.dataset.src = src;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

// Load the barcode reader and keep its engine file on the same CDN host.
let zxingReady = null;
function loadZxing() {
  if (!zxingReady) {
    zxingReady = loadScript(ZXING_URL).then(() => {
      window.ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (p, prefix) => (p.endsWith(".wasm") ? ZXING_WASM_DIR + p : prefix + p) },
      });
    });
    zxingReady.catch(() => { zxingReady = null; });
  }
  return zxingReady;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const ios = ua.match(/iPhone OS (\d+)_(\d+)/);
  if (ios) return `iPhone · iOS ${ios[1]}.${ios[2]}`;
  const and = ua.match(/Android (\d+(\.\d+)?)/);
  if (and) return `Android ${and[1]}`;
  return "Other device";
}

function nextN() {
  const k = "dsst_n_" + session.sid;
  let n = 0;
  try { n = parseInt(sessionStorage.getItem(k) || "0", 10) || 0; } catch {}
  n += 1;
  try { sessionStorage.setItem(k, String(n)); } catch {}
  return n;
}

async function send(obj) {
  return sendMessage(session, key, nextN(), obj);
}

function addLog(text, ok) {
  const log = $("sent-log");
  if (log.dataset.empty !== "no") { log.innerHTML = ""; log.dataset.empty = "no"; }
  const row = document.createElement("div");
  row.className = "log-item";
  const a = document.createElement("span"); a.textContent = text;
  const b = document.createElement("span"); b.textContent = ok ? "Sent ✓" : "Failed";
  b.style.color = ok ? "#6ee7b7" : "#fde68a";
  row.append(a, b);
  log.prepend(row);
}

function getSavedFlow() {
  try { const v = localStorage.getItem(FLOW_KEY); return v === "both" ? "both" : "front"; } catch { return "front"; }
}
function saveFlow(v) {
  try { localStorage.setItem(FLOW_KEY, v); } catch {}
}
function paintFlowChoice() {
  const saved = getSavedFlow();
  $("btn-flow-front").classList.toggle("picked", saved === "front");
  $("btn-flow-both").classList.toggle("picked", saved === "both");
}

// ───────────────────────── camera ─────────────────────────
async function startStream() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    });
  } catch (err) {
    alert("Camera access is needed for this test. Allow it in Settings → Safari → Camera, then try again.");
    return false;
  }
  const video = $("cam-video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  return true;
}

// Switch what the camera screen is looking for. The camera keeps running, so
// going from the front to the back is instant.
function setMode(m) {
  mode = m;
  busy = false; holdStart = 0; lastQuality = null; prevThumb = null;
  camOpenedAt = performance.now();
  const frame = $("cam-frame");
  frame.className = m === "qr" ? "square" : "";
  setHold(0);
  const flip = m === "back" && flow === "both";
  $("cam-flip").hidden = !flip;
  $("cam-skip").hidden = !flip;
  $("cam-title").textContent = m === "front" ? "Front of license" : m === "back" ? "Back of license" : "Desktop QR code";
  $("cam-sub").textContent = m === "qr" ? "Point at the QR code" : m === "front" ? (autoOn ? "Auto-capture is on" : "Auto-capture is off · use the shutter") : "Reads the barcode automatically";
  $("cam-frame-label").textContent = m === "back" ? "Fit the whole barcode in the frame" : m === "qr" ? "QR code inside the square" : "Line up the license inside the frame";
  $("cam-status").textContent = m === "front" ? "Hold the card flat. It takes the photo once it's lined up and still." : m === "back" ? "Hold steady until it reads." : "";
  $("cam-shutter").hidden = m === "qr";
  $("cam-auto").hidden = m !== "front";
  document.querySelector(".checks").hidden = m === "qr";
  $("chk-edges").hidden = m !== "front";
  if (m !== "front") loadZxing().catch(() => setHint("Couldn't load the barcode reader", "warn"));
  if (m === "front") loadScript(TESSERACT_URL).catch(() => {});
  setHint(m === "front" ? "Line up the card" : m === "back" ? "Looking for the barcode…" : "Looking for the QR code…");
}

async function openCamera(m) {
  setHint("Starting camera…");
  show("camera");
  if (!(await startStream())) { closeCamera(); show(session ? "home" : "nosession"); return; }
  setMode(m);
  clearInterval(loopTimer);
  loopTimer = setInterval(tick, 120);
}

function closeCamera() {
  clearInterval(loopTimer); loopTimer = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const v = $("cam-video"); v.srcObject = null;
}

function setHint(text, kind) {
  const h = $("cam-hint");
  h.textContent = text;
  h.className = kind || "";
}

function setHold(p) {
  $("cam-hold").style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + "%";
}

function paintAuto() {
  $("cam-auto").textContent = autoOn ? "Auto: on" : "Auto: off";
  $("cam-auto").classList.toggle("off", !autoOn);
  if (mode === "front") $("cam-sub").textContent = autoOn ? "Auto-capture is on" : "Auto-capture is off · use the shutter";
}

// Map the on-screen frame to pixels in the camera image (video is object-fit: cover).
function frameRectInVideo() {
  const video = $("cam-video");
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const vr = video.getBoundingClientRect();
  const fr = $("cam-frame").getBoundingClientRect();
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
  const x = Math.max(0, (fr.left - vr.left - ox) / scale);
  const y = Math.max(0, (fr.top - vr.top - oy) / scale);
  const w = Math.min(vw - x, fr.width / scale);
  const h = Math.min(vh - y, fr.height / scale);
  return { x, y, w, h };
}

// pad = extra margin around the frame (as a share of its size). Barcodes need
// their start/stop edges, and the card-edge check needs to see past the frame.
function grabCanvas(maxW, pad = 0) {
  let r = frameRectInVideo();
  if (!r) return null;
  if (pad) {
    const video = $("cam-video");
    const px = r.w * pad, py = r.h * pad;
    const x = Math.max(0, r.x - px), y = Math.max(0, r.y - py);
    r = { x, y, w: Math.min(video.videoWidth - x, r.w + 2 * px), h: Math.min(video.videoHeight - y, r.h + 2 * py) };
  }
  const outW = Math.min(maxW, Math.round(r.w));
  const outH = Math.round(outW * (r.h / r.w));
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  c.getContext("2d", { willReadFrequently: true }).drawImage($("cam-video"), r.x, r.y, r.w, r.h, 0, 0, outW, outH);
  return c;
}

function lumOf(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return { lum, px, w, h };
}

// Sharpness (Laplacian variance), mean brightness, and glare share,
// measured on the area inside the frame only.
function measureInner(L, x0, y0, x1, y1) {
  const { lum, px, w } = L;
  let sum = 0, blown = 0, count = 0, lapSum = 0, lapSq = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x, p = i * 4;
      sum += lum[i]; count++;
      if (px[p] >= 252 && px[p + 1] >= 252 && px[p + 2] >= 252) blown++;
      if (y > y0 && y < y1 - 1 && x > x0 && x < x1 - 1) {
        const v = lum[i - w] + lum[i + w] + lum[i - 1] + lum[i + 1] - 4 * lum[i];
        lapSum += v; lapSq += v * v; n++;
      }
    }
  }
  const mean = lapSum / Math.max(1, n);
  return {
    sharp: Math.round(lapSq / Math.max(1, n) - mean * mean),
    bright: Math.round(sum / Math.max(1, count)),
    glare: blown / Math.max(1, count),
  };
}

function measure(canvas) {
  const L = lumOf(canvas);
  return measureInner(L, 0, 0, L.w, L.h);
}

// Is there a card here? A real card has four long straight edges. We look for
// a line running most of the way across each side of the frame (top, bottom,
// left, right), within a band around where the frame's edge is. Desks,
// keyboards and hands rarely line up on three sides at once.
function findEdges(L, pad) {
  const { lum, w, h } = L;
  const fx0 = Math.round(w * pad / (1 + 2 * pad)), fx1 = w - fx0;
  const fy0 = Math.round(h * pad / (1 + 2 * pad)), fy1 = h - fy0;
  const fw = fx1 - fx0, fh = fy1 - fy0;
  const bandX = Math.round(fw * 0.15), bandY = Math.round(fh * 0.17);
  const STEP = 22;      // brightness jump across the edge
  const COVER = 0.6;    // share of the side the unbroken line must cover
  const GAP_OK = 3;     // pixels of gap allowed inside a line

  // Score = longest unbroken run of edge pixels (small gaps allowed), as a
  // share of the side. A card edge is one long line; key rows, wood grain and
  // text are broken up, so they score low.
  function runScore(n, isEdge) {
    let best = 0, cur = 0, gap = 0;
    for (let i = 0; i < n; i++) {
      if (isEdge(i)) { cur += 1 + gap; gap = 0; best = Math.max(best, cur); }
      else if (cur && gap < GAP_OK) gap++;
      else { cur = 0; gap = 0; }
    }
    return n ? best / n : 0;
  }
  // The line may be tilted a few degrees (slope = pixels of drift per pixel).
  const SLOPES = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
  function rowScore(y, k) {
    const xs = fx0 + Math.round(fw * 0.08), n = fx1 - Math.round(fw * 0.08) - xs, mid = n / 2;
    return runScore(n, (i) => {
      const yy = Math.round(y + k * (i - mid)), x = xs + i;
      return yy >= 2 && yy <= h - 3 && Math.abs(lum[(yy + 2) * w + x] - lum[(yy - 2) * w + x]) > STEP;
    });
  }
  function colScore(x, k) {
    const ys = fy0 + Math.round(fh * 0.1), n = fy1 - Math.round(fh * 0.1) - ys, mid = n / 2;
    return runScore(n, (i) => {
      const xx = Math.round(x + k * (i - mid)), y = ys + i;
      return xx >= 2 && xx <= w - 3 && Math.abs(lum[y * w + xx + 2] - lum[y * w + xx - 2]) > STEP;
    });
  }
  const best = (from, to, fn) => {
    let m = 0;
    for (let v = from; v <= to; v++) for (const k of SLOPES) { m = Math.max(m, fn(v, k)); if (m >= 0.98) return m; }
    return m;
  };
  const sides = {
    top: best(fy0 - bandY, fy0 + bandY, rowScore),
    bottom: best(fy1 - bandY, fy1 + bandY, rowScore),
    left: best(fx0 - bandX, fx0 + bandX, colScore),
    right: best(fx1 - bandX, fx1 + bandX, colScore),
  };
  const found = Object.values(sides).filter((s) => s >= COVER).length;
  return { found, sides, inner: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } };
}

// How much the picture changed since the last sample (hand still moving?).
function motion(L) {
  const T = 32, { lum, w, h } = L;
  const th = Math.max(1, Math.round(T * h / w));
  const t = new Float32Array(T * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < T; x++) t[y * T + x] = lum[Math.floor(y * h / th) * w + Math.floor(x * w / T)];
  let d = null;
  if (prevThumb && prevThumb.length === t.length) {
    let s = 0; for (let i = 0; i < t.length; i++) s += Math.abs(t[i] - prevThumb[i]);
    d = s / t.length;
  }
  prevThumb = t;
  return d;
}

function setChk(id, ok, val) {
  const el = $(id);
  el.className = "chk " + (ok ? "ok" : "bad");
  el.querySelector("small").textContent = val;
}

function paintChecks(q, edges) {
  const sharpOk = q.sharp >= SHARP_MIN;
  const brightOk = q.bright >= BRIGHT_MIN && q.bright <= BRIGHT_MAX;
  const glareOk = q.glare <= GLARE_MAX;
  setChk("chk-sharp", sharpOk, String(q.sharp));
  setChk("chk-bright", brightOk, String(q.bright));
  setChk("chk-glare", glareOk, (q.glare * 100).toFixed(1) + "%");
  const edgesOk = edges == null ? true : edges.found >= EDGES_MIN;
  if (edges != null) setChk("chk-edges", edgesOk, `${edges.found} of 4`);
  return { sharpOk, brightOk, glareOk, edgesOk, all: sharpOk && brightOk && glareOk && edgesOk };
}

async function tick() {
  if (busy || !stream) return;

  if (mode === "qr") {
    busy = true;
    try { await tryQr(); } finally { busy = false; }
    return;
  }

  if (mode === "back") {
    const small = grabCanvas(320);
    if (!small) return;
    const q = measure(small);
    lastQuality = q;
    const c = paintChecks(q, null);
    // Glare is only a tip here: the barcode's white background is supposed to be bright.
    $("cam-frame").className = c.sharpOk && q.bright >= BRIGHT_MIN ? "ok" : "";
    if (q.bright < BRIGHT_MIN) setHint("Too dark. Find more light.", "warn");
    else if (q.glare > 0.08) setHint("Glare on the barcode. Tilt it slightly.", "warn");
    else setHint(flow === "both" ? "Flip it over · looking for the barcode…" : "Looking for the barcode…");
    busy = true;
    try { await tryBarcode(false); } finally { busy = false; }
    return;
  }

  // Front: look for the card's edges, then quality, then stillness.
  const wide = grabCanvas(360, EDGE_PAD);
  if (!wide) return;
  const L = lumOf(wide);
  const edges = findEdges(L, EDGE_PAD);
  window.__dsEdges = edges; // dev test: visible in the console
  const q = measureInner(L, edges.inner.x0, edges.inner.y0, edges.inner.x1, edges.inner.y1);
  const mv = motion(L);
  lastQuality = { ...q, edges: edges.found };
  const c = paintChecks(q, edges);
  const still = mv != null && mv <= MOTION_MAX;
  const frame = $("cam-frame");
  frame.className = c.all && still ? "ok" : (c.edgesOk && (!c.glareOk || !c.brightOk) ? "warn" : "");

  if (!c.edgesOk) setHint(edges.found === 0 ? "No card yet. Line it up with the frame." : "Line up the card's edges with the frame", "warn");
  else if (!c.brightOk) setHint(q.bright < BRIGHT_MIN ? "Too dark. Find more light." : "Too bright. Move out of direct light.", "warn");
  else if (!c.glareOk) setHint("Glare on the card. Tilt it slightly.", "warn");
  else if (!c.sharpOk) setHint("Hold still… focusing");
  else if (!still) setHint("Hold still…");
  else setHint(autoOn ? "Hold it there…" : "Looks good. Tap the shutter.", "ok");

  const ready = c.all && still && autoOn && performance.now() - camOpenedAt > GRACE_MS;
  if (!ready) { holdStart = 0; setHold(0); return; }
  if (!holdStart) holdStart = performance.now();
  const p = (performance.now() - holdStart) / HOLD_MS;
  setHold(p);
  if (p >= 1) {
    busy = true;
    await captureFront(true);
  }
}

// ───────────────────────── QR (link to desktop) ─────────────────────────
async function tryQr() {
  if (!window.ZXingWASM || !zxingReady) return;
  const c = grabCanvas(900, 0.15);
  if (!c) return;
  const img = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const res = await window.ZXingWASM.readBarcodes(img, { formats: ["QRCode"], maxNumberOfSymbols: 1, textMode: "Plain" });
  const hit = res && res.find((r) => r.isValid && /#s=/.test(r.text));
  if (!hit) return;
  closeCamera();
  const u = new URL(hit.text);
  if (u.origin !== location.origin) { alert("That QR code isn't a DealerScan test code."); show("nosession"); return; }
  location.hash = u.hash;
  await start();
}

// ───────────────────────── Front: OCR ─────────────────────────
async function burstBest(n, gapMs, maxW) {
  let best = null;
  for (let i = 0; i < n; i++) {
    const c = grabCanvas(maxW);
    if (c) {
      const small = document.createElement("canvas");
      small.width = 320; small.height = Math.round(320 * c.height / c.width);
      small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
      const q = measure(small);
      if (!best || q.sharp > best.q.sharp) best = { c, q };
    }
    if (i < n - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return best;
}

function cloneCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

function preprocess(canvas) {
  // Grayscale + stretch contrast so faint print reads better.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255, hi = 0;
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g[j] = l; if (l < lo) lo = l; if (l > hi) hi = l;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = ((g[j] - lo) / span) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let ocrWorker = null;
async function getOcrWorker(onStatus) {
  if (ocrWorker) return ocrWorker;
  await loadScript(TESSERACT_URL);
  onStatus("Loading the text reader (first time only, about 10 seconds)…");
  ocrWorker = await window.Tesseract.createWorker("eng", 1, {
    logger: (m) => { if (m.status && m.progress != null && m.status.includes("loading")) onStatus(`Loading the text reader… ${Math.round(m.progress * 100)}%`); },
  });
  return ocrWorker;
}

// Reads the front photo and sends the result. Runs in the background while
// the person flips the card in the front + back flow.
async function readFront(shot, auto, msToCapture, onStatus, edgesFound) {
  const t0 = performance.now();
  const worker = await getOcrWorker(onStatus);
  const ocrInput = preprocess(cloneCanvas(shot.c));
  const { data } = await worker.recognize(ocrInput);
  const msRead = Math.round(performance.now() - t0);
  const parsed = parseFront(data.text || "");
  const payload = {
    type: "front",
    fields: parsed.fields,
    fieldsFound: parsed.fieldsFound,
    confidence: Math.round(data.confidence || 0),
    rawText: String(data.text || "").slice(0, 3000),
    meta: { auto, msToCapture, msRead, quality: shot.q, edges: edgesFound, imageW: shot.c.width, imageH: shot.c.height, device: deviceLabel() },
  };
  run.front = { payload, photo: shot.c.toDataURL("image/jpeg", 0.85), ocrPhoto: ocrInput.toDataURL("image/jpeg", 0.8), sent: null };
  try { await send(payload); run.front.sent = true; addLog("Front (text)", true); }
  catch { run.front.sent = false; addLog("Front (text)", false); }
  return run.front;
}

async function captureFront(auto) {
  const msToCapture = Math.round(performance.now() - camOpenedAt);
  const edgesFound = lastQuality ? lastQuality.edges : null;
  setHint("Got it ✓", "ok");
  const shot = await burstBest(auto ? 4 : 2, 110, 1800);
  if (!shot) { closeCamera(); show("home"); return; }
  if (navigator.vibrate) try { navigator.vibrate(40); } catch {}

  if (flow === "both") {
    // Keep the camera running and go straight to the back. The front is read
    // in the background while the card is flipped.
    run.frontPromise = readFront(shot, auto, msToCapture, () => {}, edgesFound).catch((err) => { run.frontError = err; });
    run.frontPhotoEarly = shot.c.toDataURL("image/jpeg", 0.85);
    setMode("back");
    return;
  }

  closeCamera();
  show("working");
  $("working-title").textContent = "Reading the front…";
  $("working-sub").textContent = "Reading the printed text on this phone.";
  try {
    await readFront(shot, auto, msToCapture, (s) => { $("working-sub").textContent = s; }, edgesFound);
    showResult();
  } catch (err) {
    alert("Couldn't read the front: " + (err && err.message ? err.message : err));
    show("home");
  }
}

// ───────────────────────── Back: barcode ─────────────────────────
async function tryBarcode(manual) {
  if (!window.ZXingWASM || !zxingReady) return false;
  const t0 = performance.now();
  const c = grabCanvas(manual ? 2400 : 1600, 0.12);
  if (!c) return false;
  const img = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const res = await window.ZXingWASM.readBarcodes(img, { formats: ["PDF417"], tryHarder: true, maxNumberOfSymbols: 1, textMode: "Plain" });
  const hit = res && res.find((r) => r.isValid && r.text && r.text.length > 40);
  if (!hit) return false;
  const msRead = Math.round(performance.now() - t0);
  const msToCapture = Math.round(performance.now() - camOpenedAt);
  if (navigator.vibrate) try { navigator.vibrate(40); } catch {}
  closeCamera();
  const parsed = parseAamva(hit.text);
  const payload = {
    type: "back",
    fields: parsed.fields,
    elementsFound: parsed.elementsFound,
    meta: { auto: !manual, msToCapture, msRead, quality: lastQuality, imageW: c.width, imageH: c.height, device: deviceLabel() },
  };
  run.back = { payload, sent: null };
  try { await send(payload); run.back.sent = true; addLog("Back (barcode)", true); }
  catch { run.back.sent = false; addLog("Back (barcode)", false); }
  await afterBack();
  return true;
}

async function afterBack() {
  if (run.frontPromise) {
    show("working");
    $("working-title").textContent = "Finishing the front…";
    $("working-sub").textContent = "Reading the printed text on this phone.";
    await run.frontPromise;
  }
  showResult();
}

async function skipBack() {
  closeCamera();
  run.skipped = true;
  await afterBack();
}

// ───────────────────────── result ─────────────────────────
function metaLine(kind, p) {
  const m = p.meta;
  return `${(m.msToCapture / 1000).toFixed(1)}s to capture · ${(m.msRead / 1000).toFixed(1)}s to read` +
    (kind === "front" ? ` · text confidence ${p.confidence}%` : ` · ${p.elementsFound} barcode fields`) +
    (m.auto ? " · auto" : " · manual");
}

const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const KEY_FIELDS = ["lastName", "firstName", "dlNumber", "dob", "expires", "street", "zip"];

function showResult() {
  const f = run.front && run.front.payload;
  const b = run.back && run.back.payload;

  $("result-title").textContent = f && b ? "Front + back result" : f ? "Front result" : "Back result";
  const metas = [];
  if (f) metas.push("Front: " + metaLine("front", f));
  if (b) metas.push("Back: " + metaLine("back", b));
  if (run.skipped) metas.push("Back skipped");
  if (run.frontError) metas.push("Front couldn't be read: " + (run.frontError.message || run.frontError));
  $("result-meta").textContent = metas.join("\n");

  // Photo preview (stays on this phone).
  const photo = run.front ? run.front.photo : run.frontPhotoEarly;
  $("result-photo-wrap").hidden = !photo;
  if (photo) {
    $("result-photo").src = photo;
    $("result-ocr-photo").src = run.front ? run.front.ocrPhoto : "";
    $("result-ocr-wrap").hidden = !run.front;
    const q = f && f.meta.quality;
    $("result-photo-q").textContent = q ? `Sharp ${q.sharp} · light ${q.bright} · glare ${(q.glare * 100).toFixed(1)}% · ${f.meta.imageW}×${f.meta.imageH}px` : "";
  }

  // Fields: one column per side that was scanned.
  const box = $("result-fields");
  box.innerHTML = "";
  const head = document.createElement("div"); head.className = "row head";
  head.innerHTML = "<span class='k'>Field</span>";
  const cols = [];
  if (f) cols.push(["Front", f.fields]);
  if (b) cols.push(["Back", b.fields]);
  for (const [name] of cols) { const s = document.createElement("span"); s.className = "v"; s.textContent = name; head.appendChild(s); }
  box.appendChild(head);
  for (const [k, label] of FIELD_ORDER) {
    const row = document.createElement("div"); row.className = "row cols" + cols.length;
    const a = document.createElement("span"); a.className = "k"; a.textContent = label; row.appendChild(a);
    const vals = cols.map(([, fields]) => fields[k]);
    const differ = vals.length === 2 && vals[0] && vals[1] && norm(vals[0]) !== norm(vals[1]);
    for (const v of vals) {
      const s = document.createElement("span");
      s.className = "v" + (v ? "" : " none") + (differ ? " diff" : "");
      s.textContent = v || "not found";
      row.appendChild(s);
    }
    box.appendChild(row);
  }

  $("result-raw-wrap").hidden = !f;
  $("result-raw").textContent = (f && f.rawText) || "";

  // Front only and something important is missing → offer the back.
  const missing = f && !b ? KEY_FIELDS.filter((k) => !f.fields[k]) : [];
  $("result-fix").hidden = !missing.length;
  if (missing.length) {
    const names = FIELD_ORDER.filter(([k]) => missing.includes(k)).map(([, l]) => l.toLowerCase());
    $("result-fix-text").textContent = `The front read missed ${names.length === 1 ? names[0] : names.length + " fields (" + names.join(", ") + ")"}.`;
  }

  const chip = $("result-chip");
  const sent = [run.front && run.front.sent, run.back && run.back.sent].filter((v) => v != null);
  if (!sent.length) { chip.textContent = "Not sent"; chip.style.color = "#fde68a"; }
  else if (sent.every(Boolean)) { chip.textContent = "Sent ✓"; chip.style.color = ""; }
  else { chip.textContent = "Partly sent"; chip.style.color = "#fde68a"; }
  show("result");
}

// ───────────────────────── start ─────────────────────────
function begin(f) {
  flow = f;
  if (f !== "backonly") saveFlow(f);
  paintFlowChoice();
  run = { front: null, back: null };
  openCamera(f === "backonly" ? "back" : "front");
}

async function start() {
  session = readSession(location.hash);
  if (!session) { show("nosession"); return; }
  try {
    key = await importKey(session.keyBytes);
  } catch {
    show("nosession"); return;
  }
  paintFlowChoice();
  show("home");
  try {
    await send({ type: "hello", meta: { device: deviceLabel() } });
    $("link-chip").textContent = "Linked to computer";
  } catch {
    $("link-chip").textContent = "Can't reach computer";
    $("link-chip").style.background = "rgba(251,191,36,0.15)";
    $("link-chip").style.color = "#fde68a";
  }
}

$("btn-flow-front").addEventListener("click", () => begin("front"));
$("btn-flow-both").addEventListener("click", () => begin("both"));
$("btn-back-only").addEventListener("click", () => begin("backonly"));
$("btn-scan-qr").addEventListener("click", async () => {
  await loadZxing().catch(() => {});
  openCamera("qr");
});
$("cam-close").addEventListener("click", () => {
  // Closing on the back step keeps the front that was already taken.
  if (mode === "back" && run && (run.front || run.frontPromise)) { if (!busy) { busy = true; skipBack(); } return; }
  closeCamera(); show(session ? "home" : "nosession");
});
$("cam-auto").addEventListener("click", () => { autoOn = !autoOn; holdStart = 0; setHold(0); paintAuto(); });
$("cam-skip").addEventListener("click", () => { if (!busy) { busy = true; skipBack(); } });
$("cam-shutter").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  if (mode === "front") await captureFront(false);
  else if (mode === "back") {
    setHint("Reading…");
    const ok = await tryBarcode(true);
    if (!ok) { setHint("Couldn't read the barcode. Move a bit closer.", "warn"); busy = false; }
  }
});
$("btn-fix-back").addEventListener("click", () => {
  // Keep the front result and add the back to it.
  flow = "fixback";
  run.frontPromise = null; run.skipped = false;
  openCamera("back");
});
$("btn-again").addEventListener("click", () => begin(flow === "backonly" ? "backonly" : getSavedFlow()));
$("btn-done").addEventListener("click", () => show("home"));
window.addEventListener("pagehide", closeCamera);

start();
