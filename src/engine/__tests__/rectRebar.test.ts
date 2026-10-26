import { describe, expect, it } from 'vitest'
import { barArea, ensureCCW, sectionProperties } from '../geometry'
import { auditCovers, setOuterCover, uniformCover } from '../cover'
import { generateSection } from '../sections'
import { clearDistance, detectBarOverlaps, spacingReport } from '../barSpacing'
import { CODES } from '../codes'
import { buildAnalysisModel } from '../integrator'
import { checkLoadCase, generateSurface } from '../surface'
import { buildSlsModel, slsMaterialLimits, slsStress } from '../sls'
import { crackWidthCheck, DEFAULT_EXPOSURE } from '../crackWidth'
import { DEFAULT_SHEAR, shearCheck, shearSectionData } from '../shear'
import { complianceChecks } from '../checks'
import { parseProjectFile } from '../../projectFile'
import { importProjectText } from '../../importFile'
import { barCoordinatesText } from '../../clipboard'
import { initialState } from '../../state'
import {
  defaultRectAdvancedConfig,
  defaultRectFaceUnit,
  defaultRectLayer,
  expandLayerToUnits,
  generateRectAdvancedRebar,
  rectConfigFromSection,
} from '../rectRebar'

const RECT_DEF = { kind: 'rect' as const, B: 450, D: 600, nx: 4, ny: 2 }
const COVER_40 = uniformCover(40)
const TIE_8 = 8

