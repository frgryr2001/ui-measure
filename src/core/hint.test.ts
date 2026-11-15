import { describe, expect, it } from 'vitest';
import { HINT_H, hintParts, hintWidth, measuringChip, placeHint, type HintPart } from './hint';
import type { Rect } from './rect';

const VP: Rect = { left: 0, top: 0, right: 800, bottom: 600 };
const W = 120;
// keycaps in [brackets], the way the pill reads
const read = (parts: HintPart[]) => parts.map((p) => (p.kind === 'key' ? `[${p.text}]` : p.text)).join(' ');

describe('hintParts', () => {
  it('nothing selected: click to select', () => {
    expect(read(hintParts({ kind: 'idle' }, false))).toBe('[Click] to select');
  });

  it('a selection: measure, copy, children, styles, stacking; parent only where a click would climb', () => {
    expect(read(hintParts({ kind: 'selection', climbs: false }, false))).toBe('[Alt] measure · [B] children · [I] styles · [S] stacking');
    expect(read(hintParts({ kind: 'selection', climbs: true }, false))).toBe('[Alt] measure · [B] children · [I] styles · [S] stacking · [Click] again → parent');
  });

  it('on a Mac the measure key reads the way its keyboard prints it', () => {
    expect(read(hintParts({ kind: 'selection', climbs: false }, true))).toBe('[⌥ Option] measure · [B] children · [I] styles · [S] stacking');
  });

  it('Styles open: I or Esc to close', () => {
    expect(read(hintParts({ kind: 'styles' }, false))).toBe('[I] / [Esc] to close');
  });

  it('Stacking: S or Esc to exit, I styles; below only where a click would go down', () => {
    expect(read(hintParts({ kind: 'stacking', below: false }, false))).toBe('[S] / [Esc] to exit · [I] styles');
    expect(read(hintParts({ kind: 'stacking', below: true }, false))).toBe('[S] / [Esc] to exit · [I] styles · [Click] again → the box under it');
  });

  it('Blueprint: B or Esc to exit, I styles', () => {
    expect(read(hintParts({ kind: 'blueprint' }, false))).toBe('[B] / [Esc] to exit · [I] styles');
  });
});

describe('measuringChip', () => {
  it('names the held key: ⌥ on a Mac, Alt elsewhere', () => {
    expect(measuringChip(true)).toBe('⌥ measuring');
    expect(measuringChip(false)).toBe('Alt measuring');
  });
});

describe('hintWidth', () => {
  it('keycaps get side padding, text none, parts a gap, the pill its padding', () => {
    // 8 + (5 * 6.6 + 10) + 5 + 9 * 6.6 + 8
    expect(hintWidth(hintParts({ kind: 'idle' }, false))).toBeCloseTo(123.4);
  });
});

describe('placeHint', () => {
  it('16px below-right of the pointer', () => {
    expect(placeHint({ x: 100, y: 100 }, W, HINT_H, VP)).toEqual({ left: 116, top: 116, right: 236, bottom: 116 + HINT_H });
  });

  it('flips left at the right edge and up at the bottom edge', () => {
    const r = placeHint({ x: 750, y: 590 }, W, HINT_H, VP);
    expect(r).toEqual({ left: 750 - 16 - W, top: 590 - 16 - HINT_H, right: 750 - 16, bottom: 590 - 16 });
  });

  it('flips only the axis that would cross the edge', () => {
    expect(placeHint({ x: 750, y: 100 }, W, HINT_H, VP)).toMatchObject({ left: 614, top: 116 });
    expect(placeHint({ x: 100, y: 590 }, W, HINT_H, VP)).toMatchObject({ left: 116, top: 548 });
  });

  it('never off-screen: a flip that would cross the other edge is pushed back in', () => {
    const narrow: Rect = { left: 0, top: 0, right: 200, bottom: 50 };
    const r = placeHint({ x: 100, y: 30 }, W, HINT_H, narrow);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(200);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(50);
  });

  it('a viewport smaller than the pill keeps its top-left corner on screen', () => {
    expect(placeHint({ x: 50, y: 10 }, W, HINT_H, { left: 0, top: 0, right: 100, bottom: 20 })).toMatchObject({ left: 4, top: 4 });
  });
});
