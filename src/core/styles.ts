import { APART, CHAR_W } from './labels';
import { formatPx, type Rect } from './rect';
import { shorthand } from './spec';

/**
 * Computed values of a bare <div> (Chrome 148), by the name `getPropertyValue` takes: the properties
 * Styles reads, and the defaults a row must differ from to show. Margin is checked against 0, not
 * the UA's, so a <p>'s margin shows.
 */
export const DEFAULTS = {
  display: 'block',
  position: 'static',
  'z-index': 'auto',
  overflow: 'visible',
  'box-sizing': 'content-box',
  'flex-direction': 'row',
  'justify-content': 'normal',
  'align-items': 'normal',
  'grid-template-columns': 'none',
  'font-family': 'Times',
  'font-size': '16px',
  'line-height': 'normal',
  'font-weight': '400',
  'letter-spacing': 'normal',
  color: 'rgb(0, 0, 0)',
  'text-align': 'start',
  'text-shadow': 'none',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  opacity: '1',
  'border-top-width': '0px',
  'border-top-style': 'none',
  'border-top-color': 'rgb(0, 0, 0)',
  'border-right-width': '0px',
  'border-right-style': 'none',
  'border-right-color': 'rgb(0, 0, 0)',
  'border-bottom-width': '0px',
  'border-bottom-style': 'none',
  'border-bottom-color': 'rgb(0, 0, 0)',
  'border-left-width': '0px',
  'border-left-style': 'none',
  'border-left-color': 'rgb(0, 0, 0)',
  'box-shadow': 'none',
  filter: 'none',
  'backdrop-filter': 'none',
  transform: 'none',
  margin: '0px',
};

/** Computed style of one element, the properties of `DEFAULTS` only. dom.ts reads it. */
export type Computed = Record<keyof typeof DEFAULTS, string>;

const isProperty = (p: string): p is keyof Computed => Object.hasOwn(DEFAULTS, p);

/** The properties Styles reads, for `getPropertyValue`. */
export const STYLE_PROPERTIES = Object.keys(DEFAULTS).filter(isProperty);

/** One line of the Styles panel; `color` is the CSS color of its swatch, null for none. */
export type StyleRow = { name: string; value: string; color: string | null };

/** Characters of one `name  value` row: the panel's ~280px of 11px monospace (0.6em, 6.6px a character). */
export const ROW_CHARS = 42;

const row = (name: string, value: string, color: string | null = null): StyleRow => {
  const room = ROW_CHARS - name.length - 2;
  return { name, value: value.length > room ? `${value.slice(0, room - 1)}…` : value, color };
};

// the first family, unquoted: `"Times New Roman", serif` is Times New Roman
const family = (v: string) => v.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? v;

/** Figma-style: `#1A1A1A`, plus the opacity when alpha < 1 (`#1A1A1A 50%`). Outside sRGB (oklch, display-p3) the computed string stays, as hex would be wrong. */
export function formatColor(v: string): string {
  const m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!m?.[1]) return v;
  const [r = 0, g = 0, b = 0, a = 1] = m[1].split(',').map(Number);
  const hex = [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
  return a < 1 ? `#${hex} ${Math.min(99, Math.round(a * 100))}%` : `#${hex}`;
}

const colorRow = (name: string, v: string) => row(name, formatColor(v), v);

