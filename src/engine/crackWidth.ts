import type { DesignCodeId, Rebar } from './types'
import { ES } from './materials'
import { rotateFrame, type AnalysisModel } from './integrator'
import type { SlsCaseResult } from './sls'

/**
 * Serviceability **crack-width check**, evaluated per selected design code.
 *
 * The crack width depends on the tension-steel stress of the cracked section
 * (σs) together with the bar diameter, cover and effective tension area. The
 * SLS stress module already solves the cracked transformed section for the
 * characteristic actions and returns σs, the neutral-axis depth `xu`, the
 * effective depth `d` and the moment direction `phi`. This module reuses that
 * result (no second section solve) and applies the crack-width method each code
 * prescribes:
 *
 *   - **IS 456:2000 Annex F** (also the basis of the IRS Concrete Bridge Code
 *     Cl 15.9.8.2): the design surface crack width
 *         w = 3·a_cr·ε_m / (1 + 2·(a_cr − c_min)/(h − x))
 *     with the mean steel strain allowing for tension stiffening
 *         ε_m = ε_1 − b·(h − x)·(a − x) / (3·E_s·A_s·(d − x)),  a = h at the face,
 *         ε_1 = σ_s / E_s .
 *     Permissible width by exposure, Cl 35.3.2 (mild 0.3 / moderate 0.2 /
 *     severe & more aggressive 0.1 mm).
 *
 *   - **IRC:112-2020 Cl 12.3.4** (adopts EN 1992-2 / EN 1992-1-1 Eq. 7.8–7.11):
 *         w_k = s_r,max · (ε_sm − ε_cm),
 *         s_r,max = 3.4·c + 0.425·k_1·k_2·φ/ρ_p,eff   (k_1 = 0.8, k_2 = 0.5),
 *         ε_sm − ε_cm = [σ_s − k_t·(f_ct,eff/ρ_p,eff)·(1 + α_e·ρ_p,eff)]/E_s
 *                       ≥ 0.6·σ_s/E_s ,
 *         A_c,eff = b·min[2.5(h − d), (h − x)/3, h/2],  ρ_p,eff = A_s/A_c,eff ,
 *         f_ct,eff = f_ctm,  α_e = E_s/E_cm,  k_t = 0.6 short / 0.4 long term.
 *     Permissible width by exposure, Table 12.1 (RC, quasi-permanent).
 *
 * All three codes share the geometry reuse: the effective width b is taken as
 * the net concrete area divided by the depth in the bending plane (exact for a
 * rectangle), and the clear cover c is measured to the extreme tension bar.
 * Engine units throughout: N, mm, N/mm²; the crack width is reported in mm.
 */

/* ------------------------------------------------------------------ *
 * Exposure classes and permissible crack widths (mm) per code
 * ------------------------------------------------------------------ */

export interface ExposureOption {
  value: string
  label: string
}

/** Permissible crack width by exposure — IS 456 Cl 35.3.2 (Table 15 note). */
const IS456_WMAX: Record<string, number> = {
  mild: 0.3,
  moderate: 0.2,
  severe: 0.1, // severe, very severe and extreme
}

/** Permissible crack width by exposure — IRC:112 Table 12.1 (EN 1992-2 Table 7.101N, RC, quasi-permanent). */
const IRC112_WMAX: Record<string, number> = {
  X0: 0.3,
  XC1: 0.3,
  XC2: 0.3,
  XC3: 0.3,
  XC4: 0.3,
  XD1: 0.3,
  XD2: 0.2,
  XD3: 0.2,
  XS1: 0.3,
  XS2: 0.2,
  XS3: 0.2,
}

/** Design crack widths — IRS Concrete Bridge Code Table 10. */
const IRSCBC_WMAX: Record<string, number> = {
  moderate: 0.2,
  severe: 0.1,
}

