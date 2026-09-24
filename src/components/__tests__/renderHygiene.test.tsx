/**
 * Render-hygiene guard: every panel and figure is rendered for each predefined
 * section (including hollow ones, which exercise the void-face cover path) and
 * the run must produce no React console errors or warnings — this catches markup
 * regressions (invalid nesting, missing keys) in the presentation layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../../App'
import { ClearCoverPanel } from '../../components/CoverPanel'
import { SectionPreview } from '../../components/SectionPreview'
import { CircularRebarPanel } from '../../components/CircularRebarPanel'
import { CompliancePanel, ResultsTable } from '../../components/Results'
import { auditCovers, normalizeCover } from '../../engine/cover'
import { complianceChecks } from '../../engine/checks'
import { CODES } from '../../engine/codes'
import { sectionProperties } from '../../engine/geometry'
import { defaultPredefined, generateSection, type PredefinedSection } from '../../engine/sections'
import { initialState } from '../../state'

let msgs: string[]
beforeEach(() => {
  msgs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void msgs.push('error: ' + a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a) => void msgs.push('warn: ' + a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

const COVER = normalizeCover({ outer: { bottom: 30, right: 45, top: 60, left: 75 }, inner: { top: 25 } })

describe('render hygiene', () => {
  it('App renders clean', () => {
    renderToStaticMarkup(<App />)
    expect(msgs).toEqual([])
  })

  const kinds: Array<'rect' | 'circle' | 'tee' | 'ishape' | 'angle' | 'box' | 'hollowCircle'> = [
    'rect',
    'circle',
    'tee',
    'ishape',
    'angle',
    'box',
    'hollowCircle',
  ]
  for (const kind of kinds) {
    it(`${kind} panels render clean`, () => {
      const def = { ...defaultPredefined(kind) } as PredefinedSection
      if (def.kind === 'hollowCircle') def.innerRing = true
      const gen = generateSection(def, { cover: COVER, tieDia: 8, barDia: 20 })
      const state = {
        ...initialState(),
        geometry: gen.geometry,
        bars: gen.bars,
        predefined: def,
        shapeClass: gen.shapeClass,
        cover: COVER,
      }
      const audit = auditCovers(state.bars, state.geometry, COVER, 8)
      const props = sectionProperties(state.geometry, state.bars)
      const checks = complianceChecks(CODES.IS456, {
        props,
        bars: state.bars,
        geometry: state.geometry,
        fck: 30,
        fy: 500,
        cases: state.cases,
        shapeClass: state.shapeClass,
        cover: COVER,
        tieDia: 8,
        coverAudit: audit,
      })
      const html = renderToStaticMarkup(
        <div>
          <ClearCoverPanel state={state} update={() => {}} audit={audit} />
          <SectionPreview
            geometry={state.geometry}
            bars={state.bars}
            props={props}
            cover={COVER}
            audit={audit}
            na={{ theta: 0.4, vna: 40, caption: 'NA' }}
            radialCoverOnly={gen.shapeClass === 'circ'}
          />
          <CircularRebarPanel
            predefined={def}
            cover={40}
            tieDia={8}
            barDia={20}
            setBarDia={() => {}}
            onApply={() => {}}
          />
          <ResultsTable results={[]} selected={null} select={() => {}} />
          <CompliancePanel checks={checks} />
        </div>,
      )
      expect(msgs).toEqual([])
      expect(html).toContain('Uniform cover')
    })
  }
})
