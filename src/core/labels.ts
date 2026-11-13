import { mid, type Segment } from './measure';
import type { Rect } from './rect';

export const LABEL_H = 18;
// shortcut: assumes Overlay's 11px monospace (≈ 0.6em per char, also for ⌥ and ×) instead of measuring text
// every frame; measure once with a canvas if the font changes or labels clip.
export const labelWidth = (text: string) => text.length * 6.6 + 10;

type Point = { x: number; y: number };

/** A label to place: `at` lists the spots it may be centered on, best first. Higher `priority` places first. */
export type Label = { id: string; text: string; priority: number; at: Point[] };

/** Index of the spot each label used last frame, by id; lets a label stay put while it still fits. */
export type Anchors = Map<string, number>;

// space kept between two labels and between a label and the viewport edge
const APART = 2;
const CELL = 32;

const hits = (a: Rect, b: Rect) =>
  a.left < b.right + APART && b.left < a.right + APART && a.top < b.bottom + APART && b.top < a.bottom + APART;

/**
 * Greedy placement (research Phần 05 §5): in priority order each label takes the first spot that
 * fits the viewport and overlaps no label placed before it, trying last frame's spot first. Spots
 * are tried as given, then pushed inside the viewport; a label with no free spot is hidden.
 */
export function placeLabels<L extends Label>(labels: L[], viewport: Rect, anchors: Anchors): { shown: (L & { box: Rect })[]; anchors: Anchors } {
  // uniform grid of placed boxes so each test only looks at nearby labels
  const grid = new Map<string, Rect[]>();
  const cells = (r: Rect) => {
    const keys: string[] = [];
    for (let x = Math.floor((r.left - APART) / CELL); x <= Math.floor((r.right + APART) / CELL); x++)
      for (let y = Math.floor((r.top - APART) / CELL); y <= Math.floor((r.bottom + APART) / CELL); y++) keys.push(`${x},${y}`);
    return keys;
  };
  const free = (r: Rect) => !cells(r).some((k) => grid.get(k)?.some((o) => hits(o, r)));

  const lo = { x: viewport.left + APART, y: viewport.top + APART };
  const shown: (L & { box: Rect })[] = [];
  const next: Anchors = new Map();
  for (const l of [...labels].sort((a, b) => b.priority - a.priority)) {
    const w = labelWidth(l.text);
    const hi = { x: viewport.right - APART - w, y: viewport.bottom - APART - LABEL_H };
    const boxAt = (left: number, top: number): Rect => ({ left, top, right: left + w, bottom: top + LABEL_H });
    const spots = [
      ...l.at.map((p) => boxAt(p.x - w / 2, p.y - LABEL_H / 2)),
      ...l.at.map((p) => boxAt(Math.min(Math.max(p.x - w / 2, lo.x), hi.x), Math.min(Math.max(p.y - LABEL_H / 2, lo.y), hi.y))),
    ];
    const fits = (i: number) => {
      const r = spots[i];
      return !!r && r.left >= lo.x && r.top >= lo.y && r.left <= hi.x && r.top <= hi.y && free(r);
    };
    const last = anchors.get(l.id);
    const i = last !== undefined && fits(last) ? last : spots.findIndex((_, j) => fits(j));
    const box = spots[i];
    if (!box) continue;
    for (const k of cells(box)) grid.set(k, [...(grid.get(k) ?? []), box]);
    next.set(l.id, i);
    shown.push({ ...l, box });
  }
  return { shown, anchors: next };
}

// space between a label and the box or line it describes
const CLEARANCE = 4;

/** Spots for a box's W × H: below it, above it, then inside at the bottom and the top-left corner. */
export function sizeSpots(b: Rect, text: string): Point[] {
  const x = mid(b.left, b.right);
  return [
    { x, y: b.bottom + CLEARANCE + LABEL_H / 2 },
    { x, y: b.top - CLEARANCE - LABEL_H / 2 },
    { x, y: b.bottom - CLEARANCE - LABEL_H / 2 },
    { x: b.left + CLEARANCE + labelWidth(text) / 2, y: b.top + CLEARANCE + LABEL_H / 2 },
  ];
}

/** Spots for a dimension line's value: on the line's middle, then beside it on either side. */
export function lineSpots(s: Omit<Segment, 'kind'>, text: string): Point[] {
  const x = mid(s.x1, s.x2);
  const y = mid(s.y1, s.y2);
  const dy = LABEL_H / 2 + CLEARANCE;
  const dx = labelWidth(text) / 2 + CLEARANCE;
  return s.axis === 'x'
    ? [{ x, y }, { x, y: y - dy }, { x, y: y + dy }]
    : [{ x, y }, { x: x + dx, y }, { x: x - dx, y }];
}
