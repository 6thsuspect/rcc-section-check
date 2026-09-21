import { describe, expect, it } from 'vitest'
import {
  auditCovers,
  faceFromNormal,
  faceOffsets,
  formatCover,
  hasInnerOverrides,
  innerCover,
  isUniformCover,
  nearestFace,
  normalizeCover,
  outerCover,
  polygonTolerance,
  radialCover,
  snapBarsToCover,
  uniformCover,
} from '../cover'
import { defaultPredefined, generateSection, SHAPE_LABELS, type PredefinedSection } from '../sections'
import { complianceChecks } from '../checks'
import { CODES } from '../codes'
import { sectionProperties } from '../geometry'
import type { LoadCase, Rebar, SectionGeometry } from '../types'

/**
 * Per-face clear cover (docs/03 §3.6, docs/04 §4.2, docs/09 V3).
 *
 * Convention under test: `cover.outer.<face>` is the nominal cover to the links
 * at that face of the section's bounding box; `cover.inner.<face>` is the cover
 * at the matching face of an internal void (null = inherit the outer face). A
 * generated bar is set back from the face it lies against by
 * cover(face) + ⌀tie + ⌀bar/2, so the audit finds exactly the entered value.
 */

const TIE = 8
const DIA = 20
/** deliberately asymmetric: every face a different value */
const COVER = normalizeCover({
  outer: { bottom: 30, right: 45, top: 60, left: 75 },
  inner: { bottom: 25, right: 40, top: 35, left: 20 },
})

const RECT: SectionGeometry = {
  boundary: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 600 },
    { x: 0, y: 600 },
  ],
  voids: [],
}

describe('cover spec', () => {
  it('a bare number means all faces equal (legacy project files)', () => {
    const c = normalizeCover(40)
    expect(c).toEqual(uniformCover(40))
    expect(outerCover(c, 'top')).toBe(40)
    expect(outerCover(c, 'left')).toBe(40)
    expect(isUniformCover(c)).toBe(true)
    expect(hasInnerOverrides(c)).toBe(false)
  })

  it('keeps independently entered faces', () => {
    expect(outerCover(COVER, 'bottom')).toBe(30)
    expect(outerCover(COVER, 'right')).toBe(45)
    expect(outerCover(COVER, 'top')).toBe(60)
    expect(outerCover(COVER, 'left')).toBe(75)
    expect(isUniformCover(COVER)).toBe(false)
    expect(hasInnerOverrides(COVER)).toBe(true)
  })

  it('fills missing faces from a partial spec and drops negatives', () => {
    const c = normalizeCover({ top: 50, left: -10 })
    expect(outerCover(c, 'top')).toBe(50)
    expect(outerCover(c, 'left')).toBe(0)
    // unset faces fall back to the value carried by the flat/legacy fields
    expect(outerCover(c, 'bottom')).toBe(50)
    expect(outerCover(c, 'right')).toBe(50)
  })

  it('falls back to the default spec for junk input', () => {
    expect(normalizeCover(undefined, COVER)).toEqual(COVER)
    expect(normalizeCover('nope', COVER)).toEqual(COVER)
    expect(normalizeCover({ outer: { bottom: 'x' } }, COVER)).toEqual(COVER)
  })

  it('void faces inherit the outer face unless set', () => {
    const c = normalizeCover({
      outer: { bottom: 40, right: 40, top: 40, left: 40 },
      inner: { bottom: null, right: 70, top: null, left: null },
    })
    expect(innerCover(c, 'bottom')).toBe(40)
    expect(innerCover(c, 'right')).toBe(70)
  })

  it('reports the governing value for circular rings', () => {
    expect(radialCover(COVER)).toBe(75)
    expect(radialCover(COVER, 'inner')).toBe(40)
  })

  it('summarises for the section caption', () => {
    expect(formatCover(uniformCover(40))).toBe('40 mm (all faces)')
    expect(formatCover(COVER)).toBe('bottom 30 · right 45 · top 60 · left 75 mm')
  })
})

