/** Engine units: N, mm, N·mm, N/mm². UI layer converts to kN / kN·m. */

export interface Point {
  x: number
  y: number
}

/** Ordered vertex list; closed implicitly (last → first). CCW = positive area. */
export type Polygon = Point[]

/** The four axis-aligned face names used by the cover and layout model. */
export type RebarFace = 'bottom' | 'right' | 'top' | 'left'
export type RebarSurface = 'outer' | 'inner'
export type RebarPositioningMode = 'automatic' | 'manual'

/**
 * One discrete longitudinal bar.  The first three fields are the original
 * coordinate-table API.  The optional placement fields make generated layouts
 * relationship based without invalidating old project files or pasted tables:
 * imported/hand-entered rows with no `positioning` field remain manual.
 */
export interface Rebar {
  x: number
  y: number
  /** Bar diameter, mm. */
  dia: number
  /** Automatic rows follow their face/cover relationship; manual rows do not. */
  positioning?: RebarPositioningMode
  /** Primary concrete face controlling this bar. */
  face?: RebarFace
  /** Additional faces for a corner bar (for example bottom + left). */
  faces?: RebarFace[]
  /** Index of primary section face/edge (0..N-1) */
  faceIndex?: number
  /** Index of secondary section face/edge for corner bars */
  secondaryFaceIndex?: number
  /** Index of start face for line layout end-points */
  startFaceIndex?: number
  /** Index of end face for line layout end-points */
  endFaceIndex?: number
  /** Indices of faces for corner or multi-face bar */
  faceIndices?: number[]
  /** Outer boundary or an internal void face. */
  surface?: RebarSurface
  /** Index of the void supplying an inner face, when applicable. */
  voidIndex?: number
  /** Layer/group information is retained for generated and imported arrangements. */
  layer?: number
  groupId?: string
  /** Axis along which a line layout is distributed; `u` is its 0…1 position. */
  axis?: 'x' | 'y'
  u?: number
  /** Circular layouts move radially when their governing cover changes. */
  radial?: boolean
}

/** Ordered vertex list; closed implicitly (last → first). CCW = positive area. */
export interface SectionGeometry {
  /** Outer boundary, user coordinate system, mm. */
  boundary: Polygon
  /** Internal voids (holes), each wholly inside the boundary. */
  voids: Polygon[]
}

export type DesignCodeId = 'IS456' | 'IRC112' | 'IRSCBC'

export interface Materials {
  /** Characteristic cube strength, N/mm². */
  fck: number
  /** Characteristic yield / 0.2% proof stress, N/mm². */
  fy: number
  /** Steel grade label, e.g. "Fe500". */
  steelGrade: string
}

export interface LoadCase {
  id: string
  name: string
  /** Axial load, kN. Compression positive. */
  Pu: number
  /** Moment about centroidal X, kN·m. */
  Mux: number
  /** Moment about centroidal Y, kN·m. */
  Muy: number
}

export interface SectionProperties {
  /** Gross area (boundary − voids), mm². */
  area: number
  /** Centroid in user coordinates, mm. */
  cx: number
  cy: number
  /** Second moments about centroidal axes, mm⁴. */
  Ixx: number
  Iyy: number
  Ixy: number
  /** Total steel area, mm². */
  Asc: number
  /** Steel percentage of gross area. */
  p: number
  barCount: number
  /** Bounding box in centred coordinates. */
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number }
}

/** Parabola–rectangle concrete design curve parameters. */
export interface ConcreteModel {
  /** Peak design stress, N/mm². */
  fcd: number
  /** Strain at end of parabola / start of plateau. */
  ec2: number
  /** Ultimate strain at extreme compression fibre (bending). */
  ecu: number
  /** Parabola exponent. */
  n: number
}

