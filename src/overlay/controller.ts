import { collect, radiusLabels, rounded, type Corners } from '../core/blueprint';
import { blueprintKids, bounds, boxAbove, boxAt, boxBelow, deepElementAt, isTypingInPage, lookAt, readBoxes, readGaps, readRadii, readSpec, readStacking, readStackPair, readStyles, readZNoEffect, roundOf, zoomOf, type Boxes, type ShadowOf, type StackPair } from '../core/dom';
import { beside, type Gap } from '../core/gap';
import { HINT_H, hintParts, hintWidth, measuringChip, placeHint, type HintState, type PlacedHint } from '../core/hint';
import { LABEL_H, TEXT_SAFE, cornerSpots, labelWidth, lineAway, lineSpots, paddingAway, placeLabels, sizeAway, sizeSpots, type Anchors, type Label, type Leader } from '../core/labels';
import { mid, touchLimit, type Measurement } from '../core/measure';
import { fadeOut, followMeasurement, followPoint, glider } from '../core/motion';
import { formatPx, height, intersect, ring, sizeLabel, union, width, type Rect } from '../core/rect';
import { css } from '../core/spec';
import { pairVerdict, pairWorthShowing } from '../core/stacking';
import { placeStyles, styleRows, stylesSize, type StyleRow } from '../core/styles';
import { COPY } from '../core/hint';
import { copyText } from './clipboard';

declare global {
  // User-Agent Client Hints: Chromium only, not in lib.dom yet
  interface Navigator { userAgentData?: { platform: string } }
}

/** Picks the label's fill: that role's `label` in theme.ts. */
export type LabelKind = 'size' | 'measurement' | 'gap' | 'padding' | 'radius' | 'stacking';
/** Which Stacking part a label belongs to: the selection's own, its stacking context's, the clipping ancestor's, or a pair's participant and verdict. */
export type StackingPart = 'label' | 'context' | 'clip' | 'participant' | 'verdict';
/** `leader`: a details value placed away from what it describes (GLOSSARY "Leader"). `opacity`: under 1 only while the toast fades out. */
export type PlacedLabel = { text: string; kind: LabelKind; box: Rect; leader?: Leader; opacity?: number; stacking?: StackingPart };

// higher places first. The selection size outranks the hover size so it doesn't move while hovering around.
// Stacking's labels come after the selection's W × H.
const PRIORITY = { toast: 7, chip: 6, measure: 5, hidden: 3.5, selection: 3, stacking: 2.5, stackingVerdict: 2.45, stackingContext: 2.4, stackingClip: 2.3, stackingPair: 2.2, hoverSize: 2 };
// Details sit below every other label (research Phần 05 §5): the selected element's gaps, radius and
// padding, then Blueprint's child sizes by area, gaps, padding, radius. Padding outranks radius: a padding
// value has one near spot, in its band, while radius falls back to just outside its corner, or to another corner
// when all four match (a pill's inside corner spot covers its side padding value). A hovered node's size comes back as
// the hover size, its other labels get `hoverBoost`, which keeps them above other details and below that size.
// The rest of Blueprint's labels are `late`: the selection's own values take their leaders first (ticket 25).
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
  /** `S`: the last-selected element's stacking context and the ancestor that clips it, each cut to the viewport (null for none), plus the pair's participants; null when off or measuring. */
  stacking: { context: Rect | null; clip: Rect | null; participants: Rect[] } | null;
  /** `I`: the last-selected element's Styles, in groups, next to the selection (below, above, beside, else a corner); null when closed or measuring. */
  styles: { box: Rect; groups: StyleRow[][] } | null;
};

