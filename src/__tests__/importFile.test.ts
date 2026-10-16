/**
 * The import reader: a project this app wrote must come back complete, a file
 * from elsewhere must populate every input it describes, and anything that
 * could not be read must be reported rather than quietly replaced by a default.
 */
import { describe, expect, it } from 'vitest'
import { importProjectText, importSummary } from '../importFile'
import { initialState, type AppState } from '../state'
import { isAutomaticBar, repositionAutomaticBars } from '../engine/reinforcement'
import { generateSection } from '../engine/sections'
import { sectionProperties } from '../engine/geometry'

const read = (file: unknown, current: AppState = initialState()) =>
  importProjectText(typeof file === 'string' ? file : JSON.stringify(file), current)

/** A state with values that are easy to mistake for missing: 0, and decimals. */
function editedState(): AppState {
  const s = initialState()
  return {
    ...s,
    code: 'IRC112',
    fck: 32.5,
    steelGrade: 'Fe500',
    memberLength: 0,
    cover: { outer: { bottom: 35, right: 40, top: 45, left: 50 }, inner: { bottom: 25, right: null, top: null, left: null } },
    shear: { ...s.shear, linkSpacing: 149.75, bOverride: 0, aslOverride: null, criticalDistance: 0, cotTheta: 2.25 },
    crackWidth: { exposure: 'severe', longTerm: true },
    mesh: { nTheta: 48, nDepth: 120 },
    cases: [{ id: 'uls-1', name: 'LC-A', Pu: 0, Mux: 120.25, Muy: 0 }],
  }
}

describe('importProjectText — a project this app wrote', () => {
  it('reads the wrapper object and reports it as a project file', () => {
    const s = editedState()
    const { state, report } = read({ version: '1.5', app: 'RCC Section Check', exportedAt: 'now', state: s })
    expect(report.format).toBe('project')
    expect(state.code).toBe('IRC112')
    expect(state.fck).toBe(32.5)
    expect(state.shear.linkSpacing).toBe(149.75)
    expect(state.shear.cotTheta).toBe(2.25)
  })

  it('keeps valid zeros and decimals rather than falling back to a default', () => {
    const s = editedState()
    const { state } = read(JSON.stringify(s))
    expect(state.memberLength).toBe(0)
    expect(state.shear.criticalDistance).toBe(0)
    expect(state.cases[0].Pu).toBe(0)
    expect(state.cases[0].Muy).toBe(0)
    expect(state.cases[0].Mux).toBe(120.25)
    expect(state.cover.inner.bottom).toBe(25)
  })

  it('reports every input group in the file as imported', () => {
    const { report } = read(JSON.stringify({ version: '1.5', state: editedState() }))
    const { imported, missing } = importSummary(report)
    const groups = imported.map((f) => f.group)
    expect(groups).toContain('Design code')
    expect(groups).toContain('Concrete and steel')
    expect(groups).toContain('Clear cover')
    expect(groups).toContain('Reinforcement')
    expect(groups).toContain('ULS load cases')
    expect(groups).toContain('Shear design inputs')
    expect(missing).toHaveLength(0)
  })

  it('names the groups an older file does not carry instead of claiming success', () => {
    const s = initialState()
    const legacy = JSON.stringify({
      version: '1.0',
      state: { code: s.code, fck: s.fck, steelGrade: s.steelGrade, geometry: s.geometry, bars: s.bars, cases: s.cases },
    })
    const { report } = read(legacy)
    const { missing } = importSummary(report)
    const groups = missing.map((f) => f.group)
    expect(groups).toContain('Clear cover')
    expect(groups).toContain('Mesh density')
    expect(groups).toContain('Shear load cases')
    expect(missing[0].detail).toContain('not in the file')
  })
})

