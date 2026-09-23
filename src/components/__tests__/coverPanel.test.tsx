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
  it('highlights Uniform Cover as the primary control and hides advanced options + cover figure by default', () => {
    const { html } = renderShape('rect')
    expect(html).toContain('Clear cover')
    expect(html).toContain('Uniform Cover')
    expect(html).toContain('Default')
    expect(html).toContain('data-testid="uniform-cover-primary"')
    // Advanced face editors AND the cover section figure are collapsed until expanded
    expect(html).toContain('Show Advanced Cover')
    expect(html).not.toContain('data-testid="advanced-cover-panel"')
    expect(html).not.toContain('data-testid="advanced-cover-figure"')
    expect(html).not.toContain('Void / inner faces')
    expect(html).not.toContain('Per-face cover sketch')
    // Uniform field shows the governing (max) face value when faces differ
    expect(html).toContain('value="75"')
  })

  it('offers Advanced Cover for hollow box sections (void faces live there)', () => {
    const { html } = renderShape('box')
    expect(html).toContain('Show Advanced Cover')
    expect(html).toContain('Uniform Cover')
    // collapsed by default — void editors not in the DOM yet
    expect(html).not.toContain('Void / inner faces')
    expect(html).not.toContain('clear overrides')
  })

  it('does not offer Advanced Cover chrome for solid shapes with no face overrides path beyond uniform', () => {
    // tee/angle still have advanced face editors (non-rect polygon-like or rect-class)
    for (const kind of ['rect', 'tee', 'angle'] as const) {
      const { html } = renderShape(kind)
      expect(html).toContain('Uniform Cover')
      expect(html).not.toContain('Void / inner faces')
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
    expect(html).toContain('Uniform Cover')
  })
})
