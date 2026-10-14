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
  ShearDetailingCard,
  ShearInputsPanel,
  ShearResultsTable,
  ShearStepPanel,
  ShearSummaryPanel,
} from '../../components/Shear'
import {
  shearCheck,
  shearSectionData,
  shearSummary,
  type ShearCaseResult,
  type ShearSettings,
} from '../../engine/shear'
import { resolveLinkLayout, validateLinkLayout, withResolvedLegs } from '../../engine/stirrups'
import { generateSection } from '../../engine/sections'
import { uniformCover } from '../../engine/cover'
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
  const circular = s.shapeClass === 'circ'
  const layout = resolveLinkLayout(s.geometry, s.bars, s.cover, s.shear, circular)
  const validation = validateLinkLayout(layout, s.geometry, s.bars, s.shear)
  const settings = withResolvedLegs(s.shear, layout)
  const section = shearSectionData(s.geometry, s.bars, s.cover, settings)
  const results: ShearCaseResult[] = s.shearCases.map((lc) =>
    shearCheck(code, s.fck, fy, s.geometry, s.bars, s.cover, settings, lc),
  )
  return {
    s,
    fy,
    section,
    layout,
    validation,
    settings,
    results,
    summary: shearSummary(results),
    selected: s.shearCases[0],
  }
}

