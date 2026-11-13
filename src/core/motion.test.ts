import { describe, expect, it } from 'vitest';
import { ease } from './motion';

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
