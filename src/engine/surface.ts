import type {
  CaseResult,
  ContourPoint,
  InteractionSurface,
  LoadCase,
  MeshSettings,
  SurfaceSample,
} from './types'
import type { CodeSpec } from './codes'
import { planeForces, rotateFrame, strainPlaneAt, type AnalysisModel } from './integrator'

/**
 * Generate the full P–Mx–My surface: one meridian (pure tension → pure
 * compression sweep) per neutral-axis orientation. P is monotone along each
 * meridian, so any constant-P contour is a per-meridian interpolation.
 * Each sample also stores its strain plane (a, b) so the governing neutral
 * axis can be reconstructed for display.
 */
export function generateSurface(model: AnalysisModel, mesh: MeshSettings): InteractionSurface {
  const meridians = []
  for (let k = 0; k < mesh.nTheta; k++) {
    const theta = (2 * Math.PI * k) / mesh.nTheta
    const frame = rotateFrame(model, theta)
    const points: SurfaceSample[] = []
    for (let j = 0; j <= mesh.nDepth; j++) {
      const t = j / mesh.nDepth
      const plane = strainPlaneAt(frame, model, t)
      points.push({ ...planeForces(model, frame, plane), a: plane.a, b: plane.b })
    }
    // enforce monotone P (guards tiny numerical wiggles so interpolation stays valid)
    for (let j = 1; j < points.length; j++) {
      if (points[j].P < points[j - 1].P) points[j] = { ...points[j], P: points[j - 1].P }
    }
    meridians.push({ theta, points })
  }
  const frame0 = rotateFrame(model, 0)
  const Puz = planeForces(model, frame0, { a: model.conc.ec2, b: 0 }).P
  const Pt = planeForces(model, frame0, { a: -model.epsSteelLimit, b: 0 }).P
  return { meridians, Puz, Pt }
}

/** Constant-P slice: one point per meridian, by inverse interpolation on P. */
export function contourAtP(surface: InteractionSurface, P: number): ContourPoint[] | null {
  if (P > surface.Puz || P < surface.Pt) return null
  const out: ContourPoint[] = []
  for (const m of surface.meridians) {
    const pts = m.points
    let lo = 0
    let hi = pts.length - 1
    if (P <= pts[0].P) {
      out.push({ ...pts[0], theta: m.theta })
      continue
    }
    if (P >= pts[hi].P) {
      out.push({ ...pts[hi], theta: m.theta })
      continue
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].P <= P) lo = mid
      else hi = mid
    }
    const p1 = pts[lo]
    const p2 = pts[hi]
    const t = p2.P > p1.P ? (P - p1.P) / (p2.P - p1.P) : 0
    out.push({
      P,
      Mx: p1.Mx + t * (p2.Mx - p1.Mx),
      My: p1.My + t * (p2.My - p1.My),
      a: p1.a + t * (p2.a - p1.a),
      b: p1.b + t * (p2.b - p1.b),
      theta: m.theta,
    })
  }
  return out
}

/**
 * Strain plane of the capacity point at axial load P along the moment
 * direction (dx, dy) — the contour point whose moment vector best aligns
 * with the demand. Used to draw the governing neutral axis on the section.
 */
export function naForDirection(
  surface: InteractionSurface,
  P: number,
  dx: number,
  dy: number,
): ContourPoint | null {
  const contour = contourAtP(surface, P)
  if (!contour) return null
  const target = Math.atan2(dy, dx)
  let best: ContourPoint | null = null
  let bestDelta = Infinity
  for (const p of contour) {
    const m = Math.hypot(p.Mx, p.My)
    if (m < 1) continue
    let d = Math.abs(Math.atan2(p.My, p.Mx) - target)
    d = Math.min(d, 2 * Math.PI - d)
    if (d < bestDelta) {
      bestDelta = d
      best = p
    }
  }
  return best
}

