import { describe, expect, it } from 'vitest';
import { ease, followMeasurement, followPoint, glider } from './motion';

const lag = (n: number) => ({ left: n, top: n, right: n, bottom: n });

describe('ease', () => {
  it('a 60 Hz frame closes `factor` of the lag', () => {
    expect(ease([lag(100)], 1000 / 60, 0.5)).toEqual([lag(50)]);
  });

  it('same speed at 120 Hz: two half frames land where one 60 Hz frame does', () => {
    expect(ease(ease([lag(100)], 1000 / 120, 0.5), 1000 / 120, 0.5)).toEqual([lag(expect.closeTo(50))]);
  });

  it('converged: [] once every edge is within half a px, so the frame stops changing', () => {
    expect(ease([lag(0.9)], 1000 / 60, 0.5)).toEqual([]);
    expect(ease([lag(0.9), { ...lag(0), right: 2 }], 1000 / 60, 0.5)).toEqual([lag(0.45), { ...lag(0), right: 1 }]);
  });

  it('no time, no motion; a long frame (tab was hidden) or factor 1 (reduced motion) snaps', () => {
    expect(ease([lag(-40)], 0, 0.5)).toEqual([lag(-40)]);
    expect(ease([lag(-40)], 5000, 0.5)).toEqual([]);
    expect(ease([lag(-40)], 1000 / 60, 1)).toEqual([]);
  });
});

describe('glider', () => {
  const box = (left: number, top: number) => ({ left, top, right: left + 10, bottom: top + 10 });
  const frame = 1000 / 60;

  it('the first box shows where it is; a new key glides from where the old one is drawn now', () => {
    // the old box scrolled up 20px since last frame: the glide starts there, not at its last-frame spot
    const now = new Map([['a', [box(0, -20)]]]);
    const g = glider((k: string) => now.get(k) ?? null);
    expect(g.step('a', [box(0, 0)], frame, 0.5)).toEqual([box(0, 0)]);
    expect(g.step('b', [box(100, 40)], frame, 0.5)).toEqual([box(50, 10)]);
    expect(g.moving).toBe(true);
  });

  it('the same key moving (scroll) follows at once, mid-glide too; converged, it stops', () => {
    const g = glider((k: string) => (k === 'a' ? [box(0, 0)] : null));
    g.step('a', [box(0, 0)], frame, 0.5);
    g.step('b', [box(100, 0)], frame, 0.5);
    expect(g.step('b', [box(100, -30)], frame, 0.5)).toEqual([box(75, -30)]);
    expect(g.step('b', [box(100, -30)], 5000, 0.5)).toEqual([box(100, -30)]);
    expect(g.moving).toBe(false);
  });

  it('snaps when the old key is gone, after no key, or under factor 1', () => {
    const g = glider((k: string) => (k === 'a' ? [box(0, 0)] : null));
    g.step('gone', [box(0, 0)], frame, 0.5);
    expect(g.step('b', [box(100, 0)], frame, 0.5)).toEqual([box(100, 0)]);
    g.step(null, [], frame, 0.5);
    expect(g.step('a', [box(0, 0)], frame, 0.5)).toEqual([box(0, 0)]);
    expect(g.step('b', [box(100, 0)], frame, 1)).toEqual([box(100, 0)]);
  });
});

describe('followPoint', () => {
  const real = { left: 0, top: 0, right: 200, bottom: 40 };
  const shown = { left: 40, top: 10, right: 140, bottom: 50 };

  it('keeps a point on the same edge once the box is drawn somewhere else', () => {
    expect(followPoint(real, shown, 200, 20)).toEqual({ x: 140, y: 30 });
    expect(followPoint(real, shown, 0, 0)).toEqual({ x: 40, y: 10 });
  });
});

describe('followMeasurement', () => {
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

  it('draws the line on the gliding boxes and keeps the real distance', () => {
    const a = box(0, 0, 100, 40);
    const b = box(200, 10, 50, 40);
    // drawn 50px short of where it is: the line is 50 long, the number stays 100
    const shown = box(150, 10, 50, 40);
    expect(followMeasurement(a, a, b, shown, 0.5)).toEqual({
      segments: [{ kind: 'spacing', axis: 'x', x1: 100, y1: 25, x2: 150, y2: 25, value: 100 }],
      connectors: [],
    });
  });

  it('moves a diagonal measurement’s connectors onto the shown box', () => {
    const a = box(0, 0, 100, 40);
    const b = box(130, 70, 50, 50);
    const shown = box(160, 90, 50, 50);
    expect(followMeasurement(a, a, b, shown, 0.5)).toEqual({
      segments: [
        { kind: 'spacing', axis: 'x', x1: 100, y1: 20, x2: 160, y2: 20, value: 30 },
        { kind: 'spacing', axis: 'y', x1: 50, y1: 40, x2: 50, y2: 90, value: 30 },
      ],
      connectors: [
        { x1: 160, y1: 20, x2: 160, y2: 90 },
        { x1: 50, y1: 90, x2: 160, y2: 90 },
      ],
    });
  });

  it('keeps a diagonal connector on the shown box when that box is drawn inside', () => {
    const a = box(0, 0, 100, 40);
    const b = box(130, 70, 50, 50);
    const shown = box(10, 8, 20, 16);
    expect(followMeasurement(a, a, b, shown, 0.5)).toEqual({
      segments: [
        { kind: 'spacing', axis: 'x', x1: 100, y1: 20, x2: 10, y2: 20, value: 30 },
        { kind: 'spacing', axis: 'y', x1: 50, y1: 40, x2: 50, y2: 8, value: 30 },
      ],
      connectors: [
        { x1: 10, y1: 20, x2: 10, y2: 8 },
        { x1: 50, y1: 8, x2: 10, y2: 8 },
      ],
    });
  });

  it('keeps the final insets when the shown box has not arrived inside yet', () => {
    const a = box(0, 0, 200, 200);
    const b = box(50, 50, 50, 50);
    const shown = box(-80, 50, 50, 50);
    expect(followMeasurement(a, a, b, shown, 0.5)).toEqual({
      segments: [
        { kind: 'inset', axis: 'y', x1: 75, y1: 0, x2: -55, y2: 50, value: 50 },
        { kind: 'inset', axis: 'x', x1: -30, y1: 75, x2: 200, y2: 75, value: 100 },
        { kind: 'inset', axis: 'y', x1: -55, y1: 100, x2: 75, y2: 200, value: 100 },
        { kind: 'inset', axis: 'x', x1: 0, y1: 75, x2: -80, y2: 75, value: 50 },
      ],
      connectors: [],
    });
  });
});
