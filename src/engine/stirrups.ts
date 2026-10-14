/**
 * Shear-reinforcement (link / stirrup) detailing model.
 *
 * This module turns the shared section geometry, cover model and longitudinal
 * bar table into a *drawable and checkable* link arrangement: the closed link
 * ring, its intermediate legs, cross-ties, hooks, and the derived quantities the
 * shear check needs (effective legs crossing the shear plane, Asv).
 *
 * It is deliberately separate from the resistance calculations in `shear.ts`:
 * the diagram never changes an equation, and an arrangement that only exists on
 * screen cannot make a check pass — the engine consumes the effective leg count
 * and link diameter from `ShearSettings`, and this module's validation reports
 * detailing problems (spacing, restraint, fit) without touching the user's input.
 *
 * Convention used throughout: the *shear plane* has a **width** direction
 * (perpendicular to the design shear force) and a **depth** direction (parallel
 * to it, the direction `d` is measured in). A **leg** crosses the shear plane —
 * it runs along the depth direction and is counted in Asv. A **cross-tie** runs
 * across the width, ties the side-face bars and is *not* counted in Asv.
 */
import type { Point, Rebar, SectionGeometry } from './types'
import { barArea, centroid, ensureCCW, pointInPolygon, signedArea } from './geometry'
import { getCoverForFace, radialCover, type CoverSpec } from './cover'
import type { ShearSettings } from './shear'

export type LinkShape = ShearSettings['linkShape']
export type LinkLayoutMode = ShearSettings['linkLayout']
export type ResolvedShape = 'rectangular' | 'circular'
export type LinkMemberKind = 'leg' | 'tie'

/** Largest longitudinal bar, mm (0 when there are no bars). */
function maxBarDia(bars: Rebar[]): number {
  return bars.reduce((m, b) => Math.max(m, b.dia), 0)
}

/* ------------------------------------------------------------------ */
/* Ring                                                               */
/* ------------------------------------------------------------------ */

export interface LinkRing {
  /** Shape actually used (the user's choice, or the section's own shape). */
  shape: ResolvedShape
  /** True when the shape follows the section rather than an explicit choice. */
  auto: boolean
  /** Ring centreline in section coordinates — closed, CCW. */
  path: Point[]
  /** Circle parameters (circular rings only). */
  circle: { cx: number; cy: number; r: number } | null
  /** Extents of the ring centreline, section coordinates. */
  min: Point
  max: Point
  /** Governing inset from the concrete face to the ring centreline, mm. */
  inset: number
  /** Cover used per boundary vertex (polygon rings). */
  covers: number[]
  /** True when the entered cover cannot be applied and a reduced ring is drawn. */
  reduced: boolean
  /** Inset actually drawn when `reduced` (polygon rings only), mm. */
  drawnInset?: number
}

/** Inward unit normal of edge a→b for a CCW polygon. */
function inwardNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: -dy / len, y: dx / len }
}

/**
 * Offset a CCW polygon inward, a per-edge distance, by intersecting adjacent
 * offset edge lines (miter). Near-parallel neighbours fall back to the vertex
 * bisector, so degenerate joins never blow the ring up.
 */
function offsetPolygon(poly: Point[], dists: number[]): Point[] {
  const n = poly.length
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const a1 = poly[prev]
    const b1 = poly[i]
    const a2 = poly[i]
    const b2 = poly[(i + 1) % n]
    const d1 = dists[prev]
    const d2 = dists[i]
    const n1 = inwardNormal(a1, b1)
    const n2 = inwardNormal(a2, b2)
    const p1 = { x: a1.x + n1.x * d1, y: a1.y + n1.y * d1 }
    const p2 = { x: a2.x + n2.x * d2, y: a2.y + n2.y * d2 }
    const v1 = { x: b1.x - a1.x, y: b1.y - a1.y }
    const v2 = { x: b2.x - a2.x, y: b2.y - a2.y }
    const den = v1.x * v2.y - v1.y * v2.x
    if (Math.abs(den) > 1e-6) {
      const t = ((p2.x - p1.x) * v2.y - (p2.y - p1.y) * v2.x) / den
      out.push({ x: p1.x + v1.x * t, y: p1.y + v1.y * t })
    } else {
      const nx = (n1.x + n2.x) / 2
      const ny = (n1.y + n2.y) / 2
      const nl = Math.hypot(nx, ny) || 1
      const d = (d1 + d2) / 2
      out.push({ x: a2.x + (nx / nl) * d, y: a2.y + (ny / nl) * d })
    }
  }
  return out
}

