import type { Rebar } from './types'

/**
 * Physical bar-to-bar relationships: overlap / intersection detection for any
 * reinforcement layout, and bundle-aware clear spacing.
 *
 * Bars that belong to one bundle carry a shared `groupId` beginning with
 * `bundle-` (written by the circular bundle generator and preserved through the
 * bar table and project files). Bars inside one bundle are placed in close
 * contact on purpose, so they are excluded from the normal minimum clear
 * spacing check; the spacing that matters is the clear gap between a bundle
 * and its neighbouring bars / bundles. Overlap is checked for every pair,
 * including bars within the same bundle.
 */

/** Interpenetration below this depth (mm) is treated as touching, not overlap — guards 0.01 mm rounding. */
export const OVERLAP_TOL = 0.1

export const BUNDLE_PREFIX = 'bundle-'

export function bundleIdOf(bar: Rebar): string | null {
  return typeof bar.groupId === 'string' && bar.groupId.startsWith(BUNDLE_PREFIX) ? bar.groupId : null
}

export function sameBundle(a: Rebar, b: Rebar): boolean {
  const ka = bundleIdOf(a)
  return ka !== null && ka === bundleIdOf(b)
}

/** Clear (surface-to-surface) distance between two bars, mm — negative when they intersect. */
export function clearDistance(a: Rebar, b: Rebar): number {
  return Math.hypot(b.x - a.x, b.y - a.y) - (a.dia + b.dia) / 2
}

export interface BarOverlap {
  /** Zero-based bar indices. */
  i: number
  j: number
  /** Interpenetration depth, mm (positive). */
  depth: number
  sameBundle: boolean
}

/** Every intersecting pair of bars (clear distance below −OVERLAP_TOL). */
export function detectBarOverlaps(bars: Rebar[], tol = OVERLAP_TOL): BarOverlap[] {
  const out: BarOverlap[] = []
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const c = clearDistance(bars[i], bars[j])
      if (c < -tol) out.push({ i, j, depth: -c, sameBundle: sameBundle(bars[i], bars[j]) })
    }
  }
  return out
}

/** Indices of all bars involved in at least one overlap. */
export function overlappingBarSet(bars: Rebar[]): Set<number> {
  const s = new Set<number>()
  for (const o of detectBarOverlaps(bars)) {
    s.add(o.i)
    s.add(o.j)
  }
  return s
}

export interface BundleInfo {
  id: string
  /** Zero-based indices of the member bars. */
  bars: number[]
  dias: number[]
  /** Equivalent (same-area) diameter √Σφ², mm — a bundle is treated as one bar of this size for spacing. */
  eqDia: number
  /** Physical envelope width across the bundle, mm. */
  envelope: number
  /** Area centroid of the bundle, mm. */
  cx: number
  cy: number
}

export function analyseBundles(bars: Rebar[]): BundleInfo[] {
  const map = new Map<string, number[]>()
  bars.forEach((b, i) => {
    const k = bundleIdOf(b)
    if (!k) return
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(i)
  })
  const out: BundleInfo[] = []
  for (const [id, idx] of map) {
    const members = idx.map((i) => bars[i])
    const areas = members.map((b) => b.dia * b.dia)
    const A = areas.reduce((s, a) => s + a, 0)
    const cx = members.reduce((s, b, k) => s + b.x * areas[k], 0) / A
    const cy = members.reduce((s, b, k) => s + b.y * areas[k], 0) / A
    let envelope = Math.max(...members.map((b) => b.dia))
    for (let p = 0; p < members.length; p++)
      for (let q = p + 1; q < members.length; q++)
        envelope = Math.max(envelope, Math.hypot(members[q].x - members[p].x, members[q].y - members[p].y) + (members[p].dia + members[q].dia) / 2)
    out.push({ id, bars: idx, dias: members.map((b) => b.dia), eqDia: Math.sqrt(A), envelope, cx, cy })
  }
  return out
}

export interface SpacingReport {
  bundles: BundleInfo[]
  /** Centre-to-centre distance between neighbouring bundle centroids, mm. */
  bundleSpacing: { min: number; max: number } | null
  /**
   * Minimum clear distance between bars that are NOT in the same bundle, mm.
   * null when there are fewer than two independent bars/bundles.
   */
  minClear: number | null
  /** Pair governing `minClear`. */
  minClearPair: [number, number] | null
  /** Required clear distance for the governing pair, mm: max(φ, φeq of a bundle, 25). */
  clearLimit: number
  minClearOk: boolean
  overlaps: BarOverlap[]
  overlapping: Set<number>
}

/** Bundle-aware spacing + overlap audit of any bar list. */
export function spacingReport(bars: Rebar[]): SpacingReport {
  const bundles = analyseBundles(bars)
  const eqById = new Map(bundles.map((b) => [b.id, b.eqDia]))
  const sizeOf = (b: Rebar) => {
    const k = bundleIdOf(b)
    return k ? (eqById.get(k) ?? b.dia) : b.dia
  }

  let minClear: number | null = null
  let minClearPair: [number, number] | null = null
  let clearLimit = 25
  let minClearOk = true
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      if (sameBundle(bars[i], bars[j])) continue
      const c = clearDistance(bars[i], bars[j])
      const limit = Math.max(25, sizeOf(bars[i]), sizeOf(bars[j]))
      if (c < limit - 1e-6) minClearOk = false
      if (minClear === null || c < minClear) {
        minClear = c
        minClearPair = [i, j]
        clearLimit = limit
      }
    }
  }

  let bundleSpacing: SpacingReport['bundleSpacing'] = null
  if (bundles.length >= 2) {
    const nn = bundles.map((b, i) => {
      let best = Infinity
      bundles.forEach((o, j) => {
        if (i !== j) best = Math.min(best, Math.hypot(o.cx - b.cx, o.cy - b.cy))
      })
      return best
    })
    bundleSpacing = { min: Math.min(...nn), max: Math.max(...nn) }
  }

  const overlaps = detectBarOverlaps(bars)
  const overlapping = new Set<number>()
  for (const o of overlaps) {
    overlapping.add(o.i)
    overlapping.add(o.j)
  }
  return { bundles, bundleSpacing, minClear, minClearPair, clearLimit, minClearOk, overlaps, overlapping }
}
