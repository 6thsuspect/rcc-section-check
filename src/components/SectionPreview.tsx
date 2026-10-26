import { useId, useState } from 'react'
import type { Rebar, SectionGeometry, SectionProperties } from '../engine/types'
import {
  FACE_LABELS,
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
import { barArea, signedArea } from '../engine/geometry'
import { analyseBundles, bundleIdOf } from '../engine/barSpacing'
import type { RectSpacerBar } from '../engine/rectRebar'
import { fmtN } from '../state'
import { btnMiniCls, Check, chipGroupCls, EmptyState, noteSmCls, Readout, ZoomableSvg } from './ui'
import type { ActiveFace } from './CoverPanel'

const W = 460
const H = 340
const PAD = 34
const FONT = "Bahnschrift, 'Avenir Next', 'Segoe UI', sans-serif"

/**
 * Label colours offered next to the figure. The first entry follows the theme
 * (dark ink on the light sheet, light ink on the dark one) and is the default:
 * a fixed dark grey would vanish the moment the interface goes dark. Its `hex`
 * is empty because a native colour input only accepts a real hex value — the
 * empty string is what the state carries while the theme colour is selected.
 */
const LABEL_COLORS = [
  { name: 'auto', title: 'Label colour — follows the theme ink', hex: '', swatch: 'var(--color-ink)' },
  { name: 'blue', title: 'Label colour — blue', hex: '#2a78d6', swatch: '#2a78d6' },
  { name: 'orange', title: 'Label colour — orange', hex: '#d95926', swatch: '#d95926' },
  { name: 'green', title: 'Label colour — green', hex: '#0ca30c', swatch: '#0ca30c' },
]

/** High-contrast engineering palette when multiple bar diameters exist in a section. */
const DIAMETER_PALETTE = [
  'var(--color-capacity)',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#0284c7',
  '#db2777',
]

/** Hover text of a bar: coordinates, diameter, layer/bundle info and its cover audit result. */
function barTooltip(i: number, b: Rebar, st: BarCoverStatus | null | undefined): string {
  const layerStr = b.layer != null ? ` · L${b.layer + 1}` : ''
  const bundleStr = bundleIdOf(b) ? ' · bundled' : ''
  const head = `bar ${i + 1} — (${b.x}, ${b.y}) ⌀${b.dia}${layerStr}${bundleStr}`
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
  spacers,
}: {
  geometry: SectionGeometry
  bars: Rebar[]
  props: SectionProperties | null
  na?: NAInfo | null
  /** Per-face nominal cover; draws the cover envelope when supplied. */
  cover?: CoverAudit extends never ? never : CoverSpec | null
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
  /** Transverse spacer bars between multi-layer rectangular reinforcement stacks. */
  spacers?: RectSpacerBar[] | null
}) {
  const [showLabels, setShowLabels] = useState(true)
  const [fontSize, setFontSize] = useState(11)
  /* '' = the theme ink; any other value is the hex the swatches and the
     colour picker write */
  const [labelColor, setLabelColor] = useState('')
  const labelInk = labelColor || 'var(--color-ink)'
  const [showNA, setShowNA] = useState(true)
  const [showCover, setShowCover] = useState(true)
  const [showSpacers, setShowSpacers] = useState(true)
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)
  const [pinnedBar, setPinnedBar] = useState<number | null>(null)
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
  const bundles = analyseBundles(bars)
  const uniqueDias = [...new Set(bars.map((b) => b.dia))].sort((a, b) => b - a)
  const multiDiameter = uniqueDias.length > 1
  const diaColorMap = new Map<number, string>(
    uniqueDias.map((d, idx) => [d, DIAMETER_PALETTE[idx % DIAMETER_PALETTE.length]]),
  )
  const maxLayer = bars.reduce((m, b) => Math.max(m, b.layer ?? 0), 0)
  const rawInspected = pinnedBar ?? hoveredBar
  const inspectedIdx = rawInspected !== null && rawInspected >= 0 && rawInspected < bars.length ? rawInspected : null
  const inspectedBar = inspectedIdx !== null ? bars[inspectedIdx] : null

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
          {spacers && spacers.length > 0 && (
            <Check
              checked={showSpacers}
              onChange={setShowSpacers}
              label="Spacers"
              title="Show transverse spacer bars separating reinforcement layers"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={chipGroupCls} title="Label font size">
            <button
              className="grid h-[18px] w-[19px] place-items-center rounded text-[0.625rem] font-semibold text-ink-2 transition-colors duration-150 hover:bg-panel hover:text-accent"
              aria-label="Smaller labels"
              onClick={() => setFontSize((v) => Math.max(8, v - 1))}
            >
              A−
            </button>
            <span className="w-5 text-center text-[0.65625rem] text-ink-3 tnum">{fontSize}</span>
            <button
              className="grid h-[18px] w-[19px] place-items-center rounded text-[0.6875rem] font-semibold text-ink-2 transition-colors duration-150 hover:bg-panel hover:text-accent"
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
                title={c.title}
                className="h-[13px] w-[13px] rounded-full border border-edge transition-transform duration-150 hover:scale-110"
                style={{
                  background: c.swatch,
                  outline: labelColor === c.hex ? '2px solid var(--color-accent)' : 'none',
                  outlineOffset: '1px',
                }}
                onClick={() => setLabelColor(c.hex)}
              />
            ))}
            <input
              type="color"
              value={labelColor || '#17222c'}
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
              fill={labelInk}
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
              stroke="var(--color-card)"
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
                stroke="var(--color-card)"
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
              <text x={cx + 6} y={cy + 16} fontSize={fontSize} fontFamily={FONT} fontWeight="600" fill={labelInk}>
                G ({fmtN(props.cx, 0)}, {fmtN(props.cy, 0)})
              </text>
            )}
          </g>
        )}

        {/* Transverse spacer bars between reinforcement layers */}
        {spacers && showSpacers && spacers.length > 0 && (
          <g data-testid="spacer-bars-group">
            {spacers.map((sp) => {
              const sw = Math.max(2, sp.dia * scale)
              return (
                <g key={sp.id} data-spacer={sp.id}>
                  <line
                    x1={X(sp.x1)}
                    y1={Y(sp.y1)}
                    x2={X(sp.x2)}
                    y2={Y(sp.y2)}
                    stroke="var(--color-ink-3)"
                    strokeWidth={sw}
                    strokeLinecap="round"
                    opacity={0.34}
                  >
                    <title>{`Spacer bar (${FACE_LABELS[sp.face]} L${sp.fromLayer + 1}–L${sp.toLayer + 1}) — ⌀${sp.dia} mm · clear gap ${sp.clearGap.toFixed(1)} mm`}</title>
                  </line>
                  <line
                    x1={X(sp.x1)}
                    y1={Y(sp.y1)}
                    x2={X(sp.x2)}
                    y2={Y(sp.y2)}
                    stroke="var(--color-ink-2)"
                    strokeWidth={1.1}
                    strokeDasharray="5 3"
                    pointerEvents="none"
                  />
                </g>
              )
            })}
          </g>
        )}

        {/* Bundle group halo envelopes */}
        {bundles.length > 0 && (
          <g data-testid="bundle-halos-group">
            {bundles.map((bundle) => {
              const haloR = Math.max(4.5, (bundle.envelope / 2) * scale + 2.2)
              return (
                <circle
                  key={bundle.id}
                  data-bundle={bundle.id}
                  cx={X(bundle.cx)}
                  cy={Y(bundle.cy)}
                  r={haloR}
                  fill="var(--color-accent)"
                  fillOpacity={0.09}
                  stroke="var(--color-accent)"
                  strokeWidth={1.1}
                  strokeDasharray="3 2"
                >
                  <title>{`Bundle (${bundle.bars.length} bars: ⌀${bundle.dias.join('+')} · ⌀eq = ${bundle.eqDia.toFixed(1)} mm · centroid (${bundle.cx.toFixed(1)}, ${bundle.cy.toFixed(1)}))`}</title>
                </circle>
              )
            })}
          </g>
        )}

        {bars.map((b, i) => {
          const r = Math.max(2.2, (b.dia / 2) * scale)
          const st = audit?.bars[i] ?? null
          const bad = st !== null && !st.ok
          const clash = !!overlapping?.has(i)
          const isInspected = inspectedIdx === i
          const diaFill = multiDiameter ? diaColorMap.get(b.dia) : undefined
          const innerLayer = maxLayer > 0 && (b.layer ?? 0) > 0
          return (
            <g
              key={i}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredBar(i)}
              onMouseLeave={() => setHoveredBar((cur) => (cur === i ? null : cur))}
              onClick={() => setPinnedBar((cur) => (cur === i ? null : i))}
            >
              {isInspected && (
                <circle
                  cx={X(b.x)}
                  cy={Y(b.y)}
                  r={r + 3.5}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.8}
                  data-inspected="true"
                />
              )}
              <circle
                cx={X(b.x)}
                cy={Y(b.y)}
                r={r}
                className={clash || diaFill ? undefined : 'fill-capacity'}
                fill={clash ? 'var(--color-bad)' : diaFill}
                fillOpacity={clash ? 0.78 : undefined}
                stroke={clash ? '#8f1d1d' : bad ? 'var(--color-bad)' : 'none'}
                strokeWidth={clash ? 1.2 : bad ? 1.6 : 0}
                data-overlap={clash ? 'true' : undefined}
                data-bar-index={i + 1}
                data-bar-dia={b.dia}
              >
                <title>{`${barTooltip(i, b, st)}${clash ? ' — OVERLAPS another bar' : ''}`}</title>
              </circle>
              {innerLayer && !clash && (
                <circle
                  cx={X(b.x)}
                  cy={Y(b.y)}
                  r={Math.max(1.1, r * 0.34)}
                  fill="var(--color-card)"
                  pointerEvents="none"
                  data-inner-layer={b.layer}
                />
              )}
              {showLabels && (
                <text
                  x={X(b.x) + r + 2}
                  y={Y(b.y) - r - 1}
                  fontSize={fontSize}
                  fontFamily={FONT}
                  fill={labelInk}
                >
                  {i + 1}
                </text>
              )}
            </g>
          )
        })}
      </ZoomableSvg>

      {/* Bar diameter / bundle / layer visual key when varied reinforcement is active */}
      {(multiDiameter || bundles.length > 0 || (spacers && spacers.length > 0)) && (
        <div
          data-testid="reinforcement-visual-key"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field border border-line bg-panel/45 px-2 py-1 text-[0.65625rem] text-ink-2"
        >
          {uniqueDias.map((d) => {
            const count = bars.filter((b) => b.dia === d).length
            return (
              <span key={d} className="inline-flex items-center gap-1 font-mono tnum">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: diaColorMap.get(d) ?? 'var(--color-capacity)' }}
                />
                <span>
                  ⌀{d} × {count}
                </span>
              </span>
            )
          })}
          {bundles.length > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-ink-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-accent bg-accent/15"
              />
              <span>{bundles.length} bundle{bundles.length === 1 ? '' : 's'}</span>
            </span>
          )}
          {maxLayer > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-ink-2">
              <span aria-hidden="true" className="grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full bg-capacity">
                <span className="h-1 w-1 rounded-full bg-card" />
              </span>
              <span>{maxLayer + 1} layers</span>
            </span>
          )}
          {spacers && spacers.length > 0 && showSpacers && (
            <span className="inline-flex items-center gap-1 font-mono text-ink-2">
              <span aria-hidden="true" className="h-1 w-3.5 shrink-0 rounded bg-ink-3/60" />
              <span>{spacers.length} spacer{spacers.length === 1 ? '' : 's'} (⌀{spacers[0].dia})</span>
            </span>
          )}
        </div>
      )}

      {/* Interactive bar-coordinate inspector */}
      {inspectedBar && inspectedIdx !== null && (
        <div
          data-testid="bar-inspector"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-field border border-accent/35 bg-accent-wash/50 px-2.5 py-1 text-[0.6875rem] text-ink"
        >
          <span className="font-mono tnum">
            <b>Bar #{inspectedIdx + 1}</b> · X = <b>{inspectedBar.x}</b> mm, Y = <b>{inspectedBar.y}</b> mm · ⌀
            <b>{inspectedBar.dia}</b> mm (As {fmtN(barArea(inspectedBar.dia), 1)} mm²)
            {inspectedBar.face ? ` · ${FACE_LABELS[inspectedBar.face]}` : ''}
            {inspectedBar.layer != null ? ` · Layer ${inspectedBar.layer + 1}` : ''}
            {bundleIdOf(inspectedBar) ? ' · Bundle' : ''}
          </span>
          {pinnedBar !== null && (
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => setPinnedBar(null)}
            >
              Unpin
            </button>
          )}
        </div>
      )}

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