describe('importProjectText — a section file from elsewhere', () => {
  it('generates the geometry and the bars of a parametric rectangle', () => {
    const { state, report } = read({
      sectionType: 'rect',
      width: 300,
      depth: 500,
      fck: 35,
      steelGrade: 'Fe500',
      cover: 35,
      nx: 3,
      ny: 2,
      barDia: 20,
      linkDia: 8,
      memberLength: 4000,
      ULS: [{ name: 'C1', Pu: 1500, Mux: 220, Muy: 40 }],
    })
    expect(report.format).toBe('external')
    expect(state.predefined).toMatchObject({ kind: 'rect', B: 300, D: 500, nx: 3, ny: 2 })
    expect(state.geometry.boundary).toHaveLength(4)
    expect(state.geometry.boundary[2]).toEqual({ x: 300, y: 500 })
    // the geometry and the bars come from the app's own generator, fed with the
    // values the file gave
    const reference = generateSection(
      { kind: 'rect', B: 300, D: 500, nx: 3, ny: 2 },
      { cover: state.cover, tieDia: state.tieDia, barDia: state.barDia },
    )
    expect(state.geometry).toEqual(reference.geometry)
    expect(state.bars).toEqual(reference.bars)
    expect(state.fck).toBe(35)
    expect(state.cover.outer).toEqual({ bottom: 35, right: 35, top: 35, left: 35 })
    expect(state.barDia).toBe(20)
    expect(state.tieDia).toBe(8)
    expect(state.memberLength).toBe(4000)
    expect(state.cases[0]).toMatchObject({ name: 'C1', Pu: 1500, Mux: 220, Muy: 40 })
  })

  it('generates a circular arrangement with the file bar count', () => {
    const { state } = read({ sectionType: 'circle', diameter: 600, nBars: 12, cover: 40, barDia: 25, tieDia: 10 })
    expect(state.predefined).toMatchObject({ kind: 'circle', D: 600, nBars: 12 })
    expect(state.bars).toHaveLength(12)
    expect(state.bars.every((b) => isAutomaticBar(b) && b.radial === true)).toBe(true)
    expect(state.tieDia).toBe(10)
    // A circle is drawn about the origin by the generator; every bar sits on the
    // ring the file's own cover, link and bar diameters describe.
    for (const bar of state.bars) {
      expect(Math.hypot(bar.x, bar.y)).toBeCloseTo(300 - 40 - 10 - 12.5, 6)
    }
  })

  it('reads a hollow circle and refuses an inner diameter that is not smaller', () => {
    const ok = read({ section: { type: 'circular-tube', outerDiameter: 900, innerDiameter: 600, nBars: 14 } })
    expect(ok.state.predefined).toMatchObject({ kind: 'hollowCircle', Do: 900, Di: 600, nBars: 14 })
    expect(ok.state.bars).toHaveLength(14)

    const bad = read({ sectionType: 'hollowCircle', Do: 500, Di: 900 })
    const { invalid } = importSummary(bad.report)
    expect(invalid.some((f) => f.group === 'Section geometry' && f.detail.includes('inner diameter'))).toBe(true)
    expect(bad.state.predefined).toMatchObject({ kind: 'hollowCircle', Do: 500 })
    // the unusable wall is not applied: the opening stays what the app had
    expect((bad.state.predefined as { Di: number }).Di).not.toBe(900)
  })

  it('brings a declared unit system and per-key suffixes to mm and kN', () => {
    const { state } = read({
      units: { length: 'cm', force: 'N', moment: 'kNm' },
      sectionType: 'rect',
      width: 30,
      depth_mm: 450,
      ULS: [{ name: 'C1', Pu_N: 500_000, Mx_Nm: 1_200_000 }],
    })
    expect(state.predefined).toMatchObject({ B: 300, D: 450 })
    expect(state.cases[0].Pu).toBe(500)
    expect(state.cases[0].Mux).toBe(1200)
  })

  it('maps the alternative field names a section file may use', () => {
    const { state, report } = read({
      designCode: 'IRC 112',
      section: { shape: 'tee', bf: 1000, tf: 150, bw: 300, D: 900, nBarsFlange: 8, nBarsWeb: 4 },
      materials: { concrete: { fck: 40 }, steel: { fy: 500 } },
      clearCover: 50,
      loads: { factored: [{ label: 'ULS-1', axialForce: 2000, momentX: 400, momentY: 60 }], service: [{ label: 'SLS-1', axial: 1200, Mx: 250 }] },
      shear: { axis: 'y', linkDia: 10, legs: 4, spacing: 150, cotθ: 2 },
      crackWidth: { exposure: 'XC1', longTerm: 'yes' },
    })
    expect(state.code).toBe('IRC112')
    expect(state.steelGrade).toBe('Fe500')
    expect(state.predefined).toMatchObject({ kind: 'tee', bf: 1000, tf: 150, bw: 300, D: 900, nFlange: 8, nWeb: 4 })
    expect(state.fck).toBe(40)
    expect(state.cover.outer.bottom).toBe(50)
    expect(state.cases[0]).toMatchObject({ name: 'ULS-1', Pu: 2000, Mux: 400, Muy: 60 })
    expect(state.slsCases[0]).toMatchObject({ name: 'SLS-1', Pu: 1200, Mux: 250 })
    expect(state.shear).toMatchObject({ axis: 'y', linkDia: 10, linkLegs: 4, linkSpacing: 150, cotTheta: 2 })
    expect(state.crackWidth).toEqual({ exposure: 'XC1', longTerm: true })
    expect(report.counts.invalid).toBe(0)
  })

  it('takes a boundary as the section, and moves the app bars onto it', () => {
    const current = initialState()
    const { state, report } = read(
      {
        boundary: [
          { x: 0, y: 0 },
          { x: 800, y: 0 },
          { x: 800, y: 400 },
          { x: 0, y: 400 },
        ],
        voids: [],
      },
      current,
    )
    expect(state.predefined).toBe(null)
    expect(state.geometry.boundary[2]).toEqual({ x: 800, y: 400 })
    expect(state.bars).toHaveLength(current.bars.length)
    expect(state.bars.every(isAutomaticBar)).toBe(true)
    // the bars follow the new boundary by the app's own rule for a boundary
    // change — the same call the section editor makes
    expect(state.bars).toEqual(
      repositionAutomaticBars(state.bars, current.geometry, state.geometry, current.cover, state.cover, current.tieDia, state.tieDia),
    )
    expect(state.bars.some((b, i) => b.x !== current.bars[i].x || b.y !== current.bars[i].y)).toBe(true)
    expect(importSummary(report).imported.some((f) => f.group === 'Reinforcement')).toBe(true)
    // the load cases were not in the file, so they are exactly what they were
    expect(state.cases).toEqual(current.cases)
  })

  it('keeps a complete bar table, with the shared diameter taken from it', () => {
    const { state, report } = read({
      sectionType: 'rect',
      B: 400,
      D: 600,
      bars: [
        { x: 60, y: 60, dia: 25 },
        { x: 340, y: 60, dia: 25, positioning: 'manual' },
        { x: 340, y: 540, dia: 25 },
        { x: 60, y: 540, dia: 25 },
      ],
    })
    expect(state.bars).toHaveLength(4)
    expect(state.bars[1].positioning).toBe('manual')
    expect(state.barDia).toBe(25)
    expect(importSummary(report).imported.some((f) => f.group === 'Reinforcement')).toBe(true)
  })

  it('reports bar rows it cannot use instead of dropping them silently', () => {
    const { state, report } = read({
      sectionType: 'rect',
      B: 400,
      D: 600,
      bars: [{ x: 60, y: 60, dia: 20 }, { y: 120 }, { x: 300, y: 120 }],
    })
    expect(state.bars).toHaveLength(2)
    const detail = importSummary(report).imported.find((f) => f.group === 'Reinforcement')?.detail ?? ''
    expect(detail).toContain('1 row(s) without usable coordinates skipped')
    expect(detail).toContain('read as ⌀')
  })
})

