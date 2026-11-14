import { mid, type Segment } from './measure';
import type { Rect } from './rect';

export const LABEL_H = 18;
export const FONT_SIZE = 11;
// shortcut: assumes FONT_SIZE in the theme's monospace (≈ 0.6em per char, also for ⌥, ×, → and ·) instead of measuring text
// every frame; measure once with a canvas if the font changes or labels clip.
export const CHAR_W = 6.6;
export const labelWidth = (text: string) => text.length * CHAR_W + 10;

export type Point = { x: number; y: number };

/**
 * A spot a details value takes only once every label has tried its near spots (`Label.at`), when it has no free
 * spot next to what it describes. `from`: the point on what it describes that a leader joins it to; none for a
 * spot still on its target (a padding value slid along its band).
 */
export type Away = { at: Point; from?: Point };

/**
 * A label to place: `at` lists the spots it may be centered on, best first. Higher `priority` places first.
 * `pinned`: only those spots, never pushed inside the viewport, so it is hidden rather than placed away from what it describes.
 * `away`: spots it tries after every label had its `at`, in priority order (GLOSSARY "Leader").
 */
export type Label = { id: string; text: string; priority: number; at: Point[]; pinned?: boolean; away?: Away[] };

/** A dashed line from what a label describes (x1, y1) to the nearest edge of the label (x2, y2). */
export type Leader = { x1: number; y1: number; x2: number; y2: number };

/** Index of the spot each label used last frame, by id; lets a label stay put while it still fits. */
export type Anchors = Map<string, number>;

// space kept between two labels and between a label and the viewport edge
export const APART = 4;
// longest leader: a value farther than that from what it describes is hidden
export const MAX_LEADER = 40;
const CELL = 32;

const hits = (a: Rect, b: Rect) =>
  a.left < b.right + APART && b.left < a.right + APART && a.top < b.bottom + APART && b.top < a.bottom + APART;

