import { rounded, type Corners } from '../core/blueprint';
import { mid, type Connector, type Segment } from '../core/measure';
import { height, ring, width, type Rect } from '../core/rect';
import type { Frame, LabelKind, PlacedLabel } from './controller';

const BLUE = '#3b82f6';
const RED = '#f24822';
const PURPLE = '#a855f7';
const GREEN = '#16a34a';
const PADDING_FILL = 'rgb(34 197 94 / 0.35)';
const PADDING_HATCH = 'rgb(34 197 94 / 0.7)';
const MARGIN_FILL = 'rgb(249 115 22 / 0.35)';
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LABEL_COLOR: Record<LabelKind, string> = { size: BLUE, measure: RED, gap: PURPLE, padding: GREEN };

// drawn exactly at the box placeLabels chose, so what is tested is what is seen
const Label = ({ l }: { l: PlacedLabel }) => (
  <g>
    <rect x={l.box.left} y={l.box.top} width={width(l.box)} height={height(l.box)} rx={3} fill={LABEL_COLOR[l.kind]} />
    <text
      x={mid(l.box.left, l.box.right)}
      y={mid(l.box.top, l.box.bottom)}
      fill="#fff"
      fontSize={11}
      fontFamily={FONT}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {l.text}
    </text>
  </g>
);

const Bands = ({ rects, fill }: { rects: Rect[]; fill: string }) =>
  rects.map((r, i) => <rect key={i} x={r.left} y={r.top} width={width(r)} height={height(r)} fill={fill} />);

const Outline = ({ r, color, strokeWidth, dash }: { r: Rect; color: string; strokeWidth: number; dash?: string }) => (
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
function SegmentLine({ s, color }: { s: Omit<Segment, 'kind'>; color: string }) {
  const ticks =
    s.axis === 'x'
      ? `M${s.x1} ${s.y1 - TICK}V${s.y1 + TICK}M${s.x2} ${s.y2 - TICK}V${s.y2 + TICK}`
      : `M${s.x1 - TICK} ${s.y1}H${s.x1 + TICK}M${s.x2 - TICK} ${s.y2}H${s.x2 + TICK}`;
  return <path d={`M${s.x1} ${s.y1}L${s.x2} ${s.y2}${ticks}`} stroke={color} strokeWidth={1} shapeRendering="crispEdges" />;
}

const ConnectorLine = ({ c }: { c: Connector }) => (
  <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={RED} strokeWidth={1} strokeDasharray="4 3" shapeRendering="crispEdges" />
);

export function Overlay({ frame }: { frame: Frame }) {
  const { hover, selected, selection, measuring, measurement, gaps, labels, blueprint } = frame;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      <defs>
        {/* user space: stripes line up across every band */}
        <pattern id="uim-hatch" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={PADDING_HATCH} strokeWidth={1.5} />
        </pattern>
      </defs>
      {blueprint && (
        <>
          <path d={rectsPath(blueprint.padding)} fill="url(#uim-hatch)" />
          <path d={rectsPath(blueprint.outlines)} fill="none" stroke={BLUE} strokeWidth={1} strokeDasharray="4 3" shapeRendering="crispEdges" />
          <path d={arcsPath(blueprint.corners)} fill="none" stroke={BLUE} strokeWidth={1.5} />
        </>
      )}
      {hover && !measuring && (
        <>
          <Bands rects={ring(hover.margin, hover.border)} fill={MARGIN_FILL} />
          <Bands rects={ring(hover.padding, hover.content)} fill={PADDING_FILL} />
        </>
      )}
      {hover && <Outline r={hover.border} color={measuring ? RED : BLUE} strokeWidth={1} />}
      {selected.map((r, i) => <Outline key={i} r={r} color={BLUE} strokeWidth={2} />)}
      {selection && selected.length > 1 && <Outline r={selection} color={BLUE} strokeWidth={1} dash="4 3" />}
      {measurement?.connectors.map((c, i) => <ConnectorLine key={i} c={c} />)}
      {measurement?.segments.map((s, i) => <SegmentLine key={i} s={s} color={RED} />)}
      {gaps.map((g, i) => <SegmentLine key={i} s={g} color={PURPLE} />)}
      {labels.map((l, i) => <Label key={i} l={l} />)}
    </svg>
  );
}
