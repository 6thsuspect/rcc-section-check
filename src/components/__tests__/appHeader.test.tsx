/**
 * Header layout guard.
 *
 * The header carries the three check tabs and, in the same row, the status
 * readout of the open tab plus the action buttons. The readouts differ in width
 * from tab to tab (the SLS limits quote N/mm² twice, the shear summary quotes
 * kN twice), so the row must not depend on how wide the readout of the moment
 * happens to be: these tests pin that down — one shared readout component, gated
 * on the width of the action area rather than on the viewport or the tab, with
 * the three action buttons in a group that neither wraps nor shrinks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App, { HeaderStatus } from '../../App'
import { statusPillCls, statusReadoutCls } from '../ui'
import appSource from '../../App.tsx?raw'

let msgs: string[]
beforeEach(() => {
  msgs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void msgs.push('error: ' + a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a) => void msgs.push('warn: ' + a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

/** The rendered app header, split into the tabs row and the action area. */
function header() {
  const html = renderToStaticMarkup(<App />)
  const rowAt = html.indexOf('flex flex-wrap items-center justify-between')
  expect(rowAt).toBeGreaterThan(-1)
  const areaAt = html.indexOf('class="@container', rowAt)
  expect(areaAt).toBeGreaterThan(-1)
  return { html, rowAt, areaAt, area: html.slice(areaAt, html.indexOf('</header>', areaAt)) }
}

describe('app header', () => {
  it('keeps the tabs and the action buttons in one header row', () => {
    const { html, rowAt, areaAt, area } = header()
    // the tab group and the action area are children of the same header row
    const tabsAt = html.indexOf('aria-label="Check module"', rowAt)
    expect(tabsAt).toBeGreaterThan(rowAt)
    expect(areaAt).toBeGreaterThan(tabsAt)

    // the three action buttons sit in one non-shrinking group: nothing shown
    // beside the tabs can wrap or squeeze them apart
    // the action area keeps a min-content floor: inline-size containment would
    // zero the automatic minimum size and let the tabs squeeze the buttons
    expect(area).toContain('min-w-min')
    const groupAt = area.indexOf('flex shrink-0 items-center gap-1.5 sm:gap-2')
    expect(groupAt).toBeGreaterThan(-1)
    const group = area.slice(groupAt)
    expect([...group.matchAll(/<button/g)]).toHaveLength(3)
    const pdf = group.indexOf('Open the full calculation report')
    expect(pdf).toBeGreaterThan(-1)
    expect(group.indexOf('Import a saved project JSON file')).toBeLessThan(pdf)
    expect(group.indexOf('Export current project state to a JSON file')).toBeLessThan(pdf)
    expect(group).toContain('>PDF report<')

    // and the readout of the open tab is rendered before that group, so it is
    // the readout that gives way when the action area is tight
    expect(area.indexOf('@min-[860px]:flex')).toBeGreaterThan(-1)
    expect(area.indexOf('@min-[860px]:flex')).toBeLessThan(groupAt)
    expect(msgs).toEqual([])
  })

  it('gates the readout on the action area, not on the viewport or on the tab', () => {
    // both forms are driven by the container query, so every tab switches
    // between them at the same width
    expect(statusReadoutCls).toContain('@min-[860px]:flex')
    expect(statusPillCls).toContain('@min-[560px]:inline-flex')
    expect(statusPillCls).toContain('@min-[860px]:hidden')
    // a viewport breakpoint here would let one tab wrap where another does not
    expect(statusReadoutCls).not.toMatch(/\b(lg|xl|2xl):/)
    expect(statusPillCls).not.toMatch(/\b(lg|xl|2xl):/)
    // the readout yields room instead of pushing the buttons out of the row:
    // it wraps its own values rather than spilling out of its border
    expect(statusReadoutCls).toContain('flex-wrap')
    expect(statusReadoutCls).toContain('overflow-hidden')
    expect(statusPillCls).toContain('shrink-0')
  })

  it('renders every tab readout from the one component', () => {
    // the three tabs differ in what they report, never in how they are laid out
    const tabs = [
      {
        ok: true,
        verdict: 'ALL CHECKS PASS',
        title: 'Compliance verdict across all load cases',
        items: [
          { label: 'Puz', value: '5,738 kN', title: 'Pure axial (squash) capacity of the section' },
          { label: 'Pt', value: '-2,562 kN', title: 'Tension limit of the section' },
        ],
      },
      {
        ok: false,
        verdict: 'SLS FAILS',
        title: 'SLS stress verdict across all load cases',
        items: [
          { label: 'σcbc', value: '10.0 N/mm²', title: 'Permissible concrete stress in bending (IS 456 Table 21)' },
          { label: 'σst', value: '275 N/mm²', title: 'Permissible tensile steel stress (IS 456 Table 22)' },
        ],
      },
      {
        ok: true,
        verdict: 'SHEAR PASSES',
        title: 'Shear design verdict across all shear cases',
        items: [
          { label: 'Vu gov', value: '320 kN', title: 'Largest design shear force among the shear cases' },
          { label: 'VRd', value: '527 kN', title: 'Shear resistance of the section with the provided links at the governing case' },
        ],
      },
    ]
    const shapes = tabs.map((t) => {
      const html = renderToStaticMarkup(<HeaderStatus {...t} />)
      // each tab reports its own values
      expect(html).toContain(t.verdict)
      for (const it of t.items) expect(html).toContain(it.label)
      // ...through the same classes: only the pass/fail tone may differ
      return [...html.matchAll(/class="([^"]*)"/g)]
        .map((m) => m[1].replace(/\b(text|bg|border)-(ok|bad)(\/\d+)?/g, '$1-TONE$3'))
        .join('\n')
    })
    expect(new Set(shapes).size).toBe(1)
    // and the app uses that component for each of the three tabs — a bespoke
    // readout for one tab is how the row drifted out of alignment before
    expect([...appSource.matchAll(/<HeaderStatus/g)]).toHaveLength(3)
    expect(msgs).toEqual([])
  })
})
