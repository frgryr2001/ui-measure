import { EPSILON, mid, type Segment } from './measure';
import { union, type Rect } from './rect';

/** Empty space between two consecutive children of one container; see GLOSSARY.md. */
export type Gap = Omit<Segment, 'kind'>;
type Axis = Gap['axis'];

const SIDES = {
  x: { start: 'left', end: 'right', crossStart: 'top', crossEnd: 'bottom' },
  y: { start: 'top', end: 'bottom', crossStart: 'left', crossEnd: 'right' },
} as const;

const shared = (a: Rect, b: Rect, axis: Axis) => {
  const { crossStart, crossEnd } = SIDES[axis];
  return Math.min(a[crossEnd], b[crossEnd]) - Math.max(a[crossStart], b[crossStart]);
};

/** Gap from `a` to `b` along `axis`, level with the middle of their shared range; null when they touch. */
function gapOf(a: Rect, b: Rect, axis: Axis): Gap | null {
  const { start, end, crossStart, crossEnd } = SIDES[axis];
  const value = b[start] - a[end];
  if (value <= EPSILON) return null;
  // with no shared range this is the middle of the space between them
  const c = mid(Math.max(a[crossStart], b[crossStart]), Math.min(a[crossEnd], b[crossEnd]));
  return axis === 'x' ? { axis, x1: a[end], y1: c, x2: b[start], y2: c, value } : { axis, x1: c, y1: a[end], x2: c, y2: b[start], value };
}

// shortcut: a line is items that overlap on the cross axis, so a grid item spanning rows merges
// those rows (their row gap is not drawn), and a wrapped line whose items share no cross range
// (align-self start and end in a tall line) splits in two; read grid tracks if such layouts matter.
/**
 * Gaps between consecutive `items` (children bounds) of a flex or grid container, measured
 * between bounds so margins and `justify-content` space are included. Items flow along `main`;
 * with `wrap` they are grouped into lines that overlap on the other axis, and the space between
 * consecutive lines is a gap too. A grid is `main` x with `wrap`: rows are its lines.
 */
export function gaps(items: Rect[], main: Axis, wrap: boolean): Gap[] {
  const { start, end, crossStart, crossEnd } = SIDES[main];
  const cross = main === 'x' ? 'y' : 'x';
  const byStart = (p: Rect, q: Rect) => p[start] - q[start];
  const lines: Rect[][] = [];
  if (!wrap) lines.push(items);
  else {
    for (const r of [...items].sort((p, q) => p[crossStart] - q[crossStart])) {
      const line = lines.at(-1);
      // touching lines stay apart
      if (line && r[crossStart] < Math.max(...line.map((l) => l[crossEnd])) - EPSILON) line.push(r);
      else lines.push([r]);
    }
  }
  const out: Gap[] = [];
  let prev: Rect | null = null;
  for (const line of lines) {
    const box = union(line);
    const g = prev && box && gapOf(prev, box, cross);
    if (g) out.push(g);
    const sorted = [...line].sort(byStart);
    sorted.forEach((a, i) => {
      // nowrap: the next item, whatever its alignment. wrap: the nearest items after `a` that share
      // its cross range, so a spanning grid item never pairs items of different rows
      const next = wrap ? sorted.filter((b) => b[start] >= a[end] - EPSILON && shared(a, b, main) > EPSILON) : sorted.slice(i + 1, i + 2);
      const near = Math.min(...next.map((b) => b[start]));
      for (const b of next) {
        const gap = b[start] - near <= EPSILON ? gapOf(a, b, main) : null;
        if (gap) out.push(gap);
      }
    });
    prev = box;
  }
  return out;
}
