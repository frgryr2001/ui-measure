import { LABEL_H, labelWidth } from './labels';
import { formatPx, height, width, type Rect } from './rect';

/** One corner's radius: [horizontal, vertical] semi-axes in px. */
export type Corner = [x: number, y: number];
/** Top-left, top-right, bottom-right, bottom-left, like the CSS longhands. */
export type Corners = [Corner, Corner, Corner, Corner];
type Four<T> = [T, T, T, T];

const resolve = (v: string, base: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * base : parseFloat(v) || 0);

/**
 * Corner radii of a `w` × `h` border box from the computed longhands ("12px", "50%", "10px 20%";
 * Chrome keeps % and 9999px as written). % resolve against the width (x) and height (y), then every
 * corner shrinks by one factor until adjacent corners no longer overlap (CSS Backgrounds 3, corner overlap).
 */
export function radii(values: Four<string>, w: number, h: number): Corners {
  const one = (v: string): Corner => {
    const [x = '0', y = x] = v.trim().split(/\s+/);
    return [resolve(x, w), resolve(y, h)];
  };
  const r: Corners = [one(values[0]), one(values[1]), one(values[2]), one(values[3])];
  const [tl, tr, br, bl] = r;
  const fit = (side: number, sum: number) => (sum > 0 ? side / sum : 1);
  const f = Math.min(1, fit(w, tl[0] + tr[0]), fit(w, bl[0] + br[0]), fit(h, tl[1] + bl[1]), fit(h, tr[1] + br[1]));
  return [
    [tl[0] * f, tl[1] * f],
    [tr[0] * f, tr[1] * f],
    [br[0] * f, br[1] * f],
    [bl[0] * f, bl[1] * f],
  ];
}

/** A corner worth drawing: both semi-axes at least 1px. */
export const rounded = ([x, y]: Corner) => x >= 1 && y >= 1;

const radiusText = ([x, y]: Corner) => `r ${x === y ? formatPx(x) : `${formatPx(x)}/${formatPx(y)}`}`;

/**
 * Radius values of box `b`: one label when all four corners match, else one per rounded corner, in
 * CSS px under CSS `zoom`. Spots: on the corner's 45° line 0.3 r + 6 px into the box (research Phần 05 §4.3),
 * then just above / below the corner, outside. On a short box (a pill) every inside spot covers a side padding value,
 * which outranks the radius; outside is the fallback because it lands on the page's content next to it.
 * The shared label tries the top-left corner first, then the other three.
 */
export function radiusLabels(b: Rect, corners: Corners, zoom = 1): { text: string; at: { x: number; y: number }[] }[] {
  const [first] = corners;
  const equal = corners.every(([x, y]) => x === first[0] && y === first[1]);
  // corner points and their inward direction, in Corners order
  const dirs = [[b.left, b.top, 1, 1], [b.right, b.top, -1, 1], [b.right, b.bottom, -1, -1], [b.left, b.bottom, 1, -1]] as const;
  return corners.flatMap((c, i) => {
    if (!rounded(c) || (equal && i > 0)) return [];
    const text = radiusText([c[0] / zoom, c[1] / zoom]);
    const w = labelWidth(text) / 2;
    const ds = equal ? dirs : dirs.slice(i, i + 1);
    const x = (cx: number, sx: number) => cx + sx * (0.3 * c[0] + 6 + w);
    const inside = ds.map(([cx, cy, sx, sy]) => ({ x: x(cx, sx), y: cy + sy * (0.3 * c[1] + 6 + LABEL_H / 2) }));
    // above / below the corner, not diagonally out: beside the box it would take the parent's side padding spot
    const outside = ds.map(([cx, cy, sx, sy]) => ({ x: x(cx, sx), y: cy - sy * (6 + LABEL_H / 2) }));
    return [{ text, at: [...inside, ...outside] }];
  });
}

/** How the subtree walk treats one node; dom.ts reads it from computed style. */
export type Look =
  // no box and nothing visible below it (display:none, opacity 0, <script>…)
  | { kind: 'reject' }
  // no box of its own, but its children may render (display:contents, visibility:hidden)
  | { kind: 'skip' }
  // plain: no padding, border or radius, so a same-size child loses nothing by replacing it
  | { kind: 'box'; rect: Rect; plain: boolean };

