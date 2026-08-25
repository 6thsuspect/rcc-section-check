import type { ConcreteModel, DesignCodeId, SteelModel } from './types'
import { steelBilinear, steelIS456 } from './materials'

/**
 * Code parameter registry. Every code-dependent constant lives here so a code
 * revision is a data change, not an engine change. Clause references: docs/06–08.
 * All values verified against the published code texts (see docs research notes).
 */

export interface SteelGradeSpec {
  label: string
  fy: number
  /** Characteristic uniform elongation εuk (IRC 112 Cl 6.2.2: 5% D-grades, 8% S-grades, 2.5% others). */
  euk: number
}

export interface CodeSpec {
  id: DesignCodeId
  name: string
  edition: string
  gammaC: number
  gammaS: number
  concreteGrades: number[]
  /** Grades above this get a "beyond code calibration" warning (IS 456 Table 2 Note 2). */
  gradeWarnAbove?: number
  steelGrades: SteelGradeSpec[]
  concrete: (fck: number) => ConcreteModel
  steel: (fy: number) => SteelModel
  /** Tension-side steel strain cap used to close the interaction surface. */
  epsSteelLimit: (grade: SteelGradeSpec) => number
  /**
   * Simplified squash load for the power-law biaxial check, N.
   * IS 456 Cl 39.6: 0.45fck·Ac + 0.75fy·Asc.  IRC 112 Cl 8.3.2: Ac·fcd + As·fyd.
   * IRS CBC eq. 17: 0.45fck·Ac + fyc·Asc.
   */
  simplifiedPuz: (fck: number, fy: number, Ag: number, Asc: number) => number
  /** Power-law exponent αn from axial-load ratio (shape: 'rect' | 'circ'). */
  alphaN: (ratio: number, shape: 'rect' | 'circ') => number
  /**
   * Minimum / nominal eccentricity for biaxial checks, mm.
   * IS 456 Cl 25.4: max(20, l/500 + D/30).
   * IRC 112: no general e_min — Cl 11.3.2.2 imperfection e_i = 15 + l0/800 ≤ 50 mm.
   * IRS CBC Cl 15.6.4 (biaxial): 0.03·D capped at 20 mm.
   */
  eMin: (l: number, D: number) => number
  eMinLabel: string
  /** Minimum steel area, mm² (may depend on axial load NEd in N). */
  minSteelArea: (Ag: number, NEd: number, fy: number) => number
  minSteelDescription: string
  maxSteelPct: number
  maxSteelPctLap: number
  minBarDia: number
  minBarsRect: number
  minBarsCirc: number
  maxBarSpacing: number
  /** Short-column slenderness threshold on l/D. */
  shortLimit: number
}

const GRADES_ALL: SteelGradeSpec[] = [
  { label: 'Fe250', fy: 250, euk: 0.05 },
  { label: 'Fe415', fy: 415, euk: 0.025 },
  { label: 'Fe415D', fy: 415, euk: 0.05 },
  { label: 'Fe500', fy: 500, euk: 0.025 },
  { label: 'Fe500D', fy: 500, euk: 0.05 },
  { label: 'Fe550', fy: 550, euk: 0.025 },
  { label: 'Fe550D', fy: 550, euk: 0.05 },
  { label: 'Fe600', fy: 600, euk: 0.025 },
]

/** IS 456:2000 — Cl 38.1 stress block, Cl 39.6 biaxial, Cl 25.4 e_min, Cl 26.5.3 detailing. */
const IS456: CodeSpec = {
  id: 'IS456',
  name: 'IS 456:2000',
  edition: 'Reaffirmed 2021, Amendments 1–4, with SP 16 design aids',
  gammaC: 1.5,
  gammaS: 1.15,
  // Amended Table 2: Standard M25–M60, High-strength M65–M80 offered with warning
  concreteGrades: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80],
  gradeWarnAbove: 60,
  steelGrades: GRADES_ALL,
  concrete: (fck) => ({ fcd: (0.67 * fck) / 1.5, ec2: 0.002, ecu: 0.0035, n: 2 }),
  steel: (fy) => (fy <= 250 ? steelBilinear(fy, 1.15) : steelIS456(fy)),
  epsSteelLimit: () => 0.05,
  simplifiedPuz: (fck, fy, Ag, Asc) => 0.45 * fck * (Ag - Asc) + 0.75 * fy * Asc,
  alphaN: (ratio) => Math.min(2, Math.max(1, 1 + ((ratio - 0.2) * 5) / 3)),
  eMin: (l, D) => Math.max(20, l / 500 + D / 30),
  eMinLabel: 'e_min = l/500 + D/30 ≥ 20 mm (Cl 25.4)',
  minSteelArea: (Ag) => 0.008 * Ag,
  minSteelDescription: '0.8% of gross section (Cl 26.5.3.1(a))',
  maxSteelPct: 4, // Note to Cl 26.5.3.1: >4% congests laps → warn; hard limit 6%
  maxSteelPctLap: 6,
  minBarDia: 12,
  minBarsRect: 4,
  minBarsCirc: 6,
  maxBarSpacing: 300,
  shortLimit: 12,
}

