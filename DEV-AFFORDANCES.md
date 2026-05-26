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

### 🔴 Camera screen stub (`scripts/screens/camera.js`)

Entire `camera.js` is a stub. Instead of opening the device camera, it shows
a "Camera coming soon" message and a button that simulates capturing 3 photos
(SVG data URLs with "Doc 1/2/3" labels on dark backgrounds). Lets the
flow review → upload → done be tested end-to-end without real camera code.

**Why dev-only:** real camera using `getUserMedia` + canvas (+ optional
jscanify for edge detection) is the biggest design decision left and was
deferred to a session where Brandon is present.

**File / location:**
- `scripts/screens/camera.js` — entire file gets replaced
- `index.html` — the `<section data-screen="camera">` body has `.camera-stub`
  content that gets replaced with viewfinder + capture button
- `styles/main.css` — `.camera-stub` and `.camera-stub-icon` / `.camera-stub h2`
  rules can be deleted once real camera UI lands

**Removal test:** tapping "New Scan" → picking customer → reaches a real
camera viewfinder, not a stub screen.

### ~~🔴 Scaffolding note on home screen~~ (removed 2026-05-26)

Previously a dashed-border placeholder. Now replaced by the real "New Scan"
primary card and recent customers list.

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
- [ ] Replace `scripts/screens/camera.js` with the real camera implementation
- [ ] Replace `<section data-screen="camera">` body in `index.html` with the
      real camera UI (viewfinder, capture button, thumbnail strip)
- [ ] Delete `.camera-stub*` rule blocks from `styles/main.css`
- [ ] Gate or remove `window.DS` debug helper in `scripts/app.js`
- [ ] Gate or remove `console.log` boot message in `scripts/app.js`
- [ ] Bump `?v=N` cache-bust version one last time so the cleaned-up code
      actually loads on existing devices

---

### 🟡 Version footer on home screen ("DealerScan PWA v0.1")

Small faint label at the bottom of the home screen showing the app version.
Helps with support ("what version are you on?") and gives polish-feel that
matches the extension.

**Why review:** the version *string* may need updating to a real semver
before launch ("v0.1" implies pre-release). Keep the element, update the text.

**File / location:**
- `index.html` — `<div class="version-footer">` inside the home screen section
- `styles/main.css` — `.version-footer` rule block

**Removal test:** N/A — this is a keep.

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

---

## Known issues (deferred, not blocking ship)

### Slight color seam between gradient bottom and iOS home indicator zone

There's a faint visible line where the body's gradient ends and the
fixed-position background layer's solid fallback color begins, around the
home indicator on iOS. We tried matching colors and adding extra gradient
stops; got close but not invisible.

**Why deferred:** purely cosmetic, doesn't affect function, salespeople
almost certainly won't notice. Comes back to it if it bothers Brandon later.

**Possible fixes to try:**
- Use a single fixed-position background that extends slightly past the
  visual viewport (negative top/bottom insets)
- Drop the gradient entirely in favor of a solid navy that matches the
  extension's actual primary color
- Use `background-attachment: fixed` on body with the gradient (was removed
  earlier as flaky in Safari — but may be fine in PWA standalone mode)

