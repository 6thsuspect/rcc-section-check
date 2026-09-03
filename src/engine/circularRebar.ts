import type { Point, Rebar, SectionGeometry } from './types'
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
  if (count <= 0) return []
  if (count === 1) return [{ x: centre.x, y: centre.y, dia }]

  const { radial, tangent } = frame(angleRad)
  const cc = Math.max(gap, dia) // centre-to-centre

  if (count === 2) {
    const h = cc / 2
    return [
      { x: centre.x - h * tangent.x, y: centre.y - h * tangent.y, dia },
      { x: centre.x + h * tangent.x, y: centre.y + h * tangent.y, dia },
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
      { x: apex.x, y: apex.y, dia },
      {
        x: centre.x + baseY * radial.x - (cc / 2) * tangent.x,
        y: centre.y + baseY * radial.y - (cc / 2) * tangent.y,
        dia,
      },
      {
        x: centre.x + baseY * radial.x + (cc / 2) * tangent.x,
        y: centre.y + baseY * radial.y + (cc / 2) * tangent.y,
        dia,
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
      dia,
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

function generateBundle(cfg: CircularRebarConfig): Rebar[] {
  const nBundles = Math.max(0, Math.round(cfg.nBundles))
  const per = Math.max(1, Math.round(cfg.barsPerBundle))
  if (nBundles === 0) return []
  const dia = cfg.barDia
  // Bundle centre sits on the pitch circle of a single bar; cluster spreads inward/tangential.
  const r = pitchRadius(cfg.sectionRadius, cfg.cover, cfg.tieDia, dia)
  const start = deg2rad(cfg.startAngleDeg)
  const step = angularStep(nBundles, cfg.angularSpacingDeg)
  // Clear gap within bundle ≈ max(dia, 25) → centre-to-centre = dia + clear.
  const clear = Math.max(dia, 25)
  const gap = dia + clear
  const out: Rebar[] = []
  for (let i = 0; i < nBundles; i++) {
    const a = start + i * step
    const c = pointAt(0, 0, r, a)
    out.push(...clusterAbout(c, a, per, dia, gap))
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
      out.push({ x: p.x, y: p.y, dia })
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
  bars = bars.map((b) => ({
    x: Math.round(b.x * 100) / 100,
    y: Math.round(b.y * 100) / 100,
    dia: b.dia,
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

  // Minimum clear distance between any two bars.
  let minClear = Infinity
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const c =
        Math.hypot(bars[j].x - bars[i].x, bars[j].y - bars[i].y) -
        (bars[i].dia + bars[j].dia) / 2
      minClear = Math.min(minClear, c)
    }
  }
  if (Number.isFinite(minClear)) {
    const minDia = Math.min(...bars.map((b) => b.dia))
    const limit = Math.max(minDia, 25)
    if (minClear < 0) {
      warnings.push(`Bars overlap (min clear ${minClear.toFixed(1)} mm).`)
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

/** Clamp a user-edited config into safe numeric ranges. */
export function sanitizeCircularConfig(cfg: CircularRebarConfig): CircularRebarConfig {
  return {
    ...cfg,
    barDia: clamp(cfg.barDia || 20, 6, 50),
    cover: clamp(cfg.cover || 0, 0, cfg.sectionRadius),
    tieDia: clamp(cfg.tieDia || 0, 0, 32),
    sectionRadius: Math.max(1, cfg.sectionRadius),
    startAngleDeg: Number.isFinite(cfg.startAngleDeg) ? cfg.startAngleDeg : 90,
    angularSpacingDeg:
      cfg.angularSpacingDeg != null && cfg.angularSpacingDeg > 0 ? cfg.angularSpacingDeg : null,
    nBars: clamp(Math.round(cfg.nBars || 0), 0, 200),
    altBarDia: clamp(cfg.altBarDia || cfg.barDia, 6, 50),
    barsPerBundle: clamp(Math.round(cfg.barsPerBundle || 1), 1, 8),
    nBundles: clamp(Math.round(cfg.nBundles || 0), 0, 100),
    nGroups: clamp(Math.round(cfg.nGroups || 0), 0, 100),
    groupSpacing: clamp(cfg.groupSpacing || 0, 0, 500),
    layers: (cfg.layers ?? []).map((l) => ({
      ...l,
      id: l.id || newLayerId(),
      radius: l.radius != null && l.radius > 0 ? l.radius : null,
      barDia: clamp(l.barDia || cfg.barDia, 6, 50),
      nBars: clamp(Math.round(l.nBars || 0), 0, 200),
      startAngleDeg: Number.isFinite(l.startAngleDeg) ? l.startAngleDeg : 90,
      angularSpacingDeg:
        l.angularSpacingDeg != null && l.angularSpacingDeg > 0 ? l.angularSpacingDeg : null,
    })),
  }
}
