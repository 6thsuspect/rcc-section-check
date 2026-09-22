/**
 * Nominal clear cover, specified **independently for every concrete face**.
 *
 * Cover is nominal cover to the outermost steel — i.e. to the links/ties (IS 456
 * Cl 26.4.2.1 & Table 16; IRC 112 Cl 14.3.2.1 & Table 14.2, which measures cover
 * "to the nearest reinforcement including links"; IRS CBC Cl 15.9.2.1/2).
 */

import type { Point, Rebar, SectionGeometry } from './types'
import type { PredefinedSection } from './sections'
import { centroid, pointInPolygon, signedArea } from './geometry'

export type CoverFace = 'bottom' | 'right' | 'top' | 'left'
export type CoverSurface = 'outer' | 'inner'
export type SectionCoverType = 'rectangular' | 'polygon' | 'circle' | 'hollow-polygon' | 'hollow-circle'

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

export interface FaceCover {
  id: string
  boundary: 'outer' | 'inner'
  faceIndex: number
  voidIndex?: number
  cover: number
}

export interface CoverSpec {
  /** Nominal cover to the links at each of the four outer faces, mm. */
  outer: Record<CoverFace, number>
  /**
   * Nominal cover at internal (void) faces, mm. `null` → inherit the outer face
   * of the same orientation. Ignored by sections without voids.
   */
  inner: Record<CoverFace, number | null>

  type?: SectionCoverType
  outerFaces?: FaceCover[]
  innerFaces?: FaceCover[]
  uniformOuterCover?: number
  uniformInnerCover?: number
}

/**
 * Base slack on the achieved-cover audit, mm: guards the 0.01 mm rounding of
 * generated bar coordinates.
 */
export const COVER_TOL = 1

export function uniformCover(v = 40): CoverSpec {
  return {
    outer: { bottom: v, right: v, top: v, left: v },
    inner: { bottom: null, right: null, top: null, left: null },
  }
}

export const DEFAULT_COVER = uniformCover(40)

export function isAxisAlignedRect(poly: Point[]): boolean {
  if (poly.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % 4]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    if (dx > 1e-4 && dy > 1e-4) return false
  }
  return true
}

export function detectSectionType(
  geometry?: SectionGeometry | null,
  predefined?: PredefinedSection | null,
  shapeClass?: string,
): SectionCoverType {
  if (predefined?.kind === 'circle' || (predefined === null && shapeClass === 'circ' && (!geometry || geometry.voids.length === 0))) {
    return 'circle'
  }
  if (predefined?.kind === 'hollowCircle' || (predefined === null && shapeClass === 'circ' && geometry && geometry.voids.length > 0)) {
    return 'hollow-circle'
  }

  const isHollow = geometry ? geometry.voids.length > 0 : false
  const isRect = predefined?.kind === 'rect' || (geometry && geometry.boundary.length === 4 && isAxisAlignedRect(geometry.boundary))

  if (isRect && !isHollow) {
    return 'rectangular'
  }
  if (isHollow) {
    return 'hollow-polygon'
  }
  return 'polygon'
}

export function isUniformCover(c: CoverSpec): boolean {
  const v = c.outer.bottom
  return COVER_FACES.every((f) => c.outer[f] === v) && !hasInnerOverrides(c)
}

export function hasInnerOverrides(c: CoverSpec): boolean {
  if (c.innerFaces?.some((f) => f.cover != null)) return true
  if (c.uniformInnerCover != null) return true
  return COVER_FACES.some((f) => c.inner[f] != null)
}

/** Cover required at an outer face, mm. */
export function outerCover(c: CoverSpec, face: CoverFace): number {
  return Math.max(0, c.outer[face] ?? c.uniformOuterCover ?? 0)
}

/** Cover required at an internal (void) face, mm — falls back to the outer face. */
export function innerCover(c: CoverSpec, face: CoverFace): number {
  const v = c.inner[face]
  if (v != null) return Math.max(0, v)
  if (c.uniformInnerCover != null) return Math.max(0, c.uniformInnerCover)
  return outerCover(c, face)
}

