import type { CSSProperties } from 'react';
import { rounded, type Corners } from '../core/blueprint';
import { HINT_GAP, HINT_PAD_X, KEY_PAD_X, type PlacedHint } from '../core/hint';
import { FONT_SIZE } from '../core/labels';
import { mid, type Connector, type Segment } from '../core/measure';
import { height, ring, width, type Rect } from '../core/rect';
import { STYLES_GROUP_GAP, STYLES_PAD_X, STYLES_PAD_Y, STYLES_ROW_H, STYLES_SWATCH, STYLES_SWATCH_GAP } from '../core/styles';
import type { Frame, LabelKind, PlacedLabel } from './controller';
import { theme } from './theme';

const LABEL_COLOR: Record<LabelKind, string> = {
  size: theme.size.label,
  measurement: theme.measurement.label,
  gap: theme.gap.label,
  padding: theme.padding.label,
  radius: theme.radius.label,
};

// drawn exactly at the box placeLabels chose, so what is tested is what is seen.
// rounded like the Hint; `data-*` names each part for e2e; the layer below carries one shadow for every label (one per label blows the blueprint frame budget)
const Label = ({ l }: { l: PlacedLabel }) => (
  <g opacity={l.opacity}>
    <rect x={l.box.left} y={l.box.top} width={width(l.box)} height={height(l.box)} rx={theme.label.corner} fill={LABEL_COLOR[l.kind]} data-label={l.kind} />
    <text
      x={mid(l.box.left, l.box.right)}
      y={mid(l.box.top, l.box.bottom)}
      fill={theme.label.text}
      fontSize={FONT_SIZE}
      fontFamily={theme.font}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {l.text}
    </text>
  </g>
);

const Bands = ({ part, rects, fill }: { part: 'padding' | 'margin'; rects: Rect[]; fill: string }) =>
  rects.map((r, i) => <rect key={i} x={r.left} y={r.top} width={width(r)} height={height(r)} fill={fill} data-band={part} />);

type OutlineProps = { part: 'hover' | 'selected' | 'selection'; r: Rect; color: string; strokeWidth: number; dash?: string };
const Outline = ({ part, r, color, strokeWidth, dash }: OutlineProps) => (
  <rect
    x={r.left}
    y={r.top}
    width={width(r)}
    height={height(r)}
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeDasharray={dash}
    shapeRendering="crispEdges"
    data-outline={part}
  />
);

// Blueprint draws hundreds of boxes: each layer is one <path>, not one element per box (research Phần 05 §7)
const rectsPath = (rs: Rect[]) => rs.map((r) => `M${r.left} ${r.top}H${r.right}V${r.bottom}H${r.left}Z`).join('');

// one elliptical arc per rounded corner, along the border edge (research Phần 05 §4.3)
const arcsPath = (cs: { box: Rect; radii: Corners }[]) =>
  cs
    .map(({ box: { left: l, top: t, right: r, bottom: b }, radii: [tl, tr, br, bl] }) =>
      [
        rounded(tl) ? `M${l} ${t + tl[1]}A${tl[0]} ${tl[1]} 0 0 1 ${l + tl[0]} ${t}` : '',
        rounded(tr) ? `M${r - tr[0]} ${t}A${tr[0]} ${tr[1]} 0 0 1 ${r} ${t + tr[1]}` : '',
        rounded(br) ? `M${r} ${b - br[1]}A${br[0]} ${br[1]} 0 0 1 ${r - br[0]} ${b}` : '',
        rounded(bl) ? `M${l + bl[0]} ${b}A${bl[0]} ${bl[1]} 0 0 1 ${l} ${b - bl[1]}` : '',
      ].join(''),
    )
    .join('');

