import { describe, expect, it } from 'vitest';
import { radiusLabels } from './blueprint';
import { gaps } from './gap';
import { HINT_H, placeHint } from './hint';
import { lineAway, lineSpots, paddingAway, placeLabels, sizeSpots, type Away, type Label } from './labels';
import type { Rect } from './rect';

const VP: Rect = { left: 0, top: 0, right: 800, bottom: 600 };
// "10 × 10" is 7 chars: 7 * 6.6 + 10 = 56.2 wide, 18 tall
const label = (id: string, priority: number, ...at: { x: number; y: number }[]): Label => ({ id, text: '10 × 10', priority, at });

describe('placeLabels', () => {
  it('places a lone label centered on its first spot', () => {
    const { shown } = placeLabels([label('a', 1, { x: 100, y: 100 })], VP, new Map());
    expect(shown.map((l) => [l.id, l.box])).toEqual([['a', { left: 71.9, top: 91, right: 128.1, bottom: 109 }]]);
  });

  it('the higher priority keeps the contested spot, whatever the input order', () => {
    const low = label('low', 1, { x: 100, y: 100 }, { x: 100, y: 140 });
    const high = label('high', 2, { x: 110, y: 105 });
    const { shown } = placeLabels([low, high], VP, new Map());
    expect(Object.fromEntries(shown.map((l) => [l.id, l.box.top]))).toEqual({ high: 96, low: 131 });
  });

  it('hides a label whose every spot is taken', () => {
    const { shown } = placeLabels([label('a', 2, { x: 100, y: 100 }), label('b', 1, { x: 120, y: 100 })], VP, new Map());
    expect(shown.map((l) => l.id)).toEqual(['a']);
  });

  it('labels 4px apart both show; closer than that they collide', () => {
    // a spans 71.9–128.1; b centered 60.2 further is 4px clear of it
    const apart = placeLabels([label('a', 2, { x: 100, y: 100 }), label('b', 1, { x: 160.2, y: 100 })], VP, new Map());
    expect(apart.shown).toHaveLength(2);
    const close = placeLabels([label('a', 2, { x: 100, y: 100 }), label('b', 1, { x: 159, y: 100 })], VP, new Map());
    expect(close.shown).toHaveLength(1);
  });

  it('keeps last frame’s spot while it fits, even when a better one frees up', () => {
    const blocker = label('blocker', 2, { x: 100, y: 100 });
    const a = label('a', 1, { x: 100, y: 100 }, { x: 100, y: 140 });
    const first = placeLabels([blocker, a], VP, new Map());
    expect(first.anchors.get('a')).toBe(1);
    // blocker gone: spot 0 is free, but `a` stays on spot 1
    const second = placeLabels([a], VP, first.anchors);
    expect(second.shown[0]?.box.top).toBe(131);
  });

  it('scrolling moves labels with their spots instead of freezing them on screen', () => {
    const at = (dy: number) => [label('blocker', 2, { x: 100, y: 100 + dy }), label('a', 1, { x: 100, y: 100 + dy }, { x: 100, y: 140 + dy })];
    const first = placeLabels(at(0), VP, new Map());
    const scrolled = placeLabels(at(-30), VP, first.anchors);
    expect(scrolled.anchors).toEqual(first.anchors);
    expect(scrolled.shown.map((l) => l.box.top)).toEqual(first.shown.map((l) => l.box.top - 30));
  });

  it('drops last frame’s spot once something better placed covers it', () => {
    const a = label('a', 1, { x: 100, y: 100 }, { x: 100, y: 140 });
    const first = placeLabels([a], VP, new Map([['a', 1]]));
    expect(first.shown[0]?.box.top).toBe(131);
    const second = placeLabels([label('blocker', 2, { x: 100, y: 140 }), a], VP, first.anchors);
    expect(second.shown.find((l) => l.id === 'a')?.box.top).toBe(91);
  });

  it('skips spots outside the viewport, and pushes the label in when no spot is inside', () => {
    const below = placeLabels([label('a', 1, { x: 100, y: 595 }, { x: 100, y: 500 })], VP, new Map());
    expect(below.shown[0]?.box.top).toBe(491);
    const offscreen = placeLabels([label('a', 1, { x: -50, y: 700 })], VP, new Map());
    expect(offscreen.shown[0]?.box).toMatchObject({ left: 4, top: 578, bottom: 596 });
  });
});

