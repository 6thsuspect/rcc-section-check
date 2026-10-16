/**
 * The section geometry an import brings in: the shape controls, the boundary and
 * its openings, and the properties the rest of the app derives from them.
 *
 * These pin the second half of the import requirement — after a file is read the
 * panel must show *that* section, not the one it replaced — plus the fact that
 * the diagram and the calculated properties follow the same geometry. The panels
 * are rendered to static markup (there is no DOM in this repo) and the wiring
 * that only exists after a re-render is asserted from the source, as the other
 * component tests here do.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionPanel } from '../Editors'
import { ClearCoverPanel } from '../CoverPanel'
import { SectionPreview } from '../SectionPreview'
import { CircularRebarPanel, configForImportedSection } from '../CircularRebarPanel'
import { defaultCircularRebarConfig } from '../../engine/circularRebar'
import { importProjectText } from '../../importFile'
import { initialState, type AppState } from '../../state'
import { sectionProperties } from '../../engine/geometry'
import { auditCovers } from '../../engine/cover'
import { generateSection } from '../../engine/sections'
import { ensureCCW } from '../../engine/geometry'
import { buildAnalysisModel } from '../../engine/integrator'
import { checkLoadCase, generateSurface } from '../../engine/surface'
import { complianceChecks } from '../../engine/checks'
import { CODES } from '../../engine/codes'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const noop = () => {}

/** A file read into state, as the Import button does it. */
function imported(file: unknown, current: AppState = initialState()): AppState {
  return importProjectText(JSON.stringify(file), current).state
}

/** The §-values on the numeric fields of the section panel, in field order. */
function fieldValue(html: string, label: string): string | null {
  const at = html.indexOf(`>${label}<`)
  if (at < 0) return null
  return /value="([^"]*)"/.exec(html.slice(at, at + 1200))?.[1] ?? null
}

