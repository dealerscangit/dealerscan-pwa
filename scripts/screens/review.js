// scripts/screens/review.js
// Screen 5: review captured photos before uploading.
// Each thumb has a delete button. Tap "Upload all" to commit.

let _showScreen = null;
let _session = null;

export function attachReviewHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const uploadBtn = document.getElementById("btn-upload-all");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      if (!_session.photos.length) return;
      _showScreen("upload");
    });
  }
}

export function renderReview() {
  const grid = document.getElementById("review-grid");
  const summary = document.getElementById("review-summary");
  const uploadBtn = document.getElementById("btn-upload-all");
  if (!grid) return;

  const photos = _session.photos || [];

  if (summary) {
    const customerLabel = _session.customerName ? ` for ${_session.customerName}` : "";
    summary.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}${customerLabel}. Tap any photo to remove it.`;
  }

  if (uploadBtn) uploadBtn.disabled = photos.length === 0;

  grid.innerHTML = "";
  photos.forEach((photo, i) => {
    const thumb = document.createElement("div");
    thumb.className = "review-thumb";

    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = `Photo ${i + 1}`;

    const idx = document.createElement("span");
    idx.className = "review-thumb-index";
    idx.textContent = `${i + 1}`;

    const del = document.createElement("button");
    del.className = "review-thumb-delete";
    del.type = "button";
    del.setAttribute("aria-label", `Delete photo ${i + 1}`);
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removePhoto(photo.id);
    });

    thumb.appendChild(img);
    thumb.appendChild(idx);
    thumb.appendChild(del);
    grid.appendChild(thumb);
  });

  // If no photos remain (user deleted all), gentle empty state
  if (photos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "recent-empty muted small";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "No photos. Go back to capture some.";
    grid.appendChild(empty);
  }
}

function removePhoto(id) {
  _session.photos = _session.photos.filter((p) => p.id !== id);
  renderReview();
}
