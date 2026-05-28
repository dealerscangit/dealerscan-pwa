// scripts/screens/signin.js
// Screen 1: salesperson tile picker.

import { SALESPEOPLE, setCurrentSalesperson } from "../currentUser.js";
import { loadRegistry, invalidateRegistry } from "../roles.js";

let _showScreen = null;

export function attachSigninHandlers(showScreen) {
  _showScreen = showScreen;
}

export function renderSigninPicker() {
  const grid = document.getElementById("picker-grid");
  if (!grid) return;
  grid.innerHTML = "";
  SALESPEOPLE.forEach((name) => {
    const tile = document.createElement("button");
    tile.className = "picker-tile";
    tile.type = "button";
    tile.setAttribute("aria-label", `Sign in as ${name}`);

    const initial = document.createElement("span");
    initial.className = "picker-tile-initial";
    initial.textContent = name.charAt(0);

    const label = document.createElement("span");
    label.className = "picker-tile-name";
    label.textContent = name;

    tile.appendChild(initial);
    tile.appendChild(label);
    tile.addEventListener("click", async () => {
      setCurrentSalesperson(name);
      // Remember if the ORIGINAL sign-in was dev so we can keep the
      // Switch User affordance available even after the dev impersonates
      // a non-dev user. Without this, dev gets locked into whichever
      // user they switched to since Switch User is hidden for non-dev.
      //
      // Flag persists across user-switches but dies on tab close
      // (sessionStorage scope). When real Sign-In ships, the proper
      // View-as design replaces this hack.
      try {
        // Persist the ORIGINAL signed-in user separately from the current
        // view. This way, when dev (Brandon) switches to view another user
        // (Cheyne), we can still tell that the underlying identity is dev
        // and keep Switch User affordance visible.
        //
        // sessionStorage:
        //   ds.original_sp    = who they ACTUALLY signed in as (sticky)
        //   ds.dev_session    = "1" if original is dev (cached for speed)
        //
        // Only write original_sp if it's not already set OR the current
        // sign-in matches the existing original (re-login as self after
        // closing tab). Subsequent picker uses (switch-user) leave both
        // values intact.
        const existing = sessionStorage.getItem("ds.original_sp");
        if (!existing) {
          sessionStorage.setItem("ds.original_sp", name);
          // Look up the role and cache the dev_session flag
          invalidateRegistry();
          const reg = await loadRegistry();
          const record = (reg.users || []).find(
            (u) => (u.name || "").trim().toLowerCase() === name.toLowerCase()
          );
          if (record && record.role === "dev") {
            sessionStorage.setItem("ds.dev_session", "1");
          } else {
            sessionStorage.removeItem("ds.dev_session");
          }
        }
        // If existing is set, this is a switch — DO NOT update original_sp
        // or dev_session. The original identity stays whatever it was.
      } catch {}
      _showScreen("home");
    });
    grid.appendChild(tile);
  });
}
