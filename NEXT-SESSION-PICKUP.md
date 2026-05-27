# NEXT-SESSION-PICKUP.md

Last updated: end of 2026-05-26 evening session (v=38 shipped).

**Repo:** `github.com/dealerscangit/dealerscan-pwa` (public)
**Live URL:** `https://dealerscan.live`
**Local working dir:** `/Users/brandonbusler/Desktop/dealerscan-pwa`
**Latest cache-bust:** `v=38`
**Backend deployed version:** `1.2`

---

## State of the app as of end of this session

The PWA is now substantially polished and feature-complete for v1 rollout.
Just shipped a major polish + redesign + reliability pass:

### Home screen — fully redesigned (V2/V3 hybrid)
- Pinned status strip (top): status dot + label + settings gear
- Profile card: avatar + name + role + today's count
- Tab-pill counters: today / week / total
- Threaded vertical timeline: rows with avatars + name + photo count
  subtitle + timestamp, dot connectors with fade gradient line
- Split CTA: red "New scan" beacon + kebab menu button
- Smart loading: spinners on initial fetch with 400ms minimum visible
  time, cached re-renders paint instantly

### Camera screen
- Full-bleed black stage extending under home indicator (no rounded
  corner band)
- iOS Sketch callout suppressed via user-select: none
- "Preparing camera..." overlay during silent permission re-acquire
- Done button nudge animation after each capture
- iOS-aware haptic toggle (hidden on iOS where vibrate is unsupported)

### Settings screen
- Appearance: 5 accent color swatches (blue / purple / teal / amber / rose)
  with live CSS variable swap
- Behavior: haptics toggle (hidden iOS), nudge toggle, title-case toggle
- Account: signed-in identity, switch user
- **Health: connection status, offline queue contents, manual Drain Now
  button, storage estimate** (added this session)
- About: PWA version, live backend version check with "Redeploy needed"
  message when mismatched

### Dashboard screen
- Week chart: 7 vertical bars with today highlighted, animate from 0 height
- Stat row: peak hour, avg docs / customer, scans this week
- Top customers list (top 3 by photo count, with rank badges)
- Spinners on initial load with 400ms minimum visible time

### Quick menu (kebab popover)
- Anchored to the kebab button, animates scale+opacity from corner
- Items: Dashboard, Search, Switch user, Help, Report issue
- Smooth open + close animations
- Backdrop dismisses on tap, extends through safe-area-inset-bottom

### Offline queue (NEW this session — Concept C phase 1)
- IndexedDB-backed queue for scans captured offline
- Upload flow detects `!navigator.onLine` and queues instead of failing
- Status strip shows "Offline · N queued" so users know their work is safe
- Boot-time + online-event auto-drain with exponential backoff
- Manual "Drain now" button in Settings → Health
- Done screen shows "Saved offline · will upload when back online" with
  amber check icon when queued

### Passive animations
- Background color blooms drift (18s)
- Status dot breathing when synced (4s)
- Timeline thread comet (7s)
- Profile card avatar gradient shift (12s)
- Red CTA beacon pulse (5s)
- Counter pill active highlight (6s)
- All wrapped in `@media (prefers-reduced-motion: no-preference)`

### Performance work shipped
- Preconnect / dns-prefetch to script.google.com (saves ~100-300ms on
  first API call)
- Cache-first paint, then refresh in background
- Single round-trip `getHomeOverview` endpoint (today/week/total/
  timeline/dailyCounts/peakHour/topCustomers all in one call)
- Fallback path to legacy `getHistory` if backend is stale

### Bug fixes shipped
- Triple-counted safe-area-inset-top (status strip was huge)
- Camera stutter on first load (intrinsic 0x0 video element)
- Pink swipe action bleeding through translucent timeline cards
- Dark pixel corners on timeline rows (swipe-wrap radius mismatch)
- Bottom band on iOS PWA home indicator zone (negative margin trick)
- Screen transition translateY revealing body bg
- Timeline dot clipping (now sibling of swipe-wrap)

---

## ✅ Completed (full feature inventory)

### Core flow
- ✅ Sign-in picker (19 hardcoded salespeople tiles)
- ✅ Home screen (redesigned with timeline + counters + profile card)
- ✅ Customer picker (fuzzy search, swipe-remove, clear-X button)
- ✅ Title-case customer names (toggleable in settings)
- ✅ Real camera capture with getUserMedia
- ✅ Review screen with thumbnail grid + reorder + delete
- ✅ Upload screen with deck-card animation + per-photo status
- ✅ Done screen ("All set" / "Saved offline")
- ✅ "Scan another for this customer" / "Different customer"

