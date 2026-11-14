import { collect, radiusLabels, rounded, type Corners } from '../core/blueprint';
import { blueprintKids, bounds, deepElementAt, isTypingInPage, lookAt, parentOf, readBoxes, readGaps, readRadii, readSpec, zoomOf, type Boxes, type ShadowOf } from '../core/dom';
import type { Gap } from '../core/gap';
import { HINT_H, hintParts, hintWidth, placeHint, type HintState, type PlacedHint } from '../core/hint';
import { LABEL_H, labelWidth, lineSpots, placeLabels, segmentSpots, sizeSpots, type Anchors, type Label } from '../core/labels';
import { mid, touchLimit, type Measurement } from '../core/measure';
import { followMeasurement, followPoint, glider } from '../core/motion';
import { formatPx, height, ring, sizeLabel, union, width, type Rect } from '../core/rect';
import { css } from '../core/spec';
import { copyText } from './clipboard';

/** Picks the label's color: size blue, measurement red, gap purple, padding green. */
export type LabelKind = 'size' | 'measure' | 'gap' | 'padding';
export type PlacedLabel = { text: string; kind: LabelKind; box: Rect };

// higher places first. The selection size outranks the hover size so it doesn't move while hovering around.
const PRIORITY = { toast: 7, chip: 6, measure: 5, hidden: 3.5, selection: 3, hoverSize: 2 };
// Details sit below every other label (research Phần 05 §5): the selected element's gaps, radius and
// padding, then Blueprint's child sizes by area, gaps, padding, radius. Padding outranks radius: a padding
// value has one spot, in its band, while radius falls back to just outside its corner, or to another corner
// when all four match (a pill's inside corner spot covers its side padding value). A hovered node's size comes back as
// the hover size, its other labels get `hoverBoost`, which keeps them above other details and below that size.
const DETAILS = { rootGap: 1, rootPadding: 0.97, rootRadius: 0.95, size: 0.5, sizeByArea: 0.3, gap: 0.4, padding: 0.35, radius: 0.3, hoverBoost: 1 };

/** Everything the overlay draws for one animation frame. Plain numbers only. */
export type Frame = {
  hover: Boxes | null;
  /** Viewport px at or under which the hover target's bands are touching and not drawn (`touchLimit`). */
  hoverTouch: number;
  /** Bounds of each selected element. */
  selected: Rect[];
  /** Union of `selected`: what measurements are taken from. */
  selection: Rect | null;
  /** Alt held, with a selection. */
  measuring: boolean;
  measurement: Measurement | null;
  /** Gaps of the flex / grid containers among `details`' nodes. */
  gaps: Gap[];
  /** Every label that fits without overlapping another; the rest are hidden. */
  labels: PlacedLabel[];
  /** Details of the one selected element; `B` adds the last-selected element's descendants. Null when none or measuring. */
  details: {
    /** `B`: bounds of each kept descendant (the root has the selection outline). */
    outlines: Rect[];
    /** Padding bands of every kept node, root included. */
    padding: Rect[];
    /** Rounded nodes: bounds and clamped radii. */
    corners: { box: Rect; radii: Corners }[];
  } | null;
  /** The Hint at the pointer; null while measuring or with the pointer outside this frame. */
  hint: PlacedHint | null;
};

const TOAST_MS = 1500;
const NOTICE_MS = 6000;
// share of the way an outline glides per 60 Hz frame: ~95% there in 120 ms
const GLIDE = 0.35;

const boxList = (b: Boxes) => [b.margin, b.border, b.padding, b.content];

// a letter shortcut: first press, no modifier, so Cmd/Ctrl+C and friends stay with the page
const isBareKeydown = (e: KeyboardEvent) => e.type === 'keydown' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

// Blocked while measure mode is on so links and buttons of the page don't fire.
const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

/**
 * Tracks pointer, Alt and selection, and re-reads geometry every animation frame while on,
 * so scroll, sticky elements, transitions and DOM changes need no separate observers.
 * `stop` removes every listener; `notify` shows a message toast for a few seconds.
 * Label numbers are CSS px: viewport px over the CSS `zoom` of what they describe (rects stay viewport px).
 */
