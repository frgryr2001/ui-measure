import { collect, radiusLabels, rounded, type Corners } from '../core/blueprint';
import { blueprintKids, bounds, childrenOf, deepElementAt, isTypingInPage, lookAt, parentOf, readBoxes, readGaps, readRadii, readSpec, siblingOf, zoomOf, type Boxes, type ShadowOf } from '../core/dom';
import type { Gap } from '../core/gap';
import { LABEL_H, labelWidth, lineSpots, placeLabels, sizeSpots, type Anchors, type Label } from '../core/labels';
import { EPSILON, measure, mid, type Measurement } from '../core/measure';
import { ease } from '../core/motion';
import { formatPx, height, ring, sizeLabel, union, width, type Edges, type Rect } from '../core/rect';
import { FORMATS, type Format } from '../core/spec';
import { copyText } from './clipboard';

/** Picks the label's color: size blue, measurement red, gap purple, padding green. */
export type LabelKind = 'size' | 'measure' | 'gap' | 'padding';
export type PlacedLabel = { text: string; kind: LabelKind; box: Rect };

// higher places first. The hover target's gaps outrank the selection size so a hidden gap returns on
// hover unless a sibling gap or the chip holds its spots; the selection size outranks the hover size so it doesn't move while hovering around.
const PRIORITY = { toast: 7, chip: 6, measure: 5, hoverGap: 4, hidden: 3.5, selection: 3, hoverSize: 2, gap: 1 };
// Blueprint labels sit below every other label (research Phần 05 §5): the root's padding, child
// sizes by area, gaps, child padding, radius. A hovered child's size comes back as the hover size,
// its padding and radius get `hoverBoost`, which keeps them above other blueprint labels and below that size.
const BLUEPRINT = { rootPadding: 0.95, size: 0.5, sizeByArea: 0.3, gap: 0.4, padding: 0.3, radius: 0.2, hoverBoost: 1 };

/** Everything the overlay draws for one animation frame. Plain numbers only. */
export type Frame = {
  hover: Boxes | null;
  /** Bounds of each selected element. */
  selected: Rect[];
  /** Union of `selected`: what measurements are taken from. */
  selection: Rect | null;
  /** Alt held or measure lock on, with a selection. */
  measuring: boolean;
  measurement: Measurement | null;
  /** Gaps of the hover target and selected elements that are flex / grid containers; none while measuring. */
  gaps: Gap[];
  /** Every label that fits without overlapping another; the rest are hidden. */
  labels: PlacedLabel[];
  /** `B`: the last-selected element's subtree; its gaps are in `gaps`. Null when off or measuring. */
  blueprint: {
    /** Bounds of each kept descendant (the root has the selection outline). */
    outlines: Rect[];
    /** Padding bands of every kept node, root included. */
    padding: Rect[];
    /** Rounded nodes: bounds and clamped radii. */
    corners: { box: Rect; radii: Corners }[];
  } | null;
};

// Copy the last-selected element's spec; `code`, like L and B
const COPY_KEYS = new Map<string, { format: Format; toast: string }>([
  ['KeyC', { format: 'css', toast: 'Copied CSS' }],
  ['KeyJ', { format: 'json', toast: 'Copied JSON' }],
  ['KeyP', { format: 'prompt', toast: 'Copied prompt' }],
]);
const TOAST_MS = 1500;
const NOTICE_MS = 6000;
// share of the way an outline glides per 60 Hz frame: ~95% there in 120 ms
const GLIDE = 0.35;

const shift = (r: Rect, o: Edges, k: number): Rect => ({ left: r.left + o.left * k, top: r.top + o.top * k, right: r.right + o.right * k, bottom: r.bottom + o.bottom * k });

/**
 * Smooth motion for one outline. Moving to another element, it starts at the boxes shown last and glides;
 * shown = real + a lag that `ease` shrinks, so the same element moving (scroll, transitions) follows instantly.
 */
