import { centroid } from './geometry'
import {
  barOffset,
  coverAt,
  outerCover,
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

function hasFace(faces: CoverFace[], face: CoverFace): boolean {
  return faces.includes(face)
}

/**
 * Effective radial distance of the polygon used by a circular generated layout.
 * The predefined circular boundaries are regular polygons, so a vertex radius
 * is a stable and conservative section radius for the generated rings.
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

  // Scaling the complete local vector (rather than replacing every bar by one
  // radius) preserves the tangent offsets of bundles and triple-bar groups.
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
    // A horizontal reinforcement run is bounded by the two vertical concrete
    // faces even when its endpoint bars are not part of this particular layer.
    const left = coverOffset(cover, 'left', surface, tieDia, dia)
    const right = coverOffset(cover, 'right', surface, tieDia, dia)
    return {
      start: surface === 'inner' ? polygonBounds.xmin - left : polygonBounds.xmin + left,
      end: surface === 'inner' ? polygonBounds.xmax + right : polygonBounds.xmax - right,
    }
  }
  // Likewise, a vertical run is bounded by bottom and top. This is what makes
  // a section-depth edit keep the same face-to-layer relationship.
  const bottom = coverOffset(cover, 'bottom', surface, tieDia, dia)
  const top = coverOffset(cover, 'top', surface, tieDia, dia)
  return {
    start: surface === 'inner' ? polygonBounds.ymin - bottom : polygonBounds.ymin + bottom,
    end: surface === 'inner' ? polygonBounds.ymax + top : polygonBounds.ymax - top,
  }
}

/**
 * Recalculate coordinates for all explicitly automatic bars.  Cover, link
 * diameter and bar diameter are inputs to the calculation; no absolute
 * coordinate is treated as the source of truth.
 *
 * `oldGeometry`/`oldCover` are used to preserve local circular group spacing
 * and to support custom-boundary edits. Manual rows are returned untouched.
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

    const faces = facesOf(bar)
    if (faces.length === 0) return bar
    const surface = bar.surface ?? 'outer'
    const oldPoly = placementPolygon(oldGeometry, surface, bar.voidIndex)
    const newPoly = placementPolygon(newGeometry, surface, bar.voidIndex)
    const oldBounds = bounds(oldPoly ?? [])
    const newBounds = bounds(newPoly ?? [])
    const p = { x: bar.x, y: bar.y }

    // A line layout carries its normal face plus a normalized position along
    // the line. Rebuilding that line keeps bars attached when B/D changes and
    // independently honours left/right or bottom/top covers at its ends.
    const range = lineRange(bar, newBounds, newCover, surface, newTieDia)
    if (range && bar.axis === 'x') p.x = range.start + (range.end - range.start) * Math.max(0, Math.min(1, bar.u ?? 0.5))
    if (range && bar.axis === 'y') p.y = range.start + (range.end - range.start) * Math.max(0, Math.min(1, bar.u ?? 0.5))

    // Move the coordinate normal to each associated face.  For a corner bar
    // this applies both independent face offsets, so unequal opposite covers
    // never collapse into one global value.
    for (const face of faces) {
      if (bar.axis === 'x' && (face === 'left' || face === 'right')) continue
      if (bar.axis === 'y' && (face === 'bottom' || face === 'top')) continue
      setFaceCoordinate(p, face, newBounds, newCover, surface, newTieDia, bar.dia)
    }

    // Bars without a normalized line coordinate still follow section translation
    // when a custom boundary is edited, then receive the new cover offset.
    if (!range && oldBounds && newBounds) {
      if (hasFace(faces, 'left') || hasFace(faces, 'right')) {
        const dx = newBounds.xmin - oldBounds.xmin
        const ex = newBounds.xmax - oldBounds.xmax
        if (hasFace(faces, 'left')) p.x += dx
        if (hasFace(faces, 'right')) p.x += ex
      }
      if (hasFace(faces, 'bottom') || hasFace(faces, 'top')) {
        const dy = newBounds.ymin - oldBounds.ymin
        const ey = newBounds.ymax - oldBounds.ymax
        if (hasFace(faces, 'bottom')) p.y += dy
        if (hasFace(faces, 'top')) p.y += ey
      }
    }

    return {
      ...bar,
      x: Number.isFinite(p.x) ? Math.round(p.x * 100) / 100 : bar.x,
      y: Number.isFinite(p.y) ? Math.round(p.y * 100) / 100 : bar.y,
    }
  })
}

/** Human-readable description used by validation banners and tests. */
export interface CoverFitIssue {
  axis: 'width' | 'height'
  available: number
  required: number
  message: string
}

/**
 * Conservative physical-fit screen for the two opposite outer face pairs. It
 * uses the largest bar in the active arrangement and includes the existing tie
 * offset. The cover audit remains the authoritative per-bar geometry check.
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
  const requiredWidth = outerCover(cover, 'left') + outerCover(cover, 'right') + 2 * Math.max(0, tieDia) + dia
  const requiredHeight = outerCover(cover, 'bottom') + outerCover(cover, 'top') + 2 * Math.max(0, tieDia) + dia
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

