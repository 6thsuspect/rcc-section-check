import type { CodeSpec } from './codes'
import { planeForces, rotateFrame, strainPlaneAt, type AnalysisModel, type RotatedFrame, type StrainPlane } from './integrator'
import { naForDirection } from './surface'
import type { InteractionSurface, LoadCase, SurfacePoint } from './types'

/**
 * Neutral-axis depth, limiting depth and flexural classification for one load
 * case (docs/05 strain compatibility, read-only use of the analysis kernel).
 *
 * The surface generator already sweeps the strain plane from pure tension to
 * pure compression for every NA orientation. Here the same sweep is solved
 * exactly for the case's axial load: along one orientation θ the sweep
 * parameter t is bisected until ΣF = Pu, and θ itself is refined until the
 * resisting moment vector points along the demand (Mux, Muy). Nothing in the
 * interaction surface or the case check is altered — this module only reads
 * the same strain planes and stress resultants.
 *
 *   xu      = distance from the extreme compression fibre to the NA, measured
 *             normal to the NA (for uniaxial bending: along the global axis)
 *   d       = extreme compression fibre → extreme tension bar
 *   xu,max  = (xu,max/d)·d from the selected code
 *   Mu      = moment of the stress resultants of that strain state
 */

export type ReinforcementClass = 'under' | 'over'

export interface NeutralAxisResult {
  caseId: string
  caseName: string
  /** NA orientation (direction of the NA line), rad. */
  theta: number
  /** Offsets along the compression normal n = (−sinθ, cosθ), from the centroid, mm. */
  vna: number
  vTop: number
  vBottom: number
  vSteel: number
  /** Actual NA depth from the extreme compression fibre, mm. */
  xu: number
  /** Effective depth to the extreme tension bar, mm. */
  d: number
  /** Overall section depth normal to the NA, mm. */
  h: number
  xuMaxRatio: number
  xuMax: number
  classification: ReinforcementClass
  /** Strain at the extreme compression fibre and at the extreme tension bar (compression +). */
  epsTop: number
  epsSteel: number
  /** Limiting tension-steel strain implied by xu,max (magnitude). */
  epsLimit: number
  /** Stress resultants of the solved strain state, N / N·mm. */
  state: SurfacePoint
  /** Moment of the solved state along the demand direction, N·mm. */
  MuState: number
  /** Design moment capacity — reported for an under-reinforced section only, N·mm. */
  Mu: number | null
  /** Resultant applied moment, N·mm. */
  MEd: number
  /** True when the NA falls outside the section (whole section in compression). */
  naOutside: boolean
  /** Human-readable measuring direction of xu. */
  axisLabel: string
}

export interface FlexureOptions {
  spec: CodeSpec
  fy: number
  /** Ultimate concrete strain of the code's stress block. */
  ecu: number
}

interface SolvedState {
  plane: StrainPlane
  forces: SurfacePoint
  frame: RotatedFrame
}

/** Bisect the strain sweep of one orientation until the axial resultant equals P. */
function solveAtP(model: AnalysisModel, theta: number, P: number): SolvedState | null {
  const frame = rotateFrame(model, theta)
  const at = (t: number) => {
    const plane = strainPlaneAt(frame, model, t)
    return { plane, forces: planeForces(model, frame, plane) }
  }
  let lo = 1e-6
  let hi = 1 - 1e-6
  const a = at(lo)
  const b = at(hi)
  if (P <= a.forces.P || P >= b.forces.P) return null
  let best = a
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2
    const m = at(mid)
    best = m
    if (m.forces.P < P) lo = mid
    else hi = mid
    if (Math.abs(m.forces.P - P) <= Math.max(1, Math.abs(P) * 1e-7)) break
  }
  return { ...best, frame }
}

/** Signed smallest difference a − b of two angles, in (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

function describeAxis(theta: number): string {
  const nx = -Math.sin(theta)
  const ny = Math.cos(theta)
  const tol = Math.sin((0.5 * Math.PI) / 180)
  if (Math.abs(nx) < tol) return `along global ${ny > 0 ? '−' : '+'}Y from the ${ny > 0 ? 'top (+Y)' : 'bottom (−Y)'} face — bending about X`
  if (Math.abs(ny) < tol) return `along global ${nx > 0 ? '−' : '+'}X from the ${nx > 0 ? 'right (+X)' : 'left (−X)'} face — bending about Y`
  const ang = (Math.atan2(-ny, -nx) * 180) / Math.PI
  return `normal to the inclined NA (${ang.toFixed(0)}° to global +X) — biaxial bending`
}

/**
 * Neutral-axis analysis of one load case. Returns null when the case has no
 * bending (MEd ≈ 0) or its axial load lies outside the section's axial range.
 */
