import { describe, expect, it } from 'vitest';
import { STACK_DEFAULTS, clipLabel, clippers, runsPast, contextLabel, selectionLabel, shortSelector, stackingReasons, zApplies, zNoEffect, type StackStyle } from './stacking';

// a bare <div> in Chrome 157, plus overrides
const of = (over: Partial<StackStyle> = {}): StackStyle => ({ ...STACK_DEFAULTS, tag: 'div', root: false, svg: false, topLayer: null, opacity: 1, animated: false, ...over });
const why = (over: Partial<StackStyle> = {}, applies = false) => stackingReasons(of(over), applies);

// docs/stacking-research.md → "Triggers table": the computed strings Chrome 157 reports, and whether its paint made a stacking context
describe('stackingReasons', () => {
  it('a bare box is no stacking context', () => {
    expect(why()).toEqual([]);
  });

  it('z-index makes one only where it applies: positioned, or a flex / grid item', () => {
    expect(why({ position: 'relative', 'z-index': '0' }, true)).toEqual(['z-index']);
    expect(why({ position: 'absolute', 'z-index': '-1' }, true)).toEqual(['z-index']);
    expect(why({ position: 'relative' }, true)).toEqual([]);
    expect(why({ 'z-index': '5' }, true)).toEqual(['z-index']);
    expect(why({ 'z-index': '5' }, false)).toEqual([]);
  });

  it('fixed and sticky always, even with z-index auto', () => {
    expect(why({ position: 'fixed' }, true)).toEqual(['fixed']);
    expect(why({ position: 'sticky', display: 'inline' }, true)).toEqual(['sticky']);
    expect(why({ position: 'fixed', 'z-index': '9999' }, true)).toEqual(['fixed', 'z-index']);
  });

  it('opacity below 1, from Typed OM: 0.9999999 counts though its string reads "1"', () => {
    expect(why({ opacity: 0.99 })).toEqual(['opacity']);
    expect(why({ opacity: 0.99999988 })).toEqual(['opacity']);
    expect(why({ opacity: 0.5, display: 'inline' })).toEqual(['opacity']);
    expect(why({ opacity: 1 })).toEqual([]);
  });

  it('transforms, identity ones included, on a transformable box', () => {
    expect(why({ transform: 'matrix(1, 0, 0, 1, 0, 0)' })).toEqual(['transform']);
    expect(why({ translate: '0px' })).toEqual(['translate']);
    expect(why({ rotate: 'x 30deg' })).toEqual(['rotate']);
    expect(why({ scale: '1' })).toEqual(['scale']);
    expect(why({ perspective: '100px' })).toEqual(['perspective']);
    expect(why({ 'offset-path': 'path("M 0 0 H 1")' })).toEqual(['offset-path']);
    expect(why({ 'transform-style': 'preserve-3d' })).toEqual(['transform-style']);
  });

  it('offset-position alone is a transform in Chrome; normal and auto are not', () => {
    expect(why({ 'offset-position': '2px 50%' })).toEqual(['offset-position']);
    expect(why({ 'offset-position': 'auto' })).toEqual([]);
  });

  it('a non-atomic inline box ignores transforms, but not a replaced one', () => {
    expect(why({ display: 'inline', transform: 'matrix(1, 0, 0, 1, 0, 0)' })).toEqual([]);
    expect(why({ display: 'inline', 'offset-position': '2px 50%', 'transform-style': 'preserve-3d' })).toEqual([]);
    expect(why({ display: 'inline', tag: 'img', transform: 'matrix(1, 0, 0, 1, 0, 0)' })).toEqual(['transform']);
  });

  it('filters, clip-path, masks, reflection, blend, isolation, view-transition-name, inline too', () => {
    expect(why({ filter: 'blur(0px)', display: 'inline' })).toEqual(['filter']);
    expect(why({ 'backdrop-filter': 'blur(1px)' })).toEqual(['backdrop-filter']);
    expect(why({ 'clip-path': 'inset(0px)' })).toEqual(['clip-path']);
    expect(why({ 'mask-image': 'none, linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))' })).toEqual(['mask-image']);
    expect(why({ 'mask-image': 'none, none' })).toEqual([]);
    expect(why({ '-webkit-mask-box-image-source': 'url("m.png")' })).toEqual(['-webkit-mask-box-image']);
    expect(why({ '-webkit-box-reflect': 'below 0px none' })).toEqual(['-webkit-box-reflect']);
    expect(why({ 'mix-blend-mode': 'multiply', display: 'inline' })).toEqual(['mix-blend-mode']);
    expect(why({ isolation: 'isolate', display: 'inline' })).toEqual(['isolation']);
    expect(why({ 'view-transition-name': 'match-element' })).toEqual(['view-transition-name']);
  });

  it('will-change naming a trigger, in any case; z-index only where z-index applies', () => {
    for (const w of ['transform', 'opacity', 'contain', 'position', 'filter', 'mask', 'clip-path', 'isolation', 'view-transition-name', 'offset-path', 'backdrop-filter', 'perspective', 'TRANSFORM', 'scroll-position, Opacity']) {
      expect(why({ 'will-change': w }), w).toEqual(['will-change']);
    }
    for (const w of ['top', 'scroll-position', 'contents']) expect(why({ 'will-change': w }), w).toEqual([]);
    expect(why({ 'will-change': 'z-index' }, false)).toEqual([]);
    expect(why({ 'will-change': 'z-index', position: 'relative' }, true)).toEqual(['will-change']);
    // inline: opacity counts, transform doesn't
    expect(why({ 'will-change': 'opacity', display: 'inline' })).toEqual(['will-change']);
    expect(why({ 'will-change': 'transform', display: 'inline' })).toEqual([]);
  });

  it('layout or paint containment and content-visibility, not on an inline box or a table row', () => {
    for (const c of ['layout', 'paint', 'content', 'strict', 'inline-size layout style paint']) expect(why({ contain: c }), c).toEqual(['contain']);
    for (const c of ['size', 'style', 'inline-size']) expect(why({ contain: c }), c).toEqual([]);
    expect(why({ contain: 'layout', display: 'inline' })).toEqual([]);
    expect(why({ contain: 'paint', display: 'table-row' })).toEqual([]);
    expect(why({ 'content-visibility': 'auto' })).toEqual(['content-visibility']);
    expect(why({ 'content-visibility': 'auto', display: 'inline' })).toEqual([]);
  });

  it('a running or paused opacity / transform / filter animation', () => {
    expect(why({ animated: true })).toEqual(['animation']);
  });

  it('every reason, in order, so a trap can be undone', () => {
    expect(why({ transform: 'matrix(1, 0, 0, 1, 0, 0)', 'will-change': 'transform', opacity: 0.5 })).toEqual(['opacity', 'transform', 'will-change']);
  });

  it('the top layer, alone: it leaves every other context', () => {
    expect(why({ topLayer: 'dialog', position: 'fixed', 'z-index': '5' }, true)).toEqual(['top layer']);
  });

  it('never: display contents or none, the root (always one, never drawn), inside an <svg>', () => {
    expect(why({ display: 'contents', opacity: 0.5, transform: 'matrix(1, 0, 0, 1, 0, 0)' })).toEqual([]);
    expect(why({ display: 'none', opacity: 0.5 })).toEqual([]);
    expect(why({ root: true, opacity: 0.5 })).toEqual([]);
    expect(why({ svg: true, transform: 'matrix(1, 0, 0, 1, 0, 0)' })).toEqual([]);
  });

  it('not triggers: container-type, overflow, backface-visibility (not read at all)', () => {
    expect(why({ overflow: 'hidden' })).toEqual([]);
  });
});

