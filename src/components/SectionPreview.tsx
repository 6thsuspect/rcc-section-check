import { useId, useState } from 'react'
import type { Rebar, SectionGeometry, SectionProperties } from '../engine/types'
import {
  faceFromNormal,
  formatCover,
  inboundNormal,
  innerCover,
  isAxisAlignedRect,
  outerCover,
  radialCover,
  type CoverAudit,
  type BarCoverStatus,
  type CoverSpec,
} from '../engine/cover'
import { signedArea } from '../engine/geometry'
import { fmtN } from '../state'
import { Check, chipGroupCls, EmptyState, noteSmCls, Readout, ZoomableSvg } from './ui'
import type { ActiveFace } from './CoverPanel'

const W = 460
const H = 340
const PAD = 34
const FONT = "Bahnschrift, 'Avenir Next', 'Segoe UI', sans-serif"

const LABEL_COLORS = [
  { name: 'ink', hex: '#17222c' },
  { name: 'blue', hex: '#2a78d6' },
  { name: 'orange', hex: '#d95926' },
  { name: 'green', hex: '#0ca30c' },
]

/** Hover text of a bar: coordinates, diameter and its cover audit result. */
function barTooltip(i: number, b: Rebar, st: BarCoverStatus | null | undefined): string {
  const head = `bar ${i + 1} — (${b.x}, ${b.y}) ⌀${b.dia}`
  if (!st) return head
  const where = `${st.surface === 'inner' ? 'void ' : ''}${st.faceName || st.face}`
  return `${head} · cover ${st.achieved.toFixed(1)} mm vs ${st.required.toFixed(1)} mm required at ${where}${
    st.ok ? '' : ' — SHORT'
  }`
}

export interface NAInfo {
  /** NA orientation, rad (direction of the NA line). */
  theta: number
  /** Signed offset of the NA from the centroid along the compression normal, mm. */
  vna: number
  caption: string
  /** Actual NA depth from the extreme compression fibre, mm (draws the xu dimension). */
  xu?: number
  /** Offset of the extreme compression fibre from the centroid along the compression normal, mm. */
  vTop?: number
}

/**
 * Optional SLS stress overlay drawn on the section (only supplied by the SLS
 * window; absent for ULS, so the ULS figure is unchanged). Annotates the
 * extreme-fibre concrete stress and the governing tension/compression bar
 * stresses next to the neutral axis already drawn from `na`.
 */
export interface StressOverlay {
  /** Max concrete compressive stress at the extreme fibre, N/mm². */
  sigmaC: number
  /** Permissible concrete stress σcbc, N/mm². */
  sigmaCbc: number
  /** Max tensile steel stress, N/mm². */
  sigmaSt: number
  /** Permissible tensile steel stress σst, N/mm². */
  sigmaStPerm: number
  /** Index of the most-tensioned bar (−1 if none). */
  tensionBar: number
}

