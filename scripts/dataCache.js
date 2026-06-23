// scripts/dataCache.js
// Module-level cache for shared backend data across screens.
//
// Why this exists: multiple screens (home, dashboard) call the same
// expensive endpoint (getHomeOverview). Each screen used to keep its
// own _lastData / _overviewCache local. That meant opening home, then
// dashboard, then home again triggered 3 fetches and ~6s of waiting.
//
// Single shared cache means: 1 fetch at boot, every screen paints
// instantly from the same data. A configurable TTL (default 60s)
// triggers a background refresh on access but still paints from
// cache while it's in flight.

const TTL_MS = 60000;  // 60s — overview considered fresh for this long, then
                       // a background refresh fires on next access. Uploads
                       // explicitly invalidate the home-overview key so new
                       // scans appear immediately rather than waiting out the TTL.

const _cache = new Map();  // key -> { value, fetchedAt, inflight }

export function getCached(key) {
  return _cache.get(key)?.value || null;
}

export function setCached(key, value) {
  _cache.set(key, { value, fetchedAt: Date.now() });
}

// Get-or-fetch. Returns cached value if fresh; otherwise fires fetcher.
// Returns { value, isStale, freshPromise? }:
//   - value: cached value if any, else null
//   - isStale: true if cache is missing or older than TTL
//   - freshPromise: present whenever we kicked off a new fetch
export async function getOrFetch(key, fetcher, ttlMs = TTL_MS) {
  const entry = _cache.get(key);
  const now = Date.now();
  const isStale = !entry || (now - entry.fetchedAt > ttlMs);

  // If we have a fresh value, return it immediately.
  if (entry && !isStale) {
    return { value: entry.value, isStale: false };
  }

  // If we have a stale value AND an in-flight fetch, return stale and let
  // caller await the freshPromise if they want fresh data.
  if (entry?.inflight) {
    return { value: entry.value, isStale: true, freshPromise: entry.inflight };
  }

  // Start a fetch. We track the inflight promise so concurrent callers
  // share it (dedup), and we ALWAYS clear the inflight marker once it
  // settles — success or failure — so a key can never get permanently
  // stuck in "a fetch is in flight" state.
  const inflight = fetcher()
    .then((value) => {
      _cache.set(key, { value, fetchedAt: Date.now() });
      return value;
    })
    .catch((err) => {
      // Keep stale cache on failure — caller decides what to do.
      if (entry) _cache.set(key, { value: entry.value, fetchedAt: entry.fetchedAt });
      throw err;
    })
    .finally(() => {
      // Clear the inflight marker on whatever entry currently holds it.
      // Read fresh from the map: the success path above already replaced
      // the entry object, so mutating the old `entry` reference would miss.
      const cur = _cache.get(key);
      if (cur && cur.inflight === inflight) {
        delete cur.inflight;
      }
    });

  // Attach inflight to entry so concurrent callers can await the same fetch
  if (entry) {
    entry.inflight = inflight;
  } else {
    _cache.set(key, { value: null, fetchedAt: 0, inflight });
  }

  return {
    value: entry?.value || null,
    isStale: true,
    freshPromise: inflight,
  };
}

export function invalidate(key) {
  _cache.delete(key);
}

export function invalidateAll() {
  _cache.clear();
}
