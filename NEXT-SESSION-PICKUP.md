# NEXT-SESSION-PICKUP.md

Last updated: end of 2026-05-27 evening (v=54 shipped).

**Repo:** `github.com/dealerscangit/dealerscan-pwa` (public)
**Live URL:** `https://dealerscan.live`
**Local working dir:** `/Users/brandonbusler/Desktop/dealerscan-pwa`
**Latest cache-bust:** `v=54`
**Backend deployed version:** `1.7`

---

## State at end of this session

Massive day. Highlights:
- Concept C phase 1 shipped (offline queue + diagnostics)
- Bottom band finally killed (solid bg instead of gradient — 6 attempts to find this)
- Dev panel + role system foundation in place
- Manager-tier dashboard with team data + collapsible cards + pill search
- Announcements feature end-to-end (banner + compose modal + per-user dismiss)
- Photo upload sped up 4x via compress + parallel + optimistic UI
- Backend bumped 1.2 -> 1.7 across multiple deploys

What's pending: Google Sign-In, Face ID, view-as for dev, extension reconnection.

---

## 🎯 TOMORROW'S PRIORITIES (in order)

### Priority 1 — Google Sign-In (Path B, allow-list)

**Brandon's action items BEFORE we start:**
- Get OAuth Client ID from Google Cloud Console
  - https://console.cloud.google.com/apis/credentials
  - Create OAuth 2.0 Client ID, type "Web application"
  - Authorized JavaScript origins: `https://dealerscan.live`
  - Authorized redirect URIs: not needed for GIS button flow
  - Copy the client ID (looks like `1234567890-abc...apps.googleusercontent.com`)

**Backend work (Code.gs):**
- `verifyToken` action: accepts a Google ID token, calls Google's tokeninfo endpoint to validate, caches the result in `CacheService` for 5 min keyed by token
- Token gate wrapper for every protected action — checks the `Authorization: Bearer <token>` header (or `?token=` query param), rejects if invalid or if email isn't in registry
- Returns role + name in verifyToken response so the PWA can paint the UI without a second registry call

**Frontend work (PWA):**
- Replace `scripts/screens/signin.js` 19-tile picker with Google Identity Services button
- Load GIS script: `<script src="https://accounts.google.com/gsi/client" async defer>`
- Render a button via `google.accounts.id.renderButton`
- On credential response, POST token to backend `verifyToken`, get back {role, name, email}
- Store token in sessionStorage (`ds.auth.token`) — survives reloads, dies on tab close
- Add token to every apiClient call (Authorization header preferred, fallback to ?token= for Apps Script)
- Handle token expiry: on 401, prompt re-auth with the GIS button