export function neutralAxisAnalysis(
  model: AnalysisModel,
  surface: InteractionSurface,
  lc: LoadCase,
  opts: FlexureOptions,
): NeutralAxisResult | null {
  const P = lc.Pu * 1e3
  const Mx = lc.Mux * 1e6
  const My = lc.Muy * 1e6
  const MEd = Math.hypot(Mx, My)
  if (MEd < 1 || P >= surface.Puz || P <= surface.Pt) return null

  const phi = Math.atan2(My, Mx)
  const seed = naForDirection(surface, P, Mx, My)
  if (!seed) return null
  const step = (2 * Math.PI) / Math.max(4, surface.meridians.length)

  const g = (theta: number) => {
    const s = solveAtP(model, theta, P)
    if (!s) return null
    const m = Math.hypot(s.forces.Mx, s.forces.My)
    if (m < 1) return null
    return { s, err: angleDiff(Math.atan2(s.forces.My, s.forces.Mx), phi) }
  }

  // refine θ inside the meridian bracket so the resisting moment is co-linear with the demand
  let theta = seed.theta
  let sol = g(theta)
  if (!sol) return null
  if (Math.abs(sol.err) > 1e-6) {
    // the moment direction is monotone in θ but its sense depends on the frame,
    // so look for the sign change on either side of the seed meridian
    let bracket: { theta: number; v: NonNullable<ReturnType<typeof g>> } | null = null
    for (const t of [theta - step, theta + step]) {
      const other = g(t)
      if (other && Math.sign(other.err) !== Math.sign(sol.err) && Math.abs(other.err) < Math.PI / 2) {
        bracket = { theta: t, v: other }
        break
      }
    }
    if (bracket) {
      let lo = { theta, v: sol }
      let hi = bracket
      for (let k = 0; k < 30; k++) {
        const mid = (lo.theta + hi.theta) / 2
        const vm = g(mid)
        if (!vm) break
        if (Math.sign(vm.err) === Math.sign(lo.v.err)) lo = { theta: mid, v: vm }
        else hi = { theta: mid, v: vm }
        if (Math.abs(vm.err) < 1e-7) break
      }
      const pick = Math.abs(lo.v.err) <= Math.abs(hi.v.err) ? lo : hi
      theta = pick.theta
      sol = pick.v
    }
  }

  const { plane, forces, frame } = sol.s
  if (!(plane.b > 0)) return null
  const vna = -plane.a / plane.b
  const vTop = frame.vmax
  const vBottom = frame.vmin
  const h = vTop - vBottom
  // extreme tension bar; a layout with no bar below the top fibre falls back to the bottom fibre
  const vSteel = frame.barsV.length ? Math.min(...frame.barsV) : vBottom
  const d = vTop - vSteel > 1e-6 ? vTop - vSteel : h
  const xu = vTop - vna
  const xuMaxRatio = opts.spec.xuMaxRatio(opts.fy, opts.ecu)
  const xuMax = xuMaxRatio * d
  const classification: ReinforcementClass = xu <= xuMax * (1 + 1e-9) ? 'under' : 'over'
  const MuState = forces.Mx * Math.cos(phi) + forces.My * Math.sin(phi)

  return {
    caseId: lc.id,
    caseName: lc.name,
    theta,
    vna,
    vTop,
    vBottom,
    vSteel,
    xu,
    d,
    h,
    xuMaxRatio,
    xuMax,
    classification,
    epsTop: plane.a + plane.b * vTop,
    epsSteel: plane.a + plane.b * vSteel,
    epsLimit: opts.ecu * (1 / xuMaxRatio - 1),
    state: forces,
    MuState,
    Mu: classification === 'under' ? MuState : null,
    MEd,
    naOutside: vna < vBottom,
    axisLabel: describeAxis(theta),
  }
}
