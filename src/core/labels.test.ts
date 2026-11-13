import { describe, expect, it } from 'vitest';
import { lineSpots, placeLabels, sizeSpots, type Label } from './labels';
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

  it('labels 2px apart both show; closer than that they collide', () => {
    // a spans 71.9–128.1; b centered 58.2 further is 2px clear of it
    const apart = placeLabels([label('a', 2, { x: 100, y: 100 }), label('b', 1, { x: 158.2, y: 100 })], VP, new Map());
    expect(apart.shown).toHaveLength(2);
    const close = placeLabels([label('a', 2, { x: 100, y: 100 }), label('b', 1, { x: 157, y: 100 })], VP, new Map());
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
    expect(offscreen.shown[0]?.box).toMatchObject({ left: 2, top: 580, bottom: 598 });
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
    // "16" is 23.2 wide
    expect(lineSpots({ axis: 'y', x1: 10, y1: 0, x2: 10, y2: 16, value: 16 }, '16')).toEqual([
      { x: 10, y: 8 },
      { x: 25.6, y: 8 },
      { x: -5.6, y: 8 },
    ]);
  });
});