describe('bar offsets from the faces', () => {
  it('adds the link diameter and half the bar diameter per face', () => {
    const o = faceOffsets(COVER, TIE, DIA)
    expect(o.outer.bottom).toBe(30 + 8 + 10)
    expect(o.outer.right).toBe(45 + 8 + 10)
    expect(o.outer.top).toBe(60 + 8 + 10)
    expect(o.outer.left).toBe(75 + 8 + 10)
    expect(o.inner.bottom).toBe(25 + 8 + 10)
    expect(o.inner.left).toBe(20 + 8 + 10)
    expect(o.radial).toBe(75 + 8 + 10)
  })

  it('places rectangle bars at each face offset', () => {
    const gen = generateSection({ kind: 'rect', B: 400, D: 600, nx: 3, ny: 2 }, { cover: COVER, tieDia: TIE, barDia: DIA })
    const xs = gen.bars.map((b) => b.x)
    const ys = gen.bars.map((b) => b.y)
    expect(Math.min(...xs)).toBe(93) // left face: 75 + 8 + 10
    expect(Math.max(...xs)).toBe(400 - 63) // right face: 45 + 8 + 10
    expect(Math.min(...ys)).toBe(48) // bottom face: 30 + 8 + 10
    expect(Math.max(...ys)).toBe(600 - 78) // top face: 60 + 8 + 10
    expect(gen.bars.length).toBe(2 * 3 + 2 * 2)
  })

  it('keeps the single-cover behaviour when all faces are equal', () => {
    const def = { kind: 'rect', B: 450, D: 600, nx: 4, ny: 2 } as PredefinedSection
    const legacy = generateSection(def, { cover: 40, tieDia: TIE, barDia: DIA })
    const modern = generateSection(def, { cover: uniformCover(40), tieDia: TIE, barDia: DIA })
    expect(modern.bars).toEqual(legacy.bars)
  })

  it('drives a circular ring from the governing face', () => {
    const gen = generateSection({ kind: 'circle', D: 600, nBars: 8 }, { cover: COVER, tieDia: TIE, barDia: DIA })
    const r = Math.hypot(gen.bars[0].x, gen.bars[0].y)
    expect(r).toBeCloseTo(300 - 75 - 8 - 10, 6)
  })

  it('lines the void of a box with its own covers', () => {
    const def = { kind: 'box', B: 1200, D: 1200, tw: 250, tf: 250, nx: 5, ny: 3 } as PredefinedSection
    const gen = generateSection(def, { cover: COVER, tieDia: TIE, barDia: DIA })
    // void spans 250..950; lining bars sit inside it by their own offsets
    const innerBottom = Math.min(...gen.bars.filter((b) => b.y > 100 && b.y < 300 && b.x > 200 && b.x < 1000).map((b) => b.y))
    expect(innerBottom).toBe(250 - (25 + 8 + 10))
    const innerTop = Math.max(...gen.bars.filter((b) => b.y > 900 && b.y < 1100 && b.x > 200 && b.x < 1000).map((b) => b.y))
    expect(innerTop).toBe(950 + (35 + 8 + 10))
  })
})

