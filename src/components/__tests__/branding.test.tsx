/**
 * Branding guard.
 *
 * The application logo is one piece of artwork on three surfaces: the header
 * mark (a React component), the printed report header (the same markup emitted
 * into HTML), and the browser icon (`public/favicon.svg`, with the PNG fallbacks
 * rasterised by `scripts/make-favicons.mjs`). These tests keep the three in step
 * — a logo edited in one place only is the failure mode — and pin the details
 * that are easy to lose: the pattern path must not be filled, the ids must not
 * collide when several marks share a page, and the shipped PNGs must really be
 * PNGs of the right size.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AppLogo,
  LOGO_BARS,
  LOGO_FRAME,
  LOGO_HOOKS,
  LOGO_OFFSET_X,
  LOGO_OFFSET_Y,
  LOGO_SHADOW,
  LOGO_STIRRUP,
  LOGO_TILE,
  LOGO_VIEWBOX,
  logoSvgMarkup,
} from '../Logo'
import { reportHtml } from '../../report'
import App from '../../App'
import { initialState } from '../../state'
import { CODES } from '../../engine/codes'
import { complianceChecks } from '../../engine/checks'
import { ensureCCW, sectionProperties } from '../../engine/geometry'
import { buildAnalysisModel } from '../../engine/integrator'
import { checkLoadCase, generateSurface } from '../../engine/surface'
// Vite reads the shipped assets as text, so the guards below run without a DOM
// or a filesystem — the PNG is inlined as a data URL and decoded here.
import faviconSvg from '../../../public/favicon.svg?raw'
import indexHtml from '../../../index.html?raw'
import rasteriser from '../../../scripts/make-favicons.mjs?raw'
import favicon32Inline from '../../../public/favicon-32.png?inline'
import appleTouchInline from '../../../public/apple-touch-icon.png?inline'

/** The signature, IHDR geometry and colour model of an inlined PNG. */
function pngFacts(inline: string) {
  const binary = atob(inline.slice(inline.indexOf(',') + 1))
  const byteAt = (i: number) => binary.charCodeAt(i)
  const wordAt = (i: number) => (byteAt(i) << 24) | (byteAt(i + 1) << 16) | (byteAt(i + 2) << 8) | byteAt(i + 3)
  return {
    signature: [137, 80, 78, 71, 13, 10, 26, 10].map((_, i) => byteAt(i)),
    width: wordAt(16),
    height: wordAt(20),
    colourType: byteAt(25), // 8-bit depth, colour type at offset 17
    bitDepth: byteAt(24),
    bytes: binary.length,
  }
}

