import { describe, expect, it } from 'vitest'
import {
  defaultCircularRebarConfig,
  generateCircularRebar,
  pitchRadius,
  sanitizeCircularConfig,
  validateCircularBars,
} from '../circularRebar'

const R = 300 // 600 mm diameter
const COVER = 40
const TIE = 8
const DIA = 25

function base(kind: Parameters<typeof defaultCircularRebarConfig>[0] = 'uniform') {
  return defaultCircularRebarConfig(kind, R, COVER, TIE, DIA)
}

describe('pitchRadius', () => {
  it('matches the docs/04 offset rule', () => {
    // r = D/2 − cnom − ⌀tie − ⌀bar/2
    expect(pitchRadius(R, COVER, TIE, DIA)).toBeCloseTo(300 - 40 - 8 - 12.5, 6)
  })
})

describe('uniform ring', () => {
  it('places N equally-spaced bars on the pitch circle, first at top', () => {
    const cfg = { ...base('uniform'), nBars: 8 }
    const { bars, warnings } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(8)
    expect(warnings).toHaveLength(0)
    // startAngle 90° → first bar at (0, r)
    const r = pitchRadius(R, COVER, TIE, DIA)
    expect(bars[0].x).toBeCloseTo(0, 1)
    expect(bars[0].y).toBeCloseTo(r, 1)
    // all on the same radius
    for (const b of bars) {
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(r, 1)
      expect(b.dia).toBe(DIA)
    }
  })

  it('respects an explicit angular spacing', () => {
    const cfg = { ...base('uniform'), nBars: 4, angularSpacingDeg: 30, startAngleDeg: 0 }
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(4)
    // angles 0, 30, 60, 90
    expect(bars[1].x).toBeCloseTo(pitchRadius(R, COVER, TIE, DIA) * Math.cos(Math.PI / 6), 1)
  })
})

describe('alternate bars', () => {
  it('alternates two diameters around the ring', () => {
    const cfg = { ...base('alternate'), nBars: 8, barDia: 25, altBarDia: 20 }
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(8)
    expect(bars.map((b) => b.dia)).toEqual([25, 20, 25, 20, 25, 20, 25, 20])
    // pitch uses the larger diameter so both stay inside cover
    const r = pitchRadius(R, COVER, TIE, 25)
    for (const b of bars) expect(Math.hypot(b.x, b.y)).toBeCloseTo(r, 1)
  })
})

describe('bundle bars', () => {
  it('expands each bundle into individual bar coordinates', () => {
    const cfg = { ...base('bundle'), nBundles: 6, barsPerBundle: 2 }
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(12)
    // every bar has a unique centre
    const keys = new Set(bars.map((b) => `${b.x.toFixed(2)}|${b.y.toFixed(2)}`))
    expect(keys.size).toBe(12)
  })

  it('supports 3-bar bundles', () => {
    const cfg = { ...base('bundle'), nBundles: 4, barsPerBundle: 3 }
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(12)
  })
})

describe('triple bars', () => {
  it('places three bars at each group location', () => {
    const cfg = { ...base('triple'), nGroups: 6, groupSpacing: 50 }
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(18)
    const keys = new Set(bars.map((b) => `${b.x.toFixed(2)}|${b.y.toFixed(2)}`))
    expect(keys.size).toBe(18)
  })
})

describe('layered reinforcement', () => {
  it('generates independent concentric rings', () => {
    const cfg = sanitizeCircularConfig({
      ...base('layered'),
      layers: [
        { id: 'a', radius: 240, barDia: 25, nBars: 8, startAngleDeg: 90, angularSpacingDeg: null },
        { id: 'b', radius: 160, barDia: 20, nBars: 6, startAngleDeg: 0, angularSpacingDeg: null },
      ],
    })
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(14)
    const outer = bars.slice(0, 8)
    const inner = bars.slice(8)
    for (const b of outer) {
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(240, 1)
      expect(b.dia).toBe(25)
    }
    for (const b of inner) {
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(160, 1)
      expect(b.dia).toBe(20)
    }
  })

  it('auto-computes layer radii when radius is null', () => {
    const cfg = sanitizeCircularConfig({
      ...base('layered'),
      layers: [
        { id: 'a', radius: null, barDia: 25, nBars: 8, startAngleDeg: 90, angularSpacingDeg: null },
        { id: 'b', radius: null, barDia: 25, nBars: 6, startAngleDeg: 90, angularSpacingDeg: null },
      ],
    })
    const { bars } = generateCircularRebar(cfg)
    expect(bars).toHaveLength(14)
    const r0 = Math.hypot(bars[0].x, bars[0].y)
    const r1 = Math.hypot(bars[8].x, bars[8].y)
    expect(r0).toBeCloseTo(pitchRadius(R, COVER, TIE, 25), 1)
    expect(r1).toBeLessThan(r0 - 20)
  })
})

describe('validation', () => {
  it('flags bars that extend outside the section', () => {
    const cfg = { ...base('uniform'), nBars: 6, cover: -50 } // force bars outside
    // cover negative → pitch > R
    const bad = { ...cfg, cover: 0, tieDia: 0, barDia: 40, sectionRadius: 50, nBars: 6 }
    const { bars } = generateCircularRebar(bad)
    // manually push one outside
    bars[0] = { x: 100, y: 0, dia: 40 }
    const w = validateCircularBars(bars, bad)
    expect(w.some((s) => /outside/i.test(s))).toBe(true)
  })

  it('flags overlapping bars', () => {
    const cfg = base('uniform')
    const w = validateCircularBars(
      [
        { x: 0, y: 0, dia: 25 },
        { x: 5, y: 0, dia: 25 },
      ],
      cfg,
    )
    expect(w.some((s) => /overlap/i.test(s))).toBe(true)
  })

  it('clean uniform layout produces no warnings', () => {
    const { warnings } = generateCircularRebar({ ...base('uniform'), nBars: 8 })
    expect(warnings).toHaveLength(0)
  })
})

describe('sanitize', () => {
  it('clamps extremes and fills defaults', () => {
    const s = sanitizeCircularConfig({
      ...base('uniform'),
      nBars: 999,
      barDia: 2,
      angularSpacingDeg: -10,
    })
    expect(s.nBars).toBeLessThanOrEqual(200)
    expect(s.barDia).toBeGreaterThanOrEqual(6)
    expect(s.angularSpacingDeg).toBeNull()
  })
})
