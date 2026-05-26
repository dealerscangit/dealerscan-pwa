# NEXT-SESSION-PICKUP.md

Picking up the **DealerScan PWA** project. This is a separate codebase from
the migration repo (which holds the extension), per the 2026-04-30 decision
to keep the two concerns clean.

**Repo:** `github.com/dealerscangit/dealerscan-pwa` (public — GH Pages requires it)
**Live URL:** `https://dealerscan.live`
**Local working dir:** `/Users/brandonbusler/Desktop/dealerscan-pwa`

---

## Where we left off (end of 2026-05-25 session)

**One full screen shipped, infrastructure complete, ready to build the next 6 screens.**

- ✅ Repo created, 17 commits, on `main` (no feature branches yet)
- ✅ Domain `dealerscan.live` bought from Squarespace, 4 A records pointing
  to GitHub Pages (185.199.108–111.153)
- ✅ GitHub Pages configured with custom domain
- ✅ HTTPS cert provisioning was still in progress at end of session — check
  `github.com/dealerscangit/dealerscan-pwa/settings/pages` to confirm green
  checkmark + "Enforce HTTPS" available
- ✅ Sign-in screen (screen 1 of 7) — 3-column tile picker, all 19 salespeople,
  one-tap select, persisted in localStorage
- ✅ Extension-matched design language adopted (navy gradient + glass cards +
  Google-blue accent + SF Pro typography, tokens lifted from
  `DealerScan-Migration/new-source/overlay.css`)
- ✅ Icons copied from Chrome extension (icon128 upscaled to 192/512/maskable-512)
- ✅ Tested on real iPhone, installed as PWA via Add to Home Screen
- ✅ DEV-AFFORDANCES.md tracking doc maintained (see file for cleanup checklist
  before public launch)

---

## Open decisions from this session, locked in

- **Auth strategy v1:** name picker stored in localStorage. v2 will replace
  with Google Sign-In, swapping only the `currentUser.js` abstraction.
- **Color mode:** dark, but not pure black — adopted extension's navy gradient
  for brand cohesion.
- **Scope:** hybrid — building UI architecture for the bigger v1 (multi-photo,
  edit before upload) but shipping the moment one full upload flow works.
- **No service worker** in v1. Trade Android install banner for instant OTA
  updates via push-to-main.
- **Switch user affordance:** hidden in production. Dev-only "Sign out" link
  on the home screen for now (logged in DEV-AFFORDANCES.md for cleanup).

---

## Still open (decide next session)

- **Brandon's customer history.** The smoke test of `getHistory?salesName=Brandon`
  returned only "New Customer" — no actual history. Three possibilities:
  (1) Brandon never personally uses the Shortcut so genuine empty state,
  (2) backend stores names differently and "Brandon" doesn't match, or
  (3) backend bug. Need to run the same call for a heavy-Shortcut-user
  (Frank? Yusuf?) before building the customer screen. **Quinn flagged this.**
- **Typo on roster:** "Keith" vs "Kieth" — Brandon wrote Kieth in the original
  list; I corrected to Keith. Confirm before launch.
- **Vision API key on backend.** Pickup doc from the migration project flagged
  that the old key was deleted. Need to confirm the new `dealerscan-prod`
  project has a working key wired up to `getVisionApiKey()` — otherwise
  driver's license auto-naming silently degrades to "Doc N". Not blocking
  PWA work but blocks ship quality.
- **Phase 4B.7 security debt:** auth tokens passed as URL query params on
  both extension and PWA endpoints. Should move to POST body / Authorization
  header before public launch.

---

## Known cosmetic issue (deferred)

Faint color seam between the gradient bottom and the iOS home-indicator zone
on installed PWA. Tried 3 fixes, got close but not invisible. See
DEV-AFFORDANCES.md "Known issues" section for the three approaches we haven't
tried yet. Not blocking ship.

---

## Build sequence — screens remaining

We're 1 of 7 done. Sequential build order based on the Shortcut walkthrough
Brandon described:

2. **Home screen** — replace the scaffolding note. Big "New Scan" affordance,
   maybe a recent-activity peek. Sage will use the extension's card patterns
   from `overlay.css` (`.suggested-folder`, `.manager-recent-card`) for
   consistency.
3. **Customer picker / new customer** — text input + history autocomplete
   from `apiClient.getCustomerHistory(salesName)`. "+ New Customer" tile to
   start a fresh folder. Backend call patterns already wrapped.
4. **Camera screen** — `getUserMedia()` viewfinder, tap to capture, no iOS
   "Use Photo" gate, thumbnail strip showing photos taken so far. This is the
   hardest screen — iOS Safari standalone has known quirks with camera
   permission prompts. Budget ~2 hours for this one alone.
5. **Review screen** — photos as a scrollable strip, tap to retake / delete /
   reorder before upload commits.
6. **Upload screen** — per-photo progress, calls `apiClient.uploadPhoto()` in
   sequence (parallel might race the backend's folder lookup).
7. **Done screen** — checkmark, customer name, "Scan another?" button that
   resets to the customer picker.

Ship moment is whenever one full single-photo flow works end-to-end. The
multi-photo queue can ship as v1.1 the next day. Brandon's pacing note from
the project: "we rolled out and then like 3 days later we stopped, i gotta
be quick to keep the interest of the people." Don't over-polish before phones
have it.

---

## How to resume

**On `dealerscan-pwa` branch:** `phase-4b-proxy` is the migration repo, not
this one. The PWA has no feature branches yet — work happens on `main`
directly until the project gets more contributors.

**To start:**
1. Read this file (you're already here)
2. Open `DEV-AFFORDANCES.md` to refresh on what's temp code
3. Glance at `index.html` to see the screen scaffolding
4. Verify HTTPS is green on `github.com/dealerscangit/dealerscan-pwa/settings/pages`
   — if it is, enable "Enforce HTTPS"
5. Re-verify the backend is alive: `curl 'https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec?action=getHistory&salesName=Frank'`
   (substitute a real heavy user — see "Brandon's customer history" above)
6. Pick up at screen 2 (home screen).

---

## Lessons from this session (so future-Claude doesn't repeat them)

- **iOS Safari aggressively caches CSS/JS.** Every visual change needs a
  fresh `?v=N` query string on the CSS link or phones won't see updates.
  Long-term fix: build step that hashes file content. For now, manual.
- **iOS rubber-band overscroll exposes the viewport background.** Use
  `overscroll-behavior-y: none` on html/body to disable it. Most native iOS
  apps disable this; users don't miss it.
- **iOS PWA standalone mode `100dvh` doesn't always cover the home indicator
  zone.** Use a `position: fixed` pseudo-element with `inset: 0` as the
  background layer for true full-screen coverage.
- **iOS caches the manifest at PWA install time and doesn't re-read on
  relaunch.** When changing icons or theme color, the user has to delete
  the PWA from home screen and reinstall via Add to Home Screen.
- **Don't pre-populate the home screen with assumptions.** First proposed
  pure-black + violet design was wrong because it ignored the existing
  extension's brand. Verify before designing.
- **The picker UX I designed was almost throwaway.** When auth is going to
  Google Sign-In in v2, the whole name picker disappears. Brandon caught it
  with one question. Logged as throwaway in DEV-AFFORDANCES.md.
