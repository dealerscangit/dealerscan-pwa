# NEXT-SESSION-PICKUP.md

Last updated: end of 2026-05-27 night (v=69 shipped).

**Repo:** `github.com/dealerscangit/dealerscan-pwa` (public)
**Live URL:** `https://dealerscan.live`
**Local working dir:** `/Users/brandonbusler/Desktop/dealerscan-pwa`
**Latest cache-bust:** `v=69`
**Backend deployed version:** `1.13`

---

## State at end of this session

Massive Saturday. Today shipped:
- Concept C phase 1 (offline queue + diagnostics)
- Bottom band killed via gradient removal
- Dev panel + roles + manager-tier dashboard
- Announcements feature end-to-end
- Photo upload 4x faster (compress + parallel + optimistic)
- Sign-In foundation (verifyToken backend)
- Visible error overlay
- Dev-session flag for "stay-dev" switching
- CustomerHistory filter on home timeline + team view
- Team timeline dedup
- Cache invalidation on every render (debugging)

The PWA is FUNCTIONAL but the architecture has:
- 3 caching layers that interact in unpredictable ways
- Multiple race conditions between registry-load and permission-check
- The dashboard team section is intermittent for managers (works some times, shows zeros others)

---

## 🎯 TOMORROW'S PRIORITIES — DO THESE IN ORDER

### Priority 0 — FIX before Sign-In: Manager dashboard team section

The team data still isn't reliably showing for managers (e.g. Bryant).
Backend returns real data (verified via curl). Frontend either:
- Doesn't paint it (paintTeam runs but with zero data)
- Doesn't fire renderTeamSection until too late
- Cache returns stale empty state

Estimated 30 min to nail this with a clear head. DO NOT skip — Sign-In
shouldn't ship until the existing UI is solid.

### Priority 1 — Google Sign-In (Path B, allow-list)

**Brandon's action items BEFORE we start:**
- Get OAuth Client ID from Google Cloud Console
  - https://console.cloud.google.com/apis/credentials
  - Create OAuth 2.0 Client ID, type "Web application"
  - Authorized JavaScript origins: `https://dealerscan.live`
  - Copy the client ID (looks like `1234567890-abc...apps.googleusercontent.com`)

**Backend work (Code.gs):**
- verifyToken endpoint ALREADY EXISTS (shipped 1.8)
- Wire _requireAuth into protected actions: uploadPhoto, createCustomerFolder,
  updateUser, deleteUser, createAnnouncement, deleteAnnouncement
- Atomic with frontend ship — do NOT push backend gating before frontend
  attaches tokens, or the live app breaks

**Frontend work (PWA):**
- Replace 19-tile picker in `scripts/screens/signin.js` with Google Identity Services button
- Load GIS script in index.html: `<script src="https://accounts.google.com/gsi/client" async defer>`
- Store token in sessionStorage (`ds.auth.token`)
- Attach token to every apiClient call (header or `?token=`)
- Handle 401 → re-prompt with GIS button
- Update `scripts/roles.js`: email-based lookup (TODO marker exists in file)
- Migrate `scripts/announcements.js` `dismissedKey()` from name-scoped to email-scoped
- Replace dev_session sessionStorage hack with proper "View as" picker

**Files needing updates:**
- `backend/Code.gs` — gate wrappers + bump to 1.14
- `scripts/apiClient.js` — attach token to every request
- `scripts/screens/signin.js` — GIS button replaces picker
- `scripts/currentUser.js` — sessionStorage token + email
- `scripts/roles.js` — email-based lookup
- `scripts/announcements.js` — email-scoped dismiss keys
- `index.html` — load GIS script

**Ship as ONE atomic commit.** Test on a branch before merging to main.

### Priority 2 — Dev "View as" picker (post-Sign-In)

Replaces the dev_session hack. Brandon stays authenticated as dev,
queries impersonate another user via `?viewAsEmail=`. Sticky banner
shows "Viewing as X — return to your view."

### Priority 3 — Face ID / PIN lock

WebAuthn. Optional setting. Triggers on PWA standalone open + 15min idle.
Pairs with Sign-In since auth context is fresh.

### Priority 4 — Extension reconnection

**Separate codebase at `/Users/brandonbusler/Desktop/DealerScan-Migration/`.**
Brandon said: "We need to get the extension talking to the drive and
polishing/finishing that up." Tasks:

1. Audit current state of manifest, background script, content script, popup
2. Verify Drive API calls still work with current backend
3. Update extension to use same Sign-In token as PWA
4. Test PWA-scan → extension-view end-to-end
5. Recognize the new role system (managers/dev see more)

**Dedicated session — DO NOT start until PWA Sign-In is solid.**
The extension may carry into a third day. That's OK.

### Priority 5 — Architecture cleanup

The 3 caching layers we shipped today are fighting each other:
- Backend CacheService (5min TTL on registry)
- Frontend dataCache (5s TTL, now mostly invalidated per-render)
- Legacy _overviewCache in home.js

Collapse to ONE caching strategy. The team-section flicker we chased
tonight is symptomatic — a clean cache architecture would prevent it.

---

## ✅ Completed today (inventory)

### Core flow — unchanged
- 19-tile picker (will be replaced by Sign-In)
- Home screen V2/V3 hybrid
- Customer picker with fuzzy search + swipe-remove + pending badges
- Camera with sketch suppression
- Review with reorder + delete
- Upload (parallel + compress + optimistic)
- Done screen with queued state

### Today's adds
- Offline queue + boot/online auto-drain
- Bottom band finally killed (solid bg, no gradient)
- Photo compression (6-10x payload reduction)
- Parallel uploads (3 photos in time of 1)
- Optimistic UI (~700ms perceived time)
- Roles registry (16 users, 3 roles)
- Dev panel (user management)
- Announcements feature (banner + compose + per-user dismiss)
- Manager-tier dashboard with team section (partially working)
- Home timeline filter by CustomerHistory
- Team timeline filter by per-user CustomerHistory
- verifyToken backend endpoint (deployed but not wired into protected endpoints yet)
- Visible error overlay (saves us from blank-screen debugging)
- Dev-session flag (so dev can switch back after impersonating non-dev)

### Backend version progression
1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9 → 1.10 → 1.11 → 1.12 → 1.13

---

## ⚠️ Known issues at end of session

1. **Manager dashboard team section unreliable.** Backend returns data,
   frontend paints zeros for managers in some scenarios. Priority 0 fix.

2. **Apps Script auth fragile.** flush() calls earlier caused a permission
   crash that required manual re-auth via Apps Script IDE. Don't add
   SpreadsheetApp.flush() casually.

3. **dataCache invalidation hack.** We force-invalidate cache on every
   home and dashboard render to fix flicker. Loses perf benefit. Needs
   proper architecture cleanup.

4. **Service Worker still NOT shipped.** Intentional — add when offline
   support needs to extend to JS bundles.

---

## How to resume tomorrow

1. **Read this file** to see where we left off
2. **Pull latest:** `git pull` to make sure local is at v=69
3. **Verify backend** is alive: `curl 'https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec?action=getVersion'` should return `1.13`
4. **Fix manager dashboard team section** (Priority 0) — 30 min
5. **Brandon gets OAuth Client ID** — 5 min in Google Cloud Console
6. **Build Sign-In** — multi-hour focused session
7. **Then extension** — separate dedicated session

If at any point during Sign-In the live app breaks, easiest rollback is
reverting to commit `722a06b` (today's v=69) on main.
