import type { Point, Rebar, SectionGeometry } from './types'
import { COVER_FACES } from './cover'
import { pointInPolygon } from './geometry'

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
   * Clear spacing between adjacent **bundles** (outer surface to outer surface
   * of the nearest bars of two neighbouring bundles), mm. Separate from the
   * centre-to-centre gap of bars *within* a bundle. null / ≤0 → equal angular
   * placement of bundle centres only (no linear target).
   */
  bundleSpacing: number | null
  /**
   * Diameter of each bar slot inside a bundle (length = barsPerBundle).
   * Allows different diameters within the same bundle, independent of count.
   * Empty / short arrays are filled from `barDia`.
   */
  bundleBarDias: number[]
  /**
   * Centre-to-centre gap of bars *within* a bundle, mm.
   * Defaults to max(dia) + max(max(dia), 25) when ≤ 0.
   */
  bundleInnerGap: number

  // --- triple ---
  nGroups: number
  /** Clear centre-to-centre spacing of bars within a triple group, mm. */
  groupSpacing: number

  // --- layered ---
  layers: CircularLayerDef[]
}

/** Pair of bars whose solid sections intersect (clear < 0). */
export interface BarOverlap {
  i: number
  j: number
  /** Signed clear distance (negative = penetration), mm. */
  clear: number
  /** True when both bars belong to the same bundle/group. */
  sameBundle: boolean
}

export interface CircularBarAnalysis {
  warnings: string[]
  overlaps: BarOverlap[]
  /** 0-based indices of bars that participate in any overlap. */
  overlappingBarIndices: number[]
  /** Minimum clear distance between bars of *different* bundles/groups, mm. */
  minClearBetweenGroups: number | null
  /** Code-style clear-spacing limit used for the inter-group check, mm. */
  clearLimit: number
  spacingOk: boolean
  overlapOk: boolean
  /** Bundle-mode summary for the results panel. */
  bundle?: {
    nBundles: number
    barsPerBundle: number
    barDias: number[]
    /** Requested clear spacing between bundles, mm (null = equal angular only). */
    bundleSpacing: number | null
    /** Achieved minimum clear between adjacent bundles, mm. */
    achievedBundleClear: number | null
    /** Centre-to-centre gap used inside each bundle, mm. */
    innerGap: number
  }
}

