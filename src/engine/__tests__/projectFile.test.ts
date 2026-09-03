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
    expect(parsed.cover).toBe(40) // fallback default
  })

  it('throws error for invalid JSON or missing geometry', () => {
    expect(() => parseProjectFile('invalid json')).toThrow()
    expect(() => parseProjectFile(JSON.stringify({ code: 'IS456' }))).toThrow('Invalid project file: missing or invalid geometry boundary.')
  })
})
