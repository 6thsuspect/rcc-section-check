import type { Point, Rebar, SectionGeometry } from './types'
import { COVER_FACES } from './cover'
import { pointInPolygon } from './geometry'
import { BUNDLE_PREFIX, clearDistance, OVERLAP_TOL, sameBundle } from './barSpacing'

/**
 * Circular-section reinforcement arrangement generators.
 * All angles are degrees in the public API; internal math uses radians.
 * Coordinate origin is the section centre (as produced by generateSection for
 * circle / hollowCircle). 0° is +X; positive angles are CCW. The default
 * start angle of 90° places the first bar at the top (+Y), matching the
 * existing uniform ring layout.
 */

export type CircularArrangementKind = 'uniform' | 'alternate' | 'bundle' | 'triple' | 'layered'

export interface CircularLayerDef {
  id: string
  /** Pitch-circle radius (mm). null → auto from cover / layer index. */
  radius: number | null
  barDia: number
  nBars: number
  startAngleDeg: number
  /** null → equal spacing 360 / nBars. */
  angularSpacingDeg: number | null
}

export interface CircularRebarConfig {
  kind: CircularArrangementKind
  /** Primary bar diameter, mm. */
  barDia: number
  /** Clear cover used when deriving pitch radius, mm. */
  cover: number
  tieDia: number
  /** Section outer radius, mm (D/2 or Do/2). */
  sectionRadius: number
  /** Optional inner void radius for hollow circles (bars must stay outside). */
  innerRadius?: number
  /** Starting angle of the first bar / group centre, degrees (default 90 = top). */
  startAngleDeg: number
  /** Explicit angular spacing between successive locations, degrees. null = auto. */
  angularSpacingDeg: number | null

  // --- uniform / alternate ---
  /** Number of bars (uniform) or bar positions (alternate). */
  nBars: number
  /** Alternate (odd-index) bar diameter; defaults to barDia when equal. */
  altBarDia: number

  // --- bundle ---
  barsPerBundle: number
  nBundles: number
  /**
   * Centre-to-centre spacing between adjacent bundles (straight chord between
   * bundle centres on the pitch circle), mm. null → bundles equally spaced
   * around the ring (or by the legacy angular spacing when one is set).
   * Independent of the spacing of bars inside a bundle.
   */
  bundleSpacing?: number | null
  /**
   * Centre-to-centre spacing of bars within one bundle, mm. null → the
   * original automatic value ⌀max + max(⌀max, 25). A value equal to the bar
   * diameter places the bars in contact.
   */
  bundleInnerSpacing?: number | null
  /** When true, each bar position of a bundle uses its own diameter from `bundleBarDias`. */
  bundleMixedDia?: boolean
  /**
   * Diameter of bar position k within every bundle. Kept independent of
   * `barsPerBundle`: positions beyond the list use `barDia`, and entries are
   * retained when the count is reduced.
   */
  bundleBarDias?: number[]

  // --- triple ---
  nGroups: number
  /** Clear centre-to-centre spacing of bars within a triple group, mm. */
  groupSpacing: number

  // --- layered ---
  layers: CircularLayerDef[]
}

export interface CircularRebarResult {
  bars: Rebar[]
  warnings: string[]
}

const DEG = Math.PI / 180

function deg2rad(d: number): number {
  return d * DEG
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Pitch-circle radius for a bar of given diameter sitting at clear cover. */
export function pitchRadius(
  sectionRadius: number,
  cover: number,
  tieDia: number,
  barDia: number,
): number {
  return Math.max(0, sectionRadius - cover - tieDia - barDia / 2)
}

/** Angular step (radians). Uses explicit spacing when provided, else 2π/n. */
function angularStep(n: number, spacingDeg: number | null): number {
  if (n <= 0) return 0
  if (spacingDeg != null && Number.isFinite(spacingDeg) && spacingDeg > 0) {
    return deg2rad(spacingDeg)
  }
  return (2 * Math.PI) / n
}

function pointAt(cx: number, cy: number, r: number, angleRad: number): Point {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) }
}

/** Unit tangent (CCW) and radial outward at a polar angle. */
function frame(angleRad: number): { radial: Point; tangent: Point } {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return { radial: { x: c, y: s }, tangent: { x: -s, y: c } }
}

/**
 * Place `count` bars in a compact cluster about a centre on the pitch circle.
 * Two bars sit side-by-side on the tangent; three form an equilateral triangle
 * (one inward, two outer); four+ sit on a small circle about the centre.
 * centre-to-centre within the cluster is `gap` (defaults to barDia +  max clear).
 */
