/**
 * File import — the tolerant reader behind the header's **Import project**
 * button.
 *
 * Two kinds of file arrive here:
 *
 *  1. **A project this app wrote** (`{ version, app, exportedAt, state }`, or a
 *     bare `AppState`). These go through `parseProjectFile` exactly as before,
 *     with the same cleaning and the same version migrations, so a file the app
 *     exported always comes back complete — nothing here can make that worse.
 *  2. **Anything else** that describes a section: a hand-written JSON, an export
 *     from another tool, a trimmed project. These are read through the alias
 *     tables below and merged **over the state already on screen**: a field the
 *     file does not carry keeps the value it had (it is never reset to a
 *     default), and every field is reported as imported, missing or invalid so
 *     the banner can say what happened.
 *
 * No formula, default or unit lives here: the geometry and reinforcement a
 * parametric section implies come from the same `generateSection` the section
 * editor uses, the covers from the same `normalizeCover`, the meshes and shear
 * settings are validated against the same codes, and bars and link positions go
 * through the same sanitisers a project file does.
 *
 * Units: a project file is already in the app's own units (mm, kN, kN·m for the
 * values as typed). An external file may declare its own with a `units` block —
 * `{ "length": "mm" | "cm" | "m", "force": "N" | "kN", "moment": "Nm" | "kNm" }` —
 * or by suffixing a key (`"depth_mm"`, `"width_cm"`, `"Pu_kN"`). Lengths are
 * brought to mm, forces to kN and moments to kN·m, which is what every input in
 * the app is entered in.
 */
import type { AppState } from './state'
import { newCaseId, newShearCaseId } from './state'
import { CODES } from './engine/codes'
import { COVER_FACES, normalizeCover } from './engine/cover'
import { DEFAULT_EXPOSURE, EXPOSURE_OPTIONS } from './engine/crackWidth'
import { circlePoly, defaultPredefined, generateSection, type PredefinedSection } from './engine/sections'
import { centroid, ensureCCW } from './engine/geometry'
import type { LoadCase, Point, Rebar, SectionGeometry } from './engine/types'
import { repositionAutomaticBars, isAutomaticBar } from './engine/reinforcement'
import { generateRectAdvancedRebar, sanitizeRectAdvancedConfig } from './engine/rectRebar'
import {
  MAX_COT_THETA,
  MIN_COT_THETA,
  tensionFaceOptions,
  type ShearAxis,
  type ShearLoadCase,
  type ShearSettings,
} from './engine/shear'
import { parseProjectFile, sanitizeBarRows, sanitizeLinkPositions } from './projectFile'

/* ------------------------------------------------------------------ report */

export type FieldStatus = 'imported' | 'missing' | 'invalid'

export interface FieldReport {
  /** What the field is, as the app names it — "Clear cover", "ULS load cases". */
  group: string
  status: FieldStatus
  /** The value taken, or why the field was left alone. */
  detail: string
}

export interface ImportReport {
  /** `project` = this app's own export, `external` = a file from elsewhere. */
  format: 'project' | 'external'
  fields: FieldReport[]
  counts: { imported: number; missing: number; invalid: number }
}

export interface ImportResult {
  state: AppState
  report: ImportReport
}

/** The field groups the reader looks for, in the order the banner lists them. */
const GROUPS = {
  code: 'Design code',
  section: 'Section geometry',
  shape: 'Shape parameters',
  materials: 'Concrete and steel',
  cover: 'Clear cover',
  bars: 'Reinforcement',
  diameters: 'Bar and link ⌀',
  length: 'Member length',
  uls: 'ULS load cases',
  sls: 'SLS load cases',
  crack: 'Crack-width load cases',
  shearCases: 'Shear load cases',
  shear: 'Shear design inputs',
  crackSettings: 'Crack-width inputs',
  mesh: 'Mesh density',
} as const

type Report = {
  format: 'project' | 'external'
  fields: FieldReport[]
  add: (group: string, status: FieldStatus, detail: string) => void
  has: (group: string) => boolean
}

function makeReport(format: 'project' | 'external'): Report {
  const fields: FieldReport[] = []
  return {
    format,
    fields,
    add: (group, status, detail) => {
      fields.push({ group, status, detail })
    },
    has: (group) => fields.some((f) => f.group === group),
  }
}

function finish(report: Report): ImportReport {
  const counts = { imported: 0, missing: 0, invalid: 0 }
  for (const f of report.fields) counts[f.status] += 1
  return { format: report.format, fields: report.fields, counts }
}

/** Counts and the lists the banner shows, away from the JSX. */
export function importSummary(report: ImportReport): {
  imported: FieldReport[]
  missing: FieldReport[]
  invalid: FieldReport[]
} {
  return {
    imported: report.fields.filter((f) => f.status === 'imported'),
    missing: report.fields.filter((f) => f.status === 'missing'),
    invalid: report.fields.filter((f) => f.status === 'invalid'),
  }
}

/* ------------------------------------------------------------------ readers */

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A number from a number or a numeric string. `null` means "not a number" —
 * an empty string, a boolean, a list, `NaN`. A genuine 0 is a value and comes
 * back as 0, so a zero the file means is never mistaken for a missing field.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean' || Array.isArray(v)) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A number from a row that also names *which* key could not be read, so a load
 * case with a force written in words is reported rather than quietly read as a
 * zero. A key that is simply absent is not a complaint: an absent force is a
 * zero load, which is what this app shows for a new case.
 */
function rowNumber(
  row: Rec,
  keys: readonly string[],
  read: (r: Rec, k: readonly string[], u: UnitScale) => number | null,
  units: UnitScale,
): { value: number; bad: string | null } {
  const value = read(row, keys, units)
  if (value !== null) return { value, bad: null }
  return { value: 0, bad: presentWordKey(row, keys) }
}

/** A key that is there, whatever it holds — for the diagnostic messages. */
function presentWordKey(row: Rec, keys: readonly string[]): string | null {
  for (const key of keys) {
    for (const candidate of [key, `${key}_N`, `${key}_kN`, `${key}_Nm`, `${key}_kNm`]) {
      const v = at(row, candidate)
      if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) return candidate
    }
  }
  return null
}

/** A truthy flag written as a boolean, `0/1` or `"yes"/"true"`. */
function flag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && (v === 0 || v === 1)) return v === 1
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'yes', 'y', '1', 'on'].includes(s)) return true
    if (['false', 'no', 'n', '0', 'off'].includes(s)) return false
  }
  return null
}

function deep(root: Rec, path: string): unknown {
  let cur: unknown = root
  for (const part of path.split('.')) {
    if (!isRec(cur)) return undefined
    cur = at(cur as Rec, part)
  }
  return cur
}

/** The first value found among dotted paths, in the order they are given. */
function first(root: Rec, paths: readonly string[]): unknown {
  for (const p of paths) {
    const v = deep(root, p)
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/* ------------------------------------------------------------------ units */

interface UnitScale {
  length: number
  force: number
  moment: number
}

const LENGTH_UNITS: Record<string, number> = {
  mm: 1, millimetre: 1, millimeter: 1, millimetres: 1, millimeters: 1,
  cm: 10, centimetre: 10, centimeter: 10,
  m: 1000, metre: 1000, meter: 1000, metres: 1000, meters: 1000,
}
/** Forces are entered in kN everywhere in the app. */
const FORCE_UNITS: Record<string, number> = { n: 0.001, newton: 0.001, newtons: 0.001, kn: 1, kilonewton: 1, mn: 1000 }
/** Moments are entered in kN·m everywhere in the app. */
const MOMENT_UNITS: Record<string, number> = { nm: 0.001, knm: 1, mnm: 1000 }

/**
 * A key for comparing a name a file wrote with a name this app knows: lower
 * case, letters and digits only. The digits matter — `Fe250` and `Fe500` are
 * different grades, `X0` and `XC1` different exposure classes — so they are
 * kept, unlike in the unit strings below.
 */
const idKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Unit names are compared by their letters: `kN·m`, `kNm` and `kN m` are one unit. */
const unitKey = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '')

/** Case-insensitive key lookup, cached: a file may write `ULS` or `uls`. */
const keyIndex = new WeakMap<Rec, Map<string, string>>()

/** The value of a key, whatever case the file wrote it in. */
function at(rec: Rec, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key]
  let index = keyIndex.get(rec)
  if (!index) {
    index = new Map()
    for (const k of Object.keys(rec)) {
      const lower = k.toLowerCase()
      if (!index.has(lower)) index.set(lower, k)
    }
    keyIndex.set(rec, index)
  }
  const real = index.get(key.toLowerCase())
  return real === undefined ? undefined : rec[real]
}

