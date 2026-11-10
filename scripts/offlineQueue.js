// scripts/offlineQueue.js
// Persistent upload queue (IndexedDB). EVERY scan goes through here now,
// online or offline — photos are saved on the phone BEFORE any upload starts
// and removed one by one as each lands in Drive. That way:
//   - closing / backgrounding the app mid-upload can't lose a photo
//     (iOS suspends PWAs and kills in-flight requests), and
//   - a retry never re-sends a photo that already made it.
//
// Record shape:
//   { id, salesName, customerName, isNewCustomer, folderId|null,
//     photos: [{ dataUrl, filename, uploadId, compressed, done }],
//     queuedAt, attempts, lastError, lastAttemptAt }
//
// Drained by processQueue(): on boot, when the network comes back, when the
// app returns to the foreground, right after each scan, and from the
// "Drain now" button in Settings (which skips the retry wait).

const DB_NAME = "dealerscan-offline";
const DB_VERSION = 1;
const STORE = "queue";

// Photos uploaded at the same time per scan. All-at-once overloaded the
// backend (every request runs as the same Workspace account); one-at-a-time
// was slow. Two is the balance.
const UPLOAD_CONCURRENCY = 2;

// Automatic retry spacing after a failed attempt: 15s, 30s, 1m, 2m ...
// capped at 15 min. Manual "Drain now" ignores this.
const BACKOFF_BASE_MS = 15 * 1000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;
// After this many failed attempts, automatic drains stop trying the item
// (it stays in the queue; "Drain now" still retries it).
const AUTO_RETRY_LIMIT = 20;

let _dbPromise = null;

// Live progress for the upload screen. Fired on window as
// "dealerscan:photo-progress" with detail:
//   { itemId, index, state, fraction }
//   state: "sending" (on its way to Drive), "saved" (the backend
//          confirmed it's in Drive), "failed"
// and "dealerscan:item-progress" with { itemId, state: "uploading" |
// "done" | "failed", error? } for the scan as a whole.
function emit(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
}

function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
  });
  return _dbPromise;
}

/** Unique id for one photo upload — lets the backend ignore re-sends. */
export function newUploadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/**
 * Add a scan to the queue. Returns the assigned id.
 * @param {object} entry
 * @param {string} entry.salesName
 * @param {string} entry.customerName
 * @param {boolean} entry.isNewCustomer
 * @param {string|null} entry.folderId  // null → created when drained
 * @param {Array<{dataUrl:string, filename?:string, uploadId?:string, compressed?:boolean}>} entry.photos
 */
