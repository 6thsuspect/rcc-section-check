import { describe, expect, it } from 'vitest'
import { CODES } from '../codes'
import { sectionProperties, signedArea, centroid, isSimplePolygon } from '../geometry'
import { buildAnalysisModel } from '../integrator'
import { checkLoadCase, contourAtP, generateSurface, rayCapacity } from '../surface'
import type { Rebar, SectionGeometry } from '../types'

/**
 * Golden regression case — the docs/11 worked example, independently verified
 * by hand (SP-16 chart methodology) and by a second fiber implementation:
 *   450 × 600 rect, M30, Fe500, 12 ⌀25 (cover 40 + tie 8 → d' = 60.5 mm)
 *   Pu = 2500 kN, Mux = 180 kN·m, Muy = 100 kN·m
 *   → Asc = 5890.5 mm², p = 2.18%, simplified Puz = 5774 kN,
 *     Mux1 = 597.5 kN·m (xu ≈ 392 mm), Muy1 = 416.5 kN·m (xu ≈ 290 mm),
 *     αn = 1.388, Cl 39.6 sum = 0.327 → SAFE
 */

const RECT: SectionGeometry = {
  boundary: [
    { x: -225, y: -300 },
    { x: 225, y: -300 },
    { x: 225, y: 300 },
    { x: -225, y: 300 },
  ],
  voids: [],
}

const XS = [-164.5, -54.83, 54.83, 164.5]
const BARS: Rebar[] = [
  ...XS.map((x) => ({ x, y: 239.5, dia: 25 })),
  ...XS.map((x) => ({ x, y: -239.5, dia: 25 })),
  { x: 164.5, y: -79.83, dia: 25 },
  { x: 164.5, y: 79.83, dia: 25 },
  { x: -164.5, y: -79.83, dia: 25 },
  { x: -164.5, y: 79.83, dia: 25 },
]

const spec = CODES.IS456
const FCK = 30
const FY = 500

function buildSurface(mesh = { nTheta: 48, nDepth: 160 }) {
  const props = sectionProperties(RECT, BARS)
  const grade = spec.steelGrades.find((g) => g.label === 'Fe500')!
  const model = buildAnalysisModel(
    RECT,
    BARS,
    { x: props.cx, y: props.cy },
    props.area,
    spec.concrete(FCK),
    spec.steel(FY),
    spec.epsSteelLimit(grade),
  )
  return { surface: generateSurface(model, mesh), props }
}

describe('geometry', () => {
  it('shoelace area, centroid, inertia of a rectangle', () => {
    const props = sectionProperties(RECT, BARS)
    expect(props.area).toBeCloseTo(270000, 3)
    expect(props.cx).toBeCloseTo(0, 6)
    expect(props.cy).toBeCloseTo(0, 6)
    expect(props.Ixx).toBeCloseTo((450 * 600 ** 3) / 12, -3)
    expect(props.Iyy).toBeCloseTo((600 * 450 ** 3) / 12, -3)
    expect(props.Ixy).toBeCloseTo(0, 3)
  })

  it('hexagonal pier from docs/03 — area and centroid', () => {
    const hex = [
      { x: 0, y: 0 },
      { x: 700, y: 0 },
      { x: 700, y: 300 },
      { x: 500, y: 500 },
      { x: 200, y: 500 },
      { x: 0, y: 300 },
    ]
    expect(signedArea(hex)).toBeCloseTo(310000, 3)
    const c = centroid(hex)
    expect(c.x).toBeCloseTo(350, 1)
    expect(c.y).toBeCloseTo(226.3, 1)
    expect(isSimplePolygon(hex)).toBe(true)
  })

  it('box section subtracts its void', () => {
    const box: SectionGeometry = {
      boundary: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ],
      voids: [
        [
          { x: 250, y: 250 },
          { x: 750, y: 250 },
          { x: 750, y: 750 },
          { x: 250, y: 750 },
        ],
      ],
    }
    const p = sectionProperties(box, [])
    expect(p.area).toBeCloseTo(1e6 - 250000, 3)
    expect(p.Ixx).toBeCloseTo(1000 ** 4 / 12 - 500 ** 4 / 12, -3)
  })

  it('steel area of the reference layout', () => {
    const props = sectionProperties(RECT, BARS)
    expect(props.Asc).toBeCloseTo(5890.5, 0)
    expect(props.p).toBeCloseTo(2.18, 2)
  })
})

