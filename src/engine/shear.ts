/**
 * Shear design check — concrete shear resistance, shear reinforcement design,
 * minimum / maximum reinforcement limits and spacing requirements.
 *
 * The module is **self-contained**: it reads the shared section geometry,
 * materials and cover model, but nothing in the ULS or SLS modules depends on
 * it (and it never mutates shared state). Each code is implemented from its own
 * clauses — the three methods are structurally different and are never mixed:
 *
 *  - **IS 456:2000** — nominal shear stress τv = Vu/(b·d) (Cl 40.1); design shear
 *    strength of concrete τc from Table 19 (Cl 40.2.1), multiplied by δ for axial
 *    compression (Cl 40.2.2) and by 2d/av near supports (Cl 40.3); τc,max from
 *    Table 20 (Cl 40.2.3); stirrups carry Vus = Vu − τc·b·d (Cl 40.4);
 *    minimum stirrups Asv/(b·sv) ≥ 0.4/(0.87 fy) (Cl 26.5.1.6); maximum spacing
 *    0.75d and 300 mm (Cl 26.5.1.5).
 *
 *  - **IRC:112-2020** — members without design shear reinforcement:
 *    VRd,c = [0.12·K·(100·ρl·fck)^(1/3) + 0.15·σcp]·bw·d, K = 1 + √(200/d) ≤ 2
 *    (Cl 10.3.2); members with shear reinforcement use the **variable strut
 *    inclination** truss: VRd,s = (Asw/s)·z·fywd·cot θ and
 *    VRd,max = αcw·bw·z·ν1·fcd/(cot θ + tan θ) with 1.0 ≤ cot θ ≤ 2.5
 *    (Cl 10.3.3.2); the concrete term is *not* added to the stirrup term;
 *    minimum shear reinforcement ρw,min = 0.072·√fck/fyk (Cl 10.3.3.5, detailing
 *    counterpart Cl 16.5.2); maximum link spacing 0.75·d (1 + cot α) (Cl 16.5.2).
 *
 *  - **IRS Concrete Bridge Code 1997** — shear stress v = V/(b·d) (Cl 15.4.3.1);
 *    ultimate shear stress in concrete vc from Table 15 (BS 5400-4 lineage,
 *    vc = 0.79·(100As/bd)^(1/3)·(fck/25)^(1/3)/1.25, M40-or-more column) times the
 *    depth factor βs from Table 16, βs = (500/d)^(1/4) ≥ 0.70; v shall not exceed
 *    0.75·√fck or 4.75 N/mm², whichever is the lesser (Cl 15.4.3.1); links per
 *    Table 14 — Asv ≥ 0.4·b·sv/(0.87 fyv) when v ≤ βs·vc and
 *    Asv ≥ b·sv·(v + 0.4 − βs·vc)/(0.87 fyv) when v > βs·vc, with fyv ≤ 415 N/mm²;
 *    columns: βs·vc × (1 + 0.05·P/Ac) (Cl 15.6.6); maximum leg spacing 0.75d.
 *
 * Everything is computed in N and mm; the UI layer converts to kN / kN·m.
 */
import type { ComplianceCheck, DesignCodeId, Point, Rebar, SectionGeometry } from './types'
import type { CoverSpec } from './cover'
import { outerCover } from './cover'
import { barArea, chordAt, signedArea } from './geometry'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** Direction of the applied shear. `y` = shear along the section y-axis
 * (bending about x), `x` = shear along the section x-axis. */
export type ShearAxis = 'y' | 'x'
/** Member type — drives the axial-compression enhancement and link rules. */
export type ShearMember = 'beam' | 'column'

/**
 * One shear load case. `Vu` is the already-factored design shear force at the
 * critical section; `Pu` is the accompanying factored axial load of the same
 * combination (compression positive) — used only by the provisions that
 * enhance the concrete shear strength under axial compression.
 */
export interface ShearLoadCase {
  id: string
  name: string
  /** Factored design shear force, kN. */
  Vu: number
  /** Factored axial load of the same combination, kN (compression +). */
  Pu: number
}

export interface ShearSettings {
  axis: ShearAxis
  /** Flexural tension face — sets which side's reinforcement resists shear. */
  tensionFace: 'bottom' | 'right' | 'top' | 'left'
  member: ShearMember
  /** Link (stirrup) diameter, mm. */
  linkDia: number
  /** Number of legs crossing the shear plane. */
  linkLegs: number
  /** Provided link spacing along the member, mm. */
  linkSpacing: number
  /** Web width, mm — null = automatic (net chord width at mid-depth). */
  bOverride: number | null
  /** Effective depth, mm — null = automatic (compression fibre → tension steel). */
  dOverride: number | null
  /** Tension steel area, mm² — null = automatic (tension-face bars). */
  aslOverride: number | null
  /** Distance from the face of the support to the critical section, mm (0 = not given). */
  criticalDistance: number
  /** Apply the IS 456 Cl 40.3 enhanced shear strength close to a support. */
  enhance: boolean
  /** IRC 112 strut inclination cot θ (1.0 … 2.5). */
  cotTheta: number
  /**
   * Shear-reinforcement type — the shape of the closed link. `auto` follows the
   * section (circular for circular/hollow-circular sections, a perimeter link
   * for everything else); the explicit values force that shape and are flagged
   * when the section cannot take it.
   */
  linkShape: 'auto' | 'rectangular' | 'circular'
  /**
   * Where the leg / cross-tie arrangement comes from. `auto` derives it from the
   * longitudinal cage on every render (so it follows bar and geometry edits);
   * `manual` keeps the entered positions.
   */
  linkLayout: 'auto' | 'manual'
  /** Intermediate leg positions, manual mode, 0…1 across the shear-plane width. */
  legPositions: number[]
  /** Cross-tie positions, manual mode, 0…1 across the shear-plane depth. */
  tiePositions: number[]
}

export const DEFAULT_SHEAR: ShearSettings = {
  axis: 'y',
  tensionFace: 'bottom',
  member: 'column',
  linkDia: 8,
  linkLegs: 2,
  linkSpacing: 150,
  bOverride: null,
  dOverride: null,
  aslOverride: null,
  criticalDistance: 0,
  enhance: false,
  cotTheta: 1.0,
  linkShape: 'auto',
  linkLayout: 'auto',
  legPositions: [],
  tiePositions: [],
}

export const MIN_COT_THETA = 1.0
export const MAX_COT_THETA = 2.5

/** Section data used by every shear check (auto-derived, overridable). */
export interface ShearSectionData {
  axis: ShearAxis
  /** Depth direction is y (axis = 'y') or x (axis = 'x'). */
  tensionFace: ShearSettings['tensionFace']
  /** Face opposite the tension face (extreme compression fibre). */
  compressionFace: ShearSettings['tensionFace']
  /** Overall depth in the shear/bending plane, mm. */
  h: number
  /** Web / section width perpendicular to the shear plane, mm. */
  b: number
  /** Effective depth, compression fibre → centroid of tension steel, mm. */
  d: number
  /** Tension reinforcement area used, mm². */
  Asl: number
  /** Gross concrete area (boundary − voids), mm². */
  Ac: number
  /** Clear cover to the links on the tension face, mm. */
  coverTension: number
  /** Bars counted as tension reinforcement. */
  tensionBarCount: number
  /** Where the automatic values came from (for the UI / report echo). */
  bAuto: number
  dAuto: number
  AslAuto: number
  /** True when the tension steel was picked by the half-depth fallback. */
  tensionByHalfDepth: boolean
  /** Largest longitudinal bar diameter, mm. */
  maxBarDia: number
}

/** One line of the step-by-step calculation shown for the selected case. */
export interface ShearStep {
  clause: string
  title: string
  /** Formula / expression as written. */
  expr: string
  /** Substituted value or result. */
  value: string
}

