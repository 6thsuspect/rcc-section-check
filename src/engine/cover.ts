/**
 * Nominal clear cover, specified **independently for every concrete face**.
 *
 * Cover is nominal cover to the outermost steel — i.e. to the links/ties (IS 456
 * Cl 26.4.2.1 & Table 16; IRC 112 Cl 14.3.2.1 & Table 14.2, which measures cover
 * "to the nearest reinforcement including links"; IRS CBC Cl 15.9.2.1/2).
 *
 * Four outer faces carry their own value, named after the face of the section
 * bounding box they sit on:
 *
 *                    top      (+Y face)
 *            left  ┌────────────┐  right
 *                    └────────────┘
 *                    bottom   (−Y face)
 *
 *   bottom → face at min y (soffit)      left  → face at min x
 *   top    → face at max y               right → face at max x
 *
 * Internal (void) faces — the cell walls of a box pier, the soffit of a voided
 * deck, the inner ring of a hollow circle — can be given their own values; any
 * face left unset inherits the outer face of the same orientation.  A void-face
 * key names the void face itself: `inner.bottom` is the bottom face of the void,
 * which is lined by the bars hanging below it in the bottom slab, and likewise for
 * top / left / right.
 *
 * Bar placement for the predefined shapes sets every bar back from the concrete
 * face it lies against by
 *
 *   offset(face) = cover(face) + ⌀tie + ⌀bar/2
 *
 * so the achieved cover to the links equals the value entered for that face.
 * Circular sections are radially symmetric: the governing (largest) face value
 * of the ring is used, which keeps every face at or above its required cover.
 */

import type { Point, Rebar, SectionGeometry } from './types'
import { centroid, pointInPolygon } from './geometry'

export type CoverFace = 'bottom' | 'right' | 'top' | 'left'
export type CoverSurface = 'outer' | 'inner'

export const COVER_FACES: CoverFace[] = ['bottom', 'right', 'top', 'left']

export const FACE_LABELS: Record<CoverFace, string> = {
  bottom: 'Bottom',
  right: 'Right',
  top: 'Top',
  left: 'Left',
}

/** Short hint used next to each face field (which physical face it drives). */
export const FACE_HINTS: Record<CoverFace, string> = {
  bottom: '−Y face / soffit',
  right: '+X face',
  top: '+Y face',
  left: '−X face',
}

export interface CoverSpec {
  /** Nominal cover to the links at each of the four outer faces, mm. */
  outer: Record<CoverFace, number>
  /**
   * Nominal cover at internal (void) faces, mm. `null` → inherit the outer face
   * of the same orientation. Ignored by sections without voids.
   */
  inner: Record<CoverFace, number | null>
}

/**
 * Base slack on the achieved-cover audit, mm: guards the 0.01 mm rounding of
 * generated bar coordinates.  `auditCovers` widens it automatically for
 * polygonised curves (see `polygonTolerance`).
 */
export const COVER_TOL = 1

export function uniformCover(v = 40): CoverSpec {
  return {
    outer: { bottom: v, right: v, top: v, left: v },
    inner: { bottom: null, right: null, top: null, left: null },
  }
}

export const DEFAULT_COVER = uniformCover(40)

export function isUniformCover(c: CoverSpec): boolean {
  const v = c.outer.bottom
  return COVER_FACES.every((f) => c.outer[f] === v) && !hasInnerOverrides(c)
}

export function hasInnerOverrides(c: CoverSpec): boolean {
  return COVER_FACES.some((f) => c.inner[f] != null)
}

/** Cover required at an outer face, mm. */
export function outerCover(c: CoverSpec, face: CoverFace): number {
  return Math.max(0, c.outer[face] || 0)
}

/** Cover required at an internal (void) face, mm — falls back to the outer face. */
export function innerCover(c: CoverSpec, face: CoverFace): number {
  const v = c.inner[face]
  return v == null ? outerCover(c, face) : Math.max(0, v)
}

export function coverAt(c: CoverSpec, face: CoverFace, surface: CoverSurface): number {
  return surface === 'inner' ? innerCover(c, face) : outerCover(c, face)
}

/**
 * Radial cover for a ring of bars in a circular section: the governing
 * (largest) face value, so no face ends up below its required cover.
 */
