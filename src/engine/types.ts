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
}

export interface MeshSettings {
  nTheta: number
  nDepth: number
}

export const DEFAULT_MESH: MeshSettings = { nTheta: 40, nDepth: 90 }