function polyExtents(poly: Point[]): { min: Point; max: Point } {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } }
}

/**
 * Build the closed link ring: an inward offset polygon following the cover of
 * each concrete face, or a concentric circle for circular sections. The ring
 * centreline sits `cover + ⌀link/2` inside the face, which is how the app's cover
 * datum is defined (clear cover to the link).
 */
export function buildLinkRing(
  geometry: SectionGeometry,
  cover: CoverSpec,
  settings: Pick<ShearSettings, 'linkShape' | 'linkDia'>,
  circular: boolean,
): LinkRing {
  const radius = Math.max(settings.linkDia, 0) / 2
  const boundary = ensureCCW(geometry.boundary)
  const shape: ResolvedShape =
    settings.linkShape === 'auto' ? (circular ? 'circular' : 'rectangular') : settings.linkShape
  const auto = settings.linkShape === 'auto'

  /* ---- circular ring: concentric with the boundary ---- */
  if (shape === 'circular') {
    const c = centroid(boundary)
    const radii = boundary.map((p) => Math.hypot(p.x - c.x, p.y - c.y))
    const rBar = radii.reduce((s, r) => s + r, 0) / Math.max(radii.length, 1)
    const inset = radialCover(cover) + radius
    const r = Math.max(rBar - inset, 0)
    const n = 72
    const path: Point[] = []
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      path.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
    }
    return {
      shape,
      auto,
      path,
      circle: { cx: c.x, cy: c.y, r },
      min: { x: c.x - r, y: c.y - r },
      max: { x: c.x + r, y: c.y + r },
      inset,
      covers: boundary.map(() => radialCover(cover)),
      reduced: rBar - inset < rBar * 0.05,
    }
  }

  /* ---- perimeter ring: offset every face by its own cover ---- */
  const covers = boundary.map((_, i) => getCoverForFace(cover, 'outer', i, 0, geometry) + radius)
  let path = offsetPolygon(boundary, covers)
  let min = polyExtents(path).min
  let max = polyExtents(path).max
  let reduced = false
  // Too thick a cover for the section can collapse or invert the ring — fall back
  // to a uniform inset so the diagram stays drawable, and let the validation
  // report the real problem instead of drawing nonsense.
  const collapsed =
    !(Math.abs(signedArea(path)) > Math.abs(signedArea(boundary)) * 0.02) ||
    signedArea(path) <= 0 ||
    path.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !pointInPolygon(p, boundary))
  let drawnInset: number | undefined
  if (collapsed) {
    reduced = true
    const ext = polyExtents(boundary)
    const shrink = Math.max(Math.min(ext.max.x - ext.min.x, ext.max.y - ext.min.y) * 0.03, radius + 1)
    const used = boundary.map((_, i) => {
      const a = boundary[i]
      const b = boundary[(i + 1) % boundary.length]
      const nrm = inwardNormal(a, b)
      const wall =
        Math.abs(nrm.x) > Math.abs(nrm.y) ? (ext.max.x - ext.min.x) / 2 : (ext.max.y - ext.min.y) / 2
      return Math.min(covers[i], Math.max(shrink, wall * 0.06))
    })
    const finite = used.filter((v) => Number.isFinite(v))
    drawnInset = finite.length > 0 ? Math.min(...finite) : Math.max(shrink, 1)
    path = offsetPolygon(boundary, used)
    min = polyExtents(path).min
    max = polyExtents(path).max
  }
  return {
    shape,
    auto,
    path,
    circle: null,
    min,
    max,
    inset: Math.max(...covers),
    covers,
    reduced,
    drawnInset,
  }
}

/* ------------------------------------------------------------------ */
/* Legs and cross-ties                                                */
/* ------------------------------------------------------------------ */

