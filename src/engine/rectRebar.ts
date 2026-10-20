import type { Point, Rebar, RebarFace, SectionGeometry } from './types'
import type { PredefinedSection } from './sections'
import { barArea, pointInPolygon } from './geometry'
import {
  auditCovers,
  FACE_LABELS,
  getCoverForFace,
  isAxisAlignedRect,
  outerCover,
  type CoverSpec,
} from './cover'
import {
  BUNDLE_PREFIX,
  clearDistance,
  detectBarOverlaps,
  OVERLAP_TOL,
  sameBundle,
} from './barSpacing'

/**
 * Advanced Rectangular Reinforcement Engine.
 *
 * Generates exact 2D bar coordinates (x, y, dia), bundle group IDs, layer indices,
 * face relationships, transverse spacer bar geometry, per-layer summaries, and
 * non-destructive validation diagnostics across all four faces of a rectangular
 * concrete section: Top, Bottom, Left, and Right.
 *
 * Design invariants:
 *  1. Pure function — zero mutation of user inputs; invalid custom spacings,
 *     oversized bundles, or excessive layer stacks produce explicit diagnostics
 *     rather than silently altering entered numbers.
 *  2. Exact circle-tangency geometry — mixed-diameter bundles (e.g. Ø25 + Ø16 or
 *     Ø25 + Ø20 + Ø16) rest flush against the stirrup/spacer line and satisfy
 *     exact surface-to-surface clearance `innerClear` with zero unintended overlap.
 *  3. Transverse spacer bars separate adjacent layers geometrically (`clearGap`)
 *     and render visually on the section diagram without adding spurious axial/
 *     flexural longitudinal steel area `As` to ULS, SLS, or Shear checks.
 *  4. Full compatibility with `auditCovers`, `spacingReport` (`BUNDLE_PREFIX`),
 *     `sectionProperties`, `buildAnalysisModel` (ULS), `buildSlsModel` (SLS),
 *     `crackWidthCheck`, and `shearSectionData` (Shear).
 */

export const RECT_FACES: RebarFace[] = ['top', 'bottom', 'left', 'right']

/** Polygon edge index of each named face in standard CCW rectangle order (0=bottom, 1=right, 2=top, 3=left). */
export const RECT_FACE_INDEX: Record<RebarFace, number> = {
  bottom: 0,
  right: 1,
  top: 2,
  left: 3,
}

export type RectLayerKind = 'uniform' | 'alternate' | 'bundle' | 'customGroups'
export type RectSpanMode = 'full' | 'between'
export type RectBundleOrientation = 'cluster' | 'along' | 'inward'
export type RectLayerDepthAlign = 'flush' | 'center'
export type RectLayerHorizontalAlign = 'independent' | 'stackFirst'

export const RECT_ARRANGEMENT_LABELS: Record<RectLayerKind, string> = {
  uniform: 'Uniform',
  alternate: 'Alternate ⌀',
  bundle: 'Bundles',
  customGroups: 'Mixed groups',
}

export interface RectFaceUnit {
  id: string
  kind: 'single' | 'bundle'
  /** Diameter (mm) for a single bar, or default diameter for bundle slots. */
  barDia: number
  /** Number of bars in this bundle when `kind === 'bundle'` (2, 3, 4, or custom). */
  barsPerBundle: number
  /** Individual bar diameters (mm) within the bundle — supports same or mixed diameters. */
  dias: number[]
  /** Optional per-bundle clear gap override (mm); `null` inherits layer `bundleInnerClear`. */
  innerClear: number | null
}

export interface RectFaceLayer {
  id: string
  kind: RectLayerKind
  /** Number of single bars along this layer (`uniform` and `alternate` modes). */
  nBars: number
  /** Primary bar diameter, mm (`uniform` and `bundle` modes). */
  barDia: number
  /** Repeating sequence of diameters, mm (`alternate` mode, e.g. [16, 20] or [16, 20, 25]). */
  patternDias: number[]
  /** Optional explicit c/c bar/unit spacing along the face, mm (`null` = equal spacing across face). */
  spacing: number | null

  // --- Bundle arrangement settings ---
  /** Number of bundle groups along the layer (`bundle` mode). */
  nBundles: number
  /** Number of bars per bundle (`2`, `3`, `4`, or custom positive integer). */
  barsPerBundle: number
  /** When true, each bar slot in the bundle uses its individual diameter in `bundleBarDias`. */
  bundleMixedDia: boolean
  /** Individual diameters of bars 1..m in each bundle, mm. */
  bundleBarDias: number[]
  /** Geometric layout of bars within a bundle. */
  bundleOrientation: RectBundleOrientation
  /** Clear distance between bars inside a bundle, mm (`0` = touching in direct contact). */
  bundleInnerClear: number
  /** Centre-to-centre spacing between adjacent bundle centroids along the face, mm (`null` = equal). */
  bundleSpacing: number | null

  // --- Mixed single + bundle units on the same face ---
  units: RectFaceUnit[]

  // --- Layer depth & alignment options ---
  /** Whether mixed diameters rest flush against the stirrup/spacer (`flush`) or share layer centre (`center`). */
  depthAlign: RectLayerDepthAlign
  /** Inner-layer along-face positioning: distribute independently or stack behind Layer 1 positions. */
  horizontalAlign: RectLayerHorizontalAlign
  /** Optional spacer bar diameter override separating the previous layer from this layer, mm (`null` = inherit). */
  spacerDiaOverride: number | null
  /** Optional clear vertical/perpendicular distance override between previous layer and this layer, mm (`null` = spacer ⌀). */
  clearGapOverride: number | null
}

export interface RectFaceConfig {
  enabled: boolean
  /**
   * `'full'` includes corner bar positions (default for Top & Bottom).
   * `'between'` places bars in the intermediate span between perpendicular corner bars (default for Left & Right).
   */
  spanMode: RectSpanMode
  /** Optional per-face spacer bar diameter override, mm (`null` = inherit global `spacerDia`). */
  spacerDiaOverride: number | null
  layers: RectFaceLayer[]
}

export interface RectAdvancedRebarConfig {
  enabled: boolean
  /** Last inspected / edited face in the UI panel. */
  activeFace: RebarFace
  /** Default transverse spacer bar diameter (Ø, mm) separating multi-layer reinforcement. */
  spacerDia: number
  faces: Record<RebarFace, RectFaceConfig>
}