export interface CircularRebarResult {
  bars: Rebar[]
  warnings: string[]
  analysis: CircularBarAnalysis
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
 * `dias` may supply a per-slot diameter (falls back to the first / max).
 * centre-to-centre within the cluster is `gap`.
 */
function clusterAbout(
  centre: Point,
  angleRad: number,
  count: number,
  dias: number | number[],
  gap: number,
  groupId?: string,
): Rebar[] {
  if (count <= 0) return []
  const diaList: number[] = []
  for (let i = 0; i < count; i++) {
    if (Array.isArray(dias) && dias.length > 0) {
      diaList.push(dias[i] ?? dias[dias.length - 1] ?? 20)
    } else {
      diaList.push(typeof dias === 'number' ? dias : 20)
    }
  }
  const maxDia = Math.max(...diaList)
  const tag = (x: number, y: number, dia: number): Rebar =>
    groupId != null ? { x, y, dia, groupId } : { x, y, dia }

  if (count === 1) return [tag(centre.x, centre.y, diaList[0])]

  const { radial, tangent } = frame(angleRad)
  const cc = Math.max(gap, maxDia) // centre-to-centre

  if (count === 2) {
    const h = cc / 2
    return [
      tag(centre.x - h * tangent.x, centre.y - h * tangent.y, diaList[0]),
      tag(centre.x + h * tangent.x, centre.y + h * tangent.y, diaList[1]),
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
      tag(apex.x, apex.y, diaList[0]),
      tag(
        centre.x + baseY * radial.x - (cc / 2) * tangent.x,
        centre.y + baseY * radial.y - (cc / 2) * tangent.y,
        diaList[1],
      ),
      tag(
        centre.x + baseY * radial.x + (cc / 2) * tangent.x,
        centre.y + baseY * radial.y + (cc / 2) * tangent.y,
        diaList[2],
      ),
    ]
  }

  // 4+: regular polygon on a circle sized so adjacent bars are `cc` apart.
  const rCluster = cc / (2 * Math.sin(Math.PI / count))
  const out: Rebar[] = []
  for (let i = 0; i < count; i++) {
    const a = angleRad + (2 * Math.PI * i) / count + Math.PI / count
    out.push(tag(centre.x + rCluster * Math.cos(a), centre.y + rCluster * Math.sin(a), diaList[i]))
  }
  return out
}

/** Resolve per-slot diameters for a bundle of `per` bars. */
export function resolveBundleBarDias(cfg: CircularRebarConfig): number[] {
  const per = Math.max(1, Math.round(cfg.barsPerBundle))
  const fallback = cfg.barDia > 0 ? cfg.barDia : 20
  const src = cfg.bundleBarDias ?? []
  const out: number[] = []
  for (let i = 0; i < per; i++) {
    const d = src[i]
    out.push(Number.isFinite(d) && d! > 0 ? d! : fallback)
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

function generateBundle(cfg: CircularRebarConfig): Rebar[] {
  const nBundles = Math.max(0, Math.round(cfg.nBundles))
  const per = Math.max(1, Math.round(cfg.barsPerBundle))
  if (nBundles === 0) return []
  const dias = resolveBundleBarDias(cfg)
  const maxDia = Math.max(...dias)
  // Bundle centre sits on the pitch circle of the largest bar so cover is met.
  const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, maxDia)
  const start = deg2rad(cfg.startAngleDeg)

  // Angular step: explicit degrees win; else derive from linear bundle clear
  // spacing along the pitch circle; else equal spacing.
  let step: number
  if (cfg.angularSpacingDeg != null && cfg.angularSpacingDeg > 0) {
    step = angularStep(nBundles, cfg.angularSpacingDeg)
  } else if (cfg.bundleSpacing != null && cfg.bundleSpacing > 0 && r > 1) {
    // Approximate bundle envelope half-width along the tangent ≈ maxDia (2-bar)
    // or the cluster radius. Use maxDia as a conservative half-chord.
    const halfChord = maxDia * (per >= 2 ? 0.5 + 0.5 * (per - 1) * 0.35 : 0.5)
    const centreToCentre = cfg.bundleSpacing + 2 * halfChord
    step = centreToCentre / Math.max(r, 1)
  } else {
    step = angularStep(nBundles, null)
  }

  // Within-bundle centre-to-centre gap (independent of inter-bundle spacing).
  const gap =
    cfg.bundleInnerGap > 0 ? cfg.bundleInnerGap : maxDia + Math.max(maxDia, 25)

  const out: Rebar[] = []
  for (let i = 0; i < nBundles; i++) {
    const a = start + i * step
    const c = pointAt(0, 0, r, a)
    const gid = `bundle-${i}`
    out.push(...clusterAbout(c, a, per, dias, gap, gid))
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
    out.push(...clusterAbout(c, a, 3, dia, gap, `triple-${i}`))
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
    groupId: b.groupId,
    radial: true,
  }))

  const analysis = analyzeCircularBars(bars, cfg)
  return { bars, warnings: analysis.warnings, analysis }
}

/**
 * Clear distance between two bar solids (negative = overlap/penetration).
 */
export function barClearDistance(a: Rebar, b: Rebar): number {
  return Math.hypot(b.x - a.x, b.y - a.y) - (a.dia + b.dia) / 2
}

/**
 * Full spacing / overlap analysis for circular (or any) bar layout.
 *
 * Minimum clear-spacing check is applied only between bars of **different**
 * groups (bundles / triples). Bars that share a `groupId` are exempt from the
 * normal min-spacing rule (they are intentionally close inside a bundle) but
 * still participate in the **overlap** check — solid sections must not intersect.
 */
