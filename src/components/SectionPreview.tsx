import { useId, useMemo, useState } from 'react'
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
  /** Depth of NA from extreme compression fibre, mm. */
  xu?: number | null
  /** Limiting NA depth xu,max, mm. */
  xuMax?: number | null
  /** Extreme compression fibre point (user coords). */
  extremeComp?: { x: number; y: number }
  /** NA point along the same normal as extremeComp (user coords). */
  naPoint?: { x: number; y: number }
  /** Unit compression normal (toward compressed side). */
  normal?: { x: number; y: number }
  /** Under / over-reinforced classification. */
  classification?: string
}

export function SectionPreview({
  geometry,
  bars,
  props,
  na,
  cover,
  audit,
  radialCoverOnly = false,
  overlappingBarIndices,
  activeFace,
  onHoverFace,
  onSelectFace,
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
  /** 0-based indices of bars whose solids overlap — drawn filled red. */
  overlappingBarIndices?: number[] | null
  activeFace?: ActiveFace | null
  onHoverFace?: (face: ActiveFace | null) => void
  onSelectFace?: (face: ActiveFace | null) => void
}) {
  const overlapSet = useMemo(
    () => new Set(overlappingBarIndices ?? []),
    [overlappingBarIndices],
  )
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
  const scale = Math.min((W - 2 * PAD) / Math.max(1, xmax - xmin), (H - 2 * PAD) / Math.max(1, ymax - ymin))
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
  type XuDim = {
    /** Outside dimension line (extreme compression fibre → NA), screen coords. */
    x1: number
    y1: number
    x2: number
    y2: number
    /** Extension lines from the section points out to the dimension line. */
    ext1: { x1: number; y1: number; x2: number; y2: number }
    ext2: { x1: number; y1: number; x2: number; y2: number }
    mx: number
    my: number
    label: string
    labelAnchor: 'start' | 'middle' | 'end'
    tick1a: { x: number; y: number }
    tick1b: { x: number; y: number }
    tick2a: { x: number; y: number }
    tick2b: { x: number; y: number }
  }
  let naEls: {
    x1: number
    y1: number
    x2: number
    y2: number
    poly: string
    lx: number
    ly: number
    dim?: XuDim
  } | null = null
  if (na && props && showNA) {
    const d = { x: Math.cos(na.theta), y: Math.sin(na.theta) }
    const n = { x: -Math.sin(na.theta), y: Math.cos(na.theta) }
    const P0 = { x: props.cx + na.vna * n.x, y: props.cy + na.vna * n.y }
    const L = 2 * Math.max(xmax - xmin, ymax - ymin)
    const A = { x: P0.x - L * d.x, y: P0.y - L * d.y }
    const B = { x: P0.x + L * d.x, y: P0.y + L * d.y }
    const C = { x: B.x + L * n.x, y: B.y + L * n.y }
    const Dp = { x: A.x + L * n.x, y: A.y + L * n.y }

    /**
     * Place the xu dimension **outside** the concrete outline:
     * offset extreme-fibre and NA points along ±d (parallel to the NA) past
     * the section bbox, pick the nearer clear side, and draw extension lines
     * back to the true section points. Works for any shape / NA orientation.
     */
    let dim: XuDim | undefined
    if (
      na.xu != null &&
      Number.isFinite(na.xu) &&
      na.xu > 0 &&
      na.extremeComp &&
      na.naPoint
    ) {
      const E = na.extremeComp
      const Np = na.naPoint

      // Section extent along the NA direction d
      let dMin = Infinity
      let dMax = -Infinity
      for (const p of geometry.boundary) {
        const pr = p.x * d.x + p.y * d.y
        if (pr < dMin) dMin = pr
        if (pr > dMax) dMax = pr
      }
      // Clearance past the bbox edge, in mm (scale-aware: ~26–32 px on screen)
      const marginMm = Math.max(26 / scale, 0.04 * Math.max(xmax - xmin, ymax - ymin, 1))
      const pProj = E.x * d.x + E.y * d.y
      const outPlus = dMax - pProj + marginMm
      const outMinus = pProj - dMin + marginMm

      // Prefer the side that needs less travel; break ties toward the side with
      // more remaining SVG padding (so the label stays inside the figure).
      const midScreenX = (X(E.x) + X(Np.x)) / 2
      const midScreenY = (Y(E.y) + Y(Np.y)) / 2
      // Screen-space direction of +d (Y is flipped in SVG)
      const dSx = d.x * scale
      const dSy = -d.y * scale
      const roomPlus =
        (dSx >= 0 ? W - midScreenX : midScreenX) * Math.abs(dSx) +
        (dSy >= 0 ? H - midScreenY : midScreenY) * Math.abs(dSy)
      const roomMinus =
        (-dSx >= 0 ? W - midScreenX : midScreenX) * Math.abs(dSx) +
        (-dSy >= 0 ? H - midScreenY : midScreenY) * Math.abs(dSy)

      let side = 1
      let out = Math.max(outPlus, marginMm)
      if (outMinus < outPlus - 1e-9 || (Math.abs(outMinus - outPlus) < 1e-9 && roomMinus > roomPlus)) {
        side = -1
        out = Math.max(outMinus, marginMm)
      } else if (roomMinus > roomPlus * 1.4 && outMinus < outPlus * 1.25) {
        // Plenty more figure room on the minus side — use it even if slightly farther
        side = -1
        out = Math.max(outMinus, marginMm)
      }

      const Eo = { x: E.x + side * out * d.x, y: E.y + side * out * d.y }
      const No = { x: Np.x + side * out * d.x, y: Np.y + side * out * d.y }

      // Tick marks parallel to the NA (along d)
      const tLen = 5 / scale
      // Label sits further outside the dimension line
      const labelPush = 14 / scale
      let lx = (Eo.x + No.x) / 2 + side * labelPush * d.x
      let ly = (Eo.y + No.y) / 2 + side * labelPush * d.y

      // Keep the label inside the SVG frame
      let mx = X(lx)
      let my = Y(ly)
      const labelPad = 8
      mx = Math.min(W - labelPad, Math.max(labelPad, mx))
      my = Math.min(H - labelPad, Math.max(labelPad + fontSize, my))

      // Anchor: push text away from the section along screen-space outward direction
      const outSx = side * dSx
      const outSy = side * dSy
      let labelAnchor: 'start' | 'middle' | 'end' = 'middle'
      if (Math.abs(outSx) >= Math.abs(outSy)) {
        labelAnchor = outSx >= 0 ? 'start' : 'end'
        my -= 2
      } else {
        labelAnchor = 'middle'
        my += outSy >= 0 ? fontSize * 0.35 : -fontSize * 0.15
      }

      dim = {
        x1: X(Eo.x),
        y1: Y(Eo.y),
        x2: X(No.x),
        y2: Y(No.y),
        ext1: { x1: X(E.x), y1: Y(E.y), x2: X(Eo.x), y2: Y(Eo.y) },
        ext2: { x1: X(Np.x), y1: Y(Np.y), x2: X(No.x), y2: Y(No.y) },
        mx,
        my,
        label: `xu = ${na.xu.toFixed(1)} mm`,
        labelAnchor,
        tick1a: { x: X(Eo.x - tLen * d.x), y: Y(Eo.y - tLen * d.y) },
        tick1b: { x: X(Eo.x + tLen * d.x), y: Y(Eo.y + tLen * d.y) },
        tick2a: { x: X(No.x - tLen * d.x), y: Y(No.y - tLen * d.y) },
        tick2b: { x: X(No.x + tLen * d.x), y: Y(No.y + tLen * d.y) },
      }
    }

    // "NA" tag: park it outside the section along ±d at the NA line
    let naTagSide = 1
    {
      let dMin = Infinity
      let dMax = -Infinity
      for (const p of geometry.boundary) {
        const pr = p.x * d.x + p.y * d.y
        if (pr < dMin) dMin = pr
        if (pr > dMax) dMax = pr
      }
      const p0p = P0.x * d.x + P0.y * d.y
      const marginMm = Math.max(18 / scale, 0.03 * Math.max(xmax - xmin, ymax - ymin, 1))
      const outP = dMax - p0p + marginMm
      const outM = p0p - dMin + marginMm
      naTagSide = outM < outP ? -1 : 1
      const tagOut = Math.max(naTagSide > 0 ? outP : outM, marginMm)
      const tag = {
        x: P0.x + naTagSide * tagOut * d.x,
        y: P0.y + naTagSide * tagOut * d.y,
      }
      naEls = {
        x1: X(A.x),
        y1: Y(A.y),
        x2: X(B.x),
        y2: Y(B.y),
        poly: [A, B, C, Dp].map((p) => `${X(p.x)},${Y(p.y)}`).join(' '),
        lx: Math.min(W - 6, Math.max(6, X(tag.x))),
        ly: Math.min(H - 4, Math.max(fontSize + 2, Y(tag.y))),
        dim,
      }
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
            <text x={naEls.lx} y={naEls.ly} fontSize={fontSize} fontFamily={FONT} fontWeight="600" fill={labelColor}>
              NA
            </text>
            {naEls.dim && (
              <g>
                {/* Extension lines from section points out to the exterior dimension */}
                <line
                  x1={naEls.dim.ext1.x1}
                  y1={naEls.dim.ext1.y1}
                  x2={naEls.dim.ext1.x2}
                  y2={naEls.dim.ext1.y2}
                  stroke="var(--color-demand)"
                  strokeWidth="0.9"
                  strokeDasharray="3 2"
                  opacity="0.85"
                />
                <line
                  x1={naEls.dim.ext2.x1}
                  y1={naEls.dim.ext2.y1}
                  x2={naEls.dim.ext2.x2}
                  y2={naEls.dim.ext2.y2}
                  stroke="var(--color-demand)"
                  strokeWidth="0.9"
                  strokeDasharray="3 2"
                  opacity="0.85"
                />
                {/* xu depth dimension — outside the concrete outline */}
                <line
                  x1={naEls.dim.x1}
                  y1={naEls.dim.y1}
                  x2={naEls.dim.x2}
                  y2={naEls.dim.y2}
                  stroke="var(--color-demand)"
                  strokeWidth="1.5"
                />
                <line
                  x1={naEls.dim.tick1a.x}
                  y1={naEls.dim.tick1a.y}
                  x2={naEls.dim.tick1b.x}
                  y2={naEls.dim.tick1b.y}
                  stroke="var(--color-demand)"
                  strokeWidth="1.5"
                />
                <line
                  x1={naEls.dim.tick2a.x}
                  y1={naEls.dim.tick2a.y}
                  x2={naEls.dim.tick2b.x}
                  y2={naEls.dim.tick2b.y}
                  stroke="var(--color-demand)"
                  strokeWidth="1.5"
                />
                <circle cx={naEls.dim.x1} cy={naEls.dim.y1} r={2.2} fill="var(--color-demand)" />
                <circle cx={naEls.dim.x2} cy={naEls.dim.y2} r={2.2} fill="var(--color-demand)" />
                {/* Markers on the actual extreme fibre and NA (inside section) */}
                <circle
                  cx={naEls.dim.ext1.x1}
                  cy={naEls.dim.ext1.y1}
                  r={2}
                  fill="none"
                  stroke="var(--color-demand)"
                  strokeWidth="1.2"
                />
                <circle
                  cx={naEls.dim.ext2.x1}
                  cy={naEls.dim.ext2.y1}
                  r={2}
                  fill="none"
                  stroke="var(--color-demand)"
                  strokeWidth="1.2"
                />
                <text
                  x={naEls.dim.mx}
                  y={naEls.dim.my}
                  fontSize={Math.max(10, fontSize)}
                  fontFamily={FONT}
                  fontWeight="700"
                  fill="var(--color-demand)"
                  textAnchor={naEls.dim.labelAnchor}
                  paintOrder="stroke"
                  stroke="var(--color-paper)"
                  strokeWidth="3"
                  strokeLinejoin="round"
                >
                  {naEls.dim.label}
                </text>
              </g>
            )}
          </g>
        )}

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
          const coverShort = st !== null && !st.ok
          const overlaps = overlapSet.has(i)
          const bad = coverShort || overlaps
          return (
            <g key={i}>
              <circle
                cx={X(b.x)}
                cy={Y(b.y)}
                r={r}
                fill={overlaps ? 'var(--color-bad)' : undefined}
                className={overlaps ? undefined : 'fill-capacity'}
                stroke={bad ? 'var(--color-bad)' : 'none'}
                strokeWidth={bad ? (overlaps ? 2 : 1.6) : 0}
              >
                <title>
                  {overlaps
                    ? `${barTooltip(i, b, st)} — OVERLAP`
                    : barTooltip(i, b, st)}
                </title>
              </circle>
              {showLabels && (
                <text
                  x={X(b.x) + r + 2}
                  y={Y(b.y) - r - 1}
                  fontSize={fontSize}
                  fontFamily={FONT}
                  fill={overlaps ? 'var(--color-bad)' : labelColor}
                  fontWeight={overlaps ? 700 : undefined}
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
        {overlapSet.size > 0 && (
          <p className={`${noteSmCls} flex items-start gap-1.5`}>
            <span
              aria-hidden="true"
              className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-bad"
            />
            <span className="font-semibold text-bad">
              {overlapSet.size} bar(s) overlap / intersect — filled red on the figure. Adjust bundle
              spacing or diameters until solids no longer cross.
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
          {na && showNA && na.xu != null && Number.isFinite(na.xu) && (
            <>
              <Readout
                label="xu (from ext. comp.)"
                value={`${fmtN(na.xu, 1)} mm`}
                title="Depth of the neutral axis measured from the extreme compression fibre along the compression normal"
                className="font-semibold text-demand"
              />
              {na.xuMax != null && (
                <Readout
                  label="xu,max = k·d"
                  value={`${fmtN(na.xuMax, 1)} mm`}
                  title="Limiting neutral-axis depth for the tension-controlled (under-reinforced) limit"
                />
              )}
              {na.classification && (
                <Readout
                  label="Section class"
                  value={
                    na.classification === 'under-reinforced'
                      ? 'Under-reinforced'
                      : na.classification === 'over-reinforced'
                        ? 'Over-reinforced'
                        : na.classification
                  }
                  title="xu ≤ xu,max → under-reinforced (tension failure); xu > xu,max → over-reinforced (compression failure)"
                  className={
                    na.classification === 'under-reinforced'
                      ? 'font-semibold text-ok'
                      : na.classification === 'over-reinforced'
                        ? 'font-semibold text-bad'
                        : ''
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
