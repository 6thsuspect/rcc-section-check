/**
 * Page-frame guard.
 *
 * The app is a frame (header, workspace, footer) around a two-track grid: the
 * panels column and the results column. The frame is the full width of the window
 * — a capped, centred column leaves empty gutters down the sides of a desktop
 * monitor — while the panels column keeps a readable cap of its own so that every
 * extra bit of width goes to the diagrams, tables and result panels. These tests
 * hold both ends of that: full width and no horizontal overflow.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../../App'
import { tblCls } from '../ui'

const html = renderToStaticMarkup(<App />)
/** Index of `needle` from `from`, failing the test when it is not there. */
const at = (needle: string, from = 0) => {
  const i = html.indexOf(needle, from)
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1)
  return i
}

describe('page frame', () => {
  it('uses the full width of the window, with no capped column', () => {
    // one frame class, used by the header row, the workspace and the footer, so
    // they all line up — and it is `w-full` with no `max-w-*` and no `mx-auto`:
    // a centred capped column is what leaves the blank gutters on a wide monitor
    const FRAME = 'class="w-full px-3 sm:px-5 lg:px-6 2xl:px-8'
    const frames = [...html.matchAll(new RegExp(FRAME, 'g'))]
    expect(frames.length).toBeGreaterThanOrEqual(3) // header, workspace, footer
    for (const m of frames) {
      const cls = html.slice(m.index, at('>', m.index))
      expect(cls).not.toContain('max-w-')
      expect(cls).not.toContain('mx-auto')
    }
    // and nothing else reintroduces a page-level cap
    expect(html).not.toContain('max-w-[1640px]')
    expect(html).not.toMatch(/max-w-screen/)
    // the side padding grows with the window, so the content gets the width
    expect(FRAME).toContain('px-3 sm:px-5 lg:px-6 2xl:px-8')
  })

  it('gives every spare pixel to the results column', () => {
    // desktop steps, narrowest first: the second track is `minmax(0, 1fr)` at
    // every step, so the diagrams, tables and result panels absorb all the width
    // the monitor offers. The first track (the input panels) is capped — a form
    // column does not get better with 900 px — and capped at every width: an
    // extra step for huge monitors would have to be a named breakpoint, because
    // Tailwind emits arbitrary `min-[2200px]:` variants *before* the named `2xl:`
    // block, which would leave the wider step losing the cascade.
    const steps = [
      'lg:grid-cols-[minmax(0,392px)_minmax(0,1fr)]',
      '2xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]',
    ]
    expect(html).not.toContain('min-[2200px]:')
    for (const step of steps) expect(html).toContain(step)
    // the workspace is the frame class plus the grid
    expect(html).toContain(`class="w-full px-3 sm:px-5 lg:px-6 2xl:px-8 flex-1 min-h-0 grid grid-cols-1`)
    expect(html).toContain('grid-cols-1 gap-3.5 2xl:grid-cols-2')
  })

  it('cannot overflow the window horizontally', () => {
    // the app is a column frame that clips: the only scroller is the workspace
    // itself (vertically), so nothing can push the page sideways
    expect(html).toContain('flex h-screen flex-col overflow-hidden')
    // every column of the grid is `min-w-0`, so its content cannot force the
    // track wider than the space it was given
    const columns = [...html.matchAll(/class="flex min-w-0 flex-col gap-3.5/g)]
    expect(columns.length).toBeGreaterThanOrEqual(2) // the panels and the open tab
    // and a table too wide for its card scrolls inside that card, never the page
    const tables = [...html.matchAll(/<table/g)].length
    const scrollers = [...html.matchAll(/overflow-x-auto|overflow-auto/g)].length
    expect(tables).toBeGreaterThan(0)
    expect(scrollers).toBeGreaterThanOrEqual(tables)
    // every table is fluid: `w-full`, so it uses the width of its card
    expect(tblCls).toContain('w-full')
  })
})