describe('pinned labels (radius, padding, gap)', () => {
  it('hidden when their spot is outside the viewport, never pushed in', () => {
    const { shown } = placeLabels([{ ...label('a', 1, { x: -50, y: 700 }), pinned: true }], VP, new Map());
    expect(shown).toEqual([]);
  });

  it('pill 120 × 32, padding 0 16, r 16: the radius keeps its corner, the left padding it covers is hidden, not moved', () => {
    const pill: Rect = { left: 100, top: 100, right: 220, bottom: 132 };
    const [r] = radiusLabels(pill, [[16, 16], [16, 16], [16, 16], [16, 16]]);
    const pad = (id: string, x: number): Label => ({ id, text: '16', priority: 0.95, at: [{ x, y: 116 }], pinned: true });
    const { shown } = placeLabels([pad('left', 108), pad('right', 212), { id: 'r', text: r?.text ?? '', priority: 0.97, at: r?.at ?? [], pinned: true }], VP, new Map());
    expect(shown.map((l) => l.id)).toEqual(['r', 'right']);
    expect(shown[0]?.box.left).toBeGreaterThan(pill.left);
    expect(shown[0]?.box.top).toBeGreaterThan(pill.top);
  });
});

describe('sizeSpots + placeLabels on a row of tiles', () => {
  it('every tile of a tight row gets a size label, and no two overlap', () => {
    // 5 tiles 40 wide, 8 apart: a 56px label cannot sit under every tile
    const tiles = [0, 1, 2, 3, 4].map((i): Rect => ({ left: 100 + i * 48, top: 100, right: 140 + i * 48, bottom: 140 }));
    const { shown } = placeLabels(
      tiles.map((t, i) => ({ id: `t${i}`, text: '40 × 40', priority: 1, at: sizeSpots(t, '40 × 40') })),
      VP,
      new Map(),
    );
    // neighbours' labels would overlap below, so every other one goes above
    expect(shown.map((l) => l.box.top)).toEqual([144, 78, 144, 78, 144]);
    for (const [i, a] of shown.entries())
      for (const b of shown.slice(i + 1)) expect(a.box.right <= b.box.left || b.box.right <= a.box.left || a.box.bottom <= b.box.top || b.box.bottom <= a.box.top).toBe(true);
  });
});

describe('lineSpots', () => {
  it('a horizontal line tries its middle, then above, then below', () => {
    expect(lineSpots({ axis: 'x', x1: 0, y1: 50, x2: 24, y2: 50, value: 24 }, '24')).toEqual([
      { x: 12, y: 50 },
      { x: 12, y: 37 },
      { x: 12, y: 63 },
    ]);
  });

  it('a vertical line tries its middle, then right, then left of it by half the label width', () => {
    // "18" is 23.2 wide
    expect(lineSpots({ axis: 'y', x1: 10, y1: 0, x2: 10, y2: 18, value: 18 }, '18')).toEqual([
      { x: 10, y: 9 },
      { x: 25.6, y: 9 },
      { x: -5.6, y: 9 },
    ]);
  });

  it('a line shorter than its label is not covered by it: beside the line only', () => {
    // "1" is 16.6 wide: on a 1px spacing the middle spot would hide the line and both boxes' edges
    expect(lineSpots({ axis: 'x', x1: 100, y1: 50, x2: 101, y2: 50, value: 1 }, '1')).toEqual([
      { x: 100.5, y: 37 },
      { x: 100.5, y: 63 },
    ]);
    // a label is 18 tall
    expect(lineSpots({ axis: 'y', x1: 10, y1: 0, x2: 10, y2: 16, value: 16 }, '16').map((p) => p.x)).toEqual([25.6, -5.6]);
  });
});