function clusterAbout(
  centre: Point,
  angleRad: number,
  count: number,
  dia: number,
  gap: number,
): Rebar[] {
  return clusterAboutMixed(centre, angleRad, Array.from({ length: Math.max(0, count) }, () => dia), gap)
}

/**
 * clusterAbout with an individual diameter per bar position. With equal
 * diameters it reproduces the original single-diameter cluster exactly; with
 * mixed diameters the centre-to-centre distance is governed by the largest
 * bar so no two bars of the cluster can intersect.
 */
function clusterAboutMixed(centre: Point, angleRad: number, dias: number[], gap: number): Rebar[] {
  const count = dias.length
  if (count <= 0) return []
  const dia = Math.max(...dias)
  const D = (k: number) => dias[k]
  if (count === 1) return [{ x: centre.x, y: centre.y, dia: D(0) }]

  const { radial, tangent } = frame(angleRad)
  const cc = Math.max(gap, dia) // centre-to-centre

  if (count === 2) {
    const h = cc / 2
    return [
      { x: centre.x - h * tangent.x, y: centre.y - h * tangent.y, dia: D(0) },
      { x: centre.x + h * tangent.x, y: centre.y + h * tangent.y, dia: D(1) },
    ]
  }

  if (count === 3) {
    // Equilateral triangle: apex toward section centre (inward), base on tangent.
    const h = (Math.sqrt(3) / 2) * cc
    const apex = {
      x: centre.x - (h * 2) / 3 * radial.x,
      y: centre.y - (h * 2) / 3 * radial.y,
    }
    const baseY = (h * 1) / 3
    return [
      { x: apex.x, y: apex.y, dia: D(0) },
      {
        x: centre.x + baseY * radial.x - (cc / 2) * tangent.x,
        y: centre.y + baseY * radial.y - (cc / 2) * tangent.y,
        dia: D(1),
      },
      {
        x: centre.x + baseY * radial.x + (cc / 2) * tangent.x,
        y: centre.y + baseY * radial.y + (cc / 2) * tangent.y,
        dia: D(2),
      },
    ]
  }

  // 4+: regular polygon on a circle sized so adjacent bars are `cc` apart.
  const rCluster = cc / (2 * Math.sin(Math.PI / count))
  const out: Rebar[] = []
  for (let i = 0; i < count; i++) {
    const a = angleRad + (2 * Math.PI * i) / count + Math.PI / count
    out.push({
      x: centre.x + rCluster * Math.cos(a),
      y: centre.y + rCluster * Math.sin(a),
      dia: D(i),
    })
  }
  return out
}

function generateUniform(cfg: CircularRebarConfig): Rebar[] {
  const n = Math.max(0, Math.round(cfg.nBars))
  if (n === 0) return []
  const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, cfg.barDia)
  const start = deg2rad(cfg.startAngleDeg)
  const step = angularStep(n, cfg.angularSpacingDeg)
  const out: Rebar[] = []
  for (let i = 0; i < n; i++) {
    const a = start + i * step
    const p = pointAt(0, 0, r, a)
    out.push({ x: p.x, y: p.y, dia: cfg.barDia })
  }
  return out
}

function generateAlternate(cfg: CircularRebarConfig): Rebar[] {
  const n = Math.max(0, Math.round(cfg.nBars))
  if (n === 0) return []
  const diaA = cfg.barDia
  const diaB = cfg.altBarDia > 0 ? cfg.altBarDia : cfg.barDia
  // Pitch radius based on the larger bar so both stay inside cover.
  const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, Math.max(diaA, diaB))
  const start = deg2rad(cfg.startAngleDeg)
  const step = angularStep(n, cfg.angularSpacingDeg)
  const out: Rebar[] = []
  for (let i = 0; i < n; i++) {
    const a = start + i * step
    const p = pointAt(0, 0, r, a)
    out.push({ x: p.x, y: p.y, dia: i % 2 === 0 ? diaA : diaB })
  }
  return out
}

/** Diameter of every bar position in one bundle (independent of the bars-per-bundle count). */
export function bundleDiameters(cfg: CircularRebarConfig): number[] {
  const per = Math.max(1, Math.round(cfg.barsPerBundle))
  return Array.from({ length: per }, (_, k) => {
    const v = cfg.bundleMixedDia ? cfg.bundleBarDias?.[k] : undefined
    return v != null && Number.isFinite(v) && v > 0 ? v : cfg.barDia
  })
}

