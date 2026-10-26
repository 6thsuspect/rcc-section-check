import { describe, expect, it } from 'vitest'
import type { Polygon, Rebar, SectionGeometry } from '../types'
import { uniformCover } from '../cover'
import {
  DEFAULT_SHEAR,
  shearCheck,
  shearSectionData,
  shearSummary,
  type ShearLoadCase,
  type ShearSettings,
} from '../shear'

/* ------------------------------------------------------------------ *
 * Reference section for every hand calculation below:
 *   400 × 600 rectangle, M30, Fe500
 *   4 ⌀25 bottom (tension) + 4 ⌀25 top, clear cover 40 mm to the links,
 *   8 mm links  →  bar centres 40 + 8 + 12.5 = 60.5 mm from the face,
 *   effective depth d = 600 − 60.5 = 539.5 mm, Asl = 4 × 490.87 = 1963.5 mm².
 * ------------------------------------------------------------------ */

const poly = (w: number, h: number): Polygon => {
  const x = w / 2
  const y = h / 2
  return [
    { x: -x, y: -y },
    { x, y: -y },
    { x, y },
    { x: -x, y },
  ]
}

const geometry: SectionGeometry = { boundary: poly(400, 600), voids: [] }

function bars(): Rebar[] {
  const out: Rebar[] = []
  for (const x of [-139.5, -46.5, 46.5, 139.5]) {
    out.push({ x, y: -239.5, dia: 25, face: 'bottom', faces: ['bottom'], positioning: 'automatic' })
    out.push({ x, y: 239.5, dia: 25, face: 'top', faces: ['top'], positioning: 'automatic' })
  }
  return out
}

const cover = uniformCover(40)
const lc = (Vu: number, Pu = 0): ShearLoadCase => ({ id: 's1', name: 'SC1', Vu, Pu })

function run(
  code: 'IS456' | 'IRC112' | 'IRSCBC',
  caseRow: ShearLoadCase,
  patch: Partial<ShearSettings> = {},
  fck = 30,
  fy = 500,
) {
  const settings: ShearSettings = { ...DEFAULT_SHEAR, linkDia: 10, linkLegs: 2, linkSpacing: 150, ...patch }
  return shearCheck(code, fck, fy, geometry, bars(), cover, settings, caseRow)
}

/* --------------------------- section data -------------------------- */

describe('shear section data', () => {
  it('derives b, d and Asl from the section and reinforcement', () => {
    const s = shearSectionData(geometry, bars(), cover, { ...DEFAULT_SHEAR, axis: 'y', tensionFace: 'bottom' })
    expect(s.b).toBeCloseTo(400, 6)
    expect(s.h).toBeCloseTo(600, 6)
    expect(s.d).toBeCloseTo(539.5, 6)
    expect(s.Asl).toBeCloseTo(4 * Math.PI * 25 * 25 / 4, 6)
    expect(s.Ac).toBeCloseTo(240000, 6)
    expect(s.tensionBarCount).toBe(4)
    expect(s.compressionFace).toBe('top')
  })

  it('swaps the tension side with the selected face', () => {
    const s = shearSectionData(geometry, bars(), cover, { ...DEFAULT_SHEAR, axis: 'y', tensionFace: 'top' })
    expect(s.d).toBeCloseTo(539.5, 6)
    expect(s.compressionFace).toBe('bottom')
  })

  it('honours manual overrides', () => {
    const s = shearSectionData(geometry, bars(), cover, {
      ...DEFAULT_SHEAR,
      bOverride: 350,
      dOverride: 500,
      aslOverride: 1500,
    })
    expect(s.b).toBe(350)
    expect(s.d).toBe(500)
    expect(s.Asl).toBe(1500)
  })
})

/* ------------------------------ IS 456 ----------------------------- */