/** Transverse spacer pin bar drawn visually between adjacent reinforcement layers on a face. */
export interface RectSpacerBar {
  id: string
  face: RebarFace
  fromLayer: number
  toLayer: number
  /** Spacer bar diameter (mm). */
  dia: number
  /** Clear perpendicular gap enforced between the two layers (mm). */
  clearGap: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface RectLayerSummary {
  face: RebarFace
  layerIndex: number
  barCount: number
  bundleCount: number
  /** Total steel cross-sectional area in this layer, mm². */
  area: number
  /** Minimum to maximum bar diameter in this layer, mm. */
  diasUsed: number[]
  /** Clear plane offset from outer concrete face to outer steel surface of this layer, mm. */
  outerDepth: number
  /** Area-weighted centroid distance from outer concrete face, mm. */
  centroidDepth: number
  /** Envelope thickness of this layer perpendicular to the face, mm. */
  envelope: number
  /** Spacer diameter separating previous layer from this layer (null for Layer 1), mm. */
  spacerDia: number | null
  /** Clear distance from previous layer (null for Layer 1), mm. */
  clearGapFromPrev: number | null
  /** Actual c/c spacing between adjacent units along the face (null when < 2 units), mm. */
  unitPitch: number | null
  /** Minimum clear gap between independent bars/bundles within this layer (null when < 2 units), mm. */
  minClearAlong: number | null
}

export type RectValidationCode =
  | 'empty'
  | 'outside'
  | 'cover'
  | 'overlap'
  | 'spacing'
  | 'spacer'
  | 'bundleSize'
  | 'layerDepth'

export interface RectValidationIssue {
  severity: 'warn' | 'error'
  code: RectValidationCode
  face?: RebarFace
  layer?: number
  message: string
}

export interface RectAdvancedRebarResult {
  bars: Rebar[]
  spacers: RectSpacerBar[]
  summaries: Record<RebarFace, RectLayerSummary[]>
  issues: RectValidationIssue[]
  warnings: string[]
}

/* ------------------------------------------------------------------ *
 * Identifiers & Default Factories
 * ------------------------------------------------------------------ */

let rectUidSeq = 1
export function newRectId(prefix = 'rl'): string {
  return `${prefix}-${rectUidSeq++}-${Math.random().toString(36).slice(2, 6)}`
}

export function isRectangularSection(
  geometry: SectionGeometry | null | undefined,
  predefined: PredefinedSection | null | undefined,
): boolean {
  if (predefined) return predefined.kind === 'rect'
  if (!geometry || geometry.boundary.length !== 4 || geometry.voids.length > 0) return false
  return isAxisAlignedRect(geometry.boundary)
}

export function defaultRectFaceUnit(
  kind: 'single' | 'bundle' = 'single',
  barDia = 20,
  barsPerBundle = 2,
): RectFaceUnit {
  const per = Math.max(2, Math.round(barsPerBundle))
  return {
    id: newRectId('ru'),
    kind,
    barDia,
    barsPerBundle: per,
    dias: Array.from({ length: per }, () => barDia),
    innerClear: null,
  }
}

export function defaultRectLayer(
  opts: Partial<RectFaceLayer> & { barDia?: number; nBars?: number } = {},
): RectFaceLayer {
  const dia = opts.barDia && opts.barDia > 0 ? opts.barDia : 25
  const nBars = opts.nBars !== undefined ? Math.max(0, Math.round(opts.nBars)) : 4
  return {
    id: opts.id ?? newRectId('rl'),
    kind: opts.kind ?? 'uniform',
    nBars,
    barDia: dia,
    patternDias: opts.patternDias?.length ? [...opts.patternDias] : [dia, dia >= 20 ? 16 : 20],
    spacing: opts.spacing ?? null,
    nBundles: opts.nBundles ?? Math.max(2, nBars > 0 ? Math.min(nBars, 4) : 2),
    barsPerBundle: opts.barsPerBundle ?? 2,
    bundleMixedDia: opts.bundleMixedDia ?? false,
    bundleBarDias: opts.bundleBarDias?.length ? [...opts.bundleBarDias] : [dia, dia],
    bundleOrientation: opts.bundleOrientation ?? 'cluster',
    bundleInnerClear: opts.bundleInnerClear ?? 0,
    bundleSpacing: opts.bundleSpacing ?? null,
    units:
      opts.units?.length
        ? opts.units.map((u) => ({ ...u, dias: [...u.dias] }))
        : [
            defaultRectFaceUnit('bundle', dia, 2),
            defaultRectFaceUnit('single', dia >= 20 ? 16 : dia, 2),
            defaultRectFaceUnit('single', dia >= 20 ? 16 : dia, 2),
            defaultRectFaceUnit('bundle', dia, 2),
          ],
    depthAlign: opts.depthAlign ?? 'flush',
    horizontalAlign: opts.horizontalAlign ?? 'independent',
    spacerDiaOverride: opts.spacerDiaOverride ?? null,
    clearGapOverride: opts.clearGapOverride ?? null,
  }
}

/**
 * Build a clean initial Advanced Rectangular Reinforcement configuration matching
 * a predefined rectangular section (`nx` top/bottom bars including corners, `ny`
 * intermediate side bars on left/right) so enabling Advanced mode starts in
 * 100% geometric agreement with the active section layout.
 */
export function defaultRectAdvancedConfig(
  opts: { nx?: number; ny?: number; barDia?: number; spacerDia?: number; enabled?: boolean } = {},
): RectAdvancedRebarConfig {
  const barDia = opts.barDia && opts.barDia > 0 ? opts.barDia : 25
  const nx = Math.max(2, Math.round(opts.nx ?? 4))
  const ny = Math.max(0, Math.round(opts.ny ?? 2))
  const spacerDia = opts.spacerDia !== undefined && opts.spacerDia >= 0 ? opts.spacerDia : 25
  return {
    enabled: opts.enabled ?? false,
    activeFace: 'bottom',
    spacerDia,
    faces: {
      top: {
        enabled: true,
        spanMode: 'full',
        spacerDiaOverride: null,
        layers: [defaultRectLayer({ id: 'top-L1', nBars: nx, barDia })],
      },
      bottom: {
        enabled: true,
        spanMode: 'full',
        spacerDiaOverride: null,
        layers: [defaultRectLayer({ id: 'bottom-L1', nBars: nx, barDia })],
      },
      left: {
        enabled: ny > 0,
        spanMode: 'between',
        spacerDiaOverride: null,
        layers: [defaultRectLayer({ id: 'left-L1', nBars: ny > 0 ? ny : 2, barDia })],
      },
      right: {
        enabled: ny > 0,
        spanMode: 'between',
        spacerDiaOverride: null,
        layers: [defaultRectLayer({ id: 'right-L1', nBars: ny > 0 ? ny : 2, barDia })],
      },
    },
  }
}

/** Seed from the app's current predefined rectangular shape when present. */
export function rectConfigFromSection(
  predefined: PredefinedSection | null | undefined,
  barDia: number,
  enabled = false,
): RectAdvancedRebarConfig {
  if (predefined && predefined.kind === 'rect') {
    return defaultRectAdvancedConfig({
      nx: predefined.nx,
      ny: predefined.ny,
      barDia,
      enabled,
    })
  }
  return defaultRectAdvancedConfig({ barDia, enabled })
}

/* ------------------------------------------------------------------ *
 * Sanitization & Unit Conversion Helpers
 * ------------------------------------------------------------------ */

function cleanDia(v: unknown, fallback = 20): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(0.0001, Math.round(n * 10000) / 10000)
}