/** The value of a `units` block, or a bare unit string, as multipliers. */
function readUnits(root: Rec): { scale: UnitScale; note: string | null } {
  const scale: UnitScale = { length: 1, force: 1, moment: 1 }
  const raw = first(root, ['units', 'unit', 'unitSystem', 'measurementUnits'])
  if (raw === undefined) return { scale, note: null }
  const notes: string[] = []
  const take = (field: 'length' | 'force' | 'moment', table: Record<string, number>, value: unknown) => {
    if (typeof value !== 'string') return
    const factor = table[unitKey(value)]
    if (factor === undefined) {
      notes.push(`${field} "${value}" is not a unit this app knows — read as ${field === 'length' ? 'mm' : field === 'force' ? 'kN' : 'kN·m'}`)
      return
    }
    scale[field] = factor
  }
  if (typeof raw === 'string') {
    // A single token describes the lengths ("m", "mm"); force and moment follow
    // the SI defaults they are usually written in.
    take('length', LENGTH_UNITS, raw)
  } else if (isRec(raw)) {
    take('length', LENGTH_UNITS, first(raw, ['length', 'lengths', 'dimension', 'dimensions', 'distance']))
    take('force', FORCE_UNITS, first(raw, ['force', 'forces', 'load', 'loads']))
    take('moment', MOMENT_UNITS, first(raw, ['moment', 'moments', 'momentLoads']))
  }
  const described = `mm ×${scale.length}, kN ×${scale.force}, kN·m ×${scale.moment}`
  return { scale, note: notes.length ? `${notes.join('; ')} (${described})` : described }
}

/** Suffixed keys (`depth_mm`, `width_cm`) carry their own unit. */
const LENGTH_SUFFIXES: readonly (readonly [string, number])[] = [
  ['_mm', 1], ['_cm', 10], ['_m', 1000], ['Mm', 1000], ['(mm)', 1], [' (mm)', 1],
]

/**
 * A length in mm: the first recognised key, plain (scaled by the file's unit
 * block) or suffixed with its own unit.
 */
function length(root: Rec, keys: readonly string[], units: UnitScale): number | null {
  for (const key of keys) {
    const plain = num(at(root, key))
    if (plain !== null) return plain * units.length
    for (const [suffix, factor] of LENGTH_SUFFIXES) {
      const v = num(at(root, `${key}${suffix}`))
      if (v !== null) return v * factor
    }
  }
  return null
}

/** The key a length was read from, for the diagnostic messages. */
function lengthKey(root: Rec, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (num(at(root, key)) !== null) return key
    for (const [suffix] of LENGTH_SUFFIXES) {
      if (num(at(root, `${key}${suffix}`)) !== null) return `${key}${suffix}`
    }
  }
  return null
}

/** A force in kN, from a plain or suffixed (`Pu_kN`, `P_N`) key. */
function force(root: Rec, keys: readonly string[], units: UnitScale): number | null {
  for (const key of keys) {
    const plain = num(at(root, key))
    if (plain !== null) return plain * units.force
    const n = num(at(root, `${key}_N`))
    if (n !== null) return n * FORCE_UNITS.n
    const kn = num(at(root, `${key}_kN`))
    if (kn !== null) return kn
  }
  return null
}

/** A moment in kN·m, from a plain or suffixed (`Mux_kNm`, `Mx_Nm`) key. */
function moment(root: Rec, keys: readonly string[], units: UnitScale): number | null {
  for (const key of keys) {
    const plain = num(at(root, key))
    if (plain !== null) return plain * units.moment
    const nm = num(at(root, `${key}_Nm`))
    if (nm !== null) return nm * MOMENT_UNITS.nm
    const knm = num(at(root, `${key}_kNm`))
    if (knm !== null) return knm
  }
  return null
}

/* ------------------------------------------------------------------ keys */

const CODE_ALIASES: Record<string, AppState['code']> = {
  is456: 'IS456', is4562000: 'IS456', is: 'IS456', is4562000is456: 'IS456',
  irc112: 'IRC112', irc1122011: 'IRC112', irc: 'IRC112',
  irscbc: 'IRSCBC', irscbc2014: 'IRSCBC', irs: 'IRSCBC', cbcs: 'IRSCBC',
}

const SECTION_KINDS: Record<string, PredefinedSection['kind']> = {
  rect: 'rect', rectangle: 'rect', rectangular: 'rect', square: 'rect',
  circle: 'circle', circular: 'circle', round: 'circle',
  tee: 'tee', t: 'tee', tsection: 'tee', tbeam: 'tee',
  ishape: 'ishape', i: 'ishape', isection: 'ishape', ibeam: 'ishape',
  angle: 'angle', l: 'angle', lsection: 'angle',
  box: 'box', hollowrect: 'box', hollowrectangle: 'box', boxsection: 'box', rccbox: 'box',
  hollowcircle: 'hollowCircle', pipe: 'hollowCircle', tube: 'hollowCircle', hollowcircular: 'hollowCircle', annular: 'hollowCircle',
  circulartube: 'hollowCircle', hollowcylinder: 'hollowCircle', cylinder: 'hollowCircle',
}

/** Where a section may be described, outer object first. */
const SECTION_SCOPES = ['section', 'sections', 'dimensions', 'geometry', 'shape', 'sectionProperties'] as const

/* ------------------------------------------------------------------ import */

function looksLikeProjectFile(parsed: Rec): boolean {
  const st = isRec(parsed.state) ? parsed.state : parsed
  return Array.isArray(deep(st, 'geometry.boundary')) && Array.isArray(st.bars) && Array.isArray(st.cases)
}

/**
 * Read a file the user picked. Throws only when the text is not JSON at all;
 * every other problem is reported field by field and the state it returns is
 * always usable.
 */
export function importProjectText(text: string, current: AppState): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not JSON. A project is a .json file — either exported from this app or written to the field names below.')
  }
  if (!isRec(parsed)) {
    throw new Error('This file is JSON but not an object, so there are no fields to read.')
  }

  if (looksLikeProjectFile(parsed)) {
    const rawState = isRec(parsed.state) ? parsed.state : parsed
    return { state: parseProjectFile(text), report: projectReport(parsed, rawState) }
  }
  return mapExternalFile(parsed, current)
}

/* ---------------------------------------------------- this app's own files */

/** What a project file carried, group by group, in the same words as above. */
function projectReport(root: Rec, raw: Rec): ImportReport {
  const report = makeReport('project')
  const version = typeof root.version === 'string' ? root.version : null

  const present = (group: string, detail: string, ok: boolean, missing: string) => {
    report.add(group, ok ? 'imported' : 'missing', `${ok ? detail : missing} (project file${version ? ` v${version}` : ''})`)
  }

  present(GROUPS.code, `code ${String(raw.code)}`, ['IS456', 'IRC112', 'IRSCBC'].includes(String(raw.code)), 'not stated — the app default applies')
  present(GROUPS.section, `${(raw.geometry as Rec)?.boundary ? (raw.geometry as Rec).boundary as unknown[] : []} boundary points`, Array.isArray(deep(raw, 'geometry.boundary')), 'not in the file')
  const bars = raw.bars as unknown[]
  present(GROUPS.bars, `${bars.length} bars`, Array.isArray(raw.bars), 'not in the file')
  present(GROUPS.materials, `fck ${String(raw.fck)}, ${String(raw.steelGrade)}`, Number.isFinite(raw.fck), 'not in the file — defaults apply')
  present(GROUPS.cover, typeof raw.cover === 'number' ? `${raw.cover} mm, all faces` : 'per face', raw.cover !== undefined && raw.cover !== null, 'not in the file — the default cover applies')
  present(GROUPS.diameters, `bar ⌀${String(raw.barDia)}, link ⌀${String(raw.tieDia)}`, Number.isFinite(raw.barDia) && Number.isFinite(raw.tieDia), 'not in the file — defaults apply')
  present(GROUPS.length, `${String(raw.memberLength)} mm`, Number.isFinite(raw.memberLength), 'not in the file — defaults apply')
  present(GROUPS.uls, `${(raw.cases as unknown[])?.length ?? 0} cases`, Array.isArray(raw.cases), 'not in the file')
  present(GROUPS.sls, `${(raw.slsCases as unknown[])?.length ?? 0} cases`, Array.isArray(raw.slsCases), 'not in the file — seeded from the ULS cases, as older versions of this app did')
  present(GROUPS.crack, `${(raw.crackCases as unknown[])?.length ?? 0} cases`, Array.isArray(raw.crackCases), 'not in the file — seeded from the SLS cases')
  present(GROUPS.shearCases, `${(raw.shearCases as unknown[])?.length ?? 0} cases`, Array.isArray(raw.shearCases), 'not in the file — seeded from the ULS cases with Vu = 0')
  present(GROUPS.shear, 'direction, links and overrides', isRec(raw.shear), 'not in the file — the tab opens on its defaults')
  present(GROUPS.crackSettings, `${String(deep(raw, 'crackWidth.exposure'))}`, isRec(raw.crackWidth), 'not in the file — the code default applies')
  present(GROUPS.mesh, `${String(deep(raw, 'mesh.nTheta'))} × ${String(deep(raw, 'mesh.nDepth'))}`, isRec(raw.mesh), 'not in the file — defaults apply')
  present(GROUPS.shape, isRec(raw.predefined) ? `parametric ${String((raw.predefined as Rec).kind)}` : 'custom boundary', isRec(raw.predefined), 'not in the file')

  return finish(report)
}