describe('importProjectText — fields the file does not populate', () => {
  it('leaves every field the file does not carry at the value already on screen', () => {
    const current = editedState()
    const { state, report } = read({ sectionType: 'rect', width: 250 }, current)
    expect(state.predefined).toMatchObject({ kind: 'rect', B: 250, D: current.predefined && 'D' in current.predefined ? current.predefined.D : 600 })
    expect(state.fck).toBe(current.fck)
    expect(state.cases).toEqual(current.cases)
    expect(state.slsCases).toEqual(current.slsCases)
    expect(state.crackCases).toEqual(current.crackCases)
    expect(state.shearCases).toEqual(current.shearCases)
    expect(state.shear).toEqual(current.shear)
    expect(state.memberLength).toBe(current.memberLength)
    expect(state.mesh).toEqual(current.mesh)
    expect(state.cover).toEqual(current.cover)
    expect(state.crackWidth).toEqual(current.crackWidth)

    const { missing } = importSummary(report)
    const groups = missing.map((f) => f.group)
    expect(groups).toEqual(
      expect.arrayContaining(['Design code', 'Concrete and steel', 'Clear cover', 'Bar and link ⌀', 'Member length', 'ULS load cases', 'SLS load cases', 'Crack-width load cases', 'Shear load cases', 'Shear design inputs', 'Mesh density']),
    )
    expect(missing.every((f) => f.detail.includes('kept') || f.detail.includes('apply'))).toBe(true)
  })

  it('applies a second file on top of the first without resetting anything', () => {
    const first = read({ sectionType: 'rect', width: 300, depth: 700, fck: 45, barDia: 32 }).state
    const second = read({ sectionType: 'rect', depth: 800 }, first).state
    expect(second.predefined).toMatchObject({ B: 300, D: 800 })
    expect(second.fck).toBe(45)
    expect(second.barDia).toBe(32)
  })

  it('reports an unreadable value, keeps the value on screen, and still imports the rest', () => {
    const current = initialState()
    const { state, report } = read(
      {
        sectionType: 'rect',
        width: -50,
        depth: 'not a number',
        fck: 0,
        cover: -10,
        barDia: 0,
        steelGrade: 'Fe999',
        shear: { linkSpacing: -20, linkLegs: 1, cotTheta: 5 },
        crackWidth: { exposure: 'Hostile to concrete' },
        mesh: { nTheta: 2 },
        ULS: [{ name: 'C1', Pu: 'oops', Mux: 100 }],
      },
      current,
    )
    expect(state.predefined).toEqual(current.predefined)
    expect(state.geometry).toEqual(current.geometry)
    expect(state.fck).toBe(current.fck)
    expect(state.cover).toEqual(current.cover)
    expect(state.barDia).toBe(current.barDia)
    expect(state.steelGrade).toBe(current.steelGrade)
    expect(state.shear).toEqual(current.shear)
    expect(state.crackWidth).toEqual(current.crackWidth)
    expect(state.mesh).toEqual(current.mesh)
    // the row is still imported — as a zero axial load, which is what a missing
    // Pu means in this app — and the case name and moment come through
    expect(state.cases[0]).toMatchObject({ name: 'C1', Pu: 0, Mux: 100 })

    const { invalid } = importSummary(report)
    const groups = invalid.map((f) => f.group)
    expect(groups).toContain('Section geometry')
    expect(groups).toContain('Concrete and steel')
    expect(groups).toContain('Clear cover')
    expect(groups).toContain('Bar and link ⌀')
    expect(groups).toContain('Shear design inputs')
    expect(groups).toContain('Crack-width inputs')
    expect(groups).toContain('Mesh density')
    expect(invalid.some((f) => f.detail.includes('not positive'))).toBe(true)
    expect(invalid.some((f) => f.detail.includes('outside'))).toBe(true)
  })

  it('rejects text that is not JSON, and JSON that is not a table of fields', () => {
    const current = initialState()
    expect(() => importProjectText('this is a PDF, not a project', current)).toThrow(/not JSON/)
    expect(() => importProjectText('[1, 2, 3]', current)).toThrow(/not an object/)
  })

  it('flags a file that carries a boundary but no usable section description', () => {
    const current = initialState()
    const { state, report } = read({ note: 'hello', project: { title: 'nothing useful' } }, current)
    expect(state).toEqual(current)
    expect(importSummary(report).imported).toHaveLength(0)
    expect(report.counts.missing).toBeGreaterThan(0)
  })
})

