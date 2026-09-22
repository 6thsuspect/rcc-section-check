import { centroid } from './geometry'
import {
  barOffset,
  coverAt,
  findNearestFace,
  getCoverForFace,
  radialCover,
  type CoverFace,
  type CoverSpec,
} from './cover'
import type { Point, Rebar, RebarSurface, SectionGeometry } from './types'

/** A bar is eligible for live placement updates only when it is explicitly automatic. */
export function isAutomaticBar(bar: Rebar): boolean {
  return bar.positioning === 'automatic'
}

/** Mark coordinate-table edits as intentional manual overrides. */
export function markBarsManual(bars: Rebar[]): Rebar[] {
  return bars.map((bar) => ({ ...bar, positioning: 'manual' as const }))
}

/** Mark a generated layout as cover/geometry driven. */
export function markBarsAutomatic(bars: Rebar[]): Rebar[] {
  return bars.map((bar) => ({ ...bar, positioning: 'automatic' as const }))
}

function bounds(poly: Point[]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  if (poly.length === 0) return null
  return {
    xmin: Math.min(...poly.map((p) => p.x)),
    xmax: Math.max(...poly.map((p) => p.x)),
    ymin: Math.min(...poly.map((p) => p.y)),
    ymax: Math.max(...poly.map((p) => p.y)),
  }
}

function placementPolygon(
  geometry: SectionGeometry,
  surface: RebarSurface,
  voidIndex: number | undefined,
): Point[] | null {
  if (surface === 'outer') return geometry.boundary
  const index = voidIndex ?? 0
  return geometry.voids[index] ?? geometry.voids[0] ?? null
}

function facesOf(bar: Rebar): CoverFace[] {
  const values = bar.faces?.length ? bar.faces : bar.face ? [bar.face] : []
  return [...new Set(values)]
}

function coverOffset(cover: CoverSpec, face: CoverFace, surface: RebarSurface, tieDia: number, dia: number): number {
  return barOffset(coverAt(cover, face, surface), tieDia, dia)
}

/**
 * Effective radial distance of the polygon used by a circular generated layout.
 */
function radialLimit(geometry: SectionGeometry, surface: RebarSurface, voidIndex?: number): number | null {
  const poly = placementPolygon(geometry, surface, voidIndex)
  if (!poly || poly.length === 0) return null
  const c = centroid(geometry.boundary)
  const radii = poly.map((p) => Math.hypot(p.x - c.x, p.y - c.y))
  return surface === 'outer' ? Math.max(...radii) : Math.min(...radii)
}

function repositionRadial(
  bar: Rebar,
  oldGeometry: SectionGeometry,
  newGeometry: SectionGeometry,
  oldCover: CoverSpec,
  newCover: CoverSpec,
  oldTieDia: number,
  newTieDia: number,
): Rebar {
  const oldCentre = centroid(oldGeometry.boundary)
  const newCentre = centroid(newGeometry.boundary)
  const surface = bar.surface ?? 'outer'
  const oldLimit = radialLimit(oldGeometry, surface, bar.voidIndex)
  const newLimit = radialLimit(newGeometry, surface, bar.voidIndex)
  if (oldLimit == null || newLimit == null) return bar

  const oldGovern = radialCover(oldCover, surface)
  const newGovern = radialCover(newCover, surface)
  const oldRadius =
    surface === 'outer'
      ? oldLimit - barOffset(oldGovern, oldTieDia, bar.dia)
      : oldLimit + barOffset(oldGovern, oldTieDia, bar.dia)
  const newRadius =
    surface === 'outer'
      ? newLimit - barOffset(newGovern, newTieDia, bar.dia)
      : newLimit + barOffset(newGovern, newTieDia, bar.dia)

  const vx = bar.x - oldCentre.x
  const vy = bar.y - oldCentre.y
  const r = Math.hypot(vx, vy)
  if (r < 1e-9) return { ...bar, x: newCentre.x, y: newCentre.y }

  const scale = Math.max(0, newRadius) / Math.max(1e-9, oldRadius || r)
  return {
    ...bar,
    x: Math.round((newCentre.x + vx * scale) * 100) / 100,
    y: Math.round((newCentre.y + vy * scale) * 100) / 100,
  }
}