export function analyzeCircularBars(bars: Rebar[], cfg: CircularRebarConfig): CircularBarAnalysis {
  const warnings: string[] = []
  const overlaps: BarOverlap[] = []
  const overlapping = new Set<number>()

  if (bars.length === 0) {
    warnings.push('No bars generated — check counts and diameters.')
    return {
      warnings,
      overlaps,
      overlappingBarIndices: [],
      minClearBetweenGroups: null,
      clearLimit: 25,
      spacingOk: true,
      overlapOk: true,
    }
  }

  const R = cfg.sectionRadius
  const Ri = cfg.innerRadius ?? 0

  let outside = 0
  let inVoid = 0
  for (const b of bars) {
    const d = Math.hypot(b.x, b.y)
    if (d + b.dia / 2 > R + 1e-6) outside++
    if (Ri > 0 && d - b.dia / 2 < Ri - 1e-6) inVoid++
  }
  if (outside > 0) warnings.push(`${outside} bar(s) extend outside the concrete section.`)
  if (inVoid > 0) warnings.push(`${inVoid} bar(s) intrude into the inner void.`)

  const minDia = Math.min(...bars.map((b) => b.dia))
  const clearLimit = Math.max(minDia, 25)

  let minClearBetweenGroups = Infinity
  let achievedBundleClear: number | null = null

  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const clear = barClearDistance(bars[i], bars[j])
      const sameBundle =
        bars[i].groupId != null && bars[j].groupId != null && bars[i].groupId === bars[j].groupId

      if (clear < -1e-6) {
        overlaps.push({ i, j, clear, sameBundle })
        overlapping.add(i)
        overlapping.add(j)
      }

      if (!sameBundle) {
        minClearBetweenGroups = Math.min(minClearBetweenGroups, clear)
      }
    }
  }

  if (Number.isFinite(minClearBetweenGroups)) {
    achievedBundleClear = minClearBetweenGroups
  } else {
    minClearBetweenGroups = Infinity
  }

  const overlapOk = overlaps.length === 0
  if (!overlapOk) {
    const n = overlapping.size
    const worst = Math.min(...overlaps.map((o) => o.clear))
    warnings.push(
      `${n} bar(s) overlap / intersect (worst penetration ${Math.abs(worst).toFixed(1)} mm). Highlighted in red on the section figure.`,
    )
  }

  let spacingOk = true
  if (Number.isFinite(minClearBetweenGroups) && minClearBetweenGroups < Infinity) {
    if (minClearBetweenGroups < -1e-6) {
      // Already covered by the overlap warning (inter-group).
      spacingOk = false
    } else if (minClearBetweenGroups < clearLimit) {
      spacingOk = false
      const label =
        cfg.kind === 'bundle'
          ? `Clear spacing between bundles ${minClearBetweenGroups.toFixed(0)} mm is below the recommended ≥ ${clearLimit.toFixed(0)} mm (within-bundle bars are exempt).`
          : `Clear spacing between groups ${minClearBetweenGroups.toFixed(0)} mm is below the recommended ≥ ${clearLimit.toFixed(0)} mm.`
      warnings.push(label)
    }
  }

  // Requested linear bundle spacing vs achieved (informational when short).
  if (
    cfg.kind === 'bundle' &&
    cfg.bundleSpacing != null &&
    cfg.bundleSpacing > 0 &&
    achievedBundleClear != null &&
    achievedBundleClear + 1e-6 < cfg.bundleSpacing &&
    achievedBundleClear >= 0
  ) {
    warnings.push(
      `Achieved clear between bundles (${achievedBundleClear.toFixed(0)} mm) is less than the requested bundle spacing (${cfg.bundleSpacing.toFixed(0)} mm).`,
    )
  }

  let bundle: CircularBarAnalysis['bundle']
  if (cfg.kind === 'bundle') {
    const dias = resolveBundleBarDias(cfg)
    const maxDia = Math.max(...dias)
    const innerGap =
      cfg.bundleInnerGap > 0 ? cfg.bundleInnerGap : maxDia + Math.max(maxDia, 25)
    bundle = {
      nBundles: Math.max(0, Math.round(cfg.nBundles)),
      barsPerBundle: Math.max(1, Math.round(cfg.barsPerBundle)),
      barDias: dias,
      bundleSpacing: cfg.bundleSpacing != null && cfg.bundleSpacing > 0 ? cfg.bundleSpacing : null,
      achievedBundleClear: achievedBundleClear != null && Number.isFinite(achievedBundleClear) ? achievedBundleClear : null,
      innerGap,
    }
  }

  return {
    warnings,
    overlaps,
    overlappingBarIndices: [...overlapping].sort((a, b) => a - b),
    minClearBetweenGroups:
      minClearBetweenGroups < Infinity ? minClearBetweenGroups : null,
    clearLimit,
    spacingOk,
    overlapOk,
    bundle,
  }
}

/**
 * Validate generated bars against the circular section envelope and minimum
 * clear spacing. Returns human-readable warning strings (empty = clean).
 * Thin wrapper kept for existing call sites / tests.
 */
export function validateCircularBars(bars: Rebar[], cfg: CircularRebarConfig): string[] {
  return analyzeCircularBars(bars, cfg).warnings
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
    bundleBarDias: [barDia, barDia],
    bundleInnerGap: barDia + Math.max(barDia, 25),
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
    bundleSpacing:
      cfg.bundleSpacing != null && cfg.bundleSpacing > 0 ? clamp(cfg.bundleSpacing, 0, 500) : null,
    bundleBarDias: (() => {
      const per = clamp(Math.round(cfg.barsPerBundle || 1), 1, 8)
      const src = cfg.bundleBarDias ?? []
      const out: number[] = []
      for (let i = 0; i < per; i++) {
        out.push(sanitizeDiameter(src[i] ?? barDia, barDia))
      }
      return out
    })(),
    bundleInnerGap: clamp(cfg.bundleInnerGap || 0, 0, 500),
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