export interface ResolvedLinkMember {
  id: string
  kind: LinkMemberKind
  /** Legs: 0…1 across the shear-plane width. Ties: 0…1 across the depth. */
  u: number
  /** True when the position was entered/edited by the user. */
  manual: boolean
  /** End points on the ring centreline, section coordinates. */
  a: Point
  b: Point
  /** Length between the ring legs, mm. */
  length: number
  /** Index of the longitudinal bar this member restrains (nearest end bar), if any. */
  restrains: number | null
  /** Distance from the member to the nearest longitudinal bar, mm (null = no bars). */
  nearestBar: number | null
  /** True for legs: a leg crosses the shear plane and is counted in Asv. */
  effective: boolean
}

export interface LinkLayout {
  ring: LinkRing
  /** Intermediate legs + cross-ties, in the order they are drawn. */
  members: ResolvedLinkMember[]
  /** Intermediate legs only. */
  intermediate: ResolvedLinkMember[]
  /** Cross-ties only. */
  ties: ResolvedLinkMember[]
  /** Total legs crossing the shear plane: 2 ring legs + intermediate legs. */
  effectiveLegs: number
  /** Area of one leg, mm². */
  singleLegArea: number
  /** Asv of the effective legs, mm². */
  totalLegArea: number
  /** Asv per unit length at the entered spacing, mm²/mm. */
  asvPerS: number
  /** Layout source actually used. */
  mode: LinkLayoutMode
  /** Manual members that could not be drawn (position does not cross the ring). */
  dropped: { kind: LinkMemberKind; u: number }[]
  /** Explanations for anything the layout could not do as asked. */
  notes: string[]
}

/** Intersections of the line `coord = value` with the ring centreline. */
function ringCrossingsAlong(ring: LinkRing, axis: 'x' | 'y', value: number): number[] {
  const out: number[] = []
  if (ring.circle) {
    const { cx, cy, r } = ring.circle
    const d = axis === 'x' ? value - cx : value - cy
    const sq = r * r - d * d
    if (sq <= 0) return []
    const s = Math.sqrt(sq)
    out.push(axis === 'x' ? cy - s : cx - s, axis === 'x' ? cy + s : cx + s)
    return out
  }
  const poly = ring.path
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const av = axis === 'x' ? a.x : a.y
    const bv = axis === 'x' ? b.x : b.y
    if ((av - value) * (bv - value) > 0 || Math.abs(bv - av) < 1e-9) continue
    const t = (value - av) / (bv - av)
    if (t < -1e-9 || t > 1 + 1e-9) continue
    out.push(axis === 'x' ? a.y + t * (b.y - a.y) : a.x + t * (b.x - a.x))
  }
  return [...new Set(out.map((v) => Math.round(v * 1000) / 1000))].sort((p, q) => p - q)
}

/** Distance from a member's ends to a bar, mm (null when there are no bars). */
function barProximity(member: { a: Point; b: Point }, bars: Rebar[]): { index: number | null; dist: number | null } {
  if (bars.length === 0) return { index: null, dist: null }
  let best = Infinity
  let index = -1
  bars.forEach((bar, i) => {
    const r = bar.dia / 2
    for (const p of [member.a, member.b]) {
      const d = Math.max(Math.hypot(p.x - bar.x, p.y - bar.y) - r, 0)
      if (d < best) {
        best = d
        index = i
      }
    }
  })
  return { index: index >= 0 ? index : null, dist: Number.isFinite(best) ? best : null }
}

/**
 * Axis whose coordinate a member's position is measured along — which is also
 * the axis of the line the member lies on: a leg is a line of constant *width*
 * coordinate (it runs along the depth), a cross-tie a line of constant *depth*
 * coordinate.
 */
function memberAxis(kind: LinkMemberKind, axis: 'x' | 'y'): 'x' | 'y' {
  const widthAxis: 'x' | 'y' = axis === 'y' ? 'x' : 'y'
  return kind === 'leg' ? widthAxis : (axis === 'y' ? 'y' : 'x')
}

