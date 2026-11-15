import { classify, keptInChain, radii, same, type Corner, type Corners, type Look } from './blueprint';
import { gapFlow, gaps, type Gap } from './gap';
import { height, inset, scaleEdges, scaleOf, width, type Edges, type Rect } from './rect';
import { selectorOf, type Spec, type Step } from './spec';
import { ANIMATED, STACK_DEFAULTS, STACK_PROPERTIES, clipLabel, clippers, contextLabel, paintPair, participantLabel, positionedPseudo, runsPast, selectionLabel, shortSelector, stackingReasons, zApplies, zNoEffect, type PaintPair, type StackNode, type StackStyle, type ZNoEffect } from './stacking';
import { DEFAULTS, STYLE_PROPERTIES, type Computed } from './styles';

export type Boxes = { margin: Rect; border: Rect; padding: Rect; content: Rect };

/** An element's shadow root; the content script passes one that reaches closed roots too (`chrome.dom.openOrClosedShadowRoot`). */
export type ShadowOf = (el: Element) => ShadowRoot | null;

const px = (v: string) => parseFloat(v) || 0;

type EdgeProperty = 'padding' | 'margin' | 'border-width';

// the shorthand, not 4 longhands: ~6× cheaper, and Blueprint reads it for hundreds of nodes every frame.
// Computed values serialize like CSS: 1 to 4 lengths, top right bottom left.
const edges = (cs: CSSStyleDeclaration, property: EdgeProperty): Edges => {
  const [top = 0, right = top, bottom = top, left = right] = cs.getPropertyValue(property).split(' ').map(px);
  return { top, right, bottom, left };
};

export const bounds = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/**
 * Box model in viewport px. Bounds come from the rendered rect, edges from computed style, scaled
 * like the rect by any transform: scale() on the element or its ancestors.
 */
export function readBoxes(el: Element): Boxes {
  const border = bounds(el);
  const cs = getComputedStyle(el);
  // shortcut: SVG / MathML have no offsetWidth, so their bands stay unscaled, and rotate() / skew() grow the rect and read as scale; use getBoxQuads() or the transform matrix if those pages matter.
  const [sx, sy] = el instanceof HTMLElement ? [scaleOf(width(border), el.offsetWidth), scaleOf(height(border), el.offsetHeight)] : [1, 1];
  const scaled = (property: EdgeProperty) => scaleEdges(edges(cs, property), sx, sy);
  const padding = inset(border, scaled('border-width'));
  return {
    border,
    padding,
    content: inset(padding, scaled('padding')),
    margin: inset(border, scaled('margin'), -1),
  };
}

const noPaint = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';

/**
 * A background drawn on the canvas, behind every box: the root's, or the body's while the root's is
 * transparent. It is not paint of that element, so a z-index below 0 still shows on top of it.
 */
const canvasBackground = (el: Element) => {
  if (el === document.documentElement) return true;
  if (el !== document.body) return false;
  const root = getComputedStyle(document.documentElement);
  return noPaint(root.backgroundColor) && root.backgroundImage === 'none';
};

/**
 * Whether `el` paints something a click means: its own background, border, shadow, text or replaced content.
 * A clear wrapper does not, so the box you see through it (a z-index below 0) can be the one selected.
 */
const paintsOwnBox = (el: Element) => {
  const cs = getComputedStyle(el);
  const background = !canvasBackground(el) && (!noPaint(cs.backgroundColor) || cs.backgroundImage !== 'none');
  const border = ['top', 'right', 'bottom', 'left'].some((side) => cs.getPropertyValue(`border-${side}-width`) !== '0px');
  const outline = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
  const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /\S/.test(n.textContent ?? ''));
  const replaced = el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLIFrameElement || el instanceof SVGElement;
  return background || border || outline || cs.boxShadow !== 'none' || text || replaced;
};

