import { describe, expect, it } from 'vitest';
import { CAPS, classify, collect, keptInChain, radii, radiusLabels, type Corners, type Look } from './blueprint';
import type { Rect } from './rect';

describe('radii', () => {
  it('9999px pill 120 × 32: every corner clamps to half the height', () => {
    expect(radii(['9999px', '9999px', '9999px', '9999px'], 120, 32)).toEqual([[16, 16], [16, 16], [16, 16], [16, 16]]);
  });

  it('50% on a 200 × 100 box is an ellipse: x from the width, y from the height', () => {
    expect(radii(['50%', '50%', '50%', '50%'], 200, 100)).toEqual([[100, 50], [100, 50], [100, 50], [100, 50]]);
  });

  it('two-value form and mixed units', () => {
    expect(radii(['10px 20px', '10% 4px', '0px', '8px'], 100, 50)[0]).toEqual([10, 20]);
    expect(radii(['10px 20px', '10% 4px', '0px', '8px'], 100, 50)[1]).toEqual([10, 4]);
  });

  it('one overlapping side shrinks all four corners by the same factor', () => {
    // top: 60 + 60 on a 100 wide box → f = 100 / 120; the small corners shrink too
    const r = radii(['60px', '60px', '12px', '12px'], 100, 200);
    expect(r.map(([x]) => Number(x.toFixed(2)))).toEqual([50, 50, 10, 10]);
  });

});

// a test tree: each node says what it looks like; `kids` are its children
type N = { id: string; look: Look; kids?: N[] };
const VP: Rect = { left: 0, top: 0, right: 800, bottom: 600 };
// decorated by default; `round`: has a corner radius (a plain box has none)
const at = (left: number, top: number, w: number, h: number, plain = false, round = false): Look => ({ kind: 'box', rect: { left, top, right: left + w, bottom: top + h }, plain, round });
const run = (root: N, caps?: typeof CAPS) => {
  const { nodes, hidden } = collect(root, (n) => n.kids ?? [], (n) => n.look, VP, caps);
  // `~id`: the radius is read from that merged wrapper, not from the node
  return { kept: nodes.map((k) => `${k.node.id}@${k.depth}<${k.parent < 0 ? '-' : nodes[k.parent]?.node.id}${k.round === k.node ? '' : `~${k.round.id}`}`), hidden };
};