describe('zApplies', () => {
  it('a positioned box, or an item of a flex / grid layout parent', () => {
    expect(zApplies('relative', 'block')).toBe(true);
    expect(zApplies('static', 'block')).toBe(false);
    for (const d of ['flex', 'inline-flex', 'grid', 'inline-grid']) expect(zApplies('static', d), d).toBe(true);
    expect(zApplies('static', 'table-cell')).toBe(false);
    // dom.ts passes the first flat-tree ancestor with a box: through a `display: contents` parent, or a bare <slot>, to the
    // flex host; a <div> around the <slot> is the layout parent instead
    expect(zApplies('static', '')).toBe(false);
  });

  it('says why not: static, or inside an <svg>', () => {
    expect(zNoEffect(false, false)).toBe('static');
    expect(zNoEffect(true, false)).toBe('svg');
    expect(zNoEffect(true, true)).toBe('svg');
    expect(zNoEffect(false, true)).toBeNull();
  });
});

describe('selectionLabel', () => {
  it('none in the plain case: static, z-index auto, no context', () => {
    expect(selectionLabel(of(), false)).toBeNull();
    expect(selectionLabel(of({ svg: true }), false)).toBeNull();
  });

  it('its z-index, auto on a positioned box, and whether it does anything', () => {
    expect(selectionLabel(of({ position: 'relative', 'z-index': '9999' }), true)).toBe('z 9999');
    expect(selectionLabel(of({ position: 'relative' }), true)).toBe('z auto');
    expect(selectionLabel(of({ 'z-index': '5' }), false)).toBe('z 5 · no effect (static)');
    expect(selectionLabel(of({ svg: true, 'z-index': '5' }), false)).toBe('z 5 · no effect (svg)');
  });

  it('a stacking context lists its reasons after the z', () => {
    expect(selectionLabel(of({ transform: 'matrix(1, 0, 0, 1, 0, 0)' }), false)).toBe('z auto · transform');
    expect(selectionLabel(of({ position: 'fixed', 'z-index': '9999' }), true)).toBe('z 9999 · fixed');
    expect(selectionLabel(of({ 'z-index': '5', opacity: 0.5 }), false)).toBe('z 5 · no effect (static) · opacity');
  });

  it('a top-layer box says only that', () => {
    expect(selectionLabel(of({ topLayer: 'dialog', position: 'fixed' }), true)).toBe('top layer (dialog)');
    expect(selectionLabel(of({ topLayer: 'popover', 'z-index': '-5' }), true)).toBe('top layer (popover)');
  });
});

