# DEV-AFFORDANCES.md

Tracking of all temporary dev-only code, scaffolding, and helpers added to the
PWA during development. Each item lists what it is, where it lives, why it's
there, and what to do with it before public launch.

Update this file every time we add temp code. Audit it before launch.

---

## Status legend

- 🔴 **Must remove** — exposes internals, looks unfinished, or violates
  production hygiene.
- 🟡 **Should review** — might want to keep, gate behind a debug flag, or
  rework before launch.
- 🟢 **Keep** — was added during dev but is actually production-ready.

---

## Items

### 🟢 "Switch user" link on home screen

What was previously the dev-only "Sign out" text-link has been renamed and
restyled as production UI: it now reads "Switch user" and uses proper button
styling (.meta-action) rather than a dashed-underline scaffolding look.

**Why keep:** even with Google Sign-In, salespeople sometimes share devices
(one phone, two people). Tapping Switch user lets them clear the local
session and sign in as a different person. This is real UX, not scaffolding.

**Files:**
- `index.html` — `<footer class="home-meta-footer">` inside the home screen
- `styles/main.css` — `.home-meta-footer` and `.meta-action` rule blocks
- `scripts/app.js` — `attachSignoutButton()` function and call (will be
  updated when Google Sign-In ships to log out of Google in addition to
  clearing local state)

---

### 🟢 `window.DS` debug helper (gated behind ds.debug flag)

The global debug helper is now gated behind `localStorage.getItem("ds.debug")
=== "1"`. By default it's not exposed and the console boot message doesn't
print. Salespeople won't see anything in their console.

To enable on a phone for remote inspection:
1. Open the PWA URL in Safari (not the PWA itself)
2. Paste this into the URL bar:
   `javascript:localStorage.setItem('ds.debug','1');location.reload()`
3. Reload — `window.DS` is now available, and the boot message prints
4. Connect via Mac Safari → Develop → [iPhone] → [the page] to use it

To disable again, same approach with `localStorage.removeItem('ds.debug')`.

**Why keep:** essential for diagnosing field issues without having to
redeploy debug code. Opt-in, off by default.

**File:** `scripts/app.js` — the `if (localStorage.getItem("ds.debug")...)`
block.

---

### 🟡 Version footer "DealerScan PWA · 1.0"

Small faint label at the bottom of the home screen. Updated from the earlier
"v0.1" placeholder to a confident "1.0" semver string.

**Why review:** the version string should be bumped each time we ship a
real release. Currently manual. Eventually consider tying it to git tags
or a build step.

**File:** `index.html` — `<div class="version-footer">` inside the home
screen section.

---

### 🟢 Cache-busting `?v=N` query strings on CSS/JS

Standard practice. Production-ready. Long-term improvement: replace manual
bumping with a build step that hashes file content.

**File:** `index.html` — both the CSS link and the JS script tag.

---

### ~~🔴 Camera screen stub~~ (removed 2026-05-26)
### ~~🔴 Scaffolding note on home screen~~ (removed 2026-05-26)
### ~~🔴 Plain "Sign out" text-link~~ (renamed to "Switch user" 2026-05-26)
### ~~🔴 Ungated window.DS / console.log~~ (gated behind ds.debug flag 2026-05-26)

---

## Removal checklist before public launch

Everything in the "Items" section above is now either 🟢 keep or 🟡 needs a
small string update (version footer). The 🔴 must-remove items are all
struck-through and resolved.

**Before any real public rollout to all 19 salespeople:**

- [ ] Confirm `localStorage.ds.debug` is unset on your dev phone (paste
      `javascript:localStorage.removeItem('ds.debug');location.reload()` into
      Safari URL bar after testing)
- [ ] Verify the "Switch user" button works after Google Sign-In is wired up
      (should sign out of Google + clear local session)
- [ ] Bump the version footer string to whatever real version you ship as

---

## How to add new items

When adding new temp code, append a new section above following the format:

```
### 🔴 / 🟡 / 🟢 Short name

Description.

**Why dev-only / Why review / Why keep:** ...

**Files / locations:** path + what to look for.

**Removal test:** how to verify it's gone cleanly.
```

---

## Known issues (deferred, not blocking ship)

### Slight color seam between gradient bottom and iOS home indicator zone

Faint visible line where the body's gradient ends and the fixed-position
background's solid fallback begins, around the home indicator on iOS.
Cosmetic only.

**Possible fixes to try later:**
- Single fixed-position background extending past visual viewport
- Drop gradient for a solid navy matching the extension's primary color
- `background-attachment: fixed` (was flaky before, may work in PWA standalone)
