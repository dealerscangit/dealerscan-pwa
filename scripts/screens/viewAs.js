// scripts/screens/viewAs.js
// Dev-only "View as" picker. Lets a dev inspect the app exactly as another
// salesperson sees it, WITHOUT re-authenticating. Tapping a tile sets a
// view-as override (session.setViewAs) and routes home; the dev's real
// identity and auth token are untouched. Exiting (the home banner's "Stop
// viewing") calls clearViewAs and re-renders.
//
// Why a separate screen from sign-in: the old wiring routed "View as" to the
// sign-in screen, which shows the Google button — so it looked like it was
// asking you to sign in again. This screen has no auth UI at all.

import { SALESPEOPLE, getRealSalesperson } from "../currentUser.js";
import { setViewAs } from "../auth/session.js";
import { loadRegistry } from "../roles.js";

let _showScreen = null;

export function attachViewAsHandlers(showScreen) {
  _showScreen = showScreen;
}

export async function renderViewAs() {
  const grid = document.getElementById("viewas-grid");
  if (!grid) return;
  grid.innerHTML = "";

  // Prefer the live registry (names + emails); fall back to the static
  // SALESPEOPLE roster if the registry isn't available.
  let people = [];
  try {
    const reg = await loadRegistry();
    people = (reg.users || [])
      .filter((u) => u.active !== false)
      .map((u) => ({ name: u.name, email: u.email || "" }));
  } catch { /* fall through to static list */ }
  if (people.length === 0) {
    people = SALESPEOPLE.map((name) => ({ name, email: "" }));
  }

  const me = (getRealSalesperson() || "").trim().toLowerCase();

  people
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const tile = document.createElement("button");
      tile.className = "viewas-tile";
      tile.type = "button";
      const isMe = p.name.trim().toLowerCase() === me;
      if (isMe) tile.classList.add("viewas-tile-self");

      const initial = document.createElement("span");
      initial.className = "viewas-tile-initial";
      initial.textContent = p.name.charAt(0).toUpperCase();

      const label = document.createElement("span");
      label.className = "viewas-tile-name";
      label.textContent = p.name + (isMe ? " (you)" : "");

      tile.appendChild(initial);
      tile.appendChild(label);
      tile.addEventListener("click", () => {
        if (isMe) {
          // Viewing as yourself is just a no-op return home.
          if (_showScreen) _showScreen("home");
          return;
        }
        setViewAs(p.email, p.name);
        if (_showScreen) _showScreen("home");
      });
      grid.appendChild(tile);
    });
}