describe('collect', () => {
  it('keeps every box in document order with its depth and kept parent', () => {
    const tree: N = { id: 'card', look: at(0, 0, 300, 200), kids: [
      { id: 'title', look: at(10, 10, 100, 20) },
      { id: 'row', look: at(10, 40, 280, 40), kids: [{ id: 'btn', look: at(10, 40, 80, 40) }, { id: 'btn2', look: at(100, 40, 80, 40) }] },
    ] };
    expect(run(tree)).toEqual({ kept: ['card@0<-', 'title@1<card', 'row@1<card', 'btn@2<row', 'btn2@2<row'], hidden: 0 });
  });

  it('reject drops the subtree; skip drops the node but keeps its children', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200), kids: [
      { id: 'none', look: { kind: 'reject' }, kids: [{ id: 'lost', look: at(0, 0, 50, 50) }] },
      { id: 'contents', look: { kind: 'skip' }, kids: [{ id: 'item', look: at(0, 0, 50, 50) }] },
    ] };
    expect(run(tree).kept).toEqual(['root@0<-', 'item@1<root']);
  });

  it('a box under minSize or outside the viewport is skipped, a child overflowing it is kept', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200), kids: [
      { id: 'tiny', look: at(0, 0, 4, 4), kids: [{ id: 'popout', look: at(0, 0, 40, 40) }] },
      { id: 'below', look: at(0, 900, 300, 200) },
    ] };
    expect(run(tree).kept).toEqual(['root@0<-', 'popout@1<root']);
  });

  it('depth cap: nodes below maxDepth are cut and counted with their subtrees in hidden', () => {
    const chain = (d: number): N => ({ id: `d${d}`, look: at(0, 0, 100 - d, 100 - d), kids: d < 4 ? [chain(d + 1)] : [] });
    expect(run(chain(0), { ...CAPS, maxDepth: 2 })).toEqual({ kept: ['d0@0<-', 'd1@1<d0', 'd2@2<d1'], hidden: 2 });
  });

  it('node cap: the walk keeps maxNodes, then stops and counts everything left in hidden', () => {
    // after i1: its child t1, then i2–i4 with their children
    const items: N[] = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, look: at(i * 20, 0, 10, 10), kids: [{ id: `t${i}`, look: { kind: 'skip' } }] }));
    expect(run({ id: 'root', look: at(0, 0, 300, 200), kids: items }, { ...CAPS, maxNodes: 3 })).toEqual({ kept: ['root@0<-', 'i0@1<root', 'i1@1<root'], hidden: 7 });
  });

  it('a plain wrapper with one same-size child (±0.5) is replaced by the child at the wrapper\'s depth', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200), kids: [
      { id: 'wrap', look: at(0, 0, 100, 40, true), kids: [{ id: 'btn', look: at(0.3, 0, 100, 40.2), kids: [{ id: 'icon', look: at(4, 4, 16, 16) }] }] },
    ] };
    expect(run(tree).kept).toEqual(['root@0<-', 'btn@1<root', 'icon@2<btn']);
  });

  it('a wrapper with padding, border or radius absorbs its plain same-size child instead', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200), kids: [
      { id: 'rounded', look: at(0, 0, 100, 100), kids: [{ id: 'img', look: at(0, 0, 100, 100, true) }] },
    ] };
    expect(run(tree).kept).toEqual(['root@0<-', 'rounded@1<root']);
  });

  it('the root (the selected element) absorbs a plain same-size child, never gets replaced', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200, true), kids: [{ id: 'inner', look: at(0, 0, 300, 200, true), kids: [{ id: 'x', look: at(0, 0, 20, 20) }] }] };
    expect(run(tree).kept).toEqual(['root@0<-', 'x@1<root']);
  });

  it('a padded same-size child of a rounded wrapper: one box, the child with the wrapper\'s radius', () => {
    const padded = (id: string): N => ({ id, look: at(0, 0, 300, 200), kids: [{ id: `${id}-x`, look: at(10, 10, 20, 20) }] });
    expect(run({ id: 'root', look: at(0, 0, 400, 400), kids: [{ id: 'card', look: at(0, 0, 300, 200, false, true), kids: [padded('inner')] }] }).kept).toEqual([
      'root@0<-', 'inner@1<root~card', 'inner-x@2<inner',
    ]);
    // the child's own radius wins
    const rounded: N = { id: 'inner', look: at(0, 0, 300, 200, false, true) };
    expect(run({ id: 'root', look: at(0, 0, 400, 400), kids: [{ id: 'card', look: at(0, 0, 300, 200, false, true), kids: [rounded] }] }).kept).toEqual(['root@0<-', 'inner@1<root']);
  });

  it('the root is never replaced: a decorated same-size child under it stays its own box', () => {
    const padded: N = { id: 'inner', look: at(0, 0, 300, 200), kids: [{ id: 'inner-x', look: at(10, 10, 20, 20) }] };
    expect(run({ id: 'root', look: at(0, 0, 300, 200, true), kids: [padded] }).kept).toEqual(['root@0<-', 'inner@1<root', 'inner-x@2<inner']);
  });

  it('no merge when the wrapper has other rendered children (an inset:0 overlay next to content)', () => {
    const tree: N = { id: 'root', look: at(0, 0, 300, 200, true), kids: [
      { id: 'overlay', look: at(0, 0, 300, 200) },
      { id: 'text', look: at(10, 10, 100, 20) },
      { id: 'gone', look: { kind: 'reject' } },
    ] };
    expect(run(tree).kept).toEqual(['root@0<-', 'overlay@1<root', 'text@1<root']);
  });
});

describe('classify', () => {
  const rect: Rect = { left: 0, top: 0, right: 10, bottom: 10 };
  const base = { tag: 'DIV', display: 'block', visibility: 'visible', visible: true, rect, plain: true, round: false };
  const kind = (o: Partial<typeof base>) => classify({ ...base, ...o }).kind;

  it('a rendered element is a box', () => {
    expect(classify(base)).toEqual({ kind: 'box', rect, plain: true, round: false });
  });

  it('display:none, content-visibility:hidden and opacity 0 (checkVisibility false) reject the subtree', () => {
    expect(kind({ display: 'none', visible: false })).toBe('reject');
    expect(kind({ visible: false })).toBe('reject');
  });

  it('display:contents and visibility:hidden skip only the element', () => {
    // checkVisibility() is false for display:contents too
    expect(kind({ display: 'contents', visible: false })).toBe('skip');
    expect(kind({ visibility: 'hidden' })).toBe('skip');
    expect(kind({ visibility: 'collapse' })).toBe('skip');
  });

  it('script, style, template, br and friends are rejected whatever their display', () => {
    for (const tag of ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'WBR']) expect(kind({ tag })).toBe('reject');
  });
});

