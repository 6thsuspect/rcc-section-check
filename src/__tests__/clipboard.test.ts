/**
 * The two coordinate tables that go on the clipboard, and the write itself.
 *
 * What matters for the engineering workflow: the cells are the app's own values
 * — the numbers the input fields and the coordinate tables show, signs and all,
 * with nothing rounded, re-scaled or re-derived on the way out — they are
 * tab-separated under a header row so Excel splits them into columns on paste,
 * and nothing is written at all when there is no section or no bar to write.
 */
import { describe, expect, it } from 'vitest'
import { barCoordinatesText, cell, copyToClipboard, sectionCoordinatesText } from '../clipboard'
import { generateSection } from '../engine/sections'
import { uniformCover } from '../engine/cover'
import { initialState, type AppState } from '../state'
import { importProjectText } from '../importFile'
import { CLIPBOARD_BLOCKED, copiedNote } from '../useCopyFeedback'

/** A file read into state, as the Import button does it. */
const importedState = (file: unknown, current: AppState = initialState()) =>
  importProjectText(JSON.stringify(file), current)

/** The lines of a table, as Excel sees them. */
const lines = (text: string) => text.split('\n')
const table = (text: string) => {
  const [title, header, ...rows] = lines(text)
  return { title, header, rows }
}
const cells = (line: string) => line.split('\t')

