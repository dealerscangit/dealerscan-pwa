# SOLO-SESSION-LOG.md

Decisions and findings from autonomous work while Brandon is at work / away.
Every section here is a place where Claude made a call without Brandon in
the room. Override anything by saying so — nothing here is final.

---

## Session: 2026-05-26 (morning, Brandon at work)

### Findings

#### 🟡 HTTPS cert for `dealerscan.live` not yet provisioned

`curl https://dealerscan.live` returns the default `*.github.io` cert,
not a Let's Encrypt cert issued for our domain. Means GitHub's HTTPS
provisioning is still in progress (Brandon saw this last night —
"Domain dealerscan.live is not eligible for HTTPS at this time").

**Impact:** Site works fine over HTTP. iOS PWA installs over HTTP are
allowed but flagged "Not Secure" in the URL bar. Salespeople won't see
that if they launch from home screen.

**Action:** Brandon to recheck `github.com/dealerscangit/dealerscan-pwa/settings/pages`
when he gets a chance. If green checkmark, toggle "Enforce HTTPS." If
still pending past ~24h since enabling, may need to remove/re-add the
custom domain to nudge GitHub's prober.

#### 🔴 `getHistory` endpoint returns empty for every salesperson

Smoke-tested 20 names (all 19 salespeople plus a generic "Kyle"). Every
single one returned only "New Customer" with no actual customer history.
Cannot be a single-user "I never used the Shortcut" issue.

**Possibilities (ranked):**
1. **Backend bug** in `getHistory` — exists and returns 200 but never
   surfaces real customers. Maybe looking in the wrong Drive folder.
2. **Name format mismatch** — backend stores sales names with last names
   ("Frank Lopez") so first-name-only queries miss.
3. **No data yet** in `dealerscan-prod` — unlikely if Shortcut is in
   production use.

**Blocks:** The customer-picker screen (screen 3) relies on history for
its main affordance. Without it, that screen becomes a plain text input.

**Action for Brandon when back:**
- Check `Code-NEW.gs` for the `getHistory` implementation
- Verify which Drive folder it reads from and that folder has data
- Test: hit the endpoint from a salesperson's actual phone after they've
  created a real customer through the Shortcut

**Working assumption for solo build:** Customer screen will still be
built with the history-fetch wired up. If history's empty, the screen
gracefully degrades to "no recent customers" + the text input is still
fully functional.

---

### Decisions made (all overrideable)

#### Skipping the camera screen (screen 4)

Per Brandon's explicit instruction. The camera screen has too many forks
that need a human in the room — single-shot vs continuous, retake UX,
iOS standalone-mode permission quirks, jscanify integration, etc. Solo
me would guess wrong and waste 2-3 hours.

**Instead:** building screens 2, 3, 5, 6 with a *fake camera stub* in
screen 4's slot. The stub simulates "captured 3 photos" so the flow
review→upload→done can be tested end-to-end. Real camera lands when
Brandon's back.

#### Screen 2 (home) layout

Two-card hierarchy:
1. **Primary CTA card** — "New Scan" — large, glass-style, takes most
   of the screen. Tap → goes to customer picker (screen 3).
2. **Recent activity card** — secondary, shows last 3 customers Brandon
   has scanned for (from `getHistory`). Tap a recent → jumps straight
   to camera with that customer preselected.

Pulled from the inspo references (travel apps + Syncra) — greeting at
top, big primary action, smaller secondary. No bottom nav (v1 has no
other primary screens to navigate to).

#### Screen 3 (customer picker) UX

- Single text input at top with autocomplete from history
- Below: scrollable list of recent customers (most-recent first)
- "+ New Customer" appears as a sticky bottom action when text input
  has a typed value that doesn't match any existing customer
- Tapping any recent → goes to camera screen with `isNew: false`
- Typing a new name + tapping "+ New Customer" → goes to camera with
  `isNew: true`

This mirrors the Shortcut flow Brandon described: "user selects the
customer name from the history or creates a new one"

#### Screen 4 stub (fake camera)

Will be a screen that just shows a message "Camera coming soon" and
auto-advances to the review screen with 3 placeholder thumbnails after
2 seconds. Enough to test the flow without real camera code.

Will be clearly marked as a stub in code comments + DEV-AFFORDANCES.md.

#### Screen 5 (review) layout

- Photo strip at top showing all captured photos as thumbnails
- Tap a thumbnail to see it large with retake/delete options
- Big "Upload all" button at the bottom

#### Screen 6 (upload) layout

- Per-photo progress visualization (list of filenames, spinner → check)
- No cancel button (uploads are async and partial-cancel is messy;
  v1 just lets them complete)
- Auto-advance to done screen when all uploads return OK

#### Screen 7 (done) layout

- Big checkmark
- "Uploaded N photos to [Customer Name]"
- Two buttons: "Scan another for [Customer]" and "Different customer"
- Auto-return-to-home after 30 sec of inactivity

---

### How to override anything here

Just tell me. "Don't like the home screen layout, want it more like X"
or "history-fetch finding — that's expected, here's why." All of these
decisions are scaffolding-grade, not load-bearing.

---

### What actually shipped this session (commits + tests)

**Commit `846ecb1`** — screens 2-7 built. All 19 routes wired.

**Verified after deploy:**
- `http://dealerscan.live/?v=10` → 200 OK
- `http://dealerscan.live/scripts/app.js?v=10` → 200 OK
- `http://dealerscan.live/scripts/screens/home.js` → 200 OK
- All 7 screen modules reachable

**NOT verified** (needs Brandon on a real phone):
- That tapping "New Scan" actually navigates to customer screen
- That the customer search/filter feels right typing on a phone
- That the fake-capture button on the camera stub works
- That the review thumbnail grid + delete UX is good
- That real upload actually lands in Drive (depends on `createCustomerFolder`
  and `uploadPhoto` endpoints — those have not been smoke-tested this session
  because they write data)

### To test the full flow when you're back

1. Open `https://dealerscan.live/?v=10` on your phone (or hard-reload if PWA)
2. Sign in as yourself
3. Home screen → tap "New Scan"
4. Customer screen → type a name like "Test PWA Customer"
5. Tap "+ Use as new customer"
6. Camera stub → tap "Simulate 3 photos"
7. Review screen → confirm 3 thumbnails, try deleting one
8. Tap "Upload all"
9. Upload screen → watch each photo go pending → active → success
10. Done screen → tap "Scan more for Test PWA Customer" to verify same-folder
    re-upload path works

If step 8/9 fails: backend write endpoints (`createCustomerFolder`,
`uploadPhoto`) need investigation. Open browser dev tools console for the
actual error message — `apiClient.js` throws with descriptive errors that
should pinpoint where it broke.

### Known limitations

- Camera screen is a stub (intentional, see DEV-AFFORDANCES.md)
- `getHistory` returns empty for all salespeople — customer list will be
  empty on the home and customer screens until backend is fixed
- HTTPS still pending on `dealerscan.live` — site works over HTTP
- The stub uploads SVG data URLs as "photos" — Drive will accept them but
  they'll be 1-2KB SVG files, not real JPEG photos. Vision API auto-naming
  will likely fall back to "Doc N" since there's no real image to detect.
