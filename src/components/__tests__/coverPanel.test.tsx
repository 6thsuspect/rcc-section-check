import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClearCoverPanel } from '../CoverPanel'
import { SectionPreview } from '../SectionPreview'
import { auditCovers, normalizeCover } from '../../engine/cover'
import { defaultPredefined, generateSection, type PredefinedSection } from '../../engine/sections'
import { initialState } from '../../state'

/**
 * Render smoke tests for the per-face cover editors: they keep the panel, the
 * section preview and the audit on the same convention (docs/03 §3.6) and catch
 * regressions that the engine tests cannot see.
 */

const COVER = normalizeCover({
  outer: { bottom: 30, right: 45, top: 60, left: 75 },
  inner: { bottom: 25, right: 40, top: 35, left: 20 },
})

function renderShape(kind: PredefinedSection['kind']) {
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
  const audit = auditCovers(gen.bars, gen.geometry, COVER, 8)
  const html = renderToStaticMarkup(
    <div>
      <ClearCoverPanel state={state} update={() => {}} audit={audit} />
      <SectionPreview
        geometry={gen.geometry}
        bars={gen.bars}
        props={null}
        cover={COVER}
        audit={audit}
        radialCoverOnly={gen.shapeClass === 'circ'}
      />
    </div>,
  )
  return { html, audit, state }
}

describe('clear cover panel', () => {
  it('lists the four outer faces with their own values', () => {
    const { html } = renderShape('rect')
    expect(html).toContain('Clear cover — per face')
    for (const v of [30, 45, 60, 75]) expect(html).toContain(`value="${v}"`)
    // no voids in a solid rectangle → no void-face block
    expect(html).not.toContain('Void / inner faces')
  })

  it('shows the void-face editors only for hollow sections', () => {
    for (const kind of ['box', 'hollowCircle'] as const) {
      const { html } = renderShape(kind)
      expect(html).toContain('Void / inner faces')
      expect(html).toContain('clear overrides')
    }
    for (const kind of ['rect', 'tee', 'angle'] as const) {
      expect(renderShape(kind).html).not.toContain('Void / inner faces')
    }
  })

  it('reports the audit verdict and the governing bar', () => {
    const { html, audit } = renderShape('box')
    expect(audit.nShort).toBe(0)
    expect(html).toContain('Cover satisfied')
    expect(html).toContain('All bars meet the cover of the face they lie against')
  })

  it('offers to fix a layout that no longer matches the entered cover', () => {
    const { html } = renderShape('rect')
    // state.bars come from initialState (⌀25, 40 mm) while the panel shows an
    // asymmetric cover → the generated layout is out of date
    expect(html).toContain('Apply cover to layout')
  })

  it('names the governing radial value for circular sections', () => {
    const { html } = renderShape('circle')
    expect(html).toContain('Circular ring')
    expect(html).toContain('75 mm')
  })
})
