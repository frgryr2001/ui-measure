import { APART, CHAR_W, type Point } from './labels';
import type { Rect } from './rect';

/** What the Hint offers next. Measuring has no hint. */
export type HintState =
  | { kind: 'idle' }
  /** `climbs`: a click at the pointer would select the parent (see the controller's click rule). */
  | { kind: 'selection'; climbs: boolean }
  | { kind: 'blueprint' }
  /** `below`: a click at the pointer would select the box under the selection (see the controller's click rule). */
  | { kind: 'stacking'; below: boolean }
  /** Styles open: `I` or `Esc` closes it first, also in Blueprint and Stacking. */
  | { kind: 'styles' };

export type HintPart = { kind: 'key' | 'text'; text: string };
export type PlacedHint = { box: Rect; parts: HintPart[] };

const key = (label: string): HintPart => ({ kind: 'key', text: label });
const text = (label: string): HintPart => ({ kind: 'text', text: label });
const DOT = text('·');

/** The measuring chip: the held key as a `mac` keyboard prints it, or Alt. */
export const measuringChip = (mac: boolean) => (mac ? '⌥ measuring' : 'Alt measuring');

/** `mac`: name the measure key Option, the way a Mac keyboard prints it (the same key as Alt). */
export function hintParts(state: HintState, mac: boolean): HintPart[] {
  switch (state.kind) {
    case 'idle':
      return [key('Click'), text('to select')];
    case 'selection':
      return [
        key(mac ? '⌥ Option' : 'Alt'), text('measure'), DOT, key('C'), text('copy'), DOT, key('B'), text('children'), DOT, key('I'), text('styles'), DOT, key('S'), text('stacking'),
        ...(state.climbs ? [DOT, key('Click'), text('again → parent')] : []),
      ];
    case 'blueprint':
      return [key('B'), text('/'), key('Esc'), text('to exit'), DOT, key('I'), text('styles')];
    case 'stacking':
      return [key('S'), text('/'), key('Esc'), text('to exit'), DOT, key('I'), text('styles'), ...(state.below ? [DOT, key('Click'), text('again → below')] : [])];
    case 'styles':
      return [key('I'), text('/'), key('Esc'), text('to close')];
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

// pill layout, in the same 11px monospace estimate as labels (Overlay draws it with these numbers)
export const HINT_H = 26;
export const HINT_PAD_X = 8;
export const HINT_GAP = 5;
export const KEY_PAD_X = 5;
const partWidth = (p: HintPart) => p.text.length * CHAR_W + (p.kind === 'key' ? 2 * KEY_PAD_X : 0);
export const hintWidth = (parts: HintPart[]) =>
  2 * HINT_PAD_X + parts.reduce((w, p) => w + partWidth(p), 0) + HINT_GAP * Math.max(0, parts.length - 1);

// distance from the pointer to the hint's nearest corner
const OFFSET = 16;

/**
 * The hint's box: OFFSET below-right of the pointer, flipped to the other side on an axis where it
 * would cross the viewport edge, then kept inside (the top-left corner wins in a viewport smaller than the pill).
 */
export function placeHint(pointer: Point, w: number, h: number, viewport: Rect): Rect {
  const along = (at: number, size: number, lo: number, hi: number) => {
    const after = at + OFFSET;
    const start = after + size <= hi - APART ? after : at - OFFSET - size;
    return Math.max(Math.min(start, hi - APART - size), lo + APART);
  };
  const left = along(pointer.x, w, viewport.left, viewport.right);
  const top = along(pointer.y, h, viewport.top, viewport.bottom);
  return { left, top, right: left + w, bottom: top + h };
}
