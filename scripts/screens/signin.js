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
        // Only SET the flag — never clear it during subsequent switches.
        // If its already true from an earlier sign-in this session, leave it.
        if (sessionStorage.getItem("ds.dev_session") !== "1") {
          invalidateRegistry();  // ensure fresh role lookup
          const reg = await loadRegistry();
          const record = (reg.users || []).find(
            (u) => (u.name || "").trim().toLowerCase() === name.toLowerCase()
          );
          if (record && record.role === "dev") {
            sessionStorage.setItem("ds.dev_session", "1");
          }
        }
      } catch {}
      _showScreen("home");
    });
    grid.appendChild(tile);
  });
}
