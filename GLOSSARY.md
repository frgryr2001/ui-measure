# Glossary

**Measure mode**
The tool's ON state, scoped to one browser tab. Off by default; turning it on or off never affects other tabs.

**Hint**
The small keycap tooltip that follows the pointer while measure mode is on and shows the next steps for the current state (select, measure, copy, styles, children (Blueprint), parent), naming each key as the user's keyboard prints it (`⌥ Option` on a Mac, `Alt` elsewhere). Hidden while measuring, and once the pointer rests (back on the next move, click or key). Other labels move out of its way; a details value (padding, gap, radius) can't leave its box, so it hides under the hint until the pointer rests, never moving onto a leader.

**Bounds**
The outer edge of an element's visible box (its border edge, after transforms). Every measurement is taken between bounds, never between padding or content edges.

**CSS px**
The unit of every number the tool shows: the px you write in CSS. Browser zoom needs no correction (the page APIs already report CSS px). Inside CSS `zoom` a number is the rendered distance divided by the `currentCSSZoom` of the element it describes, or of the nearest element containing both boxes for a measurement, so a `zoom: 1.5` box with `width: 120px` reads 120, while outlines and bands are drawn on the rendered box. `transform: scale()` is the opposite: it does not change layout, so its numbers stay rendered (see Bounds).

**Hover target**
The box a click would select at the pointer while measure mode is on (see Selection).

**Selection**
The elements the user picked. Clicking picks the deepest box under the pointer, not its wrapper. A box that paints nothing does not hide the one you can see through it. A field's value or placeholder is that field. The words of a button, link or tab are that control, and so is a one-word rounded chip, even when its fill is a pseudo-element or a layer that ignores the pointer. Elements sharing its bounds, each the only child of the next, are one box, kept as Blueprint keeps it: the inner one with padding or border (else a rounded wrapper over a plain child), showing a wrapper's corner radius when it has none of its own. `Shift`+click adds or removes one element. Clicking the one selected element again selects the next box up, past its same-size wrappers, so a container its children cover is still reachable; in Stacking it selects the next box under it at that point instead, skipping boxes that paint nothing, so a box under another (a modal under its backdrop, a negative z-index behind its parent) is one click away. Each frame (iframe) keeps its own selection; measuring between frames is not supported.

**Details**
The numbers of the one selected element, shown on select with no key: W × H, padding, corner radius and, for a container, its gaps. Margins are drawn as a band without numbers (a distance to a neighbour is a measurement). Not shown for a multi-selection or while measuring; a hover target shows only its outline, W × H and bands.

**Selection bounds**
The union of the bounds of every selected element. Measurements are taken from it, so a multi-selection measures like one box. Drawn dashed with its own W × H when more than one element is selected.

**Measurement**
The set of distances shown between the selection bounds and the hover target while the user holds Alt (Option on a Mac, the same key). Temporary: it disappears when Alt is released. Each distance is a spacing, an inset or an offset.

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
The empty distance between consecutive children of one container, whatever makes it (`gap`, margins, `justify-content`), in a flex, grid or block container alike. Not part of a measurement between two chosen elements.

**Spec**
What Copy (`C`) writes for the last-selected element as CSS: a selector that finds it again, its bounds' W × H (border box), padding, border and corner radius.

**Styles**
`I` with a selection: the computed CSS of the last-selected element that the overlay does not draw (display and layout, font and color, fill, border, shadow and other effects, margin): display, the font and color always, the rest only where it differs from the default, in a panel next to the selection (below, above, beside, else a corner). It is the one place a margin has numbers. `I` or `Esc` closes it; hidden while measuring; shown alongside Blueprint.
_Avoid_: info, tooltip (that is the Hint), inspector

**Blueprint**
`B` with a selection: the details of the last-selected element's descendants too, each kept descendant with a dashed outline, plus hatched padding, gaps and corner radius. A descendant holding two or more drawn boxes (a row, a list) shows its W × H only when hovered, since its label would sit where its middle child's does; the rest show theirs. A wrapper whose only child has its bounds counts as one box (with the wrapper's radius when the child has none); depth and node count are capped, and what the caps cut is reported as "+N hidden". Only boxes in the viewport are drawn. `B` or `Esc` returns to the selection; hidden while measuring.
_Avoid_: X-ray (a plain outline of every element on the page), overview

**Stacking context**
The CSS term: a box whose descendants' z-indexes compete only among themselves, so the whole group is ordered as one box against the rest. Made by about 25 conditions in Chrome (positioned with a z-index, `fixed` / `sticky`, `opacity` below 1, a transform, a filter, `isolation`, `will-change`, containment, the top layer, …); `<html>` is the page's own. A z-index applies only to a positioned box or a flex / grid item; elsewhere it does nothing, though its computed value still reads as declared.
_Avoid_: layer (a composited layer is something else), z-context

**Clipped**
Cut by an ancestor that cuts the painting of what it contains (`overflow` other than visible, `clip-path`, `contain: paint`), where the selection's bounds run past that ancestor's box. Not stacking: no z-index fixes it.
_Avoid_: hidden (that is a label with no free spot), covered

**Stacking**
`S` with a selection: whether the last-selected element's z-index applies, the stacking context it competes in (solid outline) and every reason that ancestor is one, and the ancestor that clips it (dashed outline). Each part shows only when it differs from the plain case; nothing for an `<html>` context. Click again goes down (see Selection). `S` or `Esc` returns to the selection; exclusive with Blueprint, shown with Styles, hidden while measuring.
_Avoid_: inspector, z-index view, 3D view

**Stacking pair**
While Stacking is on, with one element selected, the hover target whose bounds overlap it. The two boxes that compete in their nearest common stacking context, each outlined, and a verdict on the one that paints on top. Nothing when one is inside the other and the inner one simply paints over it; shown when that inner one paints behind it (a negative z-index). The verdict then says the outer box is on top because that z-index sits behind it.
_Avoid_: layer comparison, z-fight

**Leader**
A dashed line from a details value (padding, gap, corner radius) to the band, gap line or corner it describes, drawn when the value has no free spot next to it and sits a little away instead. A value with no free spot even then is hidden.