**Role module update (scripts/roles.js):**
- Change `getCurrentUserRecord` from name-based to email-based lookup
- Add `getCurrentUserEmail()` reading from sessionStorage
- Update the TODO marker in roles.js (it's there waiting)

**Files needing updates:**
- `backend/Code.gs` — verifyToken + gate wrappers + bump to 1.8
- `scripts/apiClient.js` — attach token to every request
- `scripts/screens/signin.js` — replace picker with GIS button
- `scripts/currentUser.js` — replace localStorage name with sessionStorage token + email
- `scripts/roles.js` — email-based lookup
- `scripts/announcements.js` — `dismissedKey()` switches to email
- `index.html` — load GIS script

### Priority 2 — Dev "View as" picker (post-Sign-In)

Brandon (dev only) needs to inspect other users' dashboards for debugging. Post-Sign-In, "Switch user" is gone — replaced with a dev-only "View as" affordance.

**Design:**
- Settings → Account → "View as user" (only shown for dev)
- Opens a modal with the 19 users
- Tap one → sessionStorage `ds.auth.viewAs` = `{email, name}` override
- All API calls pass this email in `?viewAsEmail=` query param
- Backend: if requesting user is dev, accept the override; otherwise ignore
- UI shows a sticky banner: "Viewing as Cheyne — return to your view"
- Tap banner clears the override

**Important:** the dev user's real token still authenticates; the override only affects which user's *data* is fetched. Audit log captures both real-dev and viewed-as user.

### Priority 3 — Face ID / PIN lock

Pairs well with Sign-In since auth context is fresh.

**Design:**
- Optional setting: "Require Face ID to open the app"
- Uses WebAuthn (`navigator.credentials.create` / `get`)
- Triggers on PWA standalone open + after 15 min idle
- Lock screen: just the Face ID prompt, no other UI
- Fallback to passcode entry if Face ID fails 3 times (4-digit PIN stored hashed in localStorage)
- Setting in Settings → Security → "Lock app with Face ID" toggle

**Files:**
- `scripts/lockScreen.js` (new) — WebAuthn flow + lock UI
- `index.html` — lock-screen overlay element
- `scripts/screens/settings.js` — toggle wiring
- `scripts/app.js` — boot-time lock check + idle timer

### Priority 4 — Extension reconnection

The Chrome extension lives at `/Users/brandonbusler/Desktop/DealerScan-Migration/` — separate codebase. We left off mid-work there. Need to:

1. Audit the extension's current state (manifest, background script, content script, popup)
2. Verify Drive API calls still work with current Apps Script backend
3. Check if extension uses the same auth as PWA (it should, after Sign-In)
4. Test the full PWA-scan → extension-view flow end-to-end
5. Update extension to recognize the new role system (managers/dev see more)

**This is a separate session probably — extension audit is its own project. Don't start it until PWA Sign-In is solid.**

---

## ✅ Completed (full inventory at v=54)

### Core flow
- ✅ 19-tile sign-in picker (will be replaced by Google Sign-In)
- ✅ Home screen redesigned (V2/V3 hybrid)
- ✅ Customer picker with fuzzy search + swipe-remove + pending badges
- ✅ Camera with real getUserMedia + iOS sketch suppression
- ✅ Review with thumbnail grid + reorder + delete
- ✅ Upload screen (parallel + compress + optimistic)
- ✅ Done screen with queued state
- ✅ Title-case customer names

### Performance
- ✅ Shared data cache (home + dashboard reuse same fetch)
- ✅ Parallel prefetch at boot
- ✅ Backend CacheService for registry (5-min TTL)
- ✅ Photo compression (6-10x payload reduction)
- ✅ Parallel photo uploads
- ✅ Optimistic UI (~700ms perceived time for 3-photo scan)

### Offline / reliability
- ✅ IndexedDB offline queue
- ✅ Status strip queue indicator
- ✅ Boot-time + online-event auto-drain with exponential backoff
- ✅ Manual drain in Settings → Health
- ✅ Drain progress + toast confirmation

### Roles + dev panel
- ✅ `_DealerScan_Users.json` registry with 16 users, 3 roles
- ✅ Roles module with permission checks (hasPermission / hasPermissionSync)
- ✅ Dev panel with user management (add / edit / deactivate)
- ✅ Role badges (DEV red / MANAGER purple / SALES green)
- ✅ Home screen subtitle shows role label (Dev / Manager / Salesperson)
- ✅ Switch user hidden for non-dev (today's last commit)

### Manager features
- ✅ Backend `getTeamOverview` endpoint
- ✅ Dashboard Team section (gated on viewAllData permission)
- ✅ Team stat row (today / active / week)
- ✅ Per-salesperson today bars (collapsible)
- ✅ Recent across team (collapsible)
- ✅ Inactive today (collapsible)
- ✅ Customer search across team (pill bar at top of team section)
- ✅ Home timeline shows team-wide scans with salesperson chip (for managers)

### Announcements
- ✅ Backend endpoints: listAnnouncements / createAnnouncement / deleteAnnouncement
- ✅ Storage in `_DealerScan_Announcements.json`
- ✅ Audience: all / specific users
- ✅ TTL: 1h / 4h / 24h / 72h
- ✅ Auto-prune expired on every list
- ✅ Compose modal (manager + dev only via quick menu)
- ✅ Home banner with 6s auto-dismiss
- ✅ Per-user dismiss tracking via scoped localStorage keys

### UI polish
- ✅ Bottom band killed (solid bg, no gradient)
- ✅ Dashboard spacing tightened
- ✅ Team cards collapsed by default with live count summaries
- ✅ Settings → Health diagnostics
- ✅ 5 accent color swatches
- ✅ Custom toggle switches with iOS spring easing
- ✅ Toast system with undo
- ✅ Skeleton loaders
- ✅ Timeline row sequenced spring entrance + dot pop
- ✅ Passive ambient animations

---

## ⚠️ Open concerns for tomorrow

1. **Test the extension still works** — we haven't touched it in days. Make sure scans show up correctly.
2. **Document the "Save as JSON in SYSTEM_FOLDER" pattern** — we're using this for users + announcements; if it grows we may want a proper DB.
3. **Audit error reporting** — make sure new endpoints (announcements, registry, team) all log errors to `_DealerScan_Events`.
4. **Service Worker still NOT shipped** — intentional. Add when offline support needs to extend to JS bundles.

---

## How to resume tomorrow

1. Brandon gets the OAuth Client ID from Google Cloud Console (5 min)
2. Open this file + read backwards through SOLO-SESSION-LOG.md for recent context
3. Start with backend `verifyToken` — it's the foundation of everything else
4. Build PWA Sign-In flow on top of that
5. Then "View as" picker (uses Sign-In's identity)
6. Then Face ID (uses Sign-In's identity)
7. Save extension reconnection for a dedicated session

If at any point the app breaks during Sign-In work, the easiest rollback is reverting to commit `90eac2c` (or whatever today's last commit ends up being) on main. Sign-In should ship as a single atomic commit — don't push half-builds.
