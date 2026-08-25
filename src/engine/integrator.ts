import type { ConcreteModel, Point, Polygon, SteelModel, SurfacePoint } from './types'
import { concreteStress, steelStress } from './materials'
import { barArea, chordAt, ensureCCW, translatePoly } from './geometry'
import type { Rebar, SectionGeometry } from './types'

/**
 * Analysis model in centred coordinates (origin at the section centroid).
 * Moment sign convention: Mx = ∫σ·y·dA, My = ∫σ·x·dA with σ compression-positive,
 * i.e. a positive moment compresses the positive face (docs/12 §12.2).
 */
export interface AnalysisModel {
  boundary: Polygon
  voids: Polygon[]
  bars: { x: number; y: number; area: number }[]
  conc: ConcreteModel
  steel: SteelModel
  /** Tension-side steel strain cap closing the surface. */
  epsSteelLimit: number
  areaNet: number
}

export function buildAnalysisModel(
  geom: SectionGeometry,
  bars: Rebar[],
  centroid: Point,
  area: number,
  conc: ConcreteModel,
  steel: SteelModel,
  epsSteelLimit: number,
): AnalysisModel {
  return {
    boundary: translatePoly(ensureCCW(geom.boundary), centroid),
    voids: geom.voids.map((v) => translatePoly(ensureCCW(v), centroid)),
    bars: bars.map((b) => ({ x: b.x - centroid.x, y: b.y - centroid.y, area: barArea(b.dia) })),
    conc,
    steel,
    epsSteelLimit,
    areaNet: area,
  }
}

/** Linear strain field ε(x, y) = a + b·v with v = −x·sinθ + y·cosθ (compression at +v). */
export interface StrainPlane {
  a: number
  b: number
}

/** Per-orientation cache: polygons rotated once, extents precomputed. */
export interface RotatedFrame {
  cos: number
  sin: number
  boundaryUV: Polygon
  voidsUV: Polygon[]
  /** Sorted unique vertex v-coordinates (boundary + voids). */
  vBreaks: number[]
  vmin: number
  vmax: number
  /** v-coordinate of the extreme-tension bar (fallback: vmin). */
  vSteel: number
  barsV: number[]
}

export function rotateFrame(model: AnalysisModel, theta: number): RotatedFrame {
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const rot = (p: Point): Point => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos })
  const boundaryUV = model.boundary.map(rot)
  const voidsUV = model.voids.map((v) => v.map(rot))
  const vs: number[] = []
  let vmin = Infinity
  let vmax = -Infinity
  for (const p of boundaryUV) {
    vs.push(p.y)
    if (p.y < vmin) vmin = p.y
    if (p.y > vmax) vmax = p.y
  }
  for (const poly of voidsUV) for (const p of poly) vs.push(p.y)
  vs.sort((a, b) => a - b)
  const vBreaks = vs.filter((v, i) => i === 0 || v - vs[i - 1] > 1e-9)
  const barsV = model.bars.map((b) => -b.x * sin + b.y * cos)
  const vSteel = barsV.length ? Math.min(...barsV) : vmin
  return { cos, sin, boundaryUV, voidsUV, vBreaks, vmin, vmax, vSteel, barsV }
}

/**
 * Strain plane for sweep parameter t ∈ [0, 1]:
 *   t = 0          uniform tension at the steel strain cap
 *   (0, 0.45]      pivot A — extreme-tension steel fixed at −εs,lim, top strain rises to εcu
 *   (0.45, 0.8]    pivot B — top fibre fixed at εcu, neutral axis deepens to the bottom fibre
 *   (0.8, 1)       pivot C — fully compressed, plane rotates about the εc2 point
 *   t = 1          uniform compression at εc2
 */
