import { describe, expect, it } from 'vitest'
import {
  auditCovers,
  detectSectionType,
  findNearestFace,
  formatCover,
  getCoverForFace,
  normalizeCover,
  setInnerFaceCover,
  setOuterFaceCover,
  setUniformInnerCover,
  setUniformOuterCover,
  snapBarsToCover,
  uniformCover,
} from '../cover'
import { defaultPredefined, generateSection } from '../sections'
import { repositionAutomaticBars } from '../reinforcement'
import type { Rebar, SectionGeometry } from '../types'

describe('Face-Based Clear Cover & Automatic Rebar Reassignment', () => {
  describe('Section Type Detection', () => {
    it('detects rectangular sections', () => {
      const rectGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 600 },
          { x: 0, y: 600 },
        ],
        voids: [],
      }
      expect(detectSectionType(rectGeo, defaultPredefined('rect'), 'rect')).toBe('rectangular')
    })

    it('detects solid circle sections', () => {
      const circleDef = defaultPredefined('circle')
      const gen = generateSection(circleDef, { cover: 40, tieDia: 8, barDia: 20 })
      expect(detectSectionType(gen.geometry, circleDef, 'circ')).toBe('circle')
    })

    it('detects hollow circle sections', () => {
      const hCircleDef = defaultPredefined('hollowCircle')
      const gen = generateSection(hCircleDef, { cover: 40, tieDia: 8, barDia: 20 })
      expect(detectSectionType(gen.geometry, hCircleDef, 'circ')).toBe('hollow-circle')
    })

    it('detects non-rectangular polygon sections (triangle, pentagon, hexagon, Tee, L-shape)', () => {
      const triGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 150, y: 400 },
        ],
        voids: [],
      }
      expect(detectSectionType(triGeo, null, 'rect')).toBe('polygon')

      const teeDef = defaultPredefined('tee')
      const genTee = generateSection(teeDef, { cover: 40, tieDia: 8, barDia: 20 })
      expect(detectSectionType(genTee.geometry, teeDef, 'rect')).toBe('polygon')
    })

    it('detects hollow polygonal sections (box, hollow polygon)', () => {
      const boxDef = defaultPredefined('box')
      const genBox = generateSection(boxDef, { cover: 40, tieDia: 8, barDia: 20 })
      expect(detectSectionType(genBox.geometry, boxDef, 'rect')).toBe('hollow-polygon')
    })
  })

  describe('Polygon Face Cover Inputs & Management', () => {
    it('supports arbitrary N outer faces dynamically', () => {
      const pentagonGeo: SectionGeometry = {
        boundary: [
          { x: 200, y: 0 },
          { x: 400, y: 150 },
          { x: 300, y: 400 },
          { x: 100, y: 400 },
          { x: 0, y: 150 },
        ],
        voids: [],
      }
      let c = normalizeCover(40, uniformCover(40), pentagonGeo)
      expect(c.outerFaces?.length).toBe(5)

      c = setOuterFaceCover(c, 2, 60, pentagonGeo)
      expect(getCoverForFace(c, 'outer', 2, 0, pentagonGeo)).toBe(60)
      expect(getCoverForFace(c, 'outer', 0, 0, pentagonGeo)).toBe(40)
    })

    it('supports separate inner and outer faces for hollow polygons', () => {
      const hollowGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 500 },
          { x: 0, y: 500 },
        ],
        voids: [
          [
            { x: 100, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 400 },
            { x: 100, y: 400 },
          ],
        ],
      }
      let c = normalizeCover(40, uniformCover(40), hollowGeo)
      c = setOuterFaceCover(c, 0, 45, hollowGeo)
      c = setInnerFaceCover(c, 1, 55, 0, hollowGeo)

      expect(getCoverForFace(c, 'outer', 0, 0, hollowGeo)).toBe(45)
      expect(getCoverForFace(c, 'inner', 1, 0, hollowGeo)).toBe(55)
    })

    it('supports solid circular uniform cover and hollow circular inner/outer uniform cover', () => {
      let c = uniformCover(40)
      c = setUniformOuterCover(c, 50)
      expect(getCoverForFace(c, 'outer', 0)).toBe(50)

      c = setUniformInnerCover(c, 35)
      expect(getCoverForFace(c, 'inner', 0)).toBe(35)
    })
  })

  describe('Nearest Face Algorithm on Inclined & Arbitrary Polygonal Faces', () => {
    it('measures perpendicular distance to inclined face', () => {
      // Triangle with inclined edge (300,0) -> (0, 300)
      const triGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 0, y: 300 },
        ],
        voids: [],
      }
      const p = { x: 100, y: 100 }
      const nf = findNearestFace(p, triGeo)
      expect(nf).not.toBeNull()
      expect(nf!.faceIndex).toBe(1) // segment 1: (300,0)->(0,300)
      expect(nf!.dist).toBeCloseTo(70.71, 1)

      // Vector ux, uy points normal to inclined edge into concrete
      expect(Math.hypot(nf!.ux, nf!.uy)).toBeCloseTo(1.0, 5)
    })

    it('identifies inner void faces accurately', () => {
      const boxGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 1000 },
          { x: 0, y: 1000 },
        ],
        voids: [
          [
            { x: 200, y: 200 },
            { x: 800, y: 200 },
            { x: 800, y: 800 },
            { x: 200, y: 800 },
          ],
        ],
      }
      const p = { x: 500, y: 150 }
      const nf = findNearestFace(p, boxGeo)
      expect(nf).not.toBeNull()
      expect(nf!.surface).toBe('inner')
      expect(nf!.dist).toBeCloseTo(50, 1)
      expect(nf!.faceName).toContain('Inner Face 1')
    })
  })

  describe('Automatic Rebar Reassignment & Movement Isolation', () => {
    it('repositions bar perpendicular to inclined face when inclined face cover changes', () => {
      const triGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 0, y: 400 },
        ],
        voids: [],
      }
      const oldCover = normalizeCover(40, uniformCover(40), triGeo)
      // Initial bar placed at 40 mm cover (offset 58 mm) from inclined face
      const bar: Rebar = { x: 158.99, y: 158.99, dia: 20, positioning: 'automatic' }
      const bars: Rebar[] = [bar]

      // Change cover of inclined face (Face 2, index 1) from 40 to 60 mm (offset 78 mm)
      const newCover = setOuterFaceCover(oldCover, 1, 60, triGeo)
      const moved = repositionAutomaticBars(bars, triGeo, triGeo, oldCover, newCover, 8, 8)

      const distOld = findNearestFace(bar, triGeo, oldCover)!.dist
      const distNew = findNearestFace(moved[0], triGeo, newCover)!.dist
      expect(distNew - distOld).toBeCloseTo(20, 1)
    })

    it('verifies changing one face cover only affects relevant rebar and does not move other bars', () => {
      const rectGeo: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 500 },
          { x: 0, y: 500 },
        ],
        voids: [],
      }
      const oldCover = normalizeCover(40, uniformCover(40), rectGeo)
      const bars: Rebar[] = [
        { x: 250, y: 58, dia: 20, positioning: 'automatic' }, // near bottom face
        { x: 250, y: 442, dia: 20, positioning: 'automatic' }, // near top face
      ]

      // Change bottom cover (index 0) from 40 to 60 mm
      const newCover = setOuterFaceCover(oldCover, 0, 60, rectGeo)
      const moved = repositionAutomaticBars(bars, rectGeo, rectGeo, oldCover, newCover, 8, 8)

      // Bottom bar moves by +20 mm in Y direction
      expect(moved[0].y - bars[0].y).toBeCloseTo(20, 1)
      // Top bar stays at its exact position!
      expect(moved[1].y).toBeCloseTo(bars[1].y, 1)
      expect(moved[1].x).toBeCloseTo(bars[1].x, 1)
    })
  })

  describe('Backward Compatibility & Old Projects', () => {
    it('loads legacy project files with flat top/bottom/left/right covers without error', () => {
      const legacyRaw = {
        bottom: 35,
        right: 40,
        top: 45,
        left: 50,
      }
      const c = normalizeCover(legacyRaw)
      expect(c.outer.bottom).toBe(35)
      expect(c.outer.right).toBe(40)
      expect(c.outer.top).toBe(45)
      expect(c.outer.left).toBe(50)
      expect(formatCover(c)).toContain('bottom 35 · right 40 · top 45 · left 50 mm')
    })
  })

  describe('Audit & Snap Validation', () => {
    it('audits cover for irregular polygons and snaps short bars', () => {
      const hexGeo: SectionGeometry = {
        boundary: [
          { x: 100, y: 0 },
          { x: 300, y: 0 },
          { x: 400, y: 200 },
          { x: 300, y: 400 },
          { x: 100, y: 400 },
          { x: 0, y: 200 },
        ],
        voids: [],
      }
      const c = normalizeCover(40, uniformCover(40), hexGeo)
      const shortBar: Rebar = { x: 200, y: 20, dia: 20 }
      const audit = auditCovers([shortBar], hexGeo, c, 8)

      expect(audit.nShort).toBe(1)
      expect(audit.worst?.ok).toBe(false)

      const snapped = snapBarsToCover([shortBar], hexGeo, c, 8)
      expect(snapped.moved).toBe(1)
      const auditAfter = auditCovers(snapped.bars, hexGeo, c, 8)
      expect(auditAfter.nShort).toBe(0)
    })
  })

  describe('Section Specific Face Cover & Rebar Isolation (T-section, I-section, L-section, Box)', () => {
    it('applies exact T-section face isolation on cover updates', () => {
      const teeDef = defaultPredefined('tee')
      const gen = generateSection(teeDef, { cover: 40, tieDia: 8, barDia: 20 })
      const oldCover = normalizeCover(40, uniformCover(40), gen.geometry)

      // Changing Face 1 (idx 0) ONLY changes Face 1
      const c1 = setOuterFaceCover(oldCover, 0, 60, gen.geometry)
      expect(getCoverForFace(c1, 'outer', 0, 0, gen.geometry)).toBe(60) // Face 1
      expect(getCoverForFace(c1, 'outer', 1, 0, gen.geometry)).toBe(40) // Face 2 unchanged
      expect(getCoverForFace(c1, 'outer', 2, 0, gen.geometry)).toBe(40) // Face 3 unchanged
      expect(getCoverForFace(c1, 'outer', 3, 0, gen.geometry)).toBe(40) // Face 4 unchanged
      expect(getCoverForFace(c1, 'outer', 4, 0, gen.geometry)).toBe(40) // Face 5 unchanged
      expect(getCoverForFace(c1, 'outer', 5, 0, gen.geometry)).toBe(40) // Face 6 unchanged
      expect(getCoverForFace(c1, 'outer', 6, 0, gen.geometry)).toBe(40) // Face 7 unchanged
      expect(getCoverForFace(c1, 'outer', 7, 0, gen.geometry)).toBe(40) // Face 8 unchanged

      // Changing Face 2 (idx 1) ONLY changes Face 2
      const c2 = setOuterFaceCover(oldCover, 1, 55, gen.geometry)
      expect(getCoverForFace(c2, 'outer', 1, 0, gen.geometry)).toBe(55) // Face 2
      expect(getCoverForFace(c2, 'outer', 0, 0, gen.geometry)).toBe(40) // Face 1 unchanged
      expect(getCoverForFace(c2, 'outer', 3, 0, gen.geometry)).toBe(40) // Face 4 unchanged
    })

    it('verifies T-section rebar repositioning isolation', () => {
      const teeDef = defaultPredefined('tee')
      const gen = generateSection(teeDef, { cover: 40, tieDia: 8, barDia: 20 })
      const oldCover = normalizeCover(40, uniformCover(40), gen.geometry)

      // Change Face 5 (top flange, idx 4) from 40 to 60 mm
      const newCover = setOuterFaceCover(oldCover, 4, 60, gen.geometry)
      const moved = repositionAutomaticBars(gen.bars, gen.geometry, gen.geometry, oldCover, newCover, 8, 8)

      // Top flange bars (faceIndex 4) move down by 20 mm
      const topBars = gen.bars.filter((b) => b.faceIndex === 4)
      const movedTopBars = moved.filter((b) => b.faceIndex === 4)
      topBars.forEach((tb, i) => {
        expect(movedTopBars[i].y - tb.y).toBeCloseTo(-20, 1)
      })

      // Web left/right bars (faceIndex 7 & 1) do not move
      const webLeftBars = gen.bars.filter((b) => b.faceIndex === 7)
      const movedWebLeftBars = moved.filter((b) => b.faceIndex === 7)
      webLeftBars.forEach((wb, i) => {
        expect(movedWebLeftBars[i].x).toBeCloseTo(wb.x, 1)
        expect(movedWebLeftBars[i].y).toBeCloseTo(wb.y, 1)
      })
    })

    it('verifies I-section rebar movement isolation', () => {
      const iDef = defaultPredefined('ishape')
      const gen = generateSection(iDef, { cover: 40, tieDia: 8, barDia: 20 })
      const oldCover = normalizeCover(40, uniformCover(40), gen.geometry)

      // Change top flange face (Face 7, idx 6) cover from 40 to 60 mm
      const newCover = setOuterFaceCover(oldCover, 6, 60, gen.geometry)
      const moved = repositionAutomaticBars(gen.bars, gen.geometry, gen.geometry, oldCover, newCover, 8, 8)

      // Top flange bars move down
      const topBars = gen.bars.filter((b) => b.faceIndex === 6)
      const movedTopBars = moved.filter((b) => b.faceIndex === 6)
      topBars.forEach((tb, i) => {
        expect(movedTopBars[i].y - tb.y).toBeCloseTo(-20, 1)
      })

      // Bottom flange bars (faceIndex 0) do NOT move
      const bottomBars = gen.bars.filter((b) => b.faceIndex === 0)
      const movedBottomBars = moved.filter((b) => b.faceIndex === 0)
      bottomBars.forEach((bb, i) => {
        expect(movedBottomBars[i].y).toBeCloseTo(bb.y, 1)
        expect(movedBottomBars[i].x).toBeCloseTo(bb.x, 1)
      })
    })

    it('verifies Angle / L-section rebar movement isolation', () => {
      const angleDef = defaultPredefined('angle')
      const gen = generateSection(angleDef, { cover: 40, tieDia: 8, barDia: 20 })
      const oldCover = normalizeCover(40, uniformCover(40), gen.geometry)

      // Change bottom outer face (Face 1, idx 0) cover from 40 to 60 mm
      const newCover = setOuterFaceCover(oldCover, 0, 60, gen.geometry)
      const moved = repositionAutomaticBars(gen.bars, gen.geometry, gen.geometry, oldCover, newCover, 8, 8)

      // Bottom face bars move up by 20 mm
      const bottomBars = gen.bars.filter((b) => b.faceIndex === 0)
      const movedBottomBars = moved.filter((b) => b.faceIndex === 0)
      bottomBars.forEach((bb, i) => {
        expect(movedBottomBars[i].y - bb.y).toBeCloseTo(20, 1)
      })

      // Top flange bars (faceIndex 2) do NOT move in Y or X when bottom cover changes
      const topFlangeBars = gen.bars.filter((b) => b.faceIndex === 2)
      const movedTopFlangeBars = moved.filter((b) => b.faceIndex === 2)
      topFlangeBars.forEach((tb, i) => {
        expect(movedTopFlangeBars[i].x).toBeCloseTo(tb.x, 1)
        expect(movedTopFlangeBars[i].y).toBeCloseTo(tb.y, 1)
      })
    })

    it('verifies Box-section outer and inner rebar movement isolation', () => {
      const boxDef = defaultPredefined('box')
      const gen = generateSection(boxDef, { cover: 40, tieDia: 8, barDia: 20 })
      const oldCover = normalizeCover(40, uniformCover(40), gen.geometry)

      // Change inner bottom face (void soffit) cover from 40 to 60 mm
      const newCover = setInnerFaceCover(oldCover, 0, 60, 0, gen.geometry)
      const moved = repositionAutomaticBars(gen.bars, gen.geometry, gen.geometry, oldCover, newCover, 8, 8)

      // Inner bottom bars move down by 20 mm
      const innerBottomBars = gen.bars.filter((b) => b.surface === 'inner' && b.faceIndex === 0)
      const movedInnerBottomBars = moved.filter((b) => b.surface === 'inner' && b.faceIndex === 0)
      innerBottomBars.forEach((ib, i) => {
        expect(movedInnerBottomBars[i].y - ib.y).toBeCloseTo(-20, 1)
      })

      // Outer bottom bars (surface === 'outer', faceIndex === 0) do NOT move
      const outerBottomBars = gen.bars.filter((b) => b.surface === 'outer' && b.faceIndex === 0)
      const movedOuterBottomBars = moved.filter((b) => b.surface === 'outer' && b.faceIndex === 0)
      outerBottomBars.forEach((ob, i) => {
        expect(movedOuterBottomBars[i].y).toBeCloseTo(ob.y, 1)
        expect(movedOuterBottomBars[i].x).toBeCloseTo(ob.x, 1)
      })
    })
  })
})