function resolveMember(
  kind: LinkMemberKind,
  u: number,
  manual: boolean,
  geometry: SectionGeometry,
  ring: LinkRing,
  bars: Rebar[],
  axis: 'x' | 'y',
): ResolvedLinkMember | null {
  const crossAxis = memberAxis(kind, axis)
  const [min, max] = polyExtentsLocal(geometry, crossAxis)
  const span = Math.max(max - min, 1e-6)
  const value = min + Math.min(Math.max(u, 0), 1) * span
  const crossings = ringCrossingsAlong(ring, crossAxis, value)
  if (crossings.length < 2) return null
  const lo = crossings[0]
  const hi = crossings[crossings.length - 1]
  const a: Point = crossAxis === 'x' ? { x: value, y: lo } : { x: lo, y: value }
  const b: Point = crossAxis === 'x' ? { x: value, y: hi } : { x: hi, y: value }
  const prox = barProximity({ a, b }, bars)
  return {
    id: `${kind}-${u.toFixed(4)}`,
    kind,
    u,
    manual,
    a,
    b,
    length: Math.abs(hi - lo),
    restrains: prox.dist !== null && prox.dist <= Math.max(1.5 * maxBarDia(bars), 10) ? prox.index : null,
    nearestBar: prox.dist,
    effective: kind === 'leg',
  }
}

/** Extent of the boundary along one model axis (mm). */
function polyExtentsLocal(geometry: SectionGeometry, axis: 'x' | 'y'): [number, number] {
  const values = geometry.boundary.map((p) => (axis === 'x' ? p.x : p.y))
  return [Math.min(...values), Math.max(...values)]
}

/** Distance from a point to a segment, mm. */
function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Distance from a bar to the nearest restraint that holds it — a link bend (ring
 * node), an intermediate leg or a cross-tie — measured to the bar surface, mm.
 * This single function decides both the automatic arrangement and the restraint
 * validation, so the two can never disagree about a bar being held.
 */
export function barRestraintDistance(
  bar: Rebar,
  ring: LinkRing,
  members: { a: Point; b: Point }[],
): number {
  let best = Infinity
  for (const p of ring.path) best = Math.min(best, Math.hypot(p.x - bar.x, p.y - bar.y))
  for (const m of members) best = Math.min(best, segmentDistance(bar, m.a, m.b))
  return best - bar.dia / 2
}

/** True when a proposed member would simply double one of the ring's own runs. */
function memberDuplicatesRing(
  kind: LinkMemberKind,
  u: number,
  geometry: SectionGeometry,
  ring: LinkRing,
  settings: ShearSettings,
): boolean {
  const m = resolveMember(kind, u, false, geometry, ring, [], settings.axis)
  if (!m) return true
  const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }
  const limit = Math.max(2 * Math.max(settings.linkDia, 1), 25)
  let best = Infinity
  for (let i = 0; i < ring.path.length; i++) {
    best = Math.min(best, segmentDistance(mid, ring.path[i], ring.path[(i + 1) % ring.path.length]))
  }
  return best < limit
}

/**
 * Automatic arrangement: the smallest set of intermediate legs and cross-ties
 * that meets the restraint limit, derived from the longitudinal bars and the
 * ring. A bar is restrained when a link bend, an intermediate leg or a
 * cross-tie lies within `RESTRAINT_LIMIT` of it. Intermediate legs come first —
 * a leg restrains a whole column of bars and is link steel counted in Asv — and
 * cross-ties pick up the bars a leg cannot cover (a side-face bar beside one of
 * the ring's own legs, a column too close to another leg). A member that would
 * simply double one of the ring's own runs, or that would sit closer than the
 * minimum clear spacing to another member, is never added, so the automatic
 * arrangement always passes its own validation.
 *
 * Order of the result is always ascending, so the drawing is deterministic.
 */
