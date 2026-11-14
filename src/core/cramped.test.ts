import { describe, expect, it } from 'vitest';
import { radiusLabels, type Corners } from './blueprint';
import { HINT_H, hintParts, hintWidth, placeHint } from './hint';
import { APART, paddingAway, placeLabels, sizeAway, sizeSpots, type Label } from './labels';
import { sizeLabel, type Rect } from './rect';

const VP: Rect = { left: 0, top: 0, right: 1280, bottom: 800 };
const corners = (r: number): Corners => [[r, r], [r, r], [r, r], [r, r]];
const box = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });

/** Gap between two boxes. Negative when they overlap; exactly the test placeLabels uses (gap < APART collides). */
const gap = (a: Rect, b: Rect) => Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);

// the Mac pill (`⌥ Option`) is the wider one
const hintBox = (x: number, y: number) => placeHint({ x, y }, hintWidth(hintParts({ kind: 'selection', climbs: false }, true)), HINT_H, VP);

type Piece = { id: string; text: string; priority: number; rect: Rect; pad?: number; radius?: number };

/** Labels the way the controller builds them for one selected box, an optional hovered child, and Blueprint children. */
function labelsOf(pieces: Piece[], rootId: string): Label[] {
  const labels: Label[] = [];
  for (const p of pieces) {
    const root = p.id === rootId;
    const size = { text: p.text, at: sizeSpots(p.rect, p.text), away: sizeAway(p.rect, p.text) };
    if (!root) labels.push({ id: `size:${p.id}`, priority: p.priority, ...size });
    else labels.push({ id: `sel:${p.id}`, priority: 3, ...size });
    if (p.pad) {
      const { left, top, right, bottom } = p.rect;
      const band = {
        top: { left, top, right, bottom: top + p.pad },
        right: { left: right - p.pad, top, right, bottom },
        bottom: { left, top: bottom - p.pad, right, bottom },
        left: { left, top, right: left + p.pad, bottom },
      };
      (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
        const b = band[side];
        const text = String(p.pad);
        const priority = (root ? 0.97 : 0.35) + (p.priority > 1 ? 1 : 0);
        labels.push({
          id: `pad:${p.id}:${side}`,
          text,
          priority,
          pinned: true,
          at: [{ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }],
          away: paddingAway(b, p.rect, side, text),
        });
      });
    }
    if (p.radius) {
      const priority = (root ? 0.95 : 0.3) + (p.priority > 1 ? 1 : 0);
      radiusLabels(p.rect, corners(p.radius)).forEach((l, i) => {
        labels.push({ id: `r:${p.id}:${i}`, text: l.text, priority, pinned: true, at: l.at, away: l.away });
      });
    }
  }
  return labels;
}

function problems(name: string, pieces: Piece[], rootId: string, pointer?: { x: number; y: number }) {
  const hint = pointer ? hintBox(pointer.x, pointer.y) : undefined;
  const { shown } = placeLabels(labelsOf(pieces, rootId), VP, new Map(), hint ? [hint] : []);
  const boxes = shown.map((l) => ({ id: l.id, text: l.text, box: l.box, leader: !!l.leader }));
  if (hint) boxes.push({ id: 'hint', text: 'hint', box: hint, leader: false });
  const tight: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const g = gap(boxes[i]!.box, boxes[j]!.box);
      if (g < APART - 0.05) tight.push(`${boxes[i]!.id} "${boxes[i]!.text}" ∩ ${boxes[j]!.id} "${boxes[j]!.text}" gap ${g.toFixed(1)}`);
    }
  }
  const hidden = labelsOf(pieces, rootId).filter((l) => !shown.some((s) => s.id === l.id)).map((l) => l.id);
  return { name, tight, hidden, shown: boxes.map((b) => `${b.id} "${b.text}" @${Math.round(b.box.left)},${Math.round(b.box.top)}${b.leader ? ' led' : ''}`) };
}

