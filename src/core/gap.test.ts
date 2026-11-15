import { describe, expect, it } from 'vitest';
import { beside, gapFlow, gaps } from './gap';
import { touchLimit } from './measure';
import type { Rect } from './rect';

const box = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

const T = touchLimit(1);

describe('gaps', () => {
  it('flex row: one horizontal line per pair of neighbours, in the middle of their shared range', () => {
    expect(gaps([box(0, 0, 100, 40), box(124, 10, 50, 40)], 'x', false, T)).toEqual([
      { axis: 'x', x1: 100, y1: 25, x2: 124, y2: 25, value: 24 },
    ]);
  });

  it('nowrap stays one line even when align-self moves items apart vertically', () => {
    // flex-start and flex-end items in a 100px tall row: no shared Y range, still a horizontal gap
    expect(gaps([box(0, 0, 50, 20), box(66, 80, 50, 20)], 'x', false, T)).toEqual([
      { axis: 'x', x1: 50, y1: 50, x2: 66, y2: 50, value: 16 },
    ]);
  });

  it('items in source order or reversed (row-reverse) give the same gaps', () => {
    const items = [box(0, 0, 40, 40), box(56, 0, 40, 40), box(120, 0, 40, 40)];
    const values = (rs: Rect[]) => gaps(rs, 'x', false, T).map((g) => g.value);
    expect(values(items)).toEqual([16, 24]);
    expect(values([...items].reverse())).toEqual([16, 24]);
  });

  it('flex-wrap: gaps inside each line, and one gap between lines across their shared width', () => {
    // column-gap 16, row-gap 12; the second item of line 2 has margin-left 8
    const items = [box(0, 0, 80, 40), box(96, 0, 80, 40), box(192, 0, 80, 40), box(0, 52, 80, 40), box(104, 52, 80, 40)];
    expect(gaps(items, 'x', true, T)).toEqual([
      { axis: 'x', x1: 80, y1: 20, x2: 96, y2: 20, value: 16 },
      { axis: 'x', x1: 176, y1: 20, x2: 192, y2: 20, value: 16 },
      { axis: 'y', x1: 92, y1: 40, x2: 92, y2: 52, value: 12 },
      { axis: 'x', x1: 80, y1: 72, x2: 104, y2: 72, value: 24 },
    ]);
  });

  it('flex column (wrap): vertical gaps inside each column, a horizontal one between columns', () => {
    const items = [box(0, 0, 60, 30), box(0, 40, 60, 30), box(80, 0, 60, 30)];
    expect(gaps(items, 'y', true, T)).toEqual([
      { axis: 'y', x1: 30, y1: 30, x2: 30, y2: 40, value: 10 },
      { axis: 'x', x1: 60, y1: 15, x2: 80, y2: 15, value: 20 },
    ]);
  });

  it('grid: column gaps in every row, one row gap between rows', () => {
    // repeat(3, 80px), column-gap 16, row-gap 24, 5 items
    const items = [0, 96, 192, 0, 96].map((x, i) => box(x, i < 3 ? 0 : 64, 80, 40));
    expect(gaps(items, 'x', true, T).map((g) => [g.axis, g.value])).toEqual([
      ['x', 16],
      ['x', 16],
      ['y', 24],
      ['x', 16],
    ]);
  });

  it('grid item spanning two rows: column gaps stay inside each row, none across rows', () => {
    // repeat(3, 80px), gap 24 16; the third column is one item spanning rows 1–2
    const items = [box(0, 0, 80, 40), box(96, 0, 80, 40), box(192, 0, 80, 104), box(0, 64, 80, 40), box(96, 64, 80, 40)];
    expect(gaps(items, 'x', true, T).map((g) => [g.x1, g.y1, g.x2, g.value])).toEqual([
      [80, 20, 96, 16],
      [80, 84, 96, 16],
      [176, 20, 192, 16],
      [176, 84, 192, 16],
    ]);
  });

  it('touching items, touching lines and overlap from negative margins: nothing to draw', () => {
    expect(gaps([box(0, 0, 50, 20), box(50, 0, 50, 20), box(90, 20, 50, 20)], 'x', true, T)).toEqual([]);
  });

  it('a gap of half a device pixel or less is touching: not drawn', () => {
    const values = (d: number, touch: number) => gaps([box(-50, 0, 50, 20), box(d, 0, 50, 20)], 'x', false, touch).map((g) => g.value);
    expect([values(1, T), values(0.5, T), values(0.5, touchLimit(2)), values(0.05, touchLimit(2))]).toEqual([[1], [], [0.5], []]);
  });

  it('no items or one item: no gaps', () => {
    expect(gaps([], 'x', true, T)).toEqual([]);
    expect(gaps([box(0, 0, 10, 10)], 'y', false, T)).toEqual([]);
  });
});