export const EXPOSURE_OPTIONS: Record<DesignCodeId, ExposureOption[]> = {
  IS456: [
    { value: 'mild', label: 'Mild — protected from weather' },
    { value: 'moderate', label: 'Moderate — sheltered / buried' },
    { value: 'severe', label: 'Severe, very severe or extreme' },
  ],
  IRC112: [
    { value: 'X0', label: 'X0 — no risk of corrosion' },
    { value: 'XC1', label: 'XC1 — dry or permanently wet' },
    { value: 'XC2', label: 'XC2 — wet, rarely dry' },
    { value: 'XC3', label: 'XC3 — moderate humidity' },
    { value: 'XC4', label: 'XC4 — cyclic wet and dry' },
    { value: 'XD1', label: 'XD1 — moderate humidity + chlorides' },
    { value: 'XD2', label: 'XD2 — wet, rarely dry + chlorides' },
    { value: 'XD3', label: 'XD3 — cyclic wet and dry + chlorides' },
    { value: 'XS1', label: 'XS1 — airborne salt' },
    { value: 'XS2', label: 'XS2 — tidal / splash / spray' },
    { value: 'XS3', label: 'XS3 — tidal / splash / spray (severe)' },
  ],
  IRSCBC: [
    { value: 'moderate', label: 'Moderate' },
    { value: 'severe', label: 'Severe' },
  ],
}

/** Default exposure class for a code (a middle, commonly applicable value). */
export const DEFAULT_EXPOSURE: Record<DesignCodeId, string> = {
  IS456: 'moderate',
  IRC112: 'XC3',
  IRSCBC: 'moderate',
}

export function wMaxFor(code: DesignCodeId, exposure: string): number {
  const table = code === 'IRC112' ? IRC112_WMAX : code === 'IRSCBC' ? IRSCBC_WMAX : IS456_WMAX
  return table[exposure] ?? Object.values(table)[0]
}

export function clauseFor(code: DesignCodeId): string {
  if (code === 'IRC112') return 'IRC:112-2020 Cl 12.3.4 (EN 1992-2), Table 12.1'
  if (code === 'IRSCBC') return 'IRS Concrete Bridge Code 1997 Cl 15.9.8.2, Table 10'
  return 'IS 456:2000 Annex F (Cl 35.3.2 limit)'
}

/* ------------------------------------------------------------------ *
 * Settings + result
 * ------------------------------------------------------------------ */

export interface CrackWidthSettings {
  /** Exposure class key from EXPOSURE_OPTIONS[code]. */
  exposure: string
  /** Long-term (true) vs short-term (false) loading — sets k_t for IRC:112. */
  longTerm: boolean
}

export interface CrackWidthResult {
  caseId: string
  caseName: string
  /** Calculated design crack width, mm. */
  w: number
  /** Permissible crack width for the exposure, mm. */
  wmax: number
  /** w / wmax. */
  ratio: number
  ok: boolean
  /** Code clause reference. */
  clause: string
  /** Governing tension-steel stress from the SLS cracked section, N/mm². */
  sigmaS: number
  /** True when the section is uncracked under the service action (w ≈ 0). */
  uncracked: boolean
  /** Derived quantities shown in the calculation detail. */
  detail: {
    /** Overall depth in the bending plane, mm. */
    h: number
    /** Neutral-axis depth from the extreme compression fibre, mm. */
    x: number
    /** Effective depth (compression fibre → extreme tension bar), mm. */
    d: number
    /** Effective section width in the tension zone, mm. */
    b: number
    /** Tension-reinforcement area, mm². */
    As: number
    /** Clear cover to the tension bar surface, mm. */
    c: number
    /** Tension-bar diameter, mm. */
    phi: number
    /** Mean steel strain ε_m (IS 456 / IRS CBC method). */
    epsM?: number
    /** Maximum crack spacing s_r,max, mm (IRC:112 method). */
    srmax?: number
    /** Mean strain difference ε_sm − ε_cm (IRC:112 method). */
    epsSmCm?: number
    /** Effective tension area A_c,eff, mm² (IRC:112 method). */
    AcEff?: number
    /** Effective reinforcement ratio ρ_p,eff (IRC:112 method). */
    rhoPeff?: number
    /** Load-duration factor k_t (IRC:112 method). */
    kt?: number
  }
}

