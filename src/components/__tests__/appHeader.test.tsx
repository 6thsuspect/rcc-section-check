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
import { btnCls, btnPrimaryCls, headerBtnCls, headerBtnPrimaryCls, statusPillCls, statusReadoutCls } from '../ui'
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

    // the action buttons sit in one non-shrinking group: nothing shown beside
    // the tabs can wrap or squeeze them apart. Import, Export and PDF report,
    // then the two icon-only dialogs — Settings and About — last in the row.
    // the action area keeps a min-content floor: inline-size containment would
    // zero the automatic minimum size and let the tabs squeeze the buttons
    expect(area).toContain('min-w-min')
    const groupAt = area.indexOf('flex shrink-0 items-center gap-1 sm:gap-2')
    expect(groupAt).toBeGreaterThan(-1)
    const group = area.slice(groupAt)
    expect([...group.matchAll(/<button/g)]).toHaveLength(5)
    const pdf = group.indexOf('Print the full calculation report')
    expect(pdf).toBeGreaterThan(-1)
    expect(group.indexOf('Import a saved project JSON file')).toBeLessThan(pdf)
    expect(group.indexOf('Export current project state to a JSON file')).toBeLessThan(pdf)
    expect(group).toContain('>PDF report<')

    // the two dialogs come after the report button: what the reader opens
    // rarely is at the end of the row, where the eye is not looking for it
    const gear = group.indexOf('aria-label="Settings"')
    const info = group.indexOf('aria-label="About"')
    expect(pdf).toBeLessThan(gear)
    expect(gear).toBeLessThan(info)
    // each names the panel it opens, in its tooltip and to assistive tech
    expect(group.slice(gear, info)).toContain('title="Settings — theme, drafting sheet')
    expect(group.slice(info)).toContain('title="About RCC Section Check — version')
    // ...and each reports whether its own panel is open
    for (const label of ['Settings', 'About']) {
      expect(group).toContain(`aria-label="${label}" aria-expanded="false"`)
    }

    // and the readout of the open tab is rendered before that group, so it is
    // the readout that gives way when the action area is tight
    expect(area.indexOf('@min-[860px]:flex')).toBeGreaterThan(-1)
    expect(area.indexOf('@min-[860px]:flex')).toBeLessThan(groupAt)
    expect(msgs).toEqual([])
  })

  it('styles the three checks as buttons, not as a tab group', () => {
    const { html } = header()
    const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
      cls: /class="([^"]*)"/.exec(m[1])?.[1] ?? '',
      attrs: m[1],
      text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    const at = (hint: string) => {
      const b = buttons.find((x) => x.attrs.includes(hint))
      expect(b, hint).toBeTruthy()
      return b as { cls: string; attrs: string; text: string }
    }
    const dt = at('Ultimate limit state')
    const sls = at('Serviceability limit state')
    const shear = at('Shear design check')
    const clsOf = (hint: string) => at(hint).cls
    // the three checks carry exactly the class string of the Import / Export
    // buttons: same padding, radius, hover, pressed and disabled behaviour
    const importCls = clsOf('Import a saved project JSON file')
    expect(importCls).toContain('px-2.5 py-[5px]')
    expect(importCls).toContain('hover:bg-panel')
    expect(dt.cls).toBe(importCls)
    expect(sls.cls).toBe(importCls)
    expect(shear.cls).toBe(importCls)
    // and no selected-segment styling is left anywhere on them
    for (const c of [dt.cls, sls.cls, shear.cls]) {
      expect(c).not.toContain('bg-accent-wash')
      expect(c).not.toContain('border-accent')
      expect(c).not.toContain('shadow-[inset_0_-2px_0')
      expect(c).not.toContain('flex-1')
    }
    // the open check is still announced (the panels below carry the rest)
    const pressed = [dt, sls, shear].filter((b) => b.attrs.includes('aria-pressed="true"'))
    expect(pressed).toHaveLength(1)
    expect(pressed[0].text).toBe('ULS Check')
    // the row keeps the action row's spacing, so the buttons read as a set of
    // independent buttons rather than a tight tab strip
    expect(html).toContain('items-stretch gap-1 sm:gap-2 shrink-0 max-[600px]:w-full')
    // the segmented controls elsewhere in the app are untouched: they still
    // carry the filled selected segment
    expect(html).toContain('bg-accent-wash')
    expect(msgs).toEqual([])
  })

  it('compacts the header on a phone — no overlap, no sideways scrolling', () => {
    const { html } = header()
    const headerHtml = html.slice(0, html.indexOf('</header>'))

    // the header row wraps (it is never a sideways-scrolling strip: the app root
    // clips overflow, so anything that did not wrap would be lost, not scrolled)
    expect(html).toContain('flex flex-wrap items-center justify-between')
    expect(headerHtml).not.toContain('overflow-x')

    // the three checks are one wrapping flex row, and below the phone breakpoint
    // that row takes a full line of its own under the title
    expect(html).toContain('flex flex-wrap items-stretch gap-1 sm:gap-2 shrink-0 max-[600px]:w-full')

    // the word "Check" is a span of its own, hidden by a media query on a phone
    // (`max-[600px]:hidden` = `@media (width < 600px) { display: none }`), so the
    // labels shorten to ULS / SLS / Shear instead of the row spilling out
    const labels = [...headerHtml.matchAll(/<span>([A-Za-z]+)<span class="([^"]*)"> Check<\/span><\/span>/g)].map(
      (m) => ({ word: m[1], cls: m[2] }),
    )
    expect(labels.map((l) => l.word)).toEqual(['ULS', 'SLS', 'Shear'])
    for (const l of labels) expect(l.cls).toBe('max-[600px]:hidden')
    // ...and the full name survives the breakpoint, for screen readers and for
    // anything that queries the button by name
    for (const name of ['ULS Check', 'SLS Check', 'Shear Check']) {
      expect(html).toContain(`aria-label="${name}"`)
    }

    // every header button — checks and actions alike — carries the compact
    // phone style: smaller padding, type and icon gap, plus a pressed state that
    // reads under a finger and no double-tap-zoom delay
    expect(headerBtnCls.startsWith(btnCls)).toBe(true)
    expect(headerBtnPrimaryCls.startsWith(btnPrimaryCls)).toBe(true)
    for (const cls of [headerBtnCls, headerBtnPrimaryCls]) {
      expect(cls).toContain('max-[600px]:px-2')
      expect(cls).toContain('max-[600px]:py-')
      expect(cls).toContain('max-[600px]:text-[0.65625rem]')
      expect(cls).toContain('max-[600px]:gap-1')
      expect(cls).toContain('touch-manipulation')
      expect(cls).toContain('active:scale-[0.97]')
    }
    // the panels' buttons are untouched: the compaction lives on the header only
    expect(btnCls).not.toContain('max-[')
    expect(btnPrimaryCls).not.toContain('max-[')
    expect(btnCls).toContain('active:translate-y-[0.5px]')
    // and that is what the header renders: the three checks, the three file
    // buttons and the two dialog buttons, all of them compact on a phone
    const headerButtons = [...headerHtml.matchAll(/<button([^>]*)>/g)].map(
      (m) => /class="([^"]*)"/.exec(m[1])?.[1] ?? '',
    )
    expect(headerButtons).toHaveLength(8)
    for (const cls of headerButtons) expect(cls).toContain('max-[600px]:text-[0.65625rem]')
    expect(headerButtons[5]).toContain('bg-accent') // the PDF button keeps its fill
    // the two dialog buttons are the shared action style, not a filled one:
    // neither of them is an action on the project
    for (const cls of headerButtons.slice(6)) {
      expect(cls.startsWith(headerBtnCls)).toBe(true)
      expect(cls).not.toContain('bg-accent ')
    }
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