// split at `sep` outside parentheses, so `rgba(0, 0, 0, 0.1) 0px 4px, …` keeps its colors whole
function splitTop(v: string, sep: ',' | ' '): string[] {
  const parts = [''];
  let depth = 0;
  for (const ch of v) {
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    if (ch === sep && depth === 0) parts.push('');
    else parts[parts.length - 1] += ch;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** One row per shadow of a computed `box-shadow` / `text-shadow` list: `x y blur spread color` without px, `inset` first. */
function shadowRows(name: string, v: string): StyleRow[] {
  if (v === 'none') return [];
  return splitTop(v, ',').map((shadow) => {
    const tokens = splitTop(shadow, ' ');
    const lengths = tokens.filter((t) => /^-?[\d.]+px$/.test(t)).map((t) => formatPx(parseFloat(t)));
    const color = tokens.find((t) => t !== 'inset' && !/^-?[\d.]+px$/.test(t)) ?? null;
    const inset = tokens.includes('inset') ? ['inset'] : [];
    return row(name, [...inset, ...lengths, ...(color ? [formatColor(color)] : [])].join(' '), color);
  });
}

// computed margin is 1 to 4 px lengths, top right bottom left (like dom.ts reads it)
function marginRows(v: string): StyleRow[] {
  const [top = 0, right = top, bottom = top, left = right] = v.split(' ').map(parseFloat);
  const value = shorthand({ top, right, bottom, left });
  return value === '0' ? [] : [row('margin', value)];
}

// any fully transparent color, not only `transparent`'s rgba(0, 0, 0, 0): `oklab(0 0 0 / 0)` too
const isTransparent = (v: string) => /(,|\/)\s*0\)$/.test(v);

/** The Styles panel's rows for one element, in groups (layout, text, fill, border, effects, margin); a row shows only when it differs from `DEFAULTS`, except display, the font and color. Empty groups are left out. */
export function styleRows(c: Computed): StyleRow[][] {
  // the property's own row, when it is not the default
  const changed = (name: keyof Computed) => (c[name] === DEFAULTS[name] ? [] : [row(name, c[name])]);
  const layout = [
    row('display', c.display),
    ...changed('position'),
    ...changed('z-index'),
    ...changed('overflow'),
    ...changed('box-sizing'),
    ...(c.display.endsWith('flex') ? [...changed('flex-direction'), ...changed('justify-content'), ...changed('align-items')] : []),
    ...(c.display.endsWith('grid') ? changed('grid-template-columns') : []),
  ];
  const text = [
    row('font-family', family(c['font-family'])),
    row('font-size', c['font-size']),
    ...changed('line-height'),
    row('font-weight', c['font-weight']),
    ...changed('letter-spacing'),
    colorRow('color', c.color),
    ...changed('text-align'),
    ...shadowRows('text-shadow', c['text-shadow']),
  ];
  const fill = [
    ...(isTransparent(c['background-color']) ? [] : [colorRow('background-color', c['background-color'])]),
    ...changed('background-image'),
    ...changed('opacity'),
  ];
  // computed width is 0 when the style is none, so a drawn side is one with a width.
  // shortcut: one style and color for the whole border (the first drawn side, like Copy); show each side once mixed borders matter.
  const side = (['top', 'right', 'bottom', 'left'] as const).find((s) => parseFloat(c[`border-${s}-width`]) > 0);
  const width = shorthand({
    top: parseFloat(c['border-top-width']),
    right: parseFloat(c['border-right-width']),
    bottom: parseFloat(c['border-bottom-width']),
    left: parseFloat(c['border-left-width']),
  });
  const border = side ? [row('border-width', width), row('border-style', c[`border-${side}-style`]), colorRow('border-color', c[`border-${side}-color`])] : [];
  const effects = [...shadowRows('box-shadow', c['box-shadow']), ...changed('filter'), ...changed('backdrop-filter'), ...changed('transform')];
  return [layout, text, fill, border, effects, marginRows(c.margin)].filter((group) => group.length > 0);
}

// panel layout, in the same 11px monospace estimate as labels (Overlay draws it with these numbers)
export const STYLES_PAD_X = 10;
export const STYLES_PAD_Y = 8;
export const STYLES_ROW_H = 16;
export const STYLES_GROUP_GAP = 8;
export const STYLES_SWATCH = 9;
export const STYLES_SWATCH_GAP = 5;
/** Space between the selection bounds and the panel. */
export const STYLES_OFFSET = 8;

/** The panel's size for `styleRows` groups: the longest `name  value` row (a swatch before a color), rows and the gaps between groups. */
export function stylesSize(groups: StyleRow[][]): { w: number; h: number } {
  const rows = groups.flat();
  const widest = Math.max(0, ...rows.map((r) => (r.name.length + 2 + r.value.length) * CHAR_W + (r.color ? STYLES_SWATCH + STYLES_SWATCH_GAP : 0)));
  return { w: 2 * STYLES_PAD_X + widest, h: 2 * STYLES_PAD_Y + rows.length * STYLES_ROW_H + STYLES_GROUP_GAP * Math.max(0, groups.length - 1) };
}

/**
 * The panel's box, anchored to the selection bounds `sel`: below, above, right, then left, the first side where it
 * fits the viewport (APART in) without covering `sel`, kept inside along the other axis. Else the bottom-right corner
 * (a selection filling the viewport), and the top-left corner wins in a viewport smaller than the panel.
 */
export function placeStyles(sel: Rect, w: number, h: number, viewport: Rect): Rect {
  const lo = { x: viewport.left + APART, y: viewport.top + APART };
  const hi = { x: viewport.right - APART - w, y: viewport.bottom - APART - h };
  const box = (left: number, top: number): Rect => ({ left, top, right: left + w, bottom: top + h });
  const x = Math.max(Math.min(sel.left, hi.x), lo.x);
  const y = Math.max(Math.min(sel.top, hi.y), lo.y);
  const sides: [number, number][] = [
    [x, sel.bottom + STYLES_OFFSET],
    [x, sel.top - STYLES_OFFSET - h],
    [sel.right + STYLES_OFFSET, y],
    [sel.left - STYLES_OFFSET - w, y],
  ];
  const [left, top] = sides.find(([l, t]) => l >= lo.x && l <= hi.x && t >= lo.y && t <= hi.y) ?? [Math.max(hi.x, lo.x), Math.max(hi.y, lo.y)];
  return box(left, top);
}
