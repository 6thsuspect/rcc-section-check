/**
 * Render-hygiene guard for the SLS module: the SLS results table, summary and
 * calculation panels — and the SectionPreview stress overlay — must render for
 * a realistic project with no React console errors or warnings (valid nesting,
 * keys, no undefined children).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionPreview } from '../../components/SectionPreview'
import { SlsCalculationPanel, SlsResultsTable, SlsSummaryPanel } from '../../components/SLSResults'
import { buildSlsModel, slsMaterialLimits, slsStress, type SlsCaseResult, type SlsInputs } from '../../engine/sls'
import { sectionProperties } from '../../engine/geometry'
import { initialState } from '../../state'

let msgs: string[]
beforeEach(() => {
  msgs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void msgs.push('error: ' + a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a) => void msgs.push('warn: ' + a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

function slsFixture() {
  const s = initialState()
  const maxDia = Math.max(...s.bars.map((b) => b.dia))
  const lim = slsMaterialLimits(s.fck, 500, maxDia)
  const inp: SlsInputs = {
    geometry: s.geometry,
    bars: s.bars,
    fck: s.fck,
    fy: 500,
    m: lim.m,
    sigmaCbc: lim.sigmaCbc,
    sigmaSt: lim.sigmaSt,
    sigmaSc: lim.sigmaSc,
  }
  const model = buildSlsModel(inp)
  const results = new Map<string, SlsCaseResult | null>()
  for (const lc of s.cases) results.set(lc.id, slsStress(model, inp, lc))
  const list = s.cases.map((c) => results.get(c.id)!).filter(Boolean)
  const props = sectionProperties(s.geometry, s.bars)
  return { s, lim, results, list, props }
}

describe('SLS panel render hygiene', () => {
  it('SlsResultsTable, SlsSummaryPanel and SlsCalculationPanel render clean', () => {
    const { s, lim, results, list } = slsFixture()
    renderToStaticMarkup(
      <>
        <SlsResultsTable cases={s.cases} results={results} selected={s.cases[0]?.id ?? null} select={() => {}} />
        <SlsSummaryPanel results={list} limits={lim} anyFail={list.some((r) => !r.ok)} extrapolated={lim.extrapolated} />
        <SlsCalculationPanel lc={s.cases[0] ?? null} result={list[0] ?? null} />
      </>,
    )
    expect(msgs).toEqual([])
  })

  it('SectionPreview with the SLS neutral axis + stress overlay renders clean', () => {
    const { s, results, props } = slsFixture()
    const sel = results.get(s.cases[0]?.id ?? '') ?? null
    const na = sel && Number.isFinite(sel.xu)
      ? { theta: sel.phi, vna: sel.vna, vTop: sel.vTop, xu: sel.xu, caption: 'SLS neutral axis' }
      : null
    const stress =
      sel && Number.isFinite(sel.xu)
        ? {
            sigmaC: sel.sigmaC,
            sigmaCbc: sel.sigmaCbc,
            sigmaSt: sel.sigmaSt,
            sigmaStPerm: sel.sigmaStPerm,
            tensionBar: sel.tensionBar,
          }
        : null
    renderToStaticMarkup(
      <SectionPreview geometry={s.geometry} bars={s.bars} props={props} na={na} stress={stress} cover={s.cover} />,
    )
    expect(msgs).toEqual([])
  })

  it('renders clean for a pure-axial case (no bending neutral axis)', () => {
    const { s, lim, props } = slsFixture()
    const inp: SlsInputs = {
      geometry: s.geometry,
      bars: s.bars,
      fck: s.fck,
      fy: 500,
      m: lim.m,
      sigmaCbc: lim.sigmaCbc,
      sigmaSt: lim.sigmaSt,
      sigmaSc: lim.sigmaSc,
    }
    const model = buildSlsModel(inp)
    const r = slsStress(model, inp, { id: 'ax', name: 'AX', Pu: 900, Mux: 0, Muy: 0 })!
    renderToStaticMarkup(<SlsCalculationPanel lc={{ id: 'ax', name: 'AX', Pu: 900, Mux: 0, Muy: 0 }} result={r} />)
    renderToStaticMarkup(<SectionPreview geometry={s.geometry} bars={s.bars} props={props} na={null} stress={null} />)
    expect(msgs).toEqual([])
  })
})