/* -------------------------------------------------------- files from outside */

/**
 * Read a file from outside the app into a complete state: everything the file
 * describes is applied, everything else keeps the value already on screen.
 */
function mapExternalFile(root: Rec, current: AppState): ImportResult {
  const report = makeReport('external')
  const patch: Partial<AppState> = {}

  const { scale: units, note: unitNote } = readUnits(root)
  if (unitNote) report.add('Units', 'imported', unitNote)

  // ---------------------------------------------------------------- code
  const rawCode = first(root, ['code', 'designCode', 'standard', 'codeId', 'design.standard'])
  if (rawCode !== undefined) {
    const code = typeof rawCode === 'string' ? CODE_ALIASES[idKey(rawCode)] : undefined
    if (code) {
      patch.code = code
      report.add(GROUPS.code, 'imported', `IS 456:2000 · IRC:112 · IRS CBC → ${code}`)
    } else {
      report.add(GROUPS.code, 'invalid', `"${String(rawCode)}" is not one of IS456, IRC112 or IRSCBC — the code in use was kept`)
    }
  } else {
    report.add(GROUPS.code, 'missing', 'not in the file — the code in use was kept')
  }
  const code = patch.code ?? current.code

  // ---------------------------------------------------------------- section
  const section = readSection(root, current, units)

  // ---------------------------------------------------------------- materials
  const fckRaw = first(root, [
    'fck', 'fc', 'fcu', 'concreteGrade', 'concreteStrength', 'cylinderStrength',
    'concrete.grade', 'concrete.fck', 'concrete.strength', 'materials.concrete.fck', 'materials.fck', 'materials.concreteGrade',
  ])
  if (fckRaw !== undefined) {
    const fck = num(fckRaw)
    if (fck !== null && fck > 0) {
      patch.fck = fck
      report.add(GROUPS.materials, 'imported', `fck = ${fck} N/mm²`)
    } else {
      report.add(GROUPS.materials, 'invalid', `concrete strength "${String(fckRaw)}" is not a positive number — the grade in use was kept`)
    }
  }

  const gradeRaw = first(root, ['steelGrade', 'steel.grade', 'steelGradeLabel', 'materials.steel.grade', 'materials.steelGrade', 'fy', 'steel.fy', 'materials.steel.fy'])
  if (gradeRaw !== undefined) {
    const grades = CODES[code].steelGrades
    const asNumber = num(gradeRaw)
    const label =
      typeof gradeRaw === 'string'
        ? grades.find((g) => idKey(g.label) === idKey(gradeRaw))?.label
        : undefined
    const byFy = asNumber !== null ? grades.find((g) => g.fy === asNumber)?.label : undefined
    const resolved = label ?? byFy
    if (resolved) {
      patch.steelGrade = resolved
      report.add(GROUPS.materials, 'imported', `steel ${resolved}${byFy && !label ? ` (fy = ${asNumber} N/mm²)` : ''}`)
    } else {
      report.add(GROUPS.materials, 'invalid', `steel grade "${String(gradeRaw)}" is not one of ${grades.map((g) => g.label).join(', ')} for ${code} — the grade in use was kept`)
    }
  }
  if (!report.has(GROUPS.materials)) {
    report.add(GROUPS.materials, 'missing', 'no concrete or steel grade in the file — the values in use were kept')
  }

  // ---------------------------------------------------------------- cover
  const coverRaw = first(root, ['cover', 'clearCover', 'nominalCover', 'coverSpec', 'covers', 'durability.cover'])
  if (coverRaw !== undefined) {
    const scaled = scaleLengths(coverRaw, units.length)
    if (typeof scaled === 'number' && !(scaled > 0)) {
      report.add(GROUPS.cover, 'invalid', `cover ${scaled} mm is not a positive length — the cover in use was kept`)
    } else {
      const cover = normalizeCover(scaled, current.cover)
      const negative = countNegatives(scaled)
      patch.cover = cover
      report.add(
        GROUPS.cover,
        negative ? 'invalid' : 'imported',
        `${typeof scaled === 'number' ? `${scaled} mm on every face` : `per face — ${COVER_FACES.map((f) => `${f} ${cover.outer[f]}`).join(', ')} mm`}` +
          `${negative ? ` (${negative} negative value(s) read as 0)` : ''}`,
      )
    }
  } else {
    report.add(GROUPS.cover, 'missing', 'not in the file — the cover in use was kept')
  }

  // ---------------------------------------------------------------- diameters
  // Read before the section is generated: the bar and link diameters are inputs
  // to where the bars sit, so a file that gives them gets bars at the right
  // radius rather than at the diameters that happened to be on screen.
  const barDia = length(root, ['barDia', 'mainBarDia', 'primaryBarDia', 'barDiameter', 'longitudinalBarDiameter', 'reinforcement.barDia'], units)
  const tieDia = length(root, ['tieDia', 'linkDia', 'stirrupDia', 'tieDiameter', 'shearLinkDiameter', 'reinforcement.linkDia', 'reinforcement.tieDia'], units)
  if (barDia !== null) {
    if (barDia > 0) {
      patch.barDia = barDia
      report.add(GROUPS.diameters, 'imported', `bar ⌀${barDia} mm`)
    } else {
      report.add(GROUPS.diameters, 'invalid', `bar ⌀ ${barDia} mm is not positive — the diameter in use was kept`)
    }
  }
  if (tieDia !== null) {
    if (tieDia > 0) {
      patch.tieDia = tieDia
      report.add(GROUPS.diameters, 'imported', `link ⌀${tieDia} mm`)
    } else {
      report.add(GROUPS.diameters, 'invalid', `link ⌀ ${tieDia} mm is not positive — the diameter in use was kept`)
    }
  }

  // ---------------------------------------------------------------- reinforcement
  const barsRaw = first(root, [
    'bars', 'mainBars', 'reinforcement', 'rebars', 'reinforcementBars', 'longitudinalBars',
    'reinforcement.bars', 'reinforcement.mainBars', 'materials.steel.bars',
  ])
  let barsFromFile: Rebar[] | null = null
  if (Array.isArray(barsRaw)) {
    barsFromFile = readBarRows(barsRaw, units, current, section, report)
  } else if (isRec(barsRaw)) {
    // A count-shaped description (nx/ny or nBars) feeds the parametric section,
    // which generates the coordinates the app works in.
    readBarCounts(barsRaw, section.params, units)
  }

  // ---------------------------------------------- the section, and its bars
  // Composed once the reinforcement has been read too, so a bar count that came
  // from a bar table reaches the parametric definition before it is generated.
  const def =
    section.base && (section.explicit || Object.keys(section.params).length > 0)
      ? ({ ...section.base, ...section.params } as PredefinedSection)
      : null
  // The openings the file defines: with a boundary they are its voids, and with
  // a parametric section they are kept alongside the openings it generates.
  const voids = section.boundary ? section.boundary.voids : section.cutouts
  if (section.boundary) {
    patch.geometry = section.boundary
    // The boundary is the section, so the app stops deriving it from a shape
    // definition — unless the file's own definition came with it.
    patch.predefined = section.base
    patch.shapeClass =
      section.shapeClass ?? (section.base?.kind === 'circle' || section.base?.kind === 'hollowCircle' ? 'circ' : 'rect')
    report.add(
      GROUPS.section,
      'imported',
      `${section.boundary.boundary.length} boundary points` +
        `${voids.length ? ` and ${voids.length} opening(s)` : ''}` +
        `${patch.shapeClass === 'circ' ? ', circular' : ''}` +
        `${section.base ? `, with the parametric ${section.base.kind} definition the file carries` : ''}`,
    )
    if (section.base) report.add(GROUPS.shape, 'imported', `parametric ${section.base.kind}`)
    if (!barsFromFile && current.bars.length > 0) {
      // Bars the app placed itself follow the boundary they belong to, exactly
      // as they do when the boundary is edited in the app.
      patch.bars = repositionAutomaticBars(
        current.bars,
        current.geometry,
        section.boundary,
        current.cover,
        patch.cover ?? current.cover,
        current.tieDia,
        patch.tieDia ?? current.tieDia,
      )
      report.add(GROUPS.bars, 'imported', `${patch.bars.length} bars repositioned for the imported boundary`)
    }
  } else if (def) {
    const opts = { cover: patch.cover ?? current.cover, tieDia: patch.tieDia ?? current.tieDia, barDia: patch.barDia ?? current.barDia }
    const gen = generateSection(def, opts)
    // The section is generated from the file's own parameters, and any hole or
    // cutout the file adds is kept with it — the app's own generator knows the
    // hollow shapes (box, hollow circle) and the file may add more.
    patch.geometry = voids.length ? { boundary: gen.geometry.boundary, voids: [...gen.geometry.voids, ...voids] } : gen.geometry
    patch.shapeClass = gen.shapeClass
    patch.predefined = def
    const read = Object.keys(section.params)
    report.add(
      GROUPS.section,
      'imported',
      read.length
        ? `${def.kind}: ${read.map((k) => `${k} = ${section.params[k]}`).join(', ')}${section.badParams.length ? ` (${section.badParams.join(', ')} not usable)` : ''}`
        : `${def.kind} — the definition the file carries`,
    )
    if (voids.length) {
      report.add(GROUPS.section, 'imported', `${voids.length} opening(s) in the section kept with it`)
    }
    if (section.badParams.length) {
      report.add(GROUPS.section, 'invalid', `${section.badParams.join(', ')} — left as they are`)
    }
    if (barsFromFile) {
      patch.bars = barsFromFile
    } else if (current.bars.some(isAutomaticBar) && current.bars.length > 0) {
      // Bars the app placed itself follow the section they belong to; rows the
      // user placed by hand are kept where they are (the same rule the section
      // editor applies when a shape parameter moves).
      patch.bars = current.bars.some((b) => !isAutomaticBar(b))
        ? repositionAutomaticBars(current.bars, current.geometry, gen.geometry, current.cover, opts.cover, current.tieDia, opts.tieDia)
        : gen.bars
      report.add(GROUPS.bars, 'imported', `${patch.bars!.length} bars regenerated for the imported section`)
    } else if (current.bars.length > 0) {
      patch.bars = repositionAutomaticBars(current.bars, current.geometry, gen.geometry, current.cover, opts.cover, current.tieDia, opts.tieDia)
      report.add(GROUPS.bars, 'imported', `${current.bars.length} hand-placed bars kept for the imported section`)
    } else {
      patch.bars = gen.bars
      report.add(GROUPS.bars, 'imported', `${gen.bars.length} bars generated for the imported section`)
    }
  } else {
    // The file said something about its section, but nothing usable came of it:
    // name what was there and leave the section exactly as it is.
    report.add(
      GROUPS.section,
      section.base ? 'invalid' : 'missing',
      section.base
        ? `no usable section dimensions in the file (${section.badParams.join(', ') || 'nothing read'}) — the section in use was kept`
        : 'no boundary or section dimensions in the file — the section in use was kept',
    )
  }

  // Openings the file names but does not describe, and anything it states about
  // its section that this app cannot show — both are said rather than dropped.
  if (section.badCutouts.length) {
    report.add(
      GROUPS.section,
      'invalid',
      `${section.badCutouts.join(', ')} could not be read as a hole or cutout — ${section.badCutouts.length === 1 ? 'it was' : 'they were'} skipped`,
    )
  }
  for (const note of section.notes) {
    report.add(GROUPS.section, 'invalid', note)
  }

  // A bar table the file gave is the reinforcement, whether or not the section
  // itself could be read.
  if (barsFromFile) patch.bars = barsFromFile

  // Advanced rectangular reinforcement: apply if supplied by the external file,
  // otherwise deactivate any prior active rectangular override when the file
  // brings its own section or bar table.
  const rawRectAdv = first(root, ['rectRebar', 'advancedReinforcement', 'rectAdvancedRebar'])
  if (isRec(rawRectAdv)) {
    const cleaned = sanitizeRectAdvancedConfig(rawRectAdv, patch.barDia ?? current.barDia)
    if (cleaned) {
      patch.rectRebar = cleaned
      if (cleaned.enabled && !barsFromFile) {
        const gRect = generateRectAdvancedRebar(
          cleaned,
          patch.geometry ?? current.geometry,
          patch.cover ?? current.cover,
          patch.tieDia ?? current.tieDia,
        )
        patch.bars = gRect.bars
        report.add(GROUPS.bars, 'imported', `${gRect.bars.length} bars generated from advanced rectangular reinforcement`)
      }
    }
  } else if (current.rectRebar?.enabled && (barsFromFile || def || section.boundary)) {
    patch.rectRebar = { ...current.rectRebar, enabled: false }
  }

  if (!report.has(GROUPS.bars)) {
    report.add(GROUPS.bars, 'missing', 'no bar table in the file — the reinforcement in use was kept')
  }

  if (!report.has(GROUPS.diameters) && barsFromFile?.length) {
    // A file that gives a bar table but no separate diameter: the table's own
    // diameters are the answer, so the shared diameter follows the commonest of
    // them rather than staying at whatever was on screen.
    const commonest = mostCommon(barsFromFile.map((b) => b.dia))
    if (commonest !== null && commonest > 0) {
      patch.barDia = commonest
      report.add(GROUPS.diameters, 'imported', `bar ⌀${commonest} mm, taken from the bar table`)
    }
  }
  if (!report.has(GROUPS.diameters)) {
    report.add(GROUPS.diameters, 'missing', 'not in the file — the diameters in use were kept')
  }

  // ---------------------------------------------------------------- member length
  const memberLength = length(root, ['memberLength', 'unsupportedLength', 'clearLength', 'member.length', 'length', 'Lu', 'le'], units)
  if (memberLength !== null) {
    patch.memberLength = Math.max(0, memberLength)
    report.add(GROUPS.length, 'imported', `${patch.memberLength} mm`)
  } else {
    report.add(GROUPS.length, 'missing', 'not in the file — the length in use was kept')
  }

  // ---------------------------------------------------------------- loads
  const uls = readCases(
    first(root, ['cases', 'loadCases', 'ulsCases', 'uls', 'loads.factored', 'uls.loadCases', 'loadCases.uls', 'loadCases.factored']),
    units,
    GROUPS.uls,
    'LC',
    report,
  )
  if (uls) patch.cases = uls

  const sls = readCases(
    first(root, ['slsCases', 'serviceCases', 'sls', 'loads.service', 'sls.loadCases', 'loadCases.service', 'loadCases.sls']),
    units,
    GROUPS.sls,
    'SLC',
    report,
  )
  if (sls) patch.slsCases = sls

  const crack = readCases(
    first(root, ['crackCases', 'crackWidthCases', 'crack.cases', 'loads.crack', 'loadCases.crack']),
    units,
    GROUPS.crack,
    'CWC',
    report,
  )
  if (crack) patch.crackCases = crack

  const shearCases = readShearCases(
    first(root, ['shearCases', 'shearLoadCases', 'loads.shear', 'shear.cases', 'shear.loadCases']),
    units,
    report,
  )
  if (shearCases) patch.shearCases = shearCases

  // ---------------------------------------------------------------- crack width
  const crackSettings = readCrackWidth(first(root, ['crackWidth', 'crack', 'crackWidthSettings', 'durability', 'sls.crackWidth']), code, current, report)
  if (crackSettings) patch.crackWidth = crackSettings
  else if (!report.has(GROUPS.crackSettings)) {
    report.add(
      GROUPS.crackSettings,
      'missing',
      patch.code && patch.code !== current.code
        ? `not in the file — the ${patch.code} default exposure applies, as it does whenever the code changes`
        : 'not in the file — the settings in use were kept',
    )
  }
  // Changing the code invalidates the exposure class the same way it does in the
  // app: the new code's default takes over unless the file supplied one.
  if (patch.code && patch.code !== current.code && !crackSettings) {
    patch.crackWidth = { ...current.crackWidth, exposure: DEFAULT_EXPOSURE[patch.code] }
  }

  // ---------------------------------------------------------------- shear inputs
  const shear = readShear(first(root, ['shear', 'shearSettings', 'shearDesign', 'shearInputs']), current.shear, units, report)
  if (shear) patch.shear = shear
  else if (!report.has(GROUPS.shear)) {
    report.add(GROUPS.shear, 'missing', 'not in the file — the shear inputs in use were kept')
  }

  // ---------------------------------------------------------------- mesh
  const meshRaw = first(root, ['mesh', 'meshSettings', 'meshDensity', 'analysis.mesh'])
  if (meshRaw !== undefined) {
    if (isRec(meshRaw)) {
      const nTheta = num(first(meshRaw, ['nTheta', 'theta', 'thetaSteps', 'circumferential', 'nRings']))
      const nDepth = num(first(meshRaw, ['nDepth', 'depth', 'depthSteps', 'radial', 'nFibres']))
      const bad: string[] = []
      if (nTheta !== null && (!Number.isInteger(nTheta) || nTheta < 4)) bad.push(`nTheta ${nTheta}`)
      if (nDepth !== null && (!Number.isInteger(nDepth) || nDepth < 4)) bad.push(`nDepth ${nDepth}`)
      if (bad.length) {
        report.add(GROUPS.mesh, 'invalid', `${bad.join(' and ')} must be whole numbers of at least 4 — the mesh in use was kept`)
      } else if (nTheta !== null || nDepth !== null) {
        patch.mesh = {
          nTheta: nTheta ?? current.mesh.nTheta,
          nDepth: nDepth ?? current.mesh.nDepth,
        }
        report.add(GROUPS.mesh, 'imported', `${patch.mesh.nTheta} angles × ${patch.mesh.nDepth} depth steps`)
      } else {
        report.add(GROUPS.mesh, 'invalid', 'no nTheta/nDepth in the mesh block — the mesh in use was kept')
      }
    } else {
      report.add(GROUPS.mesh, 'invalid', `mesh "${String(meshRaw)}" is not an object — the mesh in use was kept`)
    }
  } else {
    report.add(GROUPS.mesh, 'missing', 'not in the file — the mesh in use was kept')
  }

  return { state: { ...current, ...patch }, report: finish(report) }
}

