import type {
  CaseResult,
  ContourPoint,
  InteractionSurface,
  LoadCase,
  MeshSettings,
  NeutralAxisDetail,
  Point,
  SectionReinforcementClass,
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

/**
 * Derive xu, xu,max and under/over-reinforced classification from a capacity
 * contour point. Coordinates are section (user) frame: centroid at (cx, cy),
 * boundary extents from the interaction model via vmax/vmin of the rotated frame.
 *
 * xu is the distance from the extreme compression fibre to the NA, measured
 * along the compression normal n = (−sin θ, cos θ). Global-axis projections
 * of that depth vector are reported as xuGlobalX / xuGlobalY.
 */
export function neutralAxisDetail(
  cp: ContourPoint,
  model: AnalysisModel,
  centroid: Point,
  xuMaxRatio: number,
  Mu: number | null,
  Mu0: number | null = null,
): NeutralAxisDetail {
  const frame = rotateFrame(model, cp.theta)
  const { vmin, vmax, vSteel, boundaryUV, cos, sin } = frame
  const h = Math.max(1e-9, vmax - vmin)
  const n: Point = { x: -Math.sin(cp.theta), y: Math.cos(cp.theta) }

  // Actual extreme-compression boundary vertex (max v in the rotated frame).
  // Inverse of rot: x = u cosθ − v sinθ, y = u sinθ + v cosθ (centred → user).
  let uExt = 0
  let vExt = vmax
  for (const p of boundaryUV) {
    if (p.y >= vExt - 1e-9) {
      vExt = p.y
      uExt = p.x
    }
  }
  const extremeComp: Point = {
    x: centroid.x + uExt * cos - vExt * sin,
    y: centroid.y + uExt * sin + vExt * cos,
  }

  const ratio = xuMaxRatio
  // effective depth: extreme compression fibre → extreme tension steel
  const dEff = Math.max(1e-9, vmax - (Number.isFinite(vSteel) ? vSteel : vmin))
  const xuMax = ratio * dEff

  let xu: number | null = null
  let vna = 0
  let classification: SectionReinforcementClass = 'no-compression'
  // NA point shares the same u as the extreme fibre so the xu dimension is
  // drawn perpendicular to the NA (along the compression normal).
  const naAt = (v: number): Point => ({
    x: centroid.x + uExt * cos - v * sin,
    y: centroid.y + uExt * sin + v * cos,
  })
  let naPoint: Point = { ...extremeComp }

  if (Math.abs(cp.b) < 1e-12) {
    // uniform strain plane
    if (cp.a > 1e-9) {
      // whole section compressed — NA outside / beyond the tension face
      xu = Infinity
      classification = 'fully-compressed'
      vna = vmin - h
      naPoint = naAt(vna)
    } else {
      xu = null
      classification = 'no-compression'
      vna = vmax + h
      naPoint = naAt(vna)
    }
  } else {
    vna = -cp.a / cp.b
    xu = vmax - vna
    naPoint = naAt(vna)
    if (xu <= 0) {
      xu = null
      classification = 'no-compression'
    } else if (vna < vmin - 1e-6) {
      // NA below the section — fully compressed (pivot C)
      classification = 'fully-compressed'
    } else if (xu <= xuMax + 1e-6) {
      classification = 'under-reinforced'
    } else {
      classification = 'over-reinforced'
    }
  }

  const xuFinite = xu !== null && Number.isFinite(xu) ? xu : null
  // Global-axis components of the xu depth vector (from extreme fibre toward NA)
  const xuGlobalX = xuFinite !== null ? -xuFinite * n.x : null
  const xuGlobalY = xuFinite !== null ? -xuFinite * n.y : null

  return {
    xu: xuFinite !== null ? xuFinite : xu === Infinity ? Infinity : null,
    xuMax,
    xuMaxRatio: ratio,
    d: dEff,
    h,
    theta: cp.theta,
    vna,
    vmax,
    vmin,
    extremeComp,
    naPoint,
    normal: n,
    xuGlobalX,
    xuGlobalY,
    classification,
    Mu,
    Mu0,
  }
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

/**
 * Optional context for attaching xu / xu,max / under-over classification to a
 * load-case result. When omitted the NA fields stay null (keeps existing call
 * sites and tests working without a full analysis model).
 */
export interface NaContext {
  model: AnalysisModel
  centroid: Point
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
  naCtx?: NaContext | null,
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
    na: null,
  }

  const ratio = spec.xuMaxRatio(fy)

  const attachNa = (dx: number, dy: number, MRdVal: number | null): NeutralAxisDetail | null => {
    if (!naCtx) return null
    const cp = naForDirection(surface, P, dx, dy)
    if (!cp) return null
    // pure-bending capacity along the same direction (for under-reinforced Mu display)
    const c0 = contourAtP(surface, 0)
    const Mu0 = c0 ? rayCapacity(c0, dx, dy) : null
    return neutralAxisDetail(cp, naCtx.model, naCtx.centroid, ratio, MRdVal, Mu0)
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
    // pure axial case — NA is irrelevant / fully compressed when P > 0
    const U = P >= 0 ? P / surface.Puz : P / surface.Pt
    let na: NeutralAxisDetail | null = null
    if (naCtx && P > 0) {
      // uniform compression plane
      const cp: ContourPoint = {
        P,
        Mx: 0,
        My: 0,
        a: naCtx.model.conc.ec2,
        b: 0,
        theta: 0,
      }
      na = neutralAxisDetail(cp, naCtx.model, naCtx.centroid, ratio, null, null)
    }
    return { ...base, Mux1, Muy1, U, ok: U <= 1.0, axialGoverned: true, na }
  }

  const dx = Mx / MEd
  const dy = My / MEd
  const MRd = rayCapacity(contour, dx, dy)
  const U = MRd > 0 ? MEd / MRd : Infinity

  // simplified power-law check (reported alongside; rigorous value governs)
  let simplified: number | null = null
  let alphaN: number | null = null
  if (P > 0 && Mux1 > 0 && Muy1 > 0) {
    const PuzS = spec.simplifiedPuz(fck, fy, Ag, Asc)
    alphaN = spec.alphaN(P / PuzS, shape)
    simplified = Math.pow(Math.abs(Mx) / Mux1, alphaN) + Math.pow(Math.abs(My) / Muy1, alphaN)
  }

  const na = attachNa(dx, dy, MRd)

  return { ...base, Mux1, Muy1, MRd, simplified, alphaN, U, ok: U <= 1.0, axialGoverned: false, na }
}