function cleanNonNeg(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n * 10000) / 10000
}

function cleanPosOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null
}

function cleanNonNegOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null
}

/** Diameters of every bar in a layer's repeated bundle definition (never clamping count below 1). */
export function layerBundleDiameters(layer: Pick<RectFaceLayer, 'barDia' | 'barsPerBundle' | 'bundleMixedDia' | 'bundleBarDias'>): number[] {
  const count = Math.max(1, Math.round(layer.barsPerBundle))
  return Array.from({ length: count }, (_, k) => {
    const raw = layer.bundleMixedDia ? layer.bundleBarDias[k] : layer.barDia
    return cleanDia(raw, layer.barDia)
  })
}

/** Diameters of every bar in a `RectFaceUnit`. */
export function unitDiameters(unit: RectFaceUnit): number[] {
  if (unit.kind === 'single') return [cleanDia(unit.barDia, 20)]
  const count = Math.max(1, Math.round(unit.barsPerBundle))
  return Array.from({ length: count }, (_, k) => cleanDia(unit.dias[k], cleanDia(unit.barDia, 20)))
}

/**
 * Materialize any layer mode (`uniform`, `alternate`, `bundle`, `customGroups`)
 * into an explicit array of `RectFaceUnit`s so users can one-click convert any
 * parametric face/layer into individually editable bars and bundles.
 */
export function expandLayerToUnits(layer: RectFaceLayer): RectFaceUnit[] {
  switch (layer.kind) {
    case 'uniform': {
      const n = Math.max(0, Math.round(layer.nBars))
      const dia = cleanDia(layer.barDia, 20)
      return Array.from({ length: n }, () => ({
        id: newRectId('ru'),
        kind: 'single' as const,
        barDia: dia,
        barsPerBundle: 2,
        dias: [dia, dia],
        innerClear: null,
      }))
    }
    case 'alternate': {
      const n = Math.max(0, Math.round(layer.nBars))
      const seq = layer.patternDias.length > 0 ? layer.patternDias.map((d) => cleanDia(d, layer.barDia)) : [cleanDia(layer.barDia, 20)]
      return Array.from({ length: n }, (_, i) => {
        const dia = seq[i % seq.length]
        return {
          id: newRectId('ru'),
          kind: 'single' as const,
          barDia: dia,
          barsPerBundle: 2,
          dias: [dia, dia],
          innerClear: null,
        }
      })
    }
    case 'bundle': {
      const nB = Math.max(0, Math.round(layer.nBundles))
      const dias = layerBundleDiameters(layer)
      return Array.from({ length: nB }, () => ({
        id: newRectId('ru'),
        kind: 'bundle' as const,
        barDia: dias[0] ?? cleanDia(layer.barDia, 20),
        barsPerBundle: dias.length,
        dias: [...dias],
        innerClear: null,
      }))
    }
    case 'customGroups':
      return layer.units.map((u) => {
        const dias = unitDiameters(u)
        return {
          id: u.id || newRectId('ru'),
          kind: u.kind === 'bundle' ? 'bundle' : 'single',
          barDia: cleanDia(u.barDia, dias[0] ?? 20),
          barsPerBundle: u.kind === 'bundle' ? Math.max(2, Math.round(u.barsPerBundle || dias.length)) : Math.max(2, Math.round(u.barsPerBundle || 2)),
          dias: u.kind === 'bundle' ? dias : [dias[0], dias[0]],
          innerClear: cleanNonNegOrNull(u.innerClear),
        }
      })
  }
}

export function sanitizeRectLayer(raw: any, fallbackDia = 25): RectFaceLayer {
  const kinds: RectLayerKind[] = ['uniform', 'alternate', 'bundle', 'customGroups']
  const kind: RectLayerKind = kinds.includes(raw?.kind) ? raw.kind : 'uniform'
  const barDia = cleanDia(raw?.barDia, fallbackDia)
  const orientations: RectBundleOrientation[] = ['cluster', 'along', 'inward']
  const bundleOrientation: RectBundleOrientation = orientations.includes(raw?.bundleOrientation)
    ? raw.bundleOrientation
    : 'cluster'
  const patternDias = Array.isArray(raw?.patternDias) && raw.patternDias.length > 0
    ? raw.patternDias.map((d: any) => cleanDia(d, barDia))
    : [barDia, barDia >= 20 ? 16 : 20]
  const barsPerBundle = Number.isFinite(Number(raw?.barsPerBundle)) && Number(raw.barsPerBundle) >= 1
    ? Math.round(Number(raw.barsPerBundle))
    : 2
  const bundleBarDias = Array.isArray(raw?.bundleBarDias) && raw.bundleBarDias.length > 0
    ? raw.bundleBarDias.map((d: any) => cleanDia(d, barDia))
    : Array.from({ length: Math.max(2, barsPerBundle) }, () => barDia)
  const units: RectFaceUnit[] = Array.isArray(raw?.units)
    ? raw.units.map((u: any) => {
        const uDia = cleanDia(u?.barDia, barDia)
        const uPer = Number.isFinite(Number(u?.barsPerBundle)) && Number(u.barsPerBundle) >= 1
          ? Math.round(Number(u.barsPerBundle))
          : 2
        const uDias = Array.isArray(u?.dias) && u.dias.length > 0
          ? u.dias.map((d: any) => cleanDia(d, uDia))
          : Array.from({ length: uPer }, () => uDia)
        return {
          id: typeof u?.id === 'string' && u.id ? u.id : newRectId('ru'),
          kind: u?.kind === 'bundle' ? 'bundle' : 'single',
          barDia: uDia,
          barsPerBundle: uPer,
          dias: uDias,
          innerClear: cleanNonNegOrNull(u?.innerClear),
        }
      })
    : []

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newRectId('rl'),
    kind,
    nBars: Number.isFinite(Number(raw?.nBars)) ? Math.max(0, Math.round(Number(raw.nBars))) : 4,
    barDia,
    patternDias,
    spacing: cleanPosOrNull(raw?.spacing),
    nBundles: Number.isFinite(Number(raw?.nBundles)) ? Math.max(0, Math.round(Number(raw.nBundles))) : 2,
    barsPerBundle,
    bundleMixedDia: Boolean(raw?.bundleMixedDia),
    bundleBarDias,
    bundleOrientation,
    bundleInnerClear: cleanNonNeg(raw?.bundleInnerClear, 0),
    bundleSpacing: cleanPosOrNull(raw?.bundleSpacing),
    units,
    depthAlign: raw?.depthAlign === 'center' ? 'center' : 'flush',
    horizontalAlign: raw?.horizontalAlign === 'stackFirst' ? 'stackFirst' : 'independent',
    spacerDiaOverride: cleanNonNegOrNull(raw?.spacerDiaOverride),
    clearGapOverride: cleanNonNegOrNull(raw?.clearGapOverride),
  }
}