function setFaceCoordinate(
  point: { x: number; y: number },
  face: CoverFace,
  polygonBounds: ReturnType<typeof bounds>,
  cover: CoverSpec,
  surface: RebarSurface,
  tieDia: number,
  dia: number,
): void {
  if (!polygonBounds) return
  const offset = coverOffset(cover, face, surface, tieDia, dia)
  const sign = surface === 'inner' ? -1 : 1
  if (face === 'left') point.x = polygonBounds.xmin + sign * offset
  if (face === 'right') point.x = polygonBounds.xmax - sign * offset
  if (face === 'bottom') point.y = polygonBounds.ymin + sign * offset
  if (face === 'top') point.y = polygonBounds.ymax - sign * offset
}

function lineRange(
  bar: Rebar,
  polygonBounds: ReturnType<typeof bounds>,
  cover: CoverSpec,
  surface: RebarSurface,
  tieDia: number,
): { start: number; end: number } | null {
  if (!polygonBounds || bar.u == null || !bar.axis) return null
  const dia = bar.dia
  if (bar.axis === 'x') {
    const left = coverOffset(cover, 'left', surface, tieDia, dia)
    const right = coverOffset(cover, 'right', surface, tieDia, dia)
    return {
      start: surface === 'inner' ? polygonBounds.xmin - left : polygonBounds.xmin + left,
      end: surface === 'inner' ? polygonBounds.xmax + right : polygonBounds.xmax - right,
    }
  }
  const bottom = coverOffset(cover, 'bottom', surface, tieDia, dia)
  const top = coverOffset(cover, 'top', surface, tieDia, dia)
  return {
    start: surface === 'inner' ? polygonBounds.ymin - bottom : polygonBounds.ymin + bottom,
    end: surface === 'inner' ? polygonBounds.ymax + top : polygonBounds.ymax - top,
  }
}

/**
 * Recalculate coordinates for all explicitly automatic bars.
 * Cover, link diameter and bar diameter are inputs to the calculation.
 * Works for axis-aligned rectangular sections as well as generic polygonal
 * sections with arbitrary inclined/sloped faces and hollow inner faces.
 */
