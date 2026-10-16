/**
 * Link detailing: the ring set out from the section and its cover, the automatic
 * arrangement derived from the bar table, the restraint validation and the
 * editors' coordinate helpers. The resistance check itself lives in
 * `shear.test.ts` — these tests only touch the geometry and the detailing rules.
 */
import { describe, expect, it } from 'vitest'
import {
  MEMBER_BAR_TOL,
  RESTRAINT_LIMIT,
  autoLinkMembers,
  barColumns,
  barRestraintDistance,
  buildLinkRing,
  hookPath,
  linkAreaBreakdown,
  memberCoordinate,
  normalisedPosition,
  resolveLinkLayout,
  suggestMemberPosition,
  validateLinkLayout,
  withResolvedLegs,
} from '../stirrups'
import { barArea, centroid } from '../geometry'
import { uniformCover } from '../cover'
import { generateSection } from '../sections'
import { shearCheck, shearSectionData } from '../shear'
import { DEFAULT_SHEAR } from '../shear'
import type { Rebar, SectionGeometry } from '../types'

const COVER = uniformCover(40)

function rect(B: number, D: number, nx: number, ny: number, cover = 40, tieDia = 8, barDia = 25) {
  const g = generateSection({ kind: 'rect', B, D, nx, ny }, { cover: uniformCover(cover), tieDia, barDia })
  return { geometry: g.geometry as SectionGeometry, bars: g.bars as Rebar[] }
}

/** Default-like section: 450 × 600, four 25 mm bars per face. */
function defaultSection() {
  return rect(450, 600, 4, 4)
}

function members(layout: ReturnType<typeof resolveLinkLayout>) {
  return layout.members.map((m) => ({ a: m.a, b: m.b }))
}

