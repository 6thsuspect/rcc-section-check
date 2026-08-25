import { useMemo, useState } from 'react'
import type { CaseResult, InteractionSurface, LoadCase } from '../engine/types'
import { contourAtP, pmCurve } from '../engine/surface'
import { niceTicks, ZoomableSvg } from './ui'
import { fmtN } from '../state'

const FONT = "Bahnschrift, 'Avenir Next', 'Segoe UI', sans-serif"

/** P–M interaction diagram in the moment direction of the selected case. */
export function PMChart({
  surface,
  cases,
  selected,
}: {
  surface: InteractionSurface
  cases: LoadCase[]
  selected: LoadCase | null
}) {
  const W = 520
  const H = 400
  const L = 64
  const R = 16
  const T = 18
  const B = 44

  const thetaM = selected ? Math.atan2(selected.Muy, selected.Mux) : 0
  const curve = useMemo(() => pmCurve(surface, thetaM), [surface, thetaM])

  const Mmax = Math.max(1, ...curve.map((p) => p.M / 1e6), ...cases.map((c) => Math.hypot(c.Mux, c.Muy)))
  const Pmax = surface.Puz / 1e3
  const Pmin = Math.min(surface.Pt / 1e3, 0)
  const sx = (M: number) => L + ((W - L - R) * M) / (Mmax * 1.06)
  const sy = (P: number) => T + ((H - T - B) * (Pmax * 1.04 - P)) / (Pmax * 1.04 - Pmin * 1.1)

  const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.M / 1e6).toFixed(1)} ${sy(p.P / 1e3).toFixed(1)}`).join(' ')
  const xTicks = niceTicks(0, Mmax, 5)
  const yTicks = niceTicks(Pmin, Pmax, 6)

  const [hover, setHover] = useState<{ P: number; M: number } | null>(null)

  const onContentMove = (pt: { x: number; y: number }) => {
    const P = Pmax * 1.04 - ((pt.y - T) * (Pmax * 1.04 - Pmin * 1.1)) / (H - T - B)
    if (P * 1e3 > surface.Puz || P * 1e3 < surface.Pt) return setHover(null)
    let M = 0
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1]
      const b = curve[i]
      if ((a.P <= P * 1e3 && b.P >= P * 1e3) || (b.P <= P * 1e3 && a.P >= P * 1e3)) {
        const t = b.P === a.P ? 0 : (P * 1e3 - a.P) / (b.P - a.P)
        M = (a.M + t * (b.M - a.M)) / 1e6
        break
      }
    }
    setHover({ P, M })
  }

  return (
    <div className="relative">
      <ZoomableSvg
        W={W}
        H={H}
        id="fig-pm"
        ariaLabel="P–M interaction diagram with load cases"
        onContentMove={onContentMove}
        onContentLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={L} y1={sy(t)} x2={W - R} y2={sy(t)} className={t === 0 ? 'stroke-edge-strong' : 'stroke-edge'} strokeWidth={t === 0 ? 1.4 : 1} />
            <text x={L - 6} y={sy(t) + 3.5} textAnchor="end" fontSize="10.5" fontFamily={FONT} className="fill-ink-3 tnum">{fmtN(t, 0)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} y1={T} x2={sx(t)} y2={H - B} className="stroke-edge" strokeWidth="1" />
            <text x={sx(t)} y={H - B + 14} textAnchor="middle" fontSize="10.5" fontFamily={FONT} className="fill-ink-3 tnum">{fmtN(t, 0)}</text>
          </g>
        ))}
        <line x1={L} y1={T} x2={L} y2={H - B} className="stroke-edge-strong" strokeWidth="1.4" />
        <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" fontSize="11.5" fontFamily={FONT} className="fill-ink-2">
          {selected ? `M along case direction θ = ${fmtN((thetaM * 180) / Math.PI, 0)}° (kN·m)` : 'M (kN·m)'}
        </text>
        <text transform={`rotate(-90 14 ${(T + H - B) / 2})`} x={14} y={(T + H - B) / 2} textAnchor="middle" fontSize="11.5" fontFamily={FONT} className="fill-ink-2">
          P (kN), compression +
        </text>

        <path d={path} fill="none" className="stroke-capacity" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

        {cases.map((c) => {
          const M = Math.hypot(c.Mux, c.Muy)
          const isSel = selected?.id === c.id
          return (
            <g key={c.id}>
              <circle cx={sx(M)} cy={sy(c.Pu)} r={isSel ? 5.5 : 4} className={isSel ? 'fill-demand' : 'fill-paper stroke-demand'} strokeWidth="2">
                <title>{`${c.name}: P = ${c.Pu} kN, M = ${fmtN(M)} kN·m`}</title>
              </circle>
              {isSel && (
                <text x={sx(M)} y={sy(c.Pu) - 9} textAnchor="middle" fontSize="10.5" fontFamily={FONT} className="fill-ink">{c.name}</text>
              )}
            </g>
          )
        })}

        {hover && (
          <g pointerEvents="none">
            <line x1={L} y1={sy(hover.P)} x2={W - R} y2={sy(hover.P)} className="stroke-demand" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={sx(hover.M)} cy={sy(hover.P)} r={3.5} className="fill-paper stroke-capacity" strokeWidth="2" />
          </g>
        )}
      </ZoomableSvg>
      {hover && (
        <div className="absolute top-1 left-2 bg-card border border-edge rounded px-2 py-1 text-[11px] tnum text-ink-2 pointer-events-none">
          P = {fmtN(hover.P, 0)} kN → MRd = {fmtN(hover.M, 0)} kN·m
        </div>
      )}
    </div>
  )
}

/** Mx–My capacity contour at the selected case's axial load. */
export function ContourChart({
  surface,
  result,
}: {
  surface: InteractionSurface
  result: CaseResult | null
}) {
  const W = 460
  const H = 420
  const CX = W / 2 + 10
  const CY = (H - 30) / 2 + 6

  const lc = result?.loadCase ?? null
  const P = lc ? lc.Pu * 1e3 : 0
  const contour = useMemo(
    () => (lc && P <= surface.Puz && P >= surface.Pt ? contourAtP(surface, P) : null),
    [surface, lc, P],
  )
  if (!lc) return <div className="text-sm text-ink-3 p-4">Select a load case to draw its Mx–My contour.</div>
  if (!contour) return <div className="text-sm text-bad p-4">Axial load outside the section's axial range — no moment contour exists at P = {lc.Pu} kN.</div>

  const Mext = Math.max(
    1,
    ...contour.map((p) => Math.max(Math.abs(p.Mx), Math.abs(p.My)) / 1e6),
    Math.abs(lc.Mux),
    Math.abs(lc.Muy),
  )
  const s = (W / 2 - 58) / Mext
  const X = (Mx: number) => CX + Mx * s
  const Y = (My: number) => CY - My * s

  const pts = contour.map((p) => `${X(p.Mx / 1e6).toFixed(1)},${Y(p.My / 1e6).toFixed(1)}`).join(' ')
  const ticks = niceTicks(-Mext, Mext, 5).filter((t) => t !== 0)

  return (
    <ZoomableSvg W={W} H={H} id="fig-contour" ariaLabel="Mx–My capacity contour with the demand point">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t)} y1={CY - 3} x2={X(t)} y2={CY + 3} className="stroke-edge-strong" strokeWidth="1" />
          <line x1={CX - 3} y1={Y(t)} x2={CX + 3} y2={Y(t)} className="stroke-edge-strong" strokeWidth="1" />
          <text x={X(t)} y={CY + 14} textAnchor="middle" fontSize="9.5" fontFamily={FONT} className="fill-ink-3 tnum">{fmtN(t, 0)}</text>
        </g>
      ))}
      <line x1={30} y1={CY} x2={W - 16} y2={CY} className="stroke-edge-strong" strokeWidth="1.2" />
      <line x1={CX} y1={14} x2={CX} y2={H - 40} className="stroke-edge-strong" strokeWidth="1.2" />
      <text x={W - 16} y={CY - 6} textAnchor="end" fontSize="11" fontFamily={FONT} className="fill-ink-2">Mx (kN·m)</text>
      <text x={CX + 6} y={20} fontSize="11" fontFamily={FONT} className="fill-ink-2">My (kN·m)</text>

      <polygon points={pts} fill="none" className="stroke-capacity" strokeWidth="2.4" strokeLinejoin="round" />

      {/* demand ray and point */}
      {result && result.MEd > 0 && result.MRd > 0 && (
        <line
          x1={CX}
          y1={CY}
          x2={X((lc.Mux / result.MEd) * (result.MRd / 1e6))}
          y2={Y((lc.Muy / result.MEd) * (result.MRd / 1e6))}
          className="stroke-demand"
          strokeWidth="1.4"
          strokeDasharray="3 3"
        />
      )}
      <circle cx={X(lc.Mux)} cy={Y(lc.Muy)} r="5.5" className="fill-demand">
        <title>{`${lc.name}: (${lc.Mux}, ${lc.Muy}) kN·m`}</title>
      </circle>
      <text x={X(lc.Mux)} y={Y(lc.Muy) - 9} textAnchor="middle" fontSize="10.5" fontFamily={FONT} className="fill-ink">
        ({fmtN(lc.Mux, 0)}, {fmtN(lc.Muy, 0)})
      </text>
      <text x={30} y={H - 12} fontSize="11" fontFamily={FONT} className="fill-ink-2">
        Contour at P = {fmtN(lc.Pu, 0)} kN {result ? ` — U = ${fmtN(result.U, 2)}` : ''}
      </text>
    </ZoomableSvg>
  )
}