describe('application logo', () => {
  it('draws the supplied section mark in its own view box', () => {
    const html = renderToStaticMarkup(<AppLogo title="RCC Section Check" />)
    expect(html).toContain(`viewBox="${LOGO_VIEWBOX}"`)
    // the eight bars of the mark: 3 top, 2 side, 3 bottom
    expect(LOGO_BARS).toHaveLength(8)
    const svg = logoSvgMarkup('x')
    for (const b of LOGO_BARS) expect(svg).toContain(`<circle cx="${b.cx}" cy="${b.cy}" r="18"`)
    // the closed stirrup and both hooks of its end
    expect(svg).toContain(`stroke="${LOGO_STIRRUP.stroke}" stroke-width="${LOGO_STIRRUP.width}"`)
    for (const h of LOGO_HOOKS) expect(svg).toContain(`x1="${h.x1}" y1="${h.y1}" x2="${h.x2}" y2="${h.y2}"`)
    // the grid pattern path is unfilled: an open path is filled as if closed,
    // which would wash a triangle over every cell of the grid
    expect(svg).toMatch(/<path d="M 20 0 L 0 0 0 20" fill="none"/)
    // the drawing casts the drop shadow the filter describes
    expect(svg).toContain(`dy="${LOGO_SHADOW.dy}"`)
    expect(html).toContain('aria-label="RCC Section Check"')
    expect(html).toContain('data-logo="app"')
  })

  it('keeps several marks on one page from capturing each others definitions', () => {
    const a = logoSvgMarkup('a')
    const b = logoSvgMarkup('b')
    expect(a).toContain('id="agrid"')
    expect(b).toContain('id="bgrid"')
    expect(a).toContain('url(#ashadow)')
    expect(b).toContain('url(#bshadow)')
    // and the app mark uses a React-generated prefix, not a fixed one
    const html = renderToStaticMarkup(<AppLogo />)
    expect(html).toMatch(/id="[^"]*grid"/)
    expect(html).not.toContain('id="grid"')
  })

  it('is the mark of the app title in the header', () => {
    const html = renderToStaticMarkup(<App />)
    const header = html.slice(0, html.indexOf('</header>'))
    const logoAt = header.indexOf('data-logo="app"')
    const nameAt = header.indexOf('RCC Section Check')
    expect(logoAt).toBeGreaterThan(-1)
    expect(logoAt).toBeLessThan(nameAt)
    expect(header).toContain('h-[30px] w-[30px]')
    // decorative in the header: the name beside it carries the meaning
    expect(header).toContain('aria-hidden="true"')
  })

  it('is the mark of the printed report, on the title line', () => {
    const state = initialState()
    const spec = CODES[state.code]
    const grade = spec.steelGrades.find((g) => g.label === state.steelGrade)!
    const geometry = { boundary: ensureCCW(state.geometry.boundary), voids: state.geometry.voids.map(ensureCCW) }
    const props = sectionProperties(geometry, state.bars)
    const model = buildAnalysisModel(
      geometry,
      state.bars,
      { x: props.cx, y: props.cy },
      props.area,
      spec.concrete(state.fck),
      spec.steel(grade.fy),
      spec.epsSteelLimit(grade),
    )
    // a small surface keeps the guard quick; the report only reads from it
    const surface = generateSurface(model, { nTheta: 12, nDepth: 36 })
    const results = state.cases.map((lc) =>
      checkLoadCase(surface, lc, spec, state.fck, grade.fy, props.area, props.Asc, state.shapeClass),
    )
    const checks = complianceChecks(spec, {
      props,
      bars: state.bars,
      geometry,
      fck: state.fck,
      fy: grade.fy,
      cases: state.cases,
      shapeClass: state.shapeClass,
      memberLength: state.memberLength,
      cover: state.cover,
      tieDia: state.tieDia,
    })
    const report = reportHtml({
      state,
      spec,
      grade,
      props,
      surface,
      results,
      checks,
      flex: null,
      selectedName: results[0].loadCase.name,
      svgs: { section: '', pm: '', contour: '' },
    })
    const styles = report.slice(0, report.indexOf('</style>'))
    // the title block lays the mark out beside the heading, not centred above it
    expect(styles).toContain('.head { display: flex; align-items: center; gap: 12px')
    expect(styles).toContain('.head .logo { width: 54px; height: 54px')
    // the body carries the marker the delivery looks for when it checks that a
    // window or frame really holds the report before printing it
    const body = report.slice(report.indexOf('<body'), report.indexOf('Input data'))
    expect(report).toContain('<body data-report>')
    // and it is self-contained — it reaches the print dialog as a document of
    // its own (a blob URL in a window or a hidden frame), so it must not need
    // anything fetched from the network
    expect(report).toContain('<title>RCC Section Check — Calculation Report</title>')
    expect(report).not.toMatch(/<(link|img|script)\b|url\(https?:/)
    // the mark sits on the title line, ahead of the title itself
    const logoAt = body.indexOf('class="logo"')
    const titleAt = body.indexOf('Calculation Report')
    expect(logoAt).toBeGreaterThan(-1)
    expect(logoAt).toBeLessThan(titleAt)
    // the artwork, with the report's own pattern id
    expect(body).toContain('<circle cx="128" cy="98" r="18"')
    expect(body).toContain('id="repgrid"')
    expect(body).toContain('<div class="head">')
    expect(body).toContain('<h1>RCC Section Check — Calculation Report</h1>')
  })

  it('keeps the rectangular section exactly in the middle of the tile', () => {
    /**
     * The box of the artwork, measured from the markup: every shape of the
     * drawing lives inside the translated group, so its placement is the group
     * translation. The three tile rectangles and the defs come before that group
     * and are left out.
     */
    const box = (svg: string) => {
      const groupAt = svg.indexOf('<g filter=')
      expect(groupAt).toBeGreaterThan(-1)
      const drawing = svg.slice(groupAt)
      const [, tx, ty] = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(drawing)!
      const dx = Number(tx)
      const dy = Number(ty)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      const add = (x: number, y: number) => {
        minX = Math.min(minX, x + dx)
        maxX = Math.max(maxX, x + dx)
        minY = Math.min(minY, y + dy)
        maxY = Math.max(maxY, y + dy)
      }
      for (const m of drawing.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
        add(Number(m[1]), Number(m[2]))
        add(Number(m[1]) + Number(m[3]), Number(m[2]) + Number(m[4]))
      }
      for (const m of drawing.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)) {
        add(Number(m[1]) - Number(m[3]), Number(m[2]) - Number(m[3]))
        add(Number(m[1]) + Number(m[3]), Number(m[2]) + Number(m[3]))
      }
      for (const m of drawing.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)) {
        add(Number(m[1]), Number(m[2]))
        add(Number(m[3]), Number(m[4]))
      }
      return { minX, maxX, minY, maxY, left: minX, right: LOGO_TILE.size - maxX, top: minY, bottom: LOGO_TILE.size - maxY }
    }

    const t = LOGO_TILE.size
    for (const [name, svg] of [['component', logoSvgMarkup('x')], ['favicon', faviconSvg]] as const) {
      const b = box(svg)
      // the outermost element is the rectangular section, at its own size
      expect(b.maxX - b.minX, name).toBe(LOGO_FRAME.w)
      expect(b.maxY - b.minY, name).toBe(LOGO_FRAME.h)
      // equal tile on both sides and above and below — and the section's centre
      // on the centre of the tile, so the mark mirrors about both centre lines
      expect(b.left, name).toBe(b.right)
      expect(b.top, name).toBe(b.bottom)
      expect((b.minX + b.maxX) / 2, name).toBe(t / 2)
      expect((b.minY + b.maxY) / 2, name).toBe(t / 2)
      // 120 units of tile on either side, 70 above and below
      expect([b.left, b.top], name).toEqual([120, 70])
    }

    // the bars mirror each other about the section's own axes, column for column
    // and row for row
    const bars = (pick: 'cx' | 'cy') => [...new Set(LOGO_BARS.map((b) => b[pick]))]
    for (const v of bars('cx')) expect(bars('cx')).toContain(t - (v + LOGO_OFFSET_X) - LOGO_OFFSET_X)
    for (const v of bars('cy')) expect(bars('cy')).toContain(t - (v + LOGO_OFFSET_Y) - LOGO_OFFSET_Y)
    expect(bars('cx')).toHaveLength(3)
    expect(bars('cy')).toHaveLength(3)
    expect(LOGO_BARS).toHaveLength(8)
  })

  it('is the browser icon, in step with the component', () => {
    // The standalone favicon is the same artwork as the component's, written by
    // hand rather than generated, so compare the drawing rather than the bytes:
    // every shape, in order, with the coordinates that place it. Presentation
    // (comments, grouping, where a colour is inherited from) is not compared.
    const artwork = (svg: string) => {
      const keys = ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'd']
      return (svg.match(/<(rect|circle|line|path)\b[^>]*>/g) ?? []).map((tag) => {
        const attrs: Record<string, string> = {}
        for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2]
        // a rounded rectangle given only rx has ry = rx
        const name = tag.slice(1, tag.indexOf(' '))
        if (name === 'rect' && attrs.rx && !attrs.ry) attrs.ry = attrs.rx
        return `${name} ${keys.filter((k) => attrs[k] !== undefined).map((k) => `${k}=${attrs[k]}`).join(' ')}`
      })
    }
    const shapes = artwork(faviconSvg)
    expect(shapes).toEqual(artwork(logoSvgMarkup('file')))
    expect(shapes.filter((t) => t.startsWith('rect '))).toHaveLength(6) // tile ×3, boundary, core, stirrup
    expect(shapes.filter((t) => t.startsWith('line '))).toHaveLength(2) // the two hooks
    expect(shapes.filter((t) => t.startsWith('circle '))).toHaveLength(16) // 8 bars + their 8 cores
    // the artwork itself: tile, grid, boundary, stirrup, hooks and the eight bars
    for (const svg of [faviconSvg, logoSvgMarkup('file')]) {
      expect(svg).toContain('<rect width="600" height="600" rx="40" fill="#0a0a0a" />')
      expect(svg).toMatch(/<pattern id="[^"]*grid" width="20" height="20" patternUnits="userSpaceOnUse">/)
      expect(svg).toContain('<path d="M 20 0 L 0 0 0 20" fill="none" stroke="#334155"')
      expect(svg).toContain('<rect x="70" y="40" width="360" height="460" rx="40" fill="#f8fafc" />')
      expect(svg).toContain('<rect x="90" y="60" width="320" height="420" rx="20" fill="#0a0a0a" />')
      expect(svg).toContain('stroke="#475569" stroke-width="3"')
      expect(svg).toContain('flood-opacity="0.6"')
      expect(svg).toContain(`transform="translate(${LOGO_OFFSET_X} ${LOGO_OFFSET_Y})"`)
      expect(svg).toContain('viewBox="0 0 600 600"')
    }
    // the document points at it, with the PNG fallbacks
    expect(indexHtml).toContain('href="/favicon.svg"')
    expect(indexHtml).toContain('href="/favicon-32.png"')
    expect(indexHtml).toContain('href="/apple-touch-icon.png"')
    // the browser chrome matches the tile of the mark
    expect(indexHtml).toContain('content="#0a0a0a"')
  })

  it('is the icon the build ships as PNG fallbacks', () => {
    const small = pngFacts(favicon32Inline)
    const apple = pngFacts(appleTouchInline)
    for (const png of [small, apple]) {
      expect(png.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]) // PNG magic
      expect(png.bitDepth).toBe(8)
      expect(png.colourType).toBe(6) // RGBA
      expect(png.bytes).toBeGreaterThan(100)
    }
    expect([small.width, small.height]).toEqual([32, 32])
    expect([apple.width, apple.height]).toEqual([180, 180])
    // the rasteriser beside them draws the same geometry as the component
    expect(rasteriser).toContain('const DESIGN = 600')
    expect(rasteriser).toContain('const DX = 50')
    expect(rasteriser).toContain('const DY = 30')
    for (const b of LOGO_BARS) expect(rasteriser).toContain(`{ cx: ${b.cx}, cy: ${b.cy} }`)
    for (const h of LOGO_HOOKS) {
      expect(rasteriser).toContain(`x1: ${h.x1}`)
      expect(rasteriser).toContain(`x2: ${h.x2}`)
    }
  })
})
