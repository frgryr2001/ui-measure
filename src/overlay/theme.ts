// The overlay's look, by GLOSSARY role: edit a value and rebuild. Roles that share a color point at the same constant
// but can be changed apart. Font size stays in core/labels.ts (it drives label widths). No imports: the worker bundles it.
const BLUE = '#3b82f6';
const RED = '#f24822';
const PURPLE = '#a855f7';
const GREEN = '#16a34a';
// apart from the blue / red / purple / green in use; white text on it ≈ 4.8:1
const PINK = '#db2777';
const DASH = '4 3';
const SHADOW = '0 4px 12px rgb(0 0 0 / 0.3)';
const DARK = 'rgb(24 24 27 / 0.92)';
const LIGHT_TEXT = 'rgb(228 228 231)';

export const theme = {
  font: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  /** Every label pill; its fill is its role's `label`. */
  label: { text: '#fff', corner: 8, shadow: SHADOW },
  size: { label: BLUE },
  /** `target`: the hover outline while measuring; `guide`: the dashed extension of an edge to a spacing. */
  measurement: { label: RED, line: RED, lineWidth: 1, target: RED, targetWidth: 1, guide: RED, guideDash: DASH },
  gap: { label: PURPLE, line: PURPLE, lineWidth: 1 },
  /** `band`: on hover; `hatch`: in details and Blueprint. */
  padding: { label: GREEN, band: 'rgb(34 197 94 / 0.35)', hatch: 'rgb(34 197 94 / 0.7)', hatchWidth: 1.5 },
  margin: { band: 'rgb(249 115 22 / 0.35)' },
  hover: { outline: BLUE, outlineWidth: 1 },
  /** `bounds`: the union outline of a multi-selection. */
  selection: { outline: BLUE, outlineWidth: 2, bounds: BLUE, boundsWidth: 1, boundsDash: DASH },
  blueprint: { outline: BLUE, outlineWidth: 1, outlineDash: DASH },
  /** A details value placed away from what it describes: a dashed line in its label's color, with a dot (`dot`: radius) on the target. */
  leader: { width: 1, dash: '2 2', dot: 2 },
  /** `S`: the selection's stacking context (solid) and the ancestor that clips it (dashed), and their labels. */
  stacking: { label: PINK, outline: PINK, outlineWidth: 1.5, clipDash: DASH },
  /** Corner arcs and their `r` labels. */
  radius: { label: BLUE, arc: BLUE, arcWidth: 1.5 },
  hint: {
    background: DARK,
    text: LIGHT_TEXT,
    corner: 8,
    shadow: SHADOW,
    key: { background: 'rgb(255 255 255 / 0.18)', text: '#fff', corner: 4 },
  },
  /** The Styles panel, in the Hint's look: `name` the property, `text` its value; `swatch` rings a color's swatch so a dark one shows. */
  styles: { background: DARK, text: LIGHT_TEXT, name: 'rgb(161 161 170)', corner: 8, shadow: SHADOW, swatch: 'rgb(255 255 255 / 0.4)' },
  /** The toolbar icon's ON badge. */
  badge: RED,
};