describe('shear panels render hygiene', () => {
  for (const code of ['IS456', 'IRC112', 'IRSCBC'] as const) {
    it(`renders every shear panel for ${code}`, () => {
      const { s, section, layout, validation, results, summary, selected } = fixture(code)
      const update = () => {}
      const html = renderToStaticMarkup(
        <div>
          <ShearInputsPanel state={s} update={update} section={section} layout={layout} />
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
          <ShearSummaryPanel code={code} summary={summary} />
          <ShearStepPanel code={code} lc={selected} result={results[0]} section={section} />
          <ShearDetailingCard
            state={s}
            update={update}
            geometry={s.geometry}
            bars={s.bars}
            section={section}
            layout={layout}
            validation={validation}
            result={results[0]}
            circular={false}
            figureId="fig-shear"
          />
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
      <ShearInputsPanel state={is456.s} update={() => {}} section={is456.section} layout={is456.layout} />,
    )
    const ircHtml = renderToStaticMarkup(
      <ShearInputsPanel state={irc.s} update={() => {}} section={irc.section} layout={irc.layout} />,
    )
    expect(is456Html).not.toContain('Strut inclination')
    expect(ircHtml).toContain('Strut inclination')
    expect(ircHtml).toContain('cot θ')
    expect(msgs).toEqual([])
  })

  it('renders the empty states without cases', () => {
    const { section } = fixture('IS456')
    const summary = shearSummary([])
    const html = renderToStaticMarkup(
      <div>
        <ShearResultsTable code="IS456" results={[]} selected={null} select={() => {}} section={section} />
        <ShearSummaryPanel code="IS456" summary={summary} />
        <ShearStepPanel code="IS456" lc={null} result={null} section={section} />
      </div>,
    )
    expect(html).toContain('Add a shear load case')
    expect(html).toContain('Select a shear load case')
    expect(msgs).toEqual([])
  })

  it('gives the shear diagram the shared figure controls (zoom in / out / fit)', () => {
    const { s, section, layout, validation, results } = fixture('IS456')
    const html = renderToStaticMarkup(
      <ShearDetailingCard
        state={s}
        update={() => {}}
        geometry={s.geometry}
        bars={s.bars}
        section={section}
        layout={layout}
        validation={validation}
        result={results[0]}
        circular={false}
        figureId="fig-shear"
      />,
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

describe('stirrup detailing editor', () => {
  /** The detailing card for a fixture, with an optional settings patch. */
  const detailing = (patch: Partial<ShearSettings> = {}, code: DesignCodeId = 'IS456') => {
    const f = fixture(code)
    f.s.shear = { ...f.s.shear, ...patch }
    const layout = resolveLinkLayout(f.s.geometry, f.s.bars, f.s.cover, f.s.shear, false)
    const validation = validateLinkLayout(layout, f.s.geometry, f.s.bars, f.s.shear)
    const settings = withResolvedLegs(f.s.shear, layout)
    const section = shearSectionData(f.s.geometry, f.s.bars, f.s.cover, settings)
    const results = f.s.shearCases.map((lc) =>
      shearCheck(code, f.s.fck, f.fy, f.s.geometry, f.s.bars, f.s.cover, settings, lc),
    )
    const html = renderToStaticMarkup(
      <ShearDetailingCard
        state={f.s}
        update={() => {}}
        geometry={f.s.geometry}
        bars={f.s.bars}
        section={section}
        layout={layout}
        validation={validation}
        result={shearSummary(results).governing}
        circular={false}
      />,
    )
    return { html, layout, validation }
  }

  it('shows a four-digit link spacing with its unit, without truncating the field', () => {
    const f = fixture('IS456')
    f.s.shear = { ...f.s.shear, linkSpacing: 1500 }
    const layout = resolveLinkLayout(f.s.geometry, f.s.bars, f.s.cover, f.s.shear, false)
    const settings = withResolvedLegs(f.s.shear, layout)
    const section = shearSectionData(f.s.geometry, f.s.bars, f.s.cover, settings)
    const html = renderToStaticMarkup(
      <div>
        <ShearInputsPanel state={f.s} update={() => {}} section={section} layout={layout} />
        {detailing({ linkSpacing: 1500 }).html}
      </div>,
    )
    // the input keeps at least 132 px so four digits + the unit never clip
    expect(html).toContain('min-w-[132px]')
    expect(html).toContain('value="1500"')
    expect(html).toContain('>mm</span>')
    // and the value shown is the one the check ran on
    expect(html).toContain('sv = 1,500 mm')
    // the panel readout, the figure caption and the editor rows all report the
    // spacing and the leg count the check ran on
    expect(html).toContain('A<sub>sv</sub> = 4 × ⌀8 = 201.1 mm² per set of legs')
    expect(html).toContain('provided = 4 × 50.3 mm² @ 1,500 c/c')
    expect(html).toContain('4 legs in Asv: 2 ring + 2 internal')
    // the automatic arrangement draws a leg on each interior bar column of the
    // fixture section: 2 ring legs + 2 internal legs, and nothing left to tie
    expect(html).toContain('Internal leg — in Asv (2)')
    expect(html).toContain('Cross-tie — not in Asv (0)')
    expect(html).toContain('4 legs in Asv')
    // each row reports the bars the member is hooked around
    expect(html).toContain('on bars 2 + 6')
    expect(html).toContain('hooked around bars 2 and 6')
    expect(msgs).toEqual([])
  })

  it('draws the internal legs on the actual bar columns, between the bottom and top bars', () => {
    const { html, layout } = detailing()
    const f = fixture('IS456')
    expect(layout.intermediate.length).toBe(2)
    expect(f.s.bars.length).toBeGreaterThan(8)

    // every bar is drawn at X(bar.x), so the leg x must be one of the bar x values
    const barX = [...html.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="[\d.]+" class="fill-[^"]*"[^>]*><title>Bar /g)].map(
      (m) => Number(m[1]),
    )
    expect(barX.length).toBe(f.s.bars.length)
    // the internal legs are drawn as dashed blue lines and are the only 1.5-wide
    // capacity-coloured lines in the figure
    const legs = [...html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" class="stroke-capacity" stroke-width="1.5"/g)]
      .map((m) => ({ x: Number(m[1]), y1: Number(m[2]), y2: Number(m[4]) }))
      // the legend swatch is the same style outside the section panel
      .filter((l) => l.x < 266)
    expect(legs).toHaveLength(2)
    for (const leg of legs) {
      expect(barX.some((x) => Math.abs(x - leg.x) < 0.05)).toBe(true)
    }
    // the legs span the full ring, i.e. they meet the horizontal runs of the link
    const ys = [...html.matchAll(/<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+) Z" class="fill-concrete/g)]
    expect(ys).toHaveLength(1)
    const boundaryTop = Math.min(Number(ys[0][2]), Number(ys[0][4]), Number(ys[0][6]), Number(ys[0][8]))
    const boundaryBottom = Math.max(Number(ys[0][2]), Number(ys[0][4]), Number(ys[0][6]), Number(ys[0][8]))
    for (const leg of legs) {
      expect(Math.min(leg.y1, leg.y2)).toBeGreaterThan(boundaryTop)
      expect(Math.max(leg.y1, leg.y2)).toBeLessThan(boundaryBottom)
    }
    // and the leg positions are the ones the check counted
    expect(layout.asvPerS).toBeCloseTo((layout.effectiveLegs * layout.singleLegArea) / 150, 9)
    expect(msgs).toEqual([])
  })

  it('reports an invalid manual arrangement with its reason and keeps every entered position', () => {
    const { html, layout, validation } = detailing({
      linkLayout: 'manual',
      legPositions: [0.35, 1.4],
      tiePositions: [0.5],
    })
    expect(layout.effectiveLegs).toBe(3) // 2 ring legs + 1 leg that fits
    expect(layout.dropped).toEqual([{ kind: 'leg', u: 1.4 }])
    expect(validation.status).toBe('error')
    expect(html).toContain('lies outside the section outline')
    // the entered millimetre positions are shown as entered — nothing is clamped
    expect(html).toContain('value="157.5"')
    expect(html).toContain('value="630"')
    expect(html).toContain('value="300"')
    expect(msgs).toEqual([])
  })

  it('credits the effective legs and keeps Asv in step with them', () => {
    const two = detailing({ linkLayout: 'manual', legPositions: [], tiePositions: [0.4, 0.6] })
    const four = detailing({ linkLayout: 'manual', legPositions: [0.3, 0.7], tiePositions: [] })
    expect(two.layout.effectiveLegs).toBe(2)
    expect(four.layout.effectiveLegs).toBe(4)
    expect(two.html).toContain('2 (2 + 0)')
    expect(four.html).toContain('4 (2 + 2)')
    expect(two.html).toContain('101 mm²') // 2 × 50.27
    expect(four.html).toContain('201 mm²') // 4 × 50.27
    // the provided Asv/sv the check uses follows the same leg count
    expect(two.html).toContain('0.670 mm²/mm')
    expect(four.html).toContain('1.340 mm²/mm')
    expect(msgs).toEqual([])
  })

  it('draws the automatic arrangement of a wide section from its bars', () => {
    const f = fixture('IS456')
    f.s.geometry = generateSection(
      { kind: 'rect', B: 900, D: 1200, nx: 6, ny: 6 },
      { cover: uniformCover(40), tieDia: 8, barDia: 25 },
    ).geometry
    f.s.bars = generateSection(
      { kind: 'rect', B: 900, D: 1200, nx: 6, ny: 6 },
      { cover: uniformCover(40), tieDia: 8, barDia: 25 },
    ).bars
    const layout = resolveLinkLayout(f.s.geometry, f.s.bars, f.s.cover, f.s.shear, false)
    expect(layout.intermediate.length).toBeGreaterThan(0)
    // the legs alone restrain every bar of this wide section, so no tie is added
    expect(layout.ties.length).toBe(0)
    const validation = validateLinkLayout(layout, f.s.geometry, f.s.bars, f.s.shear)
    expect(validation.unrestrained).toEqual([])
    const html = renderToStaticMarkup(
      <ShearDetailingCard
        state={f.s}
        update={() => {}}
        geometry={f.s.geometry}
        bars={f.s.bars}
        section={sheetSection(f)}
        layout={layout}
        validation={validation}
        result={null}
        circular={false}
        figureId="fig-shear"
      />,
    )
    expect(html).toContain('Internal leg — in Asv (4)')
    // a wide section is detailed with legs; the cross-tie legend still reports its own count
    expect(html).toContain('Cross-tie — not in Asv (0)')
    expect(html).toContain('every longitudinal bar is restrained')
    expect(msgs).toEqual([])
    function sheetSection(fx: ReturnType<typeof fixture>) {
      const settings = withResolvedLegs(fx.s.shear, fx.layout)
      return shearSectionData(fx.s.geometry, fx.s.bars, fx.s.cover, settings)
    }
  })

  it('renders a circular section with its hoop note and no automatic straight members', () => {
    const s = initialState()
    const g = generateSection({ kind: 'circle', D: 800, nBars: 16 }, { cover: uniformCover(40), tieDia: 10, barDia: 25 })
    s.geometry = g.geometry
    s.bars = g.bars
    s.shapeClass = 'circ'
    s.shear = { ...s.shear, linkDia: 10 }
    const layout = resolveLinkLayout(s.geometry, s.bars, s.cover, s.shear, true)
    expect(layout.ring.shape).toBe('circular')
    expect(layout.members).toEqual([])
    const validation = validateLinkLayout(layout, s.geometry, s.bars, s.shear)
    const settings = withResolvedLegs(s.shear, layout)
    const html = renderToStaticMarkup(
      <ShearDetailingCard
        state={s}
        update={() => {}}
        geometry={s.geometry}
        bars={s.bars}
        section={shearSectionData(s.geometry, s.bars, s.cover, settings)}
        layout={layout}
        validation={validation}
        result={null}
        circular
        figureId="fig-shear"
      />,
    )
    expect(html).toContain('Circular hoop')
    expect(html).toContain('Drawn as circular')
    expect(html).toContain('<circle')
    expect(msgs).toEqual([])
  })
})