describe('imported section geometry — the shape controls', () => {
  it('switches the panel to the section type the file describes', () => {
    const circle = imported({ sectionType: 'circle', diameter: 600, nBars: 8 })
    expect(circle.predefined).toMatchObject({ kind: 'circle', D: 600 })
    expect(renderToStaticMarkup(<SectionPanel state={circle} update={noop} />)).toContain('>Diameter D<')

    // the same import over a circular section brings a T-beam, and the panel
    // shows the T-beam's own dimensions
    const tee = imported(
      { sectionType: 'tee', bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 },
      circle,
    )
    expect(tee.predefined).toEqual({ kind: 'tee', bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 })
    const html = renderToStaticMarkup(<SectionPanel state={tee} update={noop} />)
    expect(html).toContain('>Flange bf<')
    expect(fieldValue(html, 'Flange bf')).toBe('1200')
    expect(fieldValue(html, 'Flange tf')).toBe('200')
    expect(fieldValue(html, 'Web bw')).toBe('300')
    expect(fieldValue(html, 'Depth D')).toBe('900')
    expect(fieldValue(html, 'Flange bars')).toBe('6')
    expect(fieldValue(html, 'Web bars')).toBe('3')
    expect(html).not.toContain('>Diameter D<')
  })

  it('fills every geometry input of every supported section type', () => {
    const files: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['rect', { sectionType: 'rect', B: 300, D: 500, nx: 4, ny: 2 }, { kind: 'rect', B: 300, D: 500, nx: 4, ny: 2 }],
      ['circle', { sectionType: 'circle', D: 750, nBars: 10 }, { kind: 'circle', D: 750, nBars: 10 }],
      ['hollowCircle', { sectionType: 'hollowCircle', Do: 900, Di: 700, nBars: 12 }, { kind: 'hollowCircle', Do: 900, Di: 700, nBars: 12 }],
      ['tee', { sectionType: 'tee', bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 }, { kind: 'tee', bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 }],
      ['ishape', { sectionType: 'ishape', bf1: 500, tf1: 150, bf2: 600, tf2: 175, tw: 200, D: 900, nFlange: 4, nWeb: 3 }, { kind: 'ishape', bf1: 500, tf1: 150, bf2: 600, tf2: 175, tw: 200, D: 900, nFlange: 4, nWeb: 3 }],
      ['angle', { sectionType: 'angle', B: 600, D: 450, tw: 200, tf: 150 }, { kind: 'angle', B: 600, D: 450, tw: 200, tf: 150 }],
      ['box', { sectionType: 'box', B: 1200, D: 1100, tw: 250, tf: 225, nx: 5, ny: 3 }, { kind: 'box', B: 1200, D: 1100, tw: 250, tf: 225, nx: 5, ny: 3 }],
    ]
    for (const [label, file, expected] of files) {
      const state = imported(file)
      expect(state.predefined, label).toMatchObject(expected)
      // the geometry is the generator's, fed with the file's own parameters
      const gen = generateSection(state.predefined!, { cover: state.cover, tieDia: state.tieDia, barDia: state.barDia })
      expect(state.geometry, label).toEqual(gen.geometry)
      expect(state.shapeClass, label).toBe(gen.shapeClass)
    }
  })

  it('shows the imported dimensions in the boundary table and the figure', () => {
    // coordinates written as pairs, through the `points` alias
    const state = imported({ points: [[0, 0], [800, 0], [800, 400], [0, 400]] })
    expect(state.predefined).toBe(null)
    expect(state.geometry.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ])
    const panel = renderToStaticMarkup(<SectionPanel state={state} update={noop} />)
    expect(panel).toContain('custom boundary')
    for (const coordinate of ['0', '800', '400']) {
      expect(panel).toContain(`value="${coordinate}"`)
    }

    const props = sectionProperties(state.geometry, state.bars)
    const markup = renderToStaticMarkup(
      <SectionPreview
        geometry={state.geometry}
        bars={state.bars}
        props={props}
        cover={state.cover}
        audit={auditCovers(state.bars, state.geometry, state.cover, state.tieDia)}
        na={null}
      />,
    )
    // the figure is drawn fitted to its own viewBox, so what shows the geometry
    // is the outline the fit produced and the properties beside it: an 800 × 400
    // section is drawn twice as wide as it is tall, and reports its own area,
    // centroid and second moments
    const polygon = /<polygon points="([^"]+)"/.exec(markup)?.[1] ?? ''
    const [ax, ay, bx, by] = polygon.split(' ').map((p) => p.split(',').map(Number)[0] ? p : p)
    expect(polygon).not.toBe('')
    const xs = polygon.split(' ').map((p) => Number(p.split(',')[0]))
    const ys = polygon.split(' ').map((p) => Number(p.split(',')[1]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * (Math.max(...ys) - Math.min(...ys)), 3)
    expect(markup).toContain('(400, 200)')
    expect(markup).toContain('320.0×10³ mm²')
    expect(markup).toContain('4,267×10⁶ mm⁴')
    expect([ax, ay, bx, by]).toHaveLength(4)
  })

  it('keeps the openings the file defines, and draws them', () => {
    const state = imported({
      boundary: [
        [0, 0],
        [800, 0],
        [800, 400],
        [0, 400],
      ],
      holes: [
        { x: 120, y: 80, diameter: 25 },
        { x: 680, y: 80, diameter: 25 },
        { x: 680, y: 320, diameter: 25 },
        { x: 120, y: 320, diameter: 25 },
      ],
      cutouts: [{ x: 300, y: 150, width: 200, height: 100 }],
    })
    expect(state.geometry.voids).toHaveLength(5)
    // a bolt hole is a ring about its own centre, at the radius the file gives
    const hole = state.geometry.voids[0]
    expect(hole).toHaveLength(64)
    const radii = hole.map((p) => Math.hypot(p.x - 120, p.y - 80))
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05)
    expect(Math.max(...radii)).toBeCloseTo(12.5, 1)
    // the rectangular cutout is a four-point ring at the position the file gives
    expect(state.geometry.voids[4]).toEqual([
      { x: 300, y: 150 },
      { x: 500, y: 150 },
      { x: 500, y: 250 },
      { x: 300, y: 250 },
    ])

    const props = sectionProperties(state.geometry, state.bars)
    expect(props.cx).toBeCloseTo(400, 6)
    expect(props.cy).toBeCloseTo(200, 6)
    // each bolt hole is the same 64-sided ring the app draws a circle with, so
    // the expected area is that of the polygon, not of the ideal circle
    const holeArea = 0.5 * 64 * 12.5 ** 2 * Math.sin((2 * Math.PI) / 64)
    const expected = 800 * 400 - 4 * holeArea - 200 * 100
    expect(props.area).toBeCloseTo(expected, 6)
    expect(Math.abs(expected - (800 * 400 - 4 * Math.PI * 12.5 ** 2 - 200 * 100))).toBeLessThan(4)

    const markup = renderToStaticMarkup(
      <SectionPreview
        geometry={state.geometry}
        bars={state.bars}
        props={props}
        cover={state.cover}
        audit={auditCovers(state.bars, state.geometry, state.cover, state.tieDia)}
        na={null}
      />,
    )
    // six rings in the drawn outline: the outer boundary and the five openings
    expect((markup.match(/fill-paper stroke-ink/g) ?? []).length).toBe(5)
  })

  it('keeps a cutout the file adds to a generated box section', () => {
    const state = imported({
      sectionType: 'box',
      B: 1200,
      D: 1200,
      tw: 250,
      tf: 250,
      nx: 5,
      ny: 3,
      ducts: [{ cx: 600, cy: 600, diameter: 300 }],
    })
    expect(state.predefined).toMatchObject({ kind: 'box', B: 1200 })
    // the box's own opening, and the duct the file adds
    expect(state.geometry.voids).toHaveLength(2)
    const duct = state.geometry.voids[1]
    expect(duct).toHaveLength(64)
    expect(centroidOf(duct).x).toBeCloseTo(600, 6)
    expect(centroidOf(duct).y).toBeCloseTo(600, 6)
  })

  it('reports openings it cannot read instead of dropping them quietly', () => {
    const { state, report } = importProjectText(
      JSON.stringify({ sectionType: 'rect', B: 400, D: 600, holes: [{ note: 'no geometry here' }, { x: 200, y: 300, diameter: 40 }] }),
      initialState(),
    )
    expect(state.geometry.voids).toHaveLength(1)
    const invalid = report.fields.filter((f) => f.status === 'invalid')
    expect(invalid.some((f) => f.detail.includes('could not be read as a hole or cutout'))).toBe(true)
  })
})

