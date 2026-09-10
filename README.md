# Docs Zoom Default

Chrome extension (MV3) that sets the zoom level on every Google Doc you open to a
default you choose, instead of Google's fixed 100%.

![icon](icons/icon128.png)

## Why it exists

Google Docs has no setting or API for this, and it does **not** remember your
zoom — verified by setting a document to `Fit`, reloading it, and reading the
widget back as `100%`. The only reliable approach is to drive the toolbar's zoom
dropdown on load, which is what this does.

## Install

**From the packaged zip:**

1. Unzip it anywhere you're happy to leave it — Chrome loads the extension from
   that folder every startup, so don't unzip to a temp directory
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped folder
5. Open any Google Doc — it should snap to your chosen zoom within a few seconds

Chrome shows a "Disable developer mode extensions" nag on each restart. That is
the cost of not publishing to the Web Store; dismissing it is harmless.

> **Note:** `.crx` files are deliberately not offered. Chrome has blocked
> installing them from outside the Web Store since Chrome 75 — a `.crx` would
> look like the tidier answer and simply fail to install. See
> [Sharing it with someone else](#sharing-it-with-someone-else).

## Configure

On first install the extension opens a short setup tab asking which zoom you
want — no digging through settings. After that, click the magnifying-glass
toolbar icon, or right-click it → **Options**.

Available levels (exactly what Docs itself offers): `Fit`, `50%`, `75%`, `90%`,
`100%`, `125%`, `150%`, `200%`. Default is `Fit`.

The setting uses `chrome.storage.sync`, so it follows your Chrome profile across
machines.

## Sharing it with someone else

| Method | Works? | Notes |
|---|---|---|
| **Zip + Load unpacked** | ✅ | What the release asset is. Recipient needs Developer mode |
| `.crx` file | ❌ | Blocked by Chrome outside the Web Store since Chrome 75 |
| **Chrome Web Store, unlisted** | ✅ | One-time $5 developer fee. Real one-click install, auto-updates, no nag |

For a couple of technical people, send the zip. For anything wider, the $5 is
worth it — an unlisted Web Store listing is link-only, not searchable.

## How it works

The zoom control is a Closure combo button. On document load the content script
waits for the editor, opens the zoom menu, clicks the item matching your setting,
then cleans up after itself.

Three things learned by testing against a live document, each of which the code
now defends against:

1. **Closure listens for `mousedown`/`mouseup`, not `click`.** Events go out as
   pairs. A plain `click` does nothing at all.
2. **Docs pre-renders ~42 `.goog-menu` elements into every document**, all hidden
   but one. "The visible menu" is an unreliable handle, so the zoom menu is
   located by its *contents* — the one whose items are exactly the eight zoom
   values. That works even while it is hidden and guarantees we never click an
   item belonging to some other menu.
3. **The toolbar exists in the DOM well before Closure wires it up**, and the menu
   can open seconds after the trigger. An early version fired at a half-ready
   widget, gave up waiting, and left the document on `200%` with the menu hanging
   open. The script now waits for the editor itself, allows the menu 8s to paint,
   verifies the value actually changed, and retries up to 3 times.

Cleanup handles two bits of residue, both caused by the events being synthesised:
the menu can be left standing (`Escape` does **not** dismiss a Closure menu — a
`mousedown` on the document body does), and the pointer never "leaves" the
widget, so Closure keeps `goog-toolbar-combo-button-hover` applied and paints a
grey pill around the control that reads as a still-open dropdown.

Setting the input's value directly and pressing Enter does not work — Docs
reverts it — so the menu is the only route.

## Known limitations

- **Selector fragility.** Google can change the Docs toolbar internals without
  notice. Every failure path is silent — a broken run leaves the doc at Docs' own
  100%, no worse than not having the extension. If it silently stops working, the
  selectors at the top of `content.js` are the first place to look.
- **Pageless mode.** `Fit` is not offered when a document is in pageless mode. The
  script detects the missing item and does nothing.
- **Runs once per page load.** If you change zoom manually afterward, it stays
  changed; the extension will not fight you.

## Verification log

Tested 2026-09-10 against a live document in Chrome:

| Case | Result |
|---|---|
| Cold load → `Fit` | Applied in 1.6s, 1 attempt |
| Cold load → `150%` | Applied in 3.2s, 1 attempt |
| Re-run against already-set value | 0 attempts, no menu flicker |
| Menu left open after selection | Fixed — body `mousedown` dismisses it |
| Stuck hover pill on the widget | Fixed — `mouseout`/`mouseleave` clears it |
| Docs persistence check | Reload reset to `100%` — confirms the extension is needed |
| First-run setup tab | Renders correctly in light and dark; compact popup view unaffected |