export function SectionPreview({
  geometry,
  bars,
  props,
  na,
  cover,
  audit,
  radialCoverOnly = false,
  overlapping,
  activeFace,
  onHoverFace,
  onSelectFace,
  stress,
}: {
  geometry: SectionGeometry
  bars: Rebar[]
  props: SectionProperties | null
  na?: NAInfo | null
  /** Per-face nominal cover; draws the cover envelope when supplied. */
  cover?: CoverSpec | null
  /** Achieved-cover audit — bars short of their face cover are ringed in red. */
  audit?: CoverAudit | null
  /** Circular rings use one governing radial value all around the section. */
  radialCoverOnly?: boolean
  /** Indices of bars that intersect another bar — drawn in red. */
  overlapping?: Set<number> | null
  activeFace?: ActiveFace | null
  onHoverFace?: (face: ActiveFace | null) => void
  onSelectFace?: (face: ActiveFace | null) => void
  /** SLS stress annotations (SLS window only). */
  stress?: StressOverlay | null
}) {
  const [showLabels, setShowLabels] = useState(true)
  const [fontSize, setFontSize] = useState(11)
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[1].hex)
  const [showNA, setShowNA] = useState(true)
  const [showCover, setShowCover] = useState(true)
  const clipId = useId()

  const xs = geometry.boundary.map((p) => p.x)
  const ys = geometry.boundary.map((p) => p.y)
  if (xs.length < 3)
    return <EmptyState icon="ruler" title="Enter at least 3 boundary vertices." note="The preview and the analysis both need a closed polygon." />
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  // leave room outside the section for the xu dimension line when it is drawn
  const showXu = !!(na && props && showNA && na.xu != null && na.vTop != null)
  const pad = showXu ? PAD + 14 : PAD
  const scale = Math.min((W - 2 * pad) / Math.max(1, xmax - xmin), (H - 2 * pad) / Math.max(1, ymax - ymin))
  const ox = (W - (xmax - xmin) * scale) / 2
  const oy = (H - (ymax - ymin) * scale) / 2
  const X = (x: number) => ox + (x - xmin) * scale
  const Y = (y: number) => H - oy - (y - ymin) * scale

  const toPts = (poly: { x: number; y: number }[]) => poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')
  const toPath = (poly: { x: number; y: number }[]) =>
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x)} ${Y(p.y)}`).join(' ') + ' Z'

  const cx = props ? X(props.cx) : null
  const cy = props ? Y(props.cy) : null

  // neutral-axis geometry in user coordinates
  let naEls: { x1: number; y1: number; x2: number; y2: number; poly: string; lx: number; ly: number } | null = null
  let xuEls: XuDimension | null = null
  if (na && props && showNA) {
    const d = { x: Math.cos(na.theta), y: Math.sin(na.theta) }
    const n = { x: -Math.sin(na.theta), y: Math.cos(na.theta) }
    const P0 = { x: props.cx + na.vna * n.x, y: props.cy + na.vna * n.y }
    const L = 2 * Math.max(xmax - xmin, ymax - ymin)
    const A = { x: P0.x - L * d.x, y: P0.y - L * d.y }
    const B = { x: P0.x + L * d.x, y: P0.y + L * d.y }
    const C = { x: B.x + L * n.x, y: B.y + L * n.y }
    const Dp = { x: A.x + L * n.x, y: A.y + L * n.y }
    if (showXu) xuEls = xuDimension(geometry.boundary, { x: props.cx, y: props.cy }, d, n, na.vTop!, na.xu!, scale, X, Y)
    // the NA tag goes on the opposite side of the section from the xu dimension so they never collide
    const tagSide = xuEls ? -xuEls.side : 1
    const tagU = xuEls ? xuEls.uEdgeOpp + (tagSide * 10) / scale : 0.15 * L
    const tag = { x: P0.x + tagU * d.x, y: P0.y + tagU * d.y }
    naEls = {
      x1: X(A.x),
      y1: Y(A.y),
      x2: X(B.x),
      y2: Y(B.y),
      poly: [A, B, C, Dp].map((p) => `${X(p.x)},${Y(p.y)}`).join(' '),
      lx: X(tag.x + (6 / scale) * n.x),
      ly: Y(tag.y) - 5,
    }
  }

  // --- per-face cover envelope ---
  const coverLines: { x1: number; y1: number; x2: number; y2: number }[] = []
  const coverLabels: { x: number; y: number; text: string; bad: boolean }[] = []
  if (cover && showCover) {
    const drawRing = (poly: { x: number; y: number }[], inner: boolean) => {
      if (poly.length < 3) return
      const ccw = signedArea(poly) >= 0
      const seen = new Set<string>()
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const { x: nx, y: ny } = inboundNormal(a, b, ccw)
        const legacyFace = faceFromNormal(nx, ny)
        const c = radialCoverOnly
          ? radialCover(cover, inner ? 'inner' : 'outer')
          : inner
            ? innerCover(cover, legacyFace)
            : outerCover(cover, legacyFace)
        if (!(c > 0)) continue
        const sx = inner ? -nx : nx
        const sy = inner ? -ny : ny
        coverLines.push({
          x1: X(a.x + sx * c),
          y1: Y(a.y + sy * c),
          x2: X(b.x + sx * c),
          y2: Y(b.y + sy * c),
        })
        const key = `${inner ? 'v' : 'o'}${i}`
        if (!seen.has(key) && poly.length <= 16) {
          seen.add(key)
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          const short = audit
            ? audit.bars.some((s) => !s.ok && s.surface === (inner ? 'inner' : 'outer') && s.faceIndex === i)
            : false
          coverLabels.push({
            x: X(mx + sx * (c / 2)),
            y: Y(my + sy * (c / 2)),
            text: `${c.toFixed(0)}`,
            bad: short,
          })
        }
      }
    }

    drawRing(geometry.boundary, false)
    for (let v = 0; v < geometry.voids.length; v++) drawRing(geometry.voids[v], true)
  }

  const isRect = geometry.boundary.length === 4 && isAxisAlignedRect(geometry.boundary)

  return (
    <div>
      {/* label & display controls */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-field border border-line bg-panel/55 px-2 py-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Check checked={showLabels} onChange={setShowLabels} label="Labels" />
          {na && (
            <Check
              checked={showNA}
              onChange={setShowNA}
              label="Neutral axis"
              title="Draw the governing neutral axis and compression zone of the selected case"
            />
          )}
          {cover && (
            <Check
              checked={showCover}
              onChange={setShowCover}
              label="Cover"
              title="Show the nominal cover envelope of each face (to the outside of the links)"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={chipGroupCls} title="Label font size">
            <button
              className="grid h-[18px] w-[19px] place-items-center rounded text-[10px] font-semibold text-ink-2 transition-colors duration-150 hover:bg-panel hover:text-accent"
              aria-label="Smaller labels"
              onClick={() => setFontSize((v) => Math.max(8, v - 1))}
            >
              A−
            </button>
            <span className="w-5 text-center text-[10.5px] text-ink-3 tnum">{fontSize}</span>
            <button
              className="grid h-[18px] w-[19px] place-items-center rounded text-[11px] font-semibold text-ink-2 transition-colors duration-150 hover:bg-panel hover:text-accent"
              aria-label="Larger labels"
              onClick={() => setFontSize((v) => Math.min(20, v + 1))}
            >
              A+
            </button>
          </span>
          <span className={chipGroupCls} title="Label colour">
            {LABEL_COLORS.map((c) => (
              <button
                key={c.name}
                aria-label={`Label colour ${c.name}`}
                aria-pressed={labelColor === c.hex}
                title={`Label colour — ${c.name}`}
                className="h-[13px] w-[13px] rounded-full border border-black/10 transition-transform duration-150 hover:scale-110"
                style={{
                  background: c.hex,
                  outline: labelColor === c.hex ? '2px solid var(--color-accent)' : 'none',
                  outlineOffset: '1px',
                }}
                onClick={() => setLabelColor(c.hex)}
              />
            ))}
            <input
              type="color"
              value={labelColor}
              aria-label="Custom label colour"
              title="Custom label colour"
              className="h-[15px] w-[17px] cursor-pointer rounded-[3px] border border-edge transition-transform duration-150 hover:scale-105"
              onChange={(e) => setLabelColor(e.target.value)}
            />
          </span>
        </div>
      </div>

      <ZoomableSvg W={W} H={H} id="fig-section" ariaLabel="Scaled preview of the section with reinforcement">
        <defs>
          <marker id={`${clipId}-arr`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1.5 L10,5 L0,8.5 z" className="fill-demand" />
          </marker>
          <clipPath id={clipId}>
            <path
              clipRule="evenodd"
              fillRule="evenodd"
              d={toPath(geometry.boundary) + geometry.voids.map(toPath).join(' ')}
            />
          </clipPath>
        </defs>

        <polygon points={toPts(geometry.boundary)} className="fill-concrete stroke-ink" strokeWidth="1.8" />
        {geometry.voids.map((v, i) => (
          <polygon key={i} points={toPts(v)} className="fill-paper stroke-ink" strokeWidth="1.4" />
        ))}

        {/* --- Interactive Face Highlight Lines --- */}
        {geometry.boundary.map((p1, i) => {
          const p2 = geometry.boundary[(i + 1) % geometry.boundary.length]
          const isActive = activeFace?.surface === 'outer' && activeFace?.faceIndex === i
          const mx = (p1.x + p2.x) / 2
          const my = (p1.y + p2.y) / 2
          return (
            <g key={`edge-outer-${i}`}>
              <line
                x1={X(p1.x)}
                y1={Y(p1.y)}
                x2={X(p2.x)}
                y2={Y(p2.y)}
                stroke="transparent"
                strokeWidth="14"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => onHoverFace?.({ surface: 'outer', faceIndex: i })}
                onMouseLeave={() => onHoverFace?.(null)}
                onClick={() => onSelectFace?.({ surface: 'outer', faceIndex: i })}
              />
              {isActive && (
                <line
                  x1={X(p1.x)}
                  y1={Y(p1.y)}
                  x2={X(p2.x)}
                  y2={Y(p2.y)}
                  stroke="var(--color-accent)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              )}
              {isActive && (
                <text
                  x={X(mx)}
                  y={Y(my) - 6}
                  fontSize="10"
                  fontFamily={FONT}
                  fontWeight="bold"
                  fill="var(--color-accent)"
                  textAnchor="middle"
                >
                  {isRect ? ['Bottom', 'Right', 'Top', 'Left'][i] : `Face ${i + 1}`}
                </text>
              )}
            </g>
          )
        })}

        {geometry.voids.map((vPoly, vIdx) =>
          vPoly.map((p1, i) => {
            const p2 = vPoly[(i + 1) % vPoly.length]
            const isActive =
              activeFace?.surface === 'inner' &&
              activeFace?.faceIndex === i &&
              (activeFace?.voidIndex ?? 0) === vIdx
            const mx = (p1.x + p2.x) / 2
            const my = (p1.y + p2.y) / 2
            return (
              <g key={`edge-inner-${vIdx}-${i}`}>
                <line
                  x1={X(p1.x)}
                  y1={Y(p1.y)}
                  x2={X(p2.x)}
                  y2={Y(p2.y)}
                  stroke="transparent"
                  strokeWidth="14"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => onHoverFace?.({ surface: 'inner', faceIndex: i, voidIndex: vIdx })}
                  onMouseLeave={() => onHoverFace?.(null)}
                  onClick={() => onSelectFace?.({ surface: 'inner', faceIndex: i, voidIndex: vIdx })}
                />
                {isActive && (
                  <line
                    x1={X(p1.x)}
                    y1={Y(p1.y)}
                    x2={X(p2.x)}
                    y2={Y(p2.y)}
                    stroke="var(--color-accent)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                )}
                {isActive && (
                  <text
                    x={X(mx)}
                    y={Y(my) - 6}
                    fontSize="10"
                    fontFamily={FONT}
                    fontWeight="bold"
                    fill="var(--color-accent)"
                    textAnchor="middle"
                  >
                    {`Inner Face ${i + 1}`}
                  </text>
                )}
              </g>
            )
          }),
        )}

        {/* per-face nominal cover envelope */}
        {coverLines.length > 0 && (
          <g>
            {coverLines.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="stroke-ink-3" strokeWidth="0.9" strokeDasharray="5 3" />
            ))}
            {coverLabels.map((t, i) => (
              <text
                key={`cl-${i}`}
                x={t.x}
                y={t.y}
                fontSize={Math.max(8, fontSize - 2)}
                fontFamily={FONT}
                fontWeight="600"
                fill={t.bad ? 'var(--color-bad)' : 'var(--color-ink-3)'}
              >
                {t.text}
              </text>
            ))}
          </g>
        )}

        {/* compression zone + neutral axis */}
        {naEls && (
          <g>
            <polygon points={naEls.poly} clipPath={`url(#${clipId})`} className="fill-capacity" opacity="0.14" />
            <line
              x1={naEls.x1}
              y1={naEls.y1}
              x2={naEls.x2}
              y2={naEls.y2}
              className="stroke-demand"
              strokeWidth="1.8"
              strokeDasharray="9 4 2 4"
            />
            <text
              x={naEls.lx}
              y={naEls.ly}
              fontSize={fontSize}
              fontFamily={FONT}
              fontWeight="600"
              fill={labelColor}
              textAnchor={xuEls && xuEls.tagAnchorEnd ? 'end' : 'start'}
            >
              NA
            </text>
          </g>
        )}

        {/* xu dimension: outside the section, parallel to the compression normal, from the extreme fibre to the NA */}
        {xuEls && (
          <g className="pointer-events-none">
            <line {...xuEls.ext1} className="stroke-demand" strokeWidth="0.8" />
            <line {...xuEls.ext2} className="stroke-demand" strokeWidth="0.8" />
            <line
              {...xuEls.dim}
              className="stroke-demand"
              strokeWidth="1.2"
              markerStart={`url(#${clipId}-arr)`}
              markerEnd={xuEls.clipped ? undefined : `url(#${clipId}-arr)`}
            />
            <text
              x={xuEls.label.x}
              y={xuEls.label.y}
              transform={`rotate(${xuEls.label.angle} ${xuEls.label.x} ${xuEls.label.y})`}
              fontSize={Math.max(9, fontSize)}
              fontFamily={FONT}
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="middle"
              paintOrder="stroke"
              stroke="var(--color-card, #fff)"
              strokeWidth="3"
              className="fill-demand"
            >
              xu = {na!.xu!.toFixed(0)} mm{xuEls.clipped ? ' (NA beyond section)' : ''}
            </text>
          </g>
        )}

        {/* SLS stress annotations (SLS window only — absent for ULS) */}
        {stress && na && props && showNA && na.xu != null && Number.isFinite(na.xu) &&
          (() => {
            const n = { x: -Math.sin(na.theta), y: Math.cos(na.theta) }
            const vTop = na.vTop ?? 0
            // σc label sits just inside the extreme compression fibre.
            const cOff = 16 / scale
            const cPos = { x: X(props.cx + (vTop - cOff) * n.x), y: Y(props.cy + (vTop - cOff) * n.y) }
            const cOk = stress.sigmaC <= stress.sigmaCbc
            const tb = stress.tensionBar >= 0 ? bars[stress.tensionBar] : null
            const sOk = stress.sigmaSt <= stress.sigmaStPerm
            const r = tb ? Math.max(2.2, (tb.dia / 2) * scale) : 0
            const sPos = tb ? { x: X(tb.x) + r + 4, y: Y(tb.y) - r - 2 } : null
            const chip = (x: number, y: number, text: string, ok: boolean, anchor: 'start' | 'middle' | 'end') => (
              <text
                x={x}
                y={y}
                fontSize={Math.max(9, fontSize - 1)}
                fontFamily={FONT}
                fontWeight="700"
                textAnchor={anchor}
                paintOrder="stroke"
                stroke="var(--color-card, #fff)"
                strokeWidth="3"
                fill={ok ? 'var(--color-ok)' : 'var(--color-bad)'}
              >
                {text}
              </text>
            )
            return (
              <g className="pointer-events-none">
                {chip(cPos.x, cPos.y, `σc ${stress.sigmaC.toFixed(1)}`, cOk, 'middle')}
                {sPos && chip(sPos.x, sPos.y, `σst ${stress.sigmaSt.toFixed(0)}`, sOk, 'start')}
              </g>
            )
          })()}

        {cx !== null && cy !== null && (
          <g>
            <line x1={cx - 200} y1={cy} x2={cx + 200} y2={cy} className="stroke-ink-3" strokeWidth="1" strokeDasharray="5 4" />
            <line x1={cx} y1={cy - 160} x2={cx} y2={cy + 160} className="stroke-ink-3" strokeWidth="1" strokeDasharray="5 4" />
            <text x={cx + 204} y={cy + 4} className="fill-ink-2" fontSize="11" fontFamily={FONT}>X</text>
            <text x={cx + 4} y={cy - 164} className="fill-ink-2" fontSize="11" fontFamily={FONT}>Y</text>
            {showLabels && props && (
              <text x={cx + 6} y={cy + 16} fontSize={fontSize} fontFamily={FONT} fontWeight="600" fill={labelColor}>
                G ({fmtN(props.cx, 0)}, {fmtN(props.cy, 0)})
              </text>
            )}
          </g>
        )}

        {bars.map((b, i) => {
          const r = Math.max(2.2, (b.dia / 2) * scale)
          const st = audit?.bars[i] ?? null
          const bad = st !== null && !st.ok
          const clash = !!overlapping?.has(i)
          return (
            <g key={i}>
              <circle
                cx={X(b.x)}
                cy={Y(b.y)}
                r={r}
                className={clash ? undefined : 'fill-capacity'}
                fill={clash ? 'var(--color-bad)' : undefined}
                fillOpacity={clash ? 0.78 : undefined}
                stroke={clash ? '#8f1d1d' : bad ? 'var(--color-bad)' : 'none'}
                strokeWidth={clash ? 1.2 : bad ? 1.6 : 0}
                data-overlap={clash ? 'true' : undefined}
              >
                <title>{`${barTooltip(i, b, st)}${clash ? ' — OVERLAPS another bar' : ''}`}</title>
              </circle>
              {showLabels && (
                <text
                  x={X(b.x) + r + 2}
                  y={Y(b.y) - r - 1}
                  fontSize={fontSize}
                  fontFamily={FONT}
                  fill={labelColor}
                >
                  {i + 1}
                </text>
              )}
            </g>
          )
        })}
      </ZoomableSvg>

      {/* figure legend */}
      <div className="mt-2 flex flex-col gap-1">
        {cover && showCover && (
          <p className={`${noteSmCls} flex items-start gap-1.5`}>
            <span
              aria-hidden="true"
              className="mt-[5px] h-0 w-4 shrink-0 border-t border-dashed border-ink-3"
            />
            <span>
              Dashed envelope = nominal cover to the links: {formatCover(cover, geometry)}.{' '}
              {audit && audit.nShort > 0 ? (
                <span className="font-semibold text-bad">
                  {audit.nShort} bar(s) ringed in red are short of their face cover.
                </span>
              ) : (
                <span className="text-ok">All bars meet the cover of the face they lie against.</span>
              )}
            </span>
          </p>
        )}
        {overlapping && overlapping.size > 0 && (
          <p className={`${noteSmCls} flex items-start gap-1.5`}>
            <span aria-hidden="true" className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full bg-bad" />
            <span className="font-semibold text-bad">
              {overlapping.size} bar(s) filled red intersect another bar — see Reinforcement spacing & overlap.
            </span>
          </p>
        )}
        {na && showNA && (
          <p className={`${noteSmCls} flex items-start gap-1.5`}>
            <span aria-hidden="true" className="mt-[5px] h-0 w-4 shrink-0 border-t-2 border-dotted border-demand" />
            <span>{na.caption} — shaded side is in compression.</span>
          </p>
        )}
      </div>

      {props && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Readout label="Gross area Ag" value={`${fmtN(props.area / 1e3, 1)}×10³ mm²`} />
          <Readout
            label="Steel Asc · p"
            value={`${fmtN(props.Asc, 0)} mm² · ${fmtN(props.p, 2)}%`}
            title="Total area of longitudinal reinforcement and its percentage of the gross section"
          />
          <Readout label="Bars" value={`${props.barCount}`} />
          <Readout label="Ixx" value={`${fmtN(props.Ixx / 1e6, 0)}×10⁶ mm⁴`} title="Second moment of area about the centroidal X axis" />
          <Readout label="Iyy" value={`${fmtN(props.Iyy / 1e6, 0)}×10⁶ mm⁴`} title="Second moment of area about the centroidal Y axis" />
          <Readout label="Centroid G" value={`(${fmtN(props.cx, 0)}, ${fmtN(props.cy, 0)})`} />
        </div>
      )}
    </div>
  )
}

interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface XuDimension {
  ext1: Seg
  ext2: Seg
  dim: Seg
  label: { x: number; y: number; angle: number }
  /** +1 → dimension on the +d side of the section, −1 → on the −d side. */
  side: 1 | -1
  /** Along-NA coordinate (relative to the NA foot point) of the section edge opposite the dimension. */
  uEdgeOpp: number
  tagAnchorEnd: boolean
  /** True when the NA lies so far outside the section that the dimension is cut at the view edge. */
  clipped: boolean
}

/**
 * Geometry of the xu dimension line. It is placed outside the section, beyond
 * the section's extent along the NA direction, and runs parallel to the
 * compression normal from the extreme compression fibre to the NA line, so it
 * is aligned with the NA and clear of the bars, cover labels and axes.
 */
function xuDimension(
  boundary: { x: number; y: number }[],
  G: { x: number; y: number },
  d: { x: number; y: number },
  n: { x: number; y: number },
  vTop: number,
  xu: number,
  scale: number,
  X: (x: number) => number,
  Y: (y: number) => number,
): XuDimension {
  const proj = boundary.map((p) => ({ u: (p.x - G.x) * d.x + (p.y - G.y) * d.y, v: (p.x - G.x) * n.x + (p.y - G.y) * n.y }))
  const umin = Math.min(...proj.map((p) => p.u))
  const umax = Math.max(...proj.map((p) => p.u))
  const vmin = Math.min(...proj.map((p) => p.v))
  const top = proj.reduce((a, b) => (b.v > a.v + 1e-6 ? b : a), proj[0])
  const h = vTop - vmin
  // pick the side whose dimension stays nearest the left / bottom of the view (reads naturally) —
  // for bending about X that is the left side, for bending about Y the bottom side
  const toScreen = (u: number, v: number) => ({ x: X(G.x + u * d.x + v * n.x), y: Y(G.y + u * d.y + v * n.y) })
  const gap = 18 / scale
  const vEndRaw = vTop - xu
  const vLimit = vmin - 0.3 * h
  const clipped = vEndRaw < vLimit
  const vEnd = clipped ? vLimit : vEndRaw
  // along-NA extent of the section inside the xu band only (vEnd ≤ v ≤ vTop): the dimension
  // just has to clear that part of the section, which keeps it close for inclined axes
  const bandU: number[] = []
  const vLo = Math.min(vEnd, vTop)
  for (let i = 0; i < proj.length; i++) {
    const p1 = proj[i]
    const p2 = proj[(i + 1) % proj.length]
    if (p1.v >= vLo - 1e-9 && p1.v <= vTop + 1e-9) bandU.push(p1.u)
    for (const vc of [vLo, vTop]) {
      if ((p1.v - vc) * (p2.v - vc) < 0) bandU.push(p1.u + ((vc - p1.v) / (p2.v - p1.v)) * (p2.u - p1.u))
    }
  }
  const bMin = bandU.length ? Math.min(...bandU) : umin
  const bMax = bandU.length ? Math.max(...bandU) : umax
  // how far the dimension line and its label would run outside the view on each side
  const overflow = (sd: 1 | -1) => {
    const u = sd < 0 ? bMin - gap : bMax + gap
    const a = toScreen(u, vTop)
    const b = toScreen(u, vEnd)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const m = toScreen(u + (sd * 9) / scale, (vTop + vEnd) / 2)
    const half = Math.max(len, 90) / 2 // label extends ~45 px either side of its centre along the line
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const pts = [a, b, { x: m.x - ux * half, y: m.y - uy * half }, { x: m.x + ux * half, y: m.y + uy * half }]
    return pts.reduce((acc, p) => acc + Math.max(0, 4 - p.x) + Math.max(0, p.x - (W - 4)) + Math.max(0, 4 - p.y) + Math.max(0, p.y - (H - 4)), 0)
  }
  const minus = toScreen(bMin, vTop)
  const plus = toScreen(bMax, vTop)
  // prefer the side that reads naturally (left for bending about X, bottom for bending about Y) …
  const natural: 1 | -1 = minus.x < plus.x - 1 || (Math.abs(minus.x - plus.x) <= 1 && minus.y > plus.y) ? -1 : 1
  // … unless the other side keeps more of the dimension inside the figure
  const side: 1 | -1 = overflow(natural) <= overflow(-natural as 1 | -1) + 0.5 ? natural : (-natural as 1 | -1)
  const uDim = side < 0 ? bMin - gap : bMax + gap
  const uEdge = side < 0 ? bMin : bMax
  const P = (u: number, v: number) => toScreen(u, v)
  const a = P(uDim, vTop)
  const b = P(uDim, vEnd)
  const e1a = P(top.u, vTop)
  const e1b = P(uDim + (side * 4) / scale, vTop)
  const e2a = P(uEdge + (side * 3) / scale, vEnd)
  const e2b = P(uDim + (side * 4) / scale, vEnd)
  const mid = P(uDim + (side * 9) / scale, (vTop + vEnd) / 2)
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  if (angle > 90) angle -= 180
  if (angle <= -90) angle += 180
  return {
    ext1: { x1: e1a.x, y1: e1a.y, x2: e1b.x, y2: e1b.y },
    ext2: { x1: e2a.x, y1: e2a.y, x2: e2b.x, y2: e2b.y },
    dim: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
    label: { x: mid.x, y: mid.y, angle },
    side,
    uEdgeOpp: side < 0 ? umax : umin,
    tagAnchorEnd: toScreen(side < 0 ? umax : umin, vTop - xu).x < toScreen(side < 0 ? umin : umax, vTop - xu).x,
    clipped,
  }
}