describe('imported section geometry — properties and the file’s own statements', () => {
  it('gives the calculated properties of the imported section', () => {
    const state = imported({
      boundary: [
        [0, 0],
        [800, 0],
        [800, 400],
        [0, 400],
      ],
    })
    const props = sectionProperties(state.geometry, state.bars)
    expect(props.area).toBeCloseTo(320000, 6)
    expect(props.cx).toBeCloseTo(400, 6)
    expect(props.cy).toBeCloseTo(200, 6)
    expect(props.Ixx).toBeCloseTo((800 * 400 ** 3) / 12, 3)
    expect(props.Iyy).toBeCloseTo((400 * 800 ** 3) / 12, 3)
    expect(props.Ixy).toBeCloseTo(0, 6)
  })

  it('takes a circular column written as its centre and diameter', () => {
    const state = imported({ sectionType: 'circle', cx: 0, cy: 0, diameter: 600, nBars: 12 })
    expect(state.predefined).toMatchObject({ kind: 'circle', D: 600 })
    expect(state.shapeClass).toBe('circ')

    // the same, written as coordinates: a seventy-point ring is recognised as
    // circular, and a twelve-sided polygon is not
    const ring = Array.from({ length: 72 }, (_, i) => {
      const t = (2 * Math.PI * i) / 72
      return [300 + 300 * Math.cos(t), 300 + 300 * Math.sin(t)]
    })
    const asPoints = imported({ points: ring })
    expect(asPoints.shapeClass).toBe('circ')
    expect(sectionProperties(asPoints.geometry, asPoints.bars).area).toBeCloseTo(Math.PI * 300 ** 2, -3)

    const polygon = Array.from({ length: 8 }, (_, i) => {
      const t = (2 * Math.PI * i) / 8
      return [300 + 300 * Math.cos(t), 300 + 300 * Math.sin(t)]
    })
    expect(imported({ points: polygon }).shapeClass).toBe('rect')
  })

  it('respects a shape class the file states outright', () => {
    const ring = Array.from({ length: 20 }, (_, i) => {
      const t = (2 * Math.PI * i) / 20
      return [10 * Math.cos(t) + i / 10, 10 * Math.sin(t)]
    })
    expect(imported({ points: ring, shapeClass: 'rect' }).shapeClass).toBe('rect')
    expect(imported({ points: [[0, 0], [400, 0], [400, 300], [0, 300]], circular: true }).shapeClass).toBe('circ')
  })

  it('says so when the file states a rotation it cannot apply', () => {
    const current = initialState()
    const { state, report } = importProjectText(
      JSON.stringify({ sectionType: 'rect', B: 400, D: 600, rotation: 30 }),
      current,
    )
    expect(state.predefined).toMatchObject({ kind: 'rect', B: 400, D: 600 })
    // the coordinates are taken exactly as the file wrote them
    expect(state.geometry.boundary).toEqual(generateSection(state.predefined!, {
      cover: state.cover,
      tieDia: state.tieDia,
      barDia: state.barDia,
    }).geometry.boundary)
    const invalid = report.fields.filter((f) => f.status === 'invalid')
    expect(invalid.some((f) => f.detail.includes('rotation') && f.detail.includes('not applied'))).toBe(true)
  })

  it('raises a bar count below what the generator places, and says so', () => {
    const circle = importProjectText(JSON.stringify({ sectionType: 'circle', D: 600, nBars: 3 }), initialState())
    expect(circle.state.predefined).toMatchObject({ kind: 'circle', nBars: 6 })
    expect(circle.state.bars).toHaveLength(6)
    expect(circle.report.fields.some((f) => f.detail.includes('raised to 6'))).toBe(true)

    const rect = importProjectText(JSON.stringify({ sectionType: 'rect', B: 400, D: 600, nx: 1 }), initialState())
    expect(rect.state.predefined).toMatchObject({ kind: 'rect', nx: 2 })
    expect(rect.report.fields.some((f) => f.detail.includes('raised to 2'))).toBe(true)
  })
})

