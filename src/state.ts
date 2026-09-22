import type { DesignCodeId, LoadCase, Rebar, SectionGeometry, MeshSettings } from './engine/types'
import { DEFAULT_MESH } from './engine/types'
import { defaultPredefined, generateSection, type PredefinedSection } from './engine/sections'
import { uniformCover, type CoverSpec } from './engine/cover'

export interface AppState {
  code: DesignCodeId
  geometry: SectionGeometry
  bars: Rebar[]
  /** Which predefined shape produced the geometry (null = custom). */
  predefined: PredefinedSection | null
  shapeClass: 'rect' | 'circ'
  fck: number
  steelGrade: string
  /** Nominal clear cover to the links, entered per concrete face (docs/03 §3.6). */
  cover: CoverSpec
  tieDia: number
  barDia: number
  /** Unsupported length, mm (0 = not provided). */
  memberLength: number
  cases: LoadCase[]
  mesh: MeshSettings
}

let caseSeq = 1
export function newCaseId(): string {
  return `lc-${caseSeq++}-${Date.now() % 100000}`
}

export const DEFAULT_TIE_DIA = 8
export const DEFAULT_BAR_DIA = 25

export function initialState(): AppState {
  const def = defaultPredefined('rect')
  if (def.kind === 'rect') {
    def.nx = 4
    def.ny = 2
  }
  const cover = uniformCover(40)
  const gen = generateSection(def, { cover, tieDia: DEFAULT_TIE_DIA, barDia: DEFAULT_BAR_DIA })
  return {
    code: 'IS456',
    geometry: gen.geometry,
    bars: gen.bars,
    predefined: def,
    shapeClass: gen.shapeClass,
    fck: 30,
    steelGrade: 'Fe500',
    cover,
    tieDia: DEFAULT_TIE_DIA,
    barDia: DEFAULT_BAR_DIA,
    memberLength: 3200,
    cases: [
      { id: newCaseId(), name: 'LC1', Pu: 2500, Mux: 180, Muy: 100 },
      { id: newCaseId(), name: 'LC2', Pu: 1200, Mux: 320, Muy: 40 },
    ],
    mesh: DEFAULT_MESH,
  }
}

export const fmtN = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