/** Centre-to-centre spacing of bars inside a bundle actually used by the generator, mm. */
export function bundleInnerSpacingUsed(cfg: CircularRebarConfig): number {
  const dia = Math.max(...bundleDiameters(cfg))
  const auto = dia + Math.max(dia, 25)
  const v = cfg.bundleInnerSpacing
  return v != null && Number.isFinite(v) && v > 0 ? Math.max(v, dia) : auto
}

/** Pitch radius of the bundle centres, mm. */
export function bundlePitchRadius(cfg: CircularRebarConfig): number {
  return pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, Math.max(...bundleDiameters(cfg)))
}

/** Angular step between adjacent bundle centres, radians. */
export function bundleAngularStep(cfg: CircularRebarConfig): number {
  const nBundles = Math.max(0, Math.round(cfg.nBundles))
  const s = cfg.bundleSpacing
  const r = bundlePitchRadius(cfg)
  if (s != null && Number.isFinite(s) && s > 0 && r > 0) {
    // straight centre-to-centre chord between neighbouring bundle centres
    return 2 * Math.asin(Math.min(1, s / (2 * r)))
  }
  return angularStep(nBundles, cfg.angularSpacingDeg)
}

/** Centre-to-centre chord between adjacent bundle centres, mm. */
export function bundleSpacingUsed(cfg: CircularRebarConfig): number {
  return 2 * bundlePitchRadius(cfg) * Math.sin(bundleAngularStep(cfg) / 2)
}

function generateBundle(cfg: CircularRebarConfig): Rebar[] {
  const nBundles = Math.max(0, Math.round(cfg.nBundles))
  if (nBundles === 0) return []
  const dias = bundleDiameters(cfg)
  // Bundle centre sits on the pitch circle of the largest bar; cluster spreads inward/tangential.
  const r = bundlePitchRadius(cfg)
  const start = deg2rad(cfg.startAngleDeg)
  const step = bundleAngularStep(cfg)
  // Default centre-to-centre within the bundle = dia + max(dia, 25) (original behaviour).
  const gap = bundleInnerSpacingUsed(cfg)
  const out: Rebar[] = []
  for (let i = 0; i < nBundles; i++) {
    const a = start + i * step
    const c = pointAt(0, 0, r, a)
    for (const b of clusterAboutMixed(c, a, dias, gap)) out.push({ ...b, groupId: `${BUNDLE_PREFIX}${i + 1}` })
  }
  return out
}

function generateTriple(cfg: CircularRebarConfig): Rebar[] {
  const nGroups = Math.max(0, Math.round(cfg.nGroups))
  if (nGroups === 0) return []
  const dia = cfg.barDia
  const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, dia)
  const start = deg2rad(cfg.startAngleDeg)
  const step = angularStep(nGroups, cfg.angularSpacingDeg)
  // groupSpacing is centre-to-centre within the triple; fall back to dia+max(dia,25).
  const gap = cfg.groupSpacing > 0 ? cfg.groupSpacing : dia + Math.max(dia, 25)
  const out: Rebar[] = []
  for (let i = 0; i < nGroups; i++) {
    const a = start + i * step
    const c = pointAt(0, 0, r, a)
    out.push(...clusterAbout(c, a, 3, dia, gap))
  }
  return out
}

function generateLayered(cfg: CircularRebarConfig): Rebar[] {
  const out: Rebar[] = []
  const layers = cfg.layers.length > 0 ? cfg.layers : []
  layers.forEach((layer, idx) => {
    const n = Math.max(0, Math.round(layer.nBars))
    if (n === 0) return
    const dia = layer.barDia > 0 ? layer.barDia : cfg.barDia
    let r: number
    if (layer.radius != null && Number.isFinite(layer.radius) && layer.radius > 0) {
      r = layer.radius
    } else {
      // Auto: outermost layer at standard pitch; each inner layer steps inward
      // by (dia + clear) so layers don't clash.
      const outer = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, dia)
      const clear = Math.max(dia, 25)
      r = Math.max(0, outer - idx * (dia + clear))
    }
    const start = deg2rad(Number.isFinite(layer.startAngleDeg) ? layer.startAngleDeg : cfg.startAngleDeg)
    const step = angularStep(n, layer.angularSpacingDeg)
    for (let i = 0; i < n; i++) {
      const a = start + i * step
      const p = pointAt(0, 0, r, a)
      out.push({ x: p.x, y: p.y, dia, layer: idx, positioning: 'automatic' })
    }
  })
  return out
}

