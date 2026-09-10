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
cleans up after itself, then watches briefly to make sure the value sticks.

Four things learned by testing against live documents, each of which the code now
defends against:

1. **Closure listens for `mousedown`/`mouseup`, not `click`.** Events go out as
   pairs. A plain `click` does nothing at all.
2. **The zoom menu does not exist until the dropdown is opened for the first
   time.** A document loads with ~40 other `.goog-menu` elements already present,
   none of them the zoom menu. Version 1.0.0 searched for the menu *before*
   opening it, found nothing, and silently did nothing — that was the bug that
   made the first release a no-op. We now always open first and look after.
3. **Because ~40 menus are present, "the visible menu" is a weak handle.** The
   zoom menu is matched on its contents — a visible menu containing every zoom
   value — so we can never click an item belonging to some other menu.
4. **The toolbar exists in the DOM well before Closure wires it up**, and a cold
   load has been observed taking **17 seconds** just to render it. A single
   cleanup pass cannot win that race — the menu can paint *after* cleanup has
   looked and given up, which is how 1.0.1 left the dropdown hanging open. The
   script now watches for 12 seconds after applying, closing the menu whenever it
   reappears and re-applying the zoom if it drifts. It stops the moment you touch
   anything, so it can never fight you or close a menu you opened.

Dismissal handles two bits of residue, both caused by the events being synthesised:
the menu can be left standing (`Escape` does **not** dismiss a Closure menu — a
`mousedown` on the document body does), and the pointer never "leaves" the
widget, so Closure keeps `goog-toolbar-combo-button-hover` applied and paints a
grey pill around the control that reads as a still-open dropdown.

Setting the input's value directly and pressing Enter does not work — Docs
reverts it — so the menu is the only route.

## Debugging

The script reports its progress two ways, so a failure is never silent:

- **Console**, prefixed `[Docs Zoom Default]`
- **An attribute on `<html>`**: `data-docs-zoom-default`, readable from the page
  context without access to the extension's isolated world

States: `waiting-for-editor`, `editor-never-ready`, `already-set`,
`menu-did-not-open`, `target-not-offered`, `applied`, `drifted`, `reapplied`,
`reapply-failed`, `gave-up`, `error`.

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

Tested 2026-09-10 against live documents in Chrome:

| Case | Result |
|---|---|
| Zoom menu present on fresh load? | **No** — created lazily on first dropdown open. Root cause of the 1.0.0 no-op |
| Cold load → `Fit`, open-first | Menu found, applied, menu self-closes |
| Early fire → drift to 200% | Reproduced, then caught and corrected by the guard |
| Cleanup as drift suspect | Ruled out — value held at `Fit` across full cleanup |
| Docs re-applying its own zoom? | Ruled out — sampled 14s after load, no change |
| Menu left open / stuck hover pill | Fixed — body `mousedown` and `mouseout`/`mouseleave` |
| First-run setup tab | Renders correctly in light and dark; compact popup unaffected |
| Cold load timing (slow case) | Toolbar took 17s to render; zoom applied at 21s — hence the 12s watch window |