export function radialCover(c: CoverSpec, surface: CoverSurface = 'outer'): number {
  const vals = COVER_FACES.map((f) => coverAt(c, f, surface))
  return Math.max(...vals)
}

/** Clear distance from the concrete face to the bar centre. */
export function barOffset(cover: number, tieDia: number, barDia: number): number {
  return Math.max(0, cover) + Math.max(0, tieDia) + Math.max(0, barDia) / 2
}

/** Bar-centre offsets per face, incl. the link diameter and half the bar dia. */
export interface FaceOffsets {
  outer: Record<CoverFace, number>
  inner: Record<CoverFace, number>
  /** Radial offset for circular rings (governing face), outer and inner. */
  radial: number
  radialInner: number
}

export function faceOffsets(c: CoverSpec, tieDia: number, barDia: number): FaceOffsets {
  const outer = {} as Record<CoverFace, number>
  const inner = {} as Record<CoverFace, number>
  for (const f of COVER_FACES) {
    outer[f] = barOffset(outerCover(c, f), tieDia, barDia)
    inner[f] = barOffset(innerCover(c, f), tieDia, barDia)
  }
  return {
    outer,
    inner,
    radial: barOffset(radialCover(c, 'outer'), tieDia, barDia),
    radialInner: barOffset(radialCover(c, 'inner'), tieDia, barDia),
  }
}

export function setOuterCover(c: CoverSpec, face: CoverFace, v: number): CoverSpec {
  return { ...c, outer: { ...c.outer, [face]: Math.max(0, v) } }
}

export function setAllOuterCover(c: CoverSpec, v: number): CoverSpec {
  const val = Math.max(0, v)
  return { ...c, outer: { bottom: val, right: val, top: val, left: val } }
}

export function setInnerCover(c: CoverSpec, face: CoverFace, v: number | null): CoverSpec {
  return { ...c, inner: { ...c.inner, [face]: v == null ? null : Math.max(0, v) } }
}

/**
 * Accept whatever a project file (or a legacy file) throws at us: a bare number
 * = all faces equal; a partial spec = defaults filled from the uniform value.
 */
export function normalizeCover(raw: unknown, fallback: CoverSpec = DEFAULT_COVER): CoverSpec {
  if (typeof raw === 'number' && Number.isFinite(raw)) return uniformCover(raw)
  if (!raw || typeof raw !== 'object') return { outer: { ...fallback.outer }, inner: { ...fallback.inner } }
  const o = raw as Record<string, any>
  const num = (v: unknown, d: number) => (Number.isFinite(v) ? Math.max(0, Number(v)) : d)
  const nullable = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Number(v)) : null)

  // Legacy flat shape: { bottom, top, left, right } without the outer/inner split.
  const legacyBase = COVER_FACES.some((f) => Number.isFinite(o[f]))
    ? num(o.bottom, num(o.top, num(o.left, num(o.right, fallback.outer.bottom))))
    : num(o.all, num(o.uniform, fallback.outer.bottom))

  const block = o.outer && typeof o.outer === 'object' ? (o.outer as Record<string, any>) : null
  const src = block ?? o
  const outer = {} as Record<CoverFace, number>
  for (const f of COVER_FACES) outer[f] = num(src[f], block ? fallback.outer[f] : legacyBase)

  const iblock = o.inner && typeof o.inner === 'object' ? (o.inner as Record<string, any>) : null
  const inner = {} as Record<CoverFace, number | null>
  for (const f of COVER_FACES) inner[f] = iblock ? nullable(iblock[f]) : fallback.inner[f]

  return { outer, inner }
}

// ---------------------------------------------------------------------------
// Achieved-cover audit (docs/09 V3)
// ---------------------------------------------------------------------------

/**
 * Face key for an edge/offset direction `d`, given as the normal pointing from
 * the face into the region the polygon encloses (into the concrete for the
 * outer boundary, into the hole for a void).
 */
export function faceFromNormal(dx: number, dy: number): CoverFace {
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'bottom' : 'top'
  return dx > 0 ? 'left' : 'right'
}

