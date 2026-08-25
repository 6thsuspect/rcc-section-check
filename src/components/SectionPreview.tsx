import { useId, useState } from 'react'
import type { Rebar, SectionGeometry, SectionProperties } from '../engine/types'
import { fmtN } from '../state'
import { ZoomableSvg } from './ui'

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

export interface NAInfo {
  /** NA orientation, rad (direction of the NA line). */
  theta: number
  /** Signed offset of the NA from the centroid along the compression normal, mm. */
  vna: number
  caption: string
}

export function SectionPreview({
  geometry,
  bars,
  props,
  na,
}: {
  geometry: SectionGeometry
  bars: Rebar[]
  props: SectionProperties | null
  na?: NAInfo | null
}) {
  const [showLabels, setShowLabels] = useState(true)
  const [fontSize, setFontSize] = useState(11)
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[1].hex)
  const [showNA, setShowNA] = useState(true)
  const clipId = useId()

  const xs = geometry.boundary.map((p) => p.x)
  const ys = geometry.boundary.map((p) => p.y)
  if (xs.length < 3) return <div className="text-sm text-ink-3 p-4">Enter at least 3 boundary vertices.</div>
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
  let naEls: { x1: number; y1: number; x2: number; y2: number; poly: string; lx: number; ly: number } | null = null
  if (na && props && showNA) {
    const d = { x: Math.cos(na.theta), y: Math.sin(na.theta) } // along the NA
    const n = { x: -Math.sin(na.theta), y: Math.cos(na.theta) } // toward compression
    const P0 = { x: props.cx + na.vna * n.x, y: props.cy + na.vna * n.y }
    const L = 2 * Math.max(xmax - xmin, ymax - ymin)
    const A = { x: P0.x - L * d.x, y: P0.y - L * d.y }
    const B = { x: P0.x + L * d.x, y: P0.y + L * d.y }
    const C = { x: B.x + L * n.x, y: B.y + L * n.y }
    const Dp = { x: A.x + L * n.x, y: A.y + L * n.y }
    naEls = {
      x1: X(A.x),
      y1: Y(A.y),
      x2: X(B.x),
      y2: Y(B.y),
      poly: [A, B, C, Dp].map((p) => `${X(p.x)},${Y(p.y)}`).join(' '),
      lx: X(P0.x + 0.15 * L * d.x + 6 / scale * n.x),
      ly: Y(P0.y + 0.15 * L * d.y) - 5,
    }
  }

  return (
    <div>
      {/* label & display controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2 text-[11.5px] text-ink-2">
        <label className="flex items-center gap-1.5 font-display font-semibold uppercase tracking-wide text-[10.5px]">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          Labels
        </label>
        <span className="flex items-center gap-1" title="Label font size">
          <button
            className="w-5 h-5 grid place-items-center border border-edge rounded text-[10px] hover:border-accent"
            aria-label="Smaller labels"
            onClick={() => setFontSize((s) => Math.max(8, s - 1))}
          >
            A−
          </button>
          <span className="tnum w-6 text-center">{fontSize}</span>
          <button
            className="w-5 h-5 grid place-items-center border border-edge rounded text-[12px] hover:border-accent"
            aria-label="Larger labels"
            onClick={() => setFontSize((s) => Math.min(20, s + 1))}
          >
            A+
          </button>
        </span>
        <span className="flex items-center gap-1" title="Label colour">
          {LABEL_COLORS.map((c) => (
            <button
              key={c.name}
              aria-label={`Label colour ${c.name}`}
              className="w-4 h-4 rounded-full border"
              style={{
                background: c.hex,
                borderColor: labelColor === c.hex ? '#17222c' : 'transparent',
                outline: labelColor === c.hex ? '2px solid var(--color-accent)' : 'none',
              }}
              onClick={() => setLabelColor(c.hex)}
            />
          ))}
          <input
            type="color"
            value={labelColor}
            aria-label="Custom label colour"
            className="w-5 h-5 p-0 border border-edge rounded cursor-pointer"
            onChange={(e) => setLabelColor(e.target.value)}
          />
        </span>
        {na && (
          <label className="flex items-center gap-1.5 font-display font-semibold uppercase tracking-wide text-[10.5px]">
            <input type="checkbox" checked={showNA} onChange={(e) => setShowNA(e.target.checked)} />
            Neutral axis
          </label>
        )}
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
          return (
            <g key={i}>
              <circle cx={X(b.x)} cy={Y(b.y)} r={r} className="fill-capacity">
                <title>{`bar ${i + 1} — (${b.x}, ${b.y}) ⌀${b.dia}`}</title>
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

      {na && showNA && <p className="text-[11px] text-ink-3 mt-1.5">{na.caption} — shaded side is in compression.</p>}

      {props && (
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 mt-2 text-[12px] text-ink-2 tnum">
          <span>Ag = {fmtN(props.area / 1e3, 1)}×10³ mm²</span>
          <span>Asc = {fmtN(props.Asc, 0)} mm² ({fmtN(props.p, 2)}%)</span>
          <span>{props.barCount} bars</span>
          <span>Ixx = {fmtN(props.Ixx / 1e6, 0)}×10⁶ mm⁴</span>
          <span>Iyy = {fmtN(props.Iyy / 1e6, 0)}×10⁶ mm⁴</span>
          <span>G = ({fmtN(props.cx, 0)}, {fmtN(props.cy, 0)})</span>
        </div>
      )}
    </div>
  )
}
