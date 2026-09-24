import { describe, expect, it } from 'vitest'
import { detectBarOverlaps, spacingReport } from '../barSpacing'
import {
  bundleSpacingUsed,
  defaultCircularRebarConfig,
  generateCircularRebar,
  pitchRadius,
  validateCircularBars,
} from '../circularRebar'
import { complianceChecks } from '../checks'
import { CODES } from '../codes'
import { sectionProperties } from '../geometry'
import { defaultPredefined, generateSection } from '../sections'
import type { Rebar } from '../types'

const base = () => defaultCircularRebarConfig('bundle', 300, 40, 8, 25)

describe('overlap detection', () => {
  it('flags intersecting bars in any layout and ignores touching bars', () => {
    const bars: Rebar[] = [
      { x: 0, y: 0, dia: 25 },
      { x: 20, y: 0, dia: 25 }, // overlaps bar 1 by 5 mm
      { x: 100, y: 0, dia: 20 },
      { x: 120, y: 0, dia: 20 }, // exactly touching
    ]
    const o = detectBarOverlaps(bars)
    expect(o).toHaveLength(1)
    expect(o[0]).toMatchObject({ i: 0, j: 1, sameBundle: false })
    expect(o[0].depth).toBeCloseTo(5, 6)
    expect([...spacingReport(bars).overlapping].sort()).toEqual([0, 1])
  })

  it('reports no overlaps for every generated predefined layout', () => {
    for (const kind of ['rect', 'circle', 'tee', 'ishape', 'angle', 'box', 'hollowCircle'] as const) {
      const gen = generateSection(defaultPredefined(kind), { cover: 40, tieDia: 8, barDia: 25 })
      expect(detectBarOverlaps(gen.bars), kind).toHaveLength(0)
    }
  })
})

describe('circular bundle bars', () => {
  it('keeps the original layout when the new bundle inputs are left automatic', () => {
    const cfg = { ...base(), nBundles: 6, barsPerBundle: 2 }
    const { bars } = generateCircularRebar(cfg)
    // default centre-to-centre inside the bundle = ⌀ + max(⌀, 25) = 50 mm
    expect(Math.hypot(bars[1].x - bars[0].x, bars[1].y - bars[0].y)).toBeCloseTo(50, 1)
    expect(bars.every((b) => b.groupId?.startsWith('bundle-'))).toBe(true)
    expect(new Set(bars.map((b) => b.groupId)).size).toBe(6)
  })

  it('uses the bundle spacing independently of the spacing inside a bundle', () => {
    const cfg = { ...base(), nBundles: 5, barsPerBundle: 2, bundleSpacing: 180, bundleInnerSpacing: 25 }
    const { bars } = generateCircularRebar(cfg)
    const rep = spacingReport(bars)
    expect(rep.bundles).toHaveLength(5)
    // bars inside a bundle in contact (c/c = ⌀)
    expect(Math.hypot(bars[1].x - bars[0].x, bars[1].y - bars[0].y)).toBeCloseTo(25, 1)
    // bundle centres 180 mm apart (chord on the pitch circle)
    expect(rep.bundleSpacing!.min).toBeCloseTo(180, 0)
    expect(bundleSpacingUsed(cfg)).toBeCloseTo(180, 6)
    // contact inside a bundle is not a spacing failure …
    expect(rep.overlaps).toHaveLength(0)
    const checks = complianceChecks(CODES.IS456, {
      props: sectionProperties({ boundary: circle(300), voids: [] }, bars),
      bars,
      geometry: { boundary: circle(300), voids: [] },
      fck: 30,
      fy: 500,
      cases: [],
      shapeClass: 'circ',
    })
    const clear = checks.find((c) => c.title === 'Clear distance between bars')!
    expect(clear.note).toContain('same bundle excluded')
    expect(parseFloat(clear.demand)).toBeGreaterThan(25)
    // … while the gap to the neighbouring bundle is checked
    expect(rep.minClear!).toBeGreaterThan(0)
    expect(validateCircularBars(bars, cfg).some((w) => w.includes('overlap'))).toBe(false)
  })

  it('allows a diameter per bar position, independent of the bars-per-bundle count', () => {
    const cfg = { ...base(), nBundles: 6, barsPerBundle: 3, bundleMixedDia: true, bundleBarDias: [32, 25, 20, 16] }
    const { bars } = generateCircularRebar(cfg)
    expect(bars.slice(0, 3).map((b) => b.dia)).toEqual([32, 25, 20])
    // the list survives a smaller count, and missing positions fall back to the bar ⌀
    const two = generateCircularRebar({ ...cfg, barsPerBundle: 2 }).bars
    expect(two.slice(0, 2).map((b) => b.dia)).toEqual([32, 25])
    const five = generateCircularRebar({ ...cfg, barsPerBundle: 5 }).bars
    expect(five.slice(0, 5).map((b) => b.dia)).toEqual([32, 25, 20, 16, 25])
    // pitch radius governed by the largest bar
    const r = pitchRadius(300, 40, 8, 32)
    const rep = spacingReport(bars)
    expect(Math.hypot(rep.bundles[0].cx, rep.bundles[0].cy)).toBeLessThan(r + 20)
    expect(rep.bundles[0].eqDia).toBeCloseTo(Math.sqrt(32 ** 2 + 25 ** 2 + 20 ** 2), 6)
  })

  it('detects overlapping bundles when the spacing is too tight', () => {
    const cfg = { ...base(), nBundles: 6, barsPerBundle: 2, bundleSpacing: 30 }
    const { bars, warnings } = generateCircularRebar(cfg)
    const rep = spacingReport(bars)
    expect(rep.overlaps.length).toBeGreaterThan(0)
    expect(rep.overlaps.some((o) => !o.sameBundle)).toBe(true)
    expect(warnings.some((w) => w.includes('overlapping'))).toBe(true)
  })
})

function circle(R: number) {
  return Array.from({ length: 64 }, (_, i) => ({ x: R * Math.cos((2 * Math.PI * i) / 64), y: R * Math.sin((2 * Math.PI * i) / 64) }))
}
