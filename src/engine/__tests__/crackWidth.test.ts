import { describe, expect, it } from 'vitest'
import {
  annexFWidth,
  clauseFor,
  crackWidthCheck,
  DEFAULT_EXPOSURE,
  EXPOSURE_OPTIONS,
  irc112Width,
  wMaxFor,
  type CrackWidthSettings,
} from '../crackWidth'
import { buildSlsModel, slsMaterialLimits, slsStress, type SlsCaseResult, type SlsInputs } from '../sls'
import { initialState } from '../../state'

/**
 * A hand-checkable rectangular beam: b = 300, h = 500, d = 450, clear cover
 * c = 40, tension bar ⌀20, A_s = 3⌀20 = 942 mm², fck = 30, σs = 200 N/mm²,
 * neutral axis x = 150.
 */
const G = { h: 500, x: 150, d: 450, b: 300, As: 942.48, c: 40, phi: 20 }

describe('crack width — permissible limits by exposure (per code)', () => {
  it('IS 456 Cl 35.3.2: mild 0.3 / moderate 0.2 / severe 0.1 mm', () => {
    expect(wMaxFor('IS456', 'mild')).toBeCloseTo(0.3, 6)
    expect(wMaxFor('IS456', 'moderate')).toBeCloseTo(0.2, 6)
    expect(wMaxFor('IS456', 'severe')).toBeCloseTo(0.1, 6)
  })

  it('IRC:112 Table 12.1: 0.3 mm for X0–XD1/XS1, 0.2 mm for XD2+', () => {
    expect(wMaxFor('IRC112', 'X0')).toBeCloseTo(0.3, 6)
    expect(wMaxFor('IRC112', 'XC3')).toBeCloseTo(0.3, 6)
    expect(wMaxFor('IRC112', 'XD1')).toBeCloseTo(0.3, 6)
    expect(wMaxFor('IRC112', 'XS1')).toBeCloseTo(0.3, 6)
    expect(wMaxFor('IRC112', 'XD2')).toBeCloseTo(0.2, 6)
    expect(wMaxFor('IRC112', 'XD3')).toBeCloseTo(0.2, 6)
    expect(wMaxFor('IRC112', 'XS3')).toBeCloseTo(0.2, 6)
  })

  it('IRS CBC Table 10: moderate 0.2 / severe 0.1 mm', () => {
    expect(wMaxFor('IRSCBC', 'moderate')).toBeCloseTo(0.2, 6)
    expect(wMaxFor('IRSCBC', 'severe')).toBeCloseTo(0.1, 6)
  })

  it('every code has a valid default exposure', () => {
    for (const code of ['IS456', 'IRC112', 'IRSCBC'] as const) {
      const def = DEFAULT_EXPOSURE[code]
      expect(EXPOSURE_OPTIONS[code].some((o) => o.value === def)).toBe(true)
      expect(wMaxFor(code, def)).toBeGreaterThan(0)
    }
  })
})

describe('crack width — IRC:112 Cl 12.3.4 (Eurocode) formula', () => {
  it('reproduces the hand calculation for the worked beam', () => {
    const r = irc112Width(G, 200, 30, false)
    // A_c,eff = 300·min[2.5·50, 350/3, 250] = 300·116.667 = 35000 mm²
    expect(r.AcEff).toBeCloseTo(35000, 0)
    expect(r.rhoPeff).toBeCloseTo(942.48 / 35000, 5)
    // s_r,max = 3.4·40 + 0.425·0.8·0.5·20/ρ ≈ 262.3 mm
    expect(r.srmax).toBeCloseTo(262.3, 0)
    // ε_sm − ε_cm ≈ 6.24e-4 (above the 0.6σs/Es floor of 6.0e-4)
    expect(r.epsSmCm).toBeGreaterThan(0.6 * (200 / 200000))
    expect(r.epsSmCm).toBeCloseTo(6.24e-4, 5)
    // w_k = s_r,max·ε ≈ 0.164 mm
    expect(r.w).toBeCloseTo(0.164, 2)
  })

  it('long-term loading lowers k_t and (per EC2) widens the crack', () => {
    const short = irc112Width(G, 200, 30, false)
    const long = irc112Width(G, 200, 30, true)
    expect(short.kt).toBe(0.6)
    expect(long.kt).toBe(0.4)
    // Lower k_t gives less tension-stiffening credit → larger strain → wider crack.
    expect(long.w).toBeGreaterThan(short.w)
  })

  it('the ε_sm − ε_cm floor 0.6σs/Es governs at low steel stress', () => {
    const r = irc112Width(G, 50, 30, false)
    expect(r.epsSmCm).toBeCloseTo((0.6 * 50) / 200000, 6)
  })

  it('crack width grows monotonically with the steel stress', () => {
    expect(irc112Width(G, 200, 30, false).w).toBeGreaterThan(irc112Width(G, 100, 30, false).w)
    expect(annexFWidth(G, 200).w).toBeGreaterThan(annexFWidth(G, 100).w)
  })
})