describe('gapFlow + gaps (which containers get gaps)', () => {
  const style = { display: 'block', flexDirection: 'row', flexWrap: 'nowrap', text: false };
  const of = (s: Partial<typeof style>, items: Rect[]) => {
    const flow = gapFlow({ ...style, ...s });
    return flow ? gaps(items, flow.main, flow.wrap, T).map((g) => [g.axis, g.value]) : null;
  };

  it('a block container: stacked blocks give vertical gaps (margins between them)', () => {
    expect(of({}, [box(0, 0, 300, 40), box(0, 56, 300, 40), box(40, 112, 260, 40)])).toEqual([['y', 16], ['y', 16]]);
  });

  it('inline-blocks on one line give horizontal gaps, the whitespace between them included', () => {
    // two 60px inline-blocks with margin-left 8 and a ~4px space; a third wraps onto the next line
    expect(of({ display: 'inline-block' }, [box(0, 0, 60, 20), box(72, 0, 60, 20), box(0, 24, 60, 20)])).toEqual([['x', 12], ['y', 4]]);
  });

  it('a block container with direct text gets no gaps: a gap line would span the text', () => {
    expect(of({ text: true }, [box(0, 0, 40, 20), box(80, 0, 40, 20)])).toBeNull();
    expect(of({ display: 'list-item', text: true }, [])).toBeNull();
  });

  it('flow-root and list-item are block containers too; inline, table and contents get none', () => {
    const stacked = [box(0, 0, 100, 20), box(0, 30, 100, 20)];
    expect([of({ display: 'flow-root' }, stacked), of({ display: 'list-item' }, stacked)]).toEqual([[['y', 10]], [['y', 10]]]);
    for (const display of ['inline', 'table', 'table-cell', 'contents', 'none']) expect(of({ display }, stacked)).toBeNull();
  });

  it('flex and grid keep their flow, direct text or not', () => {
    expect(gapFlow({ ...style, display: 'inline-flex', flexDirection: 'column-reverse', flexWrap: 'wrap', text: true })).toEqual({ main: 'y', wrap: true });
    expect(gapFlow({ ...style, display: 'flex' })).toEqual({ main: 'x', wrap: false });
    expect(gapFlow({ ...style, display: 'grid' })).toEqual({ main: 'x', wrap: true });
  });
});

describe('beside', () => {
  it('a gap is beside the two boxes it separates, along either axis, and no other', () => {
    const icons = [box(0, 0, 40, 40), box(50, 0, 40, 40), box(100, 0, 40, 40)];
    const [left, right] = gaps(icons, 'x', false, T);
    expect(icons.map((r) => [beside(left!, r), beside(right!, r)])).toEqual([[true, false], [true, true], [false, true]]);
    const [g] = gaps([box(0, 0, 40, 40), box(0, 50, 40, 40)], 'y', false, T);
    expect([beside(g!, box(0, 50, 40, 40)), beside(g!, box(60, 50, 40, 40))]).toEqual([true, false]);
  });
});