// no meaningful box (and <svg> content is never walked: dom.ts gives an <svg> no children)
const NO_BOX = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'WBR', 'LINK', 'META']);

/**
 * Visibility rules of the walk (research Phần 05 §3.1). `visible` is
 * `checkVisibility({ opacityProperty: true })`: false for display:none, content-visibility:hidden,
 * opacity 0 and display:contents.
 */
export function classify(s: { tag: string; display: string; visibility: string; visible: boolean; rect: Rect; plain: boolean }): Look {
  if (NO_BOX.has(s.tag)) return { kind: 'reject' };
  if (s.display === 'contents') return { kind: 'skip' };
  if (!s.visible) return { kind: 'reject' };
  // a child may set visibility:visible again
  if (s.visibility !== 'visible') return { kind: 'skip' };
  return { kind: 'box', rect: s.rect, plain: s.plain };
}

/** A node the blueprint draws. `parent` indexes the nearest kept ancestor, -1 for none. */
export type Kept<T> = { node: T; rect: Rect; depth: number; parent: number };

export const CAPS = { maxDepth: 8, maxNodes: 400, minSize: 8 };

const meets = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const same = (a: Rect, b: Rect) =>
  Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.top - b.top) <= 0.5 && Math.abs(a.right - b.right) <= 0.5 && Math.abs(a.bottom - b.bottom) <= 0.5;

/**
 * Nodes of `root`'s subtree to annotate, in document order (research Phần 05 §3.1). Boxes smaller
 * than `minSize` or outside `viewport` are skipped, their children still walked (they may overflow).
 * A wrapper whose only rendered child has its bounds is one node when at least one of them is
 * plain: the decorated one, else the child (the root counts as decorated). Nodes deeper than
 * `maxDepth` (counted in kept nodes) are cut with their subtrees, and once `maxNodes` are kept the
 * walk stops; both count what they cut in `hidden`.
 */
export function collect<T>(root: T, kids: (n: T) => T[], look: (n: T) => Look, viewport: Rect, caps = CAPS): { nodes: Kept<T>[]; hidden: number } {
  const nodes: Kept<T>[] = [];
  const plain: boolean[] = [];
  let hidden = 0;
  // shortcut: counts every element below a cut, display:none ones too, so the walk never reads their style; walk with `look` if "+N" must be exact.
  const count = (n: T): number => kids(n).reduce((sum, c) => sum + count(c), 1);
  // `alone`: n is the only rendered child of the kept node `parent`
  const walk = (n: T, l: Look, parent: number, depth: number, alone: boolean) => {
    if (l.kind === 'reject') return;
    // full: stop reading styles, everything left is hidden
    if (nodes.length >= caps.maxNodes) {
      hidden += count(n);
      return;
    }
    let at = parent;
    let below = depth;
    const p = nodes[parent];
    if (l.kind === 'box' && width(l.rect) >= caps.minSize && height(l.rect) >= caps.minSize && meets(l.rect, viewport)) {
      const merge = p && alone && same(p.rect, l.rect) && (plain[parent] || l.plain);
      if (p && merge) {
        // keep whichever side is decorated; the inner one when both are plain
        if (plain[parent]) {
          p.node = n;
          plain[parent] = l.plain;
        }
      } else if (depth > caps.maxDepth) {
        hidden += count(n);
        return;
      } else {
        at = nodes.push({ node: n, rect: l.rect, depth, parent }) - 1;
        // the user picked the root: a same-size child merges into it, not the other way round
        plain[at] = l.plain && n !== root;
        below = depth + 1;
      }
    }
    const rendered = kids(n).flatMap((c) => {
      const cl = look(c);
      return cl.kind === 'reject' ? [] : [{ c, cl }];
    });
    // a skipped or merged node passes its own aloneness down: its children are the kept parent's too
    const only = rendered.length === 1 && (at !== parent || alone);
    for (const { c, cl } of rendered) walk(c, cl, at, below, only);
  };
  walk(root, look(root), -1, 0, false);
  return { nodes, hidden };
}
