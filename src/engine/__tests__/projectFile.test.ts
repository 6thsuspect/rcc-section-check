import { describe, expect, it } from 'vitest'
import { parseProjectFile } from '../../projectFile'
import { initialState } from '../../state'

describe('parseProjectFile', () => {
  it('parses valid ProjectFile JSON object with wrapper', () => {
    const st = initialState()
    const jsonWrapper = JSON.stringify({
      version: '1.0',
      app: 'RCC Section Check',
      exportedAt: new Date().toISOString(),
      state: st,
    })

    const parsed = parseProjectFile(jsonWrapper)
    expect(parsed.code).toBe(st.code)
    expect(parsed.fck).toBe(st.fck)
    expect(parsed.bars.length).toBe(st.bars.length)
    expect(parsed.cases.length).toBe(st.cases.length)
  })

  it('parses raw AppState JSON directly', () => {
    const st = initialState()
    const rawJson = JSON.stringify(st)

    const parsed = parseProjectFile(rawJson)
    expect(parsed.code).toBe(st.code)
    expect(parsed.fck).toBe(st.fck)
    expect(parsed.geometry.boundary.length).toBe(st.geometry.boundary.length)
  })

  it('sanitizes missing or invalid fields safely', () => {
    const partialJson = JSON.stringify({
      code: 'IRC112',
      fck: 40,
      steelGrade: 'Fe550',
      geometry: {
        boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }],
        voids: [],
      },
      bars: [{ x: 50, y: 50, dia: 20 }],
      cases: [{ id: 'c1', name: 'Test Case', Pu: 1500, Mux: 100, Muy: 50 }],
    })

    const parsed = parseProjectFile(partialJson)
    expect(parsed.code).toBe('IRC112')
    expect(parsed.fck).toBe(40)
    expect(parsed.steelGrade).toBe('Fe550')
    expect(parsed.geometry.boundary.length).toBe(3)
    expect(parsed.bars.length).toBe(1)
    expect(parsed.cases.length).toBe(1)
    // v1.0 files have no cover spec at all → uniform default on every face
    expect(parsed.cover).toEqual(initialState().cover)
    expect(parsed.cover.outer.bottom).toBe(40)
  })

  it('migrates a v1.0 single-value cover onto every face', () => {
    const legacy = JSON.stringify({
      version: '1.0',
      state: {
        geometry: { boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }], voids: [] },
        bars: [{ x: 40, y: 40, dia: 20 }],
        cases: [],
        cover: 50,
      },
    })
    const parsed = parseProjectFile(legacy)
    expect(parsed.cover.outer).toEqual({ bottom: 50, right: 50, top: 50, left: 50 })
    expect(parsed.cover.inner.bottom).toBeNull()
  })

  it('migrates an unchanged legacy predefined layout to automatic placement', () => {
    const st = initialState()
    const legacy = {
      ...st,
      bars: st.bars.map(({ x, y, dia }) => ({ x, y, dia })),
    }
    const parsed = parseProjectFile(JSON.stringify({ version: '1.1', state: legacy }))
    expect(parsed.bars.every((bar) => bar.positioning === 'automatic')).toBe(true)
    expect(parsed.bars[0].face).toBeDefined()
  })

  it('round-trips independently entered face covers', () => {
    const st = initialState()
    st.cover = {
      outer: { bottom: 45, right: 40, top: 60, left: 75 },
      inner: { bottom: null, right: 30, top: null, left: null },
    }
    const json = JSON.stringify({ version: '1.1', app: 'RCC Section Check', exportedAt: '', state: st })
    const parsed = parseProjectFile(json)
    expect(parsed.cover).toEqual(st.cover)
  })

  it('round-trips separate service (SLS) load cases independently of the ULS cases', () => {
    const st = initialState()
    st.slsCases = [{ id: 's1', name: 'SLC1', Pu: 900, Mux: 80, Muy: 20 }]
    const json = JSON.stringify({ version: '1.2', app: 'RCC Section Check', exportedAt: '', state: st })
    const parsed = parseProjectFile(json)
    expect(parsed.slsCases).toEqual([{ id: 's1', name: 'SLC1', Pu: 900, Mux: 80, Muy: 20 }])
    // editing the SLS set must leave the factored ULS set untouched
    expect(parsed.cases).toEqual(st.cases)
    expect(parsed.slsCases[0].id).not.toBe(parsed.cases[0].id)
  })

  it('seeds slsCases from the ULS cases (fresh ids) when a legacy file has none', () => {
    const legacy = JSON.stringify({
      version: '1.1',
      state: {
        geometry: { boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }], voids: [] },
        bars: [{ x: 40, y: 40, dia: 20 }],
        cases: [{ id: 'c1', name: 'LC1', Pu: 1500, Mux: 100, Muy: 50 }],
      },
    })
    const parsed = parseProjectFile(legacy)
    expect(parsed.cases.length).toBe(1)
    expect(parsed.slsCases.length).toBe(1)
    // same actions, but a distinct id so the two lists edit independently
    expect(parsed.slsCases[0].Pu).toBe(1500)
    expect(parsed.slsCases[0].Mux).toBe(100)
    expect(parsed.slsCases[0].Muy).toBe(50)
    expect(parsed.slsCases[0].id).not.toBe(parsed.cases[0].id)
  })

  it('round-trips the crack-width settings (exposure + duration)', () => {
    const st = initialState()
    st.code = 'IRC112'
    st.crackWidth = { exposure: 'XD2', longTerm: true }
    const json = JSON.stringify({ version: '1.2', app: 'RCC Section Check', exportedAt: '', state: st })
    const parsed = parseProjectFile(json)
    expect(parsed.crackWidth).toEqual({ exposure: 'XD2', longTerm: true })
  })

  it('resets an exposure that is invalid for the code and defaults missing crack-width settings', () => {
    // IS 456 file that carries an IRC-only exposure class → falls back to default.
    const bad = JSON.stringify({
      version: '1.2',
      state: {
        geometry: { boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }], voids: [] },
        bars: [{ x: 40, y: 40, dia: 20 }],
        cases: [],
        code: 'IS456',
        crackWidth: { exposure: 'XD2', longTerm: true },
      },
    })
    const parsed = parseProjectFile(bad)
    expect(parsed.crackWidth.exposure).toBe('moderate') // valid IS 456 default
    expect(parsed.crackWidth.longTerm).toBe(true)

    // Legacy file with no crack-width block at all → code default, short-term.
    const legacy = JSON.stringify({
      version: '1.1',
      state: {
        geometry: { boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }], voids: [] },
        bars: [{ x: 40, y: 40, dia: 20 }],
        cases: [],
      },
    })
    const parsedLegacy = parseProjectFile(legacy)
    expect(parsedLegacy.crackWidth).toEqual({ exposure: 'moderate', longTerm: false })
  })

  it('round-trips the crack-width load cases independently of the ULS and SLS-stress lists', () => {
    const st = initialState()
    st.crackCases = [{ id: 'cwc1', name: 'CWC1', Pu: 450, Mux: 120, Muy: 18 }]
    const json = JSON.stringify({ version: '1.3', app: 'RCC Section Check', exportedAt: '', state: st })
    const parsed = parseProjectFile(json)
    expect(parsed.crackCases).toEqual([{ id: 'cwc1', name: 'CWC1', Pu: 450, Mux: 120, Muy: 18 }])
    // editing the crack-width list leaves the ULS and SLS-stress lists untouched
    expect(parsed.cases).toEqual(st.cases)
    expect(parsed.slsCases).toEqual(st.slsCases)
    expect(parsed.crackCases[0].id).not.toBe(parsed.slsCases[0].id)
  })

  it('seeds crackCases from the SLS cases (fresh ids) when a legacy file has none', () => {
    const legacy = JSON.stringify({
      version: '1.2',
      state: {
        geometry: { boundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }, { x: 0, y: 500 }], voids: [] },
        bars: [{ x: 40, y: 40, dia: 20 }],
        cases: [{ id: 'c1', name: 'LC1', Pu: 1500, Mux: 100, Muy: 50 }],
        slsCases: [{ id: 's1', name: 'SLC1', Pu: 900, Mux: 70, Muy: 20 }],
      },
    })
    const parsed = parseProjectFile(legacy)
    expect(parsed.slsCases.length).toBe(1)
    expect(parsed.crackCases.length).toBe(1)
    // inherits the SLS service actions, but with a distinct id
    expect(parsed.crackCases[0].Pu).toBe(900)
    expect(parsed.crackCases[0].id).not.toBe(parsed.slsCases[0].id)
  })

  it('throws error for invalid JSON or missing geometry', () => {
    expect(() => parseProjectFile('invalid json')).toThrow()
    expect(() => parseProjectFile(JSON.stringify({ code: 'IS456' }))).toThrow('Invalid project file: missing or invalid geometry boundary.')
  })
})
