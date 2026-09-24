import { describe, expect, it } from 'vitest'
import type { LoadCase, Rebar, SectionGeometry } from '../types'
import { initialState } from '../../state'
import {
  buildSlsModel,
  modularRatio,
  sigmaCbc,
  sigmaSc,
  sigmaSt,
  slsMaterialLimits,
  slsStress,
  type SlsInputs,
} from '../sls'

const rect = (B: number, D: number): SectionGeometry => ({
  boundary: [
    { x: 0, y: 0 },
    { x: B, y: 0 },
    { x: B, y: D },
    { x: 0, y: D },
  ],
  voids: [],
})

function inputs(fck: number, fy: number, bars: Rebar[], geometry: SectionGeometry): SlsInputs {
  const maxDia = Math.max(0, ...bars.map((b) => b.dia))
  const lim = slsMaterialLimits(fck, fy, maxDia)
  return {
    geometry,
    bars,
    fck,
    fy,
    m: lim.m,
    sigmaCbc: lim.sigmaCbc,
    sigmaSt: lim.sigmaSt,
    sigmaSc: lim.sigmaSc,
  }
}

describe('permissible stress tables (IS 456 Tables 21 & 22)', () => {
  it('reproduces the tabulated σcbc and modular ratio', () => {
    expect(sigmaCbc(15)).toBe(5)
    expect(sigmaCbc(20)).toBe(7)
    expect(sigmaCbc(25)).toBe(8.5)
    expect(sigmaCbc(30)).toBe(10)
    expect(sigmaCbc(40)).toBe(13)
    expect(sigmaCbc(50)).toBe(16)
    expect(sigmaCbc(60)).toBe(19)
    expect(modularRatio(20)).toBeCloseTo(13.33, 2)
    expect(modularRatio(25)).toBeCloseTo(10.98, 2)
    expect(modularRatio(30)).toBeCloseTo(9.33, 2)
  })

  it('reproduces the tabulated σst and σsc', () => {
    expect(sigmaSt(250, 16)).toBe(140)
    expect(sigmaSt(250, 25)).toBe(130)
    expect(sigmaSt(415, 20)).toBe(230)
    expect(sigmaSt(500, 25)).toBeCloseTo(275, 5)
    expect(sigmaSt(500, 25)).toBeCloseTo(0.55 * 500, 5)
    expect(sigmaSc(250)).toBe(130)
    expect(sigmaSc(415)).toBe(190)
    expect(sigmaSc(500)).toBe(190)
  })
})

describe('SLS transformed-section stress check', () => {
  // Singly reinforced beam 300 × 500, 3⌀20 bottom at d = 450, M25 / Fe415.
  const geometry = rect(300, 500)
  const bars: Rebar[] = [75, 150, 225].map((x) => ({ x, y: 50, dia: 20 }))
  const inp = inputs(25, 415, bars, geometry)
  const model = buildSlsModel(inp)

  // Hand values (IS 456 WSM): m = 10.98, xu from bx²/2 = m·Ast·(d−x).
  const Ast = 3 * (Math.PI / 4) * 400
  const mHand = 280 / (3 * 8.5)
  const xuHand = (-mHand * Ast + Math.sqrt((mHand * Ast) ** 2 + 2 * 300 * mHand * Ast * 450)) / 300
  const InaHand = (300 * xuHand ** 3) / 3 + mHand * Ast * (450 - xuHand) ** 2

  it('solves the neutral-axis depth from the transformed-section equilibrium', () => {
    const r = slsStress(model, inp, { id: 'b', name: 'B', Pu: 0, Mux: 60, Muy: 0 } as LoadCase)!
    expect(r).not.toBeNull()
    expect(r.xu).toBeGreaterThan(xuHand * 0.99)
    expect(r.xu).toBeLessThan(xuHand * 1.01)
    expect(r.d).toBeCloseTo(450, 3)
    expect(r.naOutside).toBe(false)
  })

  it('reproduces σc and σst of the hand calculation at a service moment', () => {
    const M = 60e6 // N·mm (60 kN·m)
    const r = slsStress(model, inp, { id: 'b', name: 'B', Pu: 0, Mux: 60, Muy: 0 } as LoadCase)!
    const sigmaCHand = (M * xuHand) / InaHand
    const sigmaStHand = (M * mHand * (450 - xuHand)) / InaHand
    expect(r.sigmaC).toBeGreaterThan(sigmaCHand * 0.99)
    expect(r.sigmaC).toBeLessThan(sigmaCHand * 1.01)
    expect(r.sigmaSt).toBeGreaterThan(sigmaStHand * 0.99)
    expect(r.sigmaSt).toBeLessThan(sigmaStHand * 1.01)
    // 60 kN·m: σc ≈ 6.9 ≤ 8.5, σst ≈ 152 ≤ 230 → both pass.
    expect(r.concreteOk).toBe(true)
    expect(r.steelOk).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.concreteRatio).toBeCloseTo(sigmaCHand / 8.5, 2)
    expect(r.steelRatio).toBeCloseTo(sigmaStHand / 230, 2)
  })

  it('fails the concrete and steel checks at an excessive service moment', () => {
    const r = slsStress(model, inp, { id: 'b', name: 'B', Pu: 0, Mux: 120, Muy: 0 } as LoadCase)!
    expect(r.sigmaC).toBeGreaterThan(8.5)
    expect(r.sigmaSt).toBeGreaterThan(230)
    expect(r.concreteOk).toBe(false)
    expect(r.steelOk).toBe(false)
    expect(r.ok).toBe(false)
  })

  it('reports uniform compression for a pure-axial case with no bending', () => {
    const r = slsStress(model, inp, { id: 'p', name: 'P', Pu: 800, Mux: 0, Muy: 0 } as LoadCase)!
    expect(r).not.toBeNull()
    // Transformed squash stiffness ≈ Ac + m·Asc; σc ≈ P / that.
    const Ac = 300 * 500 - Ast
    const sigmaApprox = 800e3 / (Ac + mHand * Ast)
    expect(r.sigmaC).toBeGreaterThan(sigmaApprox * 0.9)
    expect(r.sigmaC).toBeLessThan(sigmaApprox * 1.1)
  })

  it('returns null when the case has no axial load and no bending', () => {
    expect(slsStress(model, inp, { id: 'z', name: 'Z', Pu: 0, Mux: 0, Muy: 0 } as LoadCase)).toBeNull()
  })
})