export function autoLinkMembers(
  ring: LinkRing,
  geometry: SectionGeometry,
  bars: Rebar[],
  settings: ShearSettings,
  circular: boolean,
): { legs: number[]; ties: number[] } {
  if (bars.length === 0) return { legs: [], ties: [] }
  // a circular hoop is continuous: straight members are not placed automatically
  if (circular || ring.shape === 'circular') return { legs: [], ties: [] }

  const axis = settings.axis
  const members: { a: Point; b: Point }[] = []
  const legs: number[] = []
  const ties: number[] = []
  const open = (bar: Rebar) => barRestraintDistance(bar, ring, members) > RESTRAINT_LIMIT
  const round1 = (v: number) => Math.round(v * 10) / 10

  /**
   * Place the automatic members of one kind on every coordinate that still has
   * an unrestrained bar. The list of open coordinates is taken once, so a
   * member added below never cancels a member that the same pass would add.
   */
  const place = (kind: LinkMemberKind, cap: number) => {
    const list = kind === 'leg' ? legs : ties
    if (list.length >= cap) return
    const crossAxis = memberAxis(kind, axis)
    const [min, max] = polyExtentsLocal(geometry, crossAxis)
    const span = Math.max(max - min, 1e-6)
    const byCoord = new Map<number, Rebar[]>()
    for (const bar of bars) {
      const key = round1(crossAxis === 'x' ? bar.x : bar.y)
      const bucket = byCoord.get(key)
      if (bucket) bucket.push(bar)
      else byCoord.set(key, [bar])
    }
    const mid = (min + max) / 2
    const candidates = [...byCoord.entries()]
      .map(([coord, group]) => ({ coord, count: group.filter(open).length }))
      .filter((g) => g.count > 0)
      // widest-open coordinate first; among equals the innermost one, because the
      // outer rows and columns are the ones the ring's own run already touches.
      // For a symmetric bar table this keeps the arrangement symmetric.
      .sort((a, b) => b.count - a.count || Math.abs(a.coord - mid) - Math.abs(b.coord - mid) || a.coord - b.coord)
    const minClear = Math.max(25, Math.max(settings.linkDia, 0))
    const placed = kind === 'leg' ? legs : ties
    for (const g of candidates) {
      if (placed.length >= cap) break
      const u = (g.coord - min) / span
      if (u <= 0.002 || u >= 0.998) continue
      // never place a member the same validation would reject: the arrangement the
      // rule produces has to be one the rule accepts
      if (placed.some((v) => Math.abs((g.coord - min) - v * span) < minClear)) continue
      if (memberDuplicatesRing(kind, u, geometry, ring, settings)) continue
      const m = resolveMember(kind, u, false, geometry, ring, bars, axis)
      if (!m) continue
      members.push({ a: m.a, b: m.b })
      placed.push(Math.round(u * 1e4) / 1e4)
    }
  }

  // Intermediate legs first: a leg restrains a whole column of bars and is link
  // steel counted in Asv, which is how a wide section is detailed. Cross-ties then
  // pick up what a leg cannot cover — a side-face bar right beside one of the
  // ring's own legs, or a column too close to another leg to take a second one.
  place('leg', 8)
  place('tie', 8)
  place('leg', 8)
  legs.sort((a, b) => a - b)
  ties.sort((a, b) => a - b)
  return { legs, ties }
}

/**
 * Resolve the full link layout for the current section, cover, bar table and
 * shear settings. Pure: nothing is mutated, so the caller keeps a single source
 * of truth in `AppState`.
 */
export function resolveLinkLayout(
  geometry: SectionGeometry,
  bars: Rebar[],
  cover: CoverSpec,
  settings: ShearSettings,
  circular: boolean,
): LinkLayout {
  const ring = buildLinkRing(geometry, cover, settings, circular)
  const notes: string[] = []
  const auto = settings.linkLayout === 'auto'
  const autoMembers = autoLinkMembers(ring, geometry, bars, settings, circular)

  const legUs = auto ? autoMembers.legs : settings.legPositions
  const tieUs = auto ? autoMembers.ties : settings.tiePositions

  const members: ResolvedLinkMember[] = []
  const dropped: { kind: LinkMemberKind; u: number }[] = []
  for (const [kind, list] of [
    ['leg', legUs],
    ['tie', tieUs],
  ] as const) {
    for (const u of list) {
      const m = resolveMember(kind, u, !auto, geometry, ring, bars, settings.axis)
      if (m) members.push(m)
      else dropped.push({ kind, u })
    }
  }
  members.sort((a, b) => (a.kind === b.kind ? a.u - b.u : a.kind === 'leg' ? -1 : 1))

  const intermediate = members.filter((m) => m.kind === 'leg')
  const ties = members.filter((m) => m.kind === 'tie')
  const effectiveLegs = 2 + intermediate.length
  const singleLegArea = barArea(settings.linkDia)
  const spacing = Math.max(settings.linkSpacing, 1)

  if (auto && intermediate.length > 0) {
    notes.push(
      `Automatic arrangement: ${intermediate.length} intermediate leg${intermediate.length === 1 ? '' : 's'} placed on the longitudinal bars, ${effectiveLegs} legs cross the shear plane.`,
    )
  }
  if (ties.length > 0) {
    notes.push(
      `${ties.length} cross-tie${ties.length === 1 ? '' : 's'} across the width restrain the side-face bars; cross-ties are not counted in Asv.`,
    )
  }
  if (ring.shape === 'circular') {
    notes.push('Circular hoop: two legs cross a diametral shear plane; internal straight members are not part of the code detailing tables.')
  }

  return {
    ring,
    members,
    intermediate,
    ties,
    effectiveLegs,
    singleLegArea,
    totalLegArea: effectiveLegs * singleLegArea,
    asvPerS: (effectiveLegs * singleLegArea) / spacing,
    mode: settings.linkLayout,
    dropped,
    notes,
  }
}