/** Generate bars for the given circular arrangement config. */
export function generateCircularRebar(cfg: CircularRebarConfig): CircularRebarResult {
  let bars: Rebar[]
  switch (cfg.kind) {
    case 'uniform':
      bars = generateUniform(cfg)
      break
    case 'alternate':
      bars = generateAlternate(cfg)
      break
    case 'bundle':
      bars = generateBundle(cfg)
      break
    case 'triple':
      bars = generateTriple(cfg)
      break
    case 'layered':
      bars = generateLayered(cfg)
      break
    default:
      bars = generateUniform(cfg)
  }

  // Round coordinates to 0.01 mm for stable table display / duplicate checks.
  // Keep the relationship metadata alongside the legacy coordinate fields. The
  // circular panel owns these rows, so a cover or diameter change can regenerate
  // the same arrangement without treating the coordinates as hard-coded values.
  bars = bars.map((b, i) => ({
    x: Math.round(b.x * 100) / 100,
    y: Math.round(b.y * 100) / 100,
    dia: b.dia,
    positioning: 'automatic' as const,
    face: 'top' as const,
    faces: [...COVER_FACES],
    surface: 'outer' as const,
    layer: b.layer ?? (cfg.kind === 'layered' ? i : undefined),
    radial: true,
    ...(b.groupId ? { groupId: b.groupId } : {}),
  }))

  const warnings = validateCircularBars(bars, cfg)
  return { bars, warnings }
}

/**
 * Validate generated bars against the circular section envelope and minimum
 * clear spacing. Returns human-readable warning strings (empty = clean).
 */
export function validateCircularBars(bars: Rebar[], cfg: CircularRebarConfig): string[] {
  const warnings: string[] = []
  if (bars.length === 0) {
    warnings.push('No bars generated — check counts and diameters.')
    return warnings
  }

  const R = cfg.sectionRadius
  const Ri = cfg.innerRadius ?? 0

  let outside = 0
  let inVoid = 0
  for (const b of bars) {
    const d = Math.hypot(b.x, b.y)
    // Bar must lie wholly inside outer face: centre + radius ≤ R − cover (soft:
    // centre + radius ≤ R is the hard geometric limit).
    if (d + b.dia / 2 > R + 1e-6) outside++
    if (Ri > 0 && d - b.dia / 2 < Ri - 1e-6) inVoid++
  }
  if (outside > 0) {
    warnings.push(`${outside} bar(s) extend outside the concrete section.`)
  }
  if (inVoid > 0) {
    warnings.push(`${inVoid} bar(s) intrude into the inner void.`)
  }

  // Minimum clear distance between bars. Bars of one bundle sit together by
  // design, so they are excluded here; any intersection (in or out of a bundle)
  // is reported separately as an overlap.
  let minClear = Infinity
  let overlapPairs = 0
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const c = clearDistance(bars[i], bars[j])
      if (c < -OVERLAP_TOL) overlapPairs++
      if (sameBundle(bars[i], bars[j])) continue
      minClear = Math.min(minClear, c)
    }
  }
  if (overlapPairs > 0) {
    warnings.push(`${overlapPairs} overlapping bar pair(s) — bars intersect (highlighted red on the section).`)
  }
  if (cfg.kind === 'bundle') {
    const n = Math.max(0, Math.round(cfg.nBundles))
    const s = cfg.bundleSpacing
    const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, Math.max(...bars.map((b) => b.dia)))
    if (s != null && s > 0 && r > 0 && s > 2 * r) {
      warnings.push(`Bundle spacing ${s.toFixed(0)} mm exceeds the pitch-circle diameter ${(2 * r).toFixed(0)} mm.`)
    } else if (s != null && s > 0 && r > 0 && n * 2 * Math.asin(Math.min(1, s / (2 * r))) > 2 * Math.PI + 1e-6) {
      warnings.push(`${n} bundles at ${s.toFixed(0)} mm spacing do not fit around the ring — bundles wrap past the start.`)
    }
    if (Math.round(cfg.barsPerBundle) > 4) warnings.push('More than 4 bars per bundle exceeds the usual code limit.')
  }
  if (Number.isFinite(minClear)) {
    const minDia = Math.min(...bars.map((b) => b.dia))
    const limit = Math.max(minDia, 25)
    if (minClear < 0) {
      if (overlapPairs === 0) warnings.push(`Bars overlap (min clear ${minClear.toFixed(1)} mm).`)
    } else if (minClear < limit) {
      warnings.push(
        `Clear spacing ${minClear.toFixed(0)} mm is below the recommended ≥ ${limit.toFixed(0)} mm.`,
      )
    }
  }

  return warnings
}

/**
 * Validate bars against an arbitrary section geometry (boundary + voids).
 * Used after generation so custom-edited circular sections still get checked.
 */