/** Deepest element at a viewport point, walking into shadow roots. A box that paints nothing does not hide the one you see through it. */
export function deepElementAt(x: number, y: number, ignore: Element, shadowOf: ShadowOf): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let root = el && shadowOf(el); root; root = el && shadowOf(el)) {
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el || el === ignore) return null;
  if (paintsOwnBox(el)) return el;
  // shortcut: a ::before / ::after that paints, and the element itself does not, is still skipped
  return deepElementsAt(x, y, ignore, shadowOf).find((hit) => paintsOwnBox(hit)) ?? el;
}

/** Parent element, stepping out of a shadow root to its host. */
export const parentOf = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

// shortcut: follows the DOM, not the flat tree, so the gaps of `<slot>`ed and `display:contents` children
// are not drawn; walk assignedElements() / grandchildren if web-component pages need it.
/**
 * Gaps between the in-flow children of a flex, grid or block container (`gapFlow`), wider than `touch` (`touchLimit`);
 * none for other elements. Children are read from the shadow root when there is one (like hit testing).
 */
export function readGaps(el: Element, ignore: Element, shadowOf: ShadowOf, touch: number): Gap[] {
  const root = shadowOf(el) ?? el;
  // most nodes of a Blueprint: no style read, no text scan
  if (root.children.length < 2) return [];
  const cs = getComputedStyle(el);
  const text = [...root.childNodes].some((n) => n instanceof Text && /\S/.test(n.data));
  const flow = gapFlow({ display: cs.display, flexDirection: cs.flexDirection, flexWrap: cs.flexWrap, text });
  if (!flow) return [];
  const items = [...root.children]
    .filter((c) => c !== ignore && c.getClientRects().length > 0 && !['absolute', 'fixed'].includes(getComputedStyle(c).position))
    .map(bounds);
  // shortcut: assumes horizontal writing-mode; swap the axes once vertical-rl / vertical-lr pages need gaps.
  return gaps(items, flow.main, flow.wrap, touch);
}

const radius = (cs: CSSStyleDeclaration, corner: string) => cs.getPropertyValue(`border-${corner}-radius`);

// plain: no padding, border or radius, so a same-size wrapper or child loses nothing by merging (see `keptInChain`).
// All-zero computed shorthands serialize as one "0px".
const decoration = (cs: CSSStyleDeclaration) => {
  const round = cs.getPropertyValue('border-radius') !== '0px';
  return { round, plain: !round && cs.getPropertyValue('padding') === '0px' && cs.getPropertyValue('border-width') === '0px' };
};

/** How the blueprint walk treats `el` (see `classify`). */
export function lookAt(el: Element): Look {
  const cs = getComputedStyle(el);
  return classify({ tag: el.tagName, display: cs.display, visibility: cs.visibility, visible: el.checkVisibility({ opacityProperty: true }), rect: bounds(el), ...decoration(cs) });
}

/**
 * Children the blueprint walks: every child, not only rendered ones, so `display:contents` ones are
 * reached. A shadow host gives its shadow root's children, then its light children (slotted
 * ones render, the rest have no box). An <svg> is a leaf.
 */
export const blueprintKids = (el: Element, ignore: Element, shadowOf: ShadowOf): Element[] =>
  el instanceof SVGElement ? [] : [...(shadowOf(el)?.children ?? []), ...el.children].filter((c) => c !== ignore);

// rendered as the blueprint walk sees it; a lone child is the chain's own rendered element, else stop at the second
// rendered one, so a long list costs two style reads
const hasOneChild = (el: Element, ignore: Element, shadowOf: ShadowOf) => {
  const kids = blueprintKids(el, ignore, shadowOf);
  if (kids.length === 1) return true;
  let n = 0;
  for (const c of kids) if (lookAt(c).kind !== 'reject' && ++n > 1) return false;
  return n === 1;
};

type Chain = Parameters<typeof keptInChain<Element>>[0];

/** `el`, then each ancestor with its bounds whose only rendered child the previous one is, deepest first (see `keptInChain`). */
function sameSizeChain(el: Element, ignore: Element, shadowOf: ShadowOf): Chain {
  const b = bounds(el);
  const chain: Chain = [{ node: el, ...decoration(getComputedStyle(el)) }];
  // bounds first: they are cheap, and differ for almost every parent
  for (let p = parentOf(el); p && same(bounds(p), b) && hasOneChild(p, ignore, shadowOf); p = parentOf(p)) chain.push({ node: p, ...decoration(getComputedStyle(p)) });
  return chain;
}

