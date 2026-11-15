import type { Rect } from './rect';

/**
 * Computed values of a bare <div> (Chrome 157) that Stacking reads, by the name `getPropertyValue` takes.
 * Rules from docs/stacking-research.md ("Triggers table"), ported from its probed detector.
 */
export const STACK_DEFAULTS = {
  display: 'block',
  position: 'static',
  'z-index': 'auto',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  perspective: 'none',
  'offset-path': 'none',
  'offset-position': 'normal',
  filter: 'none',
  'backdrop-filter': 'none',
  'clip-path': 'none',
  'mask-image': 'none',
  '-webkit-mask-box-image-source': 'none',
  '-webkit-box-reflect': 'none',
  'view-transition-name': 'none',
  'transform-style': 'flat',
  'mix-blend-mode': 'normal',
  isolation: 'auto',
  'will-change': 'auto',
  contain: 'none',
  'content-visibility': 'visible',
  overflow: 'visible',
};

type StackComputed = Record<keyof typeof STACK_DEFAULTS, string>;

const isProperty = (p: string): p is keyof StackComputed => Object.hasOwn(STACK_DEFAULTS, p);

/** The properties Stacking reads, for `getPropertyValue`. */
export const STACK_PROPERTIES = Object.keys(STACK_DEFAULTS).filter(isProperty);

/** What put an element in the top layer. */
export type TopLayer = 'dialog' | 'popover' | 'fullscreen';

/** One element as Stacking sees it: its computed values, and what their strings can't tell. dom.ts reads it. */
export type StackStyle = StackComputed & {
  /** `localName`. */
  tag: string;
  /** The document element: always a stacking context, the one every page has. */
  root: boolean;
  /** Inside an <svg> (not the outermost one): it paints in document order there, z-index does nothing. */
  svg: boolean;
  /** `overlay: auto` (UA-only, so authors can't fake it). */
  topLayer: TopLayer | null;
  /** From Typed OM: the string reads "1" for 0.9999999, which still makes a stacking context. */
  opacity: number;
  /** A running or paused animation of one of `ANIMATED`, which makes a stacking context even when it animates none → none. */
  animated: boolean;
};

