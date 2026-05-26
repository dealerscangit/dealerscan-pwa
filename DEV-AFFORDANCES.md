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

### 🔴 Sign-out button (3 locations)

A visible "Sign out" text-link at the bottom of the home screen that clears
the salesperson from localStorage and reloads to the picker. Added because
iOS Safari's text-selection menu was hijacking a long-press gesture we tried
first. Useful for testing the picker repeatedly without clearing browser data.

**Why dev-only:** we decided in the design pass that v1 has no switch-user
affordance (one phone = one salesperson, set once). This button violates that
decision and only exists for testing.

**Files / locations:**
- `index.html` — `<footer class="dev-footer">` block inside the home screen
  section. Delete the whole `<footer>`.
- `styles/main.css` — the `.dev-footer` and `.text-link` rule blocks in the
  "DEV-ONLY footer" section. Delete both rule blocks.
- `scripts/app.js` — the `attachSignoutButton()` function AND the
  `attachSignoutButton();` line inside `DOMContentLoaded`. Delete both.

**Removal test:** sign in, confirm home screen renders without a Sign out link
and without console errors.

---

### 🟡 `window.DS` debug helper

Exposes the API client, user module, and helpers on the global `window.DS`
object so we can call them from the browser console (e.g.
`DS.user.clearCurrentSalesperson()`, `DS.api.getCustomerHistory('Brandon')`).

**Why review:** useful even after launch for support / debugging on a
salesperson's phone via remote inspector. But exposing the entire API and
helpers globally is overkill and a (very minor) attack surface.

**Recommendation:** gate behind a debug flag (e.g.
`if (localStorage.getItem('ds.debug') === '1') { window.DS = {...} }`) or trim
down to just the read-only helpers we actually need for support.

**File / location:**
- `scripts/app.js` — the `window.DS = { ... }` block near the top.

---

### 🟡 Console.log boot message

Logs "[DealerScan PWA] booted. Signed in as: ..." on every page load.
Harmless but noisy.

**Recommendation:** keep for now (helps remote debugging via Web Inspector),
remove or gate behind the same debug flag as `window.DS` before launch.

**File / location:**
- `scripts/app.js` — single `console.log` line near the top.

---

### 🔴 Scaffolding note on home screen

The dashed-border box on the home screen that says "Sign-in working. Next:
home screen with 'New Scan' button and recent activity." Pure placeholder
content. Gets replaced when we build the real home screen.

**File / location:**
- `index.html` — `<div class="scaffold-note">...</div>` inside the home
  screen section. Delete the entire div.
- `styles/main.css` — the `.scaffold-note` rule block. Can stay if we want to
  reuse the style elsewhere, or delete when no longer used.

---

### 🟢 Cache-busting `?v=N` query strings on CSS/JS

The `<link rel="stylesheet" href="styles/main.css?v=5" />` and
`<script src="scripts/app.js?v=5">` query strings.

**Why keep:** iOS Safari (and others) aggressively cache static assets. The
query string forces the browser to fetch a fresh copy whenever we bump the
version. This is standard cache-busting practice and stays in production.

**Long-term improvement:** replace the manual bumping with a build step that
hashes the file content. Not urgent.

**File / location:**
- `index.html` — both the CSS link and the JS script tag.

---

## Removal checklist (run before public launch)

- [ ] Delete `<footer class="dev-footer">` block from `index.html`
- [ ] Delete `.dev-footer` and `.text-link` rule blocks from `styles/main.css`
- [ ] Delete `attachSignoutButton()` function from `scripts/app.js`
- [ ] Delete `attachSignoutButton();` call from `DOMContentLoaded` in
      `scripts/app.js`
- [ ] Gate or remove `window.DS` debug helper in `scripts/app.js`
- [ ] Gate or remove `console.log` boot message in `scripts/app.js`
- [ ] Replace `<div class="scaffold-note">` with real home-screen content
- [ ] Bump `?v=N` cache-bust version one last time so the cleaned-up code
      actually loads on existing devices

---

## How to add new items

When adding new temp code, append a new section above following the format:

```
### 🔴 / 🟡 / 🟢 Short name

Description.

**Why dev-only / Why review / Why keep:** ...

**File / location:**
- `path/to/file` — what to look for, what to delete.

**Removal test:** how to verify it's gone cleanly.
```

Then add the removal step to the checklist above.