/** The box a click on `el`, the deepest element at the pointer, selects: the elements sharing its bounds are one box, kept as Blueprint keeps it. */
export const boxAt = (el: Element, ignore: Element, shadowOf: ShadowOf): Element => keptInChain(sameSizeChain(el, ignore, shadowOf)).node;

/** The element whose corner radius the selected `el` shows: itself, or a same-size wrapper merged into it (`keptInChain`). */
export const roundOf = (el: Element, ignore: Element, shadowOf: ShadowOf): Element => keptInChain(sameSizeChain(el, ignore, shadowOf)).round;

/**
 * Every element at a viewport point, topmost first, walking into shadow roots like `deepElementAt`: a host's shadow
 * elements come right before it (`elementsFromPoint` names only the host for them).
 */
function deepElementsAt(x: number, y: number, ignore: Element, shadowOf: ShadowOf): Element[] {
  const inside = (root: Document | ShadowRoot): Element[] =>
    root.elementsFromPoint(x, y).filter((e) => e !== ignore && e.getRootNode() === root).flatMap((e) => {
      const shadow = shadowOf(e);
      return shadow ? [...inside(shadow), e] : [e];
    });
  return inside(document);
}

// shortcut: elementsFromPoint skips pointer-events: none and inert content, so those can't be reached; read the paint order instead if pages need them.
/**
 * Where clicking the selected `el` again in Stacking goes: the next box under it at (x, y) that paints, past its same-size
 * wrappers and past clear boxes (so one click reaches a z-index below 0 under its parent). `<html>` is the bottom.
 * Null when nothing at that point is `el`, where a click selects the topmost box.
 */
export function boxBelow(el: Element, x: number, y: number, ignore: Element, shadowOf: ShadowOf): Element | null {
  const stack = deepElementsAt(x, y, ignore, shadowOf);
  const i = stack.indexOf(el);
  if (i < 0) return null;
  const chainOf = (e: Element) => new Set(sameSizeChain(e, ignore, shadowOf).map((c) => c.node));
  const wrappers = chainOf(el);
  for (let j = i + 1; j < stack.length; j++) {
    const e = stack[j];
    if (!e || wrappers.has(e)) continue;
    // a clear ancestor is not a stop: the pink z -1 box is what the next click is for. <html> stays the floor.
    if (e !== document.documentElement && !paintsOwnBox(e)) continue;
    const box = boxAt(e, ignore, shadowOf);
    if (box === el) continue;
    // same-size wrappers with something else painted between them (a z -1 box between <body> and <html>) are not
    // one box here: the element itself, so what lies between stays reachable
    const k = stack.indexOf(box);
    const chain = chainOf(e);
    return k > j && stack.slice(j + 1, k).some((s) => !chain.has(s)) ? e : box;
  }
  return el;
}

/** Where clicking the selected `el` again climbs: the box of the first ancestor past its same-size wrappers; `el` itself at the top of the page. */
export function boxAbove(el: Element, ignore: Element, shadowOf: ShadowOf): Element {
  const parent = parentOf(sameSizeChain(el, ignore, shadowOf).at(-1)?.node ?? el);
  return parent ? boxAt(parent, ignore, shadowOf) : el;
}

/**
 * Effective CSS `zoom` (`currentCSSZoom`) of the nearest element containing all of `els` (each counts
 * as containing itself): labels divide by it to show CSS px. 1 for none, so browser zoom is never in it.
 */
export function zoomOf(els: Element[]): number {
  const chain = (el: Element) => {
    const up: Element[] = [];
    for (let e: Element | null = el; e; e = parentOf(e)) up.push(e);
    return up;
  };
  const [first, ...rest] = els;
  if (first && rest.length === 0) return first.currentCSSZoom;
  const others = rest.map((el) => new Set(chain(el)));
  // a box-less ancestor (display:contents, <slot>) reports zoom 1, so the first one with a box counts
  const common = first && chain(first).find((a) => others.every((up) => up.has(a)) && a.getClientRects().length > 0);
  return common ? common.currentCSSZoom : 1;
}

