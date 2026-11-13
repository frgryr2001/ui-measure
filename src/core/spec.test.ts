import { describe, expect, it } from 'vitest';
import { css, selectorOf, type Spec } from './spec';

// like the playground's #bp-card
const card: Spec = {
  selector: 'body > main > section:nth-of-type(3) > div',
  name: 'div.card',
  width: 320,
  height: 186.5,
  padding: { top: 20, right: 24, bottom: 20, left: 24 },
  border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, style: 'solid', color: 'rgb(203, 213, 225)' },
  radius: [[20, 20], [20, 20], [20, 20], [20, 20]],
};

describe('css', () => {
  it('is a rule for the selector with border-box size, shorthand padding, border and radius', () => {
    expect(css(card)).toBe(
      [
        '/* div.card */',
        'body > main > section:nth-of-type(3) > div {',
        '  width: 320px;',
        '  height: 186.5px;',
        '  box-sizing: border-box;',
        '  padding: 20px 24px;',
        '  border: 1px solid rgb(203, 213, 225);',
        '  border-radius: 20px;',
        '}',
      ].join('\n'),
    );
  });

  // the value lines of the rule, without the comment, selector and braces
  const body = (s: Spec) => css(s).split('\n').slice(2, -1);

  it('the name comment survives a class containing */', () => {
    expect(css({ ...card, name: 'div.a*/b' }).split('\n')[0]).toBe('/* div.a* /b */');
  });

  it('uneven borders become longhands; no border and no radius are 0', () => {
    expect(body({ ...card, border: { ...card.border, width: { top: 0, right: 0, bottom: 2, left: 0 } }, radius: [[0, 0], [0, 0], [0, 0], [0, 0]] }).slice(4)).toEqual([
      '  border-width: 0 0 2px;',
      '  border-style: solid;',
      '  border-color: rgb(203, 213, 225);',
      '  border-radius: 0;',
    ]);
    expect(body({ ...card, border: { ...card.border, width: { top: 0, right: 0, bottom: 0, left: 0 } } })).toContain('  border: 0;');
  });

  it('padding keeps 4 values when left and right differ, and 2 decimals at most', () => {
    expect(body({ ...card, padding: { top: 8, right: 16, bottom: 16, left: 12.3456 } })).toContain('  padding: 8px 16px 16px 12.35px;');
  });

  it('elliptical corners use the slash syntax: a 48 × 40 box at 50% is 24px / 20px', () => {
    expect(body({ ...card, radius: [[24, 20], [24, 20], [24, 20], [24, 20]] })).toContain('  border-radius: 24px / 20px;');
    expect(body({ ...card, radius: [[12, 12], [0, 0], [12, 12], [0, 0]] })).toContain('  border-radius: 12px 0;');
  });
});

describe('selectorOf', () => {
  const step = (tag: string, nth = 0, id = '') => ({ tag, nth, id });

  it('walks up to body, nth-of-type only where the tag repeats among siblings', () => {
    expect(selectorOf([step('div'), step('section', 3), step('main'), step('body'), step('html')])).toBe('body > main > section:nth-of-type(3) > div');
  });

  it('stops at the nearest unique id, the element\'s own included', () => {
    expect(selectorOf([step('span', 2), step('div', 0, 'bp-card'), step('main'), step('body'), step('html')])).toBe('#bp-card > span:nth-of-type(2)');
    expect(selectorOf([step('button', 1, 'bp-pill'), step('body'), step('html')])).toBe('#bp-pill');
  });

  it('a detached chain without body still joins what it has', () => {
    expect(selectorOf([step('li', 2), step('ul')])).toBe('ul > li:nth-of-type(2)');
  });
});