describe('IS 456:2000 shear (Cl 40, 26.5.1)', () => {
  it('reproduces the hand calculation', () => {
    const r = run('IS456', lc(300))
    // pt = 0.9099 %, τc interpolates Table 19 (M30) between 0.75 % → 0.59 and 1.00 % → 0.66
    expect(r.tauV).toBeCloseTo(300e3 / (400 * 539.5), 4)
    expect(r.tauCBase).toBeCloseTo(0.59 + ((0.90989 - 0.75) / 0.25) * 0.07, 3)
    // Vc = τc·b·d, Vus = Vu − Vc, Asv/sv = Vus/(0.87·fy·d)
    expect(r.Vc / 1e3).toBeCloseTo((r.tauC * 400 * 539.5) / 1e3, 3)
    expect(r.Vs / 1e3).toBeCloseTo(300 - r.Vc / 1e3, 3)
    expect(r.asvPerSReq).toBeCloseTo(r.Vs / (0.87 * 500 * 539.5), 4)
    expect(r.asvPerSMin).toBeCloseTo((0.4 * 400) / (0.87 * 500), 4)
    expect(r.spaceMax).toBeCloseTo(300, 6) // 0.75·d = 404.6 → 300 mm governs
    expect(r.asvPerSProvided).toBeCloseTo((2 * Math.PI * 100) / 4 / 150, 4)
    expect(r.ok).toBe(true)
    expect(r.checks.some((c) => c.clause === '40.2.3 · Table 20' && c.status === 'pass')).toBe(true)
  })

  it('fails the web-crushing limit when τv exceeds Table 20', () => {
    const r = run('IS456', lc(900)) // τv = 4.17 > τc,max = 3.5 for M30
    expect(r.tauV).toBeGreaterThan(3.5)
    const row = r.checks.find((c) => c.clause === '40.2.3 · Table 20')
    expect(row?.status).toBe('fail')
    expect(row?.kind).toBe('enforce')
    expect(r.ok).toBe(false)
  })

  it('applies the axial-compression multiplier δ (Cl 40.2.2), capped at 1.5', () => {
    const r = run('IS456', lc(300, 2000)) // δ = 1 + 3·2e6/(240000·30) = 1.833 → 1.5
    expect(r.tauC / r.tauCBase).toBeCloseTo(1.5, 3)
    expect(r.checks.some((c) => c.clause === '40.2.2')).toBe(true)
  })

  it('applies the near-support enhancement 2d/av (Cl 40.3) only when enabled', () => {
    const off = run('IS456', lc(300))
    const on = run('IS456', lc(300), { enhance: true, criticalDistance: 300 })
    expect(on.tauC / off.tauCBase).toBeCloseTo((2 * 539.5) / 300, 6)
    // without enhancement, av ≥ 2d gives factor 1
    const far = run('IS456', lc(300), { enhance: true, criticalDistance: 2000 })
    expect(far.tauC).toBeCloseTo(off.tauCBase, 6)
  })

  it('flags a spacing above 0.75d / 300 mm', () => {
    const ok = run('IS456', lc(300), { linkSpacing: 300 })
    expect(ok.checks.find((c) => c.clause === '26.5.1.5')?.status).toBe('pass')
    const bad = run('IS456', lc(300), { linkSpacing: 320 })
    expect(bad.checks.find((c) => c.clause === '26.5.1.5')?.status).toBe('fail')
    expect(bad.ok).toBe(false)
  })
})

/* ------------------------------ IRC 112 ---------------------------- */

describe('IRC:112-2020 shear (Cl 10.3, 16.5)', () => {
  it('reproduces the variable-strut hand calculation', () => {
    const r = run('IRC112', lc(300))
    const K = 1 + Math.sqrt(200 / 539.5)
    const rho = (4 * Math.PI * 625) / 4 / (400 * 539.5)
    const tRdc = 0.12 * K * Math.cbrt(100 * rho * 30)
    const VRdc = tRdc * 400 * 539.5
    expect(r.Vc / 1e3).toBeCloseTo(VRdc / 1e3, 1)
    // z = 0.9d, fywd = fyk/1.15, cot θ = 1 (default)
    const z = 0.9 * 539.5
    const required = (300e3 - VRdc) / (z * (500 / 1.15) * 1)
    expect(r.asvPerSReq).toBeGreaterThanOrEqual(required - 1e-6)
    expect(r.asvPerSMin).toBeCloseTo((0.072 * Math.sqrt(30) * 400) / 500, 4)
    // Web crushing: ν1 = 0.6(1 − 30/250), fcd = 0.67·30/1.5, cot θ = 1
    const nu1 = 0.6 * (1 - 30 / 250)
    const VRdMax = (1.0 * 400 * z * nu1 * ((0.67 * 30) / 1.5)) / 2
    expect(r.VRdMax / 1e3).toBeCloseTo(VRdMax / 1e3, 1)
    // Provided 2 ⌀10 @ 150 is short of the requirement → FAIL
    expect(r.ratio).toBeGreaterThan(1)
    expect(r.ok).toBe(false)
  })

  it('does not add the concrete term to the stirrup term (strut model)', () => {
    const r = run('IRC112', lc(300))
    expect(r.Vs).toBeCloseTo(r.VEd, 6)
  })

  it('clamps cot θ to 1.0 … 2.5 and changes the requirement with it', () => {
    const clashed = run('IRC112', lc(300), { cotTheta: 5 })
    expect(clashed.notes.some((n) => n.includes('cot θ was limited'))).toBe(true)
    const steep = run('IRC112', lc(300), { cotTheta: 1.0 })
    const shallow = run('IRC112', lc(300), { cotTheta: 2.5 })
    expect(shallow.asvPerSReq).toBeLessThan(steep.asvPerSReq)
    expect(shallow.VRdMax).toBeLessThan(steep.VRdMax)
  })

  it('includes the axial stress term σcp but not above 0.2·fcd', () => {
    const plain = run('IRC112', lc(300))
    const axial = run('IRC112', lc(300, 2000))
    expect(axial.Vc).toBeGreaterThan(plain.Vc)
    const huge = run('IRC112', lc(300, 40000))
    const fcd = (0.67 * 30) / 1.5
    expect(huge.Vc / (400 * 539.5)).toBeLessThanOrEqual(0.12 * (1 + Math.sqrt(200 / 539.5)) * Math.cbrt(100 * 0.0091 * 30) + 0.15 * 0.2 * fcd + 1e-3)
  })
})