// computed radii are CSS px, the bounds are zoomed: % resolve against the CSS size, as layout does
const cssRadii = (el: Element, b: Rect, z: number): Corners => {
  const cs = getComputedStyle(el);
  // most boxes: skip the 4 longhands
  if (cs.getPropertyValue('border-radius') === '0px') return [[0, 0], [0, 0], [0, 0], [0, 0]];
  return radii([radius(cs, 'top-left'), radius(cs, 'top-right'), radius(cs, 'bottom-right'), radius(cs, 'bottom-left')], width(b) / z, height(b) / z);
};

/** Clamped corner radii of `el`, whose bounds are `b`, in viewport px like `b` (scaled by CSS `zoom`). */
export function readRadii(el: Element, b: Rect): Corners {
  const z = el.currentCSSZoom;
  const [tl, tr, br, bl] = cssRadii(el, b, z);
  const zoomed = ([x, y]: Corner): Corner => [x * z, y * z];
  return [zoomed(tl), zoomed(tr), zoomed(br), zoomed(bl)];
}

/**
 * Flat-tree parent: the slot a slotted element is assigned to, the host for a shadow root's child. The slot is searched
 * through `shadowOf`, since `assignedSlot` is null in a closed root. Only Stacking walks it; `parentOf` skips slots.
 */
function flatParent(el: Element, shadowOf: ShadowOf): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  const root = el.parentElement && shadowOf(el.parentElement);
  if (root) for (const slot of root.querySelectorAll('slot')) if (slot.assignedNodes().includes(el)) return slot;
  return parentOf(el);
}

// a slot's assigned elements, else the shadow root's children, else the element's. The slot itself stays a child of its host.
function flatChildren(parent: Element, shadowOf: ShadowOf): readonly Element[] {
  if (parent instanceof HTMLSlotElement) {
    const assigned = parent.assignedElements();
    if (assigned.length) return assigned;
  }
  return [...(shadowOf(parent) ?? parent).children];
}

const siblingIndex = (el: Element, shadowOf: ShadowOf) => {
  const parent = flatParent(el, shadowOf);
  return parent ? flatChildren(parent, shadowOf).indexOf(el) : 0;
};

// boxes inside an <svg> (not the outer one) paint in document order: z-index and their transforms don't stack there
const inSvg = (el: Element) => el instanceof SVGElement && el.ownerSVGElement !== null;

/** Why `el`'s z-index does nothing (`zNoEffect`), null where it applies: for the Styles `z-index` row. */
export function readZNoEffect(el: Element, shadowOf: ShadowOf): ZNoEffect {
  let parent = flatParent(el, shadowOf);
  // the layout parent: the first flat-tree ancestor with a box (slots are display: contents)
  while (parent && getComputedStyle(parent).display === 'contents') parent = flatParent(parent, shadowOf);
  return zNoEffect(inSvg(el), zApplies(getComputedStyle(el).position, parent ? getComputedStyle(parent).display : ''));
}

function stackStyle(el: Element, ignore: Element, cs = getComputedStyle(el)): StackStyle {
  const read: StackStyle = { ...STACK_DEFAULTS, tag: el.localName, root: el === document.documentElement, svg: inSvg(el), topLayer: null, opacity: 1, animated: false };
  for (const p of STACK_PROPERTIES) read[p] = cs.getPropertyValue(p);
  // our own host is a top-layer popover too
  if (el !== ignore && cs.getPropertyValue('overlay') === 'auto') read.topLayer = el.localName === 'dialog' ? 'dialog' : el.matches(':fullscreen') ? 'fullscreen' : 'popover';
  // the string rounds to 6 digits ("1" for 0.9999999); Typed OM keeps the float
  const opacity = el.computedStyleMap().get('opacity');
  read.opacity = opacity instanceof CSSUnitValue ? opacity.value : parseFloat(cs.opacity);
  read.animated = el.getAnimations().some((a) => (a.playState === 'running' || a.playState === 'paused') && a.effect instanceof KeyframeEffect && a.effect.getKeyframes().some((k) => ANIMATED.some((p) => p in k)));
  return read;
}

