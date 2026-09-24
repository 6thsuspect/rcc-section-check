import type { DesignCodeId, LoadCase, Rebar, SectionGeometry, MeshSettings } from './engine/types'
import { DEFAULT_MESH } from './engine/types'
import { defaultPredefined, generateSection, type PredefinedSection } from './engine/sections'
import { uniformCover, type CoverSpec } from './engine/cover'
import { DEFAULT_EXPOSURE, type CrackWidthSettings } from './engine/crackWidth'

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
  /** Factored (ULS) load cases. */
  cases: LoadCase[]
  /**
   * Service (SLS) load cases — entered separately from the factored ULS cases.
   * The SLS stress check runs on these characteristic actions.
   */
  slsCases: LoadCase[]
  /**
   * Service (SLS) load cases for the crack-width check — a third, independently
   * edited list. The crack width runs its own cracked-section solve on these.
   */
  crackCases: LoadCase[]
  /** Crack-width check inputs (exposure class + load duration) for the SLS tab. */
  crackWidth: CrackWidthSettings
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
    // Service (characteristic) actions for the SLS stress + crack-width checks —
    // a separate, independently editable list from the factored ULS cases above.
    slsCases: [
      { id: newCaseId(), name: 'SLC1', Pu: 600, Mux: 150, Muy: 25 },
      { id: newCaseId(), name: 'SLC2', Pu: 500, Mux: 160, Muy: 30 },
    ],
    // Service actions for the crack-width check — separate from both the ULS
    // and the SLS stress lists; the crack width runs its own solve on these.
    crackCases: [
      { id: newCaseId(), name: 'CWC1', Pu: 600, Mux: 150, Muy: 25 },
      { id: newCaseId(), name: 'CWC2', Pu: 500, Mux: 160, Muy: 30 },
    ],
    crackWidth: { exposure: DEFAULT_EXPOSURE.IS456, longTerm: false },
    mesh: DEFAULT_MESH,
  }
}

export const fmtN = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