/* ------------------------------------------------------------ section reader */

type SectionRead = {
  /** The definition the file described, before the file's own parameters go on. */
  base: PredefinedSection | null
  /** Parameters read from the file for that kind, every length already in mm. */
  params: Partial<Record<string, number>>
  /** True when the file carried a parametric definition of its own. */
  explicit: boolean
  /** The boundary the file gave, when it gave one — the geometry itself. */
  boundary: SectionGeometry | null
  /** Openings the file defines (holes, cutouts, ducts) — rings, in mm. */
  cutouts: Point[][]
  /** Openings that were there but could not be read, with the reason. */
  badCutouts: string[]
  /** `shapeClass` when the file states it, or a circle declared as points. */
  shapeClass: 'rect' | 'circ' | null
  /** Anything the file states about the section that is not applied. */
  notes: string[]
  /** Parameters that were there but unusable, with the reason. */
  badParams: string[]
}

/**
 * Find out how the file describes its section. Nothing is generated here: the
 * caller composes the definition once the reinforcement has been read too, so a
 * bar count from the file can still reach the parametric definition.
 */
function readSection(root: Rec, current: AppState, units: UnitScale): SectionRead {
  const out: SectionRead = {
    base: null,
    params: {},
    explicit: false,
    boundary: null,
    cutouts: [],
    badCutouts: [],
    shapeClass: null,
    notes: [],
    badParams: [],
  }

  const geometry = readGeometry(root, units)
  out.cutouts = geometry.voids
  out.badCutouts = geometry.bad
  out.shapeClass = readShapeClass(root, geometry.boundary)
  out.notes = rotationNotes(root)

  // A complete boundary wins: it is the geometry itself, openings and all.
  if (geometry.boundary) {
    out.boundary = { boundary: geometry.boundary, voids: geometry.voids }
    out.base = readPredefined(first(root, ['predefined', 'sectionDefinition', 'parametric']))
    out.explicit = out.base !== null
    return out
  }

  // Otherwise the section is described by parameters; the app generates the
  // boundary and the bar coordinates from them, exactly as the editor does.
  const explicit = readPredefined(first(root, ['predefined', 'sectionDefinition', 'parametric']))
  const kind = explicit?.kind ?? inferKind(root)
  if (!kind) return out
  out.base = explicit ?? predefinedFor(kind, current)
  out.explicit = explicit !== null
  out.params = readParams(root, out.base, units, out.badParams)
  return out
}

