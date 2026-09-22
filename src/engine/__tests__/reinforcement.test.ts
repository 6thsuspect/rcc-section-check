import { describe, expect, it } from 'vitest'
import { normalizeCover } from '../cover'
import { generateSection } from '../sections'
import { markBarsManual, repositionAutomaticBars, validateOuterCoverFit } from '../reinforcement'

const COVER = normalizeCover(40)

function rectBars(cover = COVER, dia = 25) {
  const generated = generateSection({ kind: 'rect', B: 400, D: 600, nx: 3, ny: 2 }, { cover, tieDia: 8, barDia: dia })
  return generated
}

describe('face-associated automatic reinforcement', () => {
  it('moves only the bars controlled by a changed face cover', () => {
    const generated = rectBars()
    const nextCover = normalizeCover({ outer: { bottom: 50, right: 60, top: 40, left: 40 } })
    const moved = repositionAutomaticBars(generated.bars, generated.geometry, generated.geometry, COVER, nextCover, 8, 8)

    // Bottom row follows bottom cover; the top row does not.
    expect(moved[0].y - generated.bars[0].y).toBeCloseTo(10, 6)
    expect(moved[3].y).toBeCloseTo(generated.bars[3].y, 6)
    // The right-hand corner follows the independent right cover.
    expect(moved[2].x - generated.bars[2].x).toBeCloseTo(-20, 6)
    // The middle bottom bar has no right/left corner association and remains
    // centred in the available run while both opposite covers are honoured.
    expect(moved[1].x).toBeCloseTo(190, 6)
  })

  it('recomputes the centreline when bar diameter changes', () => {
    const generated = rectBars()
    const smaller = generated.bars.map((bar) => ({ ...bar, dia: 16 }))
    const moved = repositionAutomaticBars(smaller, generated.geometry, generated.geometry, COVER, COVER, 8, 8)
    // At the left face: 40 + 8 + 16/2 = 56 mm centreline.
    expect(moved[0].x).toBeCloseTo(56, 6)
    expect(moved[0].y).toBeCloseTo(56, 6)
  })

  it('keeps an explicit manual row untouched', () => {
    const generated = rectBars()
    const manual = markBarsManual([{ ...generated.bars[0], x: 17, y: 19 }])
    const moved = repositionAutomaticBars(manual, generated.geometry, generated.geometry, COVER, normalizeCover(80), 8, 8)
    expect(moved[0].x).toBe(17)
    expect(moved[0].y).toBe(19)
    expect(moved[0].positioning).toBe('manual')
  })

  it('keeps a line layout attached when section dimensions change', () => {
    const generated = rectBars()
    const next = generateSection({ kind: 'rect', B: 500, D: 700, nx: 3, ny: 2 }, { cover: COVER, tieDia: 8, barDia: 25 })
    const moved = repositionAutomaticBars(generated.bars, generated.geometry, next.geometry, COVER, COVER, 8, 8)
    expect(moved[0].x).toBeCloseTo(next.bars[0].x, 6)
    expect(moved[0].y).toBeCloseTo(next.bars[0].y, 6)
    expect(moved[1].x).toBeCloseTo(next.bars[1].x, 6)
  })

  it('updates bars lining an internal void from the void-face covers', () => {
    const def = { kind: 'box' as const, B: 1200, D: 1200, tw: 250, tf: 250, nx: 5, ny: 3 }
    const generated = generateSection(def, { cover: COVER, tieDia: 8, barDia: 25 })
    const nextCover = normalizeCover({
      outer: COVER.outer,
      inner: { bottom: 50, right: 60, top: 45, left: 35 },
    })
    const moved = repositionAutomaticBars(generated.bars, generated.geometry, generated.geometry, COVER, nextCover, 8, 8)
    const next = generateSection(def, { cover: nextCover, tieDia: 8, barDia: 25 })
    const innerIndex = generated.bars.findIndex((bar) => bar.surface === 'inner' && bar.face === 'bottom')
    expect(innerIndex).toBeGreaterThanOrEqual(0)
    expect(moved[innerIndex].y).toBeCloseTo(next.bars[innerIndex].y, 6)

    const geometry = { boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], voids: [] }
    const cover = normalizeCover({ outer: { bottom: 40, right: 40, top: 40, left: 40 } })
    const issues = validateOuterCoverFit(geometry, [{ x: 50, y: 50, dia: 25 }], cover, 8)
    expect(issues.map((issue) => issue.axis)).toEqual(['width', 'height'])
    expect(issues[0].required).toBe(121)
  })
})