const TICK = 3;
// a measurement segment or a gap: both are a dimension line; its value is one of the frame's labels
function SegmentLine({ part, s, color, strokeWidth }: { part: 'measurement' | 'gap'; s: Omit<Segment, 'kind'>; color: string; strokeWidth: number }) {
  const ticks =
    s.axis === 'x'
      ? `M${s.x1} ${s.y1 - TICK}V${s.y1 + TICK}M${s.x2} ${s.y2 - TICK}V${s.y2 + TICK}`
      : `M${s.x1 - TICK} ${s.y1}H${s.x1 + TICK}M${s.x2 - TICK} ${s.y2}H${s.x2 + TICK}`;
  // under 2 ticks long the end ticks merge into one mark: arrows point at both ends from outside (CAD style →| |←)
  const lo = s.axis === 'x' ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2);
  const hi = s.axis === 'x' ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2);
  const arrows =
    hi - lo >= 2 * TICK
      ? ''
      : s.axis === 'x'
        ? `M${lo - 3 * TICK} ${s.y1}H${lo}M${lo - TICK} ${s.y1 - TICK}L${lo} ${s.y1}L${lo - TICK} ${s.y1 + TICK}M${hi + 3 * TICK} ${s.y1}H${hi}M${hi + TICK} ${s.y1 - TICK}L${hi} ${s.y1}L${hi + TICK} ${s.y1 + TICK}`
        : `M${s.x1} ${lo - 3 * TICK}V${lo}M${s.x1 - TICK} ${lo - TICK}L${s.x1} ${lo}L${s.x1 + TICK} ${lo - TICK}M${s.x1} ${hi + 3 * TICK}V${hi}M${s.x1 - TICK} ${hi + TICK}L${s.x1} ${hi}L${s.x1 + TICK} ${hi + TICK}`;
  return <path d={`M${s.x1} ${s.y1}L${s.x2} ${s.y2}${ticks}${arrows}`} fill="none" stroke={color} strokeWidth={strokeWidth} shapeRendering="crispEdges" data-line={part} />;
}

const ConnectorLine = ({ c }: { c: Connector }) => (
  <line
    x1={c.x1}
    y1={c.y1}
    x2={c.x2}
    y2={c.y2}
    stroke={theme.measurement.guide}
    strokeWidth={theme.measurement.lineWidth}
    strokeDasharray={theme.measurement.guideDash}
    shapeRendering="crispEdges"
    data-line="guide"
  />
);

const KEYCAP: CSSProperties = { padding: `0 ${KEY_PAD_X}px`, lineHeight: '18px', borderRadius: theme.hint.key.corner, background: theme.hint.key.background, color: theme.hint.key.text };

// HTML, not SVG, for the shadow; `all: initial` keeps the page's inherited text styles from changing its width
const Hint = ({ hint: { box, parts } }: { hint: PlacedHint }) => (
  <div
    data-hint=""
    style={{
      all: 'initial',
      position: 'fixed',
      left: box.left,
      top: box.top,
      width: width(box),
      height: height(box),
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: HINT_GAP,
      padding: `0 ${HINT_PAD_X}px`,
      borderRadius: theme.hint.corner,
      background: theme.hint.background,
      boxShadow: theme.hint.shadow,
      color: theme.hint.text,
      font: `${FONT_SIZE}px ${theme.font}`,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    }}
  >
    {parts.map((p, i) => <span key={i} style={p.kind === 'key' ? KEYCAP : undefined}>{p.text}</span>)}
  </div>
);

const SWATCH_STYLE: CSSProperties = { display: 'inline-block', width: STYLES_SWATCH, height: STYLES_SWATCH, marginRight: STYLES_SWATCH_GAP, borderRadius: 2, boxShadow: `inset 0 0 0 1px ${theme.styles.swatch}`, verticalAlign: '-1px' };

