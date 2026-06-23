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
  const heading = document.querySelector('[data-screen="done"] h1');
  const checkIcon = document.querySelector(".done-check");
  if (!summary) return;

  const customer = _session.customerName || "the customer";
  const isQueued = _session.uploadStatus === "queued";

  if (isQueued) {
    // Offline path: scan saved to local queue, will upload when signal returns.
    const n = _session.photos.length;
    if (heading) heading.textContent = "Saved offline";
    if (summary) {
      summary.textContent = `Queued ${n} ${n === 1 ? "photo" : "photos"} for ${customer}. Will upload when back online.`;
    }
    if (checkIcon) checkIcon.classList.add("done-check-queued");
  } else {
    const n = _session.photos.filter((p) => p.status === "success").length;
    if (heading) heading.textContent = "All set";
    if (summary) {
      summary.textContent = `Uploaded ${n} ${n === 1 ? "photo" : "photos"} for ${customer}.`;
    }
    if (checkIcon) checkIcon.classList.remove("done-check-queued");
  }

  if (sameBtn) {
    // Queued case: the buttons still work (we'll just queue more), but
    // make it clear the prior scan hasn't actually uploaded yet.
    if (isQueued) {
      sameBtn.textContent = `Scan another for ${customer}`;
    } else {
      sameBtn.textContent = `Scan more for ${customer}`;
    }
  }
}