interface CrackGeom {
  h: number
  x: number
  d: number
  b: number
  As: number
  c: number
  phi: number
}

/**
 * Derive the crack-width geometry (h, x, d, b, A_s, c, φ) for one load case
 * from the SLS cracked-section result and the section/bar data. The bending
 * direction is the case's moment direction `phi`, so the depth h and the
 * tension-bar cover c are measured in that plane.
 */
function crackGeom(model: AnalysisModel, bars: Rebar[], res: SlsCaseResult): CrackGeom {
  const frame = rotateFrame(model, res.phi)
  const h = Math.max(1e-6, frame.vmax - frame.vmin)
  const d = Number.isFinite(res.d) ? res.d : h
  const x = Number.isFinite(res.xu) ? res.xu : h
  // Tension bars are those the SLS solve placed in tension (negative stress).
  let As = 0
  for (let i = 0; i < bars.length; i++) {
    if (res.barStresses[i] < 0) As += barArea(bars[i].dia)
  }
  const tensionBar = res.tensionBar
  const phi = tensionBar >= 0 && bars[tensionBar] ? bars[tensionBar].dia : 0
  // Clear cover from the tension face to the surface of the extreme tension bar.
  const c = tensionBar >= 0 ? Math.max(0, frame.barsV[tensionBar] - frame.vmin - phi / 2) : 0
  // Effective width: exact for a rectangle, mean width for a general section.
  const b = model.areaNet / h
  return { h, x, d, b, As, c, phi }
}

function barArea(dia: number): number {
  return (Math.PI * dia * dia) / 4
}

/**
 * Crack-width check for one SLS load case. Returns null when there is no
 * flexural tension to crack (pure axial compression / no service bending).
 */
export function crackWidthCheck(
  code: DesignCodeId,
  fck: number,
  model: AnalysisModel,
  bars: Rebar[],
  res: SlsCaseResult,
  settings: CrackWidthSettings,
): CrackWidthResult | null {
  // No bending neutral axis → no flexural cracking to check.
  if (!Number.isFinite(res.xu)) return null
  const sigmaS = Math.max(0, res.sigmaSt)
  const wmax = wMaxFor(code, settings.exposure)
  const clause = clauseFor(code)
  const g = crackGeom(model, bars, res)

  // No tension-steel stress → section effectively uncracked in bending.
  if (sigmaS <= 1e-9 || g.As <= 1e-9) {
    return {
      caseId: res.caseId,
      caseName: res.caseName,
      w: 0,
      wmax,
      ratio: 0,
      ok: true,
      clause,
      sigmaS,
      uncracked: true,
      detail: { ...g },
    }
  }

  if (code === 'IRC112') {
    return irc112(res, g, fck, settings, wmax, clause, sigmaS)
  }
  // IS 456 Annex F and IRS CBC Cl 15.9.8.2 share the same structural formula.
  return annexF(res, g, wmax, clause, sigmaS)
}

/** IS 456 Annex F / IRS CBC Cl 15.9.8.2 — direct-stress surface crack width. */
export function annexFWidth(
  g: CrackGeom,
  sigmaS: number,
): { w: number; epsM: number; uncracked: boolean } {
  const { h, x, d, b, As, c } = g
  const eps1 = sigmaS / ES
  // Tension-stiffening reduction, evaluated at the tension face (a = h).
  const denom = 3 * ES * As * (d - x)
  const stiff = denom > 1e-9 ? (b * (h - x) * (h - x)) / denom : 0
  const epsM = eps1 - stiff
  // A negative mean strain means the section is uncracked under this action.
  if (epsM <= 0) return { w: 0, epsM, uncracked: true }
  // Surface crack over the extreme tension bar: a_cr = c_min = clear cover.
  const aCr = c
  const cMin = c
  const denomW = 1 + (2 * (aCr - cMin)) / Math.max(1e-6, h - x)
  const w = (3 * aCr * epsM) / denomW
  return { w, epsM, uncracked: false }
}

