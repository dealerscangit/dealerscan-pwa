// scripts/scanTest/main.js
// DealerScan license scan TEST page (dev only). Front = OCR of printed text,
// back = PDF417 barcode. Results are encrypted and sent to the desktop test
// extension so the two can be compared. Nothing is stored on a server
// except the encrypted mailbox message, which expires in 10 minutes.

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
const STABLE_SAMPLES = 5;  // consecutive passing samples before auto-capture

const $ = (id) => document.getElementById(id);
const screens = ["nosession", "home", "camera", "working", "result"];
function show(name) {
  for (const s of screens) $("screen-" + s).hidden = s !== name;
}

let session = null;
let key = null;
let stream = null;
let loopTimer = null;
let mode = null;          // "front" | "back" | "qr"
let camOpenedAt = 0;
let busy = false;
let stableCount = 0;
let lastQuality = null;
let lastResult = null;

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

// ───────────────────────── camera ─────────────────────────
async function openCamera(m) {
  mode = m;
  busy = false; stableCount = 0; lastQuality = null;
  const frame = $("cam-frame");
  frame.className = m === "qr" ? "square" : "";
  $("cam-title").textContent = m === "front" ? "Front of license" : m === "back" ? "Back of license" : "Desktop QR code";
  $("cam-sub").textContent = m === "qr" ? "Point at the QR code" : m === "front" ? "Auto-capture is on" : "Reads the barcode automatically";
  $("cam-frame-label").textContent = m === "back" ? "Fit the whole barcode in the frame" : m === "qr" ? "QR code inside the square" : "Line up the license inside the frame";
  $("cam-status").textContent = m === "front" ? "Hold the card flat and fill the frame." : m === "back" ? "Hold steady until it reads." : "";
  $("cam-shutter").hidden = m === "qr";
  document.querySelector(".checks").hidden = m === "qr";
  setHint("Starting camera…");
  show("camera");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    });
  } catch (err) {
    closeCamera();
    alert("Camera access is needed for this test. Allow it in Settings → Safari → Camera, then try again.");
    show(session ? "home" : "nosession");
    return;
  }
  const video = $("cam-video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  camOpenedAt = performance.now();
  if (m !== "front") loadZxing().catch(() => setHint("Couldn't load the barcode reader", "warn"));
  if (m === "front") loadScript(TESSERACT_URL).catch(() => {});
  setHint(m === "front" ? "Line up the card" : m === "back" ? "Looking for the barcode…" : "Looking for the QR code…");
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
// their start/stop edges, so they're read from a slightly wider area.
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

// Sharpness (Laplacian variance), mean brightness, and glare share.
function measure(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let sum = 0, blown = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    lum[j] = l; sum += l; if (px[i] >= 252 && px[i + 1] >= 252 && px[i + 2] >= 252) blown++;
  }
  let lapSum = 0, lapSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = lum[i - w] + lum[i + w] + lum[i - 1] + lum[i + 1] - 4 * lum[i];
      lapSum += v; lapSq += v * v; n++;
    }
  }
  const mean = lapSum / n;
  return {
    sharp: Math.round(lapSq / n - mean * mean),
    bright: Math.round(sum / (w * h)),
    glare: blown / (w * h),
  };
}

function paintChecks(q) {
  const set = (id, ok, val) => {
    const el = $(id);
    el.className = "chk " + (ok ? "ok" : "bad");
    el.querySelector("small").textContent = val;
  };
  const sharpOk = q.sharp >= SHARP_MIN;
  const brightOk = q.bright >= BRIGHT_MIN && q.bright <= BRIGHT_MAX;
  const glareOk = q.glare <= GLARE_MAX;
  set("chk-sharp", sharpOk, String(q.sharp));
  set("chk-bright", brightOk, String(q.bright));
  set("chk-glare", glareOk, (q.glare * 100).toFixed(1) + "%");
  return { sharpOk, brightOk, glareOk, all: sharpOk && brightOk && glareOk };
}