export function startController({ host, shadowOf, onFrame, onExit }: {
  host: Element;
  shadowOf: ShadowOf;
  onFrame: (frame: Frame) => void;
  onExit: () => void;
}): { stop: () => void; notify: (text: string) => void } {
  let pointer: { x: number; y: number } | null = null;
  let alt = false;
  // `B`: annotates the last-selected element's subtree until B or Esc; follows the selection
  let blueprint = false;
  // in click order: the last one is what Copy and Blueprint describe
  let selected: Element[] = [];
  // deepest element under the last plain click, null after Shift+click or Esc; while set, the selection is it or an ancestor it climbed to
  let lastHit: Element | null = null;
  let last = '';
  let raf = 0;
  // "Copied CSS" or the clipboard error, until `until` (performance.now())
  let toast: { text: string; ok: boolean; until: number } | null = null;
  let anchors: Anchors = new Map();
  // stable per-element label ids, so a label keeps its spot only while it describes the same element
  const ids = new WeakMap<Element, number>();
  let nextId = 0;
  const idOf = (el: Element) => ids.get(el) ?? (ids.set(el, nextId), nextId++);
  // clicking the one selected element (or the same spot again) climbs, so a container its children cover is reachable: that element, else undefined
  const climbsFrom = (el: Element | null) => {
    const one = selected.length === 1 ? selected[0] : undefined;
    return one && el && (el === one || el === lastHit) ? one : undefined;
  };
  const readGlide = (el: Element) => (el.isConnected ? boxList(readBoxes(el)) : null);
  const glideHover = glider(readGlide);
  const glideSelection = glider(readGlide);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let lastFrame = performance.now();
  const ac = new AbortController();
  const capture = { capture: true, signal: ac.signal };

  const clearTransient = () => {
    alt = false;
    pointer = null;
  };

  window.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    alt = e.altKey; // resync in case a keyup was lost
  }, { ...capture, passive: true });

  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) pointer = null; // left the window
  }, capture);

  for (const type of BLOCKED) {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'pointerdown' && e instanceof PointerEvent && e.button === 0) {
        // blocking mousedown also blocks the focus move into this frame, and keys would go to the frame focused before
        window.focus();
        const el = deepElementAt(e.clientX, e.clientY, host, shadowOf);
        if (e.shiftKey) {
          lastHit = null;
          if (el) selected = selected.includes(el) ? selected.filter((s) => s !== el) : [...selected, el];
        } else {
          const one = climbsFrom(el);
          selected = one ? [parentOf(one) ?? one] : el ? [el] : [];
          lastHit = el;
        }
      }
    }, capture);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === 'Alt') {
      alt = e.type === 'keydown';
      // stops Windows Chrome / Firefox from focusing the browser menu
      if (!isTypingInPage(host, shadowOf)) e.preventDefault();
      return;
    }
    // `code`, not `key`: a Cyrillic layout reports `и` for this key
    if (e.code === 'KeyB' && selected.length > 0 && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      blueprint = !blueprint;
      return;
    }
    // Copy: the last-selected element's spec as CSS
    const from = selected.at(-1);
    if (e.code === 'KeyC' && from && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // synchronously inside the keydown: the clipboard needs its user activation
      void copyText(css(readSpec(from))).then((ok) => {
        toast = { text: ok ? 'Copied CSS' : 'Copy failed: clipboard unavailable on this page', ok, until: performance.now() + TOAST_MS };
      });
      return;
    }
    if (e.key === 'Escape' && e.type === 'keydown' && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // while measuring the blueprint is hidden, so Esc skips it
      if (blueprint && !alt) blueprint = false;
      else if (selected.length > 0) {
        selected = [];
        lastHit = null;
      } else onExit();
    }
  };
  window.addEventListener('keydown', onKey, capture);
  window.addEventListener('keyup', onKey, capture);

  // keyup never arrives once the window loses focus
  window.addEventListener('blur', clearTransient, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearTransient();
  }, { signal: ac.signal });

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const ms = now - lastFrame;
    lastFrame = now;
    selected = selected.filter((el) => el.isConnected);
    if (selected.length === 0) blueprint = false;
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    // read every frame: browser zoom and moving the window to another display change it
    const dpr = window.devicePixelRatio;
    const target = pointer ? deepElementAt(pointer.x, pointer.y, host, shadowOf) : null;
    const selectedRects = selected.map(bounds);
    const selRect = union(selectedRects);
    const hover = target ? readBoxes(target) : null;
    const measuring = alt && selRect !== null;
    // reduced motion snaps. Measuring glides too: lines are drawn on the shown boxes, and the number stays the real distance.
    const factor = reducedMotion.matches ? 1 : GLIDE;
    const [margin, border, padding, content] = glideHover.step(target, hover ? boxList(hover) : [], ms, factor);
    const shownHover = hover && { margin: margin ?? hover.margin, border: border ?? hover.border, padding: padding ?? hover.padding, content: content ?? hover.content };
    // one element glides its whole box model; a multi-selection snaps to the union
    const single = selected.length === 1 ? selected[0] ?? null : null;
    const singleBoxes = single ? readBoxes(single) : null;
    const glidedSel = glideSelection.step(single, singleBoxes ? boxList(singleBoxes) : selRect ? [selRect] : [], ms, factor);
    const shownSingle = singleBoxes
      ? { margin: glidedSel[0] ?? singleBoxes.margin, border: glidedSel[1] ?? singleBoxes.border, padding: glidedSel[2] ?? singleBoxes.padding, content: glidedSel[3] ?? singleBoxes.content }
      : null;
    const shownSel = shownSingle?.border ?? glidedSel[0] ?? selRect;
    // a measurement's numbers are in CSS px of the nearest element containing both ends
    const measureZoom = measuring && target ? zoomOf([...selected, target]) : 1;
    const measurement = measuring && hover && selRect && shownSel && shownHover && target && !selected.includes(target)
      ? followMeasurement(selRect, shownSel, hover.border, shownHover.border, touchLimit(dpr, measureZoom))
      : null;
    // details: one selected element, or with `B` the last-selected one and its descendants
    const root = measuring ? undefined : blueprint ? selected.at(-1) : selected.length === 1 ? selected[0] : undefined;
    // re-collected every frame like everything else, so scrolling reveals what the viewport cut
    const bp = root && blueprint ? collect(root, (el) => blueprintKids(el, host, shadowOf), lookAt, viewport) : null;
    // the root from the element itself: collect drops one under 8px or out of view
    const kept = (root ? [root, ...(bp?.nodes ?? []).map((k) => k.node).filter((n) => n !== root)] : []).map((node) => ({ node, boxes: readBoxes(node), touch: touchLimit(dpr, zoomOf([node])) }));
    // the one selected element's own boxes are the ones gliding; Blueprint descendants stay where they are
    const drawnBoxes = (node: Element, boxes: Boxes) => (shownSingle && node === single ? shownSingle : boxes);
    const drawnGap = (el: Element, g: Gap): Gap => {
      if (!shownSingle || !singleBoxes || el !== single) return g;
      const a = followPoint(singleBoxes.border, shownSingle.border, g.x1, g.y1);
      const b = followPoint(singleBoxes.border, shownSingle.border, g.x2, g.y2);
      return { ...g, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    };
    const gapsOf = kept.map((k) => ({ el: k.node, gaps: readGaps(k.node, host, shadowOf, k.touch).map((g) => drawnGap(k.node, g)) }));
    const corners = kept.map((k) => ({ el: k.node, box: drawnBoxes(k.node, k.boxes).border, radii: readRadii(k.node, k.boxes.border) }));

    const labels: (Label & { kind: LabelKind })[] = [];
    // `pinned`: details labels are hidden rather than pushed away from what they describe
    const add = (id: string, text: string, kind: LabelKind, priority: number, at: (text: string) => Label['at'], pinned = false) =>
      labels.push({ id, text, kind, priority, at: at(text), pinned });
    if (toast && performance.now() > toast.until) toast = null;
    if (toast) {
      // the top spot for when the hint sits on the bottom one
      add('toast', toast.text, toast.ok ? 'size' : 'measure', PRIORITY.toast, () => [{ x: window.innerWidth / 2, y: window.innerHeight - 20 }, { x: window.innerWidth / 2, y: 20 }]);
    }
    if (measuring) {
      add('chip', '⌥ measuring', 'measure', PRIORITY.chip, () => [{ x: window.innerWidth - 60, y: window.innerHeight - 20 }]);
    }
    if (measurement && target) {
      const key = `m:${selected.map(idOf).join()}>${idOf(target)}`;
      measurement.segments.forEach((s, i) => add(`${key}:${i}`, formatPx(s.value / measureZoom), 'measure', PRIORITY.measure, (t) => segmentSpots(s, t)));
    }
    // sizes are hidden while measuring: they sit where the vertical spacing label usually goes
    if (selRect && !measuring) {
      add(`sel:${selected.map(idOf).join()}`, sizeLabel(selRect, zoomOf(selected)), 'size', PRIORITY.selection, (t) => sizeSpots(shownSel ?? selRect, t));
    }
    // hovering the one selected element would repeat its size label
    if (hover && target && !measuring && !(selected.length === 1 && selected[0] === target)) {
      add(`size:${idOf(target)}`, sizeLabel(hover.border, zoomOf([target])), 'size', PRIORITY.hoverSize, (t) => sizeSpots((shownHover ?? hover).border, t));
    }
    if (bp && root) {
      const r = shownSingle && root === single ? shownSingle.border : bounds(root);
      if (bp.hidden > 0) {
        add('bp:hidden', `+${bp.hidden} hidden`, 'size', PRIORITY.hidden, (t) => [
          { x: r.right - labelWidth(t) / 2, y: r.top - 4 - LABEL_H / 2 },
          { x: r.right - 4 - labelWidth(t) / 2, y: r.top + 4 + LABEL_H / 2 },
        ]);
      }
    }
    const area = width(viewport) * height(viewport);
    // a hovered node's labels come back first, like its hover size (ticket 06)
    const boostOf = (el: Element) => (el === target ? DETAILS.hoverBoost : 0);
    for (const { node, boxes, touch } of kept) {
      const id = idOf(node);
      const z = zoomOf([node]);
      const drawn = drawnBoxes(node, boxes);
      const boost = boostOf(node);
      if (node !== root && node !== target) {
        add(`size:${id}`, sizeLabel(boxes.border, z), 'size', DETAILS.size + DETAILS.sizeByArea * Math.min(1, (width(boxes.border) * height(boxes.border)) / area), (t) => sizeSpots(boxes.border, t));
      }
      // the number is the real padding; the spot rides the band that is on screen
      const p = drawn.padding;
      const c = drawn.content;
      const rp = boxes.padding;
      const rc = boxes.content;
      const sides = [
        [rc.top - rp.top, mid(p.left, p.right), mid(p.top, c.top)],
        [rp.right - rc.right, mid(c.right, p.right), mid(p.top, p.bottom)],
        [rp.bottom - rc.bottom, mid(p.left, p.right), mid(c.bottom, p.bottom)],
        [rc.left - rp.left, mid(p.left, c.left), mid(p.top, p.bottom)],
      ] as const;
      sides.forEach(([value, x, y], i) => {
        if (value > touch) add(`pad:${id}:${i}`, formatPx(value / z), 'padding', boost + (node === root ? DETAILS.rootPadding : DETAILS.padding), () => [{ x, y }], true);
      });
    }
    for (const { el, gaps } of gapsOf) {
      const z = zoomOf([el]);
      const priority = boostOf(el) + (el === root ? DETAILS.rootGap : DETAILS.gap);
      gaps.forEach((g, i) => add(`gap:${idOf(el)}:${i}`, formatPx(g.value / z), 'gap', priority, (t) => lineSpots(g, t), true));
    }
    for (const { el, box, radii } of corners) {
      const priority = boostOf(el) + (el === root ? DETAILS.rootRadius : DETAILS.radius);
      radiusLabels(box, radii, zoomOf([el])).forEach((l, i) => add(`r:${idOf(el)}:${i}`, l.text, 'size', priority, () => l.at, true));
    }
    const one = climbsFrom(target);
    const hintState: HintState = blueprint ? { kind: 'blueprint' } : selected.length > 0 ? { kind: 'selection', climbs: !!one && parentOf(one) !== null } : { kind: 'idle' };
    const parts = hintParts(hintState);
    const hint = pointer && !measuring ? { box: placeHint(pointer, hintWidth(parts), HINT_H, viewport), parts } : null;
    const placed = placeLabels(labels, viewport, anchors, hint ? [hint.box] : []);
    // a gliding label sweeps across others: keep the spots from before, or they'd stay where it pushed them
    if (!glideHover.moving && !glideSelection.moving) anchors = placed.anchors;

    const frame: Frame = {
      hover: shownHover,
      hoverTouch: touchLimit(dpr, target ? zoomOf([target]) : 1),
      selected: selected.length === 1 && shownSel ? [shownSel] : selectedRects,
      selection: shownSel,
      measuring,
      measurement,
      gaps: gapsOf.flatMap((o) => o.gaps),
      labels: placed.shown.map(({ text, kind, box }) => ({ text, kind, box })),
      details: root ? {
        outlines: kept.filter((k) => k.node !== root).map((k) => k.boxes.border),
        padding: kept.flatMap((k) => {
          const b = drawnBoxes(k.node, k.boxes);
          return ring(b.padding, b.content, k.touch);
        }),
        corners: corners.filter((c) => c.radii.some(rounded)).map(({ box, radii }) => ({ box, radii })),
      } : null,
      hint,
    };
    const key = JSON.stringify(frame);
    if (key !== last) {
      last = key;
      onFrame(frame);
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    stop: () => {
      ac.abort();
      cancelAnimationFrame(raf);
    },
    notify: (text) => {
      toast = { text, ok: true, until: performance.now() + NOTICE_MS };
    },
  };
}
