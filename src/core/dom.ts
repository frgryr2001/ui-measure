import { classify, keptInChain, radii, same, type Corner, type Corners, type Look } from './blueprint';
import { gapFlow, gaps, type Gap } from './gap';
import { height, inset, scaleEdges, scaleOf, width, type Edges, type Rect } from './rect';
import { selectorOf, type Spec, type Step } from './spec';
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

/** Deepest element at a viewport point, walking into shadow roots. */
export function deepElementAt(x: number, y: number, ignore: Element, shadowOf: ShadowOf): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let root = el && shadowOf(el); root; root = el && shadowOf(el)) {
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el === ignore ? null : el;
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