export function repositionAutomaticBars(
  bars: Rebar[],
  oldGeometry: SectionGeometry,
  newGeometry: SectionGeometry,
  oldCover: CoverSpec,
  newCover: CoverSpec,
  oldTieDia: number,
  newTieDia: number,
): Rebar[] {
  return bars.map((bar) => {
    if (!isAutomaticBar(bar)) return bar
    if (bar.radial) {
      return repositionRadial(bar, oldGeometry, newGeometry, oldCover, newCover, oldTieDia, newTieDia)
    }

    const surface: RebarSurface = bar.surface ?? 'outer'
    const voidIndex = bar.voidIndex ?? 0

    let f1 = bar.faceIndex
    let f2 = bar.secondaryFaceIndex

    if (f1 === undefined) {
      const nfOld = findNearestFace(bar, oldGeometry, oldCover, bar)
      if (nfOld) {
        f1 = nfOld.faceIndex
      }
    }

    if (f1 === undefined) {
      // Fallback for legacy rectangular 4-face handling
      const faces = facesOf(bar)
      const newPoly = placementPolygon(newGeometry, surface, voidIndex)
      const newBounds = bounds(newPoly ?? [])
      const p = { x: bar.x, y: bar.y }

      const range = lineRange(bar, newBounds, newCover, surface, newTieDia)
      if (range && bar.axis === 'x') p.x = range.start + (range.end - range.start) * Math.max(0, Math.min(1, bar.u ?? 0.5))
      if (range && bar.axis === 'y') p.y = range.start + (range.end - range.start) * Math.max(0, Math.min(1, bar.u ?? 0.5))

      for (const face of faces) {
        if (bar.axis === 'x' && (face === 'left' || face === 'right')) continue
        if (bar.axis === 'y' && (face === 'bottom' || face === 'top')) continue
        setFaceCoordinate(p, face, newBounds, newCover, surface, newTieDia, bar.dia)
      }

      return {
        ...bar,
        x: Number.isFinite(p.x) ? Math.round(p.x * 100) / 100 : bar.x,
        y: Number.isFinite(p.y) ? Math.round(p.y * 100) / 100 : bar.y,
      }
    }

    const poly = surface === 'inner' ? newGeometry.voids[voidIndex] : newGeometry.boundary
    if (!poly || poly.length < 3) return bar

    const N = poly.length
    const p1 = poly[f1 % N]
    const p2 = poly[(f1 + 1) % N]

    const c1New = getCoverForFace(newCover, surface, f1, voidIndex, newGeometry)
    const off1New = barOffset(c1New, newTieDia, bar.dia)

    let px = bar.x
    let py = bar.y

    const isH1 = Math.abs(p2.y - p1.y) < 1e-4
    const isV1 = Math.abs(p2.x - p1.x) < 1e-4

    if (isH1) {
      const yE1 = p1.y
      const signY1 = bar.y >= yE1 ? 1 : -1
      py = yE1 + signY1 * off1New

      if (f2 !== undefined) {
        const q1 = poly[f2 % N]
        const q2 = poly[(f2 + 1) % N]
        if (Math.abs(q2.x - q1.x) < 1e-4) {
          const xE2 = q1.x
          const signX2 = bar.x >= xE2 ? 1 : -1
          const c2New = getCoverForFace(newCover, surface, f2, voidIndex, newGeometry)
          const off2New = barOffset(c2New, newTieDia, bar.dia)
          px = xE2 + signX2 * off2New
        }
      } else if (bar.axis === 'x' && bar.u !== undefined) {
        if (bar.startFaceIndex !== undefined && bar.endFaceIndex !== undefined) {
          const s1 = poly[bar.startFaceIndex % N]
          const e1 = poly[bar.endFaceIndex % N]
          const cStart = getCoverForFace(newCover, surface, bar.startFaceIndex, voidIndex, newGeometry)
          const cEnd = getCoverForFace(newCover, surface, bar.endFaceIndex, voidIndex, newGeometry)
          const offStart = barOffset(cStart, newTieDia, bar.dia)
          const offEnd = barOffset(cEnd, newTieDia, bar.dia)

          const signXStart = bar.x >= s1.x ? 1 : -1
          const signXEnd = bar.x >= e1.x ? 1 : -1

          const xStart = s1.x + signXStart * offStart
          const xEnd = e1.x + signXEnd * offEnd

          px = xStart + bar.u * (xEnd - xStart)
        } else {
          const boundsNew = bounds(poly)
          if (boundsNew) {
            let cLeft = getCoverForFace(newCover, surface, 3, voidIndex, newGeometry)
            let cRight = getCoverForFace(newCover, surface, 1, voidIndex, newGeometry)

            if (N !== 4) {
              for (let k = 0; k < N; k++) {
                const eA = poly[k]
                const eB = poly[(k + 1) % N]
                if (Math.abs(eA.x - eB.x) < 1e-4) {
                  if (Math.abs(eA.x - boundsNew.xmin) < 1e-4) {
                    cLeft = getCoverForFace(newCover, surface, k, voidIndex, newGeometry)
                  }
                  if (Math.abs(eA.x - boundsNew.xmax) < 1e-4) {
                    cRight = getCoverForFace(newCover, surface, k, voidIndex, newGeometry)
                  }
                }
              }
            }

            const offLeft = barOffset(cLeft, newTieDia, bar.dia)
            const offRight = barOffset(cRight, newTieDia, bar.dia)

            const xStart = surface === 'inner' ? boundsNew.xmin - offLeft : boundsNew.xmin + offLeft
            const xEnd = surface === 'inner' ? boundsNew.xmax + offRight : boundsNew.xmax - offRight

            px = xStart + bar.u * (xEnd - xStart)
          }
        }
      }
    } else if (isV1) {
      const xE1 = p1.x
      const signX1 = bar.x >= xE1 ? 1 : -1
      px = xE1 + signX1 * off1New

      if (f2 !== undefined) {
        const q1 = poly[f2 % N]
        const q2 = poly[(f2 + 1) % N]
        if (Math.abs(q2.y - q1.y) < 1e-4) {
          const yE2 = q1.y
          const signY2 = bar.y >= yE2 ? 1 : -1
          const c2New = getCoverForFace(newCover, surface, f2, voidIndex, newGeometry)
          const off2New = barOffset(c2New, newTieDia, bar.dia)
          py = yE2 + signY2 * off2New
        }
      } else if (bar.axis === 'y' && bar.u !== undefined) {
        if (bar.startFaceIndex !== undefined && bar.endFaceIndex !== undefined) {
          const s1 = poly[bar.startFaceIndex % N]
          const e1 = poly[bar.endFaceIndex % N]
          const cStart = getCoverForFace(newCover, surface, bar.startFaceIndex, voidIndex, newGeometry)
          const cEnd = getCoverForFace(newCover, surface, bar.endFaceIndex, voidIndex, newGeometry)
          const offStart = barOffset(cStart, newTieDia, bar.dia)
          const offEnd = barOffset(cEnd, newTieDia, bar.dia)

          const signYStart = bar.y >= s1.y ? 1 : -1
          const signYEnd = bar.y >= e1.y ? 1 : -1

          const yStart = s1.y + signYStart * offStart
          const yEnd = e1.y + signYEnd * offEnd

          py = yStart + bar.u * (yEnd - yStart)
        } else {
          const boundsNew = bounds(poly)
          if (boundsNew) {
            let cBottom = getCoverForFace(newCover, surface, 0, voidIndex, newGeometry)
            let cTop = getCoverForFace(newCover, surface, 2, voidIndex, newGeometry)

            if (N !== 4) {
              for (let k = 0; k < N; k++) {
                const eA = poly[k]
                const eB = poly[(k + 1) % N]
                if (Math.abs(eA.y - eB.y) < 1e-4) {
                  if (Math.abs(eA.y - boundsNew.ymin) < 1e-4) {
                    cBottom = getCoverForFace(newCover, surface, k, voidIndex, newGeometry)
                  }
                  if (Math.abs(eA.y - boundsNew.ymax) < 1e-4) {
                    cTop = getCoverForFace(newCover, surface, k, voidIndex, newGeometry)
                  }
                }
              }
            }

            const offBottom = barOffset(cBottom, newTieDia, bar.dia)
            const offTop = barOffset(cTop, newTieDia, bar.dia)

            const yStart = surface === 'inner' ? boundsNew.ymin - offBottom : boundsNew.ymin + offBottom
            const yEnd = surface === 'inner' ? boundsNew.ymax + offTop : boundsNew.ymax - offTop

            py = yStart + bar.u * (yEnd - yStart)
          }
        }
      }
    } else {
      // Inclined edge
      const c1Old = getCoverForFace(oldCover, surface, f1, voidIndex, oldGeometry)
      const off1Old = barOffset(c1Old, oldTieDia, bar.dia)
      const shift = off1New - off1Old

      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      // Determine sign towards bar
      const dot = (bar.x - p1.x) * nx + (bar.y - p1.y) * ny
      const sign = dot >= 0 ? 1 : -1

      px = bar.x + sign * nx * shift
      py = bar.y + sign * ny * shift
    }

    return {
      ...bar,
      faceIndex: f1,
      secondaryFaceIndex: f2,
      surface,
      voidIndex,
      x: Number.isFinite(px) ? Math.round(px * 100) / 100 : bar.x,
      y: Number.isFinite(py) ? Math.round(py * 100) / 100 : bar.y,
    }
  })
}

