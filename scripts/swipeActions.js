// scripts/swipeActions.js
// Reusable swipe-left-to-reveal-actions behavior, iOS Mail style.
//
// USAGE:
//   makeSwipeable(rowElement, {
//     actions: [
//       { label: "Delete", style: "destructive", onTap: () => {...} }
//     ]
//   });
//
// Wraps the row so the action button(s) sit behind it. Touch + pointer
// events drag the row left to reveal them. Threshold past 50% commits
// the swipe (locks open). Tap anywhere else snaps back closed.
//
// Works on touch (iOS) and pointer (desktop trackpad / mouse drag).

const SWIPE_THRESHOLD_RATIO = 0.4;  // drag past 40% of row width = lock open
const SWIPE_MIN_DISTANCE = 8;       // pixels before we consider it a swipe (not a tap)
const SWIPE_VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick commits even if short

let _activeSwipeRow = null; // only one row open at a time

// Tap anywhere outside an open row → close it
document.addEventListener("pointerdown", (e) => {
  if (!_activeSwipeRow) return;
  if (_activeSwipeRow.contains(e.target)) return;
  closeRow(_activeSwipeRow);
}, true);

/**
 * Attach swipe-left-to-reveal-action behavior to a row.
 * The element is wrapped in a container; the wrapper is what gets inserted
 * into the DOM in place of the original row (so the caller should call
 * makeSwipeable AFTER appending the row to its parent, or use the returned
 * wrapper).
 *
 * @param {HTMLElement} row     the row element to make swipeable
 * @param {Object}      opts
 * @param {Array}       opts.actions   array of action descriptors
 *   each action: { label, style: "destructive"|"neutral", onTap: fn }
 * @returns {HTMLElement} the wrapper element (already swapped into the DOM)
 */
export function makeSwipeable(row, opts) {
  const actions = opts.actions || [];
  if (actions.length === 0) return row;

  // Build the wrapper structure:
  //   .swipe-wrap
  //     .swipe-actions  (sits behind the row)
  //       button.swipe-action.destructive
  //     .swipe-foreground  (the row itself, slides left)
  const wrap = document.createElement("div");
  wrap.className = "swipe-wrap";

  const actionsLayer = document.createElement("div");
  actionsLayer.className = "swipe-actions";

  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `swipe-action ${action.style || "neutral"}`;
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Animate the row off-screen left then call onTap
      const fg = wrap.querySelector(".swipe-foreground");
      if (fg) fg.style.transform = "translateX(-100%)";
      setTimeout(() => action.onTap(wrap), 200);
    });
    actionsLayer.appendChild(btn);
  });

  const foreground = document.createElement("div");
  foreground.className = "swipe-foreground";

  // Swap row into wrapper
  const parent = row.parentNode;
  if (parent) parent.insertBefore(wrap, row);
  foreground.appendChild(row);
  wrap.appendChild(actionsLayer);
  wrap.appendChild(foreground);

  attachGestures(wrap, foreground, actionsLayer);
  return wrap;
}