/**
 * Unit normal of segment p1→p2 pointing into the region the polygon encloses
 * — the concrete for an outer boundary, the hole for a void.  This is the
 * direction `faceFromNormal` (and therefore the whole cover convention) keys on.
 */
export function inboundNormal(p1: Point, p2: Point, ccw: boolean): Point {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  return ccw ? { x: -dy / len, y: dx / len } : { x: dy / len, y: -dx / len }
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  if (l2 <= 1e-12) return { x: a.x, y: a.y }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2))
  return { x: a.x + t * abx, y: a.y + t * aby }
}

export interface NearestFaceInfo {
  /** distance from the point to the face, mm */
  dist: number
  face: CoverFace
  surface: CoverSurface
  /** foot of the perpendicular on the face */
  x: number
  y: number
  /** unit vector from the face towards the point (direction of extra cover) */
  ux: number
  uy: number
}

/**
 * Nearest concrete surface to a point, with the face it belongs to. Void faces
 * count as `inner`, everything else as `outer`. `ux/uy` is the unit vector from
 * the face towards the point — the direction a bar has to move to gain cover.
 */
export function nearestFace(
  p: Point,
  geometry: SectionGeometry,
): NearestFaceInfo | null {
  let best: NearestFaceInfo | null = null
  const consider = (poly: typeof geometry.boundary, surface: CoverSurface) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const q = closestOnSegment(p, a, b)
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (best !== null && d >= best.dist) continue
      // direction from the face into the enclosed region (see faceFromNormal)
      const dirx = surface === 'outer' ? p.x - q.x : q.x - p.x
      const diry = surface === 'outer' ? p.y - q.y : q.y - p.y
      const cand: NearestFaceInfo = {
        dist: d,
        face: faceFromNormal(dirx, diry),
        surface,
        x: q.x,
        y: q.y,
        ux: d > 1e-9 ? (p.x - q.x) / d : 0,
        uy: d > 1e-9 ? (p.y - q.y) / d : 0,
      }
      best = cand
    }
  }
  consider(geometry.boundary, 'outer')
  for (const v of geometry.voids) if (v.length >= 3) consider(v, 'inner')
  return best
}

export interface BarCoverStatus {
  /** 1-based bar index in the reinforcement table. */
  bar: number
  /** achieved clear cover to the outer link, mm (bar face − link outside). */
  achieved: number
  /** nominal cover required at the face this bar is set back from, mm. */
  required: number
  face: CoverFace
  surface: CoverSurface
  /** achieved − required, mm. Negative = shortfall. */
  margin: number
  ok: boolean
  /** bar centre is not inside the net concrete area. */
  outside: boolean
}

export interface CoverAudit {
  bars: BarCoverStatus[]
  /** the bar with the smallest margin (null when there are no bars) */
  worst: BarCoverStatus | null
  /** smallest achieved cover over the bars, mm */
  minAchieved: number | null
  /** number of bars whose cover is below the value required at their face */
  nShort: number
  /** per-face roll-up over the outer faces */
  faces: Record<CoverFace, { required: number; bars: number; min: number | null; short: number }>
}

/**
 * Slack needed by a polygon that approximates a curve: the gap between the
 * circumscribed radius and the apothem of the edges (a bar aimed at the middle
 * of an edge sits slightly closer to the concrete than one aimed at a vertex).
 * Capped at 5 mm so a coarse polygon cannot excuse a real cover shortfall.
 */
export function polygonTolerance(geometry: SectionGeometry): number {
  let t = 0
  for (const poly of [geometry.boundary, ...geometry.voids]) {
    const n = poly.length
    if (n < 8) continue // hand-entered polygons are the section itself — no chord error
    const c = centroid(poly)
    let r = 0
    let maxEdge = 0
    for (let i = 0; i < n; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % n]
      r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y))
      maxEdge = Math.max(maxEdge, Math.hypot(q.x - p.x, q.y - p.y))
    }
    if (!(r > 0) || maxEdge > 0.2 * r) continue // not a finely discretised curve
    t = Math.max(t, r * (1 - Math.cos(Math.PI / n)))
  }
  return Math.min(t, 5)
}

/**
 * Compare the achieved cover of every bar with the cover required at the face it
 * sits against. Pure geometry — no code parameters — so it can drive the section
 * preview as well as the clause check.
 */
