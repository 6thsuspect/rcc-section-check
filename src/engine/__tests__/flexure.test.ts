import { describe, expect, it } from 'vitest'
import { CODES } from '../codes'
import { sectionProperties } from '../geometry'
import { buildAnalysisModel } from '../integrator'
import { neutralAxisAnalysis } from '../flexure'
import { checkLoadCase, generateSurface } from '../surface'
import { generateSection, defaultPredefined, type PredefinedSection } from '../sections'
import type { LoadCase, Rebar, SectionGeometry } from '../types'

const spec = CODES.IS456

function analyse(geometry: SectionGeometry, bars: Rebar[], fck: number, gradeLabel: string, lc: LoadCase, code = spec) {
  const props = sectionProperties(geometry, bars)
  const grade = code.steelGrades.find((g) => g.label === gradeLabel)!
  const conc = code.concrete(fck)
  const model = buildAnalysisModel(geometry, bars, { x: props.cx, y: props.cy }, props.area, conc, code.steel(grade.fy), code.epsSteelLimit(grade))
  const surface = generateSurface(model, { nTheta: 40, nDepth: 90 })
  const na = neutralAxisAnalysis(model, surface, lc, { spec: code, fy: grade.fy, ecu: conc.ecu })
  const res = checkLoadCase(surface, lc, code, fck, grade.fy, props.area, props.Asc, 'rect')
  return { na, res, props }
}

const rect = (B: number, D: number): SectionGeometry => ({
  boundary: [
    { x: 0, y: 0 },
    { x: B, y: 0 },
    { x: B, y: D },
    { x: 0, y: D },
  ],
  voids: [],
})

describe('code limiting NA depth', () => {
  it('IS 456 xu,max/d reproduces 0.53 / 0.48 / 0.46', () => {
    expect(spec.xuMaxRatio(250, 0.0035)).toBeCloseTo(0.531, 2)
    expect(spec.xuMaxRatio(415, 0.0035)).toBeCloseTo(0.479, 2)
    expect(spec.xuMaxRatio(500, 0.0035)).toBeCloseTo(0.456, 2)
  })
})

describe('neutral axis analysis', () => {
  // singly reinforced beam 300 × 500, 3⌀20 at d = 450, M25 / Fe415, pure bending
  const bars: Rebar[] = [75, 150, 225].map((x) => ({ x, y: 50, dia: 20 }))
  const lc: LoadCase = { id: 'b', name: 'B', Pu: 0, Mux: 100, Muy: 0 }

  it('matches the IS 456 hand calculation for an under-reinforced beam', () => {
    const { na } = analyse(rect(300, 500), bars, 25, 'Fe415', lc)
    expect(na).not.toBeNull()
    const Ast = 3 * (Math.PI / 4) * 400
    const xuHand = (0.87 * 415 * Ast) / (0.36 * 25 * 300) // ≈ 126 mm
    const MuHand = 0.87 * 415 * Ast * (450 - 0.42 * xuHand) // ≈ 135 kN·m
    expect(na!.d).toBeCloseTo(450, 3)
    expect(na!.xu).toBeGreaterThan(xuHand * 0.97)
    expect(na!.xu).toBeLessThan(xuHand * 1.03)
    expect(na!.xuMax).toBeCloseTo(0.479 * 450, 0)
    expect(na!.classification).toBe('under')
    expect(na!.Mu! / MuHand).toBeGreaterThan(0.99)
    expect(na!.Mu! / MuHand).toBeLessThan(1.01)
    expect(na!.axisLabel).toContain('global −Y')
    // compression face at εcu, steel beyond its limiting strain
    expect(na!.epsTop).toBeCloseTo(0.0035, 6)
    expect(-na!.epsSteel).toBeGreaterThan(na!.epsLimit)
  })

  it('flags an over-reinforced beam and withholds Mu', () => {
    const heavy: Rebar[] = [60, 120, 180, 240].map((x) => ({ x, y: 50, dia: 32 }))
    const { na } = analyse(rect(300, 500), heavy, 20, 'Fe500', lc)
    expect(na!.classification).toBe('over')
    expect(na!.xu).toBeGreaterThan(na!.xuMax)
    expect(na!.Mu).toBeNull()
  })

  it('reproduces the docs/11 worked-example NA depths and agrees with the surface capacity', () => {
    const def = { ...(defaultPredefined('rect') as Extract<PredefinedSection, { kind: 'rect' }>), B: 450, D: 600, nx: 4, ny: 2 }
    const gen = generateSection(def, { cover: 40, tieDia: 8, barDia: 25 })
    const aboutX = analyse(gen.geometry, gen.bars, 30, 'Fe500', { id: 'x', name: 'X', Pu: 2500, Mux: 180, Muy: 0 })
    expect(aboutX.na!.xu).toBeGreaterThan(392 * 0.97)
    expect(aboutX.na!.xu).toBeLessThan(392 * 1.03)
    expect(aboutX.na!.classification).toBe('over')
    expect(aboutX.na!.MuState / aboutX.res.MRd).toBeGreaterThan(0.98)
    expect(aboutX.na!.MuState / aboutX.res.MRd).toBeLessThan(1.02)

    const aboutY = analyse(gen.geometry, gen.bars, 30, 'Fe500', { id: 'y', name: 'Y', Pu: 2500, Mux: 0, Muy: 100 })
    expect(aboutY.na!.xu).toBeGreaterThan(290 * 0.97)
    expect(aboutY.na!.xu).toBeLessThan(290 * 1.03)
    expect(aboutY.na!.axisLabel).toContain('X')
  })

  it('aligns the resisting moment with a biaxial demand for every section type', () => {
    for (const kind of ['rect', 'circle', 'tee', 'ishape', 'angle', 'box', 'hollowCircle'] as const) {
      const gen = generateSection(defaultPredefined(kind), { cover: 40, tieDia: 8, barDia: 25 })
      const { na, res } = analyse(gen.geometry, gen.bars, 30, 'Fe500', { id: kind, name: kind, Pu: 500, Mux: 150, Muy: 90 })
      expect(na, kind).not.toBeNull()
      const dir = Math.atan2(na!.state.My, na!.state.Mx)
      expect(Math.abs(dir - Math.atan2(90, 150)), kind).toBeLessThan(1e-3)
      expect(Math.abs(na!.state.P - 500e3), kind).toBeLessThan(10)
      expect(na!.xu, kind).toBeGreaterThan(0)
      expect(na!.MuState / res.MRd, kind).toBeGreaterThan(0.97)
      expect(na!.MuState / res.MRd, kind).toBeLessThan(1.03)
    }
  })

  it('returns null without bending or outside the axial range', () => {
    const { na } = analyse(rect(300, 500), bars, 25, 'Fe415', { id: 'p', name: 'P', Pu: 100, Mux: 0, Muy: 0 })
    expect(na).toBeNull()
    const far = analyse(rect(300, 500), bars, 25, 'Fe415', { id: 'q', name: 'Q', Pu: 1e6, Mux: 10, Muy: 0 })
    expect(far.na).toBeNull()
  })
})