export interface ShearCaseResult {
  loadCase: ShearLoadCase
  section: ShearSectionData
  /** Design shear force at the section, N. */
  VEd: number
  /** Nominal shear stress τv (IS 456 / IRS CBC) or v (IRS CBC), N/mm². */
  tauV: number
  /** Design shear strength of concrete used (after δ / enhancement), N/mm². */
  tauC: number
  /** Design shear strength of concrete before the code factors, N/mm². */
  tauCBase: number
  /** Code's maximum shear stress (τc,max / VRd,max-equivalent stress), N/mm². */
  tauCMax: number
  /** Concrete contribution to the shear resistance, N. */
  Vc: number
  /** Shear assigned to the shear reinforcement, N. */
  Vs: number
  /** Required shear reinforcement, mm²/mm (total legs, per unit length). */
  asvPerSReq: number
  /** Required shear reinforcement from the code's minimum rule, mm²/mm. */
  asvPerSMin: number
  /** Provided shear reinforcement, mm²/mm (total legs). */
  asvPerSProvided: number
  /** Total cross-sectional area of the provided legs, mm². */
  asvProvided: number
  /** Capacity of the provided section, N. */
  VRd: number
  /** Upper limit on the resistance set by the web crushing check, N. */
  VRdMax: number
  /** Maximum permitted link spacing, mm. */
  spaceMax: number
  /** Spacing that exactly provides the required reinforcement, mm. */
  spaceReq: number
  /** Provided spacing, mm. */
  spaceProvided: number
  /** Demand/capacity ratio (≤ 1 passes). */
  ratio: number
  /** τv / τc,max (or v / vmax) — web crushing utilisation. */
  stressRatio: number
  ok: boolean
  checks: ComplianceCheck[]
  steps: ShearStep[]
  notes: string[]
}

/** Static description of each code's shear method, for the UI and report. */
export interface ShearCodeInfo {
  method: string
  /** Clause list shown under the summary. */
  references: string[]
  maxStress: string
  minLinks: string
  maxSpacing: string
}

export const SHEAR_CODE_INFO: Record<DesignCodeId, ShearCodeInfo> = {
  IS456: {
    method: 'Nominal shear stress τv = Vu/(b·d) against the design shear strength of concrete τc (Table 19); stirrups designed for Vus = Vu − τc·b·d.',
    references: ['40.1 τv', '40.2.1 τc (Table 19)', '40.2.2 axial δ', '40.2.3 τc,max (Table 20)', '40.3 enhanced shear near support', '40.4 stirrup design', '26.5.1.5 max spacing', '26.5.1.6 min stirrups'],
    maxStress: 'τv ≤ τc,max (Table 20: M20 2.8 · M25 3.1 · M30 3.5 · M35 3.7 · M40 and above 4.0 N/mm²)',
    minLinks: 'Asv/(b·sv) ≥ 0.4/(0.87·fy) (Cl 26.5.1.6) — provided in all beams',
    maxSpacing: '0.75·d for vertical stirrups, ≤ 300 mm (Cl 26.5.1.5)',
  },
  IRC112: {
    method: 'Variable strut inclination truss: concrete strength VRd,c below which links are not required by calculation (Cl 10.3.2); links designed for the full VEd when VEd > VRd,c, with the web crushing check VRd,max (Cl 10.3.3.2). The concrete term is not added to the stirrup term.',
    references: ['10.3.2 VRd,c (members without links)', '10.3.3.2 VRd,s, VRd,max, Asw,max', '10.3.3.5 minimum shear reinforcement', '16.5.2 spacing (detailing)'],
    maxStress: 'VEd ≤ VRd,max = αcw·bw·z·ν1·fcd/(cot θ + tan θ), ν1 = 0.6(1 − fck/250)',
    minLinks: 'ρw ≥ 0.072·√fck/fyk (Cl 10.3.3.5)',
    maxSpacing: 'sl,max = 0.75·d·(1 + cot α) — 0.75·d for vertical links (Cl 16.5.2)',
  },
  IRSCBC: {
    method: 'Ultimate shear stress v = V/(b·d) against the ultimate shear stress in concrete βs·vc (Table 15 × Table 16 depth factor); links per Table 14.',
    references: ['15.4.3.1 shear stress & maximum', '15.4.3.2 vc (Table 15) × βs (Table 16)', '15.4.3.3 links (Table 14)', '15.4.3.4 spacing', '15.6.6 column shear & biaxial rule'],
    maxStress: 'v ≤ 0.75·√fck or 4.75 N/mm², whichever is the lesser (Cl 15.4.3.1)',
    minLinks: 'Asv ≥ 0.4·b·sv/(0.87·fyv) (Table 14), fyv ≤ 415 N/mm²',
    maxSpacing: '0.75·d (links: leg spacing both ways ≤ 0.75·d)',
  },
}

/* ------------------------------------------------------------------ */
/* Code tables                                                        */
/* ------------------------------------------------------------------ */

/** IS 456 Table 19 — 100·As/(b·d) rows (%). */
const IS456_PT = [0.15, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0]
/** IS 456 Table 19 — τc N/mm², columns M20 · M25 · M30 · M35 · M40 and above. */
const IS456_TAU_C = [
  [0.28, 0.29, 0.29, 0.29, 0.3],
  [0.36, 0.36, 0.37, 0.37, 0.38],
  [0.48, 0.49, 0.5, 0.5, 0.51],
  [0.56, 0.57, 0.59, 0.59, 0.6],
  [0.62, 0.64, 0.66, 0.67, 0.68],
  [0.67, 0.7, 0.71, 0.73, 0.74],
  [0.72, 0.74, 0.76, 0.78, 0.79],
  [0.75, 0.78, 0.8, 0.82, 0.84],
  [0.79, 0.82, 0.84, 0.86, 0.88],
  [0.81, 0.85, 0.88, 0.9, 0.92],
  [0.82, 0.88, 0.91, 0.93, 0.95],
  [0.82, 0.9, 0.94, 0.96, 0.98],
  [0.82, 0.92, 0.96, 0.99, 1.01],
]

/** Column index of Table 19 / Table 20 for a concrete grade. */
function is456Column(fck: number): number {
  if (fck >= 40) return 4 // "M40 and above"
  if (fck >= 35) return 3
  if (fck >= 30) return 2
  if (fck >= 25) return 1
  return 0
}

/** IS 456 Table 20 — maximum shear stress τc,max, N/mm². */
function is456TauCMax(fck: number): number {
  if (fck >= 40) return 4.0
  if (fck >= 35) return 3.7
  if (fck >= 30) return 3.5
  if (fck >= 25) return 3.1
  if (fck >= 20) return 2.8
  return 2.5
}

/** Linear interpolation in Table 19 (clamped at both ends). */
function is456TauC(fck: number, pt: number): number {
  const col = is456Column(fck)
  if (pt <= IS456_PT[0]) return IS456_TAU_C[0][col]
  if (pt >= IS456_PT[IS456_PT.length - 1]) return IS456_TAU_C[IS456_PT.length - 1][col]
  for (let i = 0; i + 1 < IS456_PT.length; i++) {
    const p0 = IS456_PT[i]
    const p1 = IS456_PT[i + 1]
    if (pt >= p0 && pt <= p1) {
      const t = (pt - p0) / (p1 - p0)
      return IS456_TAU_C[i][col] + t * (IS456_TAU_C[i + 1][col] - IS456_TAU_C[i][col])
    }
  }
  return IS456_TAU_C[IS456_TAU_C.length - 1][col]
}

