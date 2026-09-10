/**
 * Docs Zoom Default — content script.
 *
 * Google Docs resets the zoom widget to 100% on every document load and offers
 * no API or setting to change that, so we drive the toolbar combobox directly.
 *
 * The widget is a Closure combo button:
 *   #zoomSelect
 *     input.goog-toolbar-combo-button-input   <- current value, e.g. "100%" / "Fit"
 *     .goog-toolbar-combo-button-dropdown     <- opens the menu
 *
 * Three things learned the hard way, each of which the code below defends against:
 *
 *  1. Closure listens for mousedown/mouseup, not click. Events go out as pairs.
 *  2. Docs pre-renders ~42 .goog-menu elements into every document, all hidden
 *     but one. "The visible menu" is therefore an unreliable handle — we locate
 *     the zoom menu by its contents instead, which works even while it is hidden,
 *     and guarantees we never click an item belonging to some other menu.
 *  3. The toolbar exists in the DOM well before Closure wires it up, and the menu
 *     can open seconds after the trigger. Poking it early makes it land on an
 *     arbitrary entry, so we wait for the editor to be ready, use a generous
 *     timeout, and verify the result rather than assuming the click took.
 *
 * Setting the input's value directly and pressing Enter does not work — Docs
 * reverts it — so the menu is the only route.
 */

const ZOOM_SELECT = '#zoomSelect';
const ZOOM_INPUT = '#zoomSelect input.goog-toolbar-combo-button-input';
const DROPDOWN = '.goog-toolbar-combo-button-dropdown';
const MENU_ITEM = '.goog-menuitem';
const EDITOR = '.kix-appview-editor';

const BOOT_TIMEOUT_MS = 30000; // Docs boots slowly on cold cache / large docs
const MENU_TIMEOUT_MS = 8000; // The menu can be slow to paint on a busy page
const SETTLE_MS = 400; // Grace period after the toolbar appears
const POLL_MS = 200;
const ATTEMPTS = 3;

/** Every value the Docs zoom menu offers, used to identify the menu itself. */
const ZOOM_VALUES = ['Fit', '50%', '75%', '90%', '100%', '125%', '150%', '200%'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fire(el, type) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
}

/** Poll a predicate until it returns something truthy, or give up. */
async function waitUntil(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(POLL_MS);
  }
  return null;
}

const isVisible = (el) => el.offsetParent !== null;

/**
 * Find the zoom menu by its contents rather than by visibility or class name.
 * Docs keeps every menu in the DOM, so this resolves before the menu is opened.
 */
function findZoomMenu() {
  return (
    [...document.querySelectorAll('.goog-menu')].find((menu) => {
      const labels = [...menu.querySelectorAll(MENU_ITEM)].map((i) => i.textContent.trim());
      return labels.length === ZOOM_VALUES.length && ZOOM_VALUES.every((v) => labels.includes(v));
    }) || null
  );
}

const currentZoom = () => {
  const input = document.querySelector(ZOOM_INPUT);
  return input ? input.value.trim() : null;
};

/**
 * Put the toolbar back the way we found it.
 *
 * Two separate bits of residue, both caused by the events being synthesised:
 *
 *  - The menu can be left standing. Escape does NOT dismiss a Closure menu; a
 *    mousedown/mouseup pair on the document body does, which is how a real click
 *    elsewhere would close it.
 *  - The pointer never "leaves" the widget, so Closure keeps
 *    goog-toolbar-combo-button-hover applied, painting a grey pill around the
 *    zoom control that reads as a still-open dropdown. mouseout/mouseleave
 *    clears it.
 */
async function cleanup() {
  const combo = document.querySelector(ZOOM_SELECT);
  if (!combo) return;

  for (let i = 0; i < 3; i++) {
    if (![...document.querySelectorAll('.goog-menu')].some(isVisible)) break;
    fire(document.body, 'mousedown');
    fire(document.body, 'mouseup');
    await sleep(200);
  }

  for (const el of [combo.querySelector(DROPDOWN), combo]) {
    if (el) {
      fire(el, 'mouseout');
      fire(el, 'mouseleave');
    }
  }
}

/** One open-menu-and-click cycle. Returns true only if the zoom actually changed. */
async function attempt(target) {
  const combo = document.querySelector(ZOOM_SELECT);
  const trigger = combo.querySelector(DROPDOWN) || combo;
  const menu = findZoomMenu();
  if (!menu) return false; // Pageless mode or a reworked menu.

  const item = [...menu.querySelectorAll(MENU_ITEM)].find(
    (el) => el.textContent.trim() === target
  );
  if (!item) return false; // Target not offered (e.g. "Fit" in Pageless mode).

  fire(trigger, 'mousedown');
  fire(trigger, 'mouseup');

  // Wait for *this* menu to actually paint before clicking into it.
  const opened = await waitUntil(() => isVisible(menu), MENU_TIMEOUT_MS);
  if (!opened) return false;

  fire(item, 'mousedown');
  fire(item, 'mouseup');

  return !!(await waitUntil(() => currentZoom() === target, 2000));
}

async function setZoom(target) {
  // Wait for the editor itself, not just the toolbar markup, then let Closure
  // finish attaching before touching anything.
  const ready = await waitUntil(
    () => document.querySelector(EDITOR) && document.querySelector(ZOOM_INPUT) && currentZoom(),
    BOOT_TIMEOUT_MS
  );
  if (!ready) return;
  await sleep(SETTLE_MS);

  for (let i = 0; i < ATTEMPTS; i++) {
    if (currentZoom() === target) break; // Already there, or a previous try landed.
    const ok = await attempt(target);
    await cleanup();
    if (ok) break;
    await sleep(400);
  }

  // Whatever happened above, never leave a menu open or the widget highlighted.
  await cleanup();
}

chrome.storage.sync.get({ zoom: 'Fit' }, ({ zoom }) => {
  // Failing silently is deliberate: a broken run leaves the doc at Docs' own
  // 100% default, which is no worse than not having the extension installed.
  setZoom(zoom).catch(() => {});
});
