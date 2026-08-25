import type { Point, Polygon, Rebar, SectionGeometry, SectionProperties } from './types'

/** Signed area via the shoelace formula. Positive for CCW winding. */
export function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

/** Centroid of a simple polygon (Green's theorem). */
export function centroid(poly: Polygon): Point {
  const A = signedArea(poly)
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const w = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * w
    cy += (a.y + b.y) * w
  }
  return { x: cx / (6 * A), y: cy / (6 * A) }
}

/** Second moments about the origin of the coordinate system (Green's theorem). */
export function secondMomentsAboutOrigin(poly: Polygon): { Ixx: number; Iyy: number; Ixy: number } {
  let Ixx = 0
  let Iyy = 0
  let Ixy = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const w = a.x * b.y - b.x * a.y
    Ixx += (a.y * a.y + a.y * b.y + b.y * b.y) * w
    Iyy += (a.x * a.x + a.x * b.x + b.x * b.x) * w
    Ixy += (a.x * b.y + 2 * a.x * a.y + 2 * b.x * b.y + b.x * a.y) * w
  }
  return { Ixx: Ixx / 12, Iyy: Iyy / 12, Ixy: Ixy / 24 }
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  const eps = 1e-9
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps
}

/** True when no two non-adjacent edges cross (simple polygon). O(n²). */
export function isSimplePolygon(poly: Polygon): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (share a vertex)
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  }
  return true
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function barArea(dia: number): number {
  return (Math.PI * dia * dia) / 4
}

/**
 * Full section properties. Voids subtract; second moments are reported about
 * the centroidal axes of the net section.
 */
export function sectionProperties(geom: SectionGeometry, bars: Rebar[]): SectionProperties {
  const outer = ensureCCW(geom.boundary)
  const voids = geom.voids.map(ensureCCW)

  const aOut = signedArea(outer)
  const aVoids = voids.map(signedArea)
  const area = aOut - aVoids.reduce((s, a) => s + a, 0)

  const cOut = centroid(outer)
  let cx = cOut.x * aOut
  let cy = cOut.y * aOut
  for (let i = 0; i < voids.length; i++) {
    const cv = centroid(voids[i])
    cx -= cv.x * aVoids[i]
    cy -= cv.y * aVoids[i]
  }
  cx /= area
  cy /= area

  const mo = secondMomentsAboutOrigin(outer)
  let Ixx = mo.Ixx
  let Iyy = mo.Iyy
  let Ixy = mo.Ixy
  for (const v of voids) {
    const mv = secondMomentsAboutOrigin(v)
    Ixx -= mv.Ixx
    Iyy -= mv.Iyy
    Ixy -= mv.Ixy
  }
  // parallel-axis shift to the centroid
  Ixx -= area * cy * cy
  Iyy -= area * cx * cx
  Ixy -= area * cx * cy

  const Asc = bars.reduce((s, b) => s + barArea(b.dia), 0)

  let xmin = Infinity
  let xmax = -Infinity
  let ymin = Infinity
  let ymax = -Infinity
  for (const p of outer) {
    xmin = Math.min(xmin, p.x - cx)
    xmax = Math.max(xmax, p.x - cx)
    ymin = Math.min(ymin, p.y - cy)
    ymax = Math.max(ymax, p.y - cy)
  }

  return {
    area,
    cx,
    cy,
    Ixx,
    Iyy,
    Ixy,
    Asc,
    p: (100 * Asc) / area,
    barCount: bars.length,
    bbox: { xmin, xmax, ymin, ymax },
  }
}

/** Translate a polygon so the given point becomes the origin. */
export function translatePoly(poly: Polygon, origin: Point): Polygon {
  return poly.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }))
}

/**
 * Chord intersections of the horizontal line v = vg with a polygon expressed in
 * rotated (u, v) coordinates. Returns paired u-intervals plus their first
 * moment ∫u du, used by the scanline stress integrator.
 */
export function chordAt(polyUV: Polygon, vg: number): { w: number; Su: number } {
  const us: number[] = []
  const n = polyUV.length
  for (let i = 0; i < n; i++) {
    const a = polyUV[i]
    const b = polyUV[(i + 1) % n]
    const dv = b.y - a.y
    if (dv === 0) continue
    // half-open rule keeps vertex hits from double-counting
    if ((a.y <= vg && b.y > vg) || (b.y <= vg && a.y > vg)) {
      us.push(a.x + ((vg - a.y) * (b.x - a.x)) / dv)
    }
  }
  us.sort((p, q) => p - q)
  let w = 0
  let Su = 0
  for (let i = 0; i + 1 < us.length; i += 2) {
    const u1 = us[i]
    const u2 = us[i + 1]
    w += u2 - u1
    Su += (u2 * u2 - u1 * u1) / 2
  }
  return { w, Su }
}
