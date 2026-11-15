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
