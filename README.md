# UI Measure

Chrome extension (MV3, WXT + React) that measures element size and spacing on any page, Figma Alt-hover style. Vocabulary: [GLOSSARY.md](GLOSSARY.md). Background research: `~/Downloads/figma-measure-extension-research.md`.

## Commands

| | |
|---|---|
| `pnpm playground` | Serve the fixture page at http://localhost:4319 |
| `pnpm dev` | Watch + rebuild into `.output/chrome-mv3-dev` (dev server on :4320). Load that folder once via Load unpacked; it reloads itself on save |
| `pnpm build` | Production build in `.output/chrome-mv3` |
| `pnpm test` | Vitest for `src/core` |
| `pnpm e2e` | Build, load `.output/chrome-mv3` into headless Chrome for Testing, check the manifest (only `activeTab` + `scripting`, icons 16–128), click the toolbar icon over CDP: overlay + badge on → off → on, then measure lock (`L` + click + hover, Esc, typing/IME, reset on off) the Alt-hold chip, then selection navigation (Tab / Enter keys, Shift+click multi-select + union outline, keys ignored while typing), then the gap labels of the flex-wrap / flex-column / grid fixtures, then Blueprint (`#bp-card` boxes, radius `r 20` / `r 16` / `r 24/20`, `B` / `Esc`, and `#bp-many`: 400-box cap, `+81 hidden`, frame time while scrolling), then Copy (`C` / `J` / `P` read back from the clipboard, the copied selector finds the element again, `navigator.clipboard` fallback when the page swallows `copy`, the same on an insecure `http://uim.test` origin, error toast when the page swallows `copy`). Needs Chrome for Testing in `~/.cache/puppeteer` (`npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`) or `CHROME_PATH` |
| `pnpm typecheck` / `pnpm lint` | tsc / oxlint |

## Load in Chrome

`chrome://extensions` → Developer mode → Load unpacked → pick `ui-measure/.output/chrome-mv3` (or `chrome-mv3-dev` while `pnpm dev` runs). `.output` is hidden in the macOS picker: press ⌘⇧. to show hidden folders, or ⌘⇧G and paste the full path. Use the prod build for the manual checklist: the dev build adds `tabs` + `localhost` host permissions, which hides `activeTab` bugs.

## Use

- Toggle: toolbar icon or `Alt+Shift+M`. Badge `ON` per tab, `!` when Chrome forbids the page (chrome://, Web Store).
- Hover: outline, W × H, padding (green) and margin (orange) bands.
- Click: select the deepest element under the pointer. Page clicks are blocked while on. `Shift`+click adds / removes an element; measurements then start from the union of the selection (dashed box).
- With a selection: `Shift+Enter` parent, `Enter` first child, `Tab` / `Shift+Tab` next / previous sibling (wraps). Without one, Tab stays with the page; ignored while typing.
- Hold `Alt` and hover another element: spacing / inset / offset to the selection, dashed guides when diagonal.
- Gap (purple): when the hover target or a selected element is a flex / grid container, the empty space between consecutive children, measured between their bounds (margins and `justify-content` space included, absolute / fixed children ignored). Hover usually lands on a child: point into a gap, or select a child and press `Shift+Enter`. Hidden while measuring.
- `B`: Blueprint of the last-selected element's subtree: dashed outline and W × H for each descendant in view, hatched padding (green, with values), gaps (flex / grid containers), corner radius arcs with the clamped value (`9999px` pill → `r 16`). Wrappers the size of their only child count once; more than 8 levels or 400 boxes show `+N hidden`. Labels that don't fit are hidden; hover a box to bring its labels back. `B` or `Esc` returns to the selection. Ignored while typing; hidden while measuring.
- `C` / `J` / `P` with a selection: copy the last-selected element's spec (selector, border-box size, padding, border, radius) as CSS, JSON or a Markdown prompt for an AI agent; toast `Copied CSS` or why it failed. Works on http pages too (copy command, no extra permission). Ignored while typing; Cmd/Ctrl+C stay with the page.
- `L`: measure lock, the same as holding Alt until pressed again. Chip `⌥ lock (L)` while on. Ignored while typing in the page.
- `Esc`: leave Blueprint, then clear selection, then turn off (lock stays until the tool turns off).

## Layout

```
src/core/       pure geometry (rect, measure, gap, labels, blueprint), Copy formatters (spec) + DOM reads (dom.ts); no React, no chrome.*
src/overlay/    controller.ts (input + per-frame re-read), Overlay.tsx (SVG), clipboard.ts
src/entrypoints background.ts (toggle, badge), measure.content.tsx (shadow root + top layer)
playground/     fixture page for manual testing (also served by e2e)
e2e/smoke.mjs   pnpm e2e
public/icon/    toolbar + store icons, rendered from docs/icon.svg (16/32/48 as is, 128 with viewBox -1 -1 18 18 for store padding)
```

## Manual checklist (on your Chrome; `pnpm e2e` covers only icon click → overlay + badge)

1. Side by side / stacked / diagonal / overlap / nested card on the playground show the expected numbers.
2. Button and link do nothing while ON; work again after OFF.
3. Hold Alt, Alt+Tab away, come back: no stuck measuring chip.
4. Focus the input, press Alt / letters (`L` too) / Enter / Tab: typing and focus move still work, lock chip and selection do not change; `Esc` still exits.
5. Select inside the scroll container, scroll: outline follows. Sticky header measures correctly.
6. Open the dialog, then turn ON: overlay draws above the dialog.
7. `chrome://extensions` tab: badge shows `!`. Navigate a tab that was ON: badge clears.
8. `chrome://extensions/shortcuts`: `Alt+Shift+M` is bound (another extension may hold it).
9. Blue icon (not a letter) in the toolbar, extensions menu and `chrome://extensions`, readable in light and dark theme; red `ON` badge sits on it.
10. Select an element, press `C`, `J`, `P` and paste each into an editor, on an https page and a plain-http one: CSS / JSON / Markdown with a selector that finds the element in DevTools.

## Progress

Spec: [docs/spec.md](docs/spec.md). One ticket per file in `.scratch/ui-measure/issues/`; work the frontier (tickets whose blockers are done), one fresh session per ticket.

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 00 | v1: toggle, inspect, select, Alt-measure | — | done |
| 01 | Verify v1 on real Chrome + `pnpm e2e` probe | — | in progress (manual checklist left) |
| 02 | Extension icons | — | done (look on your Chrome: checklist 9) |
| 03 | Measure lock | 01 | done |
| 04 | Selection navigation (parent/child/sibling, Shift multi) | 01 | done |
| 05 | Flex / grid gap | 01 | done |
| 06 | Label collision | 05 | done |
| 07 | Blueprint view | 05, 06 | done |
| 08 | Copy spec (CSS / JSON / agent prompt) | 01 | done |
| 09 | Overlay stays on top + scaled box model | 01 | ready |
| 10 | Measure inside iframes | 01 | ready |
| 11 | Closed shadow roots + CSS zoom | 01 | ready |
| 12 | Publish to the Chrome Web Store | 01, 02 | ready |
| 13 | Smooth motion for hover/selection boxes | 01 | ready |

Out of scope: Firefox/Safari, plugin API, MCP bridge, pixel-based measuring, remembering ON per site.