export function auditCovers(
  bars: Rebar[],
  geometry: SectionGeometry,
  cover: CoverSpec,
  tieDia = 0,
): CoverAudit {
  const tol = Math.max(COVER_TOL, polygonTolerance(geometry))
  const out: BarCoverStatus[] = []
  const faces = {} as CoverAudit['faces']
  for (const f of COVER_FACES) {
    faces[f] = { required: outerCover(cover, f), bars: 0, min: null, short: 0 }
  }

  bars.forEach((b, i) => {
    const nf = nearestFace(b, geometry)
    const outside =
      !pointInPolygon(b, geometry.boundary) || geometry.voids.some((v) => pointInPolygon(b, v))
    const toFace = nf ? nf.dist : 0
    const achieved = toFace - b.dia / 2 - Math.max(0, tieDia)
    const face = nf?.face ?? 'bottom'
    const surface: CoverSurface = nf?.surface ?? 'outer'
    const required = coverAt(cover, face, surface)
    const margin = achieved - required
    const ok = !outside && margin >= -tol
    out.push({
      bar: i + 1,
      achieved,
      required,
      face,
      surface,
      margin,
      ok,
      outside,
    })
    if (surface === 'outer') {
      const f = faces[face]
      f.bars += 1
      f.min = f.min == null ? achieved : Math.min(f.min, achieved)
      if (!ok) f.short += 1
    }
  })

  let worst: BarCoverStatus | null = null
  for (const s of out) if (!worst || s.margin < worst.margin) worst = s

  return {
    bars: out,
    worst,
    minAchieved: out.length ? Math.min(...out.map((s) => s.achieved)) : null,
    nShort: out.filter((s) => !s.ok).length,
    faces,
  }
}

/**
 * Move bars inward, away from the face they fail, until the nominal cover of
 * that face is met. Up to three passes are made because shifting one way can
 * bring a bar closer to another face; bars that cannot be satisfied while
 * staying inside the net concrete area are left where they are and counted in
 * `unfixable`.
 */
export function snapBarsToCover(
  bars: Rebar[],
  geometry: SectionGeometry,
  cover: CoverSpec,
  tieDia = 0,
): { bars: Rebar[]; moved: number; unfixable: number } {
  const requiredAt = (bar: Rebar): { need: number; have: number; nf: NearestFaceInfo | null } => {
    const nf = nearestFace(bar, geometry)
    if (!nf) return { need: 0, have: 0, nf: null }
    return {
      need: barOffset(coverAt(cover, nf.face, nf.surface), tieDia, bar.dia),
      have: nf.dist,
      nf,
    }
  }

  const out = bars.map((b) => ({ ...b }))
  let moved = 0
  let unfixable = 0

  for (const bar of out) {
    const from = { x: bar.x, y: bar.y }
    for (let pass = 0; pass < 3; pass++) {
      const st = requiredAt(bar)
      if (!st.nf || st.have >= st.need - 1e-6) break
      const push = st.need - st.have + 1e-3
      const cand: Rebar = {
        x: Math.round((bar.x + st.nf.ux * push) * 100) / 100,
        y: Math.round((bar.y + st.nf.uy * push) * 100) / 100,
        dia: bar.dia,
      }
      const inside =
        pointInPolygon(cand, geometry.boundary) && !geometry.voids.some((v) => pointInPolygon(cand, v))
      if (!inside) break
      bar.x = cand.x
      bar.y = cand.y
    }
    if (Math.hypot(bar.x - from.x, bar.y - from.y) > 1e-9) moved++
    const st = requiredAt(bar)
    if (st.nf && st.have < st.need - 1e-6) unfixable++
  }

  return { bars: out, moved, unfixable }
}

/** "40 mm (all faces)" / "bottom 40 · right 40 · top 50 · left 40 mm". */
export function formatCover(c: CoverSpec): string {
  if (isUniformCover(c)) return `${fmt1(c.outer.bottom)} mm (all faces)`
  const parts = COVER_FACES.map((f) => `${FACE_LABELS[f].toLowerCase()} ${fmt1(outerCover(c, f))}`)
  return `${parts.join(' · ')} mm`
}

const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
