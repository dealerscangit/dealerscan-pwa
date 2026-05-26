# Deploying the updated Code.gs

The new `Code.gs` in this folder is a **full-file replacement**. It contains
all the existing functionality (folder creation, photo upload, history, dashboard,
archive, etc.) plus three new things:

1. **`hideCustomer` endpoint** — called by the PWA when a salesperson
   swipe-deletes a customer from their recent list
2. **`unhideCustomer` endpoint** — called by the PWA's undo toast
3. **Fix to `createCustomerFolder`** — history is now updated on EVERY
   scan, not just new-customer scans (so most-recent floats to top)

## Step-by-step deploy

1. Go to **https://script.google.com** (logged into the
   `tgchevydocs@dealerscanapp.com` account)
2. Open the existing DealerScan Apps Script project (the one with the
   live deployment)
3. In the file list on the left, click **Code.gs**
4. Select all the existing code (Cmd+A) and delete it
5. Open `Code.gs` from this folder, copy ALL of it, and paste into the
   Apps Script editor
6. Click the **Save** icon (disk) or press Cmd+S
7. Click **Deploy** (top right) → **Manage deployments**
8. Find the existing Web App deployment in the list (the one whose URL
   ends in `...AKfycbz...exec`)
9. Click the **pencil/edit icon** next to that deployment
10. In the **Version** dropdown, select **New version**
11. Add a description like "Add hideCustomer / unhideCustomer + history fix"
12. Click **Deploy**
13. **DO NOT** create a "New deployment" — that gives you a new URL and
    breaks the PWA + extension + iOS Shortcut. Always edit the existing one.

## Verifying it worked

After deploying, in a browser tab open:

```
https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec?action=hideCustomer&salesName=Brandon&customerName=TestNonExistent
```

Should return `OK` (idempotent — hiding a customer that doesn't exist is
a successful no-op).

```
https://script.google.com/macros/s/AKfycbzF13p-WRJloMRBoWiQ4h6EmR7iylkVoGxX0Y9PBpEN0RacIvfxoN_Hd15NJUSYpsQJug/exec?action=unhideCustomer&salesName=Brandon&customerName=Test
```

Should return `OK` and add "Test" to the front of Brandon's row in the
CustomerHistory sheet. Check the sheet to confirm.

## If something goes wrong

The old code is preserved in `Code-NEW.gs` in `/Users/brandonbusler/Desktop/DealerScan-Migration/apps-script-export/`
which is byte-identical to what was deployed. If the new deploy breaks
something, paste THAT back in and redeploy.

## What I changed (full diff summary)

- Added `if (action === "hideCustomer")` and `if (action === "unhideCustomer")`
  to the `doGet` dispatcher
- Added two new functions: `hideCustomer(e)` and `unhideCustomer(e)`
- Removed `if (e.parameter.isNew === "true")` guard around `saveToHistory`
  in `createCustomerFolder` — history now updates every scan

No existing functions were modified beyond that one-line guard removal.
No constants changed. No sheet structures changed. No permissions changed.