/**
 * IRS CBC Table 15 — ultimate shear stress in concrete vc, N/mm².
 * The tabulated values follow the BS 5400-4 / BS 8110 lineage expression
 * `vc = 0.79·(100·As/(b·d))^(1/3)·(fck/25)^(1/3)/1.25` with the concrete grade
 * capped at the "M40 or more" column, which reproduces the printed table to the
 * second decimal (e.g. M25 at 100As/bd = 1.0 → 0.79·1·1/1.25 = 0.63).
 */
function irsCbcVc(fck: number, pt: number): number {
  const p = Math.max(pt, 0.15)
  const grade = Math.min(fck, 40)
  const vc = (0.79 * Math.cbrt(p) * Math.cbrt(grade / 25)) / 1.25
  return Math.round(vc * 100) / 100
}

/** IRS CBC Table 16 — depth factor βs. */
function irsCbcDepthFactor(d: number): number {
  return Math.max(Math.pow(500 / Math.max(d, 1), 0.25), 0.7)
}

/** IRS CBC maximum shear stress, N/mm² (Cl 15.4.3.1). */
function irsCbcVMax(fck: number): number {
  return Math.min(0.75 * Math.sqrt(fck), 4.75)
}

/* ------------------------------------------------------------------ */
/* Section data                                                       */
/* ------------------------------------------------------------------ */

const TENSION_FACE_BY_AXIS: Record<ShearAxis, [ShearSettings['tensionFace'], ShearSettings['tensionFace']]> = {
  y: ['bottom', 'top'],
  x: ['left', 'right'],
}

/** The two faces a shear direction can put in tension. */
export function tensionFaceOptions(axis: ShearAxis): ShearSettings['tensionFace'][] {
  const pair = TENSION_FACE_BY_AXIS[axis]
  return [pair[0], pair[1]]
}

function depthIsY(axis: ShearAxis): boolean {
  return axis === 'y'
}

/** True when the tension face lies at the *larger* coordinate of the depth axis. */
function tensionAtMax(settings: Pick<ShearSettings, 'axis' | 'tensionFace'>): boolean {
  return settings.tensionFace === TENSION_FACE_BY_AXIS[settings.axis][1]
}

const OPPOSITE_FACE: Record<ShearSettings['tensionFace'], ShearSettings['tensionFace']> = {
  bottom: 'top',
  top: 'bottom',
  left: 'right',
  right: 'left',
}

/**
 * Derive the shear design dimensions from the shared section model:
 *
 *  - `h` from the boundary extremes in the shear (depth) direction;
 *  - `b` = net chord width of the concrete at mid-depth — the web width for a
 *    T/I/L beam, the sum of the web widths for a box section, the diameter for a
 *    circular section (all overridable);
 *  - `Asl` / `d` from the bars lying on the tension face (or, for hand-entered
 *    coordinate tables without face metadata, the bars in the tension half),
 *    weighted by area for the effective depth.
 */