### Backend (Apps Script, deployed at v1.2)
- ✅ `createCustomerFolder` with history update on every scan
- ✅ `uploadPhoto`
- ✅ `getCustomerHistory`
- ✅ `hideCustomer` / `unhideCustomer` (PWA swipe-delete)
- ✅ `getHomeOverview` (today/week/total/timeline/dailyCounts/peakHour/topCustomers)
- ✅ `getVersion` (returns 1.2)
- ✅ `getOverview` (legacy dashboard)
- ✅ Vision API for OCR (in createCustomerFolder)

### Polish & UX
- ✅ Universal back button via `[data-back]` attribute
- ✅ Custom toggle switches with iOS spring easing
- ✅ Accent color picker (5 ramps, persists in localStorage)
- ✅ Custom toast system with undo action support
- ✅ Skeleton loaders + spinner loaders for transitions
- ✅ Per-row animated entrance with sequenced dot pops
- ✅ All passive animations behind prefers-reduced-motion gate

### Infrastructure
- ✅ Domain `dealerscan.live` + GitHub Pages + HTTPS
- ✅ Cache-busting via `?v=N` query strings (currently v=38)
- ✅ Error reporting to backend (fire-and-forget)
- ✅ Version drift detection (boot-time + Settings → About)
- ✅ Preconnect to Apps Script for faster first request

### Reliability (Concept C phase 1)
- ✅ Offline queue (IndexedDB)
- ✅ Status strip "Offline · N queued" indicator
- ✅ Boot-time + online-event auto-drain
- ✅ Exponential backoff (60s × 2^attempts, capped at 1hr)
- ✅ Manual drain button in Settings → Health
- ✅ Connection / queue / storage diagnostics in Settings

---

## 🔜 Next-up (priority order)

### 1. Google Sign-In (decided: Path B — explicit allow-list)
Replaces the 19-tile picker entirely. Pre-populated registry approach
in `_DealerScan_Users.json` (already exists in SYSTEM_FOLDER_ID).

Path B = no domain restriction, any Gmail OK, allow-list lookup in the
JSON file. Each email maps to a salesperson name.

Needs:
- Google Cloud Console OAuth client ID (Brandon's action)
- Backend: `verifyToken` action + token validation gate on all other actions
- Frontend: replace `signin.js` picker with Google Identity Services button
- Token storage in sessionStorage with refresh on expiry

### 2. Edge detection / auto-crop (Concept A — phase 1)
The highest-value piece of Concept A, shippable standalone. Brandon
flagged this as the most interesting feature when reviewing the
mockups. Investigation needed for tomorrow's session:
- jscanify on mobile web — is it performant enough?
- Alternative: OpenCV.js (heavier but proven)
- Simpler approach: corner detection via canvas pixel sampling
- Quality gate (blur + lighting detection) is a related cheap win

### 3. Face ID / PIN lock (Concept C phase 2)
WebAuthn for biometric prompt. Auto-lock after 15min idle. Store
lastActiveAt in localStorage, check on boot. Skipped tonight due to
complexity; will pair well with Google Sign-In since auth context will
already be top-of-mind.

---

## 🔮 Future (queued in priority order)

### Concept A — Smart Capture (full)
- Quality gate (blur / lighting detection before upload) — easy
- Multi-page combine into single PDF — medium
- Voice dictation for customer name — easy
- Quick scan templates ("License + Insurance" preset) — medium

### Concept B — Customer Memory (full)
- New `CustomerProfile` sheet in backend
- Customer profile cards with vehicle / status / notes
- Required-docs checklist per customer type
- Follow-up reminder notifications
- Quick handoff to coworker

### Concept C — remaining pieces
- Bandwidth-aware compression (auto-resize on weak signal)
- Activity audit log (who scanned what, when)
- Pre-staged manager dashboard (see across all 19 salespeople)

### Out of scope (codified)
- Folder browsing in PWA — belongs in the Chrome extension
- jscanify desktop — covered by extension
- Multi-orientation camera — single rear-cam orientation only

---

## How to test offline mode locally

1. Open `https://dealerscan.live` on iPhone in standalone PWA mode
2. Toggle Airplane mode ON
3. Tap New Scan, pick a customer, take 1-2 photos, tap Upload
4. Done screen should say "Saved offline · Will upload when back online"
5. Home screen status strip should say "Offline · 1 queued"
6. Settings → Health should show the queued customer name
7. Toggle Airplane mode OFF
8. Watch the status strip flip: "Syncing · 1 queued" → "Synced"
9. The scan should appear in the customer's Drive folder

---

## Backend deploy reminder

`backend/Code.gs` currently at version 1.2 (deployed). If you make
backend changes:
1. Bump `getVersion` return value (e.g., 1.2 → 1.3)
2. Bump `EXPECTED_BACKEND_VERSION` in `scripts/versionCheck.js`
3. Paste `Code.gs` into Apps Script editor
4. Deploy → Manage deployments → Edit existing → Version: New → Deploy
5. The PWA's Settings → About will show green "deployed 1.3 ✓"
