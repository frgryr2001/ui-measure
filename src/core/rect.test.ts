import { describe, expect, it } from 'vitest';
import { scaleOf, scaleEdges, sizeLabel } from './rect';

describe('scaleOf', () => {
  it('rendered size over layout size', () => {
    expect(scaleOf(100, 200)).toBe(0.5);
    expect(scaleOf(300, 200)).toBe(1.5);
  });

  it('1 when the difference is only offsetWidth rounding', () => {
    expect(scaleOf(99.6, 100)).toBe(1);
    expect(scaleOf(100.4, 100)).toBe(1);
  });

  it('1 without a layout size', () => {
    expect(scaleOf(0, 0)).toBe(1);
    expect(scaleOf(10, 0)).toBe(1);
  });
});

describe('scaleEdges', () => {
  it('scales left / right by sx and top / bottom by sy', () => {
    expect(scaleEdges({ top: 20, right: 40, bottom: 10, left: 8 }, 0.5, 2)).toEqual({ top: 40, right: 20, bottom: 20, left: 4 });
  });
});

describe('sizeLabel', () => {
  it('under CSS zoom: a zoom 1.5 element rendered 366 × 64 reads as its CSS 244 × 42.67', () => {
    expect(sizeLabel({ left: 20, top: 12, right: 386, bottom: 76 }, 1.5)).toBe('244 × 42.67');
  });

  it('a side under 0.01 reads "<0.01", never "0"; an empty side is 0', () => {
    expect(sizeLabel({ left: 0, top: 0, right: 0.004, bottom: 10 })).toBe('<0.01 × 10');
    expect(sizeLabel({ left: 0, top: 0, right: 0, bottom: 0.01 })).toBe('0 × 0.01');
  });
});
