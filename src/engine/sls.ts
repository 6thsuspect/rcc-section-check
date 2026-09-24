import type { LoadCase, Point } from './types'
import { rotateFrame, buildAnalysisModel, type AnalysisModel, type RotatedFrame } from './integrator'
import { sectionProperties } from './geometry'
import type { SectionGeometry } from './types'
import type { Rebar } from './types'
import { ES } from './materials'

/**
 * Serviceability (SLS) stress check — the **working-stress / direct-stress
 * method** of IS 456:2000 Annex C (clause C-5, Tables 21 & 22).
 *
 * The section is analysed as a cracked, linear-elastic **transformed section**
 * under the *service* (characteristic) actions of a load case:
 *
 *   - concrete carries compression only (tensile strength ignored);
 *   - longitudinal steel is transformed to an equivalent concrete area `m·As`
 *     (modular ratio `m = 280 / (3·σcbc)`, IS 456 Cl C-2.1 — the long-term
 *     value that already folds in creep);
 *   - plane sections remain plane, so strain is linear across the section.
 *
 * The neutral-axis depth is solved from equilibrium of the transformed section
 * (ΣN = P along the resultant-moment direction), and the extreme-fibre concrete
 * stress and the extreme-bar steel stress are compared with the permissible
 * stresses σcbc (Table 21) and σst / σsc (Table 22).
 *
 * This module is deliberately independent of the ULS kernel's design stress
 * blocks: it only reuses the exact section-geometry integration
 * (`rotateFrame` + `chordAt`) so the SLS and ULS analyses share one geometry
 * representation. Because the concrete modulus cancels out of the transformed
 * equilibrium, only the code's modular ratio `m` is required — the resulting
 * σc / σst are independent of the (semi-empirical) short-term Ec, exactly as in
 * the hand method.
 */

/* ------------------------------------------------------------------ *
 * Permissible stresses (IS 456:2000, working-stress basis)
 * ------------------------------------------------------------------ */

/**
 * Permissible compressive stress in concrete in bending, σcbc (N/mm²).
 * IS 456 Table 21. Values above M60 are a linear extrapolation of the
 * table's +1.5 MPa per 5 MPa grade step (flagged by the caller).
 */
const SIGMA_CBC: Record<number, number> = {
  15: 5.0,
  20: 7.0,
  25: 8.5,
  30: 10.0,
  35: 11.5,
  40: 13.0,
  45: 14.5,
  50: 16.0,
  55: 17.5,
  60: 19.0,
}

/** Highest grade with a tabulated σcbc (above this the value is extrapolated). */
export const SIGMA_CBC_MAX_GRADE = 60

export function sigmaCbc(fck: number): number {
  if (fck in SIGMA_CBC) return SIGMA_CBC[fck]
  if (fck < 15) return SIGMA_CBC[15]
  // Linear fit through the tabulated points ≥ M20 (slope 1.5 MPa per 5 MPa).
  return 1 + 0.3 * fck
}

/**
 * Permissible tensile stress in steel, σst (N/mm²). IS 456 Table 22 / Cl B-2.2.
 * Mild (plain) bars are limited to 140 MPa (⌀ ≤ 20 mm) or 130 MPa (⌀ > 20 mm);
 * Fe415 is tabulated at 230 MPa; grades ≥ Fe500 use 0.55·fy (Cl B-2.2, which
 * gives 275 MPa for Fe500).
 */
export function sigmaSt(fy: number, dia: number): number {
  if (fy <= 250) return dia <= 20 ? 140 : 130
  if (fy <= 415) return 230
  return 0.55 * fy
}

/**
 * Permissible compressive stress in column bars, σsc (N/mm²). IS 456 Table 22.
 * Mild 130 MPa; high-yield deformed bars 190 MPa.
 */
export function sigmaSc(fy: number): number {
  return fy <= 250 ? 130 : 190
}

/** Modular ratio for the transformed section, m = 280 / (3·σcbc) (Cl C-2.1). */
export function modularRatio(fck: number): number {
  return 280 / (3 * sigmaCbc(fck))
}