describe('crack width — IS 456 Annex F formula (also IRS CBC basis)', () => {
  it('reproduces the hand calculation for the worked beam', () => {
    const r = annexFWidth(G, 200)
    // ε_1 = 1.0e-3; stiffening = b(h−x)²/(3 Es As (d−x)) ≈ 2.168e-4
    expect(r.epsM).toBeCloseTo(7.832e-4, 6)
    // w = 3·c·ε_m = 3·40·7.832e-4 ≈ 0.0940 mm
    expect(r.w).toBeCloseTo(0.0940, 3)
    expect(r.uncracked).toBe(false)
  })

  it('flags an uncracked section when tension stiffening exceeds the bar strain', () => {
    // Very low bar strain with heavy tension steel → stiffening term > ε_1.
    const r = annexFWidth({ ...G, As: 6000 }, 1)
    expect(r.uncracked).toBe(true)
    expect(r.w).toBe(0)
  })
})

describe('crack width — full pipeline on the default project', () => {
  function fixture(code: 'IS456' | 'IRC112' | 'IRSCBC') {
    const s = initialState()
    s.code = code
    const fy = 500
    const maxDia = Math.max(...s.bars.map((b) => b.dia))
    const lim = slsMaterialLimits(s.fck, fy, maxDia)
    const inp: SlsInputs = {
      geometry: s.geometry,
      bars: s.bars,
      fck: s.fck,
      fy,
      m: lim.m,
      sigmaCbc: lim.sigmaCbc,
      sigmaSt: lim.sigmaSt,
      sigmaSc: lim.sigmaSc,
    }
    const model = buildSlsModel(inp)
    const settings: CrackWidthSettings = { exposure: DEFAULT_EXPOSURE[code], longTerm: false }
    const out = new Map<string, SlsCaseResult | null>()
    for (const lc of s.slsCases) {
      const res = slsStress(model, inp, lc)
      out.set(lc.id, res)
    }
    return { s, model, inp, settings, out }
  }

  it('produces a finite, non-negative crack width with a consistent verdict for every code', () => {
    for (const code of ['IS456', 'IRC112', 'IRSCBC'] as const) {
      const { s, model, inp, settings, out } = fixture(code)
      expect(s.slsCases.length).toBeGreaterThan(0)
      for (const lc of s.slsCases) {
        const res = out.get(lc.id)!
        const cw = crackWidthCheck(code, s.fck, model, inp.bars, res, settings)
        expect(cw, `${code}/${lc.name}`).not.toBeNull()
        expect(Number.isFinite(cw!.w)).toBe(true)
        expect(cw!.w).toBeGreaterThanOrEqual(0)
        expect(cw!.wmax).toBeGreaterThan(0)
        expect(Number.isFinite(cw!.ratio)).toBe(true)
        expect(cw!.ok).toBe(cw!.ratio <= 1)
        expect(cw!.clause).toBe(clauseFor(code))
      }
    }
  })

  it('returns null for a pure-axial case (no flexural cracking)', () => {
    const { s, model, inp, settings, out } = fixture('IS456')
    const lc = s.slsCases[0]
    const res = out.get(lc.id)!
    const axial: SlsCaseResult = { ...res, xu: NaN, naOutside: true }
    expect(crackWidthCheck('IS456', s.fck, model, inp.bars, axial, settings)).toBeNull()
  })

  it('a clearly-cracked case yields a positive width that grows with stress', () => {
    const { s, model, inp, settings, out } = fixture('IS456')
    const base = out.get(s.slsCases[0].id)!
    // Force a cracked profile: a tension bar present with a high steel stress.
    const cracked = (sigmaSt: number): SlsCaseResult => ({
      ...base,
      sigmaSt,
      tensionBar: 0,
      barStresses: base.barStresses.map((v, i) => (i === 0 ? -sigmaSt : Math.min(0, v))),
    })
    const lo = crackWidthCheck('IS456', s.fck, model, inp.bars, cracked(120), settings)!
    const hi = crackWidthCheck('IS456', s.fck, model, inp.bars, cracked(240), settings)!
    expect(lo.w).toBeGreaterThan(0)
    expect(hi.w).toBeGreaterThan(lo.w)
  })
})