describe('link ring', () => {
  it('offsets every face by cover + ⌀/2, following the section shape', () => {
    const { geometry } = defaultSection()
    const ring = buildLinkRing(geometry, COVER, { ...DEFAULT_SHEAR, linkDia: 8 }, false)
    expect(ring.shape).toBe('rectangular')
    expect(ring.auto).toBe(true)
    expect(ring.inset).toBeCloseTo(44, 6)
    expect(ring.min.x).toBeCloseTo(44, 6)
    expect(ring.min.y).toBeCloseTo(44, 6)
    expect(ring.max.x).toBeCloseTo(406, 6)
    expect(ring.max.y).toBeCloseTo(556, 6)
    expect(ring.path).toHaveLength(4)
  })

  it('honours the cover of each face separately', () => {
    const { geometry } = defaultSection()
    const perFace = { ...uniformCover(40), outer: { ...uniformCover(40).outer, bottom: 60, left: 30 } }
    const ring = buildLinkRing(geometry, perFace, { ...DEFAULT_SHEAR, linkDia: 10 }, false)
    // bottom 60 + 5, left 30 + 5
    expect(ring.min.y).toBeCloseTo(65, 6)
    expect(ring.min.x).toBeCloseTo(35, 6)
    expect(ring.max.y).toBeCloseTo(600 - 45, 6)
  })

  it('builds a concentric hoop for a circular section and can force one in a rectangle', () => {
    const circle = generateSection({ kind: 'circle', D: 800, nBars: 12 }, { cover: COVER, tieDia: 8, barDia: 25 })
    const ring = buildLinkRing(circle.geometry as SectionGeometry, COVER, { ...DEFAULT_SHEAR, linkDia: 8 }, true)
    expect(ring.shape).toBe('circular')
    expect(ring.circle!.r).toBeCloseTo(400 - 44, 6)
    // the generated circle is centred on the origin
    expect(ring.circle!.cx).toBeCloseTo(0, 6)
    expect(ring.circle!.cy).toBeCloseTo(0, 6)

    const { geometry } = defaultSection()
    const forced = buildLinkRing(geometry, COVER, { ...DEFAULT_SHEAR, linkShape: 'circular' }, false)
    expect(forced.shape).toBe('circular')
    expect(forced.circle!.r).toBeCloseTo(Math.hypot(225, 300) - 44, 6)
  })

  it('never collapses: a cover larger than the section still yields a drawable ring', () => {
    const { geometry } = rect(200, 200, 2, 2, 140)
    const ring = buildLinkRing(geometry, uniformCover(140), { ...DEFAULT_SHEAR, linkDia: 12 }, false)
    expect(ring.path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(Math.abs(ring.path.reduce((s, p, i) => s + (p.x * ring.path[(i + 1) % ring.path.length].y - ring.path[(i + 1) % ring.path.length].x * p.y), 0) / 2)).toBeGreaterThan(0)
  })
})

describe('automatic arrangement', () => {
  it('places one leg on every interior bar column that ties top to bottom reinforcement', () => {
    const { geometry, bars } = defaultSection()
    const ring = buildLinkRing(geometry, COVER, DEFAULT_SHEAR, false)
    // the four bars per face leave two interior columns, each with a bar in the
    // bottom layer and a bar in the top layer
    const columns = barColumns(bars, 'leg', DEFAULT_SHEAR.axis)
    expect(columns.map((c) => Math.round(c.coord))).toEqual([61, 170, 280, 390])
    expect(columns.filter((c) => c.spans).map((c) => Math.round(c.coord))).toEqual([61, 170, 280, 390])

    const auto = autoLinkMembers(ring, geometry, bars, DEFAULT_SHEAR, false)
    // the two interior columns take a leg, so nothing is left to tie
    expect(auto.legs).toHaveLength(2)
    expect(auto.ties).toEqual([])

    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    expect(layout.effectiveLegs).toBe(4)
    // each leg stands exactly on its bar column and runs between bottom and top
    for (const m of layout.intermediate) {
      const column = columns.find((c) => Math.abs(c.coord - m.a.x) < 0.05)
      expect(column).toBeDefined()
      expect(column!.spans).toBe(true)
      expect(m.bars.length).toBe(2)
      expect(m.ends.a).not.toBeNull()
      expect(m.ends.b).not.toBeNull()
      // the leg is drawn between the horizontal runs of the ring, i.e. it ends on
      // the ring centreline top and bottom
      expect(Math.min(m.a.y, m.b.y)).toBeCloseTo(ring.min.y, 6)
      expect(Math.max(m.a.y, m.b.y)).toBeCloseTo(ring.max.y, 6)
    }
    const v = validateLinkLayout(layout, geometry, bars, DEFAULT_SHEAR)
    expect(v.status).toBe('ok')
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual([])
  })

  it('adds intermediate legs for a wide section and restrains every bar', () => {
    const { geometry, bars } = rect(900, 1200, 6, 6)
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    // a 900 mm wide beam is detailed with intermediate legs; a leg restrains a whole
    // column of bars and is link steel, so the legs are what the rule places first
    expect(layout.intermediate.length).toBeGreaterThanOrEqual(2)
    expect(layout.effectiveLegs).toBe(2 + layout.intermediate.length)
    // legs span the depth (shear along y), cross-ties span the width
    for (const m of layout.members) {
      expect(m.length).toBeGreaterThan(0)
      if (m.kind === 'leg') expect(Math.abs(m.a.x - m.b.x)).toBeLessThan(1e-6)
      else expect(Math.abs(m.a.y - m.b.y)).toBeLessThan(1e-6)
    }
    const v = validateLinkLayout(layout, geometry, bars, DEFAULT_SHEAR)
    expect(v.unrestrained).toEqual([])
    expect(v.status).toBe('ok')
  })

  it('places each automatic member on a bar column or a bar level', () => {
    const { geometry, bars } = rect(900, 1200, 6, 6)
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    for (const m of layout.members) {
      expect(m.nearestBar).not.toBeNull()
      expect(m.nearestBar!).toBeLessThanOrEqual(Math.max(25, 1.5 * 25))
    }
  })

  it('restrains a narrow deep section from the bar columns alone — no member beside the ring leg', () => {
    // 200 mm wide: the interior columns carry a bottom and a top bar, so they take
    // an internal leg, and the side-face bars already sit on the ring's own legs
    const { geometry, bars } = rect(200, 1500, 4, 10)
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    expect(layout.intermediate.length).toBe(2)
    expect(layout.ties).toEqual([])
    expect(layout.effectiveLegs).toBe(4)
    const v = validateLinkLayout(layout, geometry, bars, DEFAULT_SHEAR)
    expect(v.errors).toEqual([])
    expect(v.unrestrained).toEqual([])
  })

  it('reads the bar table as columns, each reaching both layers of reinforcement', () => {
    const { bars } = defaultSection()
    const legColumns = barColumns(bars, 'leg', DEFAULT_SHEAR.axis)
    expect(legColumns.map((c) => Math.round(c.coord))).toEqual([61, 170, 280, 390])
    // every bar of the table sits on exactly one column, and the two middle
    // columns carry a bottom bar and a top bar each
    expect(legColumns.reduce((n, c) => n + c.bars.length, 0)).toBe(bars.length)
    expect(legColumns.map((c) => c.spans)).toEqual([true, true, true, true])
    expect(legColumns[1].bars.length).toBe(2)
    expect(legColumns[2].bars.length).toBe(2)
    for (const c of legColumns) {
      expect(c.ends.a).not.toBeNull()
      expect(c.ends.b).not.toBeNull()
    }

    // a tie column instead runs across the width: the two side-face bars of a level
    // sit on one line and a tie across it is hooked around both
    const tieColumns = barColumns(bars, 'tie', DEFAULT_SHEAR.axis)
    expect(tieColumns.map((c) => Math.round(c.coord))).toEqual([61, 156, 252, 348, 444, 540])
    expect(tieColumns.reduce((n, c) => n + c.bars.length, 0)).toBe(bars.length)
    const middle = tieColumns.find((c) => Math.round(c.coord) === 252)!
    // the bars of a column are listed in depth order (the far side first)
    expect(middle.bars.map((i) => i + 1).sort((a, b) => a - b)).toEqual([10, 14])
    expect(middle.spans).toBe(true)
    expect(middle.ends.a).not.toBeNull()
    expect(middle.ends.b).not.toBeNull()

    // a column with no bar in the far layer is a column that does not span, so it
    // is not the column an internal leg is placed on
    const partialBars: typeof bars = [
      { x: 100, y: 60.5, dia: 25 },
      { x: 300, y: 60.5, dia: 25 },
      { x: 300, y: 540, dia: 25 },
    ]
    const partial = barColumns(partialBars, 'leg', DEFAULT_SHEAR.axis)
    expect(partial.map((c) => Math.round(c.coord))).toEqual([100, 300])
    expect(partial.map((c) => c.spans)).toEqual([false, true])
    expect(partial[0].ends.a).not.toBeNull()
    expect(partial[0].ends.b).toBeNull()
    expect(barColumns([], 'leg', DEFAULT_SHEAR.axis)).toEqual([])
  })

  it('anchors every member on the bars it runs along and reports one that lines up with none', () => {
    const { geometry, bars } = defaultSection()
    const onColumn = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    for (const m of onColumn.members) {
      expect(m.bars.length).toBeGreaterThan(0)
      expect(m.ends.a).not.toBeNull()
      expect(m.ends.b).not.toBeNull()
    }

    // a manually entered leg between two columns is reported, not moved
    const between = bars[1].x + 45
    const u = normalisedPosition(geometry, 'leg', between, DEFAULT_SHEAR.axis)
    const offBar = resolveLinkLayout(
      geometry,
      bars,
      COVER,
      { ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [u] },
      false,
    )
    const leg = offBar.intermediate[0]
    expect(leg.a.x).toBeCloseTo(between, 6)
    expect(leg.bars).toEqual([])
    expect(leg.ends).toEqual({ a: null, b: null })
    const v = validateLinkLayout(offBar, geometry, bars, DEFAULT_SHEAR)
    expect(v.errors).toEqual([])
    expect(v.status).toBe('warn')
    expect(v.warnings.join(' ')).toMatch(/lines up with a longitudinal bar at neither end/)
    // one leg on its own leaves the side-face bars unrestrained, and that is reported
    expect(v.unrestrained.length).toBeGreaterThan(0)
    expect(v.warnings.join(' ')).toMatch(/from the nearest leg, cross-tie or link corner/)
  })

  it('warns about a longitudinal bar the closed link does not enclose', () => {
    const { geometry, bars } = defaultSection()
    const outside: Rebar[] = [...bars, { x: 20, y: 300, dia: 25 }]
    const layout = resolveLinkLayout(geometry, outside, COVER, DEFAULT_SHEAR, false)
    const v = validateLinkLayout(layout, geometry, outside, DEFAULT_SHEAR)
    expect(v.warnings.join(' ')).toMatch(/lies outside the link ring/)
    // the bar itself is reported by number
    const index = outside.findIndex((b) => b.x === 20)
    expect(v.warnings.join(' ')).toContain(`Bar ${index + 1} at (20, 300)`)
  })

  it('places an arrangement that always passes its own validation', () => {
    const cases: { name: string; geometry: SectionGeometry; bars: Rebar[]; circular: boolean }[] = [
      { name: 'rect', ...defaultSection(), circular: false },
      { name: 'wide rect', ...rect(900, 1200, 6, 6), circular: false },
      { name: 'narrow deep rect', ...rect(200, 1500, 4, 10), circular: false },
      { name: 'box', ...boxLike(), circular: false },
      { name: 'circle', ...circleLike(), circular: true },
    ]
    for (const c of cases) {
      const layout = resolveLinkLayout(c.geometry, c.bars, COVER, DEFAULT_SHEAR, c.circular)
      const v = validateLinkLayout(layout, c.geometry, c.bars, DEFAULT_SHEAR)
      expect({ name: c.name, errors: v.errors }).toEqual({ name: c.name, errors: [] })
      expect({ name: c.name, unrestrained: v.unrestrained }).toEqual({ name: c.name, unrestrained: [] })
    }

    function boxLike() {
      const g = generateSection({ kind: 'box', B: 800, D: 1000, tw: 150, tf: 150, nx: 4, ny: 5 }, { cover: COVER, tieDia: 8, barDia: 25 })
      return { geometry: g.geometry as SectionGeometry, bars: g.bars as Rebar[] }
    }
    function circleLike() {
      const g = generateSection({ kind: 'circle', D: 800, nBars: 16 }, { cover: COVER, tieDia: 8, barDia: 25 })
      return { geometry: g.geometry as SectionGeometry, bars: g.bars as Rebar[] }
    }
  })

  it('never adds a member that would only double one of the ring legs', () => {
    // a 400 x 600 section whose ring runs from 44 mm to 356 mm; one bar sits 4 mm
    // inside the left leg of the ring, so a leg there would merely repeat it
    const boundary = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 600 },
      { x: 0, y: 600 },
    ]
    const geometry: SectionGeometry = { boundary, voids: [] }
    const bars: Rebar[] = [
      { x: 58, y: 58, dia: 25 },
      { x: 342, y: 58, dia: 25 },
      { x: 58, y: 542, dia: 25 },
      { x: 342, y: 542, dia: 25 },
      { x: 48, y: 300, dia: 25 },
    ]
    const ring = buildLinkRing(geometry, COVER, DEFAULT_SHEAR, false)
    const auto = autoLinkMembers(ring, geometry, bars, DEFAULT_SHEAR, false)
    // the leg the bar would ask for is skipped, and its level is tied instead
    expect(auto.legs).toEqual([])
    expect(auto.ties).toHaveLength(1)
    expect(auto.ties[0]).toBeCloseTo(0.5, 3)
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    expect(layout.intermediate).toEqual([])
    expect(validateLinkLayout(layout, geometry, bars, DEFAULT_SHEAR).unrestrained).toEqual([])
  })

  it('keeps the automatic arrangement symmetric for a symmetric bar table', () => {
    for (const r of [rect(900, 1200, 6, 6), rect(200, 1500, 4, 10), defaultSection()]) {
      const auto = autoLinkMembers(buildLinkRing(r.geometry, COVER, DEFAULT_SHEAR, false), r.geometry, r.bars, DEFAULT_SHEAR, false)
      expect(auto.legs.length).toBeGreaterThan(0)
      for (const u of [...auto.legs, ...auto.ties]) {
        const mirror = Math.round((1 - u) * 1e4) / 1e4
        const list = auto.legs.includes(u) ? auto.legs : auto.ties
        expect({ list: list.length ? list : auto.legs, u }).toEqual({ list, u })
        expect(list.some((v) => Math.abs(v - mirror) < 1e-3)).toBe(true)
      }
    }
  })

  it('leaves a circular hoop to the user and survives an empty bar table', () => {
    const circle = generateSection({ kind: 'circle', D: 800, nBars: 12 }, { cover: COVER, tieDia: 8, barDia: 25 })
    const geo = circle.geometry as SectionGeometry
    const layout = resolveLinkLayout(geo, circle.bars as Rebar[], COVER, DEFAULT_SHEAR, true)
    expect(layout.ring.shape).toBe('circular')
    expect(layout.members).toEqual([])
    expect(layout.effectiveLegs).toBe(2)
    expect(layout.notes.join(' ')).toMatch(/Circular hoop/)

    const empty = resolveLinkLayout(geo, [], COVER, DEFAULT_SHEAR, false)
    expect(empty.members).toEqual([])
  })

  it('follows the bar table when the bars change — new columns pull in legs, gone columns drop them', () => {
    const { geometry, bars } = defaultSection()
    const before = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    expect(before.intermediate.map((m) => Math.round(m.a.x))).toEqual([170, 280])

    // a bottom and a top bar inserted on one line create a new column: a leg appears
    const inserted = [...bars, { ...bars[0], x: 114, y: 60.5 }, { ...bars[1], x: 114, y: 539.5 } as Rebar]
    const after = resolveLinkLayout(geometry, inserted, COVER, DEFAULT_SHEAR, false)
    expect(after.intermediate.length).toBe(before.intermediate.length + 1)
    // every internal leg of the new arrangement stands on a column of the new table
    for (const m of after.intermediate) {
      const onColumn = inserted.some((b) => Math.abs(b.x - m.a.x) < 0.05)
      expect({ x: Math.round(m.a.x), onColumn }).toEqual({ x: Math.round(m.a.x), onColumn: true })
    }
    // and it is the new column that took the leg
    expect(after.intermediate.some((m) => Math.abs(m.a.x - 114) < 0.05)).toBe(true)

    // removing the top bars of a column takes its leg away again
    const columnX = before.intermediate[0].a.x
    const withoutTop = bars.filter((b) => !(Math.abs(b.x - columnX) < 0.05 && b.y > 300))
    const pruned = resolveLinkLayout(geometry, withoutTop, COVER, DEFAULT_SHEAR, false)
    expect(pruned.intermediate.map((m) => Math.round(m.a.x))).toEqual([280])
    expect(validateLinkLayout(pruned, geometry, withoutTop, DEFAULT_SHEAR).unrestrained).toEqual([])
  })

  it('honours the shear direction: legs cut the force direction, ties run across the width', () => {
    const { geometry, bars } = rect(900, 1200, 6, 6)
    const xAxis = { ...DEFAULT_SHEAR, axis: 'x' as const, tensionFace: 'right' as const }
    const layout = resolveLinkLayout(geometry, bars, COVER, xAxis, false)
    for (const m of layout.members) {
      if (m.kind === 'leg') expect(Math.abs(m.a.y - m.b.y)).toBeLessThan(1e-6)
      else expect(Math.abs(m.a.x - m.b.x)).toBeLessThan(1e-6)
    }
  })
})