/* ------------------------------------------------------------ the geometry */

/** The outer ring and the openings, however the file writes them. */
type GeometryRead = { boundary: Point[] | null; voids: Point[][]; bad: string[] }

/** Where a file may describe the outer ring of its section. */
const BOUNDARY_PATHS = [
  'geometry.boundary',
  'boundary',
  'outline',
  'polygon',
  'points',
  'vertices',
  'nodeCoordinates',
  'section.boundary',
  'section.outline',
  'section.points',
  'section.vertices',
  'geometry.points',
  'sectionGeometry.boundary',
  'sectionProperties.boundary',
] as const

/** Where it may describe the openings in it. */
const OPENING_PATHS = [
  'geometry.voids',
  'voids',
  'holes',
  'cutouts',
  'openings',
  'ducts',
  'apertures',
  'section.voids',
  'section.holes',
  'section.cutouts',
  'section.openings',
  'geometry.holes',
  'geometry.cutouts',
  'geometry.openings',
] as const

/** A point written as `{x, y}`, `[x, y]` or a `{ X, Y }` pair. */
function toPoint(raw: unknown): Point | null {
  if (Array.isArray(raw)) {
    const x = num(raw[0])
    const y = num(raw[1])
    return x !== null && y !== null ? { x, y } : null
  }
  if (isRec(raw)) {
    const x = num(first(raw, ['x', 'cx', 'easting', 'u']))
    const y = num(first(raw, ['y', 'cy', 'northing', 'v']))
    return x !== null && y !== null ? { x, y } : null
  }
  return null
}

/**
 * A closed ring from whatever the file calls it: a list of points, coordinates
 * written out flat (`[0,0, 400,0, 400,300]`), a circle (`{x, y, diameter}` — a
 * bolt hole, a duct, a round column) or a rectangle (`{x, y, width, height}`
 * from its lower-left corner, or about `{cx, cy}` when the file gives a centre).
 * Lengths arrive in the file's own unit and come back in mm.
 */
function readRing(raw: unknown, units: UnitScale, depth = 0): Point[] | null {
  const scale = (p: Point): Point => ({ x: p.x * units.length, y: p.y * units.length })

  if (Array.isArray(raw)) {
    const pts = raw.map(toPoint)
    if (raw.length >= 3 && pts.every((p): p is Point => p !== null)) return pts.map(scale)
    // coordinates written out flat, one pair after another
    if (raw.length >= 6 && raw.length % 2 === 0) {
      const flat = raw.map(num)
      if (flat.every((v): v is number => v !== null)) {
        const out: Point[] = []
        for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i] * units.length, y: flat[i + 1] * units.length })
        return out
      }
    }
    return null
  }
  if (!isRec(raw) || depth > 2) return null

  // a wrapper the file may have put around the ring itself
  const inner = first(raw, ['points', 'vertices', 'coordinates', 'coords', 'boundary', 'outline', 'ring', 'path'])
  if (inner !== undefined) {
    const ring = readRing(inner, units, depth + 1)
    if (ring) return ring
  }

  const cx = num(first(raw, ['cx', 'x', 'centre.x', 'center.x', 'x0']))
  const cy = num(first(raw, ['cy', 'y', 'centre.y', 'center.y', 'y0']))
  const radius = num(first(raw, ['radius', 'r']))
  const diameter = num(first(raw, ['diameter', 'dia', 'd']))
  const r = radius ?? (diameter !== null ? diameter / 2 : null)
  if (cx !== null && cy !== null && r !== null && r > 0) {
    return circlePoly(cx * units.length, cy * units.length, r * units.length)
  }

  const w = length(raw, ['width', 'w', 'b', 'bx', 'sideX'], units)
  const h = length(raw, ['height', 'depth', 'h', 'by', 'sideY'], units)
  const x0 = num(first(raw, ['x0', 'x1']))
  const y0 = num(first(raw, ['y0', 'y1']))
  if (x0 !== null && y0 !== null) {
    const x1 = num(first(raw, ['x1', 'x2', 'xend']))
    const y1 = num(first(raw, ['y1', 'y2', 'yend']))
    if (x1 !== null && y1 !== null) {
      const xs = [x0 * units.length, x1 * units.length].sort((a, b) => a - b)
      const ys = [y0 * units.length, y1 * units.length].sort((a, b) => a - b)
      return rectRing(xs[0], ys[0], xs[1] - xs[0], ys[1] - ys[0])
    }
  }
  if (w !== null && h !== null && w > 0 && h > 0) {
    const x = num(first(raw, ['cx', 'x', 'centre.x', 'center.x', 'x0'])) ?? 0
    const y = num(first(raw, ['cy', 'y', 'centre.y', 'center.y', 'y0'])) ?? 0
    const centred = first(raw, ['cx', 'cy', 'centre', 'center']) !== undefined
    // `{x, y, width, height}` reads from the lower-left corner unless a centre
    // is given, which is how a cutout is dimensioned most often
    return centred
      ? rectRing((x - w / 2), (y - h / 2), w, h)
      : rectRing(x, y, w, h)
  }
  return null
}

/**
 * A rectangle as a polygon, counter-clockwise from its lower-left corner.
 * Void rings are subtracted from the section, so one winding serves both.
 */