/** Settings with the derived effective leg count (what the shear engine reads). */
export function withResolvedLegs(settings: ShearSettings, layout: LinkLayout): ShearSettings {
  return { ...settings, linkLegs: layout.effectiveLegs }
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export interface LinkValidation {
  errors: string[]
  warnings: string[]
  status: 'ok' | 'warn' | 'error'
  /** Indices of longitudinal bars no member restrains within the code's limit. */
  unrestrained: number[]
}

/** Detailing limit for bar restraint, mm (IS 456 Cl 26.5.3.2(c) / IRS CBC 15.9.4.3). */
export const RESTRAINT_LIMIT = 150

/**
 * Check the arrangement as detailed. Reports what is wrong and why; never
 * silently repairs it. Resistance checks stay in `shear.ts` — this only covers
 * geometry, restraint and the detailing limits that the arrangement can violate.
 */
export function validateLinkLayout(
  layout: LinkLayout,
  geometry: SectionGeometry,
  bars: Rebar[],
  settings: ShearSettings,
): LinkValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const { ring } = layout
  const dia = Math.max(settings.linkDia, 0)

  /* ---- ring ---- */
  if (ring.shape === 'circular' && ring.circle && ring.circle.r <= 0) {
    errors.push(
      `The circular link does not fit inside the section: a ⌀${dia} link needs ${(ring.inset).toFixed(0)} mm inside the face, which is more than the available radius.`,
    )
  }
  // A concave (non-rectangular) outline cannot take a cover offset on every face:
  // the offset edges cross at the reflex corners. The ring is then drawn at a
  // reduced inset following the same outline, and that is a warning — the real
  // link layout of such a section (web links + flange links) is outside this
  // module. A rectangular outline has no such excuse: a reduced ring there means
  // the cover or the link does not fit, which blocks the drawing.
  const concave = ring.shape === 'rectangular' && geometry.boundary.length > 4
  if (ring.shape === 'rectangular' && !concave) {
    const area = Math.abs(signedArea(ring.path))
    const gross = Math.abs(signedArea(geometry.boundary))
    if (!(area > 0) || area < gross * 0.02) {
      errors.push('The link ring collapses inside the section — reduce the cover or the section size for this bar arrangement.')
    }
    const inside = ring.path.every((p) => {
      const cxOk = p.x >= Math.min(...geometry.boundary.map((q) => q.x)) - 1
      const cyOk = p.y >= Math.min(...geometry.boundary.map((q) => q.y)) - 1
      const cxMax = p.x <= Math.max(...geometry.boundary.map((q) => q.x)) + 1
      const cyMax = p.y <= Math.max(...geometry.boundary.map((q) => q.y)) + 1
      return cxOk && cyOk && cxMax && cyMax
    })
    if (!inside) errors.push('The link ring falls outside the concrete boundary.')
  }
  if (ring.reduced) {
    if (concave) {
      warnings.push(
        `The link ring is drawn at a reduced inset (${(ring.drawnInset ?? ring.inset).toFixed(0)} mm against the ${ring.inset.toFixed(0)} mm needed): a cover offset cannot be built on every face of this non-rectangular outline. Verify the link arrangement — web and flange links are outside this module.`,
      )
    } else {
      errors.push(
        `The link ring does not fit inside the section with the entered cover: a ⌀${dia.toFixed(0)} link needs ${ring.inset.toFixed(0)} mm inside the face. The diagram shows a reduced ring — increase the section, or reduce the cover or the link diameter.`,
      )
    }
  }
  if (ring.shape === 'rectangular' && concave) {
    warnings.push(
      'The link follows the full perimeter of this non-rectangular section — verify the link arrangement against the detailing drawing (a rectangular link inside the outline is not modelled separately).',
    )
  }
  if (geometry.voids.length > 0) {
    warnings.push('The link ring follows the outer boundary only; void-face links are outside this module (check them separately).')
  }

  /* ---- members ---- */
  const minClear = Math.max(25, dia)
  const all = layout.members
  const ringOwn = (axis: 'x' | 'y') => (axis === 'x' ? [ring.min.x, ring.max.x] : [ring.min.y, ring.max.y])
  const ownLegClearance = Math.max(25, dia)
  for (const d of layout.dropped) {
    const outside = d.u < -0.0005 || d.u > 1.0005
    errors.push(
      outside
        ? `${d.kind === 'leg' ? 'Leg' : 'Cross-tie'} at ${(d.u * 100).toFixed(1)} % lies outside the section outline — it is not drawn. Move it inside the ring.`
        : `${d.kind === 'leg' ? 'Leg' : 'Cross-tie'} at ${(d.u * 100).toFixed(1)} % does not cross the link ring and cannot be drawn — move it inside the ring.`,
    )
  }
  for (const m of all) {
    const label = m.kind === 'leg' ? 'Leg' : 'Cross-tie'
    const crossAxis = memberAxis(m.kind, settings.axis)
    const [ringLow, ringHigh] = ringOwn(crossAxis)
    const value = crossAxis === 'x' ? m.a.x : m.a.y
    if (m.u < -0.0005 || m.u > 1.0005) {
      errors.push(
        `${label} at ${(m.u * 100).toFixed(1)} % lies outside the section outline — the member is drawn at the ring edge until it is moved inside.`,
      )
    } else if (Math.min(Math.abs(value - ringLow), Math.abs(value - ringHigh)) < ownLegClearance) {
      errors.push(
        `${label} at ${(value).toFixed(0)} mm duplicates the ring's own ${m.kind === 'leg' ? 'leg' : 'side'} (${ringLow.toFixed(0)} mm / ${ringHigh.toFixed(0)} mm) — move it at least ${ownLegClearance.toFixed(0)} mm inboard.`,
      )
    }
    if (m.length <= 0) errors.push(`${label} at ${(m.u * 100).toFixed(1)} % does not span the link.`)
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].kind !== all[j].kind) continue
      const span = spanOf(geometry, memberAxis(all[i].kind, settings.axis))
      const gap = Math.abs(all[j].u - all[i].u) * span
      if (gap < minClear) {
        errors.push(
          `${all[i].kind === 'leg' ? 'Legs' : 'Cross-ties'} at ${(all[i].u * 100).toFixed(1)} % and ${(all[j].u * 100).toFixed(1)} % are ${gap.toFixed(0)} mm apart — provide at least ${minClear.toFixed(0)} mm clear.`,
        )
      }
    }
  }
  if (ring.shape === 'circular' && layout.ties.length > 0) {
    warnings.push('Straight cross-ties across a circular hoop are outside the code detailing tables — verify anchorage and restraint by calculation.')
  }

  /* ---- bar restraint (a detailing requirement of every supported code) ---- */
  const unrestrained: number[] = []
  bars.forEach((bar, i) => {
    const nearest = barRestraintDistance(bar, ring, all)
    if (nearest > RESTRAINT_LIMIT) {
      unrestrained.push(i)
      warnings.push(
        `Bar ${i + 1} is ${nearest.toFixed(0)} mm from the nearest leg, cross-tie or link corner (limit ${RESTRAINT_LIMIT} mm) — add a leg or a tie to restrain it.`,
      )
    }
  })

  const status: LinkValidation['status'] = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok'
  return { errors, warnings, status, unrestrained }
}