export function sanitizeRectAdvancedConfig(
  raw: any,
  fallbackDia = 25,
): RectAdvancedRebarConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const base = defaultRectAdvancedConfig({ barDia: fallbackDia })
  const validFaces: RebarFace[] = ['top', 'bottom', 'left', 'right']
  const activeFace: RebarFace = validFaces.includes(raw.activeFace) ? raw.activeFace : 'bottom'
  const spacerDia = cleanNonNeg(raw.spacerDia, 25)
  const faces = {} as Record<RebarFace, RectFaceConfig>
  for (const f of validFaces) {
    const rf = raw.faces?.[f]
    const defFace = base.faces[f]
    faces[f] = {
      enabled: typeof rf?.enabled === 'boolean' ? rf.enabled : defFace.enabled,
      spanMode: rf?.spanMode === 'full' || rf?.spanMode === 'between' ? rf.spanMode : defFace.spanMode,
      spacerDiaOverride: cleanNonNegOrNull(rf?.spacerDiaOverride),
      layers:
        Array.isArray(rf?.layers) && rf.layers.length > 0
          ? rf.layers.map((l: any) => sanitizeRectLayer(l, fallbackDia))
          : defFace.layers,
    }
  }
  return {
    enabled: Boolean(raw.enabled),
    activeFace,
    spacerDia,
    faces,
  }
}

/* ------------------------------------------------------------------ *
 * Exact Local Cluster Packing in Face Frame (u along face, v inward)
 * ------------------------------------------------------------------ */

interface LocalBar {
  /** Offset along face tangent relative to unit centre (mm). */
  u: number
  /** Offset inward from layer's outer steel plane (mm). Always >= dia/2. */
  v: number
  dia: number
}

interface BuiltUnit {
  isBundle: boolean
  bars: LocalBar[]
  /** Half-width to the left (-u) from unit anchor: max(-u_j + r_j), mm. */
  leftHalf: number
  /** Half-width to the right (+u) from unit anchor: max(+u_j + r_j), mm. */
  rightHalf: number
  /** Total tangential width leftHalf + rightHalf, mm. */
  width: number
  /** Inward thickness from layer's outer steel plane: max(v_j + r_j), mm. */
  envelope: number
  /** Original configured bar count in this unit (e.g. >4 check). */
  rawBundleSize: number
}

/**
 * Tangent horizontal step between two circles of diameters `d0`, `d1` both
 * resting on `v = 0` (`v0 = d0/2`, `v1 = d1/2`) separated by clear gap `g >= 0`.
 */
function tangentStepFlush(d0: number, d1: number, g: number): number {
  return Math.sqrt(Math.max(0, d0 * d1 + g * (d0 + d1 + g)))
}

/**
 * Pack a single bar or an m-bar bundle of arbitrary diameters `dias` in local
 * coordinates `(u, v)` where `v = 0` is the inner edge of the stirrup / spacer
 * bar and `+v` points into the concrete core.
 *
 * Guarantees for all positive diameters and `innerClear >= 0`:
 *  - Every bar satisfies `v_j >= dia_j / 2` (never intrudes into cover / spacer).
 *  - Every pair `(i, j)` in the unit satisfies `clearDistance >= innerClear`.
 *  - Outer tangential bounding box is centred symmetrically (`[-W/2, +W/2]`)
 *    around `u = 0`, so `leftHalf === rightHalf === W / 2`.
 */
function buildLocalUnit(
  isBundle: boolean,
  dias: number[],
  innerClear: number,
  orientation: RectBundleOrientation,
  depthAlign: RectLayerDepthAlign,
  layerMaxSingleDia: number,
): BuiltUnit {
  const g = Math.max(0, innerClear)
  if (!isBundle || dias.length <= 1) {
    const d = dias[0] ?? 20
    const v = depthAlign === 'center' ? Math.max(d, layerMaxSingleDia) / 2 : d / 2
    return {
      isBundle: false,
      bars: [{ u: 0, v, dia: d }],
      leftHalf: d / 2,
      rightHalf: d / 2,
      width: d,
      envelope: v + d / 2,
      rawBundleSize: 1,
    }
  }

  const m = dias.length
  const raw: LocalBar[] = []

  if (orientation === 'inward') {
    // 1-column stack marching strictly inward (+v)
    let curV = dias[0] / 2
    raw.push({ u: 0, v: curV, dia: dias[0] })
    for (let k = 1; k < m; k++) {
      curV += (dias[k - 1] + dias[k]) / 2 + g
      raw.push({ u: 0, v: curV, dia: dias[k] })
    }
  } else if (orientation === 'along' || m === 2) {
    // Side-by-side along the face on the outer plane (or concentric line when depthAlign === 'center')
    const maxD = Math.max(...dias)
    let curU = 0
    for (let k = 0; k < m; k++) {
      const d = dias[k]
      if (k > 0) {
        const prevD = dias[k - 1]
        curU += depthAlign === 'center' ? (prevD + d) / 2 + g : tangentStepFlush(prevD, d, g)
      }
      const v = depthAlign === 'center' ? maxD / 2 : d / 2
      raw.push({ u: curU, v, dia: d })
    }
  } else if (m === 3) {
    // Exact 3-circle nested triangular cluster: 2 base bars flush on v = r_k, 3rd nested inward
    const [d0, d1, d2] = dias
    const r0 = d0 / 2
    const r1 = d1 / 2
    const r2 = d2 / 2
    const v0 = depthAlign === 'center' ? Math.max(r0, r1) : r0
    const v1 = depthAlign === 'center' ? Math.max(r0, r1) : r1
    const du = depthAlign === 'center' ? r0 + r1 + g : tangentStepFlush(d0, d1, g)
    const dv = v1 - v0
    const L = Math.hypot(du, dv)
    const L0 = r0 + r2 + g
    const L1 = r1 + r2 + g
    const ex = du / L
    const ey = dv / L
    // Inward unit normal (+v component is du / L > 0)
    const px = -ey
    const py = ex
    const a = (L0 * L0 - L1 * L1 + L * L) / (2 * L)
    const h = Math.sqrt(Math.max(0, L0 * L0 - a * a))
    raw.push(
      { u: 0, v: v0, dia: d0 },
      { u: du, v: v1, dia: d1 },
      { u: a * ex + h * px, v: Math.max(r2, v0 + a * ey + h * py), dia: d2 },
    )
  } else {
    // 4+ bars in cluster mode: compact 2-column × ceil(m/2)-row grid going inward
    const nRows = Math.ceil(m / 2)
    let rowBasePlane = 0
    for (let r = 0; r < nRows; r++) {
      const dLeft = dias[2 * r]
      const hasRight = 2 * r + 1 < m
      const dRight = hasRight ? dias[2 * r + 1] : 0
      const rowMax = Math.max(dLeft, dRight)
      if (!hasRight) {
        // Odd trailing bar centered inward behind the previous pair
        raw.push({ u: 0, v: rowBasePlane + dLeft / 2, dia: dLeft })
        rowBasePlane += dLeft + g
      } else {
        const du = depthAlign === 'center' || r > 0 ? (dLeft + dRight) / 2 + g : tangentStepFlush(dLeft, dRight, g)
        const vL = depthAlign === 'center' || r > 0 ? rowBasePlane + rowMax / 2 : rowBasePlane + dLeft / 2
        const vR = depthAlign === 'center' || r > 0 ? rowBasePlane + rowMax / 2 : rowBasePlane + dRight / 2
        raw.push({ u: -du / 2, v: vL, dia: dLeft }, { u: du / 2, v: vR, dia: dRight })
        rowBasePlane += rowMax + g
      }
    }
  }

  // Centre tangential bounding box symmetrically around u = 0
  const minEdge = Math.min(...raw.map((b) => b.u - b.dia / 2))
  const maxEdge = Math.max(...raw.map((b) => b.u + b.dia / 2))
  const midU = (minEdge + maxEdge) / 2
  const width = maxEdge - minEdge
  const bars = raw.map((b) => ({ u: b.u - midU, v: b.v, dia: b.dia }))
  const envelope = Math.max(...bars.map((b) => b.v + b.dia / 2))

  return {
    isBundle,
    bars,
    leftHalf: width / 2,
    rightHalf: width / 2,
    width,
    envelope,
    rawBundleSize: m,
  }
}

