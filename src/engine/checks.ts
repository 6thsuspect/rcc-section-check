import type {
  ComplianceCheck,
  LoadCase,
  Rebar,
  SectionGeometry,
  SectionProperties,
} from './types'
import type { CodeSpec } from './codes'
import { pointInPolygon } from './geometry'

export interface CheckInputs {
  props: SectionProperties
  bars: Rebar[]
  geometry: SectionGeometry
  fck: number
  fy: number
  cases: LoadCase[]
  shapeClass: 'rect' | 'circ'
  /** Unsupported length, mm (optional — enables e_min and slenderness checks). */
  memberLength?: number
}

/** Clause labels per code (verified — see docs/06–08). */
const CLAUSES = {
  IS456: {
    minSteel: 'IS 456 Cl 26.5.3.1(a)',
    maxSteel: 'IS 456 Cl 26.5.3.1(a)+Note',
    minBars: 'IS 456 Cl 26.5.3.1(c)',
    minDia: 'IS 456 Cl 26.5.3.1(d)',
    spacing: 'IS 456 Cl 26.5.3.1(g)',
    clearance: 'IS 456 Cl 26.3.2',
    emin: 'IS 456 Cl 25.4 / 39.2',
    slender: 'IS 456 Cl 25.1.2',
    biaxial: 'IS 456 Cl 39.6',
    grade: 'IS 456 Table 2 (Amd 4)',
  },
  IRC112: {
    minSteel: 'IRC 112 Cl 16.2.2',
    maxSteel: 'IRC 112 Cl 16.2.2',
    minBars: 'IRC 112 Cl 16.2.2',
    minDia: 'IRC 112 Cl 16.2.2',
    spacing: 'IRC 112 Cl 16.2.2',
    clearance: 'IRC 112 Cl 15.2.1',
    emin: 'IRC 112 Cl 11.3.2.2',
    slender: 'IRC 112 Cl 11.2.1',
    biaxial: 'IRC 112 Cl 8.3.2',
    grade: 'IRC 112 Table 14.2',
  },
  IRSCBC: {
    minSteel: 'IRS CBC Cl 15.9.4.1',
    maxSteel: 'IRS CBC Cl 15.9.5.2',
    minBars: 'IRS CBC Cl 15.9.4.1',
    minDia: 'IRS CBC Cl 15.9.4.1',
    spacing: 'IRS CBC Cl 15.9.4.1',
    clearance: 'IRS CBC Cl 15.9.8',
    emin: 'IRS CBC Cl 15.6.4',
    slender: 'IRS CBC Cl 15.6.1.1 / 15.6.1.3',
    biaxial: 'IRS CBC Cl 15.6.4 eq. 16',
    grade: 'IRS CBC Table 4(b)',
  },
} as const

const fmt = (v: number, d = 1) => v.toFixed(d)