describe('section coordinates', () => {
  it('writes a titled, tab-separated table with a header row', () => {
    const { state } = importedState({
      boundary: [
        [0, 0],
        [450, 0],
        [450, 600],
        [0, 600],
      ],
    })
    const copy = sectionCoordinatesText(state.geometry)!
    const { title, header, rows } = table(copy.text)

    // the units and the origin are stated once, in the title line
    expect(title).toContain('Section coordinates')
    expect(title).toContain('mm')
    expect(title).toContain('origin')
    expect(title).toContain('RCC Section Check')
    expect(cells(header)).toEqual(['Part', 'Point', 'X (mm)', 'Y (mm)'])
    expect(rows).toHaveLength(4)
    expect(copy.count).toBe(4)
    expect(copy.skipped).toBe(0)

    // every data row has the same shape as the header, so the paste lands in columns
    for (const row of rows) expect(cells(row)).toHaveLength(4)
    expect(cells(rows[0])).toEqual(['Boundary', '1', '0', '0'])
    expect(cells(rows[2])).toEqual(['Boundary', '3', '450', '600'])
  })

  it('copies the values the app holds, signs and precision intact', () => {
    const points = [
      { x: -120.5, y: 0 },
      { x: 1 / 3, y: -0.0001 },
      { x: 450, y: 600.75 },
    ]
    const copy = sectionCoordinatesText({ boundary: points, voids: [] })!
    const rows = table(copy.text).rows.map(cells)
    expect(rows[0][2]).toBe('-120.5')
    // full precision: exactly the number the state carries, not a rounded copy
    expect(rows[1][2]).toBe(String(1 / 3))
    expect(rows[1][3]).toBe('-0.0001')
    for (const [i, p] of points.entries()) {
      expect(Number(rows[i][2])).toBe(p.x)
      expect(Number(rows[i][3])).toBe(p.y)
    }
    // a negative zero is a zero
    expect(cell(-0)).toBe('0')
    expect(cell(Number.NaN)).toBe('')
  })

  it('gives every opening of the section its own numbered block', () => {
    const { state } = importedState({
      boundary: {
        x: 0,
        y: 0,
        width: 800,
        height: 400,
      },
      holes: [
        { x: 120, y: 80, diameter: 25 },
        { x: 680, y: 80, diameter: 25 },
      ],
      cutouts: [{ x: 300, y: 150, width: 200, height: 100 }],
    })
    const copy = sectionCoordinatesText(state.geometry)!
    const rows = table(copy.text).rows.map(cells)

    expect(rows.filter((r) => r[0] === 'Boundary')).toHaveLength(4)
    // a round hole is the 64-point ring the app draws, each point numbered from 1
    const hole = rows.filter((r) => r[0] === 'Void 1')
    expect(hole).toHaveLength(64)
    expect(hole[0][1]).toBe('1')
    expect(hole[63][1]).toBe('64')
    for (const [, , x, y] of hole) {
      expect(Math.hypot(Number(x) - 120, Number(y) - 80)).toBeCloseTo(12.5, 6)
    }
    // and the cutout is its own block of four corners
    expect(rows.filter((r) => r[0] === 'Void 3')).toEqual([
      ['Void 3', '1', '300', '150'],
      ['Void 3', '2', '500', '150'],
      ['Void 3', '3', '500', '250'],
      ['Void 3', '4', '300', '250'],
    ])
    expect(copy.count).toBe(4 + 64 + 64 + 4)
  })

  it('copies the section the diagram shows, generated shapes included', () => {
    const generated = generateSection(
      { kind: 'tee', bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 },
      { cover: uniformCover(40), tieDia: 8, barDia: 25 },
    )
    const copy = sectionCoordinatesText(generated.geometry)!
    const rows = table(copy.text).rows.map(cells)
    expect(rows).toHaveLength(generated.geometry.boundary.length)
    rows.forEach((row, i) => {
      expect(Number(row[2])).toBe(generated.geometry.boundary[i].x)
      expect(Number(row[3])).toBe(generated.geometry.boundary[i].y)
    })
  })

  it('offers nothing when the boundary is not a section, and says what it skipped', () => {
    // fewer than three points: not a section, so nothing is copied
    expect(sectionCoordinatesText({ boundary: [{ x: 0, y: 0 }, { x: 1, y: 1 }], voids: [] })).toBe(null)
    expect(sectionCoordinatesText(null)).toBe(null)
    expect(sectionCoordinatesText(undefined)).toBe(null)

    // a point that is not a number is left out rather than written as NaN
    const copy = sectionCoordinatesText({
      boundary: [
        { x: 0, y: 0 },
        { x: 450, y: 0 },
        { x: 450, y: Number.NaN },
        { x: 450, y: 600 },
        { x: 0, y: 600 },
      ],
      voids: [],
    })!
    expect(copy.count).toBe(4)
    expect(copy.skipped).toBe(1)
    expect(copy.text).not.toContain('NaN')

    // an opening that is not a ring is dropped, and counted
    const withBadVoid = sectionCoordinatesText({
      boundary: [
        { x: 0, y: 0 },
        { x: 450, y: 0 },
        { x: 450, y: 600 },
      ],
      voids: [[{ x: 10, y: 10 }, { x: 20, y: 20 }]],
    })!
    expect(withBadVoid.count).toBe(3)
    expect(withBadVoid.skipped).toBe(2)
    expect(withBadVoid.text).not.toContain('Void 1')
  })
})

