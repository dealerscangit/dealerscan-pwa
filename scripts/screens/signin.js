// scripts/screens/signin.js
// Screen 1: salesperson tile picker.

import { SALESPEOPLE, setCurrentSalesperson } from "../currentUser.js";

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
    tile.addEventListener("click", () => {
      setCurrentSalesperson(name);
      _showScreen("home");
    });
    grid.appendChild(tile);
  });
}