describe('imported section geometry — the calculations follow it too', () => {
  it('runs the app’s own analysis on the imported section', () => {
    const state = imported({
      sectionType: 'rect',
      B: 400,
      D: 700,
      nx: 4,
      ny: 3,
      fck: 35,
      ULS: [{ name: 'C1', Pu: 2200, Mux: 260, Muy: 40 }],
    })
    // exactly the derivation the app runs on the current state
    const geometry = { boundary: ensureCCW(state.geometry.boundary), voids: state.geometry.voids.map(ensureCCW) }
    const props = sectionProperties(geometry, state.bars)
    expect(props.area).toBeCloseTo(400 * 700, 6)
    expect(props.cx).toBeCloseTo(200, 6)
    expect(props.cy).toBeCloseTo(350, 6)

    const spec = CODES[state.code]
    const grade = spec.steelGrades.find((g) => g.label === state.steelGrade)!
    const model = buildAnalysisModel(
      geometry,
      state.bars,
      { x: props.cx, y: props.cy },
      props.area,
      spec.concrete(state.fck),
      spec.steel(grade.fy),
      spec.epsSteelLimit(grade),
    )
    const surface = generateSurface(model, { nTheta: 16, nDepth: 44 })
    const results = state.cases.map((lc) =>
      checkLoadCase(surface, lc, spec, state.fck, grade.fy, props.area, props.Asc, state.shapeClass),
    )
    expect(results).toHaveLength(1)
    // the load case runs against the imported section and reports a utilisation
    expect(Number.isFinite(results[0].U)).toBe(true)
    expect(results[0].MRd).toBeGreaterThan(0)

    // the compliance checks read the imported section: the bar count is judged
    // against a rectangular section, which is what the file describes
    const checks = complianceChecks(spec, {
      props,
      bars: state.bars,
      geometry,
      fck: state.fck,
      fy: grade.fy,
      cases: state.cases,
      shapeClass: state.shapeClass,
      memberLength: state.memberLength,
      cover: state.cover,
      tieDia: state.tieDia,
    })
    const minBars = checks.find((c) => c.title.includes('Minimum number of bars'))
    expect(minBars?.title).toContain('rectangular')
  })

  it('judges a circular import as circular', () => {
    const state = imported({ sectionType: 'circle', D: 600, nBars: 10, fck: 35 })
    expect(state.shapeClass).toBe('circ')
    const spec = CODES[state.code]
    const props = sectionProperties(state.geometry, state.bars)
    const checks = complianceChecks(spec, {
      props,
      bars: state.bars,
      geometry: state.geometry,
      fck: state.fck,
      fy: 500,
      cases: state.cases,
      shapeClass: state.shapeClass,
      memberLength: state.memberLength,
      cover: state.cover,
      tieDia: state.tieDia,
    })
    expect(checks.find((c) => c.title.includes('Minimum number of bars'))?.title).toContain('circular')
  })
})