describe('reinforcement bar coordinates', () => {
  it('numbers every bar and carries its diameter', () => {
    const bars = [
      { x: 60.5, y: 60.5, dia: 25, positioning: 'automatic' as const, face: 'bottom' as const },
      { x: 389.5, y: 60.5, dia: 25, positioning: 'automatic' as const, face: 'bottom' as const },
      { x: 389.5, y: 539.5, dia: 20, positioning: 'manual' as const, face: 'top' as const },
    ]
    const copy = barCoordinatesText(bars)!
    const { title, header, rows } = table(copy.text)

    expect(title).toContain('Reinforcement bar coordinates')
    expect(title).toContain('origin')
    expect(cells(header)).toEqual(['Bar', 'X (mm)', 'Y (mm)', 'Dia (mm)', 'Face', 'Surface', 'Placement'])
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(cells(row)).toHaveLength(7)
    expect(cells(rows[0])).toEqual(['1', '60.5', '60.5', '25', 'bottom', '', 'automatic'])
    expect(cells(rows[2])).toEqual(['3', '389.5', '539.5', '20', 'top', '', 'manual'])
  })

  it('copies a rectangular section’s own table, bar for bar', () => {
    const state = initialState()
    const copy = barCoordinatesText(state.bars)!
    const rows = table(copy.text).rows.map(cells)
    expect(rows).toHaveLength(state.bars.length)
    state.bars.forEach((bar, i) => {
      expect(Number(rows[i][0])).toBe(i + 1)
      expect(Number(rows[i][1])).toBe(bar.x)
      expect(Number(rows[i][2])).toBe(bar.y)
      expect(Number(rows[i][3])).toBe(bar.dia)
      expect(rows[i][4]).toBe(bar.face ?? '')
    })
  })

  it('copies a circular arrangement from the section it was generated for', () => {
    const circle = importedState({ sectionType: 'circle', D: 600, nBars: 12, cover: 40, barDia: 25 }).state
    const copy = barCoordinatesText(circle.bars)!
    const rows = table(copy.text).rows.map(cells)
    expect(rows).toHaveLength(12)
    rows.forEach((row, i) => {
      const bar = circle.bars[i]
      expect(Number(row[1])).toBe(bar.x)
      expect(Number(row[2])).toBe(bar.y)
      // every bar sits on the ring the section defines, and keeps its ⌀
      expect(Math.hypot(bar.x, bar.y)).toBeCloseTo(600 / 2 - 40 - 8 - 25 / 2, 6)
      expect(row[3]).toBe('25')
      expect(row[6]).toBe('automatic')
    })

    // a hollow section with an inner ring keeps that ring's own surface, so the
    // two rings of a pipe section are told apart on paste
    const hollow = generateSection(
      { kind: 'hollowCircle', Do: 900, Di: 700, nBars: 12, innerRing: true },
      { cover: uniformCover(40), tieDia: 8, barDia: 25 },
    )
    const inner = hollow.bars.filter((b) => b.surface === 'inner')
    expect(inner.length).toBeGreaterThan(0)
    const hollowCopy = barCoordinatesText(hollow.bars)!
    expect(hollowCopy.text).toContain('\tinner\t')
    expect(hollowCopy.text).toContain('\touter\t')
    expect(hollowCopy.count).toBe(hollow.bars.length)
  })

  it('offers nothing when there is no bar, and skips a bar that is not a number', () => {
    expect(barCoordinatesText([])).toBe(null)
    expect(barCoordinatesText(null)).toBe(null)

    const copy = barCoordinatesText([
      { x: 10, y: 10, dia: 20 },
      { x: Number.NaN, y: 10, dia: 20 },
    ])!
    expect(copy.count).toBe(1)
    expect(copy.skipped).toBe(1)
    expect(copy.text).not.toContain('NaN')
    // a row that is all that is left cannot be copied either
    expect(barCoordinatesText([{ x: Number.NaN, y: 0, dia: 20 }])).toBe(null)
  })
})

describe('the clipboard write and its feedback', () => {
  it('reports failure instead of throwing when no clipboard is reachable', async () => {
    // vitest runs in Node with no DOM: neither route can work, and that is not
    // an exception — it is a `false` the button reports to the user
    await expect(copyToClipboard('1\t2')).resolves.toBe(false)
    await expect(copyToClipboard('')).resolves.toBe(false)
  })

  it('words the success and the failure the panels show', () => {
    expect(copiedNote({ text: '', count: 1, skipped: 0 }, 'bar coordinate')).toBe(
      'Copied 1 bar coordinate to the clipboard.',
    )
    expect(copiedNote({ text: '', count: 12, skipped: 0 }, 'bar coordinate')).toBe(
      'Copied 12 bar coordinates to the clipboard.',
    )
    expect(copiedNote({ text: '', count: 70, skipped: 2 }, 'section point')).toBe(
      'Copied 70 section points to the clipboard. 2 unusable entries left out.',
    )
    expect(copiedNote({ text: '', count: 3, skipped: 1 }, 'section point')).toBe(
      'Copied 3 section points to the clipboard. 1 unusable entry left out.',
    )
    expect(CLIPBOARD_BLOCKED).toContain('Ctrl+C')
  })
})