/** Pure-bending (P = 0) moment capacities in both signs about each axis, N·mm. */
export function flexuralCapacity(surface: InteractionSurface): {
  MxPos: number
  MxNeg: number
  MyPos: number
  MyNeg: number
} | null {
  const c = contourAtP(surface, 0)
  if (!c) return null
  return {
    MxPos: rayCapacity(c, 1, 0),
    MxNeg: rayCapacity(c, -1, 0),
    MyPos: rayCapacity(c, 0, 1),
    MyNeg: rayCapacity(c, 0, -1),
  }
}

/** Distance from the origin to the contour along direction (dx, dy). */
export function rayCapacity(contour: { Mx: number; My: number }[], dx: number, dy: number): number {
  let best = 0
  const n = contour.length
  for (let i = 0; i < n; i++) {
    const q1 = contour[i]
    const q2 = contour[(i + 1) % n]
    const ex = q2.Mx - q1.Mx
    const ey = q2.My - q1.My
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-12) continue
    const r = (q1.Mx * ey - q1.My * ex) / den
    const s = Math.abs(dx) > Math.abs(dy) ? (r * dx - q1.Mx) / ex : (r * dy - q1.My) / ey
    if (r > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, r)
  }
  return best
}

/**
 * P–M diagram polyline in the moment direction θM (radians in the Mx–My plane):
 * capacity M(P) sampled over the full axial range.
 */
export function pmCurve(
  surface: InteractionSurface,
  thetaM: number,
  nP = 120,
): { P: number; M: number }[] {
  const dx = Math.cos(thetaM)
  const dy = Math.sin(thetaM)
  const out: { P: number; M: number }[] = []
  for (let i = 0; i <= nP; i++) {
    const P = surface.Pt + ((surface.Puz - surface.Pt) * i) / nP
    const contour = contourAtP(surface, P)
    if (!contour) continue
    out.push({ P, M: rayCapacity(contour, dx, dy) })
  }
  return out
}

/** Full case check against the rigorous surface + the code's simplified power law. */
export function checkLoadCase(
  surface: InteractionSurface,
  lc: LoadCase,
  spec: CodeSpec,
  fck: number,
  fy: number,
  Ag: number,
  Asc: number,
  shape: 'rect' | 'circ',
): CaseResult {
  const P = lc.Pu * 1e3 // N
  const Mx = lc.Mux * 1e6 // N·mm
  const My = lc.Muy * 1e6
  const MEd = Math.hypot(Mx, My)

  const base: Omit<CaseResult, 'U' | 'ok' | 'axialGoverned'> = {
    loadCase: lc,
    Mux1: 0,
    Muy1: 0,
    MRd: 0,
    MEd,
    simplified: null,
    alphaN: null,
  }

  // axial range first
  if (P > surface.Puz) {
    return { ...base, U: P / surface.Puz, ok: false, axialGoverned: true }
  }
  if (P < surface.Pt) {
    return { ...base, U: P / surface.Pt, ok: false, axialGoverned: true }
  }

  const contour = contourAtP(surface, P)!
  const Mux1 = rayCapacity(contour, Mx >= 0 ? 1 : -1, 0)
  const Muy1 = rayCapacity(contour, 0, My >= 0 ? 1 : -1)

  if (MEd < 1) {
    // pure axial case
    const U = P >= 0 ? P / surface.Puz : P / surface.Pt
    return { ...base, Mux1, Muy1, U, ok: U <= 1.0, axialGoverned: true }
  }

  const MRd = rayCapacity(contour, Mx / MEd, My / MEd)
  const U = MRd > 0 ? MEd / MRd : Infinity

  // simplified power-law check (reported alongside; rigorous value governs)
  let simplified: number | null = null
  let alphaN: number | null = null
  if (P > 0 && Mux1 > 0 && Muy1 > 0) {
    const PuzS = spec.simplifiedPuz(fck, fy, Ag, Asc)
    alphaN = spec.alphaN(P / PuzS, shape)
    simplified = Math.pow(Math.abs(Mx) / Mux1, alphaN) + Math.pow(Math.abs(My) / Muy1, alphaN)
  }

  return { ...base, Mux1, Muy1, MRd, simplified, alphaN, U, ok: U <= 1.0, axialGoverned: false }
}
