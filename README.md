# UI Measure

Chrome extension (MV3, WXT + React) that measures element size and spacing on any page, Figma Alt-hover style. Vocabulary: [GLOSSARY.md](GLOSSARY.md). Background research: `~/Downloads/figma-measure-extension-research.md`.

## Commands

| | |
|---|---|
| `pnpm playground` | Serve the fixture page at http://localhost:4319 |
| `pnpm dev` | Watch + rebuild into `.output/chrome-mv3-dev` (dev server on :4320). Load that folder once via Load unpacked; it reloads itself on save |
| `pnpm build` | Production build in `.output/chrome-mv3` |
| `pnpm test` | Vitest for `src/core` |
| `pnpm e2e` | Build, load `.output/chrome-mv3` into headless Chrome for Testing, check the manifest (`activeTab` + `scripting` + `contextMenus`, hosts only as optional, icons 16–128, toggle `Ctrl+Shift+E` / mac `Command+Shift+E`), click the toolbar icon over CDP: overlay + badge on → off → on, the icon title naming the bound shortcut, then the Hint (text per state, its measure key `⌥ Option` on a Mac and `Alt` elsewhere, 16px off the pointer, flips at the corner, hidden while measuring, every label at least 4px from it and from each other), then the Alt-hold chip (`⌥ measuring` / `Alt measuring`), then selection (Esc clears, click again climbs to the next box up to the top (`<body>`, which has `<html>`'s bounds), a click elsewhere goes back down, `L` / `J` / `P` / `Tab` / `Enter` reach the page, Shift+click multi-select + union outline), then same-size wrappers (`#wrap-chain`: a click on a plain row selects its rounded same-size parent, click again the larger grid; a 10-deep chain is one box: the padded inner one with the outer `r 8` on the first click, the larger grid on the next; Shift+click the same; Alt-measure between them), then block gaps (`#bp-text`: the article's 8 / 12, none in a paragraph with inline elements), then leaders (`#leader-row` keeps `r 12` and both paddings; `#leader-dense` in Blueprint: radius and padding leaders, each ≤ 40px and crossing no label, none hopping while the Hint sweeps by), then the gap labels of the flex-wrap / flex-column / grid fixtures (the flex-column's 10 and 20 gaps labelled beside their lines), then Blueprint (`#bp-card` boxes, radius `r 20` / `r 16` / `r 24/20`, the pill's radius beside both side paddings, `B` / `Esc`, ignored while typing / composing, then Styles on `#styles-card` (`I` opens its rows (font, `#1E293B`, `#6366F1 50%`, shadow `0 4 12 0 #000000 25%`, margin `0 0 16px`, a swatch per color), 8px below / above / beside the card in the viewport, labels 4px clear of it, the Hint `I styles` / `I / Esc to close`, ignored while typing / composing, hidden while measuring, shown with Blueprint, Esc closes it before Blueprint, gone with the selection), and `#bp-many`: 400-box cap, `+81 hidden`, frame time while scrolling; CPU ms per frame (CDP `Performance.getMetrics` script + layout + style) under 8 for `#bp-many`, `#bp-blocks` (with its block gap lines), `#leader-dense`, the pointer on `#wrap-chain` and nothing selected), then Copy (`C` read back from the clipboard, the copied selector finds the element again, `navigator.clipboard` fallback when the page swallows `copy`, the same on an insecure `http://uim.test` origin, error toast when the page swallows `copy`), then the hover bands of an element in a `scale(0.5)` parent, the hover outline and a measurement line gliding between tiles and jumping under emulated `prefers-reduced-motion`, then the small-distance block at DPR 1 (the 0.25px spacing has no line or label, the 1px spacing's label sits beside its line), then a dialog and a popover opened while ON (overlay re-promoted above them in the top layer, hover measures inside), then iframes (srcdoc + same-origin frames on / off with the top, cross-origin one off with a toast naming its host, hover / select / Alt-measure / Esc inside a frame, Esc in a frame turns every frame off; a copy of the build with `http://localhost/*` granted measures inside the cross-origin frame; the permission prompt itself can't be answered headless). Needs Chrome for Testing in `~/.cache/puppeteer` (`npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`) or `CHROME_PATH` |
| `pnpm typecheck` / `pnpm lint` | tsc / oxlint |

## Load in Chrome

`chrome://extensions` → Developer mode → Load unpacked → pick `ui-measure/.output/chrome-mv3` (or `chrome-mv3-dev` while `pnpm dev` runs). `.output` is hidden in the macOS picker: press ⌘⇧. to show hidden folders, or ⌘⇧G and paste the full path. Use the prod build for the manual checklist: the dev build adds `tabs` + `localhost` host permissions, which hides `activeTab` bugs.

## Use

- Toggle: toolbar icon or `Ctrl+Shift+E` (`⌘⇧E` on a Mac; rebind at `chrome://extensions/shortcuts`, the icon title names the bound one). Badge `ON` per tab, `!` when Chrome forbids the page (chrome://, Web Store).
- Hint: a dark pill 16px below-right of the pointer names the next keys: `Click` to select; with a selection `⌥ Option` measure (`Alt` measure off a Mac) · `C` copy · `B` children · `I` styles, plus `Click` again → parent where a click would climb; in Blueprint `B` / `Esc` to exit · `I` styles; with Styles open `I` / `Esc` to close. Flips at the right / bottom edge, hidden while measuring. Labels move out of its way; a padding / gap / radius value under it is hidden until the pointer moves, never moved onto a leader.
- Hover: outline, W × H, padding (green) and margin (orange) bands, no other numbers. Moving to another element, that outline and everything on it glide together: bands, W × H, and for one selected element its padding, radius, gaps and the measurement lines. The numbers stay the final values, and Blueprint boxes stay put. No motion under `prefers-reduced-motion`. Labels are rounded with a soft shadow; size is blue, measurement red, gap purple, padding green.
- Click: select the deepest box under the pointer. Elements sharing its bounds (±0.5px, each the only child of the next) are one box, as in Blueprint: the inner one with padding or border, or a rounded wrapper over a plain child, with a wrapper's radius when the inner one has none (a padded row inside a same-size rounded card shows both on the first click). The hover outline is that same box. Click the one selected element again for the next box up, past its same-size wrappers, and the same spot again to keep climbing (stays at the top, `<body>` when it has `<html>`'s bounds; a double-click is two clicks, so it lands one box up); click another element to go back down. Page clicks are blocked while on. One selected element shows its details with no key: W × H, hatched padding with values, corner radius arcs with the clamped value (`9999px` pill → `r 16`; inside its corner only when the box is at least 68px tall, so a line of its text stays readable; on a shorter control it sits just above or below the corner on a leader from the arc. A W × H that cannot sit beside a short control without covering its words steps out on a leader too), gaps of a flex / grid / block container; margins stay a band. `Shift`+click adds / removes an element (picked by the same rule); measurements then start from the union of the selection (dashed box, one W × H, no details). Details are hidden while measuring. A padding / gap / radius value with no free spot next to what it describes sits 16 or 32px away on a leader: a dashed line in its color from a dot on its band, gap line or arc to the label's nearest edge (a padding value first slides along its band, a radius tries inside its corner first, then just above or below that corner, then out along the 45° line). A leader is at most 40px and crosses no label; a value with no such spot is hidden (hover the box to bring back one covered by another box's label). A radius value that does not fit inside its box, and a W × H wider than its box, are not drawn on top of the icon: the radius goes to its leader, the size steps out to the side.
- Hold `Alt` (`⌥ Option` on a Mac) and hover another element: spacing / inset / offset to the selection, dashed guides when diagonal. A value too short for its label sits beside its line instead of on it; a line under 6px gets outward arrows (`→| |←`).
- Small distances: numbers have up to 2 decimals; a W × H under 0.01 reads `<0.01`. Edges half a device pixel or less apart (counted in CSS px inside CSS `zoom`) are touching: that spacing / inset / offset / gap / padding is not drawn at all (no `0`). So it depends on the display: a 0.3px spacing is hidden at DPR 1 and shown on a Retina (DPR 2) screen, and browser zoom changes it too. Copy keeps the real values.
- Gap (purple): when the one selected element is a flex / grid / block container, the empty space between consecutive children, measured between their bounds (margins and `justify-content` space included, absolute / fixed children ignored). A block container's children are grouped into lines like a grid: stacked blocks give vertical gaps, inline-blocks on one line horizontal ones (the ~4px whitespace between them included); one with direct text (a paragraph) gets none, since the line would cross the text. Like a measurement, a gap too short for its label has the value beside its line, not on it. A click usually lands on a child: click it again for the container. Hidden while measuring.
- `B`: Blueprint adds the details of the last-selected element's descendants: dashed outline and W × H for each descendant in view, hatched padding (green, with values), gaps (flex / grid / block containers), corner radius arcs, values without room on leaders. Wrappers the size of their only child count once; more than 8 levels or 400 boxes show `+N hidden`. Labels that don't fit are hidden (a descendant's W × H takes no leader, so the details values keep the room); hover a box to bring its labels back. `B` or `Esc` returns to the selection. Ignored while typing; hidden while measuring.
- `C` with a selection: copy the last-selected element's spec (selector, border-box size, padding, border, radius) as CSS; toast `Copied CSS` or why it failed. Works on http pages too (copy command, no extra permission). Ignored while typing; Cmd/Ctrl+C stay with the page.
- `I` with a selection: Styles, a dark panel of the last-selected element's computed CSS that the overlay does not draw. Rows `name  value` in groups: display and layout, the font and color, fill, border, shadows and effects, margin (the one place a margin has numbers). Display, the font and color always, the rest only where it differs from a plain `<div>`. Colors are hex with the opacity below 100% (`#6366F1 50%`) and a swatch, each shadow one row (`0 4 12 0 #000000 25%`), long values cut with `…`. Sits 8px below the selection, else above, else beside, else in the bottom-right corner, always in the viewport; it never follows the hover. Labels move out of its way like the Hint's. Display-only (no click, no scroll). Hidden while measuring, back on Alt release; shown alongside Blueprint; `I` or `Esc` closes it, clearing the selection too. Ignored while typing.
- `Esc`: close Styles, then leave Blueprint, then clear selection, then turn off.
- Every other key (`Tab`, `Enter`, other letters) goes to the page.
- Iframes: turning on reaches the top frame and every same-origin / srcdoc frame; each frame draws its own overlay with its own selection (no measuring between frames). Keys go to the frame you last clicked; Esc there clears its selection, then turns every frame off. Cross-origin frames need access: a toast names their hosts, right-click the icon → **Measure cross-origin frames** and allow in Chrome's prompt (asks for those hosts only, remembered by Chrome). Frames added after turning on join at the next turn-on.

## Layout

```
src/core/       pure geometry (rect, measure, gap, labels, hint, blueprint, motion), Copy formatters (spec) + DOM reads (dom.ts); no React, no chrome.*
src/overlay/    controller.ts (input + per-frame re-read), Overlay.tsx (SVG), theme.ts (colors, strokes, font by role), clipboard.ts
src/entrypoints background.ts (toggle, badge), measure.content.tsx (shadow root + top layer)
playground/     fixture page for manual testing (also served by e2e)
e2e/smoke.mjs   pnpm e2e
public/icon/    toolbar + store icons, rendered from docs/icon.svg (16/32/48 as is, 128 with viewBox -1 -1 18 18 for store padding)
```

## Manual checklist (on your Chrome; `pnpm e2e` covers only icon click → overlay + badge)

1. Side by side / stacked / diagonal / overlap / nested card on the playground show the expected numbers.
2. Button and link do nothing while ON; work again after OFF.
3. Hold Alt, Alt+Tab away, come back: no stuck measuring chip.
4. Select an element, focus the input, press Alt / letters (`B` and `C` too) / Enter / Tab: typing and focus move still work, Blueprint and selection do not change; `Esc` still exits.
5. Select inside the scroll container, scroll: outline follows. Sticky header measures correctly.
6. Iframes: turn ON on the playground: the srcdoc and same-origin frames hover / select, the toast names `127.0.0.1` (or `localhost`); right-click the icon → Measure cross-origin frames, allow: the third frame measures too. Esc inside a frame, then again: every frame turns off.
7. Top layer: open the dialog, then turn ON: overlay draws above it. Then click "Open dialog in 2 s" (and "Open popover in 2 s") and turn ON right away: when it opens, the overlay still draws above it.
8. `chrome://extensions` tab: badge shows `!`. Navigate a tab that was ON: badge clears.
9. `chrome://extensions/shortcuts`: `Ctrl+Shift+E` (`⌘⇧E` on a Mac) is bound (another extension may hold it; a suggested key only applies on install, so remove and re-add the unpacked extension after changing it), and the icon title names it; clear it there: the title names none.
10. Blue icon (not a letter) in the toolbar, extensions menu and `chrome://extensions`, readable in light and dark theme; red `ON` badge sits on it.
11. Select an element, press `C` and paste into an editor, on an https page and a plain-http one: CSS with a selector that finds the element in DevTools.
12. Click a tile of the playground's row 3 or 4 times at the same spot: the selection climbs tile → row → section → …; click another tile: back to it.
13. Small distances (last playground block), on a Retina display (DPR 2): select each pair's first tile and Alt-hover the second: 1 and 0.5 are drawn and labelled beside the line with outward arrows, 0.25 and 0.05 draw nothing. Select the padded box: padding 1 top / bottom only. In the `zoom: 3` row, 1 is labelled `1`, 0.1 draws nothing. On a DPR 1 screen 0.5 draws nothing too.
14. Leaders: a list row with side padding and a radius (the playground's `#leader-row`, then a real one, e.g. a settings list): one click shows `r 12` (or the row's radius) and both side paddings, none hidden. If the radius sits on a same-size parent, the first click selects that parent. Select `#leader-dense`, press `B`: values without room hang on short dashed leaders in their color, none crossing a label; move the pointer around: no value jumps back and forth.
15. Block gaps on real text-heavy pages (a news article, a dashboard): select the article / a card and press `B`. Gap lines between blocks, none across a paragraph's text, and the purple labels don't flood the page (if they do, lower gaps below padding: ticket 20, "Block gaps").
16. Windows with Unikey or EVKey switching V/E on `Ctrl+Shift`: `Ctrl+Shift+E` toggles measure mode without switching the input mode.
17. Styles on a real page (a card, a button): select it, press `I`. The panel's colors, font and shadow match DevTools → Computed, the swatches show the colors; scroll so the element nears the bottom, then fills the viewport: the panel moves above, then to a corner, never off-screen. Press `B`: both show; `Esc` closes Styles first.

## Progress

Spec: [docs/spec.md](docs/spec.md). One ticket per file in `.scratch/ui-measure/issues/`; work the frontier (tickets whose blockers are done), one fresh session per ticket.

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 00 | v1: toggle, inspect, select, Alt-measure | — | done |
| 01 | Verify v1 on real Chrome + `pnpm e2e` probe | — | in progress (manual checklist left) |
| 02 | Extension icons | — | done (look on your Chrome: checklist 9) |
| 03 | Measure lock | 01 | done (removed in 14) |
| 04 | Selection navigation (parent/child/sibling, Shift multi) | 01 | done (keys removed in 14) |
| 05 | Flex / grid gap | 01 | done |
| 06 | Label collision | 05 | done |
| 07 | Blueprint view | 05, 06 | done |
| 08 | Copy spec (CSS / JSON / agent prompt) | 01 | done (CSS only since 14) |
| 09 | Overlay stays on top + scaled box model | 01 | done |
| 10 | Measure inside iframes | 01 | done (cross-origin prompt: checklist 6) |
| 11 | Closed shadow roots + CSS zoom | 01 | done |
| 12 | Publish to the Chrome Web Store | 01, 02 | ready |
| 13 | Smooth motion for hover/selection boxes | 01 | done |
| 14 | Fewer keys (Alt, Esc, B, C; click again → parent) | — | done |
| 15 | Cursor hint | 14, 16 | done |
| 16 | Selection details (padding, radius, gap on select; B = descendants) | — | done |
| 17 | Motion v2: lines glide too, label restyle | 16 | done |
| 18 | Small distances: touching under half a device px, labels beside short lines | 17 | done (Retina look: checklist 13) |
| 19 | Theme tokens (`src/overlay/theme.ts`, role names, defaults unchanged) | 18 | done (manual look left) |
| 20 | Leaders, same-size wrappers on click, block gaps (+ perf baseline) | 19 | done (real pages: checklist 14, 15) |
| 21 | Platform keys (`⌥ Option` / `Alt` in the Hint, toggle `Ctrl/Cmd+Shift+E`) | — | done (Windows IME: checklist 16) |
| 22 | Styles read and format (`src/core/styles.ts`) | — | done |
| 23 | Styles panel (`I`) | 22 | done (real pages: checklist 17) |

Out of scope: Firefox/Safari, plugin API, MCP bridge, pixel-based measuring, remembering ON per site.