export interface SlsMaterialLimits {
  fck: number
  fy: number
  /** Permissible concrete bending-compression stress, N/mm². */
  sigmaCbc: number
  /** Permissible tensile steel stress for the largest bar ⌀ present, N/mm². */
  sigmaSt: number
  /** Permissible compressive steel stress (column bars), N/mm². */
  sigmaSc: number
  /** Modular ratio m = 280/(3σcbc). */
  m: number
  /** True when σcbc was extrapolated beyond the tabulated grades (> M60). */
  extrapolated: boolean
}

export function slsMaterialLimits(fck: number, fy: number, maxBarDia: number): SlsMaterialLimits {
  return {
    fck,
    fy,
    sigmaCbc: sigmaCbc(fck),
    sigmaSt: sigmaSt(fy, maxBarDia),
    sigmaSc: sigmaSc(fy),
    m: modularRatio(fck),
    extrapolated: fck > SIGMA_CBC_MAX_GRADE,
  }
}

/* ------------------------------------------------------------------ *
 * Transformed-section resultants
 * ------------------------------------------------------------------ */

/** 3-point Gauss–Legendre nodes/weights (exact for the integrands here). */
const GAUSS3 = [
  { x: -Math.sqrt(3 / 5), w: 5 / 9 },
  { x: 0, w: 8 / 9 },
  { x: Math.sqrt(3 / 5), w: 5 / 9 },
]

/**
 * Transformed-section resultants per unit strain gradient (i.e. with the
 * concrete modulus · gradient set to 1) for a neutral axis at frame
 * coordinate `v0`. Compression positive.
 *
 *   EN  = ∫_{v≥v0} (v−v0) dA  +  m·Σ (v_b − v0)·As_b        (axial)
 *   Sx  = ∫ (v−v0)·x dA       +  m·Σ (v_b − v0)·As_b·x_b     (→ My)
 *   Sy  = ∫ (v−v0)·y dA       +  m·Σ (v_b − v0)·As_b·y_b     (→ Mx)
 *
 * matching the moment convention of the ULS integrator (Mx = ∫σ·y, My = ∫σ·x).
 * Concrete is integrated over the compression zone only; every bar is carried
 * as `m·As` with its signed (v−v0), so tension bars pull the axial resultant
 * negative exactly as in the hand transformed section.
 */
function transformedUnitForces(
  model: AnalysisModel,
  frame: RotatedFrame,
  v0: number,
  m: number,
): { EN: number; Sx: number; Sy: number } {
  const { cos, sin } = frame
  let EN = 0
  let Sx = 0
  let Sy = 0

  // --- concrete compression zone [max(v0, vmin), vmax] ---
  const vLo = Math.max(v0, frame.vmin)
  if (vLo < frame.vmax - 1e-9) {
    const breaks: number[] = [vLo, frame.vmax]
    for (const v of frame.vBreaks) if (v > vLo + 1e-9 && v < frame.vmax - 1e-9) breaks.push(v)
    breaks.sort((a, b) => a - b)
    for (let i = 0; i + 1 < breaks.length; i++) {
      const v1 = breaks[i]
      const v2 = breaks[i + 1]
      const half = (v2 - v1) / 2
      const mid = (v2 + v1) / 2
      for (const g of GAUSS3) {
        const vg = mid + half * g.x
        const eu = vg - v0
        if (eu <= 0) continue
        const cb = chordAtSafe(frame.boundaryUV, vg)
        let w = cb.w
        let Su = cb.Su
        for (const hole of frame.voidsUV) {
          const ch = chordAtSafe(hole, vg)
          w -= ch.w
          Su -= ch.Su
        }
        if (w === 0) continue
        const wt = g.w * half
        EN += eu * w * wt
        // x = u·cosθ − v·sinθ ; y = u·sinθ + v·cosθ
        Sx += eu * (cos * Su - sin * vg * w) * wt
        Sy += eu * (sin * Su + cos * vg * w) * wt
      }
    }
  }

  // --- steel (transformed m·As, all bars) ---
  for (let i = 0; i < model.bars.length; i++) {
    const bar = model.bars[i]
    const eu = frame.barsV[i] - v0
    const contrib = m * eu * bar.area
    EN += contrib
    Sx += contrib * bar.x
    Sy += contrib * bar.y
  }

  return { EN, Sx, Sy }
}

