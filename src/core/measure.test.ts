import { describe, expect, it } from 'vitest';
import { measure, touchLimit } from './measure';
import { formatPx, ring, union, type Rect } from './rect';

const box = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

// DPR 1: half a device pixel
const T = touchLimit(1);

describe('measure', () => {
  it('B to the right on the same row: one spacing in the middle of the shared range', () => {
    const m = measure(box(0, 0, 100, 40), box(124, 10, 50, 40), T);
    expect(m.segments).toEqual([
      { kind: 'spacing', axis: 'x', x1: 100, y1: 25, x2: 124, y2: 25, value: 24 },
    ]);
    expect(m.connectors).toEqual([]);
  });

  it('B directly below A: exactly one vertical spacing, no offsets', () => {
    const m = measure(box(0, 0, 100, 40), box(20, 56, 100, 40), T);
    expect(m.segments).toEqual([
      { kind: 'spacing', axis: 'y', x1: 60, y1: 40, x2: 60, y2: 56, value: 16 },
    ]);
    expect(m.connectors).toEqual([]);
  });

  it('B above-left of A works the same way', () => {
    const m = measure(box(100, 100, 50, 50), box(0, 120, 80, 10), T);
    expect(m.segments).toEqual([
      { kind: 'spacing', axis: 'x', x1: 80, y1: 125, x2: 100, y2: 125, value: 20 },
    ]);
  });

  it('diagonal: two spacings level with A, each with a dashed connector to B', () => {
    const m = measure(box(0, 0, 100, 40), box(130, 70, 50, 50), T);
    expect(m.segments).toEqual([
      { kind: 'spacing', axis: 'x', x1: 100, y1: 20, x2: 130, y2: 20, value: 30 },
      { kind: 'spacing', axis: 'y', x1: 50, y1: 40, x2: 50, y2: 70, value: 30 },
    ]);
    expect(m.connectors).toEqual([
      { x1: 130, y1: 20, x2: 130, y2: 70 },
      { x1: 50, y1: 70, x2: 130, y2: 70 },
    ]);
  });

  it('B inside A: insets from B to each edge of A, zero insets dropped', () => {
    const m = measure(box(0, 0, 200, 100), box(16, 0, 100, 60), T);
    expect(m.segments.map((s) => [s.kind, s.value])).toEqual([
      ['inset', 84],
      ['inset', 40],
      ['inset', 16],
    ]);
  });

  it('A inside B (alt-hover on the parent): insets to the parent bounds', () => {
    const m = measure(box(16, 24, 100, 40), box(0, 0, 200, 100), T);
    expect(m.segments.map((s) => s.value)).toEqual([24, 84, 36, 16]);
  });

  it('partial overlap: offsets between same-side edges', () => {
    const m = measure(box(0, 0, 100, 100), box(50, 80, 100, 100), T);
    expect(m.segments.map((s) => [s.kind, s.axis, s.value])).toEqual([
      ['offset', 'x', 50],
      ['offset', 'x', 50],
      ['offset', 'y', 80],
      ['offset', 'y', 80],
    ]);
    expect(m.connectors).toEqual([]);
  });

  it('touching boxes: nothing to draw', () => {
    expect(measure(box(0, 0, 100, 40), box(100, 0, 50, 40), T)).toEqual({ segments: [], connectors: [] });
  });

  const spacing = (d: number, touch: number) => measure(box(-100, 0, 100, 40), box(d, 0, 50, 40), touch).segments.map((s) => s.value);

  it('half a device pixel or closer is touching: 0.5 hidden at DPR 1, 0.25 hidden and 0.26 shown at DPR 2', () => {
    expect([1, 0.5, 0.25, 0.05].map((d) => spacing(d, touchLimit(1)))).toEqual([[1], [], [], []]);
    expect([0.5, 0.26, 0.25].map((d) => spacing(d, touchLimit(2)))).toEqual([[0.5], [0.26], []]);
  });

  it('under CSS zoom the threshold is in CSS px, so a drawn line never reads "0"', () => {
    // zoom 3: 0.011 rendered is 0.004 CSS px, which would print "0"; 0.6 rendered is 0.2 CSS px
    expect(touchLimit(1, 3)).toBe(1.5);
    expect([0.011, 0.6, 3].map((d) => spacing(d, touchLimit(1, 3)))).toEqual([[], [], [3]]);
  });

  it('touching on one axis of a diagonal: no line and no guide on that axis', () => {
    const m = measure(box(0, 0, 100, 40), box(100.25, 70, 50, 50), T);
    expect(m.segments.map((s) => [s.axis, s.value])).toEqual([['y', 30]]);
    expect(m.connectors).toEqual([{ x1: 50, y1: 70, x2: 100.25, y2: 70 }]);
  });
});

describe('ring', () => {
  it('splits a band into 4 rects and drops empty sides', () => {
    expect(ring(box(0, 0, 100, 100), box(10, 0, 80, 90))).toEqual([
      { left: 0, top: 90, right: 100, bottom: 100 },
      { left: 0, top: 0, right: 10, bottom: 90 },
      { left: 90, top: 0, right: 100, bottom: 90 },
    ]);
  });

  it('drops sides of `min` or thinner: a touching padding is not drawn', () => {
    expect(ring(box(0, 0, 100, 100), box(1, 0.25, 98, 99.5), 0.25)).toEqual([
      { left: 0, top: 0.25, right: 1, bottom: 99.75 },
      { left: 99, top: 0.25, right: 100, bottom: 99.75 },
    ]);
  });

  it('negative margin (inner larger than outer) yields nothing', () => {
    expect(ring(box(5, 5, 90, 90), box(0, 0, 100, 100))).toEqual([]);
  });
});

describe('formatPx', () => {
  it('rounds to 2 decimals without trailing zeros', () => {
    expect([16, 16.5, 16.333, 15.999].map(formatPx)).toEqual(['16', '16.5', '16.33', '16']);
  });
});

describe('union', () => {
  it('multi-selection measures from the smallest box containing every element', () => {
    const u = union([box(0, 0, 100, 40), box(124, 10, 50, 40)]);
    expect(u).toEqual({ left: 0, top: 0, right: 174, bottom: 50 });
    expect(u && measure(u, box(200, 0, 20, 20), T).segments).toEqual([
      { kind: 'spacing', axis: 'x', x1: 174, y1: 10, x2: 200, y2: 10, value: 26 },
    ]);
  });

  it('of one rect is that rect', () => {
    expect(union([box(3, 4, 5, 6)])).toEqual(box(3, 4, 5, 6));
  });
});