export function validateBarsInGeometry(bars: Rebar[], geometry: SectionGeometry): string[] {
  const warnings: string[] = []
  const outside = bars.filter(
    (b) =>
      !pointInPolygon(b, geometry.boundary) ||
      geometry.voids.some((v) => pointInPolygon(b, v)),
  )
  if (outside.length > 0) {
    warnings.push(`${outside.length} bar(s) lie outside the concrete section.`)
  }
  return warnings
}

/** Default config for a solid circular section. */
export function defaultCircularRebarConfig(
  kind: CircularArrangementKind = 'uniform',
  sectionRadius = 300,
  cover = 40,
  tieDia = 8,
  barDia = 25,
): CircularRebarConfig {
  return {
    kind,
    barDia,
    cover,
    tieDia,
    sectionRadius,
    startAngleDeg: 90,
    angularSpacingDeg: null,
    nBars: 8,
    altBarDia: barDia,
    barsPerBundle: 2,
    nBundles: 6,
    bundleSpacing: null,
    bundleInnerSpacing: null,
    bundleMixedDia: false,
    bundleBarDias: [barDia, barDia],
    nGroups: 6,
    groupSpacing: barDia + Math.max(barDia, 25),
    layers: [
      {
        id: 'layer-1',
        radius: null,
        barDia,
        nBars: 8,
        startAngleDeg: 90,
        angularSpacingDeg: null,
      },
    ],
  }
}

export function newLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function defaultLayer(barDia = 25, nBars = 8, startAngleDeg = 90): CircularLayerDef {
  return {
    id: newLayerId(),
    radius: null,
    barDia,
    nBars,
    startAngleDeg,
    angularSpacingDeg: null,
  }
}

/** Labels for the arrangement selector. */
export const ARRANGEMENT_LABELS: Record<CircularArrangementKind, string> = {
  uniform: 'Uniform ring',
  alternate: 'Alternate bars',
  bundle: 'Bundle bars',
  triple: 'Triple bars',
  layered: 'Layered reinforcement',
}

/** Round a positive diameter to the precision accepted by the custom input. */
function sanitizeDiameter(value: number, fallback: number): number {
  const safe = Number.isFinite(value) && value > 0 ? value : fallback
  return Math.max(0.0001, Math.round(safe * 10000) / 10000)
}

/** Sanitize a user-edited config without restricting custom bar diameters. */
export function sanitizeCircularConfig(cfg: CircularRebarConfig): CircularRebarConfig {
  const barDia = sanitizeDiameter(cfg.barDia, 20)
  return {
    ...cfg,
    barDia,
    cover: clamp(cfg.cover || 0, 0, cfg.sectionRadius),
    tieDia: clamp(cfg.tieDia || 0, 0, 32),
    sectionRadius: Math.max(1, cfg.sectionRadius),
    startAngleDeg: Number.isFinite(cfg.startAngleDeg) ? cfg.startAngleDeg : 90,
    angularSpacingDeg:
      cfg.angularSpacingDeg != null && cfg.angularSpacingDeg > 0 ? cfg.angularSpacingDeg : null,
    nBars: clamp(Math.round(cfg.nBars || 0), 0, 200),
    altBarDia: sanitizeDiameter(cfg.altBarDia, barDia),
    barsPerBundle: clamp(Math.round(cfg.barsPerBundle || 1), 1, 8),
    nBundles: clamp(Math.round(cfg.nBundles || 0), 0, 100),
    bundleSpacing: cfg.bundleSpacing != null && cfg.bundleSpacing > 0 ? cfg.bundleSpacing : null,
    bundleInnerSpacing: cfg.bundleInnerSpacing != null && cfg.bundleInnerSpacing > 0 ? cfg.bundleInnerSpacing : null,
    bundleMixedDia: !!cfg.bundleMixedDia,
    bundleBarDias: (cfg.bundleBarDias ?? []).map((d) => sanitizeDiameter(d, barDia)),
    nGroups: clamp(Math.round(cfg.nGroups || 0), 0, 100),
    groupSpacing: clamp(cfg.groupSpacing || 0, 0, 500),
    layers: (cfg.layers ?? []).map((l) => ({
      ...l,
      id: l.id || newLayerId(),
      radius: l.radius != null && l.radius > 0 ? l.radius : null,
      barDia: sanitizeDiameter(l.barDia, barDia),
      nBars: clamp(Math.round(l.nBars || 0), 0, 200),
      startAngleDeg: Number.isFinite(l.startAngleDeg) ? l.startAngleDeg : 90,
      angularSpacingDeg:
        l.angularSpacingDeg != null && l.angularSpacingDeg > 0 ? l.angularSpacingDeg : null,
    })),
  }
}