export function shearSectionData(
  geometry: SectionGeometry,
  bars: Rebar[],
  cover: CoverSpec,
  settings: ShearSettings,
): ShearSectionData {
  const byY = depthIsY(settings.axis)
  const vOf = (p: Point) => (byY ? p.y : p.x)
  const wOf = (p: Point) => (byY ? p.x : p.y)
  const boundary = geometry.boundary
  const vAll = boundary.map(vOf)
  const vMin = Math.min(...vAll)
  const vMax = Math.max(...vAll)
  const wAll = boundary.map(wOf)
  const wMin = Math.min(...wAll)
  const wMax = Math.max(...wAll)
  const h = Math.max(vMax - vMin, 0)

  // --- web width: net chord at mid-depth (voids subtracted) ---
  const uv = (poly: Point[]) => poly.map((p) => (byY ? { x: p.x, y: p.y } : { x: p.y, y: p.x }))
  const vMid = (vMin + vMax) / 2
  let bAuto = chordAt(uv(boundary), vMid).w
  for (const vd of geometry.voids) bAuto -= chordAt(uv(vd), vMid).w
  if (!(bAuto > 0)) bAuto = Math.max(wMax - wMin, 0)

  // --- gross concrete area (for the axial-stress provisions) ---
  let Ac = Math.abs(signedArea(boundary))
  for (const vd of geometry.voids) Ac -= Math.abs(signedArea(vd))

  // --- tension reinforcement ---
  const faceOf = (b: Rebar): string[] => (b.faces?.length ? b.faces : b.face ? [b.face] : [])
  const outerBars = bars.filter((b) => (b.surface ?? 'outer') === 'outer')
  let tensionBars = outerBars.filter((b) => faceOf(b).includes(settings.tensionFace))
  let byHalfDepth = false
  if (tensionBars.length === 0) {
    byHalfDepth = true
    const atMax = tensionAtMax(settings)
    tensionBars = outerBars.filter((b) => (atMax ? vOf(b) >= vMid : vOf(b) <= vMid))
  }

  const AslAuto = tensionBars.reduce((s, b) => s + barArea(b.dia), 0)
  const vBarCentroid =
    AslAuto > 0 ? tensionBars.reduce((s, b) => s + barArea(b.dia) * vOf(b), 0) / AslAuto : vMid
  const compressionExtreme = tensionAtMax(settings) ? vMin : vMax
  const dAuto = Math.abs(compressionExtreme - vBarCentroid)
  const maxBarDia = bars.reduce((m, b) => Math.max(m, b.dia), 0)

  const b = settings.bOverride && settings.bOverride > 0 ? settings.bOverride : bAuto
  const d = settings.dOverride && settings.dOverride > 0 ? settings.dOverride : dAuto
  const Asl = settings.aslOverride && settings.aslOverride > 0 ? settings.aslOverride : AslAuto

  return {
    axis: settings.axis,
    tensionFace: settings.tensionFace,
    compressionFace: OPPOSITE_FACE[settings.tensionFace],
    h,
    b,
    d,
    Asl,
    Ac,
    coverTension: outerCover(cover, settings.tensionFace),
    tensionBarCount: tensionBars.length,
    bAuto,
    dAuto,
    AslAuto,
    tensionByHalfDepth: byHalfDepth,
    maxBarDia,
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const f = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'

function check(
  clause: string,
  title: string,
  demand: string,
  limit: string,
  ok: boolean,
  kind: ComplianceCheck['kind'] = 'check',
  note?: string,
): ComplianceCheck {
  return { clause, title, demand, limit, status: ok ? 'pass' : 'fail', kind, note }
}

function report(clause: string, title: string, demand: string, limit: string, note?: string): ComplianceCheck {
  return { clause, title, demand, limit, status: 'info', kind: 'report', note }
}

/* ------------------------------------------------------------------ */
/* The check                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run the shear design check for one load case under the selected code.
 * Returns the full step-by-step record used by the UI and the report.
 */
export function shearCheck(
  code: DesignCodeId,
  fck: number,
  fy: number,
  geometry: SectionGeometry,
  bars: Rebar[],
  cover: CoverSpec,
  settings: ShearSettings,
  lc: ShearLoadCase,
): ShearCaseResult {
  const section = shearSectionData(geometry, bars, cover, settings)
  const VEd = Math.max(lc.Vu, 0) * 1e3 // N
  const b = section.b
  const d = section.d
  const notes: string[] = []

  if (!(b > 0) || !(d > 0)) {
    return {
      loadCase: lc,
      section,
      VEd,
      tauV: 0,
      tauC: 0,
      tauCBase: 0,
      tauCMax: 0,
      Vc: 0,
      Vs: VEd,
      asvPerSReq: 0,
      asvPerSMin: 0,
      asvPerSProvided: 0,
      asvProvided: 0,
      VRd: 0,
      VRdMax: 0,
      spaceMax: 0,
      spaceReq: 0,
      spaceProvided: settings.linkSpacing,
      ratio: Number.POSITIVE_INFINITY,
      stressRatio: Number.POSITIVE_INFINITY,
      ok: false,
      checks: [check('—', 'Section dimensions', 'b or d ≤ 0', 'b, d > 0', false, 'check', 'Define the section geometry and reinforcement, or enter b / d manually.')],
      steps: [],
      notes: ['Shear design needs a positive web width b and effective depth d.'],
    }
  }

  const asvProvided = settings.linkLegs * barArea(settings.linkDia)
  const spacing = Math.max(settings.linkSpacing, 1)
  const asvPerSProvided = asvProvided / spacing

  if (section.tensionByHalfDepth) {
    notes.push(
      'No bar metadata matched the tension face, so the tension reinforcement was taken as the bars in the tension half of the section. Check the tension face selection or override Asl / d.',
    )
  }
  if (Math.abs(section.b - section.bAuto) > 1e-6) {
    notes.push(`Web width b = ${f(section.b, 0)} mm entered manually (automatic chord at mid-depth = ${f(section.bAuto, 0)} mm).`)
  }
  if (Math.abs(section.d - section.dAuto) > 1e-6) {
    notes.push(`Effective depth d = ${f(section.d, 0)} mm entered manually (automatic value = ${f(section.dAuto, 0)} mm).`)
  }

  switch (code) {
    case 'IS456':
      return checkIS456(fck, fy, settings, section, lc, VEd, asvProvided, asvPerSProvided, spacing, notes)
    case 'IRC112':
      return checkIRC112(fck, fy, settings, section, lc, VEd, asvProvided, asvPerSProvided, spacing, notes)
    case 'IRSCBC':
      return checkIRSCBC(fck, fy, settings, section, lc, VEd, asvProvided, asvPerSProvided, spacing, notes)
    default:
      return checkIS456(fck, fy, settings, section, lc, VEd, asvProvided, asvPerSProvided, spacing, notes)
  }
}

type Shared = {
  loadCase: ShearLoadCase
  section: ShearSectionData
  VEd: number
  asvProvided: number
  asvPerSProvided: number
  spaceProvided: number
  Vc: number
  Vs: number
  asvPerSReq: number
  asvPerSMin: number
  tauV: number
  tauC: number
  tauCBase: number
  tauCMax: number
  VRd: number
  VRdMax: number
  spaceMax: number
  spaceReq: number
  ratio: number
  stressRatio: number
  notes: string[]
}

function finish(s: Shared, checks: ComplianceCheck[], steps: ShearStep[], okOverride?: boolean): ShearCaseResult {
  const ok =
    okOverride ??
    (checks.every((c) => c.kind === 'report' || c.status === 'pass') && s.ratio <= 1.0001 && s.stressRatio <= 1.0001)
  return {
    loadCase: s.loadCase,
    section: s.section,
    VEd: s.VEd,
    tauV: s.tauV,
    tauC: s.tauC,
    tauCBase: s.tauCBase,
    tauCMax: s.tauCMax,
    Vc: s.Vc,
    Vs: s.Vs,
    asvPerSReq: s.asvPerSReq,
    asvPerSMin: s.asvPerSMin,
    asvPerSProvided: s.asvPerSProvided,
    asvProvided: s.asvProvided,
    VRd: s.VRd,
    VRdMax: s.VRdMax,
    spaceMax: s.spaceMax,
    spaceReq: s.spaceReq,
    spaceProvided: s.spaceProvided,
    ratio: s.ratio,
    stressRatio: s.stressRatio,
    ok,
    checks,
    steps,
    notes: s.notes,
  }
}

/** Common step lines describing how b, d and Asl were obtained. */
function sectionSteps(section: ShearSectionData): ShearStep[] {
  const dir = section.axis === 'y' ? 'y (bending about x)' : 'x (bending about y)'
  return [
    {
      clause: 'section',
      title: 'Shear direction',
      expr: 'V acts along the section',
      value: `${dir}, tension face = ${section.tensionFace}, compression face = ${section.compressionFace}`,
    },
    {
      clause: 'section',
      title: 'Overall depth in the shear plane',
      expr: 'h = v_max − v_min',
      value: `${f(section.h, 0)} mm`,
    },
    {
      clause: 'section',
      title: 'Web / section width',
      expr: 'b = net chord width at mid-depth',
      value: `${f(section.b, 0)} mm${Math.abs(section.b - section.bAuto) > 1e-6 ? ' (entered)' : ' (automatic)'}`,
    },
    {
      clause: 'section',
      title: 'Effective depth',
      expr: 'd = compression fibre → centroid of tension steel',
      value: `${f(section.d, 0)} mm${Math.abs(section.d - section.dAuto) > 1e-6 ? ' (entered)' : ' (automatic)'}`,
    },
    {
      clause: 'section',
      title: 'Tension reinforcement',
      expr: 'Asl = Σ area of tension-face bars',
      value: `${f(section.Asl, 0)} mm² (${section.tensionBarCount} bars)`,
    },
  ]
}

/* ------------------------------ IS 456 ----------------------------- */

function checkIS456(
  fck: number,
  fy: number,
  settings: ShearSettings,
  section: ShearSectionData,
  lc: ShearLoadCase,
  VEd: number,
  asvProvided: number,
  asvPerSProvided: number,
  spacing: number,
  notes: string[],
): ShearCaseResult {
  const { b, d, Asl, Ac } = section
  const pt = (100 * Asl) / (b * d)
  const tauV = VEd / (b * d)
  const tauCBase = is456TauC(fck, pt)
  const tauCMax = is456TauCMax(fck)

  // Cl 40.2.2 — axial compression multiplier
  const Pu = Math.max(lc.Pu, 0) * 1e3
  const delta = Pu > 0 && Ac > 0 ? Math.min(1.5, 1 + (3 * Pu) / (Ac * fck)) : 1

  // Cl 40.3 — enhanced shear strength close to a support
  const av = settings.criticalDistance
  const enhanceFactor = settings.enhance && av > 0 && av < 2 * d ? (2 * d) / av : 1
  const tauC = Math.min(tauCBase * delta * enhanceFactor, tauCMax)

  const Vc = tauC * b * d
  const Vs = Math.max(VEd - Vc, 0)
  const asvPerSDesign = Vs / (0.87 * fy * d)
  const asvPerSMin = (0.4 * b) / (0.87 * fy)
  const asvPerSReq = Math.max(asvPerSDesign, asvPerSMin)
  const spaceMax = Math.min(0.75 * d, 300)
  const spaceReq = asvProvided / Math.max(asvPerSReq, 1e-12)
  const VsProvided = (0.87 * fy * asvProvided * d) / spacing
  const VRd = Vc + VsProvided
  const ratio = VEd / Math.max(VRd, 1e-9)
  const stressRatio = tauV / tauCMax

  if (fck > 40) {
    notes.push(
      'IS 456 Tables 19 and 20 tabulate the "M40 and above" column; the higher-grade columns are not printed in the code, so the M40 values are used (conservative).',
    )
  }
  if (enhanceFactor > 1) {
    notes.push(`Enhanced shear strength applied at av = ${f(av, 0)} mm from the support face (Cl 40.3): τc × ${f(enhanceFactor, 3)}.`)
  } else if (settings.enhance && av >= 2 * d) {
    notes.push(`av = ${f(av, 0)} mm ≥ 2d, so no shear enhancement applies (Cl 40.3).`)
  }
  if (delta > 1) {
    notes.push(`Axial compression multiplier δ = 1 + 3·Pu/(Ag·fck) = ${f(delta, 3)} applied to τc (Cl 40.2.2).`)
  }
  if (tauV <= tauCBase) {
    notes.push('τv ≤ τc — no shear reinforcement is required by calculation, but the minimum stirrups of Cl 26.5.1.6 are still provided.')
  }

  const checks: ComplianceCheck[] = [
    check(
      '40.1',
      'Nominal shear stress',
      `τv = Vu/(b·d) = ${f(tauV, 3)} N/mm²`,
      `b = ${f(b, 0)} mm, d = ${f(d, 0)} mm`,
      true,
      'report',
    ),
    check(
      '40.2.3 · Table 20',
      'Maximum shear stress with shear reinforcement',
      `${f(tauV, 3)} N/mm²`,
      `τc,max = ${f(tauCMax, 2)} N/mm² (M${Math.min(Math.max(fck, 20), 40)}${fck > 40 ? ' and above' : ''})`,
      tauV <= tauCMax,
      'enforce',
      tauV <= tauCMax ? undefined : 'The section must be enlarged or the concrete grade increased.',
    ),
    report(
      '40.2.1 · Table 19',
      'Design shear strength of concrete',
      `pt = ${f(pt, 3)}% → τc = ${f(tauCBase, 3)} N/mm²`,
      `τv = ${f(tauV, 3)} N/mm²`,
      tauV > tauCBase
        ? 'τv > τc — shear reinforcement is required to carry Vus = Vu − τc·b·d.'
        : 'τv ≤ τc — the concrete alone is adequate; minimum stirrups apply.',
    ),
    check(
      '26.5.1.6',
      'Minimum shear reinforcement',
      `Asv/(b·sv) = ${f(asvPerSProvided, 4)} mm²/mm`,
      `≥ ${f(asvPerSMin, 4)} mm²/mm = 0.4·b/(0.87·fy)`,
      asvPerSProvided + 1e-9 >= asvPerSMin,
    ),
    check(
      '40.4',
      'Shear reinforcement for Vus',
      `Asv/(b·sv) provided = ${f(asvPerSProvided, 4)} mm²/mm`,
      `required = ${f(asvPerSReq, 4)} mm²/mm (Vus = ${f(Vs / 1e3, 1)} kN)`,
      asvPerSProvided + 1e-9 >= asvPerSReq,
      'check',
      `Vs = 0.87·fy·Asv·d/sv with fy = ${f(fy, 0)} N/mm²`,
    ),
    check(
      '26.5.1.5',
      'Maximum stirrup spacing',
      `sv provided = ${f(spacing, 0)} mm`,
      `≤ min(0.75·d, 300) = ${f(spaceMax, 0)} mm`,
      spacing <= spaceMax + 0.01,
    ),
    check(
      '26.5.3.2(c)',
      'Link diameter',
      `⌀${f(settings.linkDia, 0)} mm`,
      `≥ max(6 mm, ¼ × largest bar) = ${f(Math.max(6, section.maxBarDia / 4), 1)} mm`,
      settings.linkDia + 1e-9 >= Math.max(6, section.maxBarDia / 4),
    ),
  ]

  if (delta > 1) {
    checks.splice(
      3,
      0,
      report('40.2.2', 'Axial compression multiplier', `δ = ${f(delta, 3)}`, '≤ 1.5', 'δ = 1 + 3·Pu/(Ag·fck), Ag = Ac + Asl.'),
    )
  }
  if (enhanceFactor > 1) {
    checks.splice(
      3,
      0,
      report(
        '40.3',
        'Enhanced shear strength near support',
        `τc × 2d/av = ${f(tauCBase, 3)} × ${f(enhanceFactor, 3)} = ${f(tauCBase * enhanceFactor, 3)} N/mm²`,
        `≤ τc,max = ${f(tauCMax, 2)} N/mm²`,
        `av = ${f(av, 0)} mm ≤ 2d = ${f(2 * d, 0)} mm`,
      ),
    )
  }

  const steps: ShearStep[] = [
    ...sectionSteps(section),
    {
      clause: '40.1',
      title: 'Nominal shear stress',
      expr: 'τv = Vu/(b·d)',
      value: `${f(VEd / 1e3, 1)}×10³ / (${f(b, 0)} × ${f(d, 0)}) = ${f(tauV, 3)} N/mm²`,
    },
    {
      clause: 'Table 19 (40.2.1)',
      title: 'Percentage tension steel',
      expr: 'pt = 100·Asl/(b·d)',
      value: `100 × ${f(Asl, 0)} / (${f(b, 0)} × ${f(d, 0)}) = ${f(pt, 3)} %`,
    },
    {
      clause: 'Table 19 (40.2.1)',
      title: 'Design shear strength of concrete',
      expr: 'τc = f(pt, M-grade)',
      value: `${f(tauCBase, 3)} N/mm²`,
    },
    ...(delta > 1
      ? [
          {
            clause: '40.2.2',
            title: 'Axial compression multiplier',
            expr: 'δ = 1 + 3·Pu/(Ag·fck) ≤ 1.5',
            value: `1 + 3 × ${f(Pu / 1e3, 1)} × 10³ / (${f(Ac, 0)} × ${f(fck, 0)}) = ${f(delta, 3)}`,
          },
        ]
      : []),
    ...(enhanceFactor > 1
      ? [
          {
            clause: '40.3',
            title: 'Enhanced shear near support',
            expr: "τc' = (2d/av)·τc ≤ τc,max",
            value: `(2×${f(d, 0)}/${f(av, 0)}) × ${f(tauCBase, 3)} = ${f(tauCBase * enhanceFactor, 3)} N/mm² → adopted τc = ${f(tauC, 3)} N/mm²`,
          },
        ]
      : []),
    {
      clause: '40.2.3 · Table 20',
      title: 'Maximum shear stress',
      expr: 'τc,max = f(fck)',
      value: `${f(tauCMax, 2)} N/mm² → τv/τc,max = ${f(stressRatio, 3)}`,
    },
    {
      clause: '40.4',
      title: 'Concrete shear resistance',
      expr: 'Vc = τc·b·d',
      value: `${f(tauC, 3)} × ${f(b, 0)} × ${f(d, 0)} = ${f(Vc / 1e3, 1)} kN`,
    },
    {
      clause: '40.4',
      title: 'Shear to be carried by stirrups',
      expr: 'Vus = Vu − Vc (≥ 0)',
      value: `${f(VEd / 1e3, 1)} − ${f(Vc / 1e3, 1)} = ${f(Vs / 1e3, 1)} kN`,
    },
    {
      clause: '40.4',
      title: 'Stirrup design (vertical legs)',
      expr: 'Asv/sv = Vus/(0.87·fy·d)',
      value: `${f(Vs, 1)} / (0.87 × ${f(fy, 0)} × ${f(d, 0)}) = ${f(asvPerSDesign, 4)} mm²/mm`,
    },
    {
      clause: '26.5.1.6',
      title: 'Minimum shear reinforcement',
      expr: 'Asv/(b·sv) ≥ 0.4/(0.87·fy)',
      value: `≥ ${f(asvPerSMin, 4)} mm²/mm → governing ${f(asvPerSReq, 4)} mm²/mm`,
    },
    {
      clause: 'provided',
      title: 'Provided links',
      expr: 'Asv/sv = (legs · π·⌀²/4)/sv',
      value: `(${settings.linkLegs} × ${f(asvProvided / settings.linkLegs, 1)} mm²)/${f(spacing, 0)} = ${f(asvPerSProvided, 4)} mm²/mm → Vs,prov = ${f(VsProvided / 1e3, 1)} kN`,
    },
    {
      clause: '26.5.1.5',
      title: 'Maximum spacing',
      expr: 'sv,max = min(0.75·d, 300 mm)',
      value: `${f(spaceMax, 0)} mm → spacing for the required steel ${f(spaceReq, 0)} mm`,
    },
  ]

  return finish(
    {
      loadCase: lc,
      section,
      VEd,
      asvProvided,
      asvPerSProvided,
      spaceProvided: spacing,
      Vc,
      Vs,
      asvPerSReq,
      asvPerSMin,
      tauV,
      tauC,
      tauCBase,
      tauCMax,
      VRd,
      VRdMax: tauCMax * b * d,
      spaceMax,
      spaceReq,
      ratio,
      stressRatio,
      notes,
    },
    checks,
    steps,
  )
}

/* ------------------------------ IRC 112 ---------------------------- */

function checkIRC112(
  fck: number,
  fy: number,
  settings: ShearSettings,
  section: ShearSectionData,
  lc: ShearLoadCase,
  VEd: number,
  asvProvided: number,
  asvPerSProvided: number,
  spacing: number,
  notes: string[],
): ShearCaseResult {
  const { b, d, Asl, Ac } = section
  const fcd = (0.67 * fck) / 1.5
  const tauV = VEd / (b * d)

  // Cl 10.3.2 — members not requiring design shear reinforcement
  const K = Math.min(1 + Math.sqrt(200 / d), 2.0)
  const rhoL = Math.min(Asl / (b * d), 0.02)
  const Pu = Math.max(lc.Pu, 0) * 1e3
  const sigmaCp = Pu > 0 && Ac > 0 ? Math.min(Pu / Ac, 0.2 * fcd) : 0
  const vRdcExpr = 0.12 * K * Math.cbrt(100 * rhoL * fck) + 0.15 * sigmaCp
  // Lower bound on VRd,c (EC2 6.2.2(1) form adopted by IRC:112 Cl 10.3.2). [verify
  // the printed coefficient/expression against the code text before release.]
  const vmin = 0.035 * Math.pow(K, 1.5) * Math.sqrt(fck)
  const vRdcMinExpr = vmin + 0.15 * sigmaCp
  const vRdc = Math.max(vRdcExpr, vRdcMinExpr)
  const VRdc = vRdc * b * d

  // Cl 10.3.3.2 — variable strut inclination
  const z = 0.9 * d
  const cot = Math.min(Math.max(settings.cotTheta, MIN_COT_THETA), MAX_COT_THETA)
  const tan = 1 / cot
  const nu1 = 0.6 * (1 - fck / 250)
  const alphaCw = 1.0
  const VRdMax = (alphaCw * b * z * nu1 * fcd) / (cot + tan)
  // fywd = fywk/γs. [verify: an equivalent 0.8·fywk form is also quoted in
  // secondary sources — resolve against the code text before release.]
  const fywd = fy / 1.15
  const VsDesign = Math.max(VEd - VRdc, 0)
  const asvPerSDesign = VsDesign / (z * fywd * cot)
  // ρw,min = 0.072·√fck/fyk (IRC:112 Cl 10.3.3.5; detailing counterpart Cl 16.5.2). [verify clause text]
  const asvPerSMin = (0.072 * Math.sqrt(fck) * b) / fy
  const asvPerSReq = Math.max(asvPerSDesign, asvPerSMin)
  const spaceMax = 0.75 * d // vertical links, α = 90° → (1 + cot α) = 1
  const spaceReq = asvProvided / Math.max(asvPerSReq, 1e-12)
  const VRds = ((asvProvided / spacing) * z * fywd * cot)
  const VRd = Math.min(VRds, VRdMax)
  const ratio = VEd / Math.max(VRd, 1e-9)
  const stressRatio = VEd / Math.max(VRdMax, 1e-9)
  // Cl 10.3.3.2 — Asw,max limit
  const aswMaxLimit = (0.5 * alphaCw * nu1 * fcd * b) / fywd

  if (settings.cotTheta !== cot) {
    notes.push(`cot θ was limited to the code range 1.0 … 2.5 (entered ${f(settings.cotTheta, 2)}).`)
  }
  if (VEd <= VRdc) {
    notes.push('VEd ≤ VRd,c — no shear reinforcement is required by calculation; the minimum links of Cl 10.3.3.5 are still provided.')
  } else {
    notes.push(
      'Variable strut inclination model: the links are designed for the full VEd (VRd,c is not added to VRd,s), and the concrete crushing limit VRd,max is checked separately (Cl 10.3.3.2).',
    )
  }
  if (sigmaCp > 0) {
    notes.push(`Axial compression term σcp = NEd/Ac = ${f(sigmaCp, 3)} N/mm² included in VRd,c (≤ 0.2·fcd).`)
  }

  const checks: ComplianceCheck[] = [
    report(
      '10.3.2',
      'Shear resistance of the concrete (no links required below this)',
      `VRd,c = ${f(VRdc / 1e3, 1)} kN`,
      `VEd = ${f(VEd / 1e3, 1)} kN`,
      VEd <= VRdc
        ? 'VEd ≤ VRd,c — no shear reinforcement is required by calculation (minimum links still apply).'
        : 'VEd > VRd,c — design shear reinforcement is required; the links carry the full VEd.',
    ),
    check(
      '10.3.3.2',
      'Web crushing — maximum shear the strut can carry',
      `VEd = ${f(VEd / 1e3, 1)} kN`,
      `VRd,max = ${f(VRdMax / 1e3, 1)} kN`,
      VEd <= VRdMax,
      'enforce',
      `ν1 = 0.6(1 − fck/250) = ${f(nu1, 3)}, z = 0.9·d, cot θ = ${f(cot, 2)}`,
    ),
    check(
      '10.3.3.2',
      'Shear reinforcement resistance',
      `VRd,s = ${f(VRds / 1e3, 1)} kN (provided ${f(asvPerSProvided, 4)} mm²/mm)`,
      `VEd = ${f(VEd / 1e3, 1)} kN`,
      VRds + 1e-3 >= VEd,
    ),
    check(
      '10.3.3.5',
      'Minimum shear reinforcement',
      `ρw = ${f(asvPerSProvided / b, 5)} (provided)`,
      `≥ ${f(asvPerSMin / b, 5)} = 0.072·√fck/fyk`,
      asvPerSProvided + 1e-9 >= asvPerSMin,
    ),
    check(
      '10.3.3.2',
      'Maximum shear reinforcement (Asw,max)',
      `Asw·fywd/(bw·s) = ${f((asvPerSProvided * fywd) / b, 3)} N/mm²`,
      `≤ 0.5·αcw·ν1·fcd = ${f(0.5 * alphaCw * nu1 * fcd, 3)} N/mm²`,
      asvPerSProvided * fywd / b <= 0.5 * alphaCw * nu1 * fcd + 1e-9,
      'check',
      `Limit = ${f(aswMaxLimit, 4)} mm²/mm`,
    ),
    check(
      '16.5.2',
      'Maximum link spacing',
      `sl provided = ${f(spacing, 0)} mm`,
      `≤ ${f(spaceMax, 0)} mm = 0.75·d·(1 + cot α)`,
      spacing <= spaceMax + 0.01,
    ),
    check(
      '16.2.3',
      'Link diameter',
      `⌀${f(settings.linkDia, 0)} mm`,
      `≥ ${f(settings.member === 'column' ? Math.max(8, section.maxBarDia / 4) : Math.max(6, section.maxBarDia / 4), 1)} mm`,
      settings.linkDia + 1e-9 >= (settings.member === 'column' ? Math.max(8, section.maxBarDia / 4) : Math.max(6, section.maxBarDia / 4)),
    ),
  ]

  checks.push(
    report('10.3.2', 'Size-effect factor K', `K = ${f(K, 3)}`, 'K = 1 + √(200/d) ≤ 2.0', `d = ${f(d, 0)} mm`),
  )

  const steps: ShearStep[] = [
    ...sectionSteps(section),
    {
      clause: '10.3.2',
      title: 'Tension reinforcement ratio',
      expr: 'ρl = Asl/(bw·d) ≤ 0.02',
      value: `${f(Asl, 0)} / (${f(b, 0)} × ${f(d, 0)}) = ${f(Asl / (b * d), 5)} → ${f(rhoL, 5)}`,
    },
    {
      clause: '10.3.2',
      title: 'Size-effect factor',
      expr: 'K = 1 + √(200/d) ≤ 2.0',
      value: `1 + √(200/${f(d, 0)}) = ${f(K, 3)}`,
    },
    ...(sigmaCp > 0
      ? [
          {
            clause: '10.3.2',
            title: 'Axial stress term',
            expr: 'σcp = NEd/Ac ≤ 0.2·fcd',
            value: `${f(Pu / 1e3, 1)}×10³/${f(Ac, 0)} = ${f(Pu / Ac, 3)} → ${f(sigmaCp, 3)} N/mm²`,
          },
        ]
      : []),
    {
      clause: '10.3.2',
      title: 'Shear resistance without links',
      expr: 'VRd,c = [0.12·K·(100·ρl·fck)^(1/3) + 0.15·σcp]·bw·d',
      value: `[0.12×${f(K, 3)}×(${f(rhoL, 5)}×${f(fck, 0)})^(1/3) + 0.15×${f(sigmaCp, 3)}] × ${f(b, 0)} × ${f(d, 0)} = ${f(VRdc / 1e3, 1)} kN`,
    },
    {
      clause: '10.3.2',
      title: 'Lower bound on VRd,c',
      expr: 'vmin = 0.035·K^(3/2)·√fck',
      value: `${f(vmin, 3)} N/mm² → ${f((vRdcMinExpr * b * d) / 1e3, 1)} kN (adopted VRd,c = ${f(VRdc / 1e3, 1)} kN)`,
    },
    {
      clause: '10.3.3.2',
      title: 'Lever arm and strut parameters',
      expr: 'z = 0.9·d; ν1 = 0.6(1 − fck/250); cot θ',
      value: `z = ${f(z, 0)} mm; ν1 = ${f(nu1, 3)}; cot θ = ${f(cot, 2)} (θ = ${f((Math.atan(1 / cot) * 180) / Math.PI, 1)}°)`,
    },
    {
      clause: '10.3.3.2',
      title: 'Web crushing limit',
      expr: 'VRd,max = αcw·bw·z·ν1·fcd/(cot θ + tan θ)',
      value: `1.0 × ${f(b, 0)} × ${f(z, 0)} × ${f(nu1, 3)} × ${f(fcd, 2)} / (${f(cot, 2)} + ${f(tan, 3)}) = ${f(VRdMax / 1e3, 1)} kN`,
    },
    {
      clause: '10.3.3.2',
      title: 'Shear reinforcement required',
      expr: 'Asw/s = VEd/(z·fywd·cot θ)',
      value: `${f(VEd, 1)} / (${f(z, 0)} × ${f(fywd, 1)} × ${f(cot, 2)}) = ${f(asvPerSDesign, 4)} mm²/mm (fywd = fyk/1.15 = ${f(fywd, 1)} N/mm²)`,
    },
    {
      clause: '10.3.3.5',
      title: 'Minimum shear reinforcement',
      expr: 'Asw/s ≥ 0.072·√fck·bw/fyk',
      value: `${f(asvPerSMin, 4)} mm²/mm → governing ${f(asvPerSReq, 4)} mm²/mm`,
    },
    {
      clause: '10.3.3.2',
      title: 'Provided links',
      expr: 'VRd,s = (legs·π⌀²/4/s)·z·fywd·cot θ',
      value: `${f(asvPerSProvided, 4)} × ${f(z, 0)} × ${f(fywd, 1)} × ${f(cot, 2)} = ${f(VRds / 1e3, 1)} kN`,
    },
    {
      clause: '16.5.2',
      title: 'Maximum spacing',
      expr: 'sl,max = 0.75·d·(1 + cot α)',
      value: `${f(spaceMax, 0)} mm → spacing for the required steel ${f(spaceReq, 0)} mm`,
    },
  ]

  return finish(
    {
      loadCase: lc,
      section,
      VEd,
      asvProvided,
      asvPerSProvided,
      spaceProvided: spacing,
      Vc: VRdc,
      Vs: VEd,
      asvPerSReq,
      asvPerSMin,
      tauV,
      tauC: vRdc,
      tauCBase: vRdc,
      tauCMax: VRdMax / (b * d),
      VRd,
      VRdMax,
      spaceMax,
      spaceReq,
      ratio,
      stressRatio,
      notes,
    },
    checks,
    steps,
  )
}

/* --------------------------- IRS CBC 1997 -------------------------- */

function checkIRSCBC(
  fck: number,
  fy: number,
  settings: ShearSettings,
  section: ShearSectionData,
  lc: ShearLoadCase,
  VEd: number,
  asvProvided: number,
  asvPerSProvided: number,
  spacing: number,
  notes: string[],
): ShearCaseResult {
  const { b, d, Asl, Ac } = section
  const pt = (100 * Asl) / (b * d)
  const v = VEd / (b * d)
  const vc = irsCbcVc(fck, pt)
  const beta = irsCbcDepthFactor(d)
  let svc = beta * vc
  const vMax = irsCbcVMax(fck)
  const fyLinkCap = 415
  const fyv = Math.min(fy, fyLinkCap)

  // Cl 15.6.6 — columns under axial compression
  const Pu = Math.max(lc.Pu, 0) * 1e3
  const axialFactor = settings.member === 'column' && Pu > 0 && Ac > 0 ? 1 + (0.05 * Pu) / Ac : 1
  svc *= axialFactor

  const asvPerSDesign = v <= svc ? (0.4 * b) / (0.87 * fyv) : (b * (v + 0.4 - svc)) / (0.87 * fyv)
  const asvPerSMin = (0.4 * b) / (0.87 * fyv)
  const asvPerSReq = Math.max(asvPerSDesign, asvPerSMin)
  const spaceMax = 0.75 * d
  const spaceReq = asvProvided / Math.max(asvPerSReq, 1e-12)
  const Vc = svc * b * d
  // Capacity of the provided links: invert the Table 14 expression. The "+0.4"
  // term is the code's nominal link stress, so the resisting stress is
  // svc − 0.4 + 0.87·fyv·(Asv/sv)/b once v exceeds svc.
  const vSteelStress = (0.87 * fyv * asvPerSProvided) / b
  const vResisted = v <= svc ? svc : svc - 0.4 + vSteelStress
  const VRd = Math.min(vResisted * b * d, vMax * b * d)
  const ratio = VEd / Math.max(VRd, 1e-9)
  const stressRatio = v / vMax

  if (fck > 40) {
    notes.push('IRS CBC Table 15 gives the "M40 or more" column for grades above M40; the M40 column is used.')
  }
  if (axialFactor > 1) {
    notes.push(`Column shear enhancement (1 + 0.05·P/Ac) = ${f(axialFactor, 3)} applied to βs·vc (Cl 15.6.6).`)
  }
  if (fy > fyLinkCap) {
    notes.push(`Link steel strength limited to ${fyLinkCap} N/mm² for the Table 14 expressions (IRS CBC shear/link reinforcement cap; entered fy = ${f(fy, 0)} N/mm²).`)
  }
  notes.push('The IRS CBC / BS 5400-4 lineage does not add a near-support enhancement to this design aid; enter VEd at the critical section.')

  const checks: ComplianceCheck[] = [
    check(
      '15.4.3.1',
      'Maximum shear stress (web crushing)',
      `v = V/(b·d) = ${f(v, 3)} N/mm²`,
      `≤ ${f(vMax, 3)} N/mm² = min(0.75·√fck, 4.75)`,
      v <= vMax,
      'enforce',
      v <= vMax ? undefined : 'Increase the web width or the concrete grade — the web crushes before the links yield.',
    ),
    check(
      'Table 14 (15.4.3.3)',
      'Shear reinforcement',
      `Asv = ${f(asvPerSProvided * spacing, 1)} mm² @ ${f(spacing, 0)} mm = ${f(asvPerSProvided, 4)} mm²/mm`,
      `required ${f(asvPerSReq, 4)} mm²/mm`,
      asvPerSProvided + 1e-9 >= asvPerSReq,
      'check',
      v <= svc
        ? 'v ≤ βs·vc → nominal links: Asv ≥ 0.4·b·sv/(0.87·fyv).'
        : 'v > βs·vc → Asv ≥ b·sv·(v + 0.4 − βs·vc)/(0.87·fyv).',
    ),
    check(
      '15.4.3.4',
      'Maximum link spacing',
      `sv provided = ${f(spacing, 0)} mm`,
      `≤ 0.75·d = ${f(spaceMax, 0)} mm`,
      spacing <= spaceMax + 0.01,
    ),
    check(
      '15.9.4.3',
      'Link diameter',
      `⌀${f(settings.linkDia, 0)} mm`,
      `≥ max(6 mm, ¼ × largest bar) = ${f(Math.max(6, section.maxBarDia / 4), 1)} mm`,
      settings.linkDia + 1e-9 >= Math.max(6, section.maxBarDia / 4),
    ),
    report(
      'Table 15 / Table 16 (15.4.3.2)',
      'Ultimate shear stress in concrete',
      `βs·vc = ${f(beta, 3)} × ${f(vc, 3)} = ${f(beta * vc, 3)} N/mm²`,
      `v = ${f(v, 3)} N/mm²`,
      v <= svc ? 'v ≤ βs·vc — the concrete alone is adequate; nominal links apply.' : 'v > βs·vc — links must carry the excess.',
    ),
    report(
      'Table 15 (15.4.3.2)',
      'Percentage tension steel',
      `100·As/(b·d) = ${f(pt, 3)} %`,
      'table rows 0.15 … ≥3.00 interpolated',
      `vc = 0.79·(100As/bd)^(1/3)·(fck/25)^(1/3)/1.25 = ${f(vc, 3)} N/mm², βs = (500/d)^(1/4) ≥ 0.70 = ${f(beta, 3)}`,
    ),
  ]

  if (axialFactor > 1) {
    checks.splice(
      1,
      0,
      report(
        '15.6.6',
        'Column shear — axial compression factor',
        `(1 + 0.05·P/Ac) = ${f(axialFactor, 3)}`,
        'applied to βs·vc (Table 15 and Table 16)',
        `P = ${f(Pu / 1e3, 1)} kN, Ac = ${f(Ac, 0)} mm²`,
      ),
    )
  }
  if (settings.member === 'column') {
    checks.push(
      report(
        '15.6.6',
        'Biaxial shear (columns)',
        'single-axis check',
        'Vx/Vux + Vy/Vuy ≤ 1.0',
        'Only one shear direction is checked in this tab — verify the biaxial interaction when shear acts about both axes.',
      ),
    )
  }

  const steps: ShearStep[] = [
    ...sectionSteps(section),
    { clause: '15.4.3.1', title: 'Shear stress', expr: 'v = V/(b·d)', value: `${f(VEd / 1e3, 1)}×10³ / (${f(b, 0)} × ${f(d, 0)}) = ${f(v, 3)} N/mm²` },
    {
      clause: '15.4.3.1',
      title: 'Maximum shear stress',
      expr: 'vmax = min(0.75·√fck, 4.75)',
      value: `${f(vMax, 3)} N/mm² → v/vmax = ${f(stressRatio, 3)}`,
    },
    {
      clause: 'Table 15 (15.4.3.2)',
      title: 'Ultimate shear stress in concrete',
      expr: 'vc = 0.79·(100As/bd)^(1/3)·(fck/25)^(1/3)/1.25',
      value: `(100As/bd = ${f(pt, 3)}%) → vc = ${f(vc, 3)} N/mm²`,
    },
    {
      clause: 'Table 16 (15.4.3.2)',
      title: 'Depth factor',
      expr: 'βs = (500/d)^(1/4) ≥ 0.70',
      value: `(500/${f(d, 0)})^(1/4) = ${f(beta, 3)}`,
    },
    ...(axialFactor > 1
      ? [
          {
            clause: '15.6.6',
            title: 'Column axial compression factor',
            expr: 'βs·vc × (1 + 0.05·P/Ac)',
            value: `${f(beta * vc, 3)} × ${f(axialFactor, 3)} = ${f(svc, 3)} N/mm²`,
          },
        ]
      : []),
    {
      clause: 'Table 14 (15.4.3.3)',
      title: 'Shear reinforcement (vertical links)',
      expr: v <= svc ? 'Asv ≥ 0.4·b·sv/(0.87·fyv)' : 'Asv ≥ b·sv·(v + 0.4 − βs·vc)/(0.87·fyv)',
      value:
        v <= svc
          ? `${f(asvPerSReq, 4)} mm²/mm (fyv = ${f(fyv, 0)} N/mm²)`
          : `b·sv·(${f(v, 3)} + 0.4 − ${f(svc, 3)})/(0.87 × ${f(fyv, 0)}) = ${f(asvPerSReq, 4)} mm²/mm`,
    },
    {
      clause: 'provided',
      title: 'Provided links',
      expr: 'Asv/sv = (legs · π·⌀²/4)/sv',
      value: `${f(asvPerSProvided, 4)} mm²/mm (${settings.linkLegs} legs ⌀${f(settings.linkDia, 0)} @ ${f(spacing, 0)} mm)`,
    },
    {
      clause: '15.4.3.4',
      title: 'Maximum spacing',
      expr: 'sv,max = 0.75·d',
      value: `${f(spaceMax, 0)} mm → spacing for the required steel ${f(spaceReq, 0)} mm`,
    },
  ]

  return finish(
    {
      loadCase: lc,
      section,
      VEd,
      asvProvided,
      asvPerSProvided,
      spaceProvided: spacing,
      Vc,
      Vs: VEd,
      asvPerSReq,
      asvPerSMin,
      tauV: v,
      tauC: svc,
      tauCBase: beta * vc,
      tauCMax: vMax,
      VRd,
      VRdMax: vMax * b * d,
      spaceMax,
      spaceReq,
      ratio,
      stressRatio,
      notes,
    },
    checks,
    steps,
  )
}

/* ------------------------------------------------------------------ */
/* Summary                                                            */
/* ------------------------------------------------------------------ */

export interface ShearSummary {
  /** Case with the highest demand/capacity ratio. */
  governing: ShearCaseResult | null
  anyFail: boolean
  /** Worst τv / τc,max over all cases. */
  worstStressRatio: number
  /** Worst VEd/VRd over all cases. */
  worstRatio: number
  /** Required reinforcement, mm²/mm — the largest requirement of all cases. */
  worstRequired: number
  /** Provided reinforcement, mm²/mm (identical for every case). */
  provided: number
  ok: boolean
  failCount: number
}

export function shearSummary(results: ShearCaseResult[]): ShearSummary {
  const list = results.filter((r) => Number.isFinite(r.ratio))
  const governing = list.reduce<ShearCaseResult | null>(
    (m, r) => (m === null || r.ratio > m.ratio ? r : m),
    null,
  )
  const worstStressRatio = list.reduce((m, r) => Math.max(m, r.stressRatio), 0)
  const worstRatio = list.reduce((m, r) => Math.max(m, r.ratio), 0)
  const worstRequired = list.reduce((m, r) => Math.max(m, r.asvPerSReq), 0)
  const failCount = list.filter((r) => !r.ok).length
  return {
    governing,
    anyFail: failCount > 0,
    worstStressRatio,
    worstRatio,
    worstRequired,
    provided: list.length > 0 ? list[0].asvPerSProvided : 0,
    ok: failCount === 0,
    failCount,
  }
}
