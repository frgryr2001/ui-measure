import { classify, radii, type Corner, type Corners, type Look } from './blueprint';
import { gaps, type Gap } from './gap';
import { height, inset, scaleEdges, scaleOf, width, type Edges, type Rect } from './rect';
import { selectorOf, type Spec, type Step } from './spec';

export type Boxes = { margin: Rect; border: Rect; padding: Rect; content: Rect };

/** An element's shadow root; the content script passes one that reaches closed roots too (`chrome.dom.openOrClosedShadowRoot`). */
export type ShadowOf = (el: Element) => ShadowRoot | null;

const px = (v: string) => parseFloat(v) || 0;

const edges = (cs: CSSStyleDeclaration, prefix: string, suffix = ''): Edges => ({
  top: px(cs.getPropertyValue(`${prefix}-top${suffix}`)),
  right: px(cs.getPropertyValue(`${prefix}-right${suffix}`)),
  bottom: px(cs.getPropertyValue(`${prefix}-bottom${suffix}`)),
  left: px(cs.getPropertyValue(`${prefix}-left${suffix}`)),
});

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
  const scaled = (prefix: string, suffix?: string) => scaleEdges(edges(cs, prefix, suffix), sx, sy);
  const padding = inset(border, scaled('border', '-width'));
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

// shortcut: follows the DOM, not the flat tree, so `<slot>`ed and `display:contents` children are
// unreachable by Enter and Tab and their gaps are not drawn; walk assignedElements() / grandchildren if web-component pages need it.
/** Children that render a box, read from the shadow root when there is one (like hit testing). */
export const childrenOf = (el: Element, ignore: Element, shadowOf: ShadowOf): Element[] =>
  [...(shadowOf(el) ?? el).children].filter((c) => c !== ignore && c.getClientRects().length > 0);

/** Gaps between the in-flow children of a flex or grid container; none for other elements. */
export function readGaps(el: Element, ignore: Element, shadowOf: ShadowOf): Gap[] {
  const cs = getComputedStyle(el);
  const flex = cs.display.includes('flex');
  if (!flex && !cs.display.includes('grid')) return [];
  const items = childrenOf(el, ignore, shadowOf)
    .filter((c) => !['absolute', 'fixed'].includes(getComputedStyle(c).position))
    .map(bounds);
  // shortcut: assumes horizontal writing-mode; swap the axes once vertical-rl / vertical-lr pages need gaps.
  // a grid flows like wrapping rows
  return flex ? gaps(items, cs.flexDirection.startsWith('column') ? 'y' : 'x', cs.flexWrap !== 'nowrap') : gaps(items, 'x', true);
}

const isZero = (e: Edges) => !e.top && !e.right && !e.bottom && !e.left;
const radius = (cs: CSSStyleDeclaration, corner: string) => cs.getPropertyValue(`border-${corner}-radius`);

/** How the blueprint walk treats `el` (see `classify`). */
export function lookAt(el: Element): Look {
  const cs = getComputedStyle(el);
  const plain = isZero(edges(cs, 'padding')) && isZero(edges(cs, 'border', '-width')) && ['top-left', 'top-right', 'bottom-right', 'bottom-left'].every((c) => !px(radius(cs, c)));
  return classify({ tag: el.tagName, display: cs.display, visibility: cs.visibility, visible: el.checkVisibility({ opacityProperty: true }), rect: bounds(el), plain });
}

/**
 * Children the blueprint walks: every child, not only rendered ones, so `display:contents` ones are
 * reached. A shadow host gives its shadow root's children, then its light children (slotted
 * ones render, the rest have no box). An <svg> is a leaf.
 */
export const blueprintKids = (el: Element, ignore: Element, shadowOf: ShadowOf): Element[] =>
  el instanceof SVGElement ? [] : [...(shadowOf(el)?.children ?? []), ...el.children].filter((c) => c !== ignore);

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
  return radii([radius(cs, 'top-left'), radius(cs, 'top-right'), radius(cs, 'bottom-right'), radius(cs, 'bottom-left')], width(b) / z, height(b) / z);
};

/** Clamped corner radii of `el`, whose bounds are `b`, in viewport px like `b` (scaled by CSS `zoom`). */
export function readRadii(el: Element, b: Rect): Corners {
  const z = el.currentCSSZoom;
  const [tl, tr, br, bl] = cssRadii(el, b, z);
  const zoomed = ([x, y]: Corner): Corner => [x * z, y * z];
  return [zoomed(tl), zoomed(tr), zoomed(br), zoomed(bl)];
}

/** Next (`step` 1) or previous (-1) rendered sibling, wrapping around; null when there is none. */
export function siblingOf(el: Element, step: 1 | -1, ignore: Element, shadowOf: ShadowOf): Element | null {
  const parent = parentOf(el);
  const siblings = parent ? childrenOf(parent, ignore, shadowOf) : [];
  const i = siblings.indexOf(el);
  return i < 0 ? null : (siblings[(i + step + siblings.length) % siblings.length] ?? null);
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
  const border = edges(cs, 'border', '-width');
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
