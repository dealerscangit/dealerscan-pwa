# DealerScan PWA

Mobile-first Progressive Web App for in-field document scanning. Replaces the per-phone iOS Siri Shortcut with a cross-platform (iOS + Android), centrally-updatable web app installed via "Add to Home Screen."

**Live URL:** https://dealerscan.live (once DNS is live)
**Hosting:** GitHub Pages, served from `main` branch root
**Updates:** Push to `main` → live within seconds (no service worker = no stale cache)

---

## Why this exists

The previous capture path was an iOS-only Siri Shortcut that lived on each salesperson's phone with a hardcoded Apps Script URL. When the backend URL changed, every salesperson had to manually re-import. This PWA solves that — one URL, central updates, works on Android too.

See `/Users/brandonbusler/Desktop/DealerScan-Migration/architecture-questions/01-mobile-capture-path.md` for the full decision context (Option C: PWA, agreed 2026-04-30).

---

## Architecture

- **Frontend:** vanilla HTML/CSS/JS — no framework, no build step
- **Backend:** existing Apps Script Web App (shared with the Chrome extension)
- **Auth (v1):** no login — salesperson picks their name from a hardcoded list on first launch, stored in `localStorage`
- **Auth (future):** Google Sign-In via Google Identity Services SDK — swap the name-picker, everything downstream unchanged

---

## Project structure

```
dealerscan-pwa/
├── index.html              # app shell
├── manifest.json           # PWA manifest (icon, name, display mode)
├── CNAME                   # GitHub Pages custom domain
├── styles/
│   └── main.css
├── scripts/
│   ├── apiClient.js        # wraps Apps Script endpoint calls
│   ├── currentUser.js      # salesperson identity (localStorage today, OAuth later)
│   └── app.js              # main app logic (screens, state, camera)
└── icons/                  # PWA app icons (192px, 512px, apple-touch-icon)
```

---

## Local development

```bash
cd /Users/brandonbusler/Desktop/dealerscan-pwa
python3 -m http.server 8000
# Open http://localhost:8000 on your laptop browser
# Or http://<your-mac-LAN-IP>:8000 on your phone (same wifi) for real device testing
```

No build step. Edit a file, refresh the browser.

---

## Deploying

```bash
git add .
git commit -m "your message"
git push origin main
```

GitHub Pages serves the new files within ~30 seconds.

---

## Backend endpoints

All hit the existing Apps Script Web App at the URL in `scripts/apiClient.js`:

- `?action=createFolder&customerName=X&salesName=Y&isNew=true|false` → returns folder ID (plain text)
- `?action=uploadPhoto` (POST, JSON body `{folderId, photoData (base64), filename}`) → returns "OK" or "ERROR: ..."
- `?action=getHistory&salesName=Y` → returns newline-separated customer list

---

## Status

**v0 — Scaffolding** (current)
- Repo + GH Pages setup
- API client + currentUser abstraction
- App shell

**v1.0 — 1:1 Shortcut replacement** (next)
- Salesperson name picker on first launch
- Customer name + history autocomplete
- Camera capture (single or multi-photo)
- Upload + confirmation

**v1.1 — Photo queue with review** (after v1.0 is on phones)
- Multi-photo capture with thumbnail strip
- Retake, delete, reorder before upload

**v2 — Google Sign-In**
- Replace name picker with OAuth
- Salesperson list managed via backend


## What the PWA is (and isn't)

The PWA is a **capture tool**. It exists to let salespeople photograph
physical documents and get them into Drive without friction. Five-tap
flow: sign in → new scan → customer → capture → upload → done.

The PWA is NOT:
- A folder browser. Salespeople don't browse Drive on a phone. They
  browse from the extension (at their desk) or from the Drive app
  directly.
- A file manager. No rename, no move, no delete-from-Drive.
- A way to send documents to Tekion. That's the extension's job.
- A general-purpose Drive client.

The PWA only ever **writes** to Drive. It never displays existing
folder contents. The closest it comes is the recent customers list
(getHistory endpoint), which is just a list of customer names to make
"second photo for an existing customer" easy — no folder browsing.

## The two-client architecture

Chrome extension + PWA are two independent clients of the same Apps
Script backend. They don't talk to each other, they both talk to Drive
through the backend. Customer folders created by the PWA are visible
to the extension and vice versa, because the backend is one source of
truth.

```
[PWA on phone] ─────┐
                    ├──→ [Apps Script backend] ──→ [Drive: dealerscan-prod]
[Chrome extension] ─┘                                       │
                                                            ↓
                                                       [Tekion uploads via extension]
```

This separation is intentional and load-bearing — please don't add
folder-browsing features to the PWA. If a feature needs Drive browsing,
it belongs in the extension.