/** What Stacking shows for `el`: labels, and the boxes of the context and the clipping ancestor to outline. */
export type Stacking = {
  /** The selection's own label, null in the plain case (`selectionLabel`). */
  label: string | null;
  /** The nearest flat-tree ancestor that is a stacking context, null when it is <html> or `el` is in the top layer. */
  context: { box: Rect; label: string } | null;
  /** The nearest ancestor that cuts `el`'s painting and that `el`'s bounds run past (`clippers`), at the box it cuts at. */
  clip: { box: Rect; label: string } | null;
};

/** `el`'s Stacking, from its flat-tree chain up to <html> (re-read each frame like geometry; 0.05–0.4 ms on real pages). */
export function readStacking(el: Element, ignore: Element, shadowOf: ShadowOf): Stacking {
  const chain: Element[] = [];
  for (let e: Element | null = el; e; e = flatParent(e, shadowOf)) chain.push(e);
  const styles = chain.map((e) => stackStyle(e, ignore));
  // z-index applies by the layout parent: the next one up with a box
  const applies = (i: number) => {
    const s = styles[i];
    return !!s && zApplies(s.position, styles.slice(i + 1).find((p) => p.display !== 'contents')?.display ?? '');
  };
  const name = (e: Element) => shortSelector(e.localName, e.id, e.classList);
  const [self] = styles;
  const at = self?.topLayer ? -1 : styles.findIndex((s, i) => i > 0 && (s.root || stackingReasons(s, applies(i)).length > 0));
  const ctx = chain[at];
  const ctxStyle = styles[at];
  const b = bounds(el);
  let clip: Stacking['clip'] = null;
  for (const c of clippers(styles)) {
    const e = chain[c.index];
    const box = e && (c.box === 'border' ? bounds(e) : readBoxes(e).padding);
    if (e && box && runsPast(b, box)) {
      clip = { box, label: clipLabel(name(e), c.why) };
      break;
    }
  }
  return {
    label: self ? selectionLabel(self, applies(0)) : null,
    context: ctx && ctxStyle && !ctxStyle.root ? { box: bounds(ctx), label: contextLabel(name(ctx), ctxStyle, applies(at)) } : null,
    clip,
  };
}

/** The stacking pair of `aEl` (the selection) and `bEl` (the hover target). Null when they are one box. */
export type StackPair = {
  pair: PaintPair;
  /** The participant elements, the ones to outline. */
  a: Element;
  b: Element;
  contextName: string;
  aLabel: string;
  bLabel: string;
  /** A positioned pseudo of each participant that can take a hit outside its border box. */
  pseudoA: '::before' | '::after' | null;
  pseudoB: '::before' | '::after' | null;
};

const readPseudo = (el: Element): '::before' | '::after' | null => {
  const read = (pseudo: '::before' | '::after') => {
    const cs = getComputedStyle(el, pseudo);
    return { content: cs.getPropertyValue('content'), position: cs.getPropertyValue('position') };
  };
  return positionedPseudo(read('::after'), read('::before'));
};

/**
 * Which of `aEl` and `bEl` paints on top. Each element on the two chains is styled once. Tree order is
 * `compareDocumentPosition`, and the flat-tree index when the two boxes sit in different trees (a slot).
 */