// Local chord helper (avoids importing the un-exported symbol and keeps the
// SLS module self-contained; identical half-open scanline rule as integrator).
function chordAtSafe(polyUV: { x: number; y: number }[], vg: number): { w: number; Su: number } {
  const us: number[] = []
  const n = polyUV.length
  for (let i = 0; i < n; i++) {
    const a = polyUV[i]
    const b = polyUV[(i + 1) % n]
    const dv = b.y - a.y
    if (dv === 0) continue
    if ((a.y <= vg && b.y > vg) || (b.y <= vg && a.y > vg)) {
      us.push(a.x + ((vg - a.y) * (b.x - a.x)) / dv)
    }
  }
  us.sort((p, q) => p - q)
  let w = 0
  let Su = 0
  for (let i = 0; i + 1 < us.length; i += 2) {
    const u1 = us[i]
    const u2 = us[i + 1]
    w += u2 - u1
    Su += (u2 * u2 - u1 * u1) / 2
  }
  return { w, Su }
}

/* ------------------------------------------------------------------ *
 * Neutral-axis solve
 * ------------------------------------------------------------------ */

/**
 * Equilibrium residual at a candidate NA position `v0`:
 *   h(v0) = P·Mdir(v0) − MEd·N(v0)
 * A root gives the NA for which the transformed resultants reproduce both the
 * axial load and the resultant service moment (Mdir is the resisting-moment
 * component along the demand direction). For pure bending (P = 0) it reduces to
 * N(v0) = 0, the classic transformed-section neutral axis.
 */
function residual(
  model: AnalysisModel,
  frame: RotatedFrame,
  phi: number,
  P: number,
  MEd: number,
  m: number,
  v0: number,
): number {
  const { EN, Sx, Sy } = transformedUnitForces(model, frame, v0, m)
  const Mdir = Sy * Math.cos(phi) + Sx * Math.sin(phi)
  return P * Mdir - MEd * EN
}