/** True when segment `s` passes through the inside of `r` (Liang–Barsky clipping); touching an edge is not crossing. */
export function crosses(s: Leader, r: Rect): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, s.x1 - r.left], [dx, r.right - s.x1], [-dy, s.y1 - r.top], [dy, r.bottom - s.y1]] as const) {
    if (p === 0) {
      if (q <= 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Greedy placement (research Phần 05 §5) in two passes. Pass 1: in priority order each label takes the first spot
 * that fits the viewport and overlaps no label placed before it, trying last frame's spot first. Spots are tried as
 * given, then (unless pinned) pushed inside the viewport. Pass 2: in priority order, each label still without a spot
 * takes its first free `away` spot whose leader is at most MAX_LEADER long and crosses no label; later labels keep
 * off placed leaders. A label with no free spot is hidden. `taken`: boxes placed before every label (the Hint),
 * which labels move out of the way of; a label whose near spots are blocked only by them is hidden, not led away,
 * so the moving Hint never sends values onto leaders. `clear`: boxes whose words stay readable (a one-line
 * control). A spot on one is skipped, and the label may still move onto a leader; the Hint and the Styles panel
 * (`taken`) are the only obstacles that hide a value instead.
 */
export function placeLabels<L extends Label>(labels: L[], viewport: Rect, anchors: Anchors, taken: Rect[] = [], clear: Rect[] = []): { shown: (L & { box: Rect; leader?: Leader })[]; anchors: Anchors } {
  // uniform grid of placed boxes and leaders, so each test only looks at nearby ones
  type Placed = { r: Rect; hint?: true; leader?: Leader };
  const grid = new Map<number, Placed[]>();
  // one number per cell: viewports stay far under 2^16 cells a side
  const cells = (r: Rect) => {
    const keys: number[] = [];
    for (let x = Math.floor((r.left - APART) / CELL); x <= Math.floor((r.right + APART) / CELL); x++)
      for (let y = Math.floor((r.top - APART) / CELL); y <= Math.floor((r.bottom + APART) / CELL); y++) keys.push(x * 65536 + y);
    return keys;
  };
  // what keeps a box out: a label or a leader, else only the Hint, else nothing
  const blocked = (r: Rect): 'label' | 'hint' | null => {
    let hint = false;
    for (const k of cells(r))
      for (const o of grid.get(k) ?? []) {
        if (!(o.leader ? crosses(o.leader, r) : hits(o.r, r))) continue;
        if (!o.hint) return 'label';
        hint = true;
      }
    return hint ? 'hint' : null;
  };
  const occupy = (o: Placed) => {
    for (const k of cells(o.r)) {
      const here = grid.get(k);
      if (here) here.push(o);
      else grid.set(k, [o]);
    }
  };
  for (const r of taken) occupy({ r, hint: true });

  const lo = { x: viewport.left + APART, y: viewport.top + APART };
  const shown: (L & { box: Rect; leader?: Leader })[] = [];
  const next: Anchors = new Map();
  const later: L[] = [];
  const sorted = [...labels].sort((a, b) => b.priority - a.priority);
  // overlap, not the 4px labels keep apart: the content box already holds the descenders, and a side padding
  // band is often only a label wide (a 24px band, a 23.2px `24`), so 4px would push its value out of the band
  // in the same grid cells as labels: Blueprint of 400 short boxes has 400 of them
  const words = new Map<number, Rect[]>();
  for (const c of clear) for (const k of cells(c)) words.set(k, [...(words.get(k) ?? []), c]);
  const onWords = (r: Rect) => cells(r).some((k) => words.get(k)?.some((c) => r.left < c.right && c.left < r.right && r.top < c.bottom && c.top < r.bottom));
  const boxer = (l: L) => {
    const w = labelWidth(l.text);
    const hi = { x: viewport.right - APART - w, y: viewport.bottom - APART - LABEL_H };
    const boxAt = (left: number, top: number): Rect => ({ left, top, right: left + w, bottom: top + LABEL_H });
    return {
      box: (p: Point) => boxAt(p.x - w / 2, p.y - LABEL_H / 2),
      pushed: (p: Point) => boxAt(clamp(p.x - w / 2, lo.x, hi.x), clamp(p.y - LABEL_H / 2, lo.y, hi.y)),
      inside: (r: Rect) => r.left >= lo.x && r.top >= lo.y && r.left <= hi.x && r.top <= hi.y,
    };
  };
  for (const l of sorted) {
    const { box, pushed, inside } = boxer(l);
    const spots = [...l.at.map(box), ...(l.pinned ? [] : l.at.map(pushed))];
    const fits = (i: number) => {
      const r = spots[i];
      return !!r && inside(r) && !onWords(r) && !blocked(r);
    };
    const last = anchors.get(l.id);
    const i = last !== undefined && fits(last) ? last : spots.findIndex((_, j) => fits(j));
    const r = spots[i];
    if (r) {
      occupy({ r });
      next.set(l.id, i);
      shown.push({ ...l, box: r });
      // a spot on words is lost with or without the Hint, so the Hint isn't what keeps the value from it
    } else if (l.away?.length && !(taken.length > 0 && spots.some((s) => inside(s) && !onWords(s) && blocked(s) === 'hint'))) later.push(l);
  }
  // no anchor for an away spot: next frame the label goes back next to its target if that spot is free
  for (const l of later) {
    const { box, inside } = boxer(l);
    for (const a of l.away ?? []) {
      const r = box(a.at);
      const leader = a.from && { x1: a.from.x, y1: a.from.y, x2: clamp(a.from.x, r.left, r.right), y2: clamp(a.from.y, r.top, r.bottom) };
      if (!inside(r) || onWords(r) || (leader && Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > MAX_LEADER)) continue;
      const by = blocked(r);
      // the Hint covers this spot only: try the next one. A near spot under the Hint never reaches here
      // (pass 1 keeps the value hidden rather than leading it away), so a later leader can still show it.
      if (by) continue;
      if (leader) {
        const span: Rect = { left: Math.min(leader.x1, leader.x2), top: Math.min(leader.y1, leader.y2), right: Math.max(leader.x1, leader.x2), bottom: Math.max(leader.y1, leader.y2) };
        if (cells(span).some((k) => grid.get(k)?.some((o) => !o.leader && !o.hint && crosses(leader, o.r)))) continue;
        occupy({ r: span, leader });
      }
      occupy({ r });
      shown.push({ ...l, box: r, ...(leader && { leader }) });
      break;
    }
  }
  return { shown, anchors: next };
}

// space between a label and the box or line it describes
const CLEARANCE = 4;

/**
 * Shortest box whose inside spots leave a centered 16px line of text readable, with APART between them.
 * An inside label sits CLEARANCE off the border, so its top is `h - 22`; the line ends at `(h + 16) / 2`.
 * The gap is `h / 2 - 30`, and that is at least APART only once `h` reaches 68. Below that the interior
 * is the words: a W × H or a radius drawn there covers them (a 28px button, a 32px chip).
 */
export const TEXT_SAFE = 68;

/**
 * Spots for a box's W × H: below it, above it, then inside at the bottom and the top-left corner
 * when the box is tall enough to keep a line of text clear and the whole label fits there, then outside
 * to the right and the left. A label that merely fits a short box used to take the inside spot and sit
 * on the words. Below is an extra half-label down. A padding value centered in a band thinner than the
 * label hangs past the border; without that room the size takes the middle of the bottom side and the
 * padding slides to the end of its band.
 */
export function sizeSpots(b: Rect, text: string): Point[] {
  const x = mid(b.left, b.right);
  const w = labelWidth(text);
  const spots: Point[] = [
    { x, y: b.bottom + CLEARANCE + LABEL_H },
    { x, y: b.top - CLEARANCE - LABEL_H / 2 },
  ];
  if (b.bottom - b.top >= TEXT_SAFE && w + 2 * CLEARANCE <= b.right - b.left && LABEL_H + 2 * CLEARANCE <= b.bottom - b.top) {
    spots.push(
      { x, y: b.bottom - CLEARANCE - LABEL_H / 2 },
      { x: b.left + CLEARANCE + w / 2, y: b.top + CLEARANCE + LABEL_H / 2 },
    );
  }
  const y = mid(b.top, b.bottom);
  spots.push({ x: b.right + CLEARANCE + w / 2, y }, { x: b.left - CLEARANCE - w / 2, y });
  return spots;
}

/**
 * Pass-2 spots of a W × H whose near spots are taken or would cover a one-line control. Straight out
 * first, then one label-width to either side so the leader can leave from the corner and miss a number
 * already centered on that side. 40 is MAX_LEADER.
 */
export function sizeAway(b: Rect, text: string): Away[] {
  const w = labelWidth(text);
  const x = mid(b.left, b.right);
  const y = mid(b.top, b.bottom);
  const slide = w + APART;
  const edge = (v: number) => clamp(v, b.left, b.right);
  const away: Away[] = [];
  for (const d of [16, 32, 40] as const) {
    for (const s of [0, 1, -1]) {
      const atX = x + s * slide;
      away.push(
        { at: { x: atX, y: b.bottom + d + LABEL_H / 2 }, from: { x: edge(atX), y: b.bottom } },
        { at: { x: atX, y: b.top - d - LABEL_H / 2 }, from: { x: edge(atX), y: b.top } },
      );
    }
    away.push({ at: { x: b.right + d + w / 2, y }, from: { x: b.right, y } }, { at: { x: b.left - d - w / 2, y }, from: { x: b.left, y } });
  }
  return away;
}

/**
 * Spots for a dimension line's value (a measurement or a gap): on the line's middle, then beside it on either side.
 * No middle when the line is shorter than the label along it, where the label would cover the line and both boxes' edges.
 */
export function lineSpots(s: Omit<Segment, 'kind'>, text: string): Point[] {
  const x = mid(s.x1, s.x2);
  const y = mid(s.y1, s.y2);
  const dy = LABEL_H / 2 + CLEARANCE;
  const dx = labelWidth(text) / 2 + CLEARANCE;
  const short = s.axis === 'x' ? Math.abs(s.x2 - s.x1) < labelWidth(text) : Math.abs(s.y2 - s.y1) < LABEL_H;
  const spots = s.axis === 'x' ? [{ x, y }, { x, y: y - dy }, { x, y: y + dy }] : [{ x, y }, { x: x + dx, y }, { x: x - dx, y }];
  return short ? spots.slice(1) : spots;
}

// how far a led-away value sits from what it describes, nearest first (to the label's nearest edge)
export const AWAY = [16, 32] as const;

/**
 * Pass-2 spots of a padding value whose band is `band`, on `side` of the box `border`: slid to either end of the band
 * when it is long enough (still on the band, so no leader), then outside the box, perpendicular to that side, led from the band's middle.
 */
export function paddingAway(band: Rect, border: Rect, side: 'top' | 'right' | 'bottom' | 'left', text: string): Away[] {
  const w = labelWidth(text);
  const from = { x: mid(band.left, band.right), y: mid(band.top, band.bottom) };
  const across = side === 'top' || side === 'bottom';
  const slid = across
    ? band.right - band.left >= w + 2 * CLEARANCE ? [band.left + CLEARANCE + w / 2, band.right - CLEARANCE - w / 2].map((x) => ({ at: { x, y: from.y } })) : []
    : band.bottom - band.top >= LABEL_H + 2 * CLEARANCE ? [band.top + CLEARANCE + LABEL_H / 2, band.bottom - CLEARANCE - LABEL_H / 2].map((y) => ({ at: { x: from.x, y } })) : [];
  const out = AWAY.map((d) => {
    switch (side) {
      case 'top':
        return { x: from.x, y: border.top - d - LABEL_H / 2 };
      case 'bottom':
        return { x: from.x, y: border.bottom + d + LABEL_H / 2 };
      case 'left':
        return { x: border.left - d - w / 2, y: from.y };
      case 'right':
        return { x: border.right + d + w / 2, y: from.y };
      default: {
        const _exhaustive: never = side;
        return _exhaustive;
      }
    }
  });
  return [...slid, ...out.map((at) => ({ at, from }))];
}

/** Pass-2 spots of a gap value: perpendicular to its line, at each AWAY distance on either side (like `lineSpots`), led from the line's middle. */
export function lineAway(s: Omit<Segment, 'kind'>, text: string): Away[] {
  const from = { x: mid(s.x1, s.x2), y: mid(s.y1, s.y2) };
  const half = s.axis === 'x' ? LABEL_H / 2 : labelWidth(text) / 2;
  return AWAY.flatMap((d) =>
    [1, -1].map((sign) => ({
      at: s.axis === 'x' ? { x: from.x, y: from.y - sign * (d + half) } : { x: from.x + sign * (d + half), y: from.y },
      from,
    })),
  );
}