describe('gap labels', () => {
  it('a gap shorter than its label sits beside its line, never on it, along either axis', () => {
    // a 10px column gap between two 500 × 60 rows, and a 10px row gap between two 60 × 60 tiles
    const column = gaps([{ left: 0, top: 0, right: 500, bottom: 60 }, { left: 0, top: 70, right: 500, bottom: 130 }], 'y', false, 0);
    const row = gaps([{ left: 0, top: 0, right: 60, bottom: 60 }, { left: 70, top: 0, right: 130, bottom: 60 }], 'x', false, 0);
    for (const g of [...column, ...row]) {
      const [cx, cy] = [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2];
      const w = 2 * 6.6 + 10;
      for (const p of lineSpots(g, '10')) expect(Math.abs(p.x - cx) >= w / 2 || Math.abs(p.y - cy) >= 9).toBe(true);
    }
  });
});

describe('labels move out of the hint’s way', () => {
  it('a label under the hint takes its next spot; a pinned one is hidden', () => {
    const hint = placeHint({ x: 100, y: 100 }, 120, HINT_H, VP);
    const under = { x: 150, y: 125 };
    const { shown } = placeLabels(
      [
        { id: 'size', text: '10 × 10', priority: 3, at: [under, { x: 150, y: 300 }] },
        { id: 'pad', text: '8', priority: 1, at: [under], pinned: true },
      ],
      VP,
      new Map(),
      [hint],
    );
    expect(shown.map((l) => [l.id, l.box.top])).toEqual([['size', 291]]);
  });
});