function spanOf(geometry: SectionGeometry, axis: 'x' | 'y'): number {
  const values = geometry.boundary.map((p) => (axis === 'y' ? p.y : p.x))
  return Math.max(Math.max(...values) - Math.min(...values), 1e-6)
}

/**
 * Suggested position for a new member of `kind`, normalised across the section:
 * the automatic candidate furthest from the members already placed (including
 * the ring's own legs at 0 and 1), falling back to the widest free gap. Lets the
 * editor add a leg on a bar rather than at an arbitrary fraction.
 */
export function suggestMemberPosition(
  kind: LinkMemberKind,
  existing: number[],
  ring: LinkRing,
  geometry: SectionGeometry,
  bars: Rebar[],
  settings: ShearSettings,
  circular: boolean,
): number {
  const [lo, hi] = polyExtentsLocal(geometry, memberAxis(kind, settings.axis))
  const ownFraction = Math.min(Math.max(ring.inset, 25) / Math.max(hi - lo, 1e-6), 0.2)
  const taken = [ownFraction, 1 - ownFraction, ...existing]
  const auto = autoLinkMembers(ring, geometry, bars, settings, circular)
  const candidates = kind === 'leg' ? auto.legs : auto.ties
  const free = candidates.filter((c) => taken.every((t) => Math.abs(t - c) > 0.03))
  if (free.length > 0) {
    let best = free[0]
    let bestGap = -1
    for (const c of free) {
      const gap = Math.min(...taken.map((t) => Math.abs(t - c)))
      if (gap > bestGap) {
        bestGap = gap
        best = c
      }
    }
    return Math.round(best * 1000) / 1000
  }
  // no bar to sit on: split the widest free gap between the members already placed
  const sorted = [...taken].sort((a, b) => a - b)
  let mid = 0.5
  let widest = -1
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > widest) {
      widest = gap
      mid = (sorted[i] + sorted[i - 1]) / 2
    }
  }
  return Math.round(mid * 1000) / 1000
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                    */
/* ------------------------------------------------------------------ */