/** IRC:112-2020 — Cl 6.4.2.8 stress block (Table 6.5 / Annexure A2.2), Cl 8.3.2 biaxial, Cl 16.2 detailing. */
const IRC112: CodeSpec = {
  id: 'IRC112',
  name: 'IRC:112-2020',
  edition: 'Code of Practice for Concrete Road Bridges',
  gammaC: 1.5, // basic & seismic; 1.2 accidental (not exposed in rev A)
  gammaS: 1.15,
  concreteGrades: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90],
  steelGrades: GRADES_ALL.filter((g) => g.fy >= 415),
  concrete: (fck) => {
    const fcd = (0.67 * fck) / 1.5
    if (fck <= 60) return { fcd, ec2: 0.002, ecu: 0.0035, n: 2 }
    // Annexure A2.2 Eqs. A2-8/9/10 (cube strength; the 0.8 factor is printed in the code)
    const ec2 = (2.0 + 0.085 * Math.pow(0.8 * fck - 50, 0.53)) / 1000
    const ecu = (2.6 + 35 * Math.pow((90 - 0.8 * fck) / 100, 4)) / 1000
    const n = 1.4 + 23.4 * Math.pow((90 - 0.8 * fck) / 100, 4)
    return { fcd, ec2, ecu: Math.max(ecu, ec2), n }
  },
  steel: (fy) => steelBilinear(fy, 1.15),
  epsSteelLimit: (g) => 0.9 * g.euk,
  simplifiedPuz: (fck, fy, Ag, Asc) => ((0.67 * fck) / 1.5) * (Ag - Asc) + (fy / 1.15) * Asc,
  alphaN: (ratio, shape) => {
    if (shape === 'circ') return 2
    if (ratio <= 0.1) return 1
    if (ratio <= 0.7) return 1 + ((ratio - 0.1) * 0.5) / 0.6
    if (ratio >= 1) return 2
    return 1.5 + ((ratio - 0.7) * 0.5) / 0.3
  },
  eMin: (l) => Math.min(50, 15 + l / 800),
  eMinLabel: 'imperfection e_i = 15 + l0/800 ≤ 50 mm (Cl 11.3.2.2), one direction',
  minSteelArea: (Ag, NEd, fy) => Math.max((0.1 * Math.max(NEd, 0)) / (fy / 1.15), 0.002 * Ag),
  minSteelDescription: 'max(0.10·NEd/fyd, 0.002·Ac) (Cl 16.2.2)',
  maxSteelPct: 4,
  maxSteelPctLap: 8,
  minBarDia: 12,
  minBarsRect: 4,
  minBarsCirc: 6,
  maxBarSpacing: 200,
  shortLimit: 12,
}

/** IRS Concrete Bridge Code 1997 — Cl 15.6 columns, Fig 4A/4B materials, eq. 16/17 biaxial. */
const IRSCBC: CodeSpec = {
  id: 'IRSCBC',
  name: 'IRS Concrete Bridge Code',
  edition: '1997, Reprint 2014, ACS up to 8',
  gammaC: 1.5,
  gammaS: 1.15,
  concreteGrades: [20, 25, 30, 35, 40, 45, 50, 55, 60],
  steelGrades: GRADES_ALL.filter((g) => g.fy <= 550),
  // Fig 4A: parabola to ε0 = 2.44e-4·√(fck/γm), plateau 0.67·fck/γm, εcu = 0.0035
  concrete: (fck) => ({
    fcd: (0.67 * fck) / 1.5,
    ec2: 2.44e-4 * Math.sqrt(fck / 1.5),
    ecu: 0.0035,
    n: 2,
  }),
  steel: (fy) => ({
    ...steelBilinear(fy, 1.15),
    // Cl 15.6.3.3: design compressive stress limited to fyc = fy/(γm + fy/2000)
    compressionCap: fy / (1.15 + fy / 2000),
  }),
  epsSteelLimit: () => 0.05,
  simplifiedPuz: (fck, fy, Ag, Asc) =>
    0.45 * fck * (Ag - Asc) + (fy / (1.15 + fy / 2000)) * Asc,
  // Table 19: αn = 1.0 / 1.33 / 1.67 / 2.0 at P/Puz = 0.2 / 0.4 / 0.6 / 0.8 (linear)
  alphaN: (ratio) => Math.min(2, Math.max(1, 1 + ((ratio - 0.2) * 5) / 3)),
  eMin: (_l, D) => Math.min(20, 0.03 * D),
  eMinLabel: 'nominal e = 0.03·h ≤ 20 mm each axis (Cl 15.6.4)',
  minSteelArea: (Ag, NEd, fy) => Math.min(0.01 * Ag, (0.15 * Math.max(NEd, 0)) / fy),
  minSteelDescription: 'lesser of 1.0% of section or 0.15·P/fy (Cl 15.9.4.1)',
  maxSteelPct: 6, // vertically cast (Cl 15.9.5.2); 8% at laps
  maxSteelPctLap: 8,
  minBarDia: 12,
  minBarsRect: 4,
  minBarsCirc: 6,
  maxBarSpacing: 300,
  shortLimit: 12,
}

export const CODES: Record<DesignCodeId, CodeSpec> = { IS456, IRC112, IRSCBC }