/**
 * Symmetric index selector when aligning a sparser inner layer (`count < total`)
 * behind outer Layer 1 unit positions: fills outer corners first from both ends
 * inward (and the middle slot when `count` is odd), sorted in ascending order.
 */
function selectSymmetricPositions(basePositions: number[], count: number): number[] {
  const M = basePositions.length
  if (count <= 0 || M === 0) return []
  if (count === M) return [...basePositions]
  if (count === 1) return [(basePositions[0] + basePositions[M - 1]) / 2]
  if (count < M) {
    const picked: number[] = []
    let lo = 0
    let hi = M - 1
    while (picked.length + 2 <= count && lo < hi) {
      picked.push(lo, hi)
      lo++
      hi--
    }
    if (picked.length < count) {
      picked.push(Math.floor((lo + hi) / 2))
    }
    picked.sort((a, b) => a - b)
    return picked.map((idx) => basePositions[idx])
  }
  // If inner layer has MORE units than Layer 1, span evenly between Layer 1's outer anchors
  const start = basePositions[0]
  const end = basePositions[M - 1]
  return Array.from({ length: count }, (_, i) => start + (i / (count - 1)) * (end - start))
}

/* ------------------------------------------------------------------ *
 * Main Coordinate & Spacer Generator + Non-Destructive Validator
 * ------------------------------------------------------------------ */

interface FaceAxisFrame {
  face: RebarFace
  faceIndex: number
  /** Coordinate of this concrete face on its normal axis (mm). */
  faceCoord: number
  /** +1 if inward core is toward larger normal coordinate (bottom, left); -1 otherwise (top, right). */
  inwardSign: 1 | -1
  /** Axis along which bars are distributed on this face. */
  alongAxis: 'x' | 'y'
  /** Minimum coordinate along `alongAxis` (xmin for top/bottom, ymin for left/right). */
  sMin: number
  /** Maximum coordinate along `alongAxis` (xmax for top/bottom, ymax for left/right). */
  sMax: number
  /** Perpendicular face at `sMin` and its polygon edge index. */
  startFace: RebarFace
  startFaceIndex: number
  /** Perpendicular face at `sMax` and its polygon edge index. */
  endFace: RebarFace
  endFaceIndex: number
  /** Convert `(s along face, depth inward from outer concrete face)` -> world `(x, y)`. */
  toXY: (s: number, depthFromFace: number) => Point
}

function getFaceFrame(
  face: RebarFace,
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
): FaceAxisFrame {
  switch (face) {
    case 'bottom':
      return {
        face: 'bottom',
        faceIndex: 0,
        faceCoord: ymin,
        inwardSign: 1,
        alongAxis: 'x',
        sMin: xmin,
        sMax: xmax,
        startFace: 'left',
        startFaceIndex: 3,
        endFace: 'right',
        endFaceIndex: 1,
        toXY: (s, depth) => ({ x: s, y: ymin + depth }),
      }
    case 'top':
      return {
        face: 'top',
        faceIndex: 2,
        faceCoord: ymax,
        inwardSign: -1,
        alongAxis: 'x',
        sMin: xmin,
        sMax: xmax,
        startFace: 'left',
        startFaceIndex: 3,
        endFace: 'right',
        endFaceIndex: 1,
        toXY: (s, depth) => ({ x: s, y: ymax - depth }),
      }
    case 'left':
      return {
        face: 'left',
        faceIndex: 3,
        faceCoord: xmin,
        inwardSign: 1,
        alongAxis: 'y',
        sMin: ymin,
        sMax: ymax,
        startFace: 'bottom',
        startFaceIndex: 0,
        endFace: 'top',
        endFaceIndex: 2,
        toXY: (s, depth) => ({ x: xmin + depth, y: s }),
      }
    case 'right':
      return {
        face: 'right',
        faceIndex: 1,
        faceCoord: xmax,
        inwardSign: -1,
        alongAxis: 'y',
        sMin: ymin,
        sMax: ymax,
        startFace: 'bottom',
        startFaceIndex: 0,
        endFace: 'top',
        endFaceIndex: 2,
        toXY: (s, depth) => ({ x: xmax - depth, y: s }),
      }
  }
}

/** First-layer envelope on a face (used so `'between'` faces respect adjacent face bar diameters). */
function outerLayerCornerHalfDia(faceCfg: RectFaceConfig, fallbackDia = 25): number {
  if (!faceCfg.enabled || faceCfg.layers.length === 0) return fallbackDia / 2
  const l0 = faceCfg.layers[0]
  switch (l0.kind) {
    case 'uniform':
      return cleanDia(l0.barDia, fallbackDia) / 2
    case 'alternate':
      return Math.max(...(l0.patternDias.length ? l0.patternDias : [l0.barDia]).map((d) => cleanDia(d, fallbackDia))) / 2
    case 'bundle': {
      const dias = layerBundleDiameters(l0)
      const built = buildLocalUnit(dias.length > 1, dias, l0.bundleInnerClear, l0.bundleOrientation, l0.depthAlign, Math.max(...dias))
      return built.envelope / 2
    }
    case 'customGroups': {
      if (l0.units.length === 0) return fallbackDia / 2
      const env = Math.max(
        ...l0.units.map((u) => {
          const dias = unitDiameters(u)
          return buildLocalUnit(
            u.kind === 'bundle' && dias.length > 1,
            dias,
            u.innerClear ?? l0.bundleInnerClear,
            l0.bundleOrientation,
            l0.depthAlign,
            Math.max(...dias),
          ).envelope
        }),
      )
      return env / 2
    }
  }
}