describe('leaders (pass 2)', () => {
  // "10 × 10" is 56.2 × 18; `blocker` takes the spot at (100, 100): x 71.9–128.1, y 91–109
  const blocker = label('blocker', 2, { x: 100, y: 100 });
  const value = (away: Away[], at = { x: 100, y: 100 }): Label => ({ ...label('v', 1, at), pinned: true, away });

  it('a value with no free spot next to it sits away, with a leader from its target to the nearest edge of the label', () => {
    const { shown } = placeLabels([blocker, value([{ at: { x: 100, y: 140 }, from: { x: 100, y: 112 } }])], VP, new Map());
    expect(shown.find((l) => l.id === 'v')).toMatchObject({ box: { top: 131, bottom: 149 }, leader: { x1: 100, y1: 112, x2: 100, y2: 131 } });
  });

  it('an away spot without `from` (a padding value slid along its band) has no leader', () => {
    const { shown } = placeLabels([blocker, value([{ at: { x: 100, y: 140 } }])], VP, new Map());
    const v = shown.find((l) => l.id === 'v');
    expect(v?.box.top).toBe(131);
    expect(v?.leader).toBeUndefined();
  });

  it('a leader longer than 40px is hidden; the next spot, closer, is taken', () => {
    const far = { at: { x: 100, y: 200 }, from: { x: 100, y: 112 } };
    expect(placeLabels([blocker, value([far])], VP, new Map()).shown.map((l) => l.id)).toEqual(['blocker']);
    const { shown } = placeLabels([blocker, value([far, { at: { x: 100, y: 145 }, from: { x: 100, y: 112 } }])], VP, new Map());
    expect(shown.find((l) => l.id === 'v')?.box.top).toBe(136);
  });

  it('a spot whose leader would cross a placed label is skipped', () => {
    // from the middle of the blocker, the leader runs across it
    const crossing = { at: { x: 100, y: 140 }, from: { x: 100, y: 100 } };
    expect(placeLabels([blocker, value([crossing])], VP, new Map()).shown.map((l) => l.id)).toEqual(['blocker']);
  });

  it('a later label never covers a placed leader', () => {
    const led = value([{ at: { x: 100, y: 145 }, from: { x: 100, y: 112 } }]);
    // `other` could sit on the leader (y 112–136) at its first away spot, so it takes the second
    const other: Label = { id: 'o', text: '8', priority: 0.5, pinned: true, at: [{ x: 100, y: 100 }], away: [{ at: { x: 100, y: 122 } }, { at: { x: 200, y: 122 } }] };
    const { shown } = placeLabels([blocker, led, other], VP, new Map());
    expect(shown.find((l) => l.id === 'o')?.box.left).toBeGreaterThan(150);
  });

  it('every near spot goes first: a lower value next to its target beats a higher one moving away', () => {
    // `high` is blocked at (100, 100); its away spot at (100, 140) is `low`'s near spot
    const high = value([{ at: { x: 100, y: 140 }, from: { x: 100, y: 112 } }]);
    const low = { ...label('low', 0.5, { x: 100, y: 140 }), pinned: true };
    const { shown } = placeLabels([blocker, { ...high, priority: 1 }, low], VP, new Map());
    expect(shown.map((l) => l.id).sort()).toEqual(['blocker', 'low']);
  });

  it('back next to its target as soon as the near spot frees up: an away spot is no anchor', () => {
    const v = value([{ at: { x: 100, y: 140 }, from: { x: 100, y: 112 } }]);
    const first = placeLabels([blocker, v], VP, new Map());
    expect(first.shown.find((l) => l.id === 'v')?.leader).toBeDefined();
    const second = placeLabels([v], VP, first.anchors);
    expect(second.shown[0]).toMatchObject({ id: 'v', box: { top: 91 } });
    expect(second.shown[0]?.leader).toBeUndefined();
  });

  it('a value blocked only by the Hint stays hidden under it, never moved onto a leader', () => {
    const hint: Rect = { left: 60, top: 85, right: 140, bottom: 115 };
    const v = value([{ at: { x: 100, y: 140 }, from: { x: 100, y: 112 } }]);
    expect(placeLabels([v], VP, new Map(), [hint]).shown).toEqual([]);
  });

  it('~1500 labels, most of them led away, place within a frame budget', () => {
    // a 30 × 50 grid of 16px cells: every label's near spot is shared with its neighbours
    const many: Label[] = Array.from({ length: 1500 }, (_, i) => {
      const at = { x: 20 + (i % 50) * 16, y: 20 + Math.floor(i / 50) * 16 };
      return { id: `l${i}`, text: '12', priority: i % 7, pinned: true, at: [at], away: [16, 32].flatMap((d) => [{ at: { x: at.x, y: at.y - d - 9 }, from: at }, { at: { x: at.x, y: at.y + d + 9 }, from: at }]) };
    });
    placeLabels(many, VP, new Map());
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) placeLabels(many, VP, new Map());
    expect((performance.now() - t0) / 10).toBeLessThan(4);
  });
});