/** Piecewise-linear steel curve (tension side; mirrored for compression). */
export interface SteelModel {
  /** Ascending (strain, stress) points starting at (0,0); plateau beyond last. */
  points: { eps: number; sig: number }[]
  /** Design yield stress (plateau), N/mm². */
  fyd: number
  Es: number
  /**
   * Optional cap on compressive stress (IRS CBC Cl 15.6.3.3:
   * fyc = fy / (γm + fy/2000)). Tension side is never capped.
   */
  compressionCap?: number
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info'

export interface ComplianceCheck {
  clause: string
  title: string
  demand: string
  limit: string
  status: CheckStatus
  /** Which UI action class: enforce (blocks), check (pass/fail), report (info). */
  kind: 'enforce' | 'check' | 'report'
  note?: string
}

export interface SurfacePoint {
  P: number // N
  Mx: number // N·mm
  My: number // N·mm
}

/** Strain plane ε(v) = a + b·v in the rotated frame of one NA orientation. */
export interface StrainPlaneCoeffs {
  a: number
  b: number
}

export interface SurfaceSample extends SurfacePoint, StrainPlaneCoeffs {}

export interface ContourPoint extends SurfaceSample {
  theta: number
}

/** One neutral-axis orientation: sampled path from pure tension to pure compression. */
export interface SurfaceMeridian {
  theta: number
  points: SurfaceSample[] // P strictly non-decreasing along the path
}

export interface InteractionSurface {
  meridians: SurfaceMeridian[]
  /** Pure axial compression capacity, N. */
  Puz: number
  /** Pure axial tension capacity, N (negative). */
  Pt: number
}

/**
 * Neutral-axis depth and ductility classification for a capacity state.
 * xu is measured from the extreme compression fibre along the compression
 * normal (perpendicular to the NA), in mm. Global-axis projections follow
 * the section X/Y directions.
 */
export type SectionReinforcementClass = 'under-reinforced' | 'over-reinforced' | 'fully-compressed' | 'no-compression'

export interface NeutralAxisDetail {
  /** Depth of NA from extreme compression fibre, mm. null if no compression zone. */
  xu: number | null
  /** Limiting NA depth xu,max = k·d, mm. */
  xuMax: number | null
  /** xu,max / d ratio from the design code (fy-dependent). */
  xuMaxRatio: number
  /** Effective depth: extreme compression fibre → extreme tension steel, mm. */
  d: number
  /** Overall section depth along the compression normal, mm. */
  h: number
  /** NA orientation θ (rad) — compression normal is (−sin θ, cos θ). */
  theta: number
  /** v-coordinate of the NA in the rotated frame (centred), mm. */
  vna: number
  /** Extreme compression fibre v-coordinate (centred), mm. */
  vmax: number
  /** Extreme tension fibre / steel v-coordinate (centred), mm. */
  vmin: number
  /** Global coordinates of the extreme compression point used for xu. */
  extremeComp: Point
  /** Global coordinates of the NA point along the same normal. */
  naPoint: Point
  /** Unit compression normal in global axes (points toward compressed side). */
  normal: Point
  /** Projection of xu onto global X (signed, mm): xu · nx. */
  xuGlobalX: number | null
  /** Projection of xu onto global Y (signed, mm): xu · ny. */
  xuGlobalY: number | null
  /** Ductility class by xu ≶ xu,max (IS 456 Cl 38.1 style). */
  classification: SectionReinforcementClass
  /**
   * Design moment capacity of the capacity strain plane, N·mm.
   * For under-reinforced sections this is the Mu based on the actual xu;
   * always equal to MRd of the governing capacity point when a compression zone exists.
   */
  Mu: number | null
  /** Pure-bending (P = 0) moment capacity along the same direction, N·mm. */
  Mu0: number | null
}

export interface CaseResult {
  loadCase: LoadCase
  /** Rigorous utilisation (radial in Mx–My at constant P), governs verdict. */
  U: number
  /** Uniaxial capacities at Pu from the rigorous surface, N·mm. */
  Mux1: number
  Muy1: number
  /** Moment capacity along the demand direction at Pu, N·mm. */
  MRd: number
  /** Resultant applied moment, N·mm. */
  MEd: number
  /** Simplified code power-law interaction value (≤ 1 passes). */
  simplified: number | null
  alphaN: number | null
  ok: boolean
  axialGoverned: boolean
  /** Neutral-axis depth, xu,max and under/over-reinforced classification. */
  na: NeutralAxisDetail | null
}

export interface MeshSettings {
  nTheta: number
  nDepth: number
}

export const DEFAULT_MESH: MeshSettings = { nTheta: 40, nDepth: 90 }