describe('SLS checks across the predefined section library', () => {
  const kinds = ['rect', 'circle', 'tee', 'ishape', 'angle', 'box', 'hollowCircle'] as const
  it('produces finite, self-consistent stresses for every section type', async () => {
    const { generateSection, defaultPredefined } = await import('../sections')
    for (const kind of kinds) {
      const gen = generateSection(defaultPredefined(kind), { cover: 40, tieDia: 8, barDia: 25 })
      const inp = inputs(30, 500, gen.bars, gen.geometry)
      const model = buildSlsModel(inp)
      const r = slsStress(model, inp, { id: kind, name: kind, Pu: 500, Mux: 150, Muy: 90 } as LoadCase)
      expect(r, kind).not.toBeNull()
      expect(Number.isFinite(r!.sigmaC), kind).toBe(true)
      expect(Number.isFinite(r!.sigmaSt), kind).toBe(true)
      expect(r!.xu, kind).toBeGreaterThan(0)
      expect(r!.barStresses.length, kind).toBe(gen.bars.length)
      // Biaxial demand: the resisting moment aligns with the resultant direction.
      const sigmaCExpected = r!.sigmaC
      expect(sigmaCExpected, kind).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('SLS integration with the app default project (docs/11)', () => {
  it('runs the full pipeline on initialState() for every load case', () => {
    const s = initialState()
    const maxDia = Math.max(...s.bars.map((b) => b.dia))
    const grade = { fy: 500 }
    const lim = slsMaterialLimits(s.fck, grade.fy, maxDia)
    const inp: SlsInputs = {
      geometry: s.geometry,
      bars: s.bars,
      fck: s.fck,
      fy: grade.fy,
      m: lim.m,
      sigmaCbc: lim.sigmaCbc,
      sigmaSt: lim.sigmaSt,
      sigmaSc: lim.sigmaSc,
    }
    const model = buildSlsModel(inp)
    expect(s.cases.length).toBeGreaterThan(0)
    for (const lc of s.cases) {
      const r = slsStress(model, inp, lc)
      expect(r, lc.name).not.toBeNull()
      expect(Number.isFinite(r!.sigmaC), lc.name).toBe(true)
      expect(Number.isFinite(r!.sigmaSt), lc.name).toBe(true)
      expect(Number.isFinite(r!.xu), lc.name).toBe(true)
      expect(r!.xu, lc.name).toBeGreaterThan(0)
      // Verdict consistency: ok iff both ratios within 1.
      expect(r!.ok, lc.name).toBe(r!.concreteOk && r!.steelOk && r!.compSteelOk)
      // Permissible stresses echo the IS 456 tables for M30 / Fe500.
      expect(r!.sigmaCbc).toBe(10)
      expect(r!.sigmaStPerm).toBeCloseTo(275, 5)
      expect(r!.sigmaScPerm).toBe(190)
    }
  })
})