/** IRC:112 Cl 12.3.4 — Eurocode w_k = s_r,max·(ε_sm − ε_cm). */
export function irc112Width(
  g: CrackGeom,
  sigmaS: number,
  fck: number,
  longTerm: boolean,
): { w: number; srmax: number; epsSmCm: number; AcEff: number; rhoPeff: number; kt: number; uncracked: boolean } {
  const { h, x, d, b, As, c, phi } = g
  // Effective tension area and reinforcement ratio (Eq. 7.10).
  const hcEff = Math.max(0, Math.min(2.5 * (h - d), (h - x) / 3, h / 2))
  const AcEff = b * hcEff
  const rhoPeff = AcEff > 1e-9 ? As / AcEff : 0
  // Maximum crack spacing (Eq. 7.11), k1 = 0.8 high-bond, k2 = 0.5 bending.
  const k1 = 0.8
  const k2 = 0.5
  const srmax = rhoPeff > 1e-9 ? 3.4 * c + (0.425 * k1 * k2 * phi) / rhoPeff : 3.4 * c
  // Mean strain difference (Eq. 7.9), floored at 0.6·σ_s/E_s.
  const kt = longTerm ? 0.4 : 0.6
  const fctEff = fck <= 50 ? 0.3 * Math.pow(fck, 2 / 3) : 2.12 * Math.log(1 + fck / 10)
  const Ecm = 22000 * Math.pow((fck + 8) / 10, 0.3) // MPa
  const alphaE = ES / Ecm
  const floor = (0.6 * sigmaS) / ES
  const raw = rhoPeff > 1e-9 ? (sigmaS - kt * (fctEff / rhoPeff) * (1 + alphaE * rhoPeff)) / ES : floor
  const epsSmCm = Math.max(raw, floor)
  const w = srmax * epsSmCm
  return { w, srmax, epsSmCm, AcEff, rhoPeff, kt, uncracked: false }
}

/** IS 456 Annex F / IRS CBC Cl 15.9.8.2 result wrapper. */
function annexF(
  res: SlsCaseResult,
  g: CrackGeom,
  wmax: number,
  clause: string,
  sigmaS: number,
): CrackWidthResult {
  const { w, epsM, uncracked } = annexFWidth(g, sigmaS)
  const ratio = uncracked || wmax <= 0 ? (uncracked ? 0 : Infinity) : w / wmax
  return {
    caseId: res.caseId,
    caseName: res.caseName,
    w,
    wmax,
    ratio,
    ok: Number.isFinite(ratio) && ratio <= 1,
    clause,
    sigmaS,
    uncracked,
    detail: { ...g, epsM },
  }
}

/** IRC:112 Cl 12.3.4 result wrapper. */
function irc112(
  res: SlsCaseResult,
  g: CrackGeom,
  fck: number,
  settings: CrackWidthSettings,
  wmax: number,
  clause: string,
  sigmaS: number,
): CrackWidthResult {
  const { w, srmax, epsSmCm, AcEff, rhoPeff, kt } = irc112Width(g, sigmaS, fck, settings.longTerm)
  const ratio = wmax > 0 ? w / wmax : Infinity
  return {
    caseId: res.caseId,
    caseName: res.caseName,
    w,
    wmax,
    ratio,
    ok: Number.isFinite(ratio) && ratio <= 1,
    clause,
    sigmaS,
    uncracked: false,
    detail: { ...g, AcEff, rhoPeff, srmax, epsSmCm, kt },
  }
}