function rectRing(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** The outer ring, the openings, and whatever about them could not be read. */
function readGeometry(root: Rec, units: UnitScale): GeometryRead {
  let boundary: Point[] | null = null
  for (const path of BOUNDARY_PATHS) {
    const raw = deep(root, path)
    if (raw === undefined || raw === null) continue
    const ring = readRing(raw, units)
    if (ring) {
      // Rings are taken counter-clockwise, the winding the app's own generator
      // gives every section, so a file that lists its corners the other way
      // round still lands in the state exactly as a generated one would.
      boundary = ensureCCW(ring)
      break
    }
  }

  const out: GeometryRead = { boundary, voids: [], bad: [] }
  const seen = new Set<string>()
  for (const path of OPENING_PATHS) {
    const raw = deep(root, path)
    if (!Array.isArray(raw)) continue
    raw.forEach((entry: unknown, i: number) => {
      const ring = readRing(entry, units)
      if (!ring || ring.length < 3) {
        out.bad.push(`${path} ${i + 1}`)
        return
      }
      const canonical = ensureCCW(ring)
      const key = JSON.stringify(canonical)
      if (seen.has(key)) return
      seen.add(key)
      out.voids.push(canonical)
    })
  }
  return out
}

/** A file may say outright that its section is circular (or not). */
function readShapeClass(root: Rec, boundary: Point[] | null): 'rect' | 'circ' | null {
  const raw = first(root, ['shapeClass', 'sectionClass', 'section.shapeClass'])
  if (raw === 'circ' || raw === 'circular') return 'circ'
  if (raw === 'rect' || raw === 'rectangular') return 'rect'
  for (const path of ['isCircular', 'circular', 'round', 'geometry.circular', 'section.circular']) {
    const flagValue = flag(deep(root, path))
    if (flagValue !== null) return flagValue ? 'circ' : 'rect'
  }
  const kind = first(root, ['sectionType', 'shape', 'section.type', 'section.shape'])
  if (typeof kind === 'string') {
    const mapped = SECTION_KINDS[idKey(kind)]
    if (mapped === 'circle' || mapped === 'hollowCircle') return 'circ'
  }
  // A circle written out as coordinates: a column or a pile drawn as a ring.
  // Only a generous, evenly spaced ring counts, so a genuine polygon is never
  // mistaken for one.
  if (boundary && isCircularRing(boundary)) return 'circ'
  return null
}

/** True when a ring is an even circle about its own centroid. */
function isCircularRing(ring: Point[]): boolean {
  if (ring.length < 16) return false
  const c = centroid(ring)
  const radii = ring.map((p) => Math.hypot(p.x - c.x, p.y - c.y))
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  if (!(mean > 0)) return false
  return radii.every((r) => Math.abs(r - mean) <= 0.01 * mean)
}

/**
 * Rotation, if the file states one, is **reported rather than applied**: this
 * app has no rotation control, so the only honest reading of a rotated section
 * is what its own coordinates say. Saying so is better than turning the section
 * by an angle the app cannot show or edit.
 */
function rotationNotes(root: Rec): string[] {
  const out: string[] = []
  for (const path of ['rotation', 'rotationDeg', 'rotationAngle', 'rotate', 'rotZ', 'thetaZ', 'orientation', 'section.rotation', 'geometry.rotation']) {
    const value = num(deep(root, path))
    if (value !== null && value !== 0) {
      out.push(`${path} ${value}° is not applied — this app has no rotation control, so the coordinates in the file are taken as they are`)
    }
  }
  return out
}

/** A validated parametric definition, or null when it is not usable. */
function readPredefined(raw: unknown): PredefinedSection | null {
  if (!isRec(raw)) return null
  const kind = typeof raw.kind === 'string' ? SECTION_KINDS[idKey(raw.kind)] : undefined
  if (!kind) return null
  return { ...defaultPredefined(kind), ...readNumeric(raw, kind) } as PredefinedSection
}

/** The numbers a definition in a file gives for its own kind — and nothing else. */
function readNumeric(raw: Rec, kind: PredefinedSection['kind']): Record<string, number> {
  const out: Record<string, number> = {}
  for (const param of Object.keys(PARAMS[kind])) {
    const n = num(at(raw, param))
    if (n !== null) out[param] = n
  }
  return out
}

function predefinedFor(kind: PredefinedSection['kind'], current: AppState): PredefinedSection {
  if (current.predefined && current.predefined.kind === kind) return current.predefined
  return defaultPredefined(kind)
}

/** Which kind of section the file's keys describe. */
function inferKind(root: Rec): PredefinedSection['kind'] | null {
  const scopes = [root, ...SECTION_SCOPES.map((s) => deep(root, s)).filter(isRec)]
  const has = (keys: readonly string[]) => scopes.some((s) => keys.some((k) => s[k] !== undefined))
  const typeRaw = first(root, ['sectionType', 'type', 'shape', 'section.type', 'section.shape'])
  if (typeof typeRaw === 'string') {
    const kind = SECTION_KINDS[idKey(typeRaw)]
    if (kind) return kind
  }
  if (has(['bf', 'tf', 'bw', 'flangeWidth', 'webWidth'])) return 'tee'
  if (has(['bf1', 'bf2', 'tw', 'tf1', 'tf2', 'webThickness'])) return 'ishape'
  if (has(['innerDiameter', 'Di'])) return 'hollowCircle'
  if (has(['diameter', 'od', 'outerDiameter'])) return 'circle'
  if (has(['nx', 'ny', 'barsX', 'barsY', 'nBarsX', 'nBarsY'])) return 'rect'
  if (has(['nBars', 'numberOfBars'])) return 'circle'
  if (has(['width', 'b', 'bx', 'breadth', 'B', 'depth', 'D', 'height', 'h', 'overallDepth'])) return 'rect'
  return null
}

/** Parameter aliases, per kind. Every length is brought to mm. */
const PARAMS: Record<PredefinedSection['kind'], Record<string, readonly string[]>> = {
  rect: { B: ['B', 'b', 'bx', 'width', 'breadth'], D: ['D', 'depth', 'height', 'h', 'overallDepth'], nx: ['nx', 'barsX', 'nBarsX', 'barsAcross'], ny: ['ny', 'barsY', 'nBarsY', 'layers', 'barsPerFace'] },
  circle: { D: ['D', 'diameter', 'outerDiameter', 'od'], nBars: ['nBars', 'numberOfBars', 'numBars', 'barCount', 'n'] },
  hollowCircle: { Do: ['Do', 'D', 'outerDiameter', 'od'], Di: ['Di', 'innerDiameter', 'id'], nBars: ['nBars', 'numberOfBars', 'numBars', 'barCount', 'n'] },
  tee: { bf: ['bf', 'flangeWidth', 'b'], tf: ['tf', 'flangeThickness'], bw: ['bw', 'webWidth', 'tw'], D: ['D', 'depth', 'height', 'h'], nFlange: ['nFlange', 'nBarsFlange', 'flangeBars'], nWeb: ['nWeb', 'nBarsWeb', 'webBars'] },
  ishape: { bf1: ['bf1', 'topFlangeWidth', 'bfTop'], tf1: ['tf1', 'topFlangeThickness'], bf2: ['bf2', 'bottomFlangeWidth', 'bfBottom'], tf2: ['tf2', 'bottomFlangeThickness'], tw: ['tw', 'webThickness', 'bw'], D: ['D', 'depth', 'height', 'h'], nFlange: ['nFlange', 'nBarsFlange'], nWeb: ['nWeb', 'nBarsWeb'] },
  angle: { B: ['B', 'b', 'width', 'legX'], D: ['D', 'depth', 'height', 'h', 'legY'], tw: ['tw', 'thickness', 't'], tf: ['tf', 'flangeThickness'] },
  box: { B: ['B', 'b', 'width'], D: ['D', 'depth', 'height', 'h'], tw: ['tw', 'wallThickness', 'sideThickness', 't'], tf: ['tf', 'topThickness', 'slabThickness'], nx: ['nx', 'barsX', 'nBarsX'], ny: ['ny', 'barsY', 'nBarsY'] },
}

const COUNT_KEYS = new Set(['nx', 'ny', 'nBars', 'nFlange', 'nWeb'])

/**
 * Read the parametric parameters a file gives for a kind. Only usable values
 * come back; anything present but unusable is named in `bad` so the caller can
 * report it rather than let the user believe the file was read.
 */
function readParams(root: Rec, base: PredefinedSection, units: UnitScale, bad: string[]): Partial<Record<string, number>> {
  const table = PARAMS[base.kind]
  const scopes = [
    root,
    ...SECTION_SCOPES.map((s) => deep(root, s)).filter(isRec),
    isRec(deep(root, 'bars')) ? (deep(root, 'bars') as Rec) : null,
    isRec(deep(root, 'mainBars')) ? (deep(root, 'mainBars') as Rec) : null,
  ].filter(isRec) as Rec[]
  const out: Partial<Record<string, number>> = {}

  for (const [param, aliases] of Object.entries(table)) {
    const counts = COUNT_KEYS.has(param)
    for (const scope of scopes) {
      // a length may carry its own unit in the key (`D_mm`), so the reader is
      // asked for the value rather than the key being looked up directly
      const value = counts ? firstCount(scope, aliases) : length(scope, aliases, units)
      if (value === null) {
        const written = counts ? presentWordKey(scope, aliases) : lengthKey(scope, aliases)
        if (written) bad.push(`${written} = ${String(at(scope, written))}`)
        continue
      }
      const usable = counts ? Number.isInteger(Math.round(value)) && value > 0 : value > 0
      if (!usable) {
        bad.push(`${counts ? 'a count' : 'a length'} of ${value}${counts ? '' : ' mm'}`)
        break
      }
      if (counts) {
        // The generator places at least six bars on a ring and two on a face;
        // a smaller count in the file is raised to that and said out loud.
        const floor = (base.kind === 'circle' || base.kind === 'hollowCircle') && param === 'nBars' ? 6 : 2
        const rounded = Math.round(value)
        if (rounded < floor) {
          bad.push(`a count of ${rounded} on ${param}, raised to ${floor} (the fewest the app places there)`)
          out[param] = floor
        } else {
          out[param] = rounded
        }
      } else {
        out[param] = value
      }
      break
    }
  }

  if (base.kind === 'hollowCircle' && out.Do !== undefined && out.Di !== undefined && out.Di >= out.Do) {
    bad.push(`inner diameter ${out.Di} mm, which is not smaller than the outer ${out.Do} mm`)
    delete out.Di
  }
  return out
}

/** The first readable count among the aliases. */
function firstCount(scope: Rec, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const n = num(at(scope, alias))
    if (n !== null) return n
  }
  return null
}