describe('cramped label placement', () => {
  const cases = [
    // the two screenshots: a 30×30 icon with r 5, and a 55×30 control holding that icon
    () => problems('icon 30×30 r5', [{ id: 'icon', text: '30 × 30', priority: 2, rect: box(400, 300, 30, 30), radius: 5 }], 'icon'),
    () => problems('icon 30×30 r5, pointer on it', [{ id: 'icon', text: '30 × 30', priority: 2, rect: box(400, 300, 30, 30), radius: 5 }], 'icon', { x: 415, y: 315 }),
    () => problems('icon 30×30 r5 pad 4', [{ id: 'icon', text: '30 × 30', priority: 2, rect: box(400, 300, 30, 30), radius: 5, pad: 4 }], 'icon', { x: 415, y: 315 }),
    () => problems('button 55×30 holding 30×30, hover the icon', [
      { id: 'btn', text: '55 × 30', priority: 3, rect: box(400, 300, 55, 30), radius: 5 },
      { id: 'icon', text: '30 × 30', priority: 2, rect: box(408, 300, 30, 30), radius: 5 },
    ], 'btn', { x: 423, y: 315 }),
    () => problems('button 55×30, icon centered vertically impossible so icon inset 0', [
      { id: 'btn', text: '55 × 30', priority: 3, rect: box(400, 280, 55, 30) },
      { id: 'icon', text: '30 × 30', priority: 2, rect: box(412, 280, 30, 30), radius: 5 },
    ], 'btn', { x: 427, y: 295 }),
  ];

  // a matrix of the sizes that actually collide on screen: short boxes, small radii, thin padding, tight rows and stacks
  const widths = [20, 24, 28, 30, 32, 40, 48, 55];
  const heights = [16, 20, 24, 28, 30, 32, 36];
  const radii = [0, 4, 5, 8, 12];
  const pads = [0, 4, 8];
  for (const w of widths) {
    for (const h of heights) {
      for (const r of radii) {
        for (const p of pads) {
          if (p > 0 && (w < p * 2 + 8 || h < p * 2 + 8)) continue;
          const rect = box(360, 240, w, h);
          cases.push(() => problems(`${w}×${h} r${r} pad${p}`, [{ id: 'b', text: sizeLabel(rect), priority: 2, rect, radius: r || undefined, pad: p || undefined }], 'b', { x: rect.left + w / 2, y: rect.top + h / 2 }));
          cases.push(() => problems(`${w}×${h} r${r} pad${p} no pointer`, [{ id: 'b', text: sizeLabel(rect), priority: 2, rect, radius: r || undefined, pad: p || undefined }], 'b'));
        }
      }
    }
  }

  // rows and stacks of icon buttons, the thing the screenshots are full of
  for (const gapOf of [0, 4, 8, 12]) {
    for (const n of [2, 4, 6]) {
      cases.push(() => {
        const pieces: Piece[] = [];
        for (let i = 0; i < n; i++) pieces.push({ id: `c${i}`, text: '28 × 28', priority: i === 0 ? 3 : 0.6, rect: box(200 + i * (28 + gapOf), 300, 28, 28), radius: 6 });
        return problems(`row ${n} gap ${gapOf}`, pieces, 'c0', { x: 214, y: 314 });
      });
      cases.push(() => {
        const pieces: Piece[] = [];
        for (let i = 0; i < n; i++) pieces.push({ id: `c${i}`, text: '55 × 30', priority: i === 0 ? 3 : 0.6, rect: box(200, 200 + i * (30 + gapOf), 55, 30), radius: 5 });
        return problems(`stack ${n} gap ${gapOf}`, pieces, 'c0', { x: 227, y: 215 });
      });
    }
  }

  it('no two labels, and no label and the hint, come closer than 4px', () => {
    const bad = cases.map((c) => c()).filter((r) => r.tight.length > 0);
    if (bad.length) {
      console.log(bad.slice(0, 25).map((r) => `${r.name}\n  ${r.tight.join('\n  ')}\n  ${r.shown.join(' | ')}`).join('\n'));
    }
    expect(bad.map((r) => `${r.name}: ${r.tight.join('; ')}`)).toEqual([]);
  });

  it('a 30 × 30 icon keeps its size off the icon and its radius on a leader', () => {
    const icon = box(400, 300, 30, 30);
    const scene = problems('icon', [{ id: 'icon', text: '30 × 30', priority: 2, rect: icon, radius: 5 }], 'icon', { x: 415, y: 315 });
    const size = scene.shown.find((s) => s.startsWith('sel:'));
    const radius = scene.shown.find((s) => s.startsWith('r:'));
    expect(size).toBeTruthy();
    expect(radius).toMatch(/led/);
    // the value is not sitting in the icon: both boxes stay clear of it
    const placed = placeLabels(labelsOf([{ id: 'icon', text: '30 × 30', priority: 2, rect: icon, radius: 5 }], 'icon'), VP, new Map(), [hintBox(415, 315)]);
    for (const l of placed.shown) expect(gap(l.box, icon)).toBeGreaterThanOrEqual(0);
  });

  it('a 55 × 30 control and the 30 × 30 icon inside it get two sizes, neither covering the icon', () => {
    const btn = box(400, 300, 55, 30);
    const icon = box(408, 300, 30, 30);
    const pieces: Piece[] = [
      { id: 'btn', text: '55 × 30', priority: 3, rect: btn, radius: 5 },
      { id: 'icon', text: '30 × 30', priority: 2, rect: icon, radius: 5 },
    ];
    const scene = problems('nested', pieces, 'btn', { x: 423, y: 315 });
    expect(scene.tight).toEqual([]);
    expect(scene.shown.some((s) => s.startsWith('sel:'))).toBe(true);
    expect(scene.shown.some((s) => s.startsWith('size:'))).toBe(true);
    const placed = placeLabels(labelsOf(pieces, 'btn'), VP, new Map(), [hintBox(423, 315)]);
    const child = placed.shown.find((l) => l.id.startsWith('size:'));
    expect(child).toBeTruthy();
    for (const l of placed.shown) expect(gap(l.box, icon), l.id).toBeGreaterThanOrEqual(0);
  });

  it('a 55 × 30 control on its own still shows its radius, on a leader', () => {
    const btn = box(400, 300, 55, 30);
    const placed = placeLabels(labelsOf([{ id: 'btn', text: '55 × 30', priority: 3, rect: btn, radius: 5 }], 'btn'), VP, new Map(), [hintBox(427, 315)]);
    const radius = placed.shown.find((l) => l.id.startsWith('r:'));
    expect(radius?.leader).toBeTruthy();
    expect(gap(radius!.box, btn)).toBeGreaterThanOrEqual(0);
  });

  it('the 17:15 toolbar: size and radius stay off the words of a short button when the strips around it are taken', () => {
    // "181.66 × 28.28" and "12" were painted on "Late …ion", "77.33 × 30" and "4" on "Default".
    // The strips above and below are the neighbouring boxes' sizes; the buttons on either side are the words beside it.
    const late = box(300, 220, 181.66, 28.28);
    const prev = box(142, 220, 150, 30);
    const def = box(489.66, 218, 77.33, 30);
    const text = '181.66 × 28.28';
    const spots = sizeSpots(late, text);
    const pieces: Piece[] = [
      { id: 'prev', text: '150 × 30', priority: 2, rect: prev, radius: 5 },
      { id: 'late', text, priority: 2, rect: late, radius: 12 },
      { id: 'def', text: '77.33 × 30', priority: 2, rect: def, radius: 4 },
    ];
    const blockers: Label[] = [
      { id: 'above', text: '268.67 × 68.28', priority: 3, at: [spots[1]!] },
      { id: 'below', text: '428 × 68.28', priority: 3, at: [spots[0]!] },
    ];
    const words = [prev, late, def];
    const { shown } = placeLabels([...blockers, ...labelsOf(pieces, 'late')], VP, new Map(), [], words);
    for (const spot of sizeSpots(late, text)) {
      const w = text.length * 6.6 + 10;
      const label = { left: spot.x - w / 2, top: spot.y - 9, right: spot.x + w / 2, bottom: spot.y + 9 };
      expect(gap(label, late), 'a near size spot on the words').toBeGreaterThanOrEqual(0);
    }
    expect(radiusLabels(late, corners(12))[0]?.at, 'a radius near spot on a one-line button').toEqual([]);
    const covering = shown.filter((l) => words.some((w) => gap(l.box, w) < 0));
    expect(covering.map((l) => `${l.id} "${l.text}"`)).toEqual([]);
    expect(shown.some((l) => l.text === text)).toBe(true);
    expect(shown.some((l) => l.id.startsWith('r:late'))).toBe(true);
  });
});
