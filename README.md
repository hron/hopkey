# HopKey

A minimal keyboard navigation Chrome extension — inspired by Vimium, without the complexity.

## Actions

| Key | Action |
|-----|--------|
| `f` | Follow link — highlight links with two-letter hints, type to open |
| `F` | Follow link in a new tab |
| `k` | Copy link URL to clipboard |
| `i` | Highlight input fields; cycle selection with <kbd>Tab</kbd> / <kbd>Shift-Tab</kbd>, <kbd>Enter</kbd> to focus, <kbd>Esc</kbd> to cancel |
| `l` | Search links by typed phrase; <kbd>Tab</kbd>/<kbd>Shift-Tab</kbd> cycle matches, <kbd>Enter</kbd> open, <kbd>Shift-Enter</kbd> new tab |
| `h` | Switch focus to the next `<iframe>` on the page (cycles back to the main document) |
| `H` | Switch focus back to the main document |

All shortcuts are reassignable via the settings page.

Per-site exceptions are also supported via the toolbar popup (click the HopKey icon).

## How hint mode works

When you press `f`, `F`, or `k`:

1. Every visible link is labelled with a two-character badge (e.g. `sa`, `df`).
2. Type the first character — non-matching hints disappear.
3. Type the second character — the action fires immediately.
4. Press `Backspace` to erase the last typed character.
5. Press `Esc` to cancel.

Hint characters default to `sadfjklewcmpgh` (home-row biased). With 14 characters you get up to 196 unique hints. For pages with ≤ 14 links every hint has a unique first character, so a single keystroke is enough to narrow it down to one.

## How frame switching works (`h` / `H`)

The content script runs inside every `<iframe>` on the page as well as the
top-level document. The instances talk to each other through `window.postMessage`
using a private sentinel (`__hopkey__`). No background service worker is needed.

- **Top frame** acts as coordinator: it queries `document.activeElement` to find
  which `<iframe>` currently has focus and routes the "focus next" message to the
  right target.
- **Child frames** delegate frame-switch requests to `window.top`.
- `H` always returns focus to the top-level document.

This means everything stays inside the tab — no cross-tab interference is possible.

## Installation

```bash
bun install
bun run build        # outputs to dist/
```

Then in Chrome:

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder

## Development

```bash
bun run build.ts --watch   # rebuilds on every file change
```

After each rebuild, click the **⟳** button on the extension card in
`chrome://extensions` to reload it.

## Settings

Open the settings page from `chrome://extensions` → HopKey → **Details** →
**Extension options**, or right-click the toolbar icon → **Options**.

You can:
- Reassign any shortcut (supports modifiers like `ctrl-` / `alt-` / `shift-`; conflict detection included)
- Add/edit/remove site exceptions (URL pattern + disabled shortcuts)
  - Multiple matching rules are merged; any matching rule with empty shortcuts disables HopKey entirely
- Change the hint character set
- Toggle uppercase hints
- Customize input-focus highlight colors (candidate + current selection)
- Toggle fuzzy matching in link-search mode
- Reset everything to defaults

Popup quick controls:
- Click the HopKey toolbar icon on any page
- See all exception rules that currently match that page
- Add/edit/remove those matching rules directly from the popup
- Leave "Disabled shortcuts" empty to disable HopKey entirely on matching pages
- Or list shortcuts (e.g. `f F i`) to disable only those shortcuts

Settings are stored in `chrome.storage.sync` and automatically synced across
Chrome profiles signed into the same Google account.

## Project layout

```
src/
  content.ts          ← single content script (injected into every frame)
  options.ts          ← settings page logic
  popup.ts            ← toolbar popup (site exceptions)
  lib/
    hints.ts          ← hint overlay engine
    input-mode.ts     ← input focus mode
    link-search-mode.ts ← phrase-based link search mode
    settings.ts       ← types, defaults, storage helpers
    exclusions.ts     ← URL-pattern matching + pass-key utilities
public/
  options.html
  options.css
  popup.html
  popup.css
scripts/
  generate-icons.ts   ← headless PNG generator (no external deps)
manifest.json
build.ts
```
