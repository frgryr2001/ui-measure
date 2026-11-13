import { EPSILON, measure, type Connector, type Measurement, type Segment } from './measure';
import type { Edges, Rect } from './rect';

const FRAME_MS = 1000 / 60;
const SNAP_PX = 0.5;

/**
 * Eases lags (shown minus real box, per edge) toward 0 over a frame of `ms`: `factor` of what is left
 * closes per 60 Hz frame, at any refresh rate (react-grab's `adjustLerpForFrameDuration`).
 * [] once every edge of every lag is within half a px: converged, the shown boxes are the real ones.
 */
export function ease(lags: Edges[], ms: number, factor: number): Edges[] {
  const keep = (1 - factor) ** (ms / FRAME_MS);
  const next = lags.map((o) => ({ left: o.left * keep, top: o.top * keep, right: o.right * keep, bottom: o.bottom * keep }));
  return next.every((o) => Object.values(o).every((v) => Math.abs(v) < SNAP_PX)) ? [] : next;
}

const NONE: Edges = { left: 0, top: 0, right: 0, bottom: 0 };
const shift = (r: Rect, o: Edges, k: number): Rect => ({ left: r.left + o.left * k, top: r.top + o.top * k, right: r.right + o.right * k, bottom: r.bottom + o.bottom * k });

/**
 * Smooth motion for one outline. Moving to another key (element) it glides from where the old one is
 * drawn now, its boxes read again by `read` (null once gone: snap) so a scroll this frame counts.
 * Shown = real + a lag that `ease` shrinks, so the same key moving (scroll, transitions) follows at once.
 */
export function glider<K>(read: (key: K) => Rect[] | null) {
  let key: K | null = null;
  let lags: Edges[] = [];
  return {
    /** Where to draw `real`, the boxes of `next`, after a frame of `ms`. */
    step(next: K | null, real: Rect[], ms: number, factor: number): Rect[] {
      if (next !== key) {
        const was = key !== null && next !== null ? read(key) : null;
        lags = was ? real.map((r, i) => {
          const w = was[i];
          return w ? shift(shift(w, lags[i] ?? NONE, 1), r, -1) : NONE;
        }) : [];
        key = next;
      }
      lags = ease(lags, ms, factor);
      return real.map((r, i) => shift(r, lags[i] ?? NONE, 1));
    },
    /** Mid-glide: what is drawn is not yet the real boxes. */
    get moving() {
      return lags.length > 0;
    },
  };
}

/** `v` on the span `from`, placed on the span `onto`. */
const mapSpan = (v: number, from0: number, from1: number, onto0: number, onto1: number) => {
  const span = from1 - from0;
  return Math.abs(span) < EPSILON ? (onto0 + onto1) / 2 : onto0 + ((v - from0) / span) * (onto1 - onto0);
};

/**
 * Where a point of `real` is drawn once that box is shown at `shown`.
 * A point on an edge stays on that edge, so a line measured to the box stays attached to the outline.
 */
export function followPoint(real: Rect, shown: Rect, x: number, y: number): { x: number; y: number } {
  return {
    x: mapSpan(x, real.left, real.right, shown.left, shown.right),
    y: mapSpan(y, real.top, real.bottom, shown.top, shown.bottom),
  };
}

const containsPoint = (r: Rect, x: number, y: number) =>
  x >= r.left - EPSILON && x <= r.right + EPSILON && y >= r.top - EPSILON && y <= r.bottom + EPSILON;

const onEdge = (r: Rect, x: number, y: number) =>
  containsPoint(r, x, y) && (Math.abs(x - r.left) <= EPSILON || Math.abs(x - r.right) <= EPSILON || Math.abs(y - r.top) <= EPSILON || Math.abs(y - r.bottom) <= EPSILON);

const area = (r: Rect) => Math.abs((r.right - r.left) * (r.bottom - r.top));

const smaller = (a: Rect, b: Rect): 'a' | 'b' => (area(a) <= area(b) ? 'a' : 'b');

/** An edge beats the interior, and the smaller box wins a tie. Null when neither flag is set. */
function pick(flagA: boolean, flagB: boolean, tie: 'a' | 'b'): 'a' | 'b' | null {
  if (flagA !== flagB) return flagA ? 'a' : 'b';
  if (flagA && flagB) return tie;
  return null;
}

/** Which box a measured endpoint lies on. */
function owner(a: Rect, b: Rect, x: number, y: number): 'a' | 'b' | null {
  const tie = smaller(a, b);
  return pick(onEdge(a, x, y), onEdge(b, x, y), tie) ?? pick(containsPoint(a, x, y), containsPoint(b, x, y), tie);
}

/**
 * The measurement between `a` and `b`, drawn where those boxes are shown.
 * Ends sit on the shown outlines. `value` is the real distance, never the length of the line mid-glide.
 * While the two boxes keep the same relationship, the line is remeasured on the shown boxes (so a spacing
 * stays in their shared range). Once that relationship changes, each end of the real line follows its own box.
 */
export function followMeasurement(realA: Rect, shownA: Rect, realB: Rect, shownB: Rect): Measurement {
  const real = measure(realA, realB);
  const shown = measure(shownA, shownB);
  const same = real.segments.length === shown.segments.length
    && real.connectors.length === shown.connectors.length
    && real.segments.every((s, i) => s.kind === shown.segments[i]?.kind && s.axis === shown.segments[i]?.axis);
  if (same) {
    return {
      segments: shown.segments.map((s, i) => ({ ...s, value: real.segments[i]?.value ?? s.value })),
      connectors: shown.connectors,
    };
  }
  // a spacing end or a connector elbow can sit off both boxes, on the line of one edge; follow that axis anyway
  const loose = (v: number, a0: number, a1: number, as0: number, as1: number, b0: number, b1: number, bs0: number, bs1: number) => {
    const on = (p: number, q: number) => Math.abs(v - p) <= EPSILON || Math.abs(v - q) <= EPSILON;
    const inside = (p: number, q: number) => v >= p - EPSILON && v <= q + EPSILON;
    const tie = smaller(realA, realB);
    const which = pick(on(a0, a1), on(b0, b1), tie) ?? pick(inside(a0, a1), inside(b0, b1), tie);
    if (which === 'a') return mapSpan(v, a0, a1, as0, as1);
    if (which === 'b') return mapSpan(v, b0, b1, bs0, bs1);
    return v;
  };
  const point = (x: number, y: number) => {
    const which = owner(realA, realB, x, y);
    if (which === 'a') return followPoint(realA, shownA, x, y);
    if (which === 'b') return followPoint(realB, shownB, x, y);
    return {
      x: loose(x, realA.left, realA.right, shownA.left, shownA.right, realB.left, realB.right, shownB.left, shownB.right),
      y: loose(y, realA.top, realA.bottom, shownA.top, shownA.bottom, realB.top, realB.bottom, shownB.top, shownB.bottom),
    };
  };
  const line = <T extends Segment | Connector>(s: T): T => {
    const p1 = point(s.x1, s.y1);
    const p2 = point(s.x2, s.y2);
    return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  };
  return { segments: real.segments.map(line), connectors: real.connectors.map(line) };
}
