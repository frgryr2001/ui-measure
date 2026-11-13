import { classify, radii, type Corners, type Look } from './blueprint';
import { gaps, type Gap } from './gap';
import { height, inset, width, type Edges, type Rect } from './rect';
import { selectorOf, type Spec, type Step } from './spec';

export type Boxes = { margin: Rect; border: Rect; padding: Rect; content: Rect };

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

/** Box model in viewport px. Bounds come from the rendered rect, edges from computed style. */
export function readBoxes(el: Element): Boxes {
  const border = bounds(el);
  const cs = getComputedStyle(el);
  // shortcut: computed padding/margin ignore ancestor transform: scale(), so bands drift on scaled
  // elements; multiply by rect.width / offsetWidth if that matters.
  const padding = inset(border, edges(cs, 'border', '-width'));
  return {
    border,
    padding,
    content: inset(padding, edges(cs, 'padding')),
    margin: inset(border, edges(cs, 'margin'), -1),
  };
}

/** Deepest element at a viewport point, walking into open shadow roots. */
export function deepElementAt(x: number, y: number, ignore: Element): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el === ignore ? null : el;
}

/** Parent element, stepping out of an open shadow root to its host. */
export const parentOf = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

// shortcut: follows the DOM, not the flat tree, so `<slot>`ed and `display:contents` children are
// unreachable by Enter and Tab and their gaps are not drawn; walk assignedElements() / grandchildren if web-component pages need it.
/** Children that render a box, read from the open shadow root when there is one (like hit testing). */
export const childrenOf = (el: Element, ignore: Element): Element[] =>
  [...(el.shadowRoot ?? el).children].filter((c) => c !== ignore && c.getClientRects().length > 0);

/** Gaps between the in-flow children of a flex or grid container; none for other elements. */
export function readGaps(el: Element, ignore: Element): Gap[] {
  const cs = getComputedStyle(el);
  const flex = cs.display.includes('flex');
  if (!flex && !cs.display.includes('grid')) return [];
  const items = childrenOf(el, ignore)
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
 * reached. A shadow host gives its open shadow root's children, then its light children (slotted
 * ones render, the rest have no box). An <svg> is a leaf.
 */
export const blueprintKids = (el: Element, ignore: Element): Element[] =>
  el instanceof SVGElement ? [] : [...(el.shadowRoot?.children ?? []), ...el.children].filter((c) => c !== ignore);

/** Clamped corner radii of `el`, whose bounds are `b`. */
export function readRadii(el: Element, b: Rect): Corners {
  const cs = getComputedStyle(el);
  return radii([radius(cs, 'top-left'), radius(cs, 'top-right'), radius(cs, 'bottom-right'), radius(cs, 'bottom-left')], width(b), height(b));
}

/** Next (`step` 1) or previous (-1) rendered sibling, wrapping around; null when there is none. */
export function siblingOf(el: Element, step: 1 | -1, ignore: Element): Element | null {
  const parent = parentOf(el);
  const siblings = parent ? childrenOf(parent, ignore) : [];
  const i = siblings.indexOf(el);
  return i < 0 ? null : (siblings[(i + step + siblings.length) % siblings.length] ?? null);
}

/** True when keyboard focus is in an editable field of the page (not our own UI). */
export function isTypingInPage(ignore: Element): boolean {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === ignore) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** What Copy writes out for `el`: its bounds, padding, border, radius and a selector to find it again. */
export function readSpec(el: Element): Spec {
  const b = bounds(el);
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
    width: width(b),
    height: height(b),
    padding: edges(cs, 'padding'),
    border: { width: border, style: cs.getPropertyValue(`border-${side}-style`), color: cs.getPropertyValue(`border-${side}-color`) },
    radius: readRadii(el, b),
  };
}