function glider() {
  let el: Element | null = null;
  let shown: Rect[] = [];
  let lags: Edges[] = [];
  return (next: Element | null, real: Rect[], ms: number, factor: number): Rect[] => {
    const start = next !== el ? (el && next ? real.map((r, i) => shift(shown[i] ?? r, r, -1)) : []) : lags;
    el = next;
    lags = ease(start, ms, factor);
    shown = real.map((r, i) => {
      const o = lags[i];
      return o ? shift(r, o, 1) : r;
    });
    return shown;
  };
}

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
  let locked = false;
  // `B`: annotates the last-selected element's subtree until B or Esc; follows the selection
  let blueprint = false;
  // in click order: the last one is where navigation keys start from
  let selected: Element[] = [];
  let last = '';
  let raf = 0;
  // "Copied CSS" or the clipboard error, until `until` (performance.now())
  let toast: { text: string; ok: boolean; until: number } | null = null;
  let anchors: Anchors = new Map();
  // stable per-element label ids, so a label keeps its spot only while it describes the same element
  const ids = new WeakMap<Element, number>();
  let nextId = 0;
  const idOf = (el: Element) => ids.get(el) ?? (ids.set(el, nextId), nextId++);
  const glideHover = glider();
  const glideSelection = glider();
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
        if (!e.shiftKey) selected = el ? [el] : [];
        else if (el) selected = selected.includes(el) ? selected.filter((s) => s !== el) : [...selected, el];
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
    // `code`, not `key`: a Cyrillic layout reports `д` for this key
    if (e.code === 'KeyL' && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      locked = !locked;
      return;
    }
    if (e.code === 'KeyB' && selected.length > 0 && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      blueprint = !blueprint;
      return;
    }
    // the last-selected element: what Copy writes out and where navigation keys start from
    const from = selected.at(-1);
    const copy = COPY_KEYS.get(e.code);
    if (copy && from && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // synchronously inside the keydown: the clipboard needs its user activation
      void copyText(FORMATS[copy.format](readSpec(from))).then((ok) => {
        toast = { text: ok ? copy.toast : 'Copy failed: clipboard unavailable on this page', ok, until: performance.now() + TOAST_MS };
      });
      return;
    }
    // Shift+Enter parent, Enter first child, (Shift+)Tab siblings; without a selection the page keeps Tab
    if (from && (e.key === 'Enter' || e.key === 'Tab') && e.type === 'keydown' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const next =
        e.key === 'Tab'
          ? siblingOf(from, e.shiftKey ? -1 : 1, host, shadowOf)
          : e.shiftKey
            ? parentOf(from)
            : (childrenOf(from, host, shadowOf)[0] ?? null);
      if (next) selected = [next];
      return;
    }
    if (e.key === 'Escape' && e.type === 'keydown' && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // while measuring the blueprint is hidden, so Esc skips it
      if (blueprint && !alt && !locked) blueprint = false;
      else if (selected.length > 0) selected = [];
      else onExit();
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
    const target = pointer ? deepElementAt(pointer.x, pointer.y, host, shadowOf) : null;
    const selectedRects = selected.map(bounds);
    const selRect = union(selectedRects);
    const hover = target ? readBoxes(target) : null;
    const measuring = (alt || locked) && selRect !== null;
    // outlines (and the hover size label) glide; while measuring they snap, so lines meet them where the numbers say
    const factor = measuring || reducedMotion.matches ? 1 : GLIDE;
    const [margin, border, padding, content] = glideHover(target, hover ? [hover.margin, hover.border, hover.padding, hover.content] : [], ms, factor);
    const shownHover = hover && { margin: margin ?? hover.margin, border: border ?? hover.border, padding: padding ?? hover.padding, content: content ?? hover.content };
    // only one element to another one glides; a multi-selection snaps
    const shownSel = glideSelection(selected.length === 1 ? (selected[0] ?? null) : null, selRect ? [selRect] : [], ms, factor)[0] ?? selRect;
    const measurement = measuring && hover && target && !selected.includes(target) ? measure(selRect, hover.border) : null;
    // re-collected every frame like everything else, so scrolling reveals what the viewport cut
    const root = blueprint && !measuring ? selected.at(-1) : undefined;
    const bp = root ? collect(root, (el) => blueprintKids(el, host, shadowOf), lookAt, viewport) : null;
    const kept = (bp?.nodes ?? []).map((k) => ({ ...k, boxes: readBoxes(k.node) }));
    const inBlueprint = new Set(kept.map((k) => k.node));
    // the hover target keeps its own size and gap labels (they outrank blueprint ones), so blueprint skips them
    const gapsOf = (measuring ? [] : [...new Set(target ? [...selected, target] : selected)])
      .filter((el) => el === target || !inBlueprint.has(el))
      .map((el) => ({ el, gaps: readGaps(el, host, shadowOf) }));
    const blueprintGaps = kept.filter((k) => k.node !== target).map((k) => ({ el: k.node, gaps: readGaps(k.node, host, shadowOf) }));
    const corners = kept.map((k) => ({ el: k.node, box: k.boxes.border, radii: readRadii(k.node, k.boxes.border) }));

    const labels: (Label & { kind: LabelKind })[] = [];
    const add = (id: string, text: string, kind: LabelKind, priority: number, at: (text: string) => Label['at']) =>
      labels.push({ id, text, kind, priority, at: at(text) });
    if (toast && performance.now() > toast.until) toast = null;
    if (toast) {
      add('toast', toast.text, toast.ok ? 'size' : 'measure', PRIORITY.toast, () => [{ x: window.innerWidth / 2, y: window.innerHeight - 20 }]);
    }
    if (measuring || locked) {
      add('chip', locked ? '⌥ lock (L)' : '⌥ measuring', 'measure', PRIORITY.chip, () => [{ x: window.innerWidth - 60, y: window.innerHeight - 20 }]);
    }
    if (measurement && target) {
      const key = `m:${selected.map(idOf).join()}>${idOf(target)}`;
      const z = zoomOf([...selected, target]);
      measurement.segments.forEach((s, i) => add(`${key}:${i}`, formatPx(s.value / z), 'measure', PRIORITY.measure, (t) => lineSpots(s, t)));
    }
    // sizes are hidden while measuring: they sit where the vertical spacing label usually goes.
    // At the real box, not the gliding one: it outranks most labels, and sweeping across them would move them for good (sticky anchors)
    if (selRect && !measuring) {
      add(`sel:${selected.map(idOf).join()}`, sizeLabel(selRect, zoomOf(selected)), 'size', PRIORITY.selection, (t) => sizeSpots(selRect, t));
    }
    // hovering the one selected element would repeat its size label
    if (hover && target && !measuring && !(selected.length === 1 && selected[0] === target)) {
      add(`size:${idOf(target)}`, sizeLabel(hover.border, zoomOf([target])), 'size', PRIORITY.hoverSize, (t) => sizeSpots((shownHover ?? hover).border, t));
    }
    for (const { el, gaps } of gapsOf) {
      const priority = el === target ? PRIORITY.hoverGap : PRIORITY.gap;
      const z = zoomOf([el]);
      gaps.forEach((g, i) => add(`gap:${idOf(el)}:${i}`, formatPx(g.value / z), 'gap', priority, (t) => lineSpots(g, t)));
    }
    if (bp && root) {
      const r = bounds(root);
      if (bp.hidden > 0) {
        add('bp:hidden', `+${bp.hidden} hidden`, 'size', PRIORITY.hidden, (t) => [
          { x: r.right - labelWidth(t) / 2, y: r.top - 4 - LABEL_H / 2 },
          { x: r.right - 4 - labelWidth(t) / 2, y: r.top + 4 + LABEL_H / 2 },
        ]);
      }
      const area = width(viewport) * height(viewport);
      for (const { node, boxes } of kept) {
        const id = idOf(node);
        const z = zoomOf([node]);
        const b = boxes.border;
        // a hovered node's labels come back first, like its hover size (ticket 06)
        const boost = node === target ? BLUEPRINT.hoverBoost : 0;
        if (node !== root && node !== target) {
          add(`size:${id}`, sizeLabel(b, z), 'size', BLUEPRINT.size + BLUEPRINT.sizeByArea * Math.min(1, (width(b) * height(b)) / area), (t) => sizeSpots(b, t));
        }
        const p = boxes.padding;
        const c = boxes.content;
        const sides = [
          [c.top - p.top, mid(p.left, p.right), mid(p.top, c.top)],
          [p.right - c.right, mid(c.right, p.right), mid(p.top, p.bottom)],
          [p.bottom - c.bottom, mid(p.left, p.right), mid(c.bottom, p.bottom)],
          [c.left - p.left, mid(p.left, c.left), mid(p.top, p.bottom)],
        ] as const;
        sides.forEach(([value, x, y], i) => {
          if (value > EPSILON) add(`pad:${id}:${i}`, formatPx(value / z), 'padding', boost + (node === root ? BLUEPRINT.rootPadding : BLUEPRINT.padding), () => [{ x, y }]);
        });
      }
      for (const { el, gaps } of blueprintGaps) {
        const z = zoomOf([el]);
        gaps.forEach((g, i) => add(`gap:${idOf(el)}:${i}`, formatPx(g.value / z), 'gap', BLUEPRINT.gap, (t) => lineSpots(g, t)));
      }
      for (const { el, box, radii } of corners) {
        const boost = el === target ? BLUEPRINT.hoverBoost : 0;
        radiusLabels(box, radii, zoomOf([el])).forEach((l, i) => add(`r:${idOf(el)}:${i}`, l.text, 'size', boost + BLUEPRINT.radius, () => l.at));
      }
    }
    const placed = placeLabels(labels, viewport, anchors);
    anchors = placed.anchors;

    const frame: Frame = {
      hover: shownHover,
      selected: selected.length === 1 && shownSel ? [shownSel] : selectedRects,
      selection: shownSel,
      measuring,
      measurement,
      gaps: [...gapsOf, ...blueprintGaps].flatMap((o) => o.gaps),
      labels: placed.shown.map(({ text, kind, box }) => ({ text, kind, box })),
      blueprint: bp && {
        outlines: kept.filter((k) => k.node !== root).map((k) => k.boxes.border),
        padding: kept.flatMap((k) => ring(k.boxes.padding, k.boxes.content)),
        corners: corners.filter((c) => c.radii.some(rounded)).map(({ box, radii }) => ({ box, radii })),
      },
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
