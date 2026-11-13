# Glossary

**Measure mode**
The tool's ON state, scoped to one browser tab. Off by default; turning it on or off never affects other tabs.

**Bounds**
The outer edge of an element's visible box (its border edge, after transforms). Every measurement is taken between bounds, never between padding or content edges.

**Hover target**
The deepest element under the pointer while measure mode is on.

**Selection**
The elements the user picked. Clicking picks the deepest element under the pointer, not its wrapper; `Shift`+click adds or removes one element. `Shift+Enter` / `Enter` / `Tab` / `Shift+Tab` move it to the parent / first child / next / previous sibling (siblings wrap; children and siblings without a box are skipped), starting from the last-clicked element and leaving one element selected. These keys act only while something is selected and nothing in the page is being typed in.

**Selection bounds**
The union of the bounds of every selected element. Measurements are taken from it, so a multi-selection measures like one box. Drawn dashed with its own W × H when more than one element is selected.

**Measurement**
The set of distances shown between the selection bounds and the hover target while the user holds Alt or measure lock is on. Temporary: it disappears when Alt is released (unless locked). Each distance is a spacing, an inset or an offset.

**Measure lock**
A sticky Alt: while on, every hover shows the measurement to the selection without holding Alt. Toggled with `L` (matched by `code: KeyL`, no modifiers; ignored while typing or composing in the page). Survives clearing the selection, resets when measure mode turns off.

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
What Copy (`C` / `J` / `P`) writes for the last-selected element: a selector that finds it again, its bounds' W × H (border box), padding, border and corner radius, as CSS, JSON or a Markdown prompt for an agent.

**Blueprint**
`B` with a selection: the last-selected element's whole subtree annotated at once, each kept descendant with a dashed outline and W × H, plus hatched padding, gaps and corner radius. A wrapper whose only child has its bounds counts as one box; depth and node count are capped, and what the caps cut is reported as "+N hidden". Only boxes in the viewport are drawn. `B` or `Esc` returns to the selection; hidden while measuring.
_Avoid_: X-ray (a plain outline of every element on the page)