async function tick() {
  if (busy || !stream) return;
  const small = grabCanvas(320);
  if (!small) return;

  if (mode === "qr") {
    busy = true;
    try { await tryQr(); } finally { busy = false; }
    return;
  }

  const q = measure(small);
  lastQuality = q;
  const c = paintChecks(q);
  const frame = $("cam-frame");

  if (mode === "back") {
    // Glare is only a tip here: the barcode's white background is supposed to be bright.
    frame.className = c.sharpOk && q.bright >= BRIGHT_MIN ? "ok" : "";
    if (q.bright < BRIGHT_MIN) setHint("Too dark. Find more light.", "warn");
    else if (q.glare > 0.08) setHint("Glare on the barcode. Tilt it slightly.", "warn");
    else setHint("Looking for the barcode…");
    busy = true;
    try { await tryBarcode(false); } finally { busy = false; }
    return;
  }

  // Front: auto-capture once checks stay green.
  frame.className = c.all ? "ok" : (!c.glareOk || !c.brightOk ? "warn" : "");
  if (!c.brightOk) setHint(q.bright < BRIGHT_MIN ? "Too dark. Find more light." : "Too bright. Move out of direct light.", "warn");
  else if (!c.glareOk) setHint("Glare on the card. Tilt it slightly.", "warn");
  else if (!c.sharpOk) setHint("Hold still… focusing");
  else setHint("Got it. Hold still…", "ok");

  stableCount = c.all ? stableCount + 1 : 0;
  if (stableCount >= STABLE_SAMPLES) {
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

async function captureFront(auto) {
  const msToCapture = Math.round(performance.now() - camOpenedAt);
  const shot = await burstBest(auto ? 4 : 2, 110, 1800);
  closeCamera();
  if (!shot) { show("home"); return; }
  show("working");
  $("working-title").textContent = "Reading the front…";
  $("working-sub").textContent = "Reading the printed text on this phone.";
  const t0 = performance.now();
  try {
    const worker = await getOcrWorker((s) => { $("working-sub").textContent = s; });
    $("working-sub").textContent = "Reading the printed text on this phone.";
    const { data } = await worker.recognize(preprocess(shot.c));
    const msRead = Math.round(performance.now() - t0);
    const parsed = parseFront(data.text || "");
    await finish("front", {
      type: "front",
      fields: parsed.fields,
      fieldsFound: parsed.fieldsFound,
      confidence: Math.round(data.confidence || 0),
      rawText: String(data.text || "").slice(0, 3000),
      meta: { auto, msToCapture, msRead, quality: shot.q, imageW: shot.c.width, imageH: shot.c.height, device: deviceLabel() },
    });
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
  closeCamera();
  const parsed = parseAamva(hit.text);
  await finish("back", {
    type: "back",
    fields: parsed.fields,
    elementsFound: parsed.elementsFound,
    meta: { auto: !manual, msToCapture, msRead, quality: lastQuality, imageW: c.width, imageH: c.height, device: deviceLabel() },
  });
  return true;
}

// ───────────────────────── result ─────────────────────────
async function finish(kind, payload) {
  lastResult = kind;
  $("result-title").textContent = kind === "front" ? "Front result" : "Back result";
  const m = payload.meta;
  $("result-meta").textContent =
    `${(m.msToCapture / 1000).toFixed(1)}s to capture · ${(m.msRead / 1000).toFixed(1)}s to read` +
    (kind === "front" ? ` · text confidence ${payload.confidence}%` : ` · ${payload.elementsFound} barcode fields`) +
    (m.auto ? " · auto" : " · manual");

  const box = $("result-fields");
  box.innerHTML = "";
  for (const [k, label] of FIELD_ORDER) {
    const row = document.createElement("div"); row.className = "row";
    const a = document.createElement("span"); a.className = "k"; a.textContent = label;
    const b = document.createElement("span"); b.className = "v" + (payload.fields[k] ? "" : " none");
    b.textContent = payload.fields[k] || "not found";
    row.append(a, b); box.appendChild(row);
  }
  $("result-raw-wrap").hidden = kind !== "front";
  $("result-raw").textContent = payload.rawText || "";

  const chip = $("result-chip");
  chip.textContent = "Sending…"; chip.style.color = "";
  show("result");
  try {
    await send(payload);
    chip.textContent = "Sent ✓";
    addLog(kind === "front" ? "Front (text)" : "Back (barcode)", true);
  } catch (err) {
    chip.textContent = "Not sent"; chip.style.color = "#fde68a";
    addLog(kind === "front" ? "Front (text)" : "Back (barcode)", false);
  }
}

// ───────────────────────── start ─────────────────────────
async function start() {
  session = readSession(location.hash);
  if (!session) { show("nosession"); return; }
  try {
    key = await importKey(session.keyBytes);
  } catch {
    show("nosession"); return;
  }
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

$("btn-front").addEventListener("click", () => openCamera("front"));
$("btn-back").addEventListener("click", () => openCamera("back"));
$("btn-scan-qr").addEventListener("click", async () => {
  await loadZxing().catch(() => {});
  openCamera("qr");
});
$("cam-close").addEventListener("click", () => { closeCamera(); show(session ? "home" : "nosession"); });
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
$("btn-again").addEventListener("click", () => openCamera(lastResult || "front"));
$("btn-done").addEventListener("click", () => show("home"));
window.addEventListener("pagehide", closeCamera);

start();