/** Human-readable description used by validation banners and tests. */
export interface CoverFitIssue {
  axis: 'width' | 'height' | 'face'
  available: number
  required: number
  message: string
}

/**
 * Conservative physical-fit screen for section face covers.
 */
export function validateOuterCoverFit(
  geometry: SectionGeometry,
  bars: Rebar[],
  cover: CoverSpec,
  tieDia: number,
): CoverFitIssue[] {
  if (bars.length === 0 || geometry.boundary.length < 3) return []
  const b = bounds(geometry.boundary)
  if (!b) return []
  const diameters = bars.map((bar) => bar.dia).filter((dia): dia is number => Number.isFinite(dia) && dia > 0)
  if (diameters.length === 0) return []
  const dia = Math.max(...diameters)

  const leftC = getCoverForFace(cover, 'outer', 3, 0, geometry)
  const rightC = getCoverForFace(cover, 'outer', 1, 0, geometry)
  const bottomC = getCoverForFace(cover, 'outer', 0, 0, geometry)
  const topC = getCoverForFace(cover, 'outer', 2, 0, geometry)

  const requiredWidth = leftC + rightC + 2 * Math.max(0, tieDia) + dia
  const requiredHeight = bottomC + topC + 2 * Math.max(0, tieDia) + dia
  const out: CoverFitIssue[] = []

  if (b.xmax - b.xmin < requiredWidth - 1e-9) {
    out.push({
      axis: 'width',
      available: b.xmax - b.xmin,
      required: requiredWidth,
      message: `Outer width ${(b.xmax - b.xmin).toFixed(1)} mm is less than the required ${requiredWidth.toFixed(1)} mm (left cover + right cover + two ⌀${Math.max(0, tieDia).toFixed(0)} links + ⌀${dia.toFixed(1)} bar).`,
    })
  }
  if (b.ymax - b.ymin < requiredHeight - 1e-9) {
    out.push({
      axis: 'height',
      available: b.ymax - b.ymin,
      required: requiredHeight,
      message: `Outer height ${(b.ymax - b.ymin).toFixed(1)} mm is less than the required ${requiredHeight.toFixed(1)} mm (bottom cover + top cover + two ⌀${Math.max(0, tieDia).toFixed(0)} links + ⌀${dia.toFixed(1)} bar).`,
    })
  }
  return out
}