describe('importProjectText — the ways a file may write its geometry', () => {
  it('reads the outer ring from every spelling it is likely to arrive in', () => {
    const expected = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 300 },
      { x: 0, y: 300 },
    ]
    const spellings: Record<string, unknown>[] = [
      { boundary: expected },
      { points: [[0, 0], [600, 0], [600, 300], [0, 300]] },
      { outline: [{ X: 0, Y: 0 }, { X: 600, Y: 0 }, { X: 600, Y: 300 }, { X: 0, Y: 300 }] },
      { vertices: [0, 0, 600, 0, 600, 300, 0, 300] },
      { section: { points: [[0, 0], [600, 0], [600, 300], [0, 300]] } },
      { geometry: { boundary: expected } },
      { section: { boundary: { points: expected } } },
    ]
    for (const file of spellings) {
      const { state } = read(file)
      expect(state.geometry.boundary, JSON.stringify(file).slice(0, 40)).toEqual(expected)
      expect(state.predefined).toBe(null)
      expect(sectionProperties(state.geometry, state.bars).area).toBeCloseTo(180000, 6)
    }
  })

  it('reads a boundary written as a rectangle, and openings written as rectangles', () => {
    const { state } = read({
      boundary: { x: 0, y: 0, width: 600, height: 300 },
      voids: [{ x: 100, y: 100, width: 200, height: 100 }],
    })
    expect(state.geometry.boundary).toHaveLength(4)
    expect(state.geometry.voids).toEqual([
      [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 100, y: 200 },
      ],
    ])
  })

  it('counts the same opening only once, however many names it is filed under', () => {
    const hole = { x: 200, y: 150, diameter: 60 }
    const { state } = read({
      boundary: { x: 0, y: 0, width: 600, height: 300 },
      holes: [hole],
      cutouts: [hole],
      geometry: { holes: [hole] },
    })
    expect(state.geometry.voids).toHaveLength(1)
  })

  it('converts the openings with the same unit block as the geometry', () => {
    const { state } = read({
      units: { length: 'cm' },
      boundary: { x: 0, y: 0, width: 60, height: 30 },
      holes: [{ x: 20, y: 15, diameter: 6 }],
    })
    expect(state.geometry.boundary[2]).toEqual({ x: 600, y: 300 })
    const ring = state.geometry.voids[0]
    const mean = ring.map((p) => Math.hypot(p.x - 200, p.y - 150)).reduce((a, b) => a + b, 0) / ring.length
    expect(mean).toBeCloseTo(30, 1)
  })

  it('reports a section it cannot read rather than keeping the old one silently', () => {
    const current = initialState()
    const { state, report } = read({ sectionType: 'rect', width: 'wide', depth: null }, current)
    expect(state.geometry).toEqual(current.geometry)
    expect(state.predefined).toEqual(current.predefined)
    const invalid = importSummary(report).invalid
    expect(invalid.some((f) => f.group === 'Section geometry')).toBe(true)
  })
})

describe('importProjectText — the app is wired to the reader', () => {
  it('sends every picked file through it and reports the result in the banner', async () => {
    const { readFile } = await import('node:fs/promises')
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain("import { importProjectText, importSummary, type ImportReport } from './importFile'")
    expect(app).toContain('importProjectText(text, state)')
    expect(app).toContain('setImportReport(report)')
    expect(app).toContain('Not populated (')
    expect(app).toContain('importStamp={importStamp}')
    // the file dialog can also be pointed at a text file, which is then refused
    // with a message rather than failing silently
    expect(app).toContain('accept=".json,.rcc,.txt"')
  })

  it('holds an imported bar table until the arrangement is edited', async () => {
    const { readFile } = await import('node:fs/promises')
    const panel = await readFile(new URL('../components/CircularRebarPanel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('importStamp?: number')
    expect(panel).toContain('if (importedBarsRef.current === bars) return')
    expect(panel).toContain('importedBarsRef.current = null')
  })
})