describe('layout and the resistance check', () => {
  it('reports the effective legs and Asv of the drawn arrangement', () => {
    const { geometry, bars } = rect(900, 1200, 6, 6)
    const layout = resolveLinkLayout(geometry, bars, COVER, { ...DEFAULT_SHEAR, linkDia: 10, linkSpacing: 200 }, false)
    const single = barArea(10)
    expect(layout.singleLegArea).toBeCloseTo(single, 9)
    expect(layout.totalLegArea).toBeCloseTo(layout.effectiveLegs * single, 9)
    expect(layout.asvPerS).toBeCloseTo((layout.effectiveLegs * single) / 200, 9)
    expect(layout.ties.every((t) => !t.effective)).toBe(true)
    expect(linkAreaBreakdown(layout, { ...DEFAULT_SHEAR, linkDia: 10, linkSpacing: 200 })).toMatchObject({
      ringLegs: 2,
      intermediate: layout.intermediate.length,
      effectiveLegs: layout.effectiveLegs,
      ties: layout.ties.length,
      spacing: 200,
    })
  })

  it('feeds the effective leg count into the engine without touching the equations', () => {
    const { geometry, bars } = defaultSection()
    const twoLegs = { ...DEFAULT_SHEAR, linkLayout: 'manual' as const, legPositions: [], tiePositions: [] }
    const fourLegs = { ...DEFAULT_SHEAR, linkLayout: 'manual' as const, legPositions: [0.3, 0.7], tiePositions: [] }
    const l2 = resolveLinkLayout(geometry, bars, COVER, twoLegs, false)
    const l4 = resolveLinkLayout(geometry, bars, COVER, fourLegs, false)
    expect(l2.effectiveLegs).toBe(2)
    expect(l4.effectiveLegs).toBe(4)

    const lc = { id: 'c1', name: 'C1', Vu: 320, Pu: 0 }
    const fy = 500
    const r2 = shearCheck('IS456', 30, fy, geometry, bars, COVER, withResolvedLegs(twoLegs, l2), lc)
    const r4 = shearCheck('IS456', 30, fy, geometry, bars, COVER, withResolvedLegs(fourLegs, l4), lc)
    expect(r2.asvPerSProvided).toBeCloseTo((2 * barArea(8)) / 150, 6)
    expect(r4.asvPerSProvided).toBeCloseTo((4 * barArea(8)) / 150, 6)
    expect(r4.VRd).toBeGreaterThan(r2.VRd)
    // same section and concrete, so the concrete contribution is unchanged
    expect(r4.Vc).toBeCloseTo(r2.Vc, 6)
    expect(shearSectionData(geometry, bars, COVER, withResolvedLegs(fourLegs, l4)).d).toBeCloseTo(
      shearSectionData(geometry, bars, COVER, withResolvedLegs(twoLegs, l2)).d,
      9,
    )
  })

  it('keeps ties out of Asv', () => {
    const { geometry, bars } = defaultSection()
    const tiesOnly = { ...DEFAULT_SHEAR, linkLayout: 'manual' as const, legPositions: [], tiePositions: [0.4, 0.6] }
    const layout = resolveLinkLayout(geometry, bars, COVER, tiesOnly, false)
    expect(layout.ties).toHaveLength(2)
    expect(layout.effectiveLegs).toBe(2)
  })
})