/** nx/ny (or nBars) from an object-shaped `bars` block. */
function readBarCounts(raw: Rec, params: Partial<Record<string, number>>, units: UnitScale) {
  if (params.nBars === undefined) {
    const n = num(first(raw, ['n', 'nBars', 'count', 'numberOfBars', 'total']))
    if (n !== null && n > 0) params.nBars = Math.round(n)
  }
  if (params.nx === undefined) {
    const nx = num(first(raw, ['nx', 'barsX', 'nBarsX', 'perFace']))
    if (nx !== null && nx > 0) params.nx = Math.round(nx)
  }
  if (params.ny === undefined) {
    const ny = num(first(raw, ['ny', 'barsY', 'nBarsY', 'layers']))
    if (ny !== null && ny > 0) params.ny = Math.round(ny)
  }
  const dia = length(raw, ['dia', 'diameter', 'phi', 'barDia', 'size'], units)
  if (dia !== null && dia > 0) params.barDia = dia
}

/* ------------------------------------------------------------ reinforcement */

function readBarRows(rows: readonly unknown[], units: UnitScale, current: AppState, section: SectionRead, report: Report): Rebar[] | null {
  const kept: Rec[] = []
  let dropped = 0
  let missingDia = 0
  for (const row of rows) {
    if (!isRec(row)) {
      dropped += 1
      continue
    }
    const x = length(row, ['x', 'cx'], units)
    const y = length(row, ['y', 'cy'], units)
    if (x === null || y === null) {
      dropped += 1
      continue
    }
    const dia = length(row, ['dia', 'd', 'diameter', 'phi', 'barDia', 'size'], units)
    if (dia === null) missingDia += 1
    const out: Rec = { x, y, dia: dia !== null && dia > 0 ? dia : current.barDia }
    for (const key of ['positioning', 'face', 'surface', 'layer', 'voidIndex', 'groupId', 'axis', 'u', 'radial', 'faces']) {
      const v = at(row, key)
      if (v !== undefined) out[key] = v
    }
    kept.push(out)
  }
  if (!kept.length) {
    report.add(GROUPS.bars, 'invalid', `${rows.length} bar row(s) in the file but none carries usable coordinates — the reinforcement in use was kept`)
    return null
  }
  const notes: string[] = []
  if (dropped) notes.push(`${dropped} row(s) without usable coordinates skipped`)
  if (missingDia) notes.push(`${missingDia} row(s) without a diameter read as ⌀${current.barDia} mm`)
  report.add(GROUPS.bars, 'imported', `${kept.length} bars${notes.length ? ` (${notes.join('; ')})` : ''}`)
  const bars = sanitizeBarRows(kept)
  // A circular table with no bar count in the section parameters: the table is
  // the count, so the parametric definition follows it.
  if (section.base && (section.base.kind === 'circle' || section.base.kind === 'hollowCircle') && section.params.nBars === undefined) {
    section.params.nBars = bars.length
  }
  return bars
}

function mostCommon(values: readonly number[]): number | null {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | null = null
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && v > best)) {
      best = v
      bestCount = n
    }
  }
  return best
}

/* ------------------------------------------------------------ load cases */

function caseName(raw: Rec, index: number, fallback: string): string {
  const name = first(raw, ['name', 'label', 'title', 'case', 'loadCase'])
  return typeof name === 'string' && name.trim() ? name.trim() : `${fallback}${index + 1}`
}

/** ULS / SLS / crack-width rows: axial kN plus the two moments in kN·m. */
function readCases(raw: unknown, units: UnitScale, group: string, prefix: string, report: Report): LoadCase[] | null {
  if (raw === undefined) {
    report.add(group, 'missing', 'not in the file — the cases in use were kept')
    return null
  }
  if (!Array.isArray(raw)) {
    report.add(group, 'invalid', 'the load cases are not a list — the cases in use were kept')
    return null
  }
  const bad: string[] = []
  const cases: LoadCase[] = raw.map((row: unknown, i: number) => {
    const r = isRec(row) ? row : {}
    const name = caseName(r, i, prefix)
    const pu = rowNumber(r, ['Pu', 'P', 'Nu', 'N', 'axial', 'axialForce', 'axialLoad'], force, units)
    const mux = rowNumber(r, ['Mux', 'Mx', 'M_x', 'momentX', 'momentAboutX'], moment, units)
    const muy = rowNumber(r, ['Muy', 'My', 'M_y', 'momentY', 'momentAboutY'], moment, units)
    for (const [read, label] of [
      [pu, 'axial load'],
      [mux, 'Mx'],
      [muy, 'My'],
    ] as const) {
      if (read.bad) bad.push(`${name}: ${label} "${String(at(r, read.bad))}" is not a number — read as 0`)
    }
    const id = at(r, 'id')
    return {
      id: typeof id === 'string' && id ? id : newCaseId(),
      name,
      Pu: pu.value,
      Mux: mux.value,
      Muy: muy.value,
    }
  })
  report.add(group, bad.length ? 'invalid' : 'imported', `${cases.length} case(s)${cases.length ? `: ${cases.map((c) => c.name).join(', ')}` : ''}${bad.length ? `. ${bad.slice(0, 3).join('; ')}` : ''}`)
  return cases
}

/** Shear rows: Vu and Pu, both in kN. */
function readShearCases(raw: unknown, units: UnitScale, report: Report): ShearLoadCase[] | null {
  if (raw === undefined) {
    report.add(GROUPS.shearCases, 'missing', 'not in the file — the shear cases in use were kept')
    return null
  }
  if (!Array.isArray(raw)) {
    report.add(GROUPS.shearCases, 'invalid', 'the shear cases are not a list — the cases in use were kept')
    return null
  }
  const bad: string[] = []
  const cases: ShearLoadCase[] = raw.map((row: unknown, i: number) => {
    const r = isRec(row) ? row : {}
    const name = caseName(r, i, 'SC')
    const vu = rowNumber(r, ['Vu', 'V', 'VEd', 'shearForce', 'shear', 'V_Ed'], force, units)
    const pu = rowNumber(r, ['Pu', 'P', 'N', 'Nu', 'axial', 'axialForce', 'axialLoad'], force, units)
    for (const [read, label] of [
      [vu, 'shear force'],
      [pu, 'axial load'],
    ] as const) {
      if (read.bad) bad.push(`${name}: ${label} "${String(at(r, read.bad))}" is not a number — read as 0`)
    }
    const id = at(r, 'id')
    return { id: typeof id === 'string' && id ? id : newShearCaseId(), name, Vu: vu.value, Pu: pu.value }
  })
  report.add(GROUPS.shearCases, bad.length ? 'invalid' : 'imported', `${cases.length} case(s)${cases.length ? `: ${cases.map((c) => c.name).join(', ')}` : ''}${bad.length ? `. ${bad.slice(0, 3).join('; ')}` : ''}`)
  return cases
}

/* ------------------------------------------------------------ crack width */