function attachGestures(wrap, foreground, actionsLayer) {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let currentTranslate = 0;
  let openTranslate = 0;
  let isDragging = false;
  let hasMovedEnough = false;

  function onStart(e) {
    // Close any other open row first
    if (_activeSwipeRow && _activeSwipeRow !== wrap) {
      closeRow(_activeSwipeRow);
    }
    const point = pointFromEvent(e);
    startX = point.x;
    startY = point.y;
    startT = Date.now();
    isDragging = true;
    hasMovedEnough = false;
    // Read the action width AFTER it's been rendered (now that it's in DOM)
    openTranslate = -actionsLayer.getBoundingClientRect().width;
    // Existing open state? Start from that offset
    currentTranslate = wrap.classList.contains("swipe-open") ? openTranslate : 0;
    foreground.style.transition = "none";
  }

  function onMove(e) {
    if (!isDragging) return;
    const point = pointFromEvent(e);
    const dx = point.x - startX;
    const dy = point.y - startY;
    if (!hasMovedEnough) {
      // Detect direction: if more vertical than horizontal, abort (let scroll happen)
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_MIN_DISTANCE) {
        isDragging = false;
        foreground.style.transition = "";
        return;
      }
      if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
      hasMovedEnough = true;
    }
    // Once we've decided it's a horizontal swipe, prevent the page from scrolling
    if (e.cancelable && e.type === "touchmove") e.preventDefault();

    let next = currentTranslate + dx;
    // Clamp: can't drag right past 0, can rubber-band slightly past full-open
    if (next > 0) next = 0;
    if (next < openTranslate * 1.15) next = openTranslate * 1.15;
    foreground.style.transform = `translateX(${next}px)`;
  }

  function onEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    foreground.style.transition = "";

    if (!hasMovedEnough) {
      // Was just a tap, restore
      foreground.style.transform = "";
      return;
    }

    const point = pointFromEvent(e, true);
    const dx = (point.x - startX);
    const dt = Math.max(1, Date.now() - startT);
    const velocity = Math.abs(dx) / dt; // px per ms

    const finalTranslate = currentTranslate + dx;
    const rowWidth = wrap.getBoundingClientRect().width;
    const threshold = -rowWidth * SWIPE_THRESHOLD_RATIO;

    // Lock open if dragged past threshold OR flicked fast enough leftward
    const shouldOpen = finalTranslate < threshold || (dx < 0 && velocity > SWIPE_VELOCITY_THRESHOLD);

    if (shouldOpen) {
      openRow(wrap);
    } else {
      closeRow(wrap);
    }
  }

  // Touch events (iOS primary path)
  wrap.addEventListener("touchstart", onStart, { passive: true });
  wrap.addEventListener("touchmove", onMove, { passive: false });
  wrap.addEventListener("touchend", onEnd);
  wrap.addEventListener("touchcancel", onEnd);

  // Pointer events (desktop trackpad / mouse drag)
  wrap.addEventListener("pointerdown", (e) => {
    // Only respond to primary button mouse / touch / pen
    if (e.pointerType === "mouse" && e.button !== 0) return;
    onStart(e);
  });
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onEnd);
  wrap.addEventListener("pointercancel", onEnd);
}

function pointFromEvent(e, isEnd = false) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function openRow(wrap) {
  wrap.classList.add("swipe-open");
  const fg = wrap.querySelector(".swipe-foreground");
  const actionsLayer = wrap.querySelector(".swipe-actions");
  if (fg && actionsLayer) {
    fg.style.transform = `translateX(${-actionsLayer.getBoundingClientRect().width}px)`;
  }
  _activeSwipeRow = wrap;
}

function closeRow(wrap) {
  wrap.classList.remove("swipe-open");
  const fg = wrap.querySelector(".swipe-foreground");
  if (fg) fg.style.transform = "";
  if (_activeSwipeRow === wrap) _activeSwipeRow = null;
}

/**
 * Show a toast at the bottom of the screen with an optional Undo action.
 * Auto-dismisses after `timeout` ms unless Undo is tapped.
 *
 * @param {string}  message
 * @param {Object}  [opts]
 * @param {string}  [opts.actionLabel]  e.g. "Undo"
 * @param {fn}      [opts.onAction]     called when action tapped
 * @param {number}  [opts.timeout=4000]
 */
export function showToast(message, opts = {}) {
  // Remove any existing toast
  document.querySelectorAll(".toast").forEach((t) => t.remove());

  const toast = document.createElement("div");
  toast.className = "toast";

  const msg = document.createElement("span");
  msg.className = "toast-message";
  msg.textContent = message;
  toast.appendChild(msg);

  let actionTaken = false;
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", () => {
      actionTaken = true;
      opts.onAction();
      dismissToast(toast);
    });
    toast.appendChild(btn);
  }

  document.body.appendChild(toast);
  // Trigger enter animation on next frame
  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  const timeout = opts.timeout ?? 4000;
  setTimeout(() => {
    if (!actionTaken) dismissToast(toast);
  }, timeout);
}

function dismissToast(toast) {
  toast.classList.remove("toast-visible");
  setTimeout(() => toast.remove(), 250);
}