/** Scan + bisection for the NA position; returns null when no root is bracketed. */
function solveNA(
  model: AnalysisModel,
  frame: RotatedFrame,
  phi: number,
  P: number,
  MEd: number,
  m: number,
): number | null {
  const vmin = frame.vmin
  const vmax = frame.vmax
  const h = Math.max(1e-6, vmax - vmin)
  const lo = vmin - 1.5 * h
  const hi = vmax + 1.5 * h
  const N = 512
  const f = (v: number) => residual(model, frame, phi, P, MEd, m, v)

  let prevV = lo
  let prevF = f(lo)
  for (let i = 1; i <= N; i++) {
    const v = lo + ((hi - lo) * i) / N
    const fv = f(v)
    if (Number.isFinite(prevF) && Number.isFinite(fv) && prevF === 0) return prevV
    if (Number.isFinite(prevF) && Number.isFinite(fv) && prevF < 0 !== fv < 0) {
      let a = prevV
      let b = v
      let fa = prevF
      for (let k = 0; k < 80; k++) {
        const mid = (a + b) / 2
        const fm = f(mid)
        if (!Number.isFinite(fm)) break
        if (fa < 0 !== fm < 0) b = mid
        else {
          a = mid
          fa = fm
        }
      }
      return (a + b) / 2
    }
    prevV = v
    prevF = fv
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Per-case result
 * ------------------------------------------------------------------ */

export interface SlsCaseResult {
  caseId: string
  caseName: string
  /** Service actions used for the check (echo of the load case). */
  Pu: number
  Mux: number
  Muy: number
  /** Resultant service moment, N·mm. */
  MEd: number
  /** Moment-direction angle φ, rad. */
  phi: number

  /** Neutral-axis depth from the extreme compression fibre, mm. */
  xu: number
  /** Effective depth: extreme compression fibre → extreme tension bar, mm. */
  d: number
  /** True when the NA lies outside the section (whole section in one zone). */
  naOutside: boolean
  /** Signed NA offset from the centroid along the compression normal, mm. */
  vna: number
  /** Offset of the extreme compression fibre from the centroid, mm. */
  vTop: number

  /** Max concrete compressive stress (extreme fibre), N/mm². */
  sigmaC: number
  /** Permissible concrete stress σcbc, N/mm². */
  sigmaCbc: number
  /** σc / σcbc. */
  concreteRatio: number
  concreteOk: boolean

  /** Max tensile steel stress (most-tensioned bar), N/mm². */
  sigmaSt: number
  /** Permissible tensile steel stress σst, N/mm². */
  sigmaStPerm: number
  /** σst / σst,perm. */
  steelRatio: number
  steelOk: boolean
  /** Index of the most-tensioned bar (−1 if none). */
  tensionBar: number

  /** Max compressive steel stress (if any bar lies in compression), N/mm². */
  sigmaSc: number
  /** Permissible compressive steel stress σsc, N/mm². */
  sigmaScPerm: number
  compSteelRatio: number
  compSteelOk: boolean
  /** Index of the most-compressed bar (−1 if none). */
  compBar: number

  /** Governing verdict: concrete and both steel checks pass. */
  ok: boolean

  /** Per-bar service steel stress, N/mm² (tension positive), for the figure. */
  barStresses: number[]
  /** Modular ratio used. */
  m: number
}

export interface SlsInputs {
  geometry: SectionGeometry
  bars: Rebar[]
  fck: number
  fy: number
  /** Modular ratio m (from slsMaterialLimits). */
  m: number
  sigmaCbc: number
  sigmaSt: number
  sigmaSc: number
}

/** Build the shared SLS analysis model (geometry + transformed bars, centred). */
export function buildSlsModel(inputs: SlsInputs): AnalysisModel {
  const props = sectionProperties(inputs.geometry, inputs.bars)
  // The ULS concrete/steel models are unused here; pass neutral placeholders.
  const conc = { fcd: 0, ec2: 0, ecu: 0, n: 1 }
  const steel = { points: [{ eps: 0, sig: 0 }], fyd: 0, Es: ES }
  return buildAnalysisModel(
    inputs.geometry,
    inputs.bars,
    { x: props.cx, y: props.cy },
    props.area,
    conc,
    steel,
    0,
  )
}

/**
 * SLS stress check of one load case. Returns null when the case has neither
 * bending nor axial load (nothing to check) or the section carries no
 * compression/tension resistance at all.
 */
export function slsStress(model: AnalysisModel, inputs: SlsInputs, lc: LoadCase): SlsCaseResult | null {
  const P = lc.Pu * 1e3 // N (compression +)
  const Mx = lc.Mux * 1e6 // N·mm
  const My = lc.Muy * 1e6 // N·mm
  const MEd = Math.hypot(Mx, My)
  if (MEd < 1 && Math.abs(P) < 1) return null

  const m = inputs.m

  // --- pure axial (no bending): uniform strain over the transformed section ---
  if (MEd < 1) {
    const Ac = model.areaNet
    const Asc = model.bars.reduce((s, b) => s + b.area, 0)
    const denom = Ac + m * Asc
    const sigmaCU = denom > 0 ? P / denom : 0 // signed (compression +)
    const sigmaC = Math.max(0, sigmaCU)
    const steelMag = Math.abs(m * sigmaCU)
    const inTension = sigmaCU < 0
    const barStresses = model.bars.map(() => (inTension ? -steelMag : steelMag))
    const concreteRatio = inputs.sigmaCbc > 0 ? sigmaC / inputs.sigmaCbc : Infinity
    const steelRatio = inputs.sigmaSt > 0 && inTension ? steelMag / inputs.sigmaSt : 0
    const compSteelRatio = inputs.sigmaSc > 0 && !inTension ? steelMag / inputs.sigmaSc : 0
    const concreteOk = Number.isFinite(concreteRatio) && concreteRatio <= 1
    const steelOk = inTension ? steelRatio <= 1 : compSteelRatio <= 1
    return {
      caseId: lc.id,
      caseName: lc.name,
      Pu: lc.Pu,
      Mux: lc.Mux,
      Muy: lc.Muy,
      MEd,
      phi: 0,
      xu: NaN, // no bending neutral axis
      d: NaN,
      naOutside: true,
      vna: 0,
      vTop: 0,
      sigmaC,
      sigmaCbc: inputs.sigmaCbc,
      concreteRatio,
      concreteOk,
      sigmaSt: inTension ? steelMag : 0,
      sigmaStPerm: inputs.sigmaSt,
      steelRatio,
      steelOk: inTension ? steelOk : true,
      tensionBar: inTension ? 0 : -1,
      sigmaSc: inTension ? 0 : steelMag,
      sigmaScPerm: inputs.sigmaSc,
      compSteelRatio,
      compSteelOk: inTension ? true : steelOk,
      compBar: inTension ? -1 : 0,
      ok: concreteOk && steelOk,
      barStresses,
      m,
    }
  }

  const phi = Math.atan2(My, Mx)
  const theta = phi
  const frame = rotateFrame(model, theta)
  const { vmin, vmax } = frame

  let v0 = solveNA(model, frame, phi, P, MEd, m)
  let naOutside = false
  if (v0 === null) {
    // No equilibrium inside the extended range: the whole section sits in one
    // zone (heavy axial). Pin the NA just outside and flag it.
    naOutside = true
    v0 = P >= 0 ? vmin - 1e-6 : vmax + 1e-6
  } else if (v0 < vmin - 1e-6 || v0 > vmax + 1e-6) {
    naOutside = true
  }

  const { EN, Sx, Sy } = transformedUnitForces(model, frame, v0, m)
  const Mdir = Sy * Math.cos(phi) + Sx * Math.sin(phi)
  // κ = Ec·(strain gradient): from whichever equilibrium is better conditioned.
  const useMoment = Math.abs(Mdir) >= Math.abs(EN)
  const kappa = useMoment ? (Mdir !== 0 ? MEd / Mdir : 0) : EN !== 0 ? P / EN : 0
  if (!Number.isFinite(kappa)) return null

  // Extreme-fibre concrete compression stress.
  const sigmaC = Math.max(0, kappa * (vmax - v0))

  // Per-bar steel stresses (tension positive).
  const barStresses = model.bars.map((_, i) => m * kappa * (frame.barsV[i] - v0))
  let sigmaSt = 0
  let tensionBar = -1
  let sigmaSc = 0
  let compBar = -1
  for (let i = 0; i < barStresses.length; i++) {
    const s = barStresses[i]
    if (s < 0 && -s > sigmaSt) {
      sigmaSt = -s
      tensionBar = i
    } else if (s > 0 && s > sigmaSc) {
      sigmaSc = s
      compBar = i
    }
  }

  const barsV = frame.barsV
  const vSteel = barsV.length ? Math.min(...barsV) : vmin
  const d = vmax - vSteel > 1e-6 ? vmax - vSteel : vmax - vmin
  const xu = vmax - v0

  const concreteRatio = inputs.sigmaCbc > 0 ? sigmaC / inputs.sigmaCbc : Infinity
  const steelRatio = inputs.sigmaSt > 0 ? sigmaSt / inputs.sigmaSt : Infinity
  const compSteelRatio = sigmaSc > 0 && inputs.sigmaSc > 0 ? sigmaSc / inputs.sigmaSc : 0

  const concreteOk = Number.isFinite(concreteRatio) && concreteRatio <= 1
  const steelOk = tensionBar < 0 || (Number.isFinite(steelRatio) && steelRatio <= 1)
  const compSteelOk = compBar < 0 || compSteelRatio <= 1

  return {
    caseId: lc.id,
    caseName: lc.name,
    Pu: lc.Pu,
    Mux: lc.Mux,
    Muy: lc.Muy,
    MEd,
    phi,
    xu,
    d,
    naOutside,
    vna: v0,
    vTop: vmax,
    sigmaC,
    sigmaCbc: inputs.sigmaCbc,
    concreteRatio,
    concreteOk,
    sigmaSt,
    sigmaStPerm: inputs.sigmaSt,
    steelRatio,
    steelOk,
    tensionBar,
    sigmaSc,
    sigmaScPerm: inputs.sigmaSc,
    compSteelRatio,
    compSteelOk,
    compBar,
    ok: concreteOk && steelOk && compSteelOk,
    barStresses,
    m,
  }
}

/** Convenience: the extreme compression-fibre point in user coordinates (for labels). */
export function extremeCompressionPoint(cx: number, cy: number, phi: number, vTop: number): Point {
  return { x: cx - Math.sin(phi) * vTop, y: cy + Math.cos(phi) * vTop }
}