export function strainPlaneAt(frame: RotatedFrame, model: AnalysisModel, t: number): StrainPlane {
  const { ecu, ec2 } = model.conc
  const esl = model.epsSteelLimit
  const { vmin, vmax } = frame
  const h = vmax - vmin
  // pivot A location: extreme tension steel; degenerate layouts fall back to the bottom fibre
  const vA = vmax - frame.vSteel > 0.05 * h ? frame.vSteel : vmin

  const T1 = 0.45
  const T2 = 0.8

  if (t <= 0) return { a: -esl, b: 0 }
  if (t >= 1) return { a: ec2, b: 0 }

  if (t <= T1) {
    const epsTop = -esl + (ecu + esl) * (t / T1)
    const b = (epsTop - -esl) / (vmax - vA)
    return { a: -esl - b * vA, b }
  }
  if (t <= T2) {
    // NA depth measured from the top fibre
    const c1 = (ecu * (vmax - vA)) / (ecu + esl)
    const c = c1 + (h - c1) * ((t - T1) / (T2 - T1))
    const b = ecu / c
    return { a: ecu - b * vmax, b }
  }
  const s = (t - T2) / (1 - T2)
  const c = h / (1 - Math.min(s, 0.999999))
  const dc = (1 - ec2 / ecu) * h
  const epsTop = (ec2 * c) / (c - dc)
  const b = epsTop / c
  return { a: epsTop - b * vmax, b }
}

const GAUSS3 = [
  { x: -Math.sqrt(3 / 5), w: 5 / 9 },
  { x: 0, w: 8 / 9 },
  { x: Math.sqrt(3 / 5), w: 5 / 9 },
]

/**
 * Stress resultants of one strain plane: exact scanline integration of the
 * parabola–rectangle block over the polygon (3-point Gauss per linear-width
 * band is exact to the quintic integrands involved), plus discrete bars with
 * displaced-concrete correction.
 */
export function planeForces(model: AnalysisModel, frame: RotatedFrame, plane: StrainPlane): SurfacePoint {
  const { conc } = model
  const { a, b } = plane
  let N = 0
  let Sx = 0 // ∫σ·x dA
  let Sy = 0 // ∫σ·y dA

  if (Math.abs(b) < 1e-12) {
    // uniform strain: moments vanish about the centroid
    const sig = concreteStress(conc, a)
    N += sig * model.areaNet
  } else {
    const vNA = -a / b
    const vLo = Math.max(vNA, frame.vmin)
    const vHi = frame.vmax
    if (vHi > vLo + 1e-9) {
      // band breakpoints: polygon vertices + the εc2 iso-line + zone limits
      const breaks: number[] = [vLo, vHi]
      for (const v of frame.vBreaks) if (v > vLo + 1e-9 && v < vHi - 1e-9) breaks.push(v)
      const vC2 = (conc.ec2 - a) / b
      if (vC2 > vLo + 1e-9 && vC2 < vHi - 1e-9) breaks.push(vC2)
      breaks.sort((p, q) => p - q)

      for (let i = 0; i + 1 < breaks.length; i++) {
        const v1 = breaks[i]
        const v2 = breaks[i + 1]
        const half = (v2 - v1) / 2
        const mid = (v2 + v1) / 2
        for (const g of GAUSS3) {
          const vg = mid + half * g.x
          const eps = a + b * vg
          const sig = concreteStress(conc, eps)
          if (sig === 0) continue
          let w = 0
          let Su = 0
          const cb = chordAt(frame.boundaryUV, vg)
          w += cb.w
          Su += cb.Su
          for (const hole of frame.voidsUV) {
            const ch = chordAt(hole, vg)
            w -= ch.w
            Su -= ch.Su
          }
          const wt = g.w * half
          N += sig * w * wt
          // x = u·cosθ − v·sinθ ; y = u·sinθ + v·cosθ
          Sx += sig * (frame.cos * Su - frame.sin * vg * w) * wt
          Sy += sig * (frame.sin * Su + frame.cos * vg * w) * wt
        }
      }
    }
  }

  // steel, with displaced-concrete deduction in the compressed zone
  for (let i = 0; i < model.bars.length; i++) {
    const bar = model.bars[i]
    const eps = a + b * frame.barsV[i]
    const f = steelStress(model.steel, eps) - concreteStress(conc, eps)
    N += bar.area * f
    Sx += bar.area * f * bar.x
    Sy += bar.area * f * bar.y
  }

  return { P: N, Mx: Sy, My: Sx }
}