export async function enqueue(entry) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const record = {
      ...entry,
      photos: (entry.photos || []).map((p) => ({
        dataUrl: p.dataUrl,
        filename: p.filename || "scan.jpg",
        uploadId: p.uploadId || newUploadId(),
        compressed: !!p.compressed,
        done: false,
      })),
      queuedAt: Date.now(),
      attempts: 0,
      lastError: null,
    };
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All queued entries, oldest first. */
export async function getAll() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => a.queuedAt - b.queuedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Number of queued scans. */
export async function count() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a queued entry by id. */
export async function remove(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Read-modify-write one record in a single transaction. `mutate` changes the
// record in place; returning false skips the write. Resolves to the updated
// record, or null if it no longer exists.
async function updateRecord(id, mutate) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let result = null;
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return;
      if (mutate(record) !== false) store.put(record);
      result = record;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Record a failed attempt (drives the retry backoff). */
export async function markFailed(id, errorMessage) {
  await updateRecord(id, (record) => {
    record.attempts = (record.attempts || 0) + 1;
    record.lastError = errorMessage;
    record.lastAttemptAt = Date.now();
  });
}

/**
 * Try to upload everything in the queue.
 * @param {function} [onProgress] - ({stage, customer, current?, total?})
 * @param {object}   [opts]
 * @param {boolean}  [opts.force] - ignore retry backoff + auto-retry limit
 *                                  (the "Drain now" button)
 * Returns { uploaded, failed, remaining } — counts of SCANS.
 */
// Only one pass at a time. Triggers can fire together (boot + online +
// foreground + a new scan). A pass keeps re-checking the queue until nothing
// new is left, so an item added mid-pass still gets picked up.
let _processing = false;
let _forceRequested = false;

export async function processQueue(onProgress, opts = {}) {
  if (!navigator.onLine) {
    return { uploaded: 0, failed: 0, remaining: await count() };
  }
  if (opts.force) _forceRequested = true;
  if (_processing) {
    return { uploaded: 0, failed: 0, remaining: await count(), skipped: true };
  }
  _processing = true;
  try {
    return await _processQueueInner(onProgress);
  } finally {
    _processing = false;
    _forceRequested = false;
  }
}

function isDue(item, force) {
  if (force) return true;
  if ((item.attempts || 0) >= AUTO_RETRY_LIMIT) return false;
  if (item.attempts > 0 && item.lastAttemptAt) {
    const wait = Math.min(BACKOFF_BASE_MS * Math.pow(2, item.attempts - 1), BACKOFF_MAX_MS);
    if (Date.now() - item.lastAttemptAt < wait) return false;
  }
  return true;
}

async function _processQueueInner(onProgress) {
  // Lazy imports avoid a circular dependency on boot.
  const { createCustomerFolder, uploadPhoto } = await import("./apiClient.js");
  const { compressDataUrl } = await import("./imageCompress.js");

  let uploaded = 0;
  let failed = 0;
  const triedThisPass = new Set();

  // Keep going until a re-read of the queue has nothing new to try.
  for (;;) {
    if (!navigator.onLine) break;
    const force = _forceRequested;
    const items = (await getAll()).filter(
      (it) => !triedThisPass.has(it.id) && isDue(it, force)
    );
    if (items.length === 0) break;

    for (const item of items) {
      triedThisPass.add(item.id);
      if (!navigator.onLine) break;
      try {
        if (onProgress) onProgress({ stage: "starting", customer: item.customerName });
        emit("dealerscan:item-progress", { itemId: item.id, state: "uploading" });
        const ok = await _processItem(item, { createCustomerFolder, uploadPhoto, compressDataUrl }, onProgress);
        if (ok) {
          await remove(item.id);
          uploaded++;
          if (onProgress) onProgress({ stage: "done", customer: item.customerName });
          emit("dealerscan:item-progress", { itemId: item.id, state: "done", folderId: item.folderId || null });
        } else {
          failed++;
          emit("dealerscan:item-progress", { itemId: item.id, state: "failed" });
        }
      } catch (err) {
        console.warn("[offlineQueue] upload failed for", item.customerName, err);
        await markFailed(item.id, err?.message || String(err)).catch(() => {});
        failed++;
        emit("dealerscan:item-progress", { itemId: item.id, state: "failed", error: err?.message || String(err) });
      }
    }
  }

  return { uploaded, failed, remaining: await count() };
}

// Upload one queued scan. Returns true when every photo is in Drive.
// Each photo is marked done in IndexedDB the moment it lands, so a later
// retry only sends what's left.
async function _processItem(item, api, onProgress) {
  // 1) Folder. Remember it on the record so a retry doesn't create
  //    another one (and another "In Progress" ScanLog row).
  let folderId = item.folderId;
  if (!folderId) {
    folderId = await api.createCustomerFolder(item.customerName, item.salesName, !!item.isNewCustomer);
    await updateRecord(item.id, (r) => { r.folderId = folderId; });
    item.folderId = folderId;
  }

  // 2) Older queue entries may predate upload ids / compression — fix
  //    those up once and save, so retries stay de-duplicated.
  const pending = [];
  for (let i = 0; i < item.photos.length; i++) {
    const photo = item.photos[i];
    if (photo.done) continue;
    let changed = false;
    if (!photo.uploadId) { photo.uploadId = newUploadId(); changed = true; }
    if (!photo.compressed) {
      photo.dataUrl = await api.compressDataUrl(photo.dataUrl);
      photo.compressed = true;
      changed = true;
    }
    if (changed) {
      await updateRecord(item.id, (r) => {
        const target = r.photos[i];
        if (!target) return false;
        target.uploadId = photo.uploadId;
        target.dataUrl = photo.dataUrl;
        target.compressed = true;
      });
    }
    pending.push({ index: i, photo });
  }

  // 3) Photos, UPLOAD_CONCURRENCY at a time. A retry (attempts > 0) tells
  //    the backend to check whether the photo already landed.
  const isRetry = (item.attempts || 0) > 0;
  const total = item.photos.length;
  let finished = total - pending.length;
  let firstError = null;
  let next = 0;

  async function worker() {
    while (next < pending.length) {
      const { index, photo } = pending[next++];
      try {
        const base64 = (photo.dataUrl || "").split(",")[1] || photo.dataUrl;
        emit("dealerscan:photo-progress", { itemId: item.id, index, state: "sending", fraction: 0 });
        await api.uploadPhoto(folderId, base64, photo.filename, {
          uploadId: photo.uploadId,
          retry: isRetry,
        });
        emit("dealerscan:photo-progress", { itemId: item.id, index, state: "saved", fraction: 1 });
        await updateRecord(item.id, (r) => {
          if (!r.photos[index]) return false;
          r.photos[index].done = true;
          r.photos[index].dataUrl = ""; // free the space now it's in Drive
        });
        finished++;
        if (onProgress) {
          onProgress({ stage: "uploading", customer: item.customerName, current: finished, total });
        }
      } catch (err) {
        if (!firstError) firstError = err;
        emit("dealerscan:photo-progress", { itemId: item.id, index, state: "failed", fraction: 0 });
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(UPLOAD_CONCURRENCY, pending.length); w++) workers.push(worker());
  await Promise.all(workers);

  if (firstError) {
    await markFailed(item.id, firstError?.message || String(firstError));
    return false;
  }
  return true;
}