export function readStackPair(aEl: Element, bEl: Element, ignore: Element, shadowOf: ShadowOf): StackPair | null {
  const cache = new Map<Element, StackNode>();
  const elOf = new Map<StackNode, Element>();
  const nodeOf = (el: Element): StackNode => {
    const hit = cache.get(el);
    if (hit) return hit;
    const parentEl = flatParent(el, shadowOf);
    const parent = parentEl ? nodeOf(parentEl) : null;
    const cs = getComputedStyle(el);
    const order = Number.parseInt(cs.getPropertyValue('order'), 10);
    const node: StackNode = { style: stackStyle(el, ignore, cs), order: Number.isNaN(order) ? 0 : order, float: cs.getPropertyValue('float'), index: 0, parent };
    cache.set(el, node);
    elOf.set(node, el);
    return node;
  };
  // no child list unless the two boxes are in different trees: a slotted node against a shadow node
  const flatBefore = (x: StackNode, y: StackNode) => {
    const ex = elOf.get(x);
    const ey = elOf.get(y);
    if (!ex || !ey) return x.index < y.index;
    const pos = ex.compareDocumentPosition(ey);
    if (pos & Node.DOCUMENT_POSITION_DISCONNECTED) return siblingIndex(ex, shadowOf) < siblingIndex(ey, shadowOf);
    return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  };
  const pair = paintPair(nodeOf(aEl), nodeOf(bEl), flatBefore);
  if (!pair) return null;
  const a = elOf.get(pair.a);
  const b = elOf.get(pair.b);
  const ctx = elOf.get(pair.context);
  if (!a || !b) return null;
  const name = (el: Element) => shortSelector(el.localName, el.id, el.classList);
  return {
    pair,
    a,
    b,
    contextName: ctx ? name(ctx) : 'html',
    aLabel: participantLabel(name(a), pair.a),
    bLabel: participantLabel(name(b), pair.b),
    pseudoA: readPseudo(a),
    pseudoB: readPseudo(b),
  };
}

/** True when keyboard focus is in an editable field of the page (not our own UI). */
export function isTypingInPage(ignore: Element, shadowOf: ShadowOf): boolean {
  let el = document.activeElement;
  for (let root = el && shadowOf(el); root?.activeElement; root = shadowOf(el)) el = root.activeElement;
  if (!el || el === ignore) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** What Copy writes out for `el`: its bounds, padding, border, radius and a selector to find it again, in CSS px under CSS `zoom`. */
export function readSpec(el: Element): Spec {
  const b = bounds(el);
  const z = el.currentCSSZoom;
  const cs = getComputedStyle(el);
  const border = edges(cs, 'border-width');
  // shortcut: one style and color for the whole border (the first drawn side); emit per-side longhands if mixed borders matter.
  const side = (['top', 'right', 'bottom', 'left'] as const).find((s) => border[s] > 0) ?? 'top';
  // shortcut: inside a shadow root the chain stops at the root, so the selector only works from that root; prefix the host's selector if agents need it.
  const root = el.getRootNode();
  const chain: Step[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    // parentNode, not parentElement: the top-level children of a shadow root are siblings too
    const same = [...(e.parentNode?.children ?? [e])].filter((c) => c.localName === e?.localName);
    const id = e.id && (root instanceof Document || root instanceof ShadowRoot) && root.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1 ? CSS.escape(e.id) : '';
    chain.push({ tag: CSS.escape(e.localName), nth: same.length > 1 ? same.indexOf(e) + 1 : 0, id });
  }
  return {
    selector: selectorOf(chain),
    name: el.localName + [...el.classList].map((c) => `.${c}`).join(''),
    width: width(b) / z,
    height: height(b) / z,
    padding: edges(cs, 'padding'),
    border: { width: border, style: cs.getPropertyValue(`border-${side}-style`), color: cs.getPropertyValue(`border-${side}-color`) },
    radius: cssRadii(el, b, z),
  };
}

/**
 * The computed style Styles shows for `el` (see `styleRows`). Already CSS px inside CSS `zoom` (Chrome 148:
 * `zoom: 1.5` reads font-size 16px, margin 16px), so unlike bounds and radii nothing divides by `currentCSSZoom`.
 */
export function readStyles(el: Element): Computed {
  const cs = getComputedStyle(el);
  const read: Computed = { ...DEFAULTS };
  for (const p of STYLE_PROPERTIES) read[p] = cs.getPropertyValue(p);
  return read;
}