export function coverAt(c: CoverSpec, face: CoverFace, surface: CoverSurface): number {
  return surface === 'inner' ? innerCover(c, face) : outerCover(c, face)
}

export function getCoverForFace(
  c: CoverSpec,
  surface: CoverSurface,
  faceIndex: number,
  voidIndex = 0,
  geometry?: SectionGeometry,
): number {
  if (surface === 'outer') {
    if (c.uniformOuterCover != null && (c.type === 'circle' || c.type === 'hollow-circle')) {
      return Math.max(0, c.uniformOuterCover)
    }
    if (c.outerFaces && c.outerFaces[faceIndex] !== undefined) {
      return Math.max(0, c.outerFaces[faceIndex].cover)
    }
    if (geometry && geometry.boundary.length === 4 && isAxisAlignedRect(geometry.boundary)) {
      const faces: CoverFace[] = ['bottom', 'right', 'top', 'left']
      const f = faces[faceIndex % 4]
      return outerCover(c, f)
    }
    if (geometry && geometry.boundary.length > 0) {
      const poly = geometry.boundary
      const a = poly[faceIndex % poly.length]
      const b = poly[(faceIndex + 1) % poly.length]
      if (a && b) {
        const ccw = signedArea(poly) >= 0
        const inNorm = inboundNormal(a, b, ccw)
        const f = faceFromNormal(inNorm.x, inNorm.y)
        return outerCover(c, f)
      }
    }
    return outerCover(c, 'bottom')
  } else {
    if (c.uniformInnerCover != null && c.type === 'hollow-circle') {
      return Math.max(0, c.uniformInnerCover)
    }
    if (c.innerFaces) {
      const found = c.innerFaces.find(
        (f) => f.faceIndex === faceIndex && (f.voidIndex === undefined || f.voidIndex === voidIndex),
      )
      if (found && found.cover != null) return Math.max(0, found.cover)
    }
    if (geometry && geometry.voids[voidIndex] && geometry.voids[voidIndex].length === 4) {
      const faces: CoverFace[] = ['bottom', 'right', 'top', 'left']
      const f = faces[faceIndex % 4]
      return innerCover(c, f)
    }
    if (geometry && geometry.voids[voidIndex]) {
      const poly = geometry.voids[voidIndex]
      const a = poly[faceIndex % poly.length]
      const b = poly[(faceIndex + 1) % poly.length]
      if (a && b) {
        const ccw = signedArea(poly) >= 0
        const inNorm = inboundNormal(a, b, ccw)
        const f = faceFromNormal(inNorm.x, inNorm.y)
        return innerCover(c, f)
      }
    }
    return innerCover(c, 'bottom')
  }
}

export function setOuterFaceCover(
  c: CoverSpec,
  faceIndex: number,
  value: number,
  geometry?: SectionGeometry,
): CoverSpec {
  const val = Math.max(0, value)
  const n = geometry?.boundary.length ?? 4
  const existingFaces = c.outerFaces ? [...c.outerFaces] : []

  while (existingFaces.length < n) {
    const idx = existingFaces.length
    const fallback = getCoverForFace(c, 'outer', idx, 0, geometry)
    existingFaces.push({ id: `outer-${idx}`, boundary: 'outer', faceIndex: idx, cover: fallback })
  }

  existingFaces[faceIndex] = {
    id: `outer-${faceIndex}`,
    boundary: 'outer',
    faceIndex: faceIndex,
    cover: val,
  }

  const nextOuter = { ...c.outer }
  if (n === 4) {
    const faces: CoverFace[] = ['bottom', 'right', 'top', 'left']
    if (faces[faceIndex]) nextOuter[faces[faceIndex]] = val
  } else {
    if (faceIndex === 0) nextOuter.bottom = val
    if (faceIndex === 1) nextOuter.right = val
    if (faceIndex === 2) nextOuter.top = val
    if (faceIndex === 3) nextOuter.left = val
  }

  return {
    ...c,
    outer: nextOuter,
    outerFaces: existingFaces,
    uniformOuterCover: existingFaces.every((f) => f.cover === val) ? val : undefined,
  }
}