describe('interaction surface — IS 456 golden case', () => {
  const { surface, props } = buildSurface()

  it('rigorous squash load sits between the simplified Puz and the elastic bound', () => {
    // rigorous Puz uses σc(0.002) = 0.446·fck on net concrete + σs(0.002) on steel
    const PuzKN = surface.Puz / 1e3
    expect(PuzKN).toBeGreaterThan(5500)
    expect(PuzKN).toBeLessThan(5900)
  })

  it('pure tension capacity = 0.87·fy·Asc', () => {
    expect(surface.Pt / 1e3).toBeCloseTo((-0.87 * FY * 5890.5) / 1e3, -1)
  })

  it('uniaxial capacities at Pu = 2500 kN match the verified references (±2%)', () => {
    const contour = contourAtP(surface, 2500e3)!
    const Mux1 = rayCapacity(contour, 1, 0) / 1e6
    const Muy1 = rayCapacity(contour, 0, 1) / 1e6
    expect(Mux1).toBeGreaterThan(597.5 * 0.98)
    expect(Mux1).toBeLessThan(597.5 * 1.02)
    expect(Muy1).toBeGreaterThan(416.5 * 0.98)
    expect(Muy1).toBeLessThan(416.5 * 1.02)
  })

  it('symmetric section gives symmetric contours', () => {
    const contour = contourAtP(surface, 2500e3)!
    const east = rayCapacity(contour, 1, 0)
    const west = rayCapacity(contour, -1, 0)
    const north = rayCapacity(contour, 0, 1)
    const south = rayCapacity(contour, 0, -1)
    expect(east / west).toBeCloseTo(1, 2)
    expect(north / south).toBeCloseTo(1, 2)
  })

  it('full case check reproduces the worked example verdict', () => {
    const r = checkLoadCase(
      surface,
      { id: 't', name: 'LC1', Pu: 2500, Mux: 180, Muy: 100 },
      spec,
      FCK,
      FY,
      props.area,
      props.Asc,
      'rect',
    )
    expect(r.ok).toBe(true)
    expect(r.axialGoverned).toBe(false)
    // simplified Cl 39.6: αn = 1.388, sum = 0.327 (±0.01 band for surface interpolation)
    expect(r.alphaN!).toBeGreaterThan(1.36)
    expect(r.alphaN!).toBeLessThan(1.42)
    expect(r.simplified!).toBeGreaterThan(0.317)
    expect(r.simplified!).toBeLessThan(0.337)
    // rigorous utilisation is finite, below 1, and larger than the biaxial ray fractions alone
    expect(r.U).toBeGreaterThan(0.25)
    expect(r.U).toBeLessThan(0.5)
  })

  it('axial overload is reported as axial-governed failure', () => {
    const r = checkLoadCase(
      surface,
      { id: 't2', name: 'over', Pu: 7000, Mux: 0, Muy: 0 },
      spec,
      FCK,
      FY,
      props.area,
      props.Asc,
      'rect',
    )
    expect(r.ok).toBe(false)
    expect(r.axialGoverned).toBe(true)
    expect(r.U).toBeGreaterThan(1)
  })
})

describe('code registry values', () => {
  it('IS 456 simplified Puz matches the worked example (5774 kN)', () => {
    const Puz = spec.simplifiedPuz(FCK, FY, 270000, 5890.5) / 1e3
    expect(Puz).toBeCloseTo(5774.4, 0)
  })

  it('IS 456 αn interpolation', () => {
    expect(spec.alphaN(0.1, 'rect')).toBe(1)
    expect(spec.alphaN(0.433, 'rect')).toBeCloseTo(1.388, 2)
    expect(spec.alphaN(0.9, 'rect')).toBe(2)
  })

  it('IRC 112 high-strength concrete parameters (Table 6.5, M90)', () => {
    const m90 = CODES.IRC112.concrete(90)
    expect(m90.ec2).toBeCloseTo(0.0024, 4) // printed 2.4‰
    expect(m90.ecu).toBeCloseTo(0.0026, 4) // printed 2.6‰
    expect(m90.n).toBeCloseTo(1.4, 1)
    const m65 = CODES.IRC112.concrete(65)
    expect(m65.ec2).toBeCloseTo(0.0021, 4)
    expect(m65.ecu).toBeCloseTo(0.0033, 4)
    expect(m65.n).toBeCloseTo(1.9, 1)
  })

  it('IRS CBC steel compression cap fyc = fy/(γm + fy/2000)', () => {
    const s = CODES.IRSCBC.steel(500)
    expect(s.compressionCap!).toBeCloseTo(357.1, 1)
    expect(CODES.IRSCBC.steel(415).compressionCap!).toBeCloseTo(305.7, 1)
  })

  it('IRC 112 rectangular exponent a interpolation', () => {
    const a = CODES.IRC112.alphaN
    expect(a(0.1, 'rect')).toBe(1)
    expect(a(0.7, 'rect')).toBeCloseTo(1.5, 6)
    expect(a(1.0, 'rect')).toBe(2)
    expect(a(0.5, 'circ')).toBe(2)
  })
})
