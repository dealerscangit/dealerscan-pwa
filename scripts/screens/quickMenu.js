import { updateAnnouncementMenuVisibility } from "../announcements.js";
// scripts/screens/quickMenu.js
// Popover menu anchored to the kebab button on the home screen.
// Opens via attachQuickMenuHandlers(showScreen, session) which wires
// the kebab button (#btn-quick-menu) and all menu item actions.

import { clearCurrentSalesperson } from "../currentUser.js";
import { showToast } from "../swipeActions.js";

let _showScreen = null;
let _session = null;

export function attachQuickMenuHandlers(showScreen, session) {
  _showScreen = showScreen;
  _session = session;

  const trigger = document.getElementById("btn-quick-menu");
  const menu = document.getElementById("quick-menu");
  const backdrop = document.getElementById("quick-menu-backdrop");
  if (!trigger || !menu || !backdrop) return;

  trigger.addEventListener("click", openMenu);
  backdrop.addEventListener("click", closeMenu);

  // Each menu item carries its action in data-menu-action.
  menu.querySelectorAll("[data-menu-action]").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.menuAction;
      closeMenu();
      // Defer the action 1 frame so the menu close animation gets a
      // chance to start before the next screen transition kicks in.
      requestAnimationFrame(() => handleAction(action));
    });
  });
}

function openMenu() {
  const menu = document.getElementById("quick-menu");
  if (!menu) return;
  // Refresh role-gated items each time so a user-switch is reflected
  // without a page reload. The announce item is shown only for users
  // with managerActions permission.
  updateAnnouncementMenuVisibility();
  menu.classList.remove("closing");
  menu.hidden = false;
}

function closeMenu() {
  const menu = document.getElementById("quick-menu");
  if (!menu || menu.hidden) return;

  // Add the closing class, which triggers the reverse animation, then
  // hide the element only after the animation finishes. This produces
  // a smooth scale-down + fade instead of an instant pop.
  menu.classList.add("closing");

  const panel = menu.querySelector(".quick-menu-panel");
  const onEnd = () => {
    menu.hidden = true;
    menu.classList.remove("closing");
    panel && panel.removeEventListener("animationend", onEnd);
  };
  if (panel) {
    panel.addEventListener("animationend", onEnd, { once: true });
    // Safety fallback in case animationend doesn't fire (e.g., user
    // navigates away mid-animation).
    setTimeout(() => {
      if (!menu.hidden) onEnd();
    }, 300);
  } else {
    // No panel found (shouldn't happen), hide immediately.
    onEnd();
  }
}

function handleAction(action) {
  switch (action) {
    case "dashboard":
      _showScreen("dashboard");
      break;
    case "search":
      // Search reuses the existing customer picker — no separate screen
      // needed since the picker already has fuzzy search built in.
      _session.reset();
      _showScreen("customer");
      break;
    case "switch-user":
      clearCurrentSalesperson();
      _showScreen("signin");
      break;
    case "help":
      // Placeholder. Real help content can land here later (or open
      // a URL to docs). For now, a toast acknowledges the tap.
      showToast("Help coming soon");
      break;
    case "report":
      // Mailto with prefilled subject + diagnostic info. The user's
      // mail client opens with a draft they can send to us.
      sendReport();
      break;
    case "announce":
      // The button click handler (wired in announcements.js) opens the
      // compose modal; we just need to close the menu so the modal can
      // take focus cleanly.
      closeMenu();
      break;
    default:
      console.warn("[quickMenu] unknown action:", action);
  }
}

function sendReport() {
  const subject = encodeURIComponent("DealerScan PWA issue report");
  const body = encodeURIComponent([
    "Describe the issue here:",
    "",
    "",
    "----- diagnostics -----",
    `URL: ${location.href}`,
    `User agent: ${navigator.userAgent}`,
    `Viewport: ${window.innerWidth} x ${window.innerHeight}`,
    `Device pixel ratio: ${window.devicePixelRatio}`,
    `Online: ${navigator.onLine}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n"));
  window.location.href = `mailto:brandonbusler@gmail.com?subject=${subject}&body=${body}`;
}
