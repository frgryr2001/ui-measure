# Glossary

**Measure mode**
The tool's ON state, scoped to one browser tab. Off by default; turning it on or off never affects other tabs.

**Hint**
The small keycap tooltip that follows the pointer while measure mode is on and shows the next steps for the current state (select, measure, copy, children (Blueprint), parent). Hidden while measuring. Other labels move out of its way; a details value (padding, gap, radius) can't leave its box, so it hides under the hint until the pointer moves.

**Bounds**
The outer edge of an element's visible box (its border edge, after transforms). Every measurement is taken between bounds, never between padding or content edges.

**CSS px**
The unit of every number the tool shows: the px you write in CSS. Browser zoom needs no correction (the page APIs already report CSS px). Inside CSS `zoom` a number is the rendered distance divided by the `currentCSSZoom` of the element it describes, or of the nearest element containing both boxes for a measurement, so a `zoom: 1.5` box with `width: 120px` reads 120, while outlines and bands are drawn on the rendered box. `transform: scale()` is the opposite: it does not change layout, so its numbers stay rendered (see Bounds).

**Hover target**
The deepest element under the pointer while measure mode is on.

**Selection**
The elements the user picked. Clicking picks the deepest element under the pointer, not its wrapper; `Shift`+click adds or removes one element. Clicking the one selected element again selects its parent, so a container its children cover is still reachable. Each frame (iframe) keeps its own selection; measuring between frames is not supported.

**Details**
The numbers of the one selected element, shown on select with no key: W × H, padding, corner radius and, for a flex / grid container, its gaps. Margins are drawn as a band without numbers (a distance to a neighbour is a measurement). Not shown for a multi-selection or while measuring; a hover target shows only its outline, W × H and bands.

**Selection bounds**
The union of the bounds of every selected element. Measurements are taken from it, so a multi-selection measures like one box. Drawn dashed with its own W × H when more than one element is selected.

**Measurement**
The set of distances shown between the selection bounds and the hover target while the user holds Alt. Temporary: it disappears when Alt is released. Each distance is a spacing, an inset or an offset.

**Touching**
Two edges at most half a device pixel apart, the smallest step the screen can show: `0.5 / devicePixelRatio` CSS px, counted in the element's CSS px inside CSS `zoom` (see CSS px). The distance between touching edges is not drawn or labelled, whether it would be a spacing, an inset, an offset, a gap or a padding, with no "≈0" cue. It depends on the display: a 0.3px spacing touches at DPR 1 and shows at DPR 2. A W × H is always shown (under 0.01 as "<0.01").

**Spacing**
The empty distance between two boxes that do not touch along an axis.
_Avoid_: gap (reserved, see below)

**Inset**
The distance from an edge of a box to the same edge of a box that fully contains it.
_Avoid_: padding (padding is a CSS property; an inset is what we measure)

**Offset**
The distance between same-side edges of two boxes that partly overlap along an axis.

**Gap**
The empty distance between consecutive children of one container. Not part of a measurement between two chosen elements.

**Spec**
What Copy (`C`) writes for the last-selected element as CSS: a selector that finds it again, its bounds' W × H (border box), padding, border and corner radius.

**Blueprint**
`B` with a selection: the details of the last-selected element's descendants too, each kept descendant with a dashed outline and W × H, plus hatched padding, gaps and corner radius. A wrapper whose only child has its bounds counts as one box; depth and node count are capped, and what the caps cut is reported as "+N hidden". Only boxes in the viewport are drawn. `B` or `Esc` returns to the selection; hidden while measuring.
_Avoid_: X-ray (a plain outline of every element on the page)
