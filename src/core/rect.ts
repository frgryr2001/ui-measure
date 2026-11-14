/** Axis-aligned box in viewport CSS px. */
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Edges = { top: number; right: number; bottom: number; left: number };

export const width = (r: Rect) => r.right - r.left;
export const height = (r: Rect) => r.bottom - r.top;

/** Shrinks `r` by `d` on each side; pass sign -1 to grow (margin box). */
export const inset = (r: Rect, d: Edges, sign = 1): Rect => ({
  left: r.left + d.left * sign,
  top: r.top + d.top * sign,
  right: r.right - d.right * sign,
  bottom: r.bottom - d.bottom * sign,
});

/**
 * How much a transform scales a box on screen: its rendered size over its layout size (`offsetWidth`,
 * rounded to whole px, so a difference under 1px is rounding, not scale). 1 without a layout size.
 */
export const scaleOf = (rendered: number, layout: number) => (layout > 0 && Math.abs(rendered - layout) >= 1 ? rendered / layout : 1);

export const scaleEdges = (e: Edges, sx: number, sy: number): Edges => ({
  top: e.top * sy,
  right: e.right * sx,
  bottom: e.bottom * sy,
  left: e.left * sx,
});

/** The band between `outer` and `inner` as up to 4 non-overlapping rects, each thicker than `min` (`touchLimit`). */
export function ring(outer: Rect, inner: Rect, min = 0): Rect[] {
  return [
    { left: outer.left, top: outer.top, right: outer.right, bottom: inner.top },
    { left: outer.left, top: inner.bottom, right: outer.right, bottom: outer.bottom },
    { left: outer.left, top: inner.top, right: inner.left, bottom: inner.bottom },
    { left: inner.right, top: inner.top, right: outer.right, bottom: inner.bottom },
  ].filter((r) => width(r) > min && height(r) > min);
}

/** Smallest rect containing all of `rects`; null when there are none. */
export const union = (rects: Rect[]): Rect | null =>
  rects.length === 0
    ? null
    : {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
      };

/** Label text: at most 2 decimals, no trailing zeros ("16", "16.5", "16.33"). */
export const formatPx = (n: number) => String(Number(n.toFixed(2)));

// a box that is there never reads "0"
const sideText = (n: number) => (n > 0 && n < 0.01 ? '<0.01' : formatPx(n));

/** W × H of `r` (viewport px) in CSS px of an element under CSS `zoom` (`currentCSSZoom`). */
export const sizeLabel = (r: Rect, zoom = 1) => `${sideText(width(r) / zoom)} × ${sideText(height(r) / zoom)}`;
