import type { Rect } from './rect';

/** One measured distance; see GLOSSARY.md for spacing / inset / offset. */
export type Segment = {
  kind: 'spacing' | 'inset' | 'offset';
  axis: 'x' | 'y';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
};

/** Dashed guide from a segment's end to the box it was measured to. */
export type Connector = { x1: number; y1: number; x2: number; y2: number };

export type Measurement = { segments: Segment[]; connectors: Connector[] };

/** Distances below this are treated as touching and not drawn. */
export const EPSILON = 0.01;

const contains = (o: Rect, i: Rect) =>
  i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom;

export const mid = (a: number, b: number) => (a + b) / 2;

/**
 * Distances between the selection `a` and the hover target `b`, measured between bounds.
 * - one box contains the other: up to 4 insets
 * - boxes apart on an axis: one spacing per separated axis, placed in the middle of the
 *   shared range on the other axis, else level with `a`'s center plus a connector to `b`
 * - boxes overlap on both axes: offsets between same-side edges
 */
export function measure(a: Rect, b: Rect): Measurement {
  if (contains(a, b) || contains(b, a)) {
    const [o, i] = contains(a, b) ? [a, b] : [b, a];
    const cx = mid(i.left, i.right);
    const cy = mid(i.top, i.bottom);
    const segments: Segment[] = [
      { kind: 'inset', axis: 'y', x1: cx, y1: o.top, x2: cx, y2: i.top, value: i.top - o.top },
      { kind: 'inset', axis: 'x', x1: i.right, y1: cy, x2: o.right, y2: cy, value: o.right - i.right },
      { kind: 'inset', axis: 'y', x1: cx, y1: i.bottom, x2: cx, y2: o.bottom, value: o.bottom - i.bottom },
      { kind: 'inset', axis: 'x', x1: o.left, y1: cy, x2: i.left, y2: cy, value: i.left - o.left },
    ];
    return { segments: segments.filter((s) => s.value > EPSILON), connectors: [] };
  }

  const ovX0 = Math.max(a.left, b.left);
  const ovX1 = Math.min(a.right, b.right);
  const ovY0 = Math.max(a.top, b.top);
  const ovY1 = Math.min(a.bottom, b.bottom);
  const apartX = ovX1 <= ovX0;
  const apartY = ovY1 <= ovY0;
  const segments: Segment[] = [];
  const connectors: Connector[] = [];

  if (apartX) {
    const y = apartY ? mid(a.top, a.bottom) : mid(ovY0, ovY1);
    const [x1, x2] = b.left >= a.right ? [a.right, b.left] : [b.right, a.left];
    if (x2 - x1 > EPSILON) segments.push({ kind: 'spacing', axis: 'x', x1, y1: y, x2, y2: y, value: x2 - x1 });
    // end of the line on b's side sits outside b vertically: guide it to b's nearest edge
    if (apartY) {
      const x = b.left >= a.right ? b.left : b.right;
      connectors.push({ x1: x, y1: y, x2: x, y2: y < b.top ? b.top : b.bottom });
    }
  }

  if (apartY) {
    const x = apartX ? mid(a.left, a.right) : mid(ovX0, ovX1);
    const [y1, y2] = b.top >= a.bottom ? [a.bottom, b.top] : [b.bottom, a.top];
    if (y2 - y1 > EPSILON) segments.push({ kind: 'spacing', axis: 'y', x1: x, y1, x2: x, y2, value: y2 - y1 });
    if (apartX) {
      const y = b.top >= a.bottom ? b.top : b.bottom;
      connectors.push({ x1: x, y1: y, x2: x < b.left ? b.left : b.right, y2: y });
    }
  }

  if (!apartX && !apartY) {
    const y = mid(ovY0, ovY1);
    const x = mid(ovX0, ovX1);
    const pairs = [
      { axis: 'x', p: a.left, q: b.left },
      { axis: 'x', p: a.right, q: b.right },
      { axis: 'y', p: a.top, q: b.top },
      { axis: 'y', p: a.bottom, q: b.bottom },
    ] as const;
    for (const { axis, p, q } of pairs) {
      const [lo, hi] = p < q ? [p, q] : [q, p];
      if (hi - lo <= EPSILON) continue;
      segments.push(
        axis === 'x'
          ? { kind: 'offset', axis, x1: lo, y1: y, x2: hi, y2: y, value: hi - lo }
          : { kind: 'offset', axis, x1: x, y1: lo, x2: x, y2: hi, value: hi - lo },
      );
    }
  }

  return { segments, connectors };
}