export function setInnerFaceCover(
  c: CoverSpec,
  faceIndex: number,
  value: number | null,
  voidIndex = 0,
  geometry?: SectionGeometry,
): CoverSpec {
  const val = value == null ? null : Math.max(0, value)
  const vPoly = geometry?.voids[voidIndex]
  const m = vPoly ? vPoly.length : 4
  const existingFaces = c.innerFaces ? [...c.innerFaces] : []

  while (existingFaces.length < m) {
    const idx = existingFaces.length
    const fallback = getCoverForFace(c, 'inner', idx, voidIndex, geometry)
    existingFaces.push({ id: `inner-${idx}`, boundary: 'inner', faceIndex: idx, voidIndex, cover: fallback })
  }

  const existingIdx = existingFaces.findIndex(
    (f) => f.faceIndex === faceIndex && (f.voidIndex === undefined || f.voidIndex === voidIndex),
  )

  if (val == null) {
    if (existingIdx >= 0) existingFaces.splice(existingIdx, 1)
  } else {
    const item: FaceCover = { id: `inner-${voidIndex}-${faceIndex}`, boundary: 'inner', faceIndex, voidIndex, cover: val }
    if (existingIdx >= 0) existingFaces[existingIdx] = item
    else existingFaces.push(item)
  }

  const nextInner = { ...c.inner }
  if (m === 4 && val != null) {
    const faces: CoverFace[] = ['bottom', 'right', 'top', 'left']
    if (faces[faceIndex]) nextInner[faces[faceIndex]] = val
  }

  return {
    ...c,
    inner: nextInner,
    innerFaces: existingFaces,
  }
}

export function setUniformOuterCover(c: CoverSpec, value: number, geometry?: SectionGeometry): CoverSpec {
  const val = Math.max(0, value)
  const n = geometry?.boundary.length ?? 4
  const outerFaces: FaceCover[] = []
  for (let i = 0; i < n; i++) {
    outerFaces.push({ id: `outer-${i}`, boundary: 'outer', faceIndex: i, cover: val })
  }
  return {
    ...c,
    outer: { bottom: val, right: val, top: val, left: val },
    outerFaces,
    uniformOuterCover: val,
  }
}

export function setUniformInnerCover(c: CoverSpec, value: number, geometry?: SectionGeometry): CoverSpec {
  const val = Math.max(0, value)
  const innerFaces: FaceCover[] = []
  if (geometry) {
    geometry.voids.forEach((v, vIdx) => {
      v.forEach((_, i) => {
        innerFaces.push({ id: `inner-${vIdx}-${i}`, boundary: 'inner', faceIndex: i, voidIndex: vIdx, cover: val })
      })
    })
  }
  return {
    ...c,
    inner: { bottom: val, right: val, top: val, left: val },
    innerFaces,
    uniformInnerCover: val,
  }
}

export function radialCover(c: CoverSpec, surface: CoverSurface = 'outer'): number {
  if (surface === 'outer' && c.uniformOuterCover != null) return c.uniformOuterCover
  if (surface === 'inner' && c.uniformInnerCover != null) return c.uniformInnerCover
  if (surface === 'outer' && c.outerFaces?.length) {
    return Math.max(...c.outerFaces.map((f) => f.cover))
  }
  if (surface === 'inner' && c.innerFaces?.length) {
    return Math.max(...c.innerFaces.map((f) => f.cover))
  }
  const vals = COVER_FACES.map((f) => coverAt(c, f, surface))
  return Math.max(...vals)
}

export function barOffset(cover: number, tieDia: number, barDia: number): number {
  return Math.max(0, cover) + Math.max(0, tieDia) + Math.max(0, barDia) / 2
}

export interface FaceOffsets {
  outer: Record<CoverFace, number>
  inner: Record<CoverFace, number>
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
  const nextOuter = { ...c.outer, [face]: Math.max(0, v) }
  return { ...c, outer: nextOuter }
}

export function setAllOuterCover(_c: CoverSpec, v: number): CoverSpec {
  const val = Math.max(0, v)
  return uniformCover(val)
}