export function autoUnitSpacingForLayer(
  cfg: RectAdvancedRebarConfig,
  face: RebarFace,
  layerIndex: number,
  geometry: SectionGeometry,
  cover: CoverSpec,
  tieDia: number,
): number {
  const withoutManualSpacing: RectAdvancedRebarConfig = {
    ...cfg,
    faces: {
      ...cfg.faces,
      [face]: {
        ...cfg.faces[face],
        layers: cfg.faces[face].layers.map((l, idx) =>
          idx === layerIndex ? { ...l, spacing: null, bundleSpacing: null } : l,
        ),
      },
    },
  }
  const res = generateRectAdvancedRebar(withoutManualSpacing, geometry, cover, tieDia)
  return res.summaries[face]?.[layerIndex]?.unitPitch ?? 0
}

export function generateRectAdvancedRebar(
  cfg: RectAdvancedRebarConfig,
  geometry: SectionGeometry,
  cover: CoverSpec,
  tieDia: number,
): RectAdvancedRebarResult {
  const summaries: Record<RebarFace, RectLayerSummary[]> = {
    top: [],
    bottom: [],
    left: [],
    right: [],
  }
  const bars: Rebar[] = []
  const spacers: RectSpacerBar[] = []
  const issues: RectValidationIssue[] = []

  if (geometry.boundary.length < 3) {
    return { bars, spacers, summaries, issues, warnings: [] }
  }

  const xs = geometry.boundary.map((p) => p.x)
  const ys = geometry.boundary.map((p) => p.y)
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  const tie = Math.max(0, tieDia)

  // Track which face+layer produced each bar index for crisp per-face diagnostics
  const barMeta: { face: RebarFace; layerIndex: number }[] = []

  // Process faces in canonical order: bottom, top, left, right (matches standard `generateSection('rect')` ordering!)
  const generationOrder: RebarFace[] = ['bottom', 'top', 'left', 'right']

  for (const face of generationOrder) {
    const faceCfg = cfg.faces[face]
    if (!faceCfg || !faceCfg.enabled || faceCfg.layers.length === 0) continue

    const frame = getFaceFrame(face, xmin, xmax, ymin, ymax)
    const cFace = getCoverForFace(cover, 'outer', frame.faceIndex, 0, geometry)
    const cStart = getCoverForFace(cover, 'outer', frame.startFaceIndex, 0, geometry)
    const cEnd = getCoverForFace(cover, 'outer', frame.endFaceIndex, 0, geometry)

    const sectionDepthInward = frame.alongAxis === 'x' ? ymax - ymin : xmax - xmin
    const oppositeFaceIndex = frame.face === 'bottom' ? 2 : frame.face === 'top' ? 0 : frame.face === 'left' ? 1 : 3
    const cOpposite = getCoverForFace(cover, 'outer', oppositeFaceIndex, 0, geometry)

    let currentOuterPlane = cFace + tie
    let prevLayerInnerPlane: number | null = null
    let prevLayerBarEdges: { minS: number; maxS: number; maxDia: number } | null = null
    let layer0UnitPositions: number[] = []
    let prevRenderedLayerIdx = 0

    faceCfg.layers.forEach((layer, layerIdx) => {
      // 1. Expand configured units for this layer
      const rawUnits = expandLayerToUnits(layer)
      if (rawUnits.length === 0) {
        issues.push({
          severity: 'warn',
          code: 'empty',
          face,
          layer: layerIdx + 1,
          message: `${FACE_LABELS[face]} Layer ${layerIdx + 1} has 0 bars configured.`,
        })
        return
      }

      const maxSingleDia = Math.max(
        0,
        ...rawUnits.filter((u) => u.kind === 'single').map((u) => cleanDia(u.barDia, layer.barDia)),
      )

      const builtUnits: BuiltUnit[] = rawUnits.map((u) => {
        const dias = unitDiameters(u)
        const isBundle = u.kind === 'bundle' && dias.length >= 2
        const innerClear = u.innerClear !== null ? u.innerClear : layer.bundleInnerClear
        return buildLocalUnit(
          isBundle,
          dias,
          innerClear,
          layer.bundleOrientation,
          layer.depthAlign,
          maxSingleDia || Math.max(...dias),
        )
      })

      // Check bundle bar-count code recommendation (>4 bars per bundle) without modifying input
      const oversized = builtUnits.find((b) => b.isBundle && b.rawBundleSize > 4)
      if (oversized) {
        issues.push({
          severity: 'warn',
          code: 'bundleSize',
          face,
          layer: layerIdx + 1,
          message: `${FACE_LABELS[face]} Layer ${layerIdx + 1}: ${oversized.rawBundleSize} bars in a bundle exceeds the standard 4-bar code limit (IS 456 Cl 26.5.1.6 / IRC 112 Cl 16.4).`,
        })
      }

      // 2. Compute layer depth from concrete face & spacer bar between previous layer and this layer
      let spacerDiaUsed: number | null = null
      let clearGapUsed: number | null = null
      if (prevLayerInnerPlane !== null) {
        spacerDiaUsed =
          layer.spacerDiaOverride !== null
            ? layer.spacerDiaOverride
            : faceCfg.spacerDiaOverride !== null
              ? faceCfg.spacerDiaOverride
              : cfg.spacerDia
        clearGapUsed = layer.clearGapOverride !== null ? layer.clearGapOverride : spacerDiaUsed
        currentOuterPlane = prevLayerInnerPlane + clearGapUsed
      }

      // 3. Compute unit anchor positions along the face (`s` in world axis coordinates)
      const M = builtUnits.length
      const firstHalf = builtUnits[0].leftHalf
      const lastHalf = builtUnits[M - 1].rightHalf

      let sStartLimit: number
      let sEndLimit: number
      if (faceCfg.spanMode === 'between') {
        // Reserve corner bar line on both perpendicular faces so intermediate bars sit cleanly between them
        const startPerpHalf = outerLayerCornerHalfDia(cfg.faces[frame.startFace], layer.barDia)
        const endPerpHalf = outerLayerCornerHalfDia(cfg.faces[frame.endFace], layer.barDia)
        sStartLimit = frame.sMin + cStart + tie + startPerpHalf
        sEndLimit = frame.sMax - (cEnd + tie + endPerpHalf)
      } else {
        sStartLimit = frame.sMin + cStart + tie + firstHalf
        sEndLimit = frame.sMax - (cEnd + tie + lastHalf)
      }

      const explicitSpacing = layer.kind === 'bundle' ? layer.bundleSpacing : layer.spacing
      let positions: number[]
      if (explicitSpacing !== null && explicitSpacing > 0 && M >= 2) {
        // Honour exact user spacing centred on the face (never silently clamped!)
        const midS = (frame.sMin + frame.sMax) / 2
        const totalSpan = (M - 1) * explicitSpacing
        positions = Array.from({ length: M }, (_, i) => midS - totalSpan / 2 + i * explicitSpacing)
      } else if (layerIdx > 0 && layer.horizontalAlign === 'stackFirst' && layer0UnitPositions.length > 0) {
        positions = selectSymmetricPositions(layer0UnitPositions, M)
      } else if (faceCfg.spanMode === 'between') {
        positions = Array.from(
          { length: M },
          (_, i) => sStartLimit + ((i + 1) / (M + 1)) * (sEndLimit - sStartLimit),
        )
      } else if (M === 1) {
        positions = [(sStartLimit + sEndLimit) / 2]
      } else {
        positions = Array.from(
          { length: M },
          (_, i) => sStartLimit + (i / (M - 1)) * (sEndLimit - sStartLimit),
        )
      }

      if (layerIdx === 0) {
        layer0UnitPositions = [...positions]
      }

      // 4. Emit Rebar entries for every bar in every unit of this layer
      const layerBarsStartIdx = bars.length
      let bundleCounter = 0
      let minSBarEdge = Infinity
      let maxSBarEdge = -Infinity
      const spanDenom = sEndLimit - sStartLimit

      builtUnits.forEach((unit, uIdx) => {
        const anchorS = positions[uIdx]
        const groupId = unit.isBundle
          ? `${BUNDLE_PREFIX}${face}-L${layerIdx + 1}-B${++bundleCounter}`
          : undefined
        const isFirstCorner =
          faceCfg.spanMode === 'full' && M >= 2 && uIdx === 0 && explicitSpacing === null
        const isLastCorner =
          faceCfg.spanMode === 'full' && M >= 2 && uIdx === M - 1 && explicitSpacing === null

        unit.bars.forEach((lb, bInUnit) => {
          const s = anchorS + lb.u
          const depth = currentOuterPlane + lb.v
          const pt = frame.toXY(s, depth)
          minSBarEdge = Math.min(minSBarEdge, s - lb.dia / 2)
          maxSBarEdge = Math.max(maxSBarEdge, s + lb.dia / 2)

          const cornerFaces: RebarFace[] = []
          let secFaceIdx: number | undefined = undefined
          if (isFirstCorner && bInUnit === 0) {
            cornerFaces.push(frame.startFace)
            secFaceIdx = frame.startFaceIndex
          } else if (isLastCorner && bInUnit === unit.bars.length - 1) {
            cornerFaces.push(frame.endFace)
            secFaceIdx = frame.endFaceIndex
          }
          const facesArr: RebarFace[] = [face, ...cornerFaces]
          const uNorm = Math.abs(spanDenom) > 1e-6 ? Math.max(0, Math.min(1, (s - sStartLimit) / spanDenom)) : 0.5

          bars.push({
            x: Math.round(pt.x * 100) / 100,
            y: Math.round(pt.y * 100) / 100,
            dia: lb.dia,
            positioning: 'automatic',
            face,
            faces: facesArr,
            faceIndex: frame.faceIndex,
            secondaryFaceIndex: secFaceIdx,
            startFaceIndex: frame.startFaceIndex,
            endFaceIndex: frame.endFaceIndex,
            faceIndices: secFaceIdx !== undefined ? [frame.faceIndex, secFaceIdx] : [frame.faceIndex],
            surface: 'outer',
            layer: layerIdx,
            axis: frame.alongAxis,
            u: Math.round(uNorm * 10000) / 10000,
            ...(groupId ? { groupId } : {}),
          })
          barMeta.push({ face, layerIndex: layerIdx })
        })
      })

      const layerBars = bars.slice(layerBarsStartIdx)
      const layerEnvelope = Math.max(...builtUnits.map((u) => u.envelope))
      const layerArea = layerBars.reduce((acc, b) => acc + barArea(b.dia), 0)
      const centroidDepth =
        layerArea > 0
          ? layerBars.reduce((acc, b) => {
              const dFromFace =
                frame.alongAxis === 'x'
                  ? Math.abs(b.y - frame.faceCoord)
                  : Math.abs(b.x - frame.faceCoord)
              return acc + barArea(b.dia) * dFromFace
            }, 0) / layerArea
          : currentOuterPlane + layerEnvelope / 2

      // 5. Emit visual transverse Spacer Bar between previous rendered layer and this layer
      const thisLayerMaxDia = Math.max(...layerBars.map((b) => b.dia))
      if (prevLayerInnerPlane !== null && prevLayerBarEdges !== null && spacerDiaUsed !== null && clearGapUsed !== null) {
        const spacerCenterDepth = prevLayerInnerPlane + clearGapUsed / 2
        const barSpanStart = Math.min(prevLayerBarEdges.minS, minSBarEdge)
        const barSpanEnd = Math.max(prevLayerBarEdges.maxS, maxSBarEdge)
        if (spacerDiaUsed > 0 && clearGapUsed > 0) {
          const pA = frame.toXY(barSpanStart, spacerCenterDepth)
          const pB = frame.toXY(barSpanEnd, spacerCenterDepth)
          spacers.push({
            id: `spacer-${face}-${prevRenderedLayerIdx}-${layerIdx + 1}`,
            face,
            fromLayer: prevRenderedLayerIdx - 1,
            toLayer: layerIdx,
            dia: Math.min(spacerDiaUsed, clearGapUsed),
            clearGap: clearGapUsed,
            x1: Math.round(pA.x * 100) / 100,
            y1: Math.round(pA.y * 100) / 100,
            x2: Math.round(pB.x * 100) / 100,
            y2: Math.round(pB.y * 100) / 100,
          })
        }

        // Validate vertical/perpendicular clear distance between layers per IS 456 Cl 26.3.2 / IRC 112 Cl 15.2.1
        const maxAdjDia = Math.max(prevLayerBarEdges.maxDia, thisLayerMaxDia)
        const minLayerClearReq = Math.max(15, maxAdjDia)
        if (clearGapUsed < minLayerClearReq - 1e-6) {
          issues.push({
            severity: clearGapUsed <= 0 ? 'error' : 'warn',
            code: 'spacer',
            face,
            layer: layerIdx + 1,
            message: `${FACE_LABELS[face]} Layers ${prevRenderedLayerIdx}–${layerIdx + 1}: layer clear distance ${clearGapUsed.toFixed(1)} mm (spacer ⌀${spacerDiaUsed.toFixed(0)}) is less than ${minLayerClearReq.toFixed(0)} mm (max adjacent bar ⌀ / 15 mm minimum, IS 456 Cl 26.3.2).`,
          })
        }
      }

      // Check whether this layer crosses beyond opposite concrete cover
      const innerEdge = currentOuterPlane + layerEnvelope
      const maxAllowedDepth = sectionDepthInward - cOpposite - tie
      if (innerEdge > maxAllowedDepth + 1e-6) {
        issues.push({
          severity: 'error',
          code: 'layerDepth',
          face,
          layer: layerIdx + 1,
          message: `${FACE_LABELS[face]} Layer ${layerIdx + 1} reaches depth ${innerEdge.toFixed(1)} mm, intruding past the opposite face cover limit (${maxAllowedDepth.toFixed(1)} mm available).`,
        })
      }

      // Compute clear spacing along this layer between independent bars/bundles
      let minClearAlong: number | null = null
      for (let i = 0; i < layerBars.length; i++) {
        for (let j = i + 1; j < layerBars.length; j++) {
          if (sameBundle(layerBars[i], layerBars[j])) continue
          const c = clearDistance(layerBars[i], layerBars[j])
          minClearAlong = minClearAlong === null ? c : Math.min(minClearAlong, c)
        }
      }
      const unitPitch = M >= 2 ? Math.abs(positions[1] - positions[0]) : null

      summaries[face].push({
        face,
        layerIndex: layerIdx,
        barCount: layerBars.length,
        bundleCount: bundleCounter,
        area: layerArea,
        diasUsed: [...new Set(layerBars.map((b) => b.dia))].sort((a, b) => a - b),
        outerDepth: Math.round(currentOuterPlane * 100) / 100,
        centroidDepth: Math.round(centroidDepth * 100) / 100,
        envelope: Math.round(layerEnvelope * 100) / 100,
        spacerDia: spacerDiaUsed,
        clearGapFromPrev: clearGapUsed,
        unitPitch: unitPitch !== null ? Math.round(unitPitch * 100) / 100 : null,
        minClearAlong: minClearAlong !== null ? Math.round(minClearAlong * 100) / 100 : null,
      })

      prevLayerInnerPlane = currentOuterPlane + layerEnvelope
      prevLayerBarEdges = { minS: minSBarEdge, maxS: maxSBarEdge, maxDia: thisLayerMaxDia }
      prevRenderedLayerIdx = layerIdx + 1
    })
  }

  // 6. Global boundary, cover, spacing, and overlap validation across the full section
  if (bars.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty',
      message: 'No reinforcement bars generated — enable at least one face and add bars.',
    })
  } else {
    // 6a. Outside concrete boundary check
    const outsideByFace = new Map<RebarFace, number>()
    bars.forEach((b, i) => {
      const out =
        !pointInPolygon(b, geometry.boundary) ||
        geometry.voids.some((v) => pointInPolygon(b, v))
      if (out) {
        const f = barMeta[i]?.face ?? b.face ?? 'bottom'
        outsideByFace.set(f, (outsideByFace.get(f) ?? 0) + 1)
      }
    })
    for (const [f, count] of outsideByFace) {
      issues.push({
        severity: 'error',
        code: 'outside',
        face: f,
        message: `${FACE_LABELS[f]} face: ${count} bar(s) extend outside the concrete section boundary.`,
      })
    }

    // 6b. Clear cover audit against nominal per-face cover
    const coverAudit = auditCovers(bars, geometry, cover, tie)
    if (coverAudit.nShort > 0) {
      const shortByFace = new Map<RebarFace, { count: number; minAchieved: number; required: number }>()
      coverAudit.bars.forEach((st, idx) => {
        if (st.ok || st.outside) return
        const ownerFace = barMeta[idx]?.face ?? st.face
        const cur = shortByFace.get(ownerFace)
        if (!cur) {
          shortByFace.set(ownerFace, { count: 1, minAchieved: st.achieved, required: st.required })
        } else {
          cur.count += 1
          cur.minAchieved = Math.min(cur.minAchieved, st.achieved)
          cur.required = Math.max(cur.required, st.required)
        }
      })
      for (const [f, info] of shortByFace) {
        issues.push({
          severity: 'warn',
          code: 'cover',
          face: f,
          message: `${FACE_LABELS[f]} face: ${info.count} bar(s) infringe nominal clear cover (min achieved ${info.minAchieved.toFixed(1)} mm < ${info.required.toFixed(0)} mm required).`,
        })
      }
    }

    // 6c. Overlapping bars (both within a face/bundle and across corners between faces)
    const overlaps = detectBarOverlaps(bars, OVERLAP_TOL)
    if (overlaps.length > 0) {
      const crossFaceOverlaps = overlaps.filter((o) => barMeta[o.i]?.face !== barMeta[o.j]?.face)
      const sameFaceOverlaps = overlaps.filter((o) => barMeta[o.i]?.face === barMeta[o.j]?.face)
      if (crossFaceOverlaps.length > 0) {
        const pairFaces = [
          ...new Set(crossFaceOverlaps.map((o) => `${FACE_LABELS[barMeta[o.i].face]} & ${FACE_LABELS[barMeta[o.j].face]}`)),
        ]
        issues.push({
          severity: 'error',
          code: 'overlap',
          message: `${crossFaceOverlaps.length} corner/cross-face bar overlap(s) between ${pairFaces.join(', ')} — switch side face span mode to "Between corners" or increase section size.`,
        })
      }
      if (sameFaceOverlaps.length > 0) {
        const maxDepth = Math.max(...sameFaceOverlaps.map((o) => o.depth))
        const facesHit = [...new Set(sameFaceOverlaps.map((o) => FACE_LABELS[barMeta[o.i].face]))]
        issues.push({
          severity: 'error',
          code: 'overlap',
          message: `${sameFaceOverlaps.length} overlapping bar pair(s) on ${facesHit.join(', ')} (max overlap ${maxDepth.toFixed(1)} mm) — reduce bar count/diameter or increase spacing.`,
        })
      }
    }

    // 6d. Detailing clear spacing between non-bundled bars/bundles
    const eqMap = new Map<string, number>()
    bars.forEach((b) => {
      if (!b.groupId) return
      eqMap.set(b.groupId, (eqMap.get(b.groupId) ?? 0) + b.dia * b.dia)
    })
    let worstDeficitFace: RebarFace | null = null
    let worstClear = Infinity
    let worstReq = 25
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        if (sameBundle(bars[i], bars[j])) continue
        const c = clearDistance(bars[i], bars[j])
        if (c < -OVERLAP_TOL) continue // already reported explicitly as overlap
        const eqI = bars[i].groupId ? Math.sqrt(eqMap.get(bars[i].groupId!) ?? bars[i].dia ** 2) : bars[i].dia
        const eqJ = bars[j].groupId ? Math.sqrt(eqMap.get(bars[j].groupId!) ?? bars[j].dia ** 2) : bars[j].dia
        const req = Math.max(25, eqI, eqJ)
        if (c < req - 1e-6 && c < worstClear) {
          worstClear = c
          worstReq = req
          worstDeficitFace = barMeta[i]?.face ?? 'bottom'
        }
      }
    }
    if (worstDeficitFace !== null && Number.isFinite(worstClear)) {
      issues.push({
        severity: 'warn',
        code: 'spacing',
        face: worstDeficitFace,
        message: `Minimum clear spacing ${worstClear.toFixed(1)} mm is below the recommended detailing minimum ${worstReq.toFixed(1)} mm (max of 25 mm and bar/bundle equivalent ⌀).`,
      })
    }
  }

  return {
    bars,
    spacers,
    summaries,
    issues,
    warnings: issues.map((it) => it.message),
  }
}

/* ------------------------------------------------------------------ *
 * Convenience helper for tests / external callers
 * ------------------------------------------------------------------ */
export { outerCover }