function readCrackWidth(raw: unknown, code: AppState['code'], current: AppState, report: Report) {
  if (raw === undefined) return null
  if (!isRec(raw)) {
    report.add(GROUPS.crackSettings, 'invalid', 'the crack-width inputs are not an object — the settings in use were kept')
    return null
  }
  const exposureRaw = first(raw, ['exposure', 'exposureClass', 'environment', 'class', 'environmentalClass'])
  const longTermRaw = first(raw, ['longTerm', 'sustained', 'longTermLoad', 'quasiPermanent', 'permanent'])
  const exposure =
    typeof exposureRaw === 'string' ? EXPOSURE_OPTIONS[code].find((o) => idKey(o.value) === idKey(exposureRaw))?.value : undefined
  const longTerm = flag(longTermRaw)
  if (exposureRaw !== undefined && !exposure) {
    report.add(GROUPS.crackSettings, 'invalid', `exposure "${String(exposureRaw)}" is not one of ${EXPOSURE_OPTIONS[code].map((o) => o.value).join(', ')} for ${code} — the exposure in use was kept`)
  }
  if (exposure === undefined && longTerm === null) {
    report.add(GROUPS.crackSettings, 'invalid', 'no exposure class or load duration in the crack-width block — the settings in use were kept')
    return null
  }
  const settings = {
    exposure: exposure ?? current.crackWidth.exposure,
    longTerm: longTerm ?? current.crackWidth.longTerm,
  }
  report.add(GROUPS.crackSettings, 'imported', `exposure ${settings.exposure}, ${settings.longTerm ? 'long-term' : 'short-term'} loading`)
  return settings
}

/* ------------------------------------------------------------ shear inputs */

function readShear(raw: unknown, current: ShearSettings, units: UnitScale, report: Report): ShearSettings | null {
  if (raw === undefined) return null
  if (!isRec(raw)) {
    report.add(GROUPS.shear, 'invalid', 'the shear inputs are not an object — the inputs in use were kept')
    return null
  }
  const axisRaw = first(raw, ['axis', 'direction', 'bendingAxis'])
  const axis: ShearAxis | null =
    typeof axisRaw === 'string' ? (unitKey(axisRaw).startsWith('x') || unitKey(axisRaw) === 'major' ? 'x' : unitKey(axisRaw).startsWith('y') || unitKey(axisRaw) === 'minor' ? 'y' : null) : null
  const resolvedAxis = axis ?? current.axis
  const faces = tensionFaceOptions(resolvedAxis)
  const faceRaw = first(raw, ['tensionFace', 'face', 'tensionSide', 'extremeFibre'])
  const face = typeof faceRaw === 'string' ? faces.find((f) => unitKey(f) === unitKey(faceRaw)) ?? faces.find((f) => f.startsWith(unitKey(faceRaw).slice(0, 3))) : undefined
  const memberRaw = first(raw, ['member', 'memberType', 'element'])
  const member = typeof memberRaw === 'string' && ['beam', 'column'].includes(unitKey(memberRaw)) ? (unitKey(memberRaw) as 'beam' | 'column') : undefined
  const linkShapeRaw = first(raw, ['linkShape', 'stirrupShape', 'shape'])
  const linkShape =
    typeof linkShapeRaw === 'string' && ['auto', 'rectangular', 'circular'].includes(unitKey(linkShapeRaw)) ? (unitKey(linkShapeRaw) as ShearSettings['linkShape']) : undefined
  const layoutRaw = first(raw, ['linkLayout', 'layout', 'arrangementSource'])
  const linkLayout = typeof layoutRaw === 'string' && ['auto', 'manual'].includes(unitKey(layoutRaw)) ? (unitKey(layoutRaw) as ShearSettings['linkLayout']) : undefined

  const linkDia = length(raw, ['linkDia', 'stirrupDia', 'linkDiameter', 'tieDia'], units)
  const linkLegs = num(first(raw, ['linkLegs', 'legs', 'nLegs', 'legCount']))
  const linkSpacing = length(raw, ['linkSpacing', 'spacing', 'sv', 's', 'stirrupSpacing'], units)
  const bOverride = length(raw, ['bOverride', 'b', 'bw', 'webWidth'], units)
  const dOverride = length(raw, ['dOverride', 'd', 'deff', 'effectiveDepth'], units)
  const aslOverride = num(first(raw, ['aslOverride', 'Asl', 'asl', 'tensionSteel', 'Ast']))
  const criticalDistance = length(raw, ['criticalDistance', 'av', 'distance', 'supportDistance'], units)
  const enhance = flag(first(raw, ['enhance', 'enhancement', 'axialEnhancement', 'enhancedShear']))
  const cotRaw = num(first(raw, ['cotTheta', 'cot', 'cotθ', 'cotThetaValue']))

  const next: ShearSettings = {
    ...current,
    axis: resolvedAxis,
    tensionFace: face ?? (axis ? faces[0] : current.tensionFace),
  }
  const applied: string[] = []
  const invalid: string[] = []
  if (axis) applied.push(`axis ${axis}`)
  if (face) applied.push(`tension face ${face}`)
  if (member) {
    next.member = member
    applied.push(`${member}`)
  }
  if (linkDia !== null) {
    if (linkDia > 0) {
      next.linkDia = linkDia
      applied.push(`link ⌀${linkDia}`)
    } else invalid.push(`link ⌀${linkDia}`)
  }
  if (linkLegs !== null) {
    if (Number.isInteger(linkLegs) && linkLegs >= 2) {
      next.linkLegs = linkLegs
      applied.push(`${linkLegs} legs`)
    } else invalid.push(`${linkLegs} legs`)
  }
  if (linkSpacing !== null) {
    if (linkSpacing > 0) {
      next.linkSpacing = linkSpacing
      applied.push(`spacing ${linkSpacing} mm`)
    } else invalid.push(`spacing ${linkSpacing}`)
  }
  if (bOverride !== null) {
    next.bOverride = bOverride > 0 ? bOverride : null
    applied.push(`b override ${bOverride}`)
  }
  if (dOverride !== null) {
    next.dOverride = dOverride > 0 ? dOverride : null
    applied.push(`d override ${dOverride}`)
  }
  if (aslOverride !== null) {
    next.aslOverride = aslOverride > 0 ? aslOverride : null
    applied.push(`Asl override ${aslOverride} mm²`)
  }
  if (criticalDistance !== null) {
    next.criticalDistance = criticalDistance > 0 ? criticalDistance : 0
    applied.push(`support distance ${next.criticalDistance} mm`)
  }
  if (enhance !== null) {
    next.enhance = enhance
    applied.push(enhance ? 'enhanced shear on' : 'enhanced shear off')
  }
  if (cotRaw !== null) {
    if (cotRaw >= MIN_COT_THETA && cotRaw <= MAX_COT_THETA) {
      next.cotTheta = cotRaw
      applied.push(`cot θ = ${cotRaw}`)
    } else invalid.push(`cot θ ${cotRaw} (outside ${MIN_COT_THETA}–${MAX_COT_THETA})`)
  }
  if (linkShape) {
    next.linkShape = linkShape
    applied.push(`link shape ${linkShape}`)
  }
  if (linkLayout) {
    next.linkLayout = linkLayout
    applied.push(`link layout ${linkLayout}`)
  }
  const legPositions = first(raw, ['legPositions', 'legs_u', 'legPositionsU'])
  if (legPositions !== undefined) {
    next.legPositions = sanitizeLinkPositions(legPositions)
    applied.push(`${next.legPositions.length} leg position(s)`)
  }
  const tiePositions = first(raw, ['tiePositions', 'ties_u'])
  if (tiePositions !== undefined) {
    next.tiePositions = sanitizeLinkPositions(tiePositions)
    applied.push(`${next.tiePositions.length} tie position(s)`)
  }

  if (invalid.length) {
    report.add(GROUPS.shear, 'invalid', `${invalid.join(', ')} — those inputs were kept`)
  }
  if (!applied.length) {
    if (!report.has(GROUPS.shear)) report.add(GROUPS.shear, 'invalid', 'the shear block carries nothing this app recognises — the inputs in use were kept')
    return null
  }
  report.add(GROUPS.shear, 'imported', applied.join(', '))
  return next
}

/* ------------------------------------------------------------------ helpers */

function countNegatives(raw: unknown): number {
  if (typeof raw === 'number') return raw < 0 ? 1 : 0
  if (Array.isArray(raw)) return raw.reduce((n, v) => n + countNegatives(v), 0)
  if (isRec(raw)) return Object.values(raw).reduce((n: number, v) => n + countNegatives(v), 0)
  return 0
}

/** Scale every number in a cover description (numbers only — names are kept). */
function scaleLengths(raw: unknown, factor: number): unknown {
  if (typeof raw === 'number') return raw * factor
  if (Array.isArray(raw)) return raw.map((v) => scaleLengths(v, factor))
  if (isRec(raw)) {
    const out: Rec = {}
    for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'number' ? v * factor : scaleLengths(v, factor)
    return out
  }
  return raw
}