const TOAST_MS = 1500;
// the Hint steps aside once the pointer rests this long, so a value under it shows where the user is looking
const HINT_REST_MS = 800;
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
  // last pointer move, click or handled key (performance.now()): the Hint shows until the pointer rests
  let woke = performance.now();
  const wake = () => {
    woke = performance.now();
  };
  let alt = false;
  const mac = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform);
  // `B`: Blueprint annotates the last-selected element's subtree, `S`: Stacking, until that key again or Esc; they follow the
  // selection and end with it. One at a time, so `B` in Stacking switches to Blueprint and back.
  let view: 'details' | 'blueprint' | 'stacking' = 'details';
  // `I`: the Styles panel of the last-selected element, until I or Esc; closes with the selection
  let styles = false;
  // in click order: the last one is what Copy and Blueprint describe
  let selected: Element[] = [];
  // box the last plain click picked (`boxAt`), null after Shift+click or Esc; while set, the selection is it or a box it climbed to
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
    wake();
  }, { ...capture, passive: true });

  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) pointer = null; // left the window
  }, capture);

  for (const type of BLOCKED) {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'pointerdown' && e instanceof PointerEvent && e.button === 0) {
        wake();
        // blocking mousedown also blocks the focus move into this frame, and keys would go to the frame focused before
        window.focus();
        const hit = deepElementAt(e.clientX, e.clientY, host, shadowOf);
        const el = hit && boxAt(hit, host, shadowOf);
        if (e.shiftKey) {
          lastHit = null;
          if (el) selected = selected.includes(el) ? selected.filter((s) => s !== el) : [...selected, el];
        } else {
          // in Stacking a click on the one selected element goes down the stack at that point, elsewhere picks the topmost box
          const single = view === 'stacking' && selected.length === 1 ? selected[0] : undefined;
          const below = single && boxBelow(single, e.clientX, e.clientY, host, shadowOf);
          const one = climbsFrom(el);
          selected = below ? [below] : one && !single ? [boxAbove(one, host, shadowOf)] : el ? [el] : [];
          // the stack decides in Stacking: a hit kept from it would climb on the first click after leaving
          lastHit = single ? null : el;
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
    const toggles = e.code === 'KeyB' ? 'blueprint' : e.code === 'KeyS' ? 'stacking' : null;
    if (toggles && selected.length > 0 && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      view = view === toggles ? 'details' : toggles;
      wake();
      return;
    }
    if (e.code === 'KeyI' && selected.length > 0 && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      styles = !styles;
      wake();
      return;
    }
    // Copy: the last-selected element's spec as CSS. Off while `COPY` is false; the key then reaches the page.
    const from = selected.at(-1);
    if (COPY && e.code === 'KeyC' && from && isBareKeydown(e)) {
      if (isTypingInPage(host, shadowOf)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      wake();
      // synchronously inside the keydown: the clipboard needs its user activation
      void copyText(css(readSpec(from))).then((ok) => {
        toast = { text: ok ? 'Copied CSS' : 'Copy failed: clipboard unavailable on this page', ok, until: performance.now() + TOAST_MS };
      });
      return;
    }
    if (e.key === 'Escape' && e.type === 'keydown' && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      wake();
      // while measuring Styles, Stacking and the blueprint are hidden, so Esc skips them
      if (styles && !alt) styles = false;
      else if (view !== 'details' && !alt) view = 'details';
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

  // the pair read is the expensive one (up to 1.8 ms): only when the selection or the hover target changes. Outlines are re-read every frame.
  let paired: { a: Element; b: Element; value: StackPair | null } | null = null;
  const stackPair = (a: Element, b: Element) => {
    if (!paired || paired.a !== a || paired.b !== b) paired = { a, b, value: readStackPair(a, b, host, shadowOf) };
    return paired.value;
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const ms = now - lastFrame;
    lastFrame = now;
    selected = selected.filter((el) => el.isConnected);
    if (selected.length === 0) {
      view = 'details';
      styles = false;
    }
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    // read every frame: browser zoom and moving the window to another display change it
    const dpr = window.devicePixelRatio;
    // the box a click would select, so hovering shows what a click picks
    const hit = pointer ? deepElementAt(pointer.x, pointer.y, host, shadowOf) : null;
    const target = hit && boxAt(hit, host, shadowOf);
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
    // details: one selected element, or with `B` the last-selected one and its descendants; Stacking keeps only the W × H
    const root = measuring || view === 'stacking' ? undefined : view === 'blueprint' ? selected.at(-1) : selected.length === 1 ? selected[0] : undefined;
    // re-collected every frame like everything else, so scrolling reveals what the viewport cut
    const bp = root && view === 'blueprint' ? collect(root, (el) => blueprintKids(el, host, shadowOf), lookAt, viewport) : null;
    // the root from the element itself: collect drops one under 8px or out of view
    // `round`: the element whose radius the node shows, a same-size wrapper merged into it (`keptInChain`)
    const kept = (root ? [{ node: root, round: roundOf(root, host, shadowOf) }, ...(bp?.nodes ?? []).filter((k) => k.node !== root)] : []).map(({ node, round }) => ({ node, round, boxes: readBoxes(node), touch: touchLimit(dpr, zoomOf([node])) }));
    // the one selected element's own boxes are the ones gliding; Blueprint descendants stay where they are
    const drawnBoxes = (node: Element, boxes: Boxes) => (shownSingle && node === single ? shownSingle : boxes);
    const drawnGap = (el: Element, g: Gap): Gap => {
      if (!shownSingle || !singleBoxes || el !== single) return g;
      const a = followPoint(singleBoxes.border, shownSingle.border, g.x1, g.y1);
      const b = followPoint(singleBoxes.border, shownSingle.border, g.x2, g.y2);
      return { ...g, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    };
    const gapsOf = kept.map((k) => ({ el: k.node, gaps: readGaps(k.node, host, shadowOf, k.touch).map((g) => drawnGap(k.node, g)) }));
    const corners = kept.map((k) => ({ el: k.node, box: drawnBoxes(k.node, k.boxes).border, radii: readRadii(k.round, k.boxes.border) }));

    const labels: (Label & { kind: LabelKind; stacking?: StackingPart })[] = [];
    // details labels are `pinned`, never pushed into the viewport: next to what they describe, else `away` on a leader, else hidden
    const add = (id: string, text: string, kind: LabelKind, priority: number, at: (text: string) => Label['at'], away?: (text: string) => Label['away'], pinned = !!away, late = false) =>
      labels.push({ id, text, kind, priority, at: at(text), ...(pinned ? { pinned: true } : {}), away: away?.(text), ...(late ? { late: true } : {}) });
    // a toast fades out once its time is up, keeping its spot until gone; C again shows the new one at full.
    // reduced motion fades too: opacity is no movement.
    const toastOpacity = toast ? fadeOut(performance.now() - toast.until) : 1;
    if (toastOpacity === 0) toast = null;
    if (toast) {
      // the top spot for when the hint sits on the bottom one
      add('toast', toast.text, toast.ok ? 'size' : 'measurement', PRIORITY.toast, () => [{ x: window.innerWidth / 2, y: window.innerHeight - 20 }, { x: window.innerWidth / 2, y: 20 }]);
    }
    if (measuring) {
      add('chip', measuringChip(mac), 'measurement', PRIORITY.chip, () => [{ x: window.innerWidth - 60, y: window.innerHeight - 20 }]);
    }
    if (measurement && target) {
      const key = `m:${selected.map(idOf).join()}>${idOf(target)}`;
      measurement.segments.forEach((s, i) => add(`${key}:${i}`, formatPx(s.value / measureZoom), 'measurement', PRIORITY.measure, (t) => lineSpots(s, t)));
    }
    // sizes are hidden while measuring: they sit where the vertical spacing label usually goes
    if (selRect && !measuring) {
      add(`sel:${selected.map(idOf).join()}`, sizeLabel(selRect, zoomOf(selected)), 'size', PRIORITY.selection, (t) => sizeSpots(shownSel ?? selRect, t), (t) => sizeAway(shownSel ?? selRect, t), false);
    }
    // hovering the one selected element would repeat its size label
    if (hover && target && !measuring && !(selected.length === 1 && selected[0] === target)) {
      add(`size:${idOf(target)}`, sizeLabel(hover.border, zoomOf([target])), 'size', PRIORITY.hoverSize, (t) => sizeSpots((shownHover ?? hover).border, t), (t) => sizeAway((shownHover ?? hover).border, t), false);
    }
    const stackOf = !measuring && view === 'stacking' ? selected.at(-1) : undefined;
    const stack = stackOf ? readStacking(stackOf, host, shadowOf) : null;
    // an ancestor is cut to the viewport, its label inside the part on screen
    const stackContext = stack?.context ? intersect(stack.context.box, viewport) : null;
    const stackClip = stack?.clip ? intersect(stack.clip.box, viewport) : null;
    const stackLabel = (part: StackingPart, text: string, priority: number, at: Label['at'], away?: Label['away']) =>
      labels.push({ id: `stack:${part}:${stackOf ? idOf(stackOf) : ''}`, text, kind: 'stacking', priority, at, away, stacking: part });
    if (stack?.label && stackOf) {
      const r = shownSingle && stackOf === single ? shownSingle.border : bounds(stackOf);
      stackLabel('label', stack.label, PRIORITY.stacking, sizeSpots(r, stack.label), sizeAway(r, stack.label));
    }
    if (stack?.context && stackContext) stackLabel('context', stack.context.label, PRIORITY.stackingContext, cornerSpots(stackContext, stack.context.label));
    if (stack?.clip && stackClip) stackLabel('clip', stack.clip.label, PRIORITY.stackingClip, cornerSpots(stackClip, stack.clip.label));
    // one selected element, a different hover target: the two boxes that compete, and which paints on top
    let participantBoxes: Rect[] = [];
    const read = stack && stackOf && target && selected.length === 1 && target !== stackOf ? stackPair(stackOf, target) : null;
    if (read && stackOf && target && pairWorthShowing(read.pair, intersect(bounds(stackOf), bounds(target)) !== null)) {
      const visible = (el: Element) => intersect(bounds(el), viewport);
      const aBox = visible(read.a);
      const bBox = visible(read.b);
      // the context label already reads `selector · reasons · z` on that box; a second copy only loses the fight for a spot
      const namedByContext = (el: Element, text: string) => {
        const c = stack?.context;
        if (!c || text !== c.label) return false;
        const b = bounds(el);
        return b.left === c.box.left && b.top === c.box.top && b.right === c.box.right && b.bottom === c.box.bottom;
      };
      const addPart = (el: Element, text: string, r: Rect | null) => {
        if (!r || namedByContext(el, text)) return;
        // below and beside: the verdict keeps the corners, so the name still fits on a small box
        labels.push({ id: `stack:participant:${idOf(el)}`, text, kind: 'stacking', priority: PRIORITY.stackingPair, at: sizeSpots(r, text), away: sizeAway(r, text), stacking: 'participant' });
      };
      addPart(read.a, read.aLabel, aBox);
      addPart(read.b, read.bLabel, bBox);
      const winner = read.pair.top === 'a' ? read.a : read.pair.top === 'b' ? read.b : target;
      const winnerBox = winner === read.a ? aBox : winner === read.b ? bBox : visible(winner);
      // a hit outside the winner's border box is its positioned pseudo (the only miss on real pages)
      let through: '::before' | '::after' | undefined;
      if (read.pair.top && winner === target && pointer) {
        const r = bounds(winner);
        const outside = pointer.x < r.left || pointer.y < r.top || pointer.x > r.right || pointer.y > r.bottom;
        if (outside) {
          const pseudo = read.pair.top === 'a' ? read.pseudoA : read.pseudoB;
          if (pseudo) through = pseudo;
        }
      }
      const verdict = pairVerdict(read.pair, read.contextName, through);
      if (winnerBox) labels.push({ id: `stack:verdict:${idOf(winner)}`, text: verdict, kind: 'stacking', priority: PRIORITY.stackingVerdict, at: cornerSpots(winnerBox, verdict), stacking: 'verdict' });
      participantBoxes = [aBox, bBox].filter((r) => r !== null);
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
    // a Blueprint descendant's labels wait for every other label's leaders, unless hovered
    const lateOf = (el: Element, boost: number) => el !== root && boost === 0;
    // a box holding two or more drawn boxes shows its W × H only on hover: centered, it would sit where its middle child's does
    const held = new Map<number, number>();
    for (const k of bp?.nodes ?? []) held.set(k.parent, (held.get(k.parent) ?? 0) + 1);
    const holders = new Set(bp?.nodes.filter((_, i) => (held.get(i) ?? 0) >= 2).map((k) => k.node));
    for (const { node, boxes, touch } of kept) {
      const id = idOf(node);
      const z = zoomOf([node]);
      const drawn = drawnBoxes(node, boxes);
      const boost = boostOf(node);
      // no leader: led-away child sizes would take every spot the details values need; hovering the box brings its size back, on a leader
      if (node !== root && node !== target && !holders.has(node)) {
        add(`size:${id}`, sizeLabel(boxes.border, z), 'size', DETAILS.size + DETAILS.sizeByArea * Math.min(1, (width(boxes.border) * height(boxes.border)) / area), (t) => sizeSpots(boxes.border, t), undefined, false, true);
      }
      // the number is the real padding; the spot rides the band that is on screen
      const p = drawn.padding;
      const c = drawn.content;
      const rp = boxes.padding;
      const rc = boxes.content;
      const sides = [
        ['top', rc.top - rp.top, { left: p.left, top: p.top, right: p.right, bottom: c.top }],
        ['right', rp.right - rc.right, { left: c.right, top: p.top, right: p.right, bottom: p.bottom }],
        ['bottom', rp.bottom - rc.bottom, { left: p.left, top: c.bottom, right: p.right, bottom: p.bottom }],
        ['left', rc.left - rp.left, { left: p.left, top: p.top, right: c.left, bottom: p.bottom }],
      ] as const;
      sides.forEach(([side, value, band], i) => {
        if (value <= touch) return;
        const priority = boost + (node === root ? DETAILS.rootPadding : DETAILS.padding);
        add(`pad:${id}:${i}`, formatPx(value / z), 'padding', priority, () => [{ x: mid(band.left, band.right), y: mid(band.top, band.bottom) }], (t) => paddingAway(band, drawn.border, side, t), true, lateOf(node, boost));
      });
    }
    for (const { el, gaps } of gapsOf) {
      const z = zoomOf([el]);
      gaps.forEach((g, i) => {
        // a gap beside the hovered box comes back with it, as its container's do
        const boost = hover && beside(g, hover.border) ? DETAILS.hoverBoost : boostOf(el);
        add(`gap:${idOf(el)}:${i}`, formatPx(g.value / z), 'gap', boost + (el === root ? DETAILS.rootGap : DETAILS.gap), (t) => lineSpots(g, t), (t) => lineAway(g, t), true, lateOf(el, boost));
      });
    }
    for (const { el, box, radii } of corners) {
      const boost = boostOf(el);
      const priority = boost + (el === root ? DETAILS.rootRadius : DETAILS.radius);
      radiusLabels(box, radii, zoomOf([el])).forEach((l, i) => add(`r:${idOf(el)}:${i}`, l.text, 'radius', priority, () => l.at, () => l.away, true, lateOf(el, boost)));
    }
    const one = climbsFrom(target);
    const hintShown = !!pointer && !measuring && now - woke < HINT_REST_MS;
    // a click below needs the stack at the pointer: only read while the Hint shows
    const goesBelow = () => {
      const below = hintShown && pointer && single && boxBelow(single, pointer.x, pointer.y, host, shadowOf);
      return !!below && below !== single;
    };
    // Esc closes Styles first, so the Hint names that
    const hintState: HintState = styles
      ? { kind: 'styles' }
      : view === 'stacking'
        ? { kind: 'stacking', below: goesBelow() }
        : view === 'blueprint'
          ? { kind: 'blueprint' }
          : selected.length > 0
            ? { kind: 'selection', climbs: !!one && boxAbove(one, host, shadowOf) !== one }
            : { kind: 'idle' };
    const parts = hintParts(hintState, mac);
    const hint = pointer && hintShown ? { box: placeHint(pointer, hintWidth(parts), HINT_H, viewport), parts } : null;
    // a one-line control's words: labels may sit in its padding, never on the text
    const words = (border: Rect, content: Rect): Rect[] => (height(border) < TEXT_SAFE && width(content) > 0 && height(content) > 0 ? [content] : []);
    const clear = [
      // a container with gaps holds boxes laid out apart, not a line of words: its gap values sit between them
      ...kept.flatMap((k, i) => {
        if (gapsOf[i]?.gaps.length) return [];
        const b = drawnBoxes(k.node, k.boxes);
        return words(b.border, b.content);
      }),
      // while measuring the hover has no size label, and a spacing value may sit beside its line on the target.
      // a kept box (the selection, a Blueprint node) has its words from the line above
      ...(shownHover && !measuring && !kept.some((k) => k.node === target) ? words(shownHover.border, shownHover.content) : []),
    ];
    const stylesOf = !measuring && styles ? selected.at(-1) : undefined;
    const groups = stylesOf ? styleRows(readStyles(stylesOf), readZNoEffect(stylesOf, shadowOf)) : [];
    const size = stylesSize(groups);
    // anchored to the drawn selection, so it glides with it
    const panel = stylesOf && shownSel ? { box: placeStyles(shownSel, size.w, size.h, viewport), groups } : null;
    // labels move out of the panel's way like the Hint's.
    // shortcut: the Hint may cover the panel and a value under the panel hides rather than leads away, as under the Hint; move the Hint off the panel or let values lead away if either gets in the way
    const placed = placeLabels(labels, viewport, anchors, [...(hint ? [hint.box] : []), ...(panel ? [panel.box] : [])], clear);
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
      labels: placed.shown.map(({ id, text, kind, box, leader, stacking: part }) => ({ text, kind, box, ...(leader && { leader }), ...(id === 'toast' && toastOpacity < 1 && { opacity: toastOpacity }), ...(part && { stacking: part }) })),
      details: root ? {
        outlines: kept.filter((k) => k.node !== root).map((k) => k.boxes.border),
        padding: kept.flatMap((k) => {
          const b = drawnBoxes(k.node, k.boxes);
          return ring(b.padding, b.content, k.touch);
        }),
        corners: corners.filter((c) => c.radii.some(rounded)).map(({ box, radii }) => ({ box, radii })),
      } : null,
      hint,
      styles: panel,
      stacking: stack ? { context: stackContext, clip: stackClip, participants: participantBoxes } : null,
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
