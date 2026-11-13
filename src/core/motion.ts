import type { Edges } from './rect';

const FRAME_MS = 1000 / 60;
const SNAP_PX = 0.5;

/**
 * Eases lags (shown minus real box, per edge) toward 0 over a frame of `ms`: `factor` of what is left
 * closes per 60 Hz frame, at any refresh rate (react-grab's `adjustLerpForFrameDuration`).
 * [] once every edge of every lag is within half a px: converged, the shown boxes are the real ones.
 */
export function ease(lags: Edges[], ms: number, factor: number): Edges[] {
  const keep = (1 - factor) ** (ms / FRAME_MS);
  const next = lags.map((o) => ({ left: o.left * keep, top: o.top * keep, right: o.right * keep, bottom: o.bottom * keep }));
  return next.every((o) => Object.values(o).every((v) => Math.abs(v) < SNAP_PX)) ? [] : next;
}