export function setInnerCover(c: CoverSpec, face: CoverFace, v: number | null): CoverSpec {
  return { ...c, inner: { ...c.inner, [face]: v == null ? null : Math.max(0, v) } }
}

export function normalizeCover(
  raw: unknown,
  fallback: CoverSpec = DEFAULT_COVER,
  geometry?: SectionGeometry,
  predefined?: PredefinedSection | null,
): CoverSpec {
  let result: CoverSpec

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    result = uniformCover(raw)
  } else if (!raw || typeof raw !== 'object') {
    result = { ...fallback, outer: { ...fallback.outer }, inner: { ...fallback.inner } }
  } else {
    const o = raw as Record<string, any>
    const num = (v: unknown, d: number) => (Number.isFinite(v) ? Math.max(0, Number(v)) : d)
    const nullable = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Number(v)) : null)

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

    const type = o.type as SectionCoverType | undefined

    let outerFaces: FaceCover[] | undefined = undefined
    if (Array.isArray(o.outerFaces)) {
      outerFaces = o.outerFaces.map((item: any, idx: number) => ({
        id: typeof item?.id === 'string' ? item.id : `outer-${idx}`,
        boundary: 'outer',
        faceIndex: Number.isInteger(item?.faceIndex) ? Number(item.faceIndex) : idx,
        cover: num(item?.cover, outer.bottom),
      }))
    }

    let innerFaces: FaceCover[] | undefined = undefined
    if (Array.isArray(o.innerFaces)) {
      innerFaces = o.innerFaces.map((item: any, idx: number) => ({
        id: typeof item?.id === 'string' ? item.id : `inner-${idx}`,
        boundary: 'inner',
        faceIndex: Number.isInteger(item?.faceIndex) ? Number(item.faceIndex) : idx,
        voidIndex: Number.isInteger(item?.voidIndex) ? Number(item.voidIndex) : 0,
        cover: num(item?.cover, inner.bottom ?? outer.bottom),
      }))
    }

    const uniformOuterCover = Number.isFinite(o.uniformOuterCover) ? Number(o.uniformOuterCover) : undefined
    const uniformInnerCover = Number.isFinite(o.uniformInnerCover) ? Number(o.uniformInnerCover) : undefined

    result = { outer, inner }
    if (type) result.type = type
    if (outerFaces) result.outerFaces = outerFaces
    if (innerFaces) result.innerFaces = innerFaces
    if (uniformOuterCover !== undefined) result.uniformOuterCover = uniformOuterCover
    if (uniformInnerCover !== undefined) result.uniformInnerCover = uniformInnerCover
  }

  if (geometry && geometry.boundary.length > 0) {
    result.type = result.type || detectSectionType(geometry, predefined)
    if (!result.outerFaces && geometry.boundary.length !== 4) {
      const n = geometry.boundary.length
      result.outerFaces = []
      for (let i = 0; i < n; i++) {
        result.outerFaces.push({
          id: `outer-${i}`,
          boundary: 'outer',
          faceIndex: i,
          cover: getCoverForFace(result, 'outer', i, 0, geometry),
        })
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Achieved-cover audit & Geometry Utilities
// ---------------------------------------------------------------------------

export function faceFromNormal(dx: number, dy: number): CoverFace {
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'bottom' : 'top'
  return dx > 0 ? 'left' : 'right'
}

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
  dist: number
  faceIndex: number
  surface: CoverSurface
  voidIndex?: number
  face: CoverFace
  faceName: string
  x: number
  y: number
  ux: number
  uy: number
  cover: number
}

export function findNearestFace(
  p: Point,
  geometry: SectionGeometry,
  cover?: CoverSpec,
  tieBreakerBar?: Rebar,
): NearestFaceInfo | null {
  let best: NearestFaceInfo | null = null
  let bestDist = Infinity

  const considerRing = (poly: Point[], surface: CoverSurface, voidIndex = 0) => {
    if (poly.length < 2) return
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const q = closestOnSegment(p, a, b)
      const d = Math.hypot(q.x - p.x, q.y - p.y)

      const dirx = surface === 'outer' ? p.x - q.x : q.x - p.x
      const diry = surface === 'outer' ? p.y - q.y : q.y - p.y

      const legacyFace = faceFromNormal(dirx, diry)
      const isRect = surface === 'outer' && poly.length === 4 && isAxisAlignedRect(poly)
      const faceName = isRect
        ? FACE_LABELS[legacyFace]
        : surface === 'outer'
          ? `Face ${i + 1}`
          : `Inner Face ${i + 1}`

      const reqCover = cover ? getCoverForFace(cover, surface, i, voidIndex, geometry) : 40

      const ux = d > 1e-9 ? (p.x - q.x) / d : (surface === 'outer' ? (p.x - q.x) : (q.x - p.x))
      const uy = d > 1e-9 ? (p.y - q.y) / d : (surface === 'outer' ? (p.y - q.y) : (q.y - p.y))

      const cand: NearestFaceInfo = {
        dist: d,
        faceIndex: i,
        surface,
        voidIndex,
        face: legacyFace,
        faceName,
        x: q.x,
        y: q.y,
        ux: Math.hypot(ux, uy) > 1e-9 ? ux / Math.hypot(ux, uy) : 0,
        uy: Math.hypot(ux, uy) > 1e-9 ? uy / Math.hypot(ux, uy) : 0,
        cover: reqCover,
      }

      if (best === null) {
        best = cand
        bestDist = d
      } else {
        const diff = d - bestDist
        if (diff < -1e-5) {
          best = cand
          bestDist = d
        } else if (Math.abs(diff) <= 1e-5) {
          if (tieBreakerBar && tieBreakerBar.faceIndex === i && tieBreakerBar.surface === surface) {
            best = cand
            bestDist = d
          }
        }
      }
    }
  }

  considerRing(geometry.boundary, 'outer', 0)
  for (let v = 0; v < geometry.voids.length; v++) {
    considerRing(geometry.voids[v], 'inner', v)
  }

  return best
}

export function nearestFace(
  p: Point,
  geometry: SectionGeometry,
  cover?: CoverSpec,
): NearestFaceInfo | null {
  return findNearestFace(p, geometry, cover)
}

export interface BarCoverStatus {
  bar: number
  achieved: number
  required: number
  face: CoverFace
  faceIndex: number
  surface: CoverSurface
  voidIndex?: number
  faceName: string
  margin: number
  ok: boolean
  outside: boolean
}

export interface FaceAuditItem {
  faceIndex: number
  surface: CoverSurface
  voidIndex?: number
  name: string
  required: number
  bars: number
  minAchieved: number | null
  short: number
}

export interface CoverAudit {
  bars: BarCoverStatus[]
  worst: BarCoverStatus | null
  minAchieved: number | null
  nShort: number
  faces: Record<CoverFace, { required: number; bars: number; min: number | null; short: number }>
  faceAudits: FaceAuditItem[]
}

export function polygonTolerance(geometry: SectionGeometry): number {
  let t = 0
  for (const poly of [geometry.boundary, ...geometry.voids]) {
    const n = poly.length
    if (n < 8) continue
    const c = centroid(poly)
    let r = 0
    let maxEdge = 0
    for (let i = 0; i < n; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % n]
      r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y))
      maxEdge = Math.max(maxEdge, Math.hypot(q.x - p.x, q.y - p.y))
    }
    if (!(r > 0) || maxEdge > 0.2 * r) continue
    t = Math.max(t, r * (1 - Math.cos(Math.PI / n)))
  }
  return Math.min(t, 5)
}

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

  const faceAuditsMap = new Map<string, FaceAuditItem>()

  geometry.boundary.forEach((_, i) => {
    const key = `outer-0-${i}`
    const req = getCoverForFace(cover, 'outer', i, 0, geometry)
    const isRect = geometry.boundary.length === 4 && isAxisAlignedRect(geometry.boundary)
    const name = isRect ? FACE_LABELS[COVER_FACES[i]] : `Face ${i + 1}`
    faceAuditsMap.set(key, {
      faceIndex: i,
      surface: 'outer',
      voidIndex: 0,
      name,
      required: req,
      bars: 0,
      minAchieved: null,
      short: 0,
    })
  })

  geometry.voids.forEach((vPoly, vIdx) => {
    vPoly.forEach((_, i) => {
      const key = `inner-${vIdx}-${i}`
      const req = getCoverForFace(cover, 'inner', i, vIdx, geometry)
      faceAuditsMap.set(key, {
        faceIndex: i,
        surface: 'inner',
        voidIndex: vIdx,
        name: `Inner Face ${i + 1}`,
        required: req,
        bars: 0,
        minAchieved: null,
        short: 0,
      })
    })
  })

  bars.forEach((b, i) => {
    const nf = findNearestFace(b, geometry, cover, b)
    const outside =
      !pointInPolygon(b, geometry.boundary) || geometry.voids.some((v) => pointInPolygon(b, v))
    const toFace = nf ? nf.dist : 0
    const achieved = toFace - b.dia / 2 - Math.max(0, tieDia)
    const face = nf?.face ?? 'bottom'
    const faceIndex = nf?.faceIndex ?? 0
    const surface: CoverSurface = nf?.surface ?? 'outer'
    const voidIndex = nf?.voidIndex ?? 0
    const faceName = nf?.faceName ?? `Face ${faceIndex + 1}`
    const required = nf?.cover ?? coverAt(cover, face, surface)
    const margin = achieved - required
    const ok = !outside && margin >= -tol

    out.push({
      bar: i + 1,
      achieved,
      required,
      face,
      faceIndex,
      surface,
      voidIndex,
      faceName,
      margin,
      ok,
      outside,
    })

    if (surface === 'outer') {
      const f = faces[face]
      if (f) {
        f.bars += 1
        f.min = f.min == null ? achieved : Math.min(f.min, achieved)
        if (!ok) f.short += 1
      }
    }

    const itemKey = `${surface}-${voidIndex}-${faceIndex}`
    const item = faceAuditsMap.get(itemKey)
    if (item) {
      item.bars += 1
      item.minAchieved = item.minAchieved == null ? achieved : Math.min(item.minAchieved, achieved)
      if (!ok) item.short += 1
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
    faceAudits: Array.from(faceAuditsMap.values()),
  }
}

export function snapBarsToCover(
  bars: Rebar[],
  geometry: SectionGeometry,
  cover: CoverSpec,
  tieDia = 0,
): { bars: Rebar[]; moved: number; unfixable: number } {
  const requiredAt = (bar: Rebar): { need: number; have: number; nf: NearestFaceInfo | null } => {
    const nf = findNearestFace(bar, geometry, cover, bar)
    if (!nf) return { need: 0, have: 0, nf: null }
    return {
      need: barOffset(nf.cover, tieDia, bar.dia),
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
        ...bar,
        x: Math.round((bar.x + st.nf.ux * push) * 100) / 100,
        y: Math.round((bar.y + st.nf.uy * push) * 100) / 100,
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



export function formatCover(c: CoverSpec, geometry?: SectionGeometry): string {
  const type = c.type || detectSectionType(geometry)
  if (type === 'circle' || isUniformCover(c)) {
    return `${fmt1(c.uniformOuterCover ?? c.outer.bottom)} mm (all faces)`
  }
  if (type === 'hollow-circle') {
    return `outer ${fmt1(c.uniformOuterCover ?? c.outer.bottom)} · inner ${fmt1(c.uniformInnerCover ?? c.inner.bottom ?? c.outer.bottom)} mm`
  }
  if (c.outerFaces && c.outerFaces.length > 0) {
    const parts = c.outerFaces.map((f) => `Face ${f.faceIndex + 1} ${fmt1(f.cover)}`)
    return `${parts.join(' · ')} mm`
  }
  const parts = COVER_FACES.map((f) => `${FACE_LABELS[f].toLowerCase()} ${fmt1(outerCover(c, f))}`)
  return `${parts.join(' · ')} mm`
}

const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
