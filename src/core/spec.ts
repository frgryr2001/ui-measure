import type { Corners } from './blueprint';
import { formatPx, type Edges } from './rect';

/** What Copy writes out for one element, in CSS px. dom.ts reads it. */
export type Spec = {
  /** Finds the element again with `document.querySelector`. */
  selector: string;
  /** Tag and classes as written (`div.card`, `div.w-1/2`), for grepping the source; not a selector. */
  name: string;
  /** Bounds: the border box. */
  width: number;
  height: number;
  padding: Edges;
  border: { width: Edges; style: string; color: string };
  radius: Corners;
};

/** One element of a selector chain, CSS-escaped. `id` is unique in its root, else ''; `nth` is its nth-of-type, 0 when its tag is alone among its siblings. */
export type Step = { tag: string; nth: number; id: string };

/** Selector of the first element of `chain` (the element, then its ancestors), cut at the nearest unique id or at body. */
export function selectorOf(chain: Step[]): string {
  const parts: string[] = [];
  for (const { tag, nth, id } of chain) {
    if (id) return [`#${id}`, ...parts].join(' > ');
    if (tag === 'body' || tag === 'html') return [tag, ...parts].join(' > ');
    parts.unshift(nth ? `${tag}:nth-of-type(${nth})` : tag);
  }
  return parts.join(' > ');
}

type Four = [string, string, string, string];

const px = (n: number) => (formatPx(n) === '0' ? '0' : `${formatPx(n)}px`);

// CSS 1–4 value shorthand, for padding (top right bottom left) and radius (tl tr br bl) alike
const four = ([a, b, c, d]: Four) => (b !== d ? `${a} ${b} ${c} ${d}` : a !== c ? `${a} ${b} ${c}` : a !== b ? `${a} ${b}` : a);
const edges = (e: Edges) => four([px(e.top), px(e.right), px(e.bottom), px(e.left)]);

/** The declarations every format shares, as [property, value]. */
function declarations(s: Spec): [string, string][] {
  const { width: w, style, color } = s.border;
  const widths = [w.top, w.right, w.bottom, w.left].map(formatPx);
  const border: [string, string][] = widths.every((v) => v === '0')
    ? [['border', '0']]
    : widths.every((v) => v === widths[0])
      ? [['border', `${px(w.top)} ${style} ${color}`]]
      : [['border-width', edges(w)], ['border-style', style], ['border-color', color]];
  const x = four([px(s.radius[0][0]), px(s.radius[1][0]), px(s.radius[2][0]), px(s.radius[3][0])]);
  const y = four([px(s.radius[0][1]), px(s.radius[1][1]), px(s.radius[2][1]), px(s.radius[3][1])]);
  return [
    ['width', px(s.width)],
    ['height', px(s.height)],
    // width and height are the bounds
    ['box-sizing', 'border-box'],
    ['padding', edges(s.padding)],
    ...border,
    ['border-radius', x === y ? x : `${x} / ${y}`],
  ];
}

// a class like `*/` must not end the comment
const css = (s: Spec) => [`/* ${s.name.replaceAll('*/', '* /')} */`, `${s.selector} {`, ...declarations(s).map(([p, v]) => `  ${p}: ${v};`), '}'].join('\n');

const round = (n: number) => Number(formatPx(n));
const roundEdges = (e: Edges): Edges => ({ top: round(e.top), right: round(e.right), bottom: round(e.bottom), left: round(e.left) });
const corner = ([x, y]: Corners[number]) => (round(x) === round(y) ? round(x) : [round(x), round(y)]);

const json = (s: Spec) =>
  JSON.stringify(
    {
      selector: s.selector,
      element: s.name,
      width: round(s.width),
      height: round(s.height),
      padding: roundEdges(s.padding),
      border: { ...s.border, width: roundEdges(s.border.width) },
      radius: { topLeft: corner(s.radius[0]), topRight: corner(s.radius[1]), bottomRight: corner(s.radius[2]), bottomLeft: corner(s.radius[3]) },
    },
    null,
    2,
  );

const prompt = (s: Spec) =>
  [
    `## ${s.name} (${formatPx(s.width)} × ${formatPx(s.height)})`,
    '',
    'Measured on the live page in CSS px; width and height are the border box.',
    '',
    `- selector: \`${s.selector}\``,
    ...declarations(s).map(([p, v]) => `- ${p}: ${v}`),
  ].join('\n');

/** One function per Copy format. */
export const FORMATS = { css, json, prompt } satisfies Record<string, (s: Spec) => string>;
export type Format = keyof typeof FORMATS;
