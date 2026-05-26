// scripts/screens/done.js
// Screen 7: success confirmation. Two choices: scan more for same customer,
// or pick a different customer.

let _showScreen = null;
let _session = null;

export function attachDoneHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const sameBtn = document.getElementById("btn-scan-another-same");
  const diffBtn = document.getElementById("btn-scan-different");

  if (sameBtn) {
    sameBtn.addEventListener("click", () => {
      // Keep the same customer + folder; reset only photos.
      _session.photos = [];
      _showScreen("camera");
    });
  }
  if (diffBtn) {
    diffBtn.addEventListener("click", () => {
      _session.reset();
      _showScreen("customer");
    });
  }
}

export function renderDone() {
  const summary = document.getElementById("done-summary");
  const sameBtn = document.getElementById("btn-scan-another-same");
  if (!summary) return;

  const n = _session.photos.filter((p) => p.status === "success").length;
  const customer = _session.customerName || "the customer";
  summary.textContent = `Uploaded ${n} ${n === 1 ? "photo" : "photos"} for ${customer}.`;

  if (sameBtn) {
    sameBtn.textContent = `Scan more for ${customer}`;
  }
}