describe('leader spots', () => {
  const dist = (a: { x: number; y: number }, r: Rect) => Math.hypot(a.x - Math.min(Math.max(a.x, r.left), r.right), a.y - Math.min(Math.max(a.y, r.top), r.bottom));
  const boxOf = (p: { x: number; y: number }, text: string): Rect => {
    const w = (text.length * 6.6 + 10) / 2;
    return { left: p.x - w, top: p.y - 9, right: p.x + w, bottom: p.y + 9 };
  };
  const inBox = (r: Rect, b: Rect) => r.left >= b.left && r.top >= b.top && r.right <= b.right && r.bottom <= b.bottom;

  it('radius: on the corner\'s 45° line from the arc midpoint, inward when it fits, then outward at 16 and 32px', () => {
    const b: Rect = { left: 100, top: 100, right: 300, bottom: 200 };
    const [l] = radiusLabels(b, [[0, 0], [0, 0], [20, 20], [0, 0]]);
    const away = l?.away ?? [];
    // the bottom-right arc's midpoint
    const mid = { x: 300 - 20 * (1 - Math.SQRT1_2), y: 200 - 20 * (1 - Math.SQRT1_2) };
    expect(away.map((a) => [a.from?.x, a.from?.y])).toEqual(away.map(() => [mid.x, mid.y]));
    const boxes = away.map((a) => boxOf(a.at, 'r 20'));
    expect(boxes.map((r) => inBox(r, b))).toEqual([true, false, false]);
    expect(boxes.map((r) => Math.round(dist(mid, r)))).toEqual([16, 16, 32]);
    // up-left into the box, then down-right out of it
    expect(away[0] && away[0].at.x < mid.x && away[0].at.y < mid.y).toBe(true);
    expect(away.slice(1).every((a) => a.at.x > mid.x && a.at.y > mid.y)).toBe(true);
  });

  it('radius: no inward spot when the label does not fit inside the box; one shared label tries all four corners', () => {
    const pill: Rect = { left: 0, top: 0, right: 120, bottom: 32 };
    const [l] = radiusLabels(pill, [[16, 16], [16, 16], [16, 16], [16, 16]]);
    const boxes = (l?.away ?? []).map((a) => boxOf(a.at, 'r 16'));
    expect(boxes).toHaveLength(8);
    expect(boxes.some((r) => inBox(r, pill))).toBe(false);
  });

  it('padding: slid to both ends of its band first (no leader), then outside the box, perpendicular to its side, at 16 and 32px', () => {
    const border: Rect = { left: 100, top: 100, right: 540, bottom: 160 };
    // a 24px left padding band
    const band: Rect = { left: 100, top: 100, right: 124, bottom: 160 };
    const away = paddingAway(band, border, 'left', '24');
    expect(away.slice(0, 2).map((a) => [a.from, a.at.x])).toEqual([[undefined, 112], [undefined, 112]]);
    expect(away.slice(0, 2).map((a) => a.at.y)).toEqual([113, 147]);
    const out = away.slice(2);
    expect(out.map((a) => [a.from?.x, a.from?.y, a.at.y])).toEqual([[112, 130, 130], [112, 130, 130]]);
    expect(out.map((a) => boxOf(a.at, '24').right)).toEqual([84, 68]);
  });

  it('padding: a band too short to slide along has only the outside spots', () => {
    const border: Rect = { left: 0, top: 0, right: 100, bottom: 40 };
    const away = paddingAway({ left: 0, top: 0, right: 100, bottom: 4 }, border, 'top', '4');
    // "4" is 16.6 wide: 4px in from each end of the band
    expect(away.map((a) => [a.at.x, a.from === undefined])).toEqual([[12.3, true], [87.7, true], [50, false], [50, false]]);
    expect(paddingAway({ left: 0, top: 0, right: 20, bottom: 4 }, border, 'top', '4').every((a) => a.from)).toBe(true);
    expect(paddingAway({ left: 0, top: 0, right: 20, bottom: 4 }, border, 'top', '4').map((a) => boxOf(a.at, '4').bottom)).toEqual([-16, -32]);
  });

  it('gap: perpendicular to its line, at 16 then 32px on either side, led from the line\'s middle', () => {
    const away = lineAway({ axis: 'y', x1: 50, y1: 100, x2: 50, y2: 110, value: 10 }, '10');
    expect(away.map((a) => [a.from?.x, a.from?.y])).toEqual(away.map(() => [50, 105]));
    expect(away.map((a) => Math.round(dist({ x: 50, y: 105 }, boxOf(a.at, '10'))))).toEqual([16, 16, 32, 32]);
    expect(away.map((a) => Math.sign(a.at.x - 50))).toEqual([1, -1, 1, -1]);
    expect(lineAway({ axis: 'x', x1: 0, y1: 50, x2: 10, y2: 50, value: 10 }, '10').map((a) => a.at.y)).toEqual([25, 75, 9, 91]);
  });
});