/** Section-coordinate value of a normalised member position. */
export function memberCoordinate(geometry: SectionGeometry, kind: LinkMemberKind, u: number, axis: 'x' | 'y'): number {
  // deliberately unclamped: an entered position outside the section is reported,
  // never silently rewritten, so the editor shows exactly what was typed
  const [min, max] = polyExtentsLocal(geometry, memberAxis(kind, axis))
  return min + u * (max - min)
}

/** Normalised position of a section-coordinate value (inverse of the above). */
export function normalisedPosition(geometry: SectionGeometry, kind: LinkMemberKind, value: number, axis: 'x' | 'y'): number {
  const [min, max] = polyExtentsLocal(geometry, memberAxis(kind, axis))
  return (value - min) / Math.max(max - min, 1e-6)
}

/**
 * Hook polyline for a straight member end: a 135° bend of `hookLen` (≈ 6·⌀, the
 * smallest standard stirrup hook) turning into the section, plus the corner of
 * the ring it is anchored to.
 */
export function hookPath(end: Point, other: Point, hookLen: number, inward: Point): Point[] {
  // The bar arrives at this end travelling along u; a 135° hook turns the tail
  // back at 45° to u. Of the two tails take the one that heads into the section.
  const dx = end.x - other.x
  const dy = end.y - other.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const c = Math.SQRT1_2
  const tails = [
    { x: -(ux - uy) * c, y: -(ux + uy) * c },
    { x: -(ux + uy) * c, y: (ux - uy) * c },
  ]
  const dot = tails.map((t) => t.x * inward.x + t.y * inward.y)
  const t = dot[0] >= dot[1] ? tails[0] : tails[1]
  return [end, { x: end.x + t.x * hookLen, y: end.y + t.y * hookLen }]
}

/** Area breakdown shown in the editor and the diagram caption. */
export function linkAreaBreakdown(layout: LinkLayout, settings: ShearSettings) {
  const ringLegs = 2
  const intermediate = layout.intermediate.length
  return {
    singleLegArea: layout.singleLegArea,
    ringLegs,
    intermediate,
    effectiveLegs: layout.effectiveLegs,
    totalLegArea: layout.totalLegArea,
    ties: layout.ties.length,
    asvPerS: layout.asvPerS,
    spacing: Math.max(settings.linkSpacing, 1),
  }
}