// display-only like the Hint, at the box the controller sized; each row's text is exactly `name  value` (e2e reads it)
const Styles = ({ styles: { box, groups } }: { styles: NonNullable<Frame['styles']> }) => (
  <div
    data-styles=""
    style={{
      all: 'initial',
      position: 'fixed',
      left: box.left,
      top: box.top,
      width: width(box),
      height: height(box),
      boxSizing: 'border-box',
      padding: `${STYLES_PAD_Y}px ${STYLES_PAD_X}px`,
      borderRadius: theme.styles.corner,
      background: theme.styles.background,
      boxShadow: theme.styles.shadow,
      color: theme.styles.text,
      font: `${FONT_SIZE}px/${STYLES_ROW_H}px ${theme.font}`,
      whiteSpace: 'pre',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    {groups.map((rows, g) => (
      <div key={g} style={{ display: 'block', marginTop: g > 0 ? STYLES_GROUP_GAP : 0 }}>
        {rows.map((r, i) => (
          <div key={i} data-style-row="" style={{ display: 'block', height: STYLES_ROW_H }}>
            {/* a list's later rows (each shadow) hide the repeated name but keep its width, so values stay aligned */}
            <span style={{ color: theme.styles.name, visibility: rows[i - 1]?.name === r.name ? 'hidden' : undefined }}>{`${r.name}  `}</span>
            {r.color && <span data-swatch="" style={{ ...SWATCH_STYLE, background: r.color }} />}
            {r.value}
          </div>
        ))}
      </div>
    ))}
  </div>
);

export function Overlay({ frame }: { frame: Frame }) {
  const { hover, hoverTouch, selected, selection, measuring, measurement, gaps, labels, details, hint, styles } = frame;
  return (
    <>
      <svg
        width="100%"
        height="100%"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      >
        <defs>
          {/* user space: stripes line up across every band */}
          <pattern id="uim-hatch" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} stroke={theme.padding.hatch} strokeWidth={theme.padding.hatchWidth} />
          </pattern>
        </defs>
        {details && (
          <>
            <path d={rectsPath(details.padding)} fill="url(#uim-hatch)" data-band="hatch" />
            <path
              d={rectsPath(details.outlines)}
              fill="none"
              stroke={theme.blueprint.outline}
              strokeWidth={theme.blueprint.outlineWidth}
              strokeDasharray={theme.blueprint.outlineDash}
              shapeRendering="crispEdges"
              data-outline="blueprint"
            />
            <path d={arcsPath(details.corners)} fill="none" stroke={theme.radius.arc} strokeWidth={theme.radius.arcWidth} data-line="radius" />
          </>
        )}
        {hover && !measuring && (
          <>
            <Bands part="margin" rects={ring(hover.margin, hover.border, hoverTouch)} fill={theme.margin.band} />
            <Bands part="padding" rects={ring(hover.padding, hover.content, hoverTouch)} fill={theme.padding.band} />
          </>
        )}
        {hover && (
          <Outline
            part="hover"
            r={hover.border}
            color={measuring ? theme.measurement.target : theme.hover.outline}
            strokeWidth={measuring ? theme.measurement.targetWidth : theme.hover.outlineWidth}
          />
        )}
        {selected.map((r, i) => <Outline key={i} part="selected" r={r} color={theme.selection.outline} strokeWidth={theme.selection.outlineWidth} />)}
        {selection && selected.length > 1 && (
          <Outline part="selection" r={selection} color={theme.selection.bounds} strokeWidth={theme.selection.boundsWidth} dash={theme.selection.boundsDash} />
        )}
        {measurement?.connectors.map((c, i) => <ConnectorLine key={i} c={c} />)}
        {measurement?.segments.map((s, i) => (
          <SegmentLine key={i} part="measurement" s={s} color={theme.measurement.line} strokeWidth={theme.measurement.lineWidth} />
        ))}
        {gaps.map((g, i) => <SegmentLine key={i} part="gap" s={g} color={theme.gap.line} strokeWidth={theme.gap.lineWidth} />)}
        {labels.map((l, i) =>
          l.leader ? (
            <g key={i} stroke={LABEL_COLOR[l.kind]} fill={LABEL_COLOR[l.kind]}>
              <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} strokeWidth={theme.leader.width} strokeDasharray={theme.leader.dash} data-line="leader" />
              <circle cx={l.leader.x1} cy={l.leader.y1} r={theme.leader.dot} stroke="none" data-leader-dot="" />
            </g>
          ) : null,
        )}
        <g data-labels="" style={{ filter: `drop-shadow(${theme.label.shadow})` }}>
          {labels.map((l, i) => <Label key={i} l={l} />)}
        </g>
      </svg>
      {styles && <Styles styles={styles} />}
      {hint && <Hint hint={hint} />}
    </>
  );
}