describe('Advanced Rectangular Reinforcement Engine', () => {
  it('reproduces standard rectangular perimeter coordinates identically when seeded from section', () => {
    const std = generateSection(RECT_DEF, { cover: COVER_40, tieDia: TIE_8, barDia: 25 })
    const cfg = rectConfigFromSection(RECT_DEF, 25, true)
    const adv = generateRectAdvancedRebar(cfg, std.geometry, COVER_40, TIE_8)

    expect(adv.issues).toEqual([])
    expect(adv.spacers).toEqual([])
    expect(adv.bars).toHaveLength(std.bars.length)
    std.bars.forEach((b, i) => {
      expect(adv.bars[i].x).toBeCloseTo(b.x, 2)
      expect(adv.bars[i].y).toBeCloseTo(b.y, 2)
      expect(adv.bars[i].dia).toBe(b.dia)
    })
  })

  it('configures Top, Bottom, Left and Right faces independently and reacts to geometry & per-face cover', () => {
    const geom = generateSection({ kind: 'rect', B: 500, D: 700, nx: 4, ny: 2 }, { cover: COVER_40, tieDia: TIE_8, barDia: 20 }).geometry
    let cover = uniformCover(40)
    cover = setOuterCover(cover, 'bottom', 50)
    cover = setOuterCover(cover, 'top', 35)
    cover = setOuterCover(cover, 'left', 45)
    cover = setOuterCover(cover, 'right', 60)

    const cfg = defaultRectAdvancedConfig({ enabled: true })
    cfg.faces.bottom.layers = [defaultRectLayer({ nBars: 5, barDia: 25 })]
    cfg.faces.top.layers = [defaultRectLayer({ nBars: 3, barDia: 16 })]
    cfg.faces.left.layers = [defaultRectLayer({ nBars: 2, barDia: 12 })]
    cfg.faces.right = { ...cfg.faces.right, enabled: false }

    const res = generateRectAdvancedRebar(cfg, geom, cover, TIE_8)
    expect(res.bars).toHaveLength(5 + 3 + 2)
    expect(res.issues).toEqual([])

    const bottomBars = res.bars.filter((b) => b.face === 'bottom')
    const topBars = res.bars.filter((b) => b.face === 'top')
    const leftBars = res.bars.filter((b) => b.face === 'left')
    const rightBars = res.bars.filter((b) => b.face === 'right')

    expect(bottomBars).toHaveLength(5)
    expect(topBars).toHaveLength(3)
    expect(leftBars).toHaveLength(2)
    expect(rightBars).toHaveLength(0)

    // Bottom y = 50 + 8 + 25/2 = 70.5 mm; Top y = 700 - (35 + 8 + 16/2) = 649 mm; Left x = 45 + 8 + 12/2 = 59 mm
    bottomBars.forEach((b) => expect(b.y).toBeCloseTo(70.5, 2))
    topBars.forEach((b) => expect(b.y).toBeCloseTo(649, 2))
    leftBars.forEach((b) => expect(b.x).toBeCloseTo(59, 2))

    const audit = auditCovers(res.bars, geom, cover, TIE_8)
    expect(audit.nShort).toBe(0)
  })

  it('generates 2-bar and 3-bar repeating alternate diameter sequences with exact individual cover offsets', () => {
    const geom = generateSection({ kind: 'rect', B: 600, D: 650, nx: 4, ny: 2 }, { cover: COVER_40, tieDia: TIE_8, barDia: 20 }).geometry
    const cfg = defaultRectAdvancedConfig({ enabled: true })
    cfg.faces.left.enabled = false
    cfg.faces.right.enabled = false
    cfg.faces.top.layers = [
      defaultRectLayer({
        kind: 'alternate',
        nBars: 4,
        patternDias: [16, 20],
      }),
    ]
    cfg.faces.bottom.layers = [
      defaultRectLayer({
        kind: 'alternate',
        nBars: 6,
        patternDias: [16, 20, 25],
      }),
    ]

    const res = generateRectAdvancedRebar(cfg, geom, COVER_40, TIE_8)
    expect(res.issues).toEqual([])

    const topDias = res.bars.filter((b) => b.face === 'top').map((b) => b.dia)
    expect(topDias).toEqual([16, 20, 16, 20])

    const botBars = res.bars.filter((b) => b.face === 'bottom')
    expect(botBars.map((b) => b.dia)).toEqual([16, 20, 25, 16, 20, 25])
    // Flush stirrup contact: y_i = 40 + 8 + d_i / 2
    expect(botBars[0].y).toBeCloseTo(56, 2)
    expect(botBars[1].y).toBeCloseTo(58, 2)
    expect(botBars[2].y).toBeCloseTo(60.5, 2)
    // Corner x offsets match individual end bar diameters: left Ø16 -> 56 mm, right Ø25 -> 600 - 60.5 = 539.5 mm
    expect(botBars[0].x).toBeCloseTo(56, 2)
    expect(botBars[5].x).toBeCloseTo(539.5, 2)

    expect(auditCovers(res.bars, geom, COVER_40, TIE_8).nShort).toBe(0)
  })

  it('packs 2-bar, 3-bar and custom mixed-diameter bundles with exact tangency and coexisting single bars on the same face', () => {
    const geom = generateSection({ kind: 'rect', B: 650, D: 700, nx: 4, ny: 2 }, { cover: COVER_40, tieDia: TIE_8, barDia: 20 }).geometry
    const cfg = defaultRectAdvancedConfig({ enabled: true })
    cfg.faces.left.enabled = false
    cfg.faces.right.enabled = false

    // Top face: 3-bar bundles of mixed diameters [25, 20, 16] with 2 mm inner clear separation
    cfg.faces.top.layers = [
      defaultRectLayer({
        kind: 'bundle',
        nBundles: 3,
        barsPerBundle: 3,
        bundleMixedDia: true,
        bundleBarDias: [25, 20, 16],
        bundleInnerClear: 2,
      }),
    ]

    // Bottom face: mixed groups — 2-bar corner bundles (Ø25+Ø20) + 2 single bars (Ø16, Ø20) + 4-bar bundle on same face!
    cfg.faces.bottom.layers = [
      defaultRectLayer({
        kind: 'customGroups',
        bundleInnerClear: 0,
        units: [
          { ...defaultRectFaceUnit('bundle', 25, 2), dias: [25, 20], barsPerBundle: 2 },
          defaultRectFaceUnit('single', 16, 2),
          defaultRectFaceUnit('single', 20, 2),
          { ...defaultRectFaceUnit('bundle', 20, 4), dias: [20, 20, 16, 16], barsPerBundle: 4 },
        ],
      }),
    ]

    const res = generateRectAdvancedRebar(cfg, geom, COVER_40, TIE_8)
    expect(detectBarOverlaps(res.bars)).toEqual([])
    expect(auditCovers(res.bars, geom, COVER_40, TIE_8).nShort).toBe(0)

    // Verify 3-bar mixed bundle on top face achieves exact 2 mm clear distance on all 3 pairs!
    const firstTopBundle = res.bars.filter((b) => b.groupId === 'bundle-top-L1-B1')
    expect(firstTopBundle).toHaveLength(3)
    expect(clearDistance(firstTopBundle[0], firstTopBundle[1])).toBeCloseTo(2, 1)
    expect(clearDistance(firstTopBundle[0], firstTopBundle[2])).toBeCloseTo(2, 1)
    expect(clearDistance(firstTopBundle[1], firstTopBundle[2])).toBeCloseTo(2, 1)

    // Verify spacingReport recognises all 5 bundles (3 on top + 2 on bottom) and coexisting single bars
    const sp = spacingReport(res.bars)
    expect(sp.bundles).toHaveLength(5)
    expect(sp.overlaps).toEqual([])
    expect(sp.minClearOk).toBe(true)

    // Verify expandLayerToUnits preserves counts and individual diameters
    const expanded = expandLayerToUnits(cfg.faces.top.layers[0])
    expect(expanded).toHaveLength(3)
    expect(expanded[0].dias).toEqual([25, 20, 16])
  })

  it('positions multi-layer reinforcement with spacer bars on all faces without adding spacer steel to As', () => {
    const geom = generateSection({ kind: 'rect', B: 500, D: 750, nx: 4, ny: 2 }, { cover: COVER_40, tieDia: TIE_8, barDia: 25 }).geometry
    const cfg = defaultRectAdvancedConfig({ spacerDia: 25, enabled: true })
    cfg.faces.left.enabled = false
    cfg.faces.right.enabled = false
    cfg.faces.bottom.layers = [
      defaultRectLayer({ nBars: 4, barDia: 25 }),
      defaultRectLayer({ nBars: 2, barDia: 20, horizontalAlign: 'stackFirst' }),
    ]
    cfg.faces.top.layers = [
      defaultRectLayer({ nBars: 3, barDia: 20 }),
      defaultRectLayer({ nBars: 2, barDia: 16, spacerDiaOverride: 28 }),
    ]

    const res = generateRectAdvancedRebar(cfg, geom, COVER_40, TIE_8)
    expect(res.issues).toEqual([])
    expect(res.spacers).toHaveLength(2)

    const botSpacer = res.spacers.find((s) => s.face === 'bottom')!
    const topSpacer = res.spacers.find((s) => s.face === 'top')!
    expect(botSpacer.dia).toBe(25)
    expect(botSpacer.clearGap).toBe(25)
    expect(topSpacer.dia).toBe(28)
    expect(topSpacer.clearGap).toBe(28)

    // Bottom L1 centre = 40 + 8 + 12.5 = 60.5; inner plane = 73.0
    // Spacer = 25 -> Bottom L2 outer plane = 98.0; Bottom L2 (Ø20) centre = 108.0 mm
    const botL1 = res.bars.filter((b) => b.face === 'bottom' && b.layer === 0)
    const botL2 = res.bars.filter((b) => b.face === 'bottom' && b.layer === 1)
    expect(botL1).toHaveLength(4)
    expect(botL2).toHaveLength(2)
    botL1.forEach((b) => expect(b.y).toBeCloseTo(60.5, 2))
    botL2.forEach((b) => expect(b.y).toBeCloseTo(108.0, 2))
    // Symmetric outer alignment stacks the 2 inner bars directly over the 2 corner bars!
    expect(botL2[0].x).toBeCloseTo(botL1[0].x, 2)
    expect(botL2[1].x).toBeCloseTo(botL1[3].x, 2)

    // Exact clear distance between stacked bars equals spacer diameter 25 mm!
    expect(clearDistance(botL1[0], botL2[0])).toBeCloseTo(25, 2)

    // Section properties count ONLY longitudinal bars (4×Ø25 + 2×Ø20 + 3×Ø20 + 2×Ø16), NEVER spacer rods!
    const props = sectionProperties(geom, res.bars)
    const expectedAsc = 4 * barArea(25) + 5 * barArea(20) + 2 * barArea(16)
    expect(props.barCount).toBe(11)
    expect(props.Asc).toBeCloseTo(expectedAsc, 4)
  })

  it('reports clear validation warnings for invalid layouts without silently modifying user inputs', () => {
    const geom = generateSection(RECT_DEF, { cover: COVER_40, tieDia: TIE_8, barDia: 25 }).geometry
    const cfg = defaultRectAdvancedConfig({ spacerDia: 12, enabled: true })
    // 1. Custom spacing 200 mm across 4 bars = 600 mm span > 450 mm width -> extends outside section!
    // 2. 5-bar bundle on Top -> exceeds 4-bar bundle code limit
    // 3. 12 mm spacer between Ø25 layers -> violates IS 456 Cl 26.3.2 vertical clear distance
    cfg.faces.bottom.layers = [
      defaultRectLayer({ nBars: 4, barDia: 25, spacing: 200 }),
      defaultRectLayer({ nBars: 2, barDia: 25 }),
    ]
    cfg.faces.top.layers = [
      defaultRectLayer({ kind: 'bundle', nBundles: 2, barsPerBundle: 5, barDia: 20 }),
    ]

    const res = generateRectAdvancedRebar(cfg, geom, COVER_40, TIE_8)
    const codes = res.issues.map((i) => i.code)
    expect(codes).toContain('outside')
    expect(codes).toContain('bundleSize')
    expect(codes).toContain('spacer')

    // User inputs remain completely untouched
    expect(cfg.faces.bottom.layers[0].spacing).toBe(200)
    expect(cfg.faces.top.layers[0].barsPerBundle).toBe(5)
    expect(cfg.spacerDia).toBe(12)
  })

  it('synchronizes generated bars across ULS, SLS, Crack Width, Shear, Project Export/Import, and Clipboard TSV', () => {
    const base = initialState()
    const cfgSmallSpacer = defaultRectAdvancedConfig({ spacerDia: 25, enabled: true })
    cfgSmallSpacer.faces.bottom.layers = [
      defaultRectLayer({ kind: 'alternate', nBars: 4, patternDias: [25, 20, 16, 25] }),
      defaultRectLayer({ nBars: 3, barDia: 20 }),
    ]
    const cfgLargeSpacer = {
      ...cfgSmallSpacer,
      spacerDia: 60,
    }

    const rSmall = generateRectAdvancedRebar(cfgSmallSpacer, base.geometry, base.cover, base.tieDia)
    const rLarge = generateRectAdvancedRebar(cfgLargeSpacer, base.geometry, base.cover, base.tieDia)

    // 1. Shear check: larger spacer pushes Layer 2 inward -> reduces effective depth d!
    const shSmall = shearSectionData(base.geometry, rSmall.bars, base.cover, DEFAULT_SHEAR)
    const shLarge = shearSectionData(base.geometry, rLarge.bars, base.cover, DEFAULT_SHEAR)
    expect(shSmall.Asl).toBeCloseTo(shLarge.Asl, 4)
    expect(shLarge.d).toBeLessThan(shSmall.d)
    const shearRes = shearCheck('IS456', 30, 500, base.geometry, rSmall.bars, base.cover, DEFAULT_SHEAR, base.shearCases[0])
    expect(shearRes.VRd).toBeGreaterThan(0)

    // 2. ULS P–Mx–My surface: larger spacer reduces flexural lever arm -> lowers uniaxial Mux1 capacity!
    const spec = CODES.IS456
    const grade = spec.steelGrades.find((g) => g.label === 'Fe500')!
    const propsS = sectionProperties(base.geometry, rSmall.bars)
    const propsL = sectionProperties(base.geometry, rLarge.bars)
    const surfS = generateSurface(
      buildAnalysisModel(
        { boundary: ensureCCW(base.geometry.boundary), voids: [] },
        rSmall.bars,
        { x: propsS.cx, y: propsS.cy },
        propsS.area,
        spec.concrete(30),
        spec.steel(grade.fy),
        spec.epsSteelLimit(grade),
      ),
      base.mesh,
    )
    const surfL = generateSurface(
      buildAnalysisModel(
        { boundary: ensureCCW(base.geometry.boundary), voids: [] },
        rLarge.bars,
        { x: propsL.cx, y: propsL.cy },
        propsL.area,
        spec.concrete(30),
        spec.steel(grade.fy),
        spec.epsSteelLimit(grade),
      ),
      base.mesh,
    )
    const ulsS = checkLoadCase(surfS, base.cases[1], spec, 30, grade.fy, propsS.area, propsS.Asc, 'rect')
    const ulsL = checkLoadCase(surfL, base.cases[1], spec, 30, grade.fy, propsL.area, propsL.Asc, 'rect')
    expect(ulsL.Mux1).toBeLessThan(ulsS.Mux1)

    // 3. SLS & Crack Width checks run cleanly with mixed-diameter layered bars
    const limits = slsMaterialLimits(30, 500, 25)
    const slsInp = { geometry: base.geometry, bars: rSmall.bars, ...limits }
    const slsMod = buildSlsModel(slsInp)
    const slsRes = slsStress(slsMod, slsInp, base.slsCases[0])!
    expect(slsRes.sigmaSt).toBeGreaterThan(0)
    const cw = crackWidthCheck('IS456', 30, slsMod, rSmall.bars, slsRes, {
      exposure: DEFAULT_EXPOSURE.IS456,
      longTerm: false,
    })!
    expect(Number.isFinite(cw.w)).toBe(true)

    // 4. Code compliance & Clipboard export & Project JSON round-trip
    const checks = complianceChecks(spec, {
      props: propsS,
      bars: rSmall.bars,
      geometry: base.geometry,
      fck: 30,
      fy: 500,
      cases: base.cases,
      shapeClass: 'rect',
      cover: base.cover,
      tieDia: base.tieDia,
    })
    expect(checks.some((c) => c.title === 'All bars inside concrete' && c.status === 'pass')).toBe(true)

    const clip = barCoordinatesText(rSmall.bars)!
    expect(clip.count).toBe(rSmall.bars.length)

    const savedState = { ...base, bars: rSmall.bars, rectRebar: cfgSmallSpacer }
    const restored = parseProjectFile(JSON.stringify({ version: '1.5', app: 'RCC Section Check', state: savedState }))
    expect(restored.rectRebar?.enabled).toBe(true)
    expect(restored.rectRebar?.spacerDia).toBe(25)
    expect(restored.rectRebar?.faces.bottom.layers[0].patternDias).toEqual([25, 20, 16, 25])
    expect(restored.bars).toHaveLength(rSmall.bars.length)

    // External section file import over an active advanced state cleanly disables old override
    const afterExternal = importProjectText(
      JSON.stringify({ sectionType: 'rect', B: 400, D: 500, nx: 3, ny: 2 }),
      restored,
    ).state
    expect(afterExternal.rectRebar?.enabled).toBe(false)
    expect(afterExternal.bars).toHaveLength(10)
  })
})