describe('cover audit — face assignment', () => {
  it('maps normals to faces by the region the polygon encloses', () => {
    expect(faceFromNormal(0, 1)).toBe('bottom')
    expect(faceFromNormal(0, -1)).toBe('top')
    expect(faceFromNormal(1, 0)).toBe('left')
    expect(faceFromNormal(-1, 0)).toBe('right')
  })

  it('finds the nearest face of a bar', () => {
    const nf = nearestFace({ x: 20, y: 300 }, RECT)
    expect(nf).not.toBeNull()
    expect(nf!.dist).toBeCloseTo(20, 6)
    expect(nf!.face).toBe('left')
    expect(nf!.surface).toBe('outer')
  })

  it('flags a bar that is short of its face cover', () => {
    const bars: Rebar[] = [
      { x: 93, y: 48, dia: DIA }, // bottom-left corner of a correct layout
      { x: 20, y: 552, dia: DIA }, // too close to the left face
      { x: 200, y: 590, dia: DIA }, // too close to the top face
    ]
    const audit = auditCovers(bars, RECT, COVER, TIE)
    expect(audit.bars[0].ok).toBe(true)
    expect(audit.bars[1].face).toBe('left')
    expect(audit.bars[1].required).toBe(75)
    expect(audit.bars[1].achieved).toBeCloseTo(2, 6)
    expect(audit.bars[1].ok).toBe(false)
    expect(audit.bars[2].face).toBe('top')
    expect(audit.bars[2].required).toBe(60)
    expect(audit.nShort).toBe(2)
    expect(audit.worst?.bar).toBe(2) // 73 mm short, vs 68 mm on bar 3
    expect(audit.faces.left.short).toBe(1)
    expect(audit.faces.bottom.bars).toBe(1)
  })

  it('passes on the layout the generator produced, for every predefined shape', () => {
    for (const kind of Object.keys(SHAPE_LABELS) as PredefinedSection['kind'][]) {
      const def = { ...defaultPredefined(kind) } as PredefinedSection
      if (def.kind === 'hollowCircle') def.innerRing = true
      const gen = generateSection(def, { cover: COVER, tieDia: TIE, barDia: DIA })
      const audit = auditCovers(gen.bars, gen.geometry, COVER, TIE)
      const bad = audit.bars.filter((s) => !s.ok)
      expect(bad, `${kind}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([])
      expect(audit.nShort).toBe(0)
    }
  })

  it('audits void lining bars against the void face cover', () => {
    const def = { kind: 'box', B: 1200, D: 1200, tw: 250, tf: 250, nx: 5, ny: 3 } as PredefinedSection
    const gen = generateSection(def, { cover: COVER, tieDia: TIE, barDia: DIA })
    const audit = auditCovers(gen.bars, gen.geometry, COVER, TIE)
    const lining = audit.bars.filter((s) => s.surface === 'inner')
    expect(lining.length).toBeGreaterThan(0)
    const bottomLining = lining.filter((s) => s.face === 'bottom')
    expect(bottomLining.length).toBeGreaterThan(0)
    // bars in the middle of the run sit exactly one void-bottom offset out
    const midRun = bottomLining.filter((s) => gen.bars[s.bar - 1].x > 300 && gen.bars[s.bar - 1].x < 900)
    expect(midRun.length).toBeGreaterThan(0)
    for (const s of midRun) {
      expect(s.required).toBe(25)
      expect(s.achieved).toBeCloseTo(25, 6)
    }
    // corner lining bars are further from the corner than from the face centre,
    // so they only ever exceed the requirement
    for (const s of lining) expect(s.achieved).toBeGreaterThanOrEqual(s.required - 1e-6)
  })

  it('tolerates the polygonisation error of a circular boundary', () => {
    const gen = generateSection({ kind: 'circle', D: 600, nBars: 16 }, { cover: COVER, tieDia: TIE, barDia: DIA })
    expect(gen.geometry.boundary.length).toBe(64)
    expect(polygonTolerance(gen.geometry)).toBeGreaterThan(0)
    expect(polygonTolerance(gen.geometry)).toBeLessThan(1.5)
    expect(polygonTolerance(RECT)).toBe(0)
    expect(auditCovers(gen.bars, gen.geometry, COVER, TIE).nShort).toBe(0)
  })
})

describe('snap bars to the entered cover', () => {
  it('shifts a short bar away from its face', () => {
    const bars: Rebar[] = [{ x: 20, y: 300, dia: DIA }]
    const r = snapBarsToCover(bars, RECT, COVER, TIE)
    expect(r.moved).toBe(1)
    expect(r.unfixable).toBe(0)
    expect(r.bars[0].x).toBeCloseTo(93, 1)
    expect(r.bars[0].y).toBeCloseTo(300, 6)
    expect(auditCovers(r.bars, RECT, COVER, TIE).nShort).toBe(0)
  })

  it('leaves bars that cannot satisfy two faces at once', () => {
    // a 40 mm wide sliver cannot host 75 mm left + 45 mm right cover
    const sliver: SectionGeometry = {
      boundary: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 600 },
        { x: 0, y: 600 },
      ],
      voids: [],
    }
    const r = snapBarsToCover([{ x: 20, y: 300, dia: DIA }], sliver, COVER, TIE)
    expect(r.unfixable).toBe(1)
    // bars are never left outside the concrete
    expect(r.bars[0].x).toBeGreaterThanOrEqual(0)
    expect(r.bars[0].x).toBeLessThanOrEqual(40)
  })

  it('does not move bars that already meet their face cover', () => {
    const gen = generateSection({ kind: 'rect', B: 400, D: 600, nx: 3, ny: 2 }, { cover: COVER, tieDia: TIE, barDia: DIA })
    const r = snapBarsToCover(gen.bars, gen.geometry, COVER, TIE)
    expect(r.moved).toBe(0)
    expect(r.bars).toEqual(gen.bars)
  })
})

describe('clause check rows (docs/09 V3)', () => {
  const spec = CODES.IS456
  const CASES: LoadCase[] = [{ id: 'lc-1', name: 'LC1', Pu: 1000, Mux: 20, Muy: 10 }]

  function rows(bars: Rebar[], geometry: SectionGeometry, cover: ReturnType<typeof normalizeCover>) {
    const props = sectionProperties(geometry, bars)
    return complianceChecks(spec, {
      props,
      bars,
      geometry,
      fck: 30,
      fy: 500,
      cases: CASES,
      shapeClass: 'rect',
      cover,
      tieDia: TIE,
    }).filter((r) => /cover/i.test(r.title))
  }

  it('reports the per-face limit and the governing achieved cover', () => {
    const gen = generateSection({ kind: 'rect', B: 400, D: 600, nx: 3, ny: 2 }, { cover: COVER, tieDia: TIE, barDia: DIA })
    const [row] = rows(gen.bars, gen.geometry, COVER)
    expect(row).toBeDefined()
    expect(row.clause).toBe('IS 456 Cl 26.4.2.1 / Table 16')
    expect(row.status).toBe('pass')
    expect(row.limit).toContain('bottom 30 / right 45 / top 60 / left 75')
    expect(row.demand).toContain('30.0 mm')
  })

  it('flags bars that are short of the cover of their own face', () => {
    const bars: Rebar[] = [
      { x: 93, y: 48, dia: DIA },
      { x: 307, y: 48, dia: DIA },
      { x: 93, y: 552, dia: DIA },
      { x: 20, y: 300, dia: DIA }, // 2 mm clear at the left face, 75 mm required
    ]
    const [row] = rows(bars, RECT, COVER)
    expect(row.status).toBe('fail')
    expect(row.note).toContain('bar 4')
    expect(row.demand).toContain('left face')
  })

  it('warns on covers above 75 mm and on covers thinner than the bars', () => {
    const fat = normalizeCover({ outer: { bottom: 40, right: 40, top: 90, left: 40 }, inner: {} })
    const gen = generateSection({ kind: 'rect', B: 400, D: 600, nx: 3, ny: 2 }, { cover: fat, tieDia: TIE, barDia: DIA })
    const found = rows(gen.bars, gen.geometry, fat)
    expect(found.some((r) => r.title === 'Maximum nominal cover' && r.status === 'warn')).toBe(true)

    const thin = normalizeCover({ outer: { bottom: 12, right: 12, top: 12, left: 12 }, inner: {} })
    const thinRows = rows(gen.bars, gen.geometry, thin)
    expect(thinRows.some((r) => r.title === 'Cover not less than bar diameter')).toBe(true)
  })

  it('is silent when no cover spec is supplied (engine-only callers)', () => {
    const props = sectionProperties(RECT, [{ x: 93, y: 48, dia: DIA }])
    const out = complianceChecks(spec, {
      props,
      bars: [{ x: 93, y: 48, dia: DIA }],
      geometry: RECT,
      fck: 30,
      fy: 500,
      cases: CASES,
      shapeClass: 'rect',
    })
    expect(out.some((r) => /cover/i.test(r.title))).toBe(false)
  })
})
