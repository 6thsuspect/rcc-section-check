/**
 * Render-hygiene guard for the crack-width module: the inputs, per-case results
 * and calculation-detail panels must render for a realistic project (IS 456 and
 * IRC:112) with no React console errors or warnings (valid nesting, keys, no
 * undefined children).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CrackWidthDetailPanel,
  CrackWidthInputsPanel,
  CrackWidthResultsTable,
} from '../../components/CrackWidth'
import { buildSlsModel, slsMaterialLimits, slsStress, type SlsInputs } from '../../engine/sls'
import { crackWidthCheck, type CrackWidthResult, type CrackWidthSettings } from '../../engine/crackWidth'
import { initialState } from '../../state'

let msgs: string[]
beforeEach(() => {
  msgs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void msgs.push('error: ' + a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a) => void msgs.push('warn: ' + a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

function fixture(code: 'IS456' | 'IRC112') {
  const s = initialState()
  s.code = code
  const fy = 500
  const maxDia = Math.max(...s.bars.map((b) => b.dia))
  const lim = slsMaterialLimits(s.fck, fy, maxDia)
  const inp: SlsInputs = {
    geometry: s.geometry,
    bars: s.bars,
    fck: s.fck,
    fy,
    m: lim.m,
    sigmaCbc: lim.sigmaCbc,
    sigmaSt: lim.sigmaSt,
    sigmaSc: lim.sigmaSc,
  }
  const model = buildSlsModel(inp)
  const settings: CrackWidthSettings = { exposure: code === 'IRC112' ? 'XC3' : 'moderate', longTerm: false }
  const cw = new Map<string, CrackWidthResult | null>()
  for (const lc of s.crackCases) {
    const res = slsStress(model, inp, lc)
    cw.set(lc.id, res ? crackWidthCheck(code, s.fck, model, inp.bars, res, settings) : null)
  }
  const selected = s.crackCases[0]?.id ?? null
  return { s, settings, cw, selected }
}

describe('Crack width panel render hygiene', () => {
  it('renders inputs, results table and detail clean for IS 456', () => {
    const { s, settings, cw, selected } = fixture('IS456')
    const update = () => {}
    const select = () => {}
    renderToStaticMarkup(
      <>
        <CrackWidthInputsPanel code="IS456" settings={settings} update={update} />
        <CrackWidthResultsTable code="IS456" cases={s.crackCases} results={cw} selected={selected} select={select} />
        <CrackWidthDetailPanel code="IS456" settings={settings} lc={s.crackCases[0]} result={cw.get(s.crackCases[0].id) ?? null} />
      </>,
    )
    expect(msgs).toEqual([])
  })

  it('renders clean for IRC:112 (Eurocode branches)', () => {
    const { s, settings, cw, selected } = fixture('IRC112')
    renderToStaticMarkup(
      <>
        <CrackWidthInputsPanel code="IRC112" settings={settings} update={() => {}} />
        <CrackWidthResultsTable code="IRC112" cases={s.crackCases} results={cw} selected={selected} select={() => {}} />
        <CrackWidthDetailPanel code="IRC112" settings={settings} lc={s.crackCases[0]} result={cw.get(s.crackCases[0].id) ?? null} />
      </>,
    )
    expect(msgs).toEqual([])
  })

  it('renders the empty states without a selected case', () => {
    const { settings, cw } = fixture('IS456')
    renderToStaticMarkup(
      <>
        <CrackWidthDetailPanel code="IS456" settings={settings} lc={null} result={null} />
        <CrackWidthResultsTable code="IS456" cases={[]} results={cw} selected={null} select={() => {}} />
      </>,
    )
    expect(msgs).toEqual([])
  })
})
