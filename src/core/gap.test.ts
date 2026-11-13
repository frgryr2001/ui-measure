import { describe, expect, it } from 'vitest';
import { gaps } from './gap';
import type { Rect } from './rect';

const box = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('gaps', () => {
  it('flex row: one horizontal line per pair of neighbours, in the middle of their shared range', () => {
    expect(gaps([box(0, 0, 100, 40), box(124, 10, 50, 40)], 'x', false)).toEqual([
      { axis: 'x', x1: 100, y1: 25, x2: 124, y2: 25, value: 24 },
    ]);
  });

  it('nowrap stays one line even when align-self moves items apart vertically', () => {
    // flex-start and flex-end items in a 100px tall row: no shared Y range, still a horizontal gap
    expect(gaps([box(0, 0, 50, 20), box(66, 80, 50, 20)], 'x', false)).toEqual([
      { axis: 'x', x1: 50, y1: 50, x2: 66, y2: 50, value: 16 },
    ]);
  });

  it('items in source order or reversed (row-reverse) give the same gaps', () => {
    const items = [box(0, 0, 40, 40), box(56, 0, 40, 40), box(120, 0, 40, 40)];
    const values = (rs: Rect[]) => gaps(rs, 'x', false).map((g) => g.value);
    expect(values(items)).toEqual([16, 24]);
    expect(values([...items].reverse())).toEqual([16, 24]);
  });

  it('flex-wrap: gaps inside each line, and one gap between lines across their shared width', () => {
    // column-gap 16, row-gap 12; the second item of line 2 has margin-left 8
    const items = [box(0, 0, 80, 40), box(96, 0, 80, 40), box(192, 0, 80, 40), box(0, 52, 80, 40), box(104, 52, 80, 40)];
    expect(gaps(items, 'x', true)).toEqual([
      { axis: 'x', x1: 80, y1: 20, x2: 96, y2: 20, value: 16 },
      { axis: 'x', x1: 176, y1: 20, x2: 192, y2: 20, value: 16 },
      { axis: 'y', x1: 92, y1: 40, x2: 92, y2: 52, value: 12 },
      { axis: 'x', x1: 80, y1: 72, x2: 104, y2: 72, value: 24 },
    ]);
  });

  it('flex column (wrap): vertical gaps inside each column, a horizontal one between columns', () => {
    const items = [box(0, 0, 60, 30), box(0, 40, 60, 30), box(80, 0, 60, 30)];
    expect(gaps(items, 'y', true)).toEqual([
      { axis: 'y', x1: 30, y1: 30, x2: 30, y2: 40, value: 10 },
      { axis: 'x', x1: 60, y1: 15, x2: 80, y2: 15, value: 20 },
    ]);
  });

  it('grid: column gaps in every row, one row gap between rows', () => {
    // repeat(3, 80px), column-gap 16, row-gap 24, 5 items
    const items = [0, 96, 192, 0, 96].map((x, i) => box(x, i < 3 ? 0 : 64, 80, 40));
    expect(gaps(items, 'x', true).map((g) => [g.axis, g.value])).toEqual([
      ['x', 16],
      ['x', 16],
      ['y', 24],
      ['x', 16],
    ]);
  });

  it('grid item spanning two rows: column gaps stay inside each row, none across rows', () => {
    // repeat(3, 80px), gap 24 16; the third column is one item spanning rows 1–2
    const items = [box(0, 0, 80, 40), box(96, 0, 80, 40), box(192, 0, 80, 104), box(0, 64, 80, 40), box(96, 64, 80, 40)];
    expect(gaps(items, 'x', true).map((g) => [g.x1, g.y1, g.x2, g.value])).toEqual([
      [80, 20, 96, 16],
      [80, 84, 96, 16],
      [176, 20, 192, 16],
      [176, 84, 192, 16],
    ]);
  });

  it('touching items, touching lines and overlap from negative margins: nothing to draw', () => {
    expect(gaps([box(0, 0, 50, 20), box(50, 0, 50, 20), box(90, 20, 50, 20)], 'x', true)).toEqual([]);
  });

  it('no items or one item: no gaps', () => {
    expect(gaps([], 'x', true)).toEqual([]);
    expect(gaps([box(0, 0, 10, 10)], 'y', false)).toEqual([]);
  });
});