export function complianceChecks(spec: CodeSpec, inp: CheckInputs): ComplianceCheck[] {
  const out: ComplianceCheck[] = []
  const cl = CLAUSES[spec.id]
  const { props, bars } = inp

  // --- geometry sanity (enforced) ---
  const outside = bars.filter(
    (b) =>
      !pointInPolygon(b, inp.geometry.boundary) ||
      inp.geometry.voids.some((v) => pointInPolygon(b, v)),
  )
  out.push({
    clause: '—',
    title: 'All bars inside concrete',
    demand: outside.length === 0 ? `${bars.length} bars inside` : `${outside.length} bar(s) outside`,
    limit: '0 outside',
    status: outside.length === 0 ? 'pass' : 'fail',
    kind: 'enforce',
  })

  // --- concrete grade calibration warning (IS 456 Table 2 Note 2, Amd 4) ---
  if (spec.gradeWarnAbove && inp.fck > spec.gradeWarnAbove) {
    out.push({
      clause: cl.grade,
      title: 'High-strength concrete grade',
      demand: `M${inp.fck}`,
      limit: `> M${spec.gradeWarnAbove}`,
      status: 'warn',
      kind: 'report',
      note: 'Design parameters of this code may not be applicable above this grade (Table 2 Note 2); specialist literature applies',
    })
  }

  // --- longitudinal steel: minimum ---
  const NEdMax = Math.max(0, ...inp.cases.map((c) => c.Pu)) * 1e3 // N
  const asMin = spec.minSteelArea(props.area, NEdMax, inp.fy)
  out.push({
    clause: cl.minSteel,
    title: 'Minimum longitudinal steel',
    demand: `Asc = ${fmt(props.Asc, 0)} mm² (${fmt(props.p, 2)}%)`,
    limit: `≥ ${fmt(asMin, 0)} mm²`,
    status: props.Asc >= asMin ? 'pass' : 'fail',
    kind: 'check',
    note: spec.minSteelDescription,
  })

  // --- longitudinal steel: maximum ---
  out.push({
    clause: cl.maxSteel,
    title: 'Maximum longitudinal steel',
    demand: `p = ${fmt(props.p, 2)}%`,
    limit: `≤ ${fmt(spec.maxSteelPct, 0)}% (${fmt(spec.maxSteelPctLap, 0)}% abs./at laps)`,
    status:
      props.p <= spec.maxSteelPct ? 'pass' : props.p <= spec.maxSteelPctLap ? 'warn' : 'fail',
    kind: 'check',
  })

  // --- bar count & diameter ---
  const minBars = inp.shapeClass === 'circ' ? spec.minBarsCirc : spec.minBarsRect
  out.push({
    clause: cl.minBars,
    title: `Minimum number of bars (${inp.shapeClass === 'circ' ? 'circular' : 'rectangular'})`,
    demand: `${props.barCount} bars`,
    limit: `≥ ${minBars}`,
    status: props.barCount >= minBars ? 'pass' : 'fail',
    kind: 'check',
  })
  const minDiaUsed = bars.length ? Math.min(...bars.map((b) => b.dia)) : 0
  out.push({
    clause: cl.minDia,
    title: 'Minimum bar diameter',
    demand: `⌀${fmt(minDiaUsed, 0)}`,
    limit: `≥ ⌀${spec.minBarDia}`,
    status: minDiaUsed >= spec.minBarDia ? 'pass' : 'fail',
    kind: 'check',
  })

  // --- spacing along periphery (nearest-neighbour proxy) ---
  if (bars.length >= 2) {
    let worst = 0
    for (const b of bars) {
      let nearest = Infinity
      for (const o of bars) {
        if (o === b) continue
        nearest = Math.min(nearest, Math.hypot(o.x - b.x, o.y - b.y))
      }
      worst = Math.max(worst, nearest)
    }
    out.push({
      clause: cl.spacing,
      title: 'Bar spacing along periphery',
      demand: `max gap ≈ ${fmt(worst, 0)} mm`,
      limit: `≤ ${spec.maxBarSpacing} mm`,
      status: worst <= spec.maxBarSpacing ? 'pass' : 'warn',
      kind: 'check',
      note: 'Nearest-neighbour approximation of peripheral spacing',
    })
    // clear distance between bars
    let minClear = Infinity
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        const c =
          Math.hypot(bars[j].x - bars[i].x, bars[j].y - bars[i].y) -
          (bars[i].dia + bars[j].dia) / 2
        minClear = Math.min(minClear, c)
      }
    }
    const clearLimit = Math.max(minDiaUsed, 25)
    out.push({
      clause: cl.clearance,
      title: 'Clear distance between bars',
      demand: `${fmt(minClear, 0)} mm`,
      limit: `≥ ${fmt(clearLimit, 0)} mm`,
      status: minClear >= clearLimit ? 'pass' : minClear >= 0 ? 'warn' : 'fail',
      kind: 'check',
      note: '≥ bar dia and ≥ (aggregate + 5 mm); 20 mm aggregate assumed',
    })
  }

  // --- minimum eccentricity & slenderness ---
  const Dx = props.bbox.xmax - props.bbox.xmin
  const Dy = props.bbox.ymax - props.bbox.ymin
  if (inp.memberLength && inp.memberLength > 0) {
    const l = inp.memberLength
    const eminX = spec.eMin(l, Dy) // bending about X — depth is the Y dimension
    const eminY = spec.eMin(l, Dx)
    for (const c of inp.cases) {
      if (c.Pu <= 0) continue
      const mminX = (c.Pu * 1e3 * eminX) / 1e6 // kN·m
      const mminY = (c.Pu * 1e3 * eminY) / 1e6
      const okX = Math.abs(c.Mux) >= mminX
      const okY = Math.abs(c.Muy) >= mminY
      // IS 456 Cl 25.4: under biaxial bending, exceeding e_min about ONE axis
      // at a time is sufficient; both-axis satisfaction is the conservative case.
      const ok = spec.id === 'IS456' ? okX || okY : okX && okY
      out.push({
        clause: cl.emin,
        title: `Minimum / nominal eccentricity — case "${c.name}"`,
        demand: `|Mux| = ${fmt(Math.abs(c.Mux))} / |Muy| = ${fmt(Math.abs(c.Muy))} kN·m`,
        limit: `≥ ${fmt(mminX)} / ${fmt(mminY)} kN·m (e ${fmt(eminX, 0)} / ${fmt(eminY, 0)} mm)`,
        status: ok ? 'pass' : 'warn',
        kind: 'check',
        note: ok
          ? spec.eMinLabel
          : `${spec.eMinLabel} — applied moment below the nominal value; re-check with M = Pu·e`,
      })
    }
    const slX = l / Dy
    const slY = l / Dx
    const short = slX <= spec.shortLimit && slY <= spec.shortLimit
    out.push({
      clause: cl.slender,
      title: 'Slenderness (short-column screen)',
      demand: `l/D = ${fmt(slX)} (X), l/b = ${fmt(slY)} (Y)`,
      limit: `≤ ${spec.shortLimit} → short`,
      status: short ? 'pass' : 'warn',
      kind: 'report',
      note: short
        ? undefined
        : 'Member is slender — entered moments must include second-order effects (docs/03 §3.5)',
    })
  } else {
    out.push({
      clause: cl.emin,
      title: 'Minimum / nominal eccentricity',
      demand: 'member length not provided',
      limit: '—',
      status: 'info',
      kind: 'report',
      note: 'Provide unsupported length to evaluate the eccentricity and slenderness screens',
    })
  }

  out.push({
    clause: cl.biaxial,
    title: 'Simplified biaxial interaction (reported per load case)',
    demand: 'see results table',
    limit: '≤ 1.0',
    status: 'info',
    kind: 'report',
    note: 'The rigorous interaction-surface utilisation governs the verdict; the power-law value is reported for traceability',
  })

  return out
}
