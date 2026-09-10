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
 * Four things learned by testing against live documents, each of which the code
 * below defends against:
 *
 *  1. Closure listens for mousedown/mouseup, not click. Events go out as pairs.
 *  2. The zoom menu DOES NOT EXIST until the dropdown is opened for the first
 *     time. A document loads with ~40 other .goog-menu elements already in the
 *     DOM, none of them the zoom menu. So we always open first and look after —
 *     searching for the menu up front finds nothing and silently does nothing.
 *  3. Because ~40 menus are present, "the visible menu" is a weak handle. We
 *     match on contents (a visible menu containing every zoom value), which
 *     guarantees we never click an item belonging to some other menu.
 *  4. The toolbar exists in the DOM well before Closure wires it up, and the menu
 *     can take seconds to paint. Poking it early makes it land on an arbitrary
 *     entry, so we wait for the editor, allow a generous timeout, and verify the
 *     value actually changed rather than assuming the click took.
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
const MENU_TIMEOUT_MS = 8000; // The menu is built on first open and can be slow
const SETTLE_MS = 400; // Grace period after the toolbar appears
const POLL_MS = 200;
const ATTEMPTS = 3;
const GUARD_MS = 5000; // Watch for drift after applying, then correct it

/** Every value the Docs zoom menu offers, used to identify the menu itself. */
const ZOOM_VALUES = ['Fit', '50%', '75%', '90%', '100%', '125%', '150%', '200%'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Report progress two ways: the console for a human, and an attribute on <html>
 * so the state can be read from the page context (or by an automation tool)
 * without access to this isolated world. Cheap, and it turns a silent failure
 * into a diagnosable one.
 */
function report(state, detail) {
  document.documentElement.setAttribute('data-docs-zoom-default', state);
  console.log(`[Docs Zoom Default] ${state}`, detail ?? '');
}

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
 * The currently open zoom menu, identified by content rather than class name.
 * Only ever returns something once the dropdown has been opened at least once —
 * Docs does not build this menu until then.
 */
function openZoomMenu() {
  return (
    [...document.querySelectorAll('.goog-menu')].find((menu) => {
      if (!isVisible(menu)) return false;
      const labels = [...menu.querySelectorAll(MENU_ITEM)].map((i) => i.textContent.trim());
      return ZOOM_VALUES.every((v) => labels.includes(v));
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
  if (!combo) return false;
  const trigger = combo.querySelector(DROPDOWN) || combo;

  // Open first. The menu is built on demand, so looking for it before this
  // point finds nothing — that bug shipped in 1.0.0 and did exactly nothing.
  fire(trigger, 'mousedown');
  fire(trigger, 'mouseup');

  const menu = await waitUntil(openZoomMenu, MENU_TIMEOUT_MS);
  if (!menu) {
    report('menu-did-not-open');
    return false;
  }

  const item = [...menu.querySelectorAll(MENU_ITEM)].find(
    (el) => el.textContent.trim() === target
  );
  if (!item) {
    // "Fit" is absent in Pageless mode, and Docs could rename entries.
    report('target-not-offered', target);
    return false;
  }

  fire(item, 'mousedown');
  fire(item, 'mouseup');

  return !!(await waitUntil(() => currentZoom() === target, 2000));
}

async function setZoom(target) {
  report('waiting-for-editor', target);

  // Wait for the editor itself, not just the toolbar markup, then let Closure
  // finish attaching before touching anything.
  const ready = await waitUntil(
    () => document.querySelector(EDITOR) && document.querySelector(ZOOM_INPUT) && currentZoom(),
    BOOT_TIMEOUT_MS
  );
  if (!ready) {
    report('editor-never-ready');
    return;
  }
  await sleep(SETTLE_MS);

  if (currentZoom() === target) {
    report('already-set', target);
    return;
  }

  for (let i = 1; i <= ATTEMPTS; i++) {
    const ok = await attempt(target);
    await cleanup();
    if (ok) {
      report('applied', target + ' (attempt ' + i + ')');
      await guard(target);
      return;
    }
    await sleep(400);
    if (currentZoom() === target) {
      report('applied', target + ' (attempt ' + i + ', delayed)');
      await guard(target);
      return;
    }
  }

  report('gave-up', 'wanted ' + target + ', still ' + currentZoom());
  await cleanup();
}

/**
 * Watch briefly after a successful apply and put it back if something moves it.
 *
 * Testing turned up a rare race where the zoom ends up on an arbitrary entry
 * (200%, the last item) despite the click having been verified — it only shows
 * up when the script fires at a toolbar Closure has not finished wiring up. The
 * exact mechanism is not pinned down; rather than leave a silent wrong result,
 * this notices the drift and corrects it. Docs itself never changes the value
 * after load (sampled for 14s), so any movement here is ours to undo.
 */
async function guard(target) {
  const deadline = Date.now() + GUARD_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (currentZoom() === target) continue;
    report('drifted', 'became ' + currentZoom() + ', reapplying ' + target);
    const ok = await attempt(target);
    await cleanup();
    report(ok ? 'reapplied' : 'reapply-failed', target);
    return;
  }
}

chrome.storage.sync.get({ zoom: 'Fit' }, ({ zoom }) => {
  setZoom(zoom).catch((err) => report('error', String(err)));
});