describe('detailing validation', () => {
  const caseOf = (settings: typeof DEFAULT_SHEAR, geo = defaultSection()) => {
    const layout = resolveLinkLayout(geo.geometry, geo.bars, COVER, settings, false)
    return { layout, v: validateLinkLayout(layout, geo.geometry, geo.bars, settings) }
  }

  it('reports a position outside the section without moving it', () => {
    const { layout, v } = caseOf({ ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [1.4] })
    expect(v.status).toBe('error')
    expect(v.errors.join(' ')).toMatch(/lies outside the section outline/)
    // the entered value is kept, not clamped
    expect(layout.dropped).toContainEqual({ kind: 'leg', u: 1.4 })
    expect(memberCoordinate(defaultSection().geometry, 'leg', 1.4, 'y')).toBeCloseTo(630, 6)
  })

  it('reports a member on the ring, a member too close to another and coincident ties', () => {
    // the ring's own leg sits at mm 44, i.e. u = 44/450
    const onRing = caseOf({ ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [44 / 450] })
    expect(onRing.layout.dropped).toEqual([])
    expect(onRing.v.errors.join(' ')).toMatch(/duplicates the ring's own leg/)
    const tooClose = caseOf({ ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [0.4, 0.42] })
    expect(tooClose.v.errors.join(' ')).toMatch(/apart — provide at least 25 mm clear/)
    const dupTies = caseOf({ ...DEFAULT_SHEAR, linkLayout: 'manual', tiePositions: [0.5, 0.5] })
    expect(dupTies.v.errors.length).toBeGreaterThan(0)
  })

  it('restrains every bar of the automatic arrangement of a wide section', () => {
    const geo = rect(900, 1200, 6, 6)
    const ring = buildLinkRing(geo.geometry, COVER, DEFAULT_SHEAR, false)
    const layout = resolveLinkLayout(geo.geometry, geo.bars, COVER, DEFAULT_SHEAR, false)
    expect(RESTRAINT_LIMIT).toBe(150)
    for (const bar of geo.bars) {
      expect(barRestraintDistance(bar, ring, layout.members) - RESTRAINT_LIMIT <= 1e-9).toBe(true)
    }
  })

  it('warns about an unrestrained bar and names it', () => {
    const geo = rect(900, 1200, 6, 6)
    // a bar in the middle of a void-free pocket, far from every link bend
    const bars = [...geo.bars, { x: 450, y: 600, dia: 25, face: undefined, faces: undefined } as Rebar]
    const settings = { ...DEFAULT_SHEAR, linkLayout: 'manual' as const, legPositions: [], tiePositions: [] }
    const layout = resolveLinkLayout(geo.geometry, bars, COVER, settings, false)
    const v = validateLinkLayout(layout, geo.geometry, bars, settings)
    expect(v.unrestrained.length).toBeGreaterThan(0)
    expect(v.warnings.join(' ')).toMatch(/is \d+ mm from the nearest leg, cross-tie or link corner/)
    expect(v.status).toBe('warn')
  })

  it('flags a ring that cannot hold the entered cover, a forced shape, voids and circular ties', () => {
    // 40 mm cover + 4 mm to the link centreline inside a 20 mm deep section
    const thin = rect(300, 20, 2, 2, 40)
    const collapsed = resolveLinkLayout(thin.geometry, thin.bars, uniformCover(40), DEFAULT_SHEAR, false)
    const cv = validateLinkLayout(collapsed, thin.geometry, thin.bars, DEFAULT_SHEAR)
    expect(collapsed.ring.reduced).toBe(true)
    expect(cv.errors.join(' ')).toMatch(/does not fit inside the section with the entered cover/)
    // the reduced ring stays drawable — the error explains it rather than the drawing
    expect(collapsed.ring.path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)

    const box = generateSection({ kind: 'box', B: 800, D: 900, tw: 100, tf: 100, nx: 4, ny: 4 }, { cover: uniformCover(40), tieDia: 8, barDia: 25 })
    const bv = validateLinkLayout(
      resolveLinkLayout(box.geometry as SectionGeometry, box.bars as Rebar[], COVER, DEFAULT_SHEAR, false),
      box.geometry as SectionGeometry,
      box.bars as Rebar[],
      DEFAULT_SHEAR,
    )
    expect(bv.warnings.join(' ')).toMatch(/void-face links are outside this module/)

    const circle = generateSection({ kind: 'circle', D: 800, nBars: 12 }, { cover: COVER, tieDia: 8, barDia: 25 })
    const circ = { ...DEFAULT_SHEAR, linkLayout: 'manual' as const, tiePositions: [0.5] }
    const chordTie = resolveLinkLayout(circle.geometry as SectionGeometry, circle.bars as Rebar[], COVER, circ, true)
    const chv = validateLinkLayout(chordTie, circle.geometry as SectionGeometry, circle.bars as Rebar[], circ)
    expect(chv.warnings.join(' ')).toMatch(/Straight cross-ties across a circular hoop/)
  })
})

describe('editor helpers', () => {
  it('draws a non-rectangular outline without errors and reports the link-shape caveat', () => {
    // a tee: the perimeter link follows the outline, which a detailing drawing has
    // to confirm — it is a warning, not a failure of the section
    const tee = generateSection(
      { kind: 'tee', bf: 900, tf: 150, bw: 300, D: 750, nFlange: 6, nWeb: 6 },
      { cover: COVER, tieDia: 8, barDia: 25 },
    )
    const geometry = tee.geometry as SectionGeometry
    const bars = tee.bars as Rebar[]
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    const v = validateLinkLayout(layout, geometry, bars, DEFAULT_SHEAR)
    expect(layout.ring.shape).toBe('rectangular')
    expect(v.errors).toEqual([])
    expect(v.status).toBe('warn')
    expect(v.warnings.join(' ')).toMatch(/non-rectangular section/)
    expect(layout.ring.path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)

    // a 200 mm circle with 140 mm cover: the hoop has no radius left at all
    const small = generateSection({ kind: 'circle', D: 200, nBars: 6 }, { cover: uniformCover(140), tieDia: 8, barDia: 25 })
    const smallGeometry = small.geometry as SectionGeometry
    const smallLayout = resolveLinkLayout(smallGeometry, small.bars as Rebar[], uniformCover(140), DEFAULT_SHEAR, true)
    expect(smallLayout.ring.circle!.r).toBe(0)
    const smallValidation = validateLinkLayout(smallLayout, smallGeometry, small.bars as Rebar[], DEFAULT_SHEAR)
    expect(smallValidation.status).toBe('error')
    expect(smallValidation.errors.join(' ')).toMatch(/circular link does not fit/)
  })

  it('uses one tolerance for "this bar sits on this line"', () => {
    expect(MEMBER_BAR_TOL).toBe(25)
    const { geometry, bars } = defaultSection()
    // a leg 20 mm off a bar column still counts as running along it ...
    const near = normalisedPosition(geometry, 'leg', bars[1].x + 20, DEFAULT_SHEAR.axis)
    // ... a 30 mm offset is still within the clear tolerance ...
    const mid = normalisedPosition(geometry, 'leg', bars[1].x + 30, DEFAULT_SHEAR.axis)
    const midLayout = resolveLinkLayout(geometry, bars, COVER, { ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [mid] }, false)
    const nearLayout = resolveLinkLayout(geometry, bars, COVER, { ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [near] }, false)
    expect(nearLayout.intermediate[0].bars.length).toBeGreaterThan(0)
    expect(midLayout.intermediate[0].bars).toEqual([1, 5])
    // ... and one 45 mm off (32.5 mm clear) does not
    const far = normalisedPosition(geometry, 'leg', bars[1].x + 45, DEFAULT_SHEAR.axis)
    const farLayout = resolveLinkLayout(geometry, bars, COVER, { ...DEFAULT_SHEAR, linkLayout: 'manual', legPositions: [far] }, false)
    expect(farLayout.intermediate[0].bars).toEqual([])
  })

  it('round-trips between normalised positions and millimetre coordinates, unclamped', () => {
    const { geometry } = defaultSection()
    for (const u of [0, 0.25, 0.5, 1, 1.3, -0.2]) {
      const mm = memberCoordinate(geometry, 'leg', u, 'y')
      expect(normalisedPosition(geometry, 'leg', mm, 'y')).toBeCloseTo(u, 9)
    }
    expect(memberCoordinate(geometry, 'leg', 0.5, 'y')).toBeCloseTo(225, 6)
    expect(memberCoordinate(geometry, 'tie', 0.5, 'y')).toBeCloseTo(300, 6)
    // axis x swaps the axes: a leg is measured across the y extent
    expect(memberCoordinate(geometry, 'leg', 0.5, 'x')).toBeCloseTo(300, 6)
  })

  it('suggests a free position — on a bar when one is available, in the widest gap otherwise', () => {
    const { geometry, bars } = defaultSection()
    const ring = buildLinkRing(geometry, COVER, DEFAULT_SHEAR, false)
    const empty = suggestMemberPosition('leg', [], ring, geometry, bars, DEFAULT_SHEAR, false)
    expect(empty).toBeGreaterThan(0)
    expect(empty).toBeLessThan(1)
    const again = suggestMemberPosition('tie', [empty], ring, geometry, bars, DEFAULT_SHEAR, false)
    expect(Math.abs(again - empty)).toBeGreaterThan(0.03)

    // the suggestion is a bar column of the section, so a new leg lands on bars
    const columns = barColumns(bars, 'leg', DEFAULT_SHEAR.axis).map((c) => (c.coord - 0) / 450)
    expect(columns.some((c) => Math.abs(c - empty) < 1e-3)).toBe(true)

    // with every column taken the suggestion lands in the widest free gap
    const all = [0.2, 0.8]
    const gap = suggestMemberPosition('leg', all, ring, geometry, bars, DEFAULT_SHEAR, false)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(1)
  })

  it('bends hooks back at 135° and turns the tail into the section', () => {
    const { geometry } = defaultSection()
    const c = centroid(geometry.boundary)
    // leg end at the top of the ring, travelling outwards (up the page in model y)
    const end = { x: 225, y: 556 }
    const other = { x: 225, y: 44 }
    const inward = { x: c.x - end.x, y: c.y - end.y }
    const hook = hookPath(end, other, 48, inward)
    expect(hook).toHaveLength(2)
    const [p0, p1] = hook
    expect(p0).toEqual(end)
    const d = { x: p1.x - p0.x, y: p1.y - p0.y }
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(48, 6)
    // 135° between the bar's travel (0, +1) and the tail
    const cos = d.y / 48
    expect(-cos).toBeCloseTo(Math.SQRT1_2, 9)
    // and it turns inside the ring
    expect(d.y * inward.y).toBeGreaterThan(0)

    // a cross-tie hook turns towards the depth the tie sits at
    const tieHook = hookPath({ x: 44, y: 220 }, { x: 406, y: 220 }, 40, { x: 181, y: 80 })
    const td = { x: tieHook[1].x - tieHook[0].x, y: tieHook[1].y - tieHook[0].y }
    expect(Math.hypot(td.x, td.y)).toBeCloseTo(40, 6)
    expect(td.x).toBeGreaterThan(0)
    expect(td.y).toBeGreaterThan(0)
  })

  it('keeps member endpoints on the ring centreline', () => {
    const { geometry, bars } = rect(900, 1200, 6, 6)
    const layout = resolveLinkLayout(geometry, bars, COVER, DEFAULT_SHEAR, false)
    const ring = layout.ring.path
    for (const m of members(layout)) {
      for (const p of [m.a, m.b]) {
        const nearest = Math.min(
          ...ring.map((q, i) => {
            const r = ring[(i + 1) % ring.length]
            const dx = r.x - q.x
            const dy = r.y - q.y
            const l2 = dx * dx + dy * dy
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / l2)) : 0
            return Math.hypot(p.x - (q.x + t * dx), p.y - (q.y + t * dy))
          }),
        )
        expect(nearest).toBeLessThan(0.5)
      }
    }
  })
})