describe('radiusLabels', () => {
  const b: Rect = { left: 0, top: 0, right: 200, bottom: 100 };
  const texts = (c: Corners) => radiusLabels(b, c).map((l) => l.text);

  it('four equal corners: one label, inside the top-left corner first, then the other corners, then outside', () => {
    const [l] = radiusLabels(b, [[12, 12], [12, 12], [12, 12], [12, 12]]);
    expect(l?.text).toBe('r 12');
    const at = l?.at ?? [];
    const quadrant = ({ x, y }: { x: number; y: number }) => `${x < 100 ? 'l' : 'r'}${y < 50 ? 't' : 'b'}`;
    const inBox = ({ x, y }: { x: number; y: number }) => x > 0 && x < 200 && y > 0 && y < 100;
    expect(at.map(quadrant)).toEqual(['lt', 'rt', 'rb', 'lb', 'lt', 'rt', 'rb', 'lb']);
    expect(at.map(inBox)).toEqual([true, true, true, true, false, false, false, false]);
    expect(radiusLabels(b, [[12, 12], [12, 12], [12, 12], [12, 12]])).toHaveLength(1);
  });

  it('a corner of its own: inside it, then just below it, in line', () => {
    const [, , l] = radiusLabels(b, [[8, 8], [8, 8], [20, 20], [8, 8]]);
    expect(l?.text).toBe('r 20');
    expect(l?.at).toHaveLength(2);
    const [inside, outside] = l?.at ?? [];
    expect(inside && inside.x < 200 && inside.y < 100 && inside.x > 100 && inside.y > 50).toBe(true);
    expect(outside && outside.x === inside?.x && outside.y > 100).toBe(true);
  });

  it('different corners: one label each, ellipses as x/y, corners under 1px dropped', () => {
    expect(texts([[8, 8], [8, 8], [0.5, 0.5], [100, 50]])).toEqual(['r 8', 'r 8', 'r 100/50']);
  });

  it('under CSS zoom the text is the CSS radius, the spots stay on the rendered corner', () => {
    const zoomed = radiusLabels(b, [[18, 18], [18, 18], [18, 18], [18, 18]], 1.5);
    expect(zoomed.map((l) => l.text)).toEqual(['r 12']);
    expect(zoomed[0]?.at[0]?.y).toBeGreaterThan(radiusLabels(b, [[12, 12], [12, 12], [12, 12], [12, 12]])[0]?.at[0]?.y ?? Infinity);
  });

  it('no rounded corner: no label', () => {
    expect(texts([[0, 0], [0, 0], [0, 0], [0.9, 4]])).toEqual([]);
  });
});

describe('keptInChain (click and hover on same-size wrappers)', () => {
  // deepest first, as dom.ts reads it: 'plain' (no padding, border or radius), 'padded' (padding or border), 'round' (radius only)
  type Deco = 'plain' | 'padded' | 'round';
  const link = ([node, d]: [string, Deco]) => ({ node, plain: d === 'plain', round: d === 'round' });
  const chain = (first: [string, Deco], ...up: [string, Deco][]) => keptInChain([link(first), ...up.map(link)]);

  it('a rounded wrapper absorbs its plain child: the click picks the wrapper', () => {
    expect(chain(['row', 'plain'], ['rounded', 'round'])).toEqual({ node: 'rounded', round: 'rounded' });
  });

  it('a decorated child replaces a plain wrapper', () => {
    expect(chain(['btn', 'padded'], ['wrap', 'plain'])).toEqual({ node: 'btn', round: 'btn' });
  });

  it('a padded child in a rounded wrapper is one box: the child, with the wrapper\'s radius', () => {
    expect(chain(['row', 'padded'], ['card', 'round'])).toEqual({ node: 'row', round: 'card' });
  });

  it('both plain: the inner one, like Blueprint', () => {
    expect(chain(['body', 'plain'], ['html', 'plain'])).toEqual({ node: 'body', round: 'body' });
  });

  it('a 10-deep chain, padding inside and radius outside: one box, the padded one with the outer radius', () => {
    const plain = Array.from({ length: 8 }, (_, i): [string, Deco] => [`d${8 - i}`, 'plain']);
    expect(chain(['d9', 'padded'], ...plain, ['d0', 'round'])).toEqual({ node: 'd9', round: 'd0' });
  });

  it('two radii: the innermost one is drawn', () => {
    expect(chain(['in', 'round'], ['out', 'round'])).toEqual({ node: 'in', round: 'in' });
  });

  it('an element alone is its own box', () => {
    expect(chain(['el', 'plain'])).toEqual({ node: 'el', round: 'el' });
  });
});