/* ---------------------------- IRS CBC 1997 -------------------------- */

describe('IRS Concrete Bridge Code shear (Cl 15.4.3, 15.6.6)', () => {
  it('reproduces the hand calculation with the M25/M30 columns', () => {
    const r = run('IRSCBC', lc(300))
    const pt = (100 * ((4 * Math.PI * 625) / 4)) / (400 * 539.5)
    const vc = (0.79 * Math.cbrt(pt) * Math.cbrt(30 / 25)) / 1.25
    const beta = Math.pow(500 / 539.5, 0.25)
    expect(r.tauV).toBeCloseTo(300e3 / (400 * 539.5), 4)
    expect(r.tauC / beta).toBeCloseTo(vc, 2) // vc rounded to 2 dp in the table
    const svc = (Math.round(vc * 100) / 100) * beta
    const required = (400 * (r.tauV + 0.4 - svc)) / (0.87 * 415)
    expect(r.asvPerSReq).toBeCloseTo(required, 3)
    expect(r.tauCMax).toBeCloseTo(Math.min(0.75 * Math.sqrt(30), 4.75), 6)
    expect(r.spaceMax).toBeCloseTo(0.75 * 539.5, 6)
    expect(r.ok).toBe(false) // 2 ⌀10 @ 150 = 1.047 < 1.276 mm²/mm
  })

  it('caps the link steel strength at 415 N/mm²', () => {
    const fe500 = run('IRSCBC', lc(250), {}, 30, 500)
    const fe600 = run('IRSCBC', lc(250), {}, 30, 600)
    expect(fe600.asvPerSReq).toBeCloseTo(fe500.asvPerSReq, 6)
    expect(fe600.notes.some((n) => n.includes('415'))).toBe(true)
  })

  it('uses nominal links when v ≤ βs·vc', () => {
    const r = run('IRSCBC', lc(60))
    const nominal = (0.4 * 400) / (0.87 * 415)
    expect(r.asvPerSReq).toBeCloseTo(nominal, 6)
    expect(r.asvPerSProvided).toBeGreaterThan(nominal)
    expect(r.ok).toBe(true)
  })

  it('enhances βs·vc for columns under axial compression (Cl 15.6.6)', () => {
    const beam = run('IRSCBC', lc(250, 2000), { member: 'beam' })
    const column = run('IRSCBC', lc(250, 2000), { member: 'column' })
    expect(column.tauC / beam.tauC).toBeCloseTo(1 + (0.05 * 2e6) / 240000, 6)
  })

  it('fails the maximum shear stress check above 0.75√fck', () => {
    const r = run('IRSCBC', lc(1000)) // v = 4.63 > 4.108
    expect(r.stressRatio).toBeGreaterThan(1)
    expect(r.checks.find((c) => c.clause === '15.4.3.1' && c.kind === 'enforce')?.status).toBe('fail')
    expect(r.ok).toBe(false)
  })
})

/* --------------------------- code independence ---------------------- */

describe('code independence and summary', () => {
  it('keeps each code on its own method for the same inputs', () => {
    const is = run('IS456', lc(300))
    const irc = run('IRC112', lc(300))
    const irs = run('IRSCBC', lc(300))
    const values = [is.asvPerSReq, irc.asvPerSReq, irs.asvPerSReq]
    expect(new Set(values.map((v) => v.toFixed(4))).size).toBe(3)
    // IRC-specific inputs must not leak into the other codes
    expect(run('IS456', lc(300), { cotTheta: 2.5 }).asvPerSReq).toBeCloseTo(is.asvPerSReq, 9)
    expect(run('IRSCBC', lc(300), { cotTheta: 2.5 }).asvPerSReq).toBeCloseTo(irs.asvPerSReq, 9)
    // member type only affects the IRS CBC column enhancement
    expect(run('IS456', lc(300), { member: 'beam' }).tauC).toBeCloseTo(is.tauC, 9)
  })

  it('never mutates the shared section inputs', () => {
    const inputBars = bars()
    const snapshot = JSON.stringify(inputBars)
    run('IS456', lc(300))
    expect(JSON.stringify(inputBars)).toBe(snapshot)
  })

  it('summarises the cases with the governing demand', () => {
    const results = [run('IS456', lc(150)), run('IS456', lc(300)), run('IS456', lc(220))]
    const s = shearSummary(results)
    expect(s.governing?.loadCase.Vu).toBe(300)
    expect(s.worstRatio).toBeGreaterThan(0)
    expect(s.provided).toBeCloseTo((2 * Math.PI * 100) / 4 / 150, 6)
    expect(s.failCount).toBe(0)
    expect(s.ok).toBe(true)
  })

  it('emits step-by-step lines with clause references for every code', () => {
    for (const code of ['IS456', 'IRC112', 'IRSCBC'] as const) {
      const r = run(code, lc(300))
      expect(r.steps.length).toBeGreaterThanOrEqual(10)
      expect(r.steps.every((s) => s.clause.length > 0 && s.value.length > 0)).toBe(true)
      expect(r.checks.length).toBeGreaterThanOrEqual(5)
    }
  })
})
