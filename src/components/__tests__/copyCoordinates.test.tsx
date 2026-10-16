/**
 * The two copy buttons as they appear in the app: where each one sits, what it
 * reports, and that what it copies is the section and the reinforcement the
 * screen is showing.
 *
 * The panels are rendered to static markup (there is no DOM in this repo) and
 * the pieces that only exist after a click — the clipboard call and the note it
 * leaves behind — are covered from the module that owns them
 * (`src/__tests__/clipboard.test.ts`) and, where they are wiring rather than
 * behaviour, from the source, as the other component tests here do.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../../App'
import { RebarPanel, SectionPanel } from '../Editors'
import { initialState } from '../../state'
import { importProjectText } from '../../importFile'
import { barCoordinatesText, sectionCoordinatesText } from '../../clipboard'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const noop = () => {}

/** The button whose label starts with `label`, with its attributes. */
function buttonWith(markup: string, label: string): { attrs: string; html: string } | null {
  for (const m of markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<[^>]*>/g, '').trim()
    if (text.startsWith(label)) return { attrs: m[1], html: m[0] }
  }
  return null
}

describe('copy buttons in the section panel', () => {
  it('offers a Copy coordinates button in the coordinate header row', () => {
    const state = initialState()
    const html = renderToStaticMarkup(<SectionPanel state={state} update={noop} />)

    const button = buttonWith(html, 'Copy coordinates')
    expect(button).not.toBeNull()
    // it is a button, not a submit inside a form, and it explains itself
    expect(button!.attrs).toContain('type="button"')
    expect(button!.attrs).toContain('Excel')

    // it sits in the coordinate display: after the heading, before the table
    const heading = html.indexOf('Boundary coordinates (mm)')
    const table = html.indexOf('<table')
    expect(heading).toBeGreaterThan(-1)
    expect(html.indexOf(button!.html)).toBeGreaterThan(heading)
    expect(html.indexOf(button!.html)).toBeLessThan(table)

    // the button shares the row with the boundary/void selector, which is still
    // there for a section with openings (this one is a plain rectangle)
    const withVoid = renderToStaticMarkup(
      <SectionPanel
        state={
          importProjectText(
            JSON.stringify({
              boundary: { x: 0, y: 0, width: 400, height: 600 },
              holes: [{ x: 100, y: 100, diameter: 40 }],
            }),
            initialState(),
          ).state
        }
        update={noop}
      />,
    )
    expect(withVoid).toContain('outer boundary')
    expect(withVoid.indexOf('outer boundary')).toBeLessThan(withVoid.indexOf('Copy coordinates'))
  })

  it('copies the whole section — boundary and openings — from the state on screen', () => {
    const { state } = importProjectText(
      JSON.stringify({
        boundary: { x: 0, y: 0, width: 800, height: 400 },
        holes: [{ x: 120, y: 80, diameter: 25 }],
      }),
      initialState(),
    )
    renderToStaticMarkup(<SectionPanel state={state} update={noop} />)

    // what the button hands to the clipboard is built from the state the panel
    // was given — the same object the table and the diagram read
    const payload = sectionCoordinatesText(state.geometry)!
    expect(payload.count).toBe(4 + 64)
    expect(payload.text).toContain('Void 1')
    expect(payload.text.split('\n')[2]).toBe('Boundary\t1\t0\t0')
  })

  it('does not report anything until it is clicked', () => {
    const html = renderToStaticMarkup(<SectionPanel state={initialState()} update={noop} />)
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('to the clipboard')
  })

  it('reports an empty section instead of copying a boundary that is not one', async () => {
    // the hook is told what to say when there is nothing to copy, and the panel
    // passes the live geometry straight to the table builder
    const editors = read('../Editors.tsx')
    expect(editors).toContain("'No section coordinates to copy — the boundary needs at least three points.'")
    expect(editors).toContain('copy(sectionCoordinatesText(state.geometry))')
    expect(sectionCoordinatesText({ boundary: [], voids: [] })).toBe(null)
  })
})

