// scripts/offlineQueue.js
// Persistent queue for scans captured while offline. Survives page reloads
// via IndexedDB. The flow:
//
//   1. User taps Upload on the review screen
//   2. apiClient checks navigator.onLine
//      - online: normal upload
//      - offline: writes the scan to this queue, returns "queued"
//   3. When the app boots OR navigator fires "online", processQueue() runs
//      and tries to upload each queued item
//   4. Successful items removed; failed items keep an attempts counter and
//      retry with exponential backoff
//
// Storage cost: each photo is ~500KB-2MB as base64 data URL. The queue can
// hold many before browser quotas matter (IndexedDB gets multi-GB on iOS).

const DB_NAME = "dealerscan-offline";
const DB_VERSION = 1;
const STORE = "queue";

let _dbPromise = null;

function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Auto-incrementing primary key. The queued object includes its
        // own metadata (customerName, queuedAt, attempts) so we can
        // surface queue contents in the UI without needing indexes.
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
  });
  return _dbPromise;
}

/**
 * Add a scan to the offline queue. Returns the assigned id.
 * @param {object} entry
 * @param {string} entry.salesName
 * @param {string} entry.customerName
 * @param {boolean} entry.isNewCustomer
 * @param {string|null} entry.folderId  // null if new customer (server creates)
 * @param {Array<{dataUrl: string}>} entry.photos
 */
export async function enqueue(entry) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const record = {
      ...entry,
      queuedAt: Date.now(),
      attempts: 0,
      lastError: null,
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Return all queued entries, ordered by queuedAt ascending (oldest first).
 */
export async function getAll() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => a.queuedAt - b.queuedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Count queued items. Cheap — uses cursor count.
 */
export async function count() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a queued entry by id (call after successful upload).
 */
export async function remove(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update an entry's attempts/lastError after a failed upload.
 */
export async function markFailed(id, errorMessage) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve();
      record.attempts = (record.attempts || 0) + 1;
      record.lastError = errorMessage;
      record.lastAttemptAt = Date.now();
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Try to upload every queued item. Used on boot and on "online" event.
 * Imports the upload functions lazily to avoid a circular dependency.
 *
 * Items with too many failed attempts (10+) are kept in the queue but
 * not retried in this pass — they'd need manual intervention or longer
 * backoff. Returns { uploaded, failed, remaining } counts.
 */
export async function processQueue(onProgress) {
  if (!navigator.onLine) {
    return { uploaded: 0, failed: 0, remaining: await count() };
  }

  // Lazy import to avoid circular dep on boot
  const { createCustomerFolder, uploadPhoto } = await import("./apiClient.js");

  const items = await getAll();
  let uploaded = 0;
  let failed = 0;

  for (const item of items) {
    // Exponential backoff: skip items whose last attempt was too recent
    // given their failure count. Stops the queue from hammering a broken
    // backend on every retry.
    if (item.attempts > 0 && item.lastAttemptAt) {
      const backoffMs = Math.min(60000 * Math.pow(2, item.attempts - 1), 60 * 60000);
      if (Date.now() - item.lastAttemptAt < backoffMs) continue;
    }
    // Hard ceiling on attempts so we don't loop forever
    if (item.attempts >= 10) continue;

    try {
      if (onProgress) onProgress({ stage: "starting", customer: item.customerName });

      // Resolve folder id: existing customers have one; new customers
      // need createCustomerFolder to make one server-side.
      let folderId = item.folderId;
      if (item.isNewCustomer || !folderId) {
        folderId = await createCustomerFolder(
          item.customerName,
          item.salesName,
          true
        );
      }

      // Upload each photo sequentially. uploadPhoto takes a base64
      // string (no data:image/... prefix), so we strip that here.
      for (let i = 0; i < item.photos.length; i++) {
        if (onProgress) {
          onProgress({
            stage: "uploading",
            customer: item.customerName,
            current: i + 1,
            total: item.photos.length,
          });
        }
        const photo = item.photos[i];
        const base64 = (photo.dataUrl || "").split(",")[1] || photo.dataUrl;
        const filename = photo.filename || `scan_${i}.jpg`;
        await uploadPhoto(folderId, base64, filename);
      }

      await remove(item.id);
      uploaded++;
      if (onProgress) onProgress({ stage: "done", customer: item.customerName });
    } catch (err) {
      console.warn("[offlineQueue] upload failed for", item.customerName, err);
      await markFailed(item.id, err?.message || String(err));
      failed++;
    }
  }

  return { uploaded, failed, remaining: await count() };
}