describe('imported section geometry — the panels follow the file', () => {
  const app = read('../../App.tsx')
  const editors = read('../Editors.tsx')
  const circular = read('../CircularRebarPanel.tsx')

  it('re-seeds the shape form when a file is imported', () => {
    expect(editors).toContain('importStamp?: number')
    expect(editors).toContain('if (importStamp === importStampRef.current) return')
    expect(editors).toContain("setShape(state.predefined ?? defaultPredefined('rect'))")
    expect(editors).toContain('setLoop(0)')
    // a void the imported geometry does not have cannot be selected any more
    expect(editors).toContain('?? []')
    expect(app).toContain('<SectionPanel\n            importStamp={importStamp}')
  })

  it('opens the advanced cover block when the file brings per-face covers', () => {
    const cover = read('../CoverPanel.tsx')
    expect(cover).toContain('importStamp?: number')
    expect(cover).toContain('if (!uniform) setShowAdvanced(true)')
    expect(app).toContain('<ClearCoverPanel\n            importStamp={importStamp}')

    // the values a per-face import brings are the ones the block shows
    const state = imported({ sectionType: 'rect', B: 400, D: 600, cover: { bottom: 35, right: 40, top: 45, left: 50 } })
    expect(state.cover.outer).toEqual({ bottom: 35, right: 40, top: 45, left: 50 })
    const markup = renderToStaticMarkup(
      <ClearCoverPanel
        importStamp={1}
        state={state}
        update={noop}
        audit={auditCovers(state.bars, state.geometry, state.cover, state.tieDia)}
      />,
    )
    // the block is open with the file's own per-face values in it
    expect(markup).toContain('Advanced cover — individual face values')
    for (const value of [35, 40, 45, 50]) expect(markup).toContain(`value="${value}"`)
    expect(markup).toContain('35–50 mm')
  })

  it('seeds the circular panel from the imported definition', () => {
    const state = imported({ sectionType: 'circle', D: 600, nBars: 14, cover: 40, barDia: 25 })
    expect(state.predefined).toMatchObject({ kind: 'circle', D: 600, nBars: 14 })
    expect(state.bars).toHaveLength(14)

    // the arrangement form follows that section: fourteen bars, the file's ⌀
    const before = defaultCircularRebarConfig('uniform', 300, 40, 8, 20)
    expect(before.nBars).not.toBe(14)
    const after = configForImportedSection(before, state.predefined, state.barDia)
    expect(after.nBars).toBe(14)
    expect(after.barDia).toBe(25)

    // an arrangement that is not a uniform ring keeps its own shape
    const bundles = { ...before, kind: 'bundle' as const, nBundles: 6, barsPerBundle: 2 }
    expect(configForImportedSection(bundles, state.predefined, 25)).toMatchObject({
      kind: 'bundle',
      nBundles: 6,
      barsPerBundle: 2,
      nBars: before.nBars,
      barDia: 25,
    })

    // the panel itself is drawn from the imported section: its pitch radius is
    // R − cover − ⌀tie − ⌀bar/2 from the file's own diameter
    const markup = renderToStaticMarkup(
      <CircularRebarPanel
        predefined={state.predefined}
        bars={state.bars}
        cover={40}
        tieDia={state.tieDia}
        barDia={25}
        setBarDia={noop}
        onApply={noop}
      />,
    )
    expect(markup).toContain('Circular reinforcement')
    expect(markup).toContain('Pitch radius')
    expect(markup).toContain('240 mm')
    // and the app wires the two together
    expect(circular).toContain('configForImportedSection(prev, predefined, barDia)')
  })
})

/** The centroid of a ring, for the assertions that only need its centre. */
function centroidOf(ring: { x: number; y: number }[]): { x: number; y: number } {
  return {
    x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
    y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
  }
}