describe('contextLabel', () => {
  it('selector, every reason, then the z it competes with: 0 where z-index is auto or does nothing', () => {
    const card = of({ transform: 'matrix(1, 0, 0, 1, 0, 0)', 'will-change': 'transform' });
    expect(contextLabel('div.card', card, false)).toBe('div.card · transform, will-change · z 0');
    expect(contextLabel('header', of({ position: 'sticky', 'z-index': '10' }), true)).toBe('header · sticky · z 10');
  });

  it('a context by z-index alone shows only its z', () => {
    expect(contextLabel('div.layer', of({ position: 'relative', 'z-index': '1' }), true)).toBe('div.layer · z 1');
  });

  it('a top-layer context has no z that counts', () => {
    expect(contextLabel('dialog', of({ topLayer: 'dialog', position: 'fixed' }), true)).toBe('dialog · top layer');
  });

  it('a long one is cut with …', () => {
    const text = contextLabel('div.a-very-long-class-name-from-a-css-module_x1y2', of({ opacity: 0.5, filter: 'blur(1px)' }), false);
    expect(text).toHaveLength(48);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('clipLabel', () => {
  it('names the ancestor and what cuts', () => {
    expect(clipLabel('main', 'overflow hidden')).toBe('clipped by main · overflow hidden');
  });
});

describe('shortSelector', () => {
  it('tag#id, else tag.first-class, else tag', () => {
    expect(shortSelector('div', 'app', ['card', 'x'])).toBe('div#app');
    expect(shortSelector('div', '', ['card', 'x'])).toBe('div.card');
    expect(shortSelector('main', '', [])).toBe('main');
  });
});

describe('clippers', () => {
  // the selection first, then its flat-tree ancestors up to <html>
  const chain = (...over: Partial<StackStyle>[]) => [...over.map(of), of({ tag: 'html', root: true })];
  const cuts = (...over: Partial<StackStyle>[]) => clippers(chain(...over));

  it('overflow other than visible cuts at the padding box, clip-path at the border box, paint containment at the padding box', () => {
    expect(cuts({}, { overflow: 'hidden' })).toEqual([{ index: 1, why: 'overflow hidden', box: 'padding' }]);
    expect(cuts({}, { overflow: 'visible auto' })).toEqual([{ index: 1, why: 'overflow visible auto', box: 'padding' }]);
    expect(cuts({}, { 'clip-path': 'inset(0px)' })).toEqual([{ index: 1, why: 'clip-path', box: 'border' }]);
    expect(cuts({}, { contain: 'paint' })).toEqual([{ index: 1, why: 'contain paint', box: 'padding' }]);
    expect(cuts({}, { contain: 'strict' })).toEqual([{ index: 1, why: 'contain strict', box: 'padding' }]);
    expect(cuts({}, { 'content-visibility': 'auto' })).toEqual([{ index: 1, why: 'content-visibility auto', box: 'padding' }]);
    expect(cuts({}, { contain: 'layout' }, {})).toEqual([]);
  });

  it('nearest first, past boxes that cut nothing and `display: contents` ones', () => {
    expect(cuts({}, {}, { display: 'contents', overflow: 'hidden' }, { overflow: 'clip' }, { overflow: 'hidden' }).map((c) => c.index)).toEqual([3, 4]);
  });

  it('an absolute box escapes the overflow of boxes below its containing block, not their clip-path', () => {
    expect(cuts({ position: 'absolute' }, { overflow: 'hidden' }, { position: 'relative', overflow: 'hidden' }).map((c) => c.index)).toEqual([2]);
    expect(cuts({ position: 'absolute' }, { 'clip-path': 'inset(0px)' }).map((c) => c.index)).toEqual([1]);
    // past its containing block, an in-flow one: what clips that clips it
    expect(cuts({ position: 'absolute' }, { position: 'relative' }, { overflow: 'hidden' }).map((c) => c.index)).toEqual([2]);
  });

  it('a fixed box escapes every overflow, unless a transform, filter or containment holds it', () => {
    expect(cuts({ position: 'fixed' }, { position: 'relative', overflow: 'hidden' }, { overflow: 'hidden' })).toEqual([]);
    expect(cuts({ position: 'fixed' }, { overflow: 'hidden', transform: 'matrix(1, 0, 0, 1, 0, 0)' }).map((c) => c.index)).toEqual([1]);
    expect(cuts({ position: 'fixed' }, { overflow: 'hidden', filter: 'blur(1px)' }).map((c) => c.index)).toEqual([1]);
    expect(cuts({ position: 'fixed' }, { overflow: 'hidden', 'will-change': 'transform' }).map((c) => c.index)).toEqual([1]);
  });

  it('overflow on <html>, and on <body> while <html>\'s is visible, goes to the viewport and cuts nothing', () => {
    const body = { tag: 'body', overflow: 'hidden' };
    expect(clippers([of(), of(body), of({ tag: 'html', root: true, overflow: 'hidden' })]).map((c) => c.index)).toEqual([1]);
    expect(clippers([of(), of(body), of({ tag: 'html', root: true })])).toEqual([]);
  });

  it('the top layer leaves every ancestor box', () => {
    expect(cuts({ topLayer: 'popover' }, { overflow: 'hidden' })).toEqual([]);
    expect(cuts({}, { topLayer: 'dialog', overflow: 'auto' }, { overflow: 'hidden' }).map((c) => c.index)).toEqual([1]);
  });
});

describe('runsPast', () => {
  const box = { left: 0, top: 0, right: 100, bottom: 50 };
  it('a side more than half a px outside the box', () => {
    expect(runsPast({ left: 10, top: 10, right: 120, bottom: 40 }, box)).toBe(true);
    expect(runsPast({ left: 0, top: -0.4, right: 100.4, bottom: 50 }, box)).toBe(false);
    expect(runsPast({ left: 10, top: 10, right: 90, bottom: 51 }, box)).toBe(true);
  });
});
