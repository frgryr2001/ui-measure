import { describe, expect, it } from 'vitest';
import { DEFAULTS, styleRows, type Computed } from './styles';

// a bare <div> in Chrome 148, plus overrides
const of = (over: Partial<Computed>): Computed => ({ ...DEFAULTS, ...over });
const rows = (over: Partial<Computed> = {}) => styleRows(of(over)).map((group) => group.map(({ name, value }) => `${name}  ${value}`));

describe('styleRows', () => {
  it('a bare element shows only display, the font and color', () => {
    expect(rows()).toEqual([['display  block'], ['font-family  Times', 'font-size  16px', 'font-weight  400', 'color  #000000']]);
  });

  it('layout: flex rows only for flex, grid columns only for grid, other rows when changed', () => {
    const flexish = { 'flex-direction': 'column', 'justify-content': 'space-between', 'align-items': 'center', 'grid-template-columns': '100px 200px' };
    expect(rows({ display: 'inline-flex', ...flexish, position: 'absolute', 'z-index': '10', overflow: 'hidden auto', 'box-sizing': 'border-box' })[0]).toEqual([
      'display  inline-flex',
      'position  absolute',
      'z-index  10',
      'overflow  hidden auto',
      'box-sizing  border-box',
      'flex-direction  column',
      'justify-content  space-between',
      'align-items  center',
    ]);
    expect(rows({ display: 'grid', ...flexish })[0]).toEqual(['display  grid', 'grid-template-columns  100px 200px']);
    expect(rows({ ...flexish })[0]).toEqual(['display  block']);
  });

  it('text: line height after the size, letter spacing and alignment when changed', () => {
    expect(rows({ 'font-family': '"Times New Roman", serif', 'line-height': '24px', 'font-weight': '600', 'letter-spacing': '-0.5px', 'text-align': 'center' })[1]).toEqual([
      'font-family  Times New Roman',
      'font-size  16px / 24px',
      'font-weight  600',
      'letter-spacing  -0.5px',
      'color  #000000',
      'text-align  center',
    ]);
  });

  it('colors are uppercase hex, with the alpha as a percentage below 1, and carry their swatch', () => {
    const [, , fill] = styleRows(of({ 'background-color': 'rgba(26, 26, 26, 0.5)', opacity: '0.8' }));
    expect(fill).toEqual([
      { name: 'background-color', value: '#1A1A1A 50%', color: 'rgba(26, 26, 26, 0.5)' },
      { name: 'opacity', value: '0.8', color: null },
    ]);
    expect(rows({ color: 'rgb(255, 99, 7)' })[1]).toContain('color  #FF6307');
    // still below 1, so never 100%
    expect(rows({ color: 'rgba(0, 0, 0, 0.996)' })[1]).toContain('color  #000000 99%');
  });

  it('a color outside sRGB keeps its computed string; transparent is the default', () => {
    expect(rows({ color: 'oklch(0.7 0.1 200)' })[1]).toContain('color  oklch(0.7 0.1 200)');
    expect(rows({ 'background-color': 'color(display-p3 1 0 0)' })[2]).toEqual(['background-color  color(display-p3 1 0 0)']);
    expect(rows({ 'background-color': 'rgba(255, 0, 0, 0)' })).toHaveLength(2);
    expect(rows({ 'background-color': 'oklab(0 0 0 / 0)' })).toHaveLength(2);
  });

  it('border: the style and color of the first drawn side, none when no side is drawn', () => {
    const bottom = { 'border-bottom-width': '2px', 'border-bottom-style': 'dashed', 'border-bottom-color': 'rgb(165, 180, 252)' };
    expect(rows(bottom)[2]).toEqual(['border-style  dashed', 'border-color  #A5B4FC']);
    // a reset like Tailwind's `border: 0 solid` on every element
    expect(rows({ 'border-top-style': 'solid', 'border-left-style': 'solid' })).toHaveLength(2);
  });

  it('each shadow of a list is a row of x y blur spread color without px, inset first', () => {
    const [, , effects] = styleRows(of({ 'box-shadow': 'oklch(0.7 0.1 200) 0px 4px 12px 0px, rgba(0, 0, 0, 0.1) 0px 0px 0px 1.5px inset' }));
    expect(effects).toEqual([
      { name: 'box-shadow', value: '0 4 12 0 oklch(0.7 0.1 200)', color: 'oklch(0.7 0.1 200)' },
      { name: 'box-shadow', value: 'inset 0 0 0 1.5 #000000 10%', color: 'rgba(0, 0, 0, 0.1)' },
    ]);
  });

  it('a text shadow has no spread and sits with the text', () => {
    expect(rows({ 'text-shadow': 'rgb(255, 0, 0) 1px 1px 2px' })[1]).toContain('text-shadow  1 1 2 #FF0000');
  });

  it('margin is a CSS shorthand with px, last; none is the default', () => {
    expect(rows({ margin: '0px 0px 16px' }).at(-1)).toEqual(['margin  0 0 16px']);
    expect(rows({ margin: '-8px 193.333px' }).at(-1)).toEqual(['margin  -8px 193.33px']);
    expect(rows({ margin: '0px 0px 0px 0px' })).toHaveLength(2);
  });

  it('a row longer than the panel (42 characters) is cut with …; transform stays the computed matrix', () => {
    expect(rows({ transform: 'matrix(0.984808, 0.173648, -0.173648, 0.984808, 0, 0)' })[2]).toEqual(['transform  matrix(0.984808, 0.173648, -0.…']);
    expect(rows({ filter: 'a'.repeat(34) })[2]).toEqual([`filter  ${'a'.repeat(34)}`]);
    expect(rows({ filter: 'a'.repeat(35) })[2]).toEqual([`filter  ${'a'.repeat(33)}…`]);
  });

  it('a background image shows its value', () => {
    expect(rows({ 'background-image': 'url("a.png")' })[2]).toEqual(['background-image  url("a.png")']);
  });
});
