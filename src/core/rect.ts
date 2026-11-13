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

/** The band between `outer` and `inner` as up to 4 non-overlapping rects. */
export function ring(outer: Rect, inner: Rect): Rect[] {
  return [
    { left: outer.left, top: outer.top, right: outer.right, bottom: inner.top },
    { left: outer.left, top: inner.bottom, right: outer.right, bottom: outer.bottom },
    { left: outer.left, top: inner.top, right: inner.left, bottom: inner.bottom },
    { left: inner.right, top: inner.top, right: outer.right, bottom: inner.bottom },
  ].filter((r) => width(r) > 0 && height(r) > 0);
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

export const sizeLabel = (r: Rect) => `${formatPx(width(r))} × ${formatPx(height(r))}`;