/** Keyframe properties (as `getKeyframes()` names them) whose current animation makes a stacking context. */
export const ANIMATED = ['opacity', 'transform', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter'];

const Z_PARENT = new Set(['flex', 'inline-flex', 'grid', 'inline-grid', '-webkit-box', '-webkit-inline-box', 'grid-lanes', 'inline-grid-lanes']);

// shortcut: -webkit-box items honor z-index in Chrome 157, not in 148 (Chrome for Testing); follows 157, e2e fixtures avoid -webkit-box; branch on the Chrome version if users on older Chrome report it.
/** z-index applies to a positioned box, or to a flex / grid item: `parentDisplay` is its layout parent's (the flat-tree parent, past `display: contents`; '' for none). */
export const zApplies = (position: string, parentDisplay: string) => position !== 'static' || Z_PARENT.has(parentDisplay);

/** Why a declared z-index does nothing on a box: inside an <svg>, or neither positioned nor a flex / grid item; null where it applies. */
export type ZNoEffect = 'svg' | 'static' | null;

export const zNoEffect = (svg: boolean, applies: boolean): ZNoEffect => (svg ? 'svg' : applies ? null : 'static');

// Chromium's will-change list (computed_style.cc), with the shorthands that expand to it
const WILL_CHANGE = new Set(['opacity', 'transform', 'transform-style', 'perspective', 'translate', 'rotate', 'scale', 'offset-path', 'offset-position', 'offset', 'mask', 'mask-image', '-webkit-mask', '-webkit-mask-image', '-webkit-mask-box-image', '-webkit-mask-box-image-source', 'clip-path', '-webkit-clip-path', '-webkit-box-reflect', 'filter', '-webkit-filter', 'backdrop-filter', '-webkit-backdrop-filter', 'position', 'mix-blend-mode', 'isolation', 'contain', 'view-transition-name']);
const TRANSFORM_LIKE = /transform|translate|rotate|scale|perspective|offset/;
const TRANSFORMS = ['transform', 'translate', 'rotate', 'scale', 'perspective', 'offset-path'] as const;
const PAINTED = ['filter', 'backdrop-filter', 'clip-path'] as const;
// replaced and atomic by nature, so transformable while `display: inline`
const REPLACED = new Set(['img', 'video', 'canvas', 'iframe', 'embed', 'object', 'input', 'select', 'textarea', 'button', 'svg']);
const TABLE_INTERNAL = /^table-(row|row-group|header-group|footer-group|column|column-group)$/;
const CONTAINS = /layout|paint|content|strict/;

// a non-atomic inline box ignores transforms, perspective, offset, containment and content-visibility
const transformable = (s: StackStyle) => s.display !== 'inline' || REPLACED.has(s.tag);
const containable = (s: StackStyle) => s.display !== 'inline' && !TABLE_INTERNAL.test(s.display);

/**
 * Every reason `s` is a stacking context in Chrome 157, by property name ('fixed' / 'sticky' for position, 'z-index' for a
 * z-index that applies, 'animation', 'top layer'); empty for none. `applies`: `zApplies` for it. The root and boxes
 * inside an <svg> get none: the root is the page's own context, and z-index does nothing inside an <svg>.
 */
export function stackingReasons(s: StackStyle, applies: boolean): string[] {
  if (s.root || s.svg || s.display === 'contents' || s.display === 'none') return [];
  if (s.topLayer) return ['top layer'];
  const t = transformable(s);
  const reasons: string[] = [];
  if (s.position === 'fixed' || s.position === 'sticky') reasons.push(s.position);
  if (s['z-index'] !== 'auto' && applies) reasons.push('z-index');
  if (s.opacity < 1) reasons.push('opacity');
  for (const p of [...(t ? TRANSFORMS : []), ...PAINTED]) if (s[p] !== 'none') reasons.push(p);
  // Chrome: any offset-position but normal / auto is a transform (ComputedStyle::HasOffset), even with offset-path: none
  if (t && s['offset-position'] !== 'normal' && s['offset-position'] !== 'auto') reasons.push('offset-position');
  if (s['mask-image'].split(',').some((v) => v.trim() !== 'none')) reasons.push('mask-image');
  if (s['-webkit-mask-box-image-source'] !== 'none') reasons.push('-webkit-mask-box-image');
  if (s['-webkit-box-reflect'] !== 'none') reasons.push('-webkit-box-reflect');
  if (s['view-transition-name'] !== 'none') reasons.push('view-transition-name');
  if (t && s['transform-style'] === 'preserve-3d') reasons.push('transform-style');
  if (s['mix-blend-mode'] !== 'normal') reasons.push('mix-blend-mode');
  if (s.isolation === 'isolate') reasons.push('isolation');
  // the computed value keeps its case ("TRANSFORM")
  const will = s['will-change'].toLowerCase().split(',').map((w) => w.trim());
  if (will.some((w) => (WILL_CHANGE.has(w) && (t || !TRANSFORM_LIKE.test(w))) || (w === 'z-index' && applies))) reasons.push('will-change');
  if (containable(s) && CONTAINS.test(s.contain)) reasons.push('contain');
  if (containable(s) && s['content-visibility'] !== 'visible') reasons.push('content-visibility');
  if (s.animated) reasons.push('animation');
  return reasons;
}

/** Stacking labels are cut to this many characters with `…` (a selector can be a CSS module's hash). */
export const LABEL_CHARS = 48;
const cut = (text: string) => (text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text);

/** How a label names an element; its outline shows which one it is. */
export const shortSelector = (tag: string, id: string, classes: ArrayLike<string>) => (id ? `${tag}#${id}` : classes[0] ? `${tag}.${classes[0]}` : tag);

// the z-index already shows the z-index reason
const shown = (reasons: string[]) => reasons.filter((r) => r !== 'z-index');

/**
 * The selection's own label: its z-index (`z auto` when positioned), whether it does anything, then its reasons when it is
 * a stacking context itself; `top layer (dialog)` alone in the top layer. Null in the plain case (static, z-index auto, no context).
 */
export function selectionLabel(s: StackStyle, applies: boolean): string | null {
  if (s.topLayer) return `top layer (${s.topLayer})`;
  const z = s['z-index'];
  const reasons = shown(stackingReasons(s, applies));
  if (z === 'auto' && s.position === 'static' && reasons.length === 0) return null;
  const none = z === 'auto' ? null : zNoEffect(s.svg, applies);
  return cut([`z ${z}`, ...(none ? [`no effect (${none})`] : []), ...(reasons.length > 0 ? [reasons.join(', ')] : [])].join(' · '));
}

/** The label of the stacking context the selection competes in: `selector · reasons · z N`, N the z-index it competes with (0 for auto or none). */
export function contextLabel(selector: string, s: StackStyle, applies: boolean): string {
  if (s.topLayer) return cut(`${selector} · top layer`);
  const reasons = shown(stackingReasons(s, applies));
  const z = applies && s['z-index'] !== 'auto' ? s['z-index'] : '0';
  return cut([selector, ...(reasons.length > 0 ? [reasons.join(', ')] : []), `z ${z}`].join(' · '));
}

/** The label of the ancestor that cuts the selection's painting (see `clippers`). */
export const clipLabel = (selector: string, why: string) => cut(`clipped by ${selector} · ${why}`);

/** An ancestor that cuts the selection's painting: its index in the chain, why, and the box it cuts at. */
export type Clip = { index: number; why: string; box: 'padding' | 'border' };

const PAINT_CONTAINED = /paint|content|strict/;

// shortcut: will-change and transforms only, not every containing-block trigger (backdrop-filter is in; offset-path rides `transform`); add them if a fixed box is reported unclipped by one.
/** `s` is the containing block of a `position: fixed` descendant (and of an absolute one): a transform, filter or containment. */
const holdsFixed = (s: StackStyle) =>
  (transformable(s) && (TRANSFORMS.some((p) => s[p] !== 'none') || s['transform-style'] === 'preserve-3d')) ||
  s.filter !== 'none' ||
  s['backdrop-filter'] !== 'none' ||
  (containable(s) && (CONTAINS.test(s.contain) || s['content-visibility'] !== 'visible')) ||
  /transform|translate|rotate|scale|perspective|filter|contain/.test(s['will-change'].toLowerCase());

/**
 * The ancestors in `chain` (the selection, then its flat-tree ancestors up to the root) that cut its painting, nearest
 * first: `overflow` other than visible and paint containment at the padding box, `clip-path` at the border box. An
 * absolute or fixed box escapes the overflow of every box below its containing block; overflow on <html> (and on
 * <body> while <html>'s is visible) goes to the viewport; a top-layer box leaves every ancestor.
 */
export function clippers(chain: StackStyle[]): Clip[] {
  const [self] = chain;
  if (!self || self.topLayer) return [];
  const out: Clip[] = [];
  // the containing block the box being clipped still looks for
  const needs = (position: string) => (position === 'absolute' || position === 'fixed' ? position : 'any');
  let need = needs(self.position);
  for (let i = 1; i < chain.length; i++) {
    const s = chain[i];
    if (!s || s.display === 'contents') continue;
    const holds = need === 'any' || (need === 'absolute' && s.position !== 'static') || holdsFixed(s);
    const viewport = s.root || (s.tag === 'body' && chain[i + 1]?.root === true && chain[i + 1]?.overflow === 'visible');
    const why =
      holds && !viewport && s.overflow !== 'visible' ? { why: `overflow ${s.overflow}`, box: 'padding' as const }
      : containable(s) && PAINT_CONTAINED.test(s.contain) ? { why: `contain ${s.contain}`, box: 'padding' as const }
      : containable(s) && s['content-visibility'] !== 'visible' ? { why: `content-visibility ${s['content-visibility']}`, box: 'padding' as const }
      : s['clip-path'] !== 'none' ? { why: 'clip-path', box: 'border' as const }
      : null;
    if (why) out.push({ index: i, ...why });
    if (s.topLayer) break;
    if (holds) need = needs(s.position);
  }
  return out;
}

/** True when `inner` runs more than half a px past a side of `outer`: what the ancestor clips is then cut off. */
export const runsPast = (inner: Rect, outer: Rect) =>
  inner.left < outer.left - 0.5 || inner.top < outer.top - 0.5 || inner.right > outer.right + 0.5 || inner.bottom > outer.bottom + 0.5;

/**
 * One box in the flat tree. Chains share a node where they meet, so identity is "the same element".
 * `index` is its place among the flat-tree parent's children (the DOM reader may ignore it and pass `flatBefore`).
 */
export type StackNode = {
  style: StackStyle;
  /** Computed `order`. 0 when the used value is 0. */
  order: number;
  /** Computed `float`. */
  float: string;
  index: number;
  parent: StackNode | null;
};

export type PairReason = 'z' | 'tree' | 'layer' | 'top-layer' | 'top-layer-tie' | 'descendant' | 'negative';

/** Which of the two boxes paints on top, and the participants that decide it inside `context`. `top` is null when both are in the top layer. */
export type PaintPair = {
  top: 'a' | 'b' | null;
  a: StackNode;
  b: StackNode;
  context: StackNode;
  reason: PairReason;
};

type FlatBefore = (a: StackNode, b: StackNode) => boolean;

const layoutParent = (n: StackNode): StackNode | null => {
  let p = n.parent;
  while (p && p.style.display === 'contents') p = p.parent;
  return p;
};

const applies = (n: StackNode) => zApplies(n.style.position, layoutParent(n)?.style.display ?? '');

/** A stacking context. The root is one even though `stackingReasons` leaves it out (it is never drawn). */
const isContext = (n: StackNode) => n.style.root || stackingReasons(n.style, applies(n)).length > 0;

const stacked = (n: StackNode) => n.style.position !== 'static' || isContext(n);

const inFlexOrGrid = (n: StackNode) => {
  const parent = layoutParent(n);
  return !!parent && Z_PARENT.has(parent.style.display);
};

// floats, inline-blocks and flex / grid items paint their plain descendants with them
const atomic = (n: StackNode) => n.float !== 'none' || /^inline-(block|flex|grid|table)/.test(n.style.display) || inFlexOrGrid(n);

const zOf = (n: StackNode): number => {
  if (!applies(n) || n.style['z-index'] === 'auto') return 0;
  const z = Number.parseInt(n.style['z-index'], 10);
  return Number.isNaN(z) ? 0 : z;
};

const chainOf = (n: StackNode): StackNode[] => {
  const up: StackNode[] = [];
  for (let p: StackNode | null = n; p; p = p.parent) up.push(p);
  return up;
};

// an SVG child paints inside its outermost <svg>; z-index does nothing on the inner boxes
const asBox = (n: StackNode): StackNode => {
  if (!n.style.svg) return n;
  let outer = n;
  for (let p: StackNode | null = n; p; p = p.parent) if (p.style.tag === 'svg' && !p.style.svg) outer = p;
  return outer;
};

/**
 * What represents `e` in `ctx`'s paint list: the outermost stacking context below `ctx`, else the nearest positioned box,
 * else the outermost atomic box, else `e`. A top-layer box leaves every ancestor and paints in the root (T6).
 */
const participant = (e: StackNode, ctx: StackNode): StackNode => {
  const up = chainOf(e);
  const at = up.indexOf(ctx);
  const below = at < 0 ? up : up.slice(0, at);
  if (ctx.style.root) {
    const top = below.find((x) => x.style.topLayer);
    if (top) return top;
  }
  const outer = below.filter((x) => isContext(x) && !x.style.root).at(-1);
  if (outer) return outer;
  return below.find((x) => stacked(x)) ?? below.filter((x) => atomic(x)).at(-1) ?? e;
};

// Appendix E, simplified to the ranks the probe compares (higher paints later)
const rank = (p: StackNode, ctx: StackNode): number => {
  if (p.style.topLayer && ctx.style.root) return 9;
  if (stacked(p)) {
    const z = zOf(p);
    if (z < 0) return 1;
    if (z > 0) return 7;
    return 6;
  }
  if (inFlexOrGrid(p)) return 4;
  if (p.float !== 'none') return 3;
  if (p.style.display.startsWith('inline')) return 4;
  return 2;
};

// Chrome's OrderLessThan: `order` counts only when this child is the flex / grid item or that item's child
const near = (child: StackNode, node: StackNode) => child === node || child === layoutParent(node);

/** True when `a` paints before `b` in the flat tree (`flatBefore`), with flex / grid `order` where Chrome uses it. */
const earlier = (a: StackNode, b: StackNode, flatBefore: FlatBefore): boolean => {
  const ua = chainOf(a).reverse();
  const ub = chainOf(b).reverse();
  let i = 0;
  while (ua[i] && ua[i] === ub[i]) i++;
  const ca = ua[i];
  const cb = ub[i];
  if (!ca) return true;
  if (!cb) return false;
  const parent = ua[i - 1];
  const flex = !!parent && Z_PARENT.has(parent.style.display) && near(ca, a) && near(cb, b);
  const orderOf = (x: StackNode) => (flex && x.style.position !== 'absolute' && x.style.position !== 'fixed' ? x.order : 0);
  const oa = orderOf(ca);
  const ob = orderOf(cb);
  return oa !== ob ? oa < ob : flatBefore(ca, cb);
};

const compareIn = (a: StackNode, b: StackNode, ctx: StackNode, flatBefore: FlatBefore): PaintPair => {
  const pa = participant(a, ctx);
  const pb = participant(b, ctx);
  if (pa === pb) return compareIn(a, b, pa, flatBefore);
  const ra = rank(pa, ctx);
  const rb = rank(pb, ctx);
  let top: PaintPair['top'];
  let reason: PairReason;
  if (ra !== rb) {
    top = ra > rb ? 'a' : 'b';
    reason = ra === 9 || rb === 9 ? 'top-layer' : 'layer';
  } else if (ra === 9) {
    top = null;
    reason = 'top-layer-tie';
  } else if (zOf(pa) !== zOf(pb)) {
    top = zOf(pa) > zOf(pb) ? 'a' : 'b';
    reason = 'z';
  } else {
    // shortcut: compares boxes, so an earlier block's text over a later block's background (research X1) reads as the later block on top; split backgrounds from inline content if that case matters.
    top = earlier(pb, pa, flatBefore) ? 'a' : 'b';
    reason = 'tree';
  }
  return { top, a: pa, b: pb, context: ctx, reason };
};

const ancestorPair = (a: StackNode, b: StackNode): PaintPair => {
  const anc = chainOf(b).includes(a) ? a : b;
  const desc = anc === a ? b : a;
  // a descendant paints over its ancestor's background, unless the ancestor is not a context and the descendant sits in a negative-z context below it
  const ancIsContext = isContext(anc);
  const ctx = ancIsContext ? anc : (chainOf(anc).slice(1).find((x) => isContext(x)) ?? chainOf(anc).at(-1)!);
  const pd = ancIsContext ? desc : participant(desc, ctx);
  const under = !ancIsContext && pd !== anc && stacked(pd) && zOf(pd) < 0;
  const side = (node: StackNode) => (node === anc ? anc : under ? pd : desc);
  return {
    top: (under ? anc : desc) === a ? 'a' : 'b',
    a: side(a),
    b: side(b),
    context: ctx,
    reason: under ? 'negative' : 'descendant',
  };
};

const byIndex: FlatBefore = (a, b) => a.index < b.index;

/**
 * Which of `a` or `b` paints on top, and the two participants that compete in their nearest common stacking context.
 * Null when both are the same box (two SVG children collapse to one `<svg>`). `flatBefore` is flat-tree order at a tie;
 * the default is `index`. Ported from the probed algorithm in docs/stacking-research.md.
 */
export function paintPair(a0: StackNode, b0: StackNode, flatBefore: FlatBefore = byIndex): PaintPair | null {
  const a = asBox(a0);
  const b = asBox(b0);
  if (a === b) return null;
  if (chainOf(a).includes(b) || chainOf(b).includes(a)) return ancestorPair(a, b);
  const ub = new Set(chainOf(b));
  const ctx = chainOf(a).find((x) => x !== a && ub.has(x) && isContext(x)) ?? chainOf(a).at(-1)!;
  return compareIn(a, b, ctx, flatBefore);
}

/** Draw the pair when the bounds overlap, except a descendant that simply paints over its ancestor. */
export const pairWorthShowing = (pair: PaintPair, overlap: boolean) => overlap && pair.reason !== 'descendant';

const kind = (n: StackNode): string => {
  if (n.style.topLayer) return 'top layer';
  if (stacked(n)) {
    if (applies(n) && n.style['z-index'] !== 'auto') return `z ${zOf(n)}`;
    if (n.style.position !== 'static') return 'positioned';
    return 'stacking context';
  }
  if (inFlexOrGrid(n)) return 'flex item';
  if (n.float !== 'none') return 'float';
  if (n.style.display.startsWith('inline')) return 'inline';
  return 'block';
};

/** The verdict on the winner. `through` is a positioned pseudo that took the hit outside the winner's border box. */
export function pairVerdict(pair: PaintPair, contextName: string, through?: '::before' | '::after'): string {
  if (through) return cut(`on top · through ${through}`);
  if (pair.top === null) return 'both in top layer, last shown wins';
  if (pair.reason === 'top-layer') return 'on top · top layer';
  if (pair.reason === 'negative') {
    const under = pair.top === 'a' ? pair.b : pair.a;
    return cut(`on top · z ${zOf(under)} under a plain parent`);
  }
  const win = pair.top === 'a' ? pair.a : pair.b;
  const lose = pair.top === 'a' ? pair.b : pair.a;
  if (stacked(win) && stacked(lose)) {
    const zw = zOf(win);
    const zl = zOf(lose);
    return zw === zl ? cut(`on top · tie z ${zw}, later in tree`) : cut(`on top · z ${zw} > ${zl} in ${contextName}`);
  }
  if (rank(win, pair.context) === rank(lose, pair.context)) return cut('on top · later in tree');
  return cut(`on top · ${kind(win)} over ${kind(lose)} in ${contextName}`);
}

/** The participant's label, the same shape as the context's: `selector · reasons · z`. */
export const participantLabel = (selector: string, n: StackNode) => contextLabel(selector, n.style, applies(n));

const pseudoPaints = (p: { content: string; position: string }) => p.content !== 'none' && p.content !== 'normal' && p.position !== 'static';

/** Which positioned pseudo can take a hit outside the element's border box. `::after` wins when both can. */
export function positionedPseudo(after: { content: string; position: string }, before: { content: string; position: string }): '::before' | '::after' | null {
  if (pseudoPaints(after)) return '::after';
  if (pseudoPaints(before)) return '::before';
  return null;
}