describe('copy buttons in the reinforcement panel', () => {
  it('offers a Copy bar coordinates button beside the bar table', () => {
    const state = initialState()
    const html = renderToStaticMarkup(
      <RebarPanel bars={state.bars} update={noop} customizeBarDiameter={false} />,
    )

    const button = buttonWith(html, 'Copy bar coordinates')
    expect(button).not.toBeNull()
    expect(button!.attrs).toContain('type="button"')
    expect(button!.attrs).toContain('STAAD')

    // it is in the table's own toolbar, after the table and its row count
    const table = html.indexOf('</table>')
    const toolbar = html.indexOf('Validate')
    expect(html.indexOf(button!.html)).toBeGreaterThan(table)
    expect(html.indexOf(button!.html)).toBeLessThan(toolbar)

    // and the existing table actions are all still there
    for (const label of ['Validate', 'Add row', 'Clear table']) {
      expect(buttonWith(html, label)).not.toBeNull()
    }
  })

  it('copies every bar of the table that is on screen', () => {
    const state = initialState()
    const html = renderToStaticMarkup(
      <RebarPanel bars={state.bars} update={noop} customizeBarDiameter={false} />,
    )
    // the count the panel reports is the number of rows it drew
    expect(html).toContain(`${state.bars.length} bars`)
    const payload = barCoordinatesText(state.bars)!
    expect(payload.count).toBe(state.bars.length)
    // every row of the copy is a row of the table, in the same order
    const rows = payload.text.split('\n').slice(2)
    expect(rows).toHaveLength(state.bars.length)
    state.bars.forEach((bar, i) => {
      const cells = rows[i].split('\t')
      expect(Number(cells[1])).toBe(bar.x)
      expect(Number(cells[2])).toBe(bar.y)
      expect(Number(cells[3])).toBe(bar.dia)
    })
  })

  it('copies an imported circular arrangement as drawn, in the section’s frame', () => {
    const { state } = importProjectText(
      JSON.stringify({ sectionType: 'circle', D: 600, nBars: 12, cover: 40, barDia: 25 }),
      initialState(),
    )
    const payload = barCoordinatesText(state.bars)!
    expect(payload.count).toBe(12)
    // the same numbers the state carries, which is what the drawing and the bar
    // table beside the button show
    payload.text
      .split('\n')
      .slice(2)
      .forEach((row, i) => {
        const cells = row.split('\t')
        expect(Number(cells[1])).toBe(state.bars[i].x)
        expect(Number(cells[2])).toBe(state.bars[i].y)
      })
  })

  it('reports an empty table instead of copying nothing', () => {
    const html = renderToStaticMarkup(<RebarPanel bars={[]} update={noop} customizeBarDiameter={false} />)
    expect(buttonWith(html, 'Copy bar coordinates')).not.toBeNull()
    expect(read('../Editors.tsx')).toContain("'No bar coordinates to copy — the reinforcement table is empty.'")
    expect(barCoordinatesText([])).toBe(null)
  })
})

describe('the app and the two buttons', () => {
  it('renders both copy buttons once, in their own panels', () => {
    const html = renderToStaticMarkup(<App />)
    expect([...html.matchAll(/Copy coordinates</g)]).toHaveLength(1)
    expect([...html.matchAll(/Copy bar coordinates</g)]).toHaveLength(1)
    // both are in the input column, beside their own coordinate displays
    const section = html.indexOf('Boundary coordinates (mm)')
    const bars = html.indexOf('Reinforcement bars')
    expect(html.indexOf('Copy coordinates<')).toBeGreaterThan(section)
    expect(html.indexOf('Copy bar coordinates<')).toBeGreaterThan(bars)
  })

  it('keeps the copy feature to one module, the hook and the two panels', () => {
    const app = read('../../App.tsx')
    const clipboard = read('../../clipboard.ts')
    // nothing in the app itself computes a coordinate: the state is passed on
    expect(app).not.toContain('clipboard')
    expect(clipboard).toContain('export function sectionCoordinatesText')
    expect(clipboard).toContain('export function barCoordinatesText')
    expect(clipboard).toContain('navigator.clipboard')
    // the write falls back when the page may not use the Clipboard API
    expect(clipboard).toContain('execCommand')
    // the status line uses the theme's status tokens, so it reads in both themes
    const editors = read('../Editors.tsx')
    expect(editors).toContain("${note.ok ? 'text-ok' : 'text-bad'}")
    expect(editors).not.toContain('CopyNoteLine note={note} tone')
  })

  it("draws the copy glyph in the app's own icon style", () => {
    // the same line-icon component as every other button, so the two new
    // controls look like the app they are in
    const html = renderToStaticMarkup(<App />)
    expect([...html.matchAll(/M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z/g)]).toHaveLength(2)
    expect(html).toContain('Copy coordinates')
    expect(html).toContain('Copy bar coordinates')
  })
})
