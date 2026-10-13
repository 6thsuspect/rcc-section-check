/**
 * Render-hygiene guard for the shear-design module: the inputs, per-case
 * results, summary and step-by-step panels must render for a realistic project
 * under each of the three codes with no React console errors or warnings
 * (valid nesting, keys, no undefined children), and the PASS/FAIL verdict must
 * reflect the engine result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ShearCasesPanel,
  ShearInputsPanel,
  ShearResultsTable,
  ShearStepPanel,
  ShearSummaryPanel,
} from '../../components/Shear'
import { shearCheck, shearSectionData, shearSummary, type ShearCaseResult } from '../../engine/shear'
import { initialState } from '../../state'
import type { DesignCodeId } from '../../engine/types'

let msgs: string[]
beforeEach(() => {
  msgs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void msgs.push('error: ' + a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a) => void msgs.push('warn: ' + a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

function fixture(code: DesignCodeId) {
  const s = initialState()
  s.code = code
  const fy = 500
  const section = shearSectionData(s.geometry, s.bars, s.cover, s.shear)
  const results: ShearCaseResult[] = s.shearCases.map((lc) =>
    shearCheck(code, s.fck, fy, s.geometry, s.bars, s.cover, s.shear, lc),
  )
  return { s, fy, section, results, summary: shearSummary(results), selected: s.shearCases[0] }
}

describe('shear panels render hygiene', () => {
  for (const code of ['IS456', 'IRC112', 'IRSCBC'] as const) {
    it(`renders every shear panel for ${code}`, () => {
      const { s, section, results, summary, selected } = fixture(code)
      const update = () => {}
      const html = renderToStaticMarkup(
        <div>
          <ShearInputsPanel state={s} update={update} section={section} />
          <ShearCasesPanel
            cases={s.shearCases}
            selected={selected.id}
            update={update}
            select={update}
          />
          <ShearResultsTable
            code={code}
            results={results}
            selected={selected.id}
            select={update}
            section={section}
          />
          <ShearSummaryPanel code={code} summary={summary} settings={s.shear} section={section} figureId="fig-shear" />
          <ShearStepPanel code={code} lc={selected} result={results[0]} section={section} />
        </div>,
      )
      expect(msgs).toEqual([])
      expect(html).toContain('Shear design inputs')
      expect(html).toContain('Shear load cases')
      expect(html).toContain('Shear check per load case')
      expect(html).toContain('Shear check summary')
      // the pass/fail verdict of the engine is shown, and the figure is capturable
      expect(html).toContain(results[0].ok ? '>pass<' : '>fail<')
      expect(html).toContain('id="fig-shear"')
    })
  }

  it('shows the IRC 112 strut-angle input only for IRC 112', () => {
    const is456 = fixture('IS456')
    const irc = fixture('IRC112')
    const is456Html = renderToStaticMarkup(
      <ShearInputsPanel state={is456.s} update={() => {}} section={is456.section} />,
    )
    const ircHtml = renderToStaticMarkup(<ShearInputsPanel state={irc.s} update={() => {}} section={irc.section} />)
    expect(is456Html).not.toContain('Strut inclination')
    expect(ircHtml).toContain('Strut inclination')
    expect(ircHtml).toContain('cot θ')
    expect(msgs).toEqual([])
  })

  it('renders the empty states without cases', () => {
    const { s, section } = fixture('IS456')
    const summary = shearSummary([])
    const html = renderToStaticMarkup(
      <div>
        <ShearResultsTable code="IS456" results={[]} selected={null} select={() => {}} section={section} />
        <ShearSummaryPanel code="IS456" summary={summary} settings={s.shear} section={section} />
        <ShearStepPanel code="IS456" lc={null} result={null} section={section} />
      </div>,
    )
    expect(html).toContain('Add a shear load case')
    expect(html).toContain('Select a shear load case')
    expect(msgs).toEqual([])
  })

  it('gives the shear diagram the shared figure controls (zoom in / out / fit)', () => {
    const { section, results } = fixture('IS456')
    const html = renderToStaticMarkup(
      <ShearSummaryPanel code="IS456" summary={shearSummary(results)} settings={fixture('IS456').s.shear} section={section} figureId="fig-shear" />,
    )
    // same control strip as every other figure in the app
    expect(html).toContain('aria-label="Zoom in"')
    expect(html).toContain('aria-label="Zoom out"')
    expect(html).toContain('aria-label="Fit to view"')
    expect(html).toContain('id="fig-shear"')
    expect(msgs).toEqual([])
  })

  it('prints the provided-vs-required comparison and the spacing requirement', () => {
    const { section, results } = fixture('IS456')
    const html = renderToStaticMarkup(
      <ShearResultsTable code="IS456" results={results} selected={results[0].loadCase.id} select={() => {}} section={section} />,
    )
    expect(html).toContain('Asv/s req')
    expect(html).toContain('Asv/s prov')
    expect(html).toContain('sv max')
    expect(msgs).toEqual([])
  })
})
