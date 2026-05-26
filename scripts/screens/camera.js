// scripts/screens/camera.js
// Screen 4: camera. STUB IMPLEMENTATION for solo session.
// Real camera will use getUserMedia + canvas + jscanify (TBD).
// This stub simulates 3 photos so the flow review → upload → done is testable.
//
// TODO(brandon-with-claude): replace this whole file with real camera logic.

let _showScreen = null;
let _session = null;

export function attachCameraHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const btn = document.getElementById("btn-fake-capture");
  if (btn) {
    btn.addEventListener("click", () => simulateCapture());
  }
}

export function renderCamera() {
  const label = document.getElementById("camera-customer-label");
  if (label && _session?.customerName) {
    label.textContent = `For: ${_session.customerName}${_session.isNewCustomer ? " (new)" : ""}`;
  } else if (label) {
    label.textContent = "";
  }
}

function simulateCapture() {
  // Generate 3 fake "photos" as solid-color data URLs so they render in the
  // review screen as if they were real captures. Each one has a label drawn
  // on it via SVG so we can tell them apart.
  const fakePhotos = [
    makeFakePhoto("Doc 1", "#1f2a44"),
    makeFakePhoto("Doc 2", "#26315a"),
    makeFakePhoto("Doc 3", "#1b2640"),
  ];

  _session.photos = fakePhotos.map((dataUrl, i) => ({
    id: `photo-${Date.now()}-${i}`,
    dataUrl,
    filename: `scan-${i + 1}.jpg`,
    status: "pending",
  }));

  _showScreen("review");
}

function makeFakePhoto(label, bgColor) {
  // Build a 600x800 SVG with a label, encode it as a data URL. Acts as
  // a stand-in for a real image — same shape (3:4 aspect), renders in <img>.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="${bgColor}"/>
      <text x="300" y="380" font-family="-apple-system,sans-serif" font-size="58" font-weight="700"
            fill="rgba(255,255,255,0.85)" text-anchor="middle">${label}</text>
      <text x="300" y="450" font-family="-apple-system,sans-serif" font-size="22"
            fill="rgba(255,255,255,0.4)" text-anchor="middle">stub photo</text>
    </svg>`.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
