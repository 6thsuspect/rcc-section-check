import type { AppState } from './state'
import { initialState } from './state'
import { normalizeCover } from './engine/cover'
import { generateSection } from './engine/sections'
import type { Rebar, RebarFace, RebarPositioningMode, RebarSurface, LoadCase } from './engine/types'
import { DEFAULT_EXPOSURE, EXPOSURE_OPTIONS } from './engine/crackWidth'
import {
  DEFAULT_SHEAR,
  MAX_COT_THETA,
  MIN_COT_THETA,
  tensionFaceOptions,
  type ShearAxis,
  type ShearLoadCase,
  type ShearMember,
  type ShearSettings,
} from './engine/shear'

export interface ProjectFile {
  version: string
  app: string
  exportedAt: string
  state: AppState
}

/**
 * Downloads the current AppState as a formatted JSON project file.
 */
export function exportProjectFile(state: AppState, customFilename?: string) {
  const project: ProjectFile = {
    version: '1.5',
    app: 'RCC Section Check',
    exportedAt: new Date().toISOString(),
    state,
  }
  const jsonStr = JSON.stringify(project, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const dateStr = new Date().toISOString().slice(0, 10)
  a.download = customFilename || `rcc-section-project-${dateStr}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Parses and validates JSON text from an imported project file.
 * Returns a sanitized AppState or throws an Error.
 */
export function parseProjectFile(jsonText: string): AppState {
  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('Invalid project file: Content is not valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid project file format: Root content is not a JSON object.')
  }

  // Handle both wrapper format { version, app, state } and direct AppState format
  const rawState = parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed

  const defState = initialState()

  /** Coerce one persisted load-case row into a sanitized LoadCase. */
  const mapCase = (c: any, id: string, name: string): LoadCase => ({
    id,
    name,
    Pu: Number.isFinite(c?.Pu) ? Number(c.Pu) : 0,
    Mux: Number.isFinite(c?.Mux) ? Number(c.Mux) : 0,
    Muy: Number.isFinite(c?.Muy) ? Number(c.Muy) : 0,
  })

  /** Coerce one persisted shear case row into a sanitized ShearLoadCase. */
  const mapShearCase = (c: any, id: string, name: string): ShearLoadCase => ({
    id,
    name,
    Vu: Number.isFinite(c?.Vu) ? Number(c.Vu) : 0,
    Pu: Number.isFinite(c?.Pu) ? Number(c.Pu) : 0,
  })

  if (!rawState.geometry || typeof rawState.geometry !== 'object' || !Array.isArray(rawState.geometry.boundary)) {
    throw new Error('Invalid project file: missing or invalid geometry boundary.')
  }

  if (!Array.isArray(rawState.bars)) {
    throw new Error('Invalid project file: missing or invalid reinforcement bars list.')
  }

  if (!Array.isArray(rawState.cases)) {
    throw new Error('Invalid project file: missing or invalid load cases list.')
  }

  const code: AppState['code'] = ['IS456', 'IRC112', 'IRSCBC'].includes(rawState.code)
    ? rawState.code
    : defState.code
  const rawCw = rawState.crackWidth && typeof rawState.crackWidth === 'object' ? rawState.crackWidth : {}
  const exposureOk =
    typeof rawCw.exposure === 'string' && EXPOSURE_OPTIONS[code].some((o) => o.value === rawCw.exposure)

  // v1.2 adds separate service (SLS) load cases; older files seed from the ULS
  // cases. v1.3 adds a third list for the crack-width check, which falls back to
  // the SLS cases. Fresh ids keep every list independently editable.
  const slsCases: LoadCase[] = Array.isArray(rawState.slsCases)
    ? rawState.slsCases.map((c: any, idx: number) =>
        mapCase(c, typeof c?.id === 'string' ? c.id : `slc-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `SLC${idx + 1}`),
      )
    : rawState.cases.map((c: any, idx: number) =>
        mapCase(c, `slc-fallback-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `SLC${idx + 1}`),
      )
  const crackCases: LoadCase[] = Array.isArray(rawState.crackCases)
    ? rawState.crackCases.map((c: any, idx: number) =>
        mapCase(c, typeof c?.id === 'string' ? c.id : `cwc-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `CWC${idx + 1}`),
      )
    : slsCases.map((c, idx) =>
        mapCase(c, `cwc-fallback-${idx + 1}-${Date.now()}`, c.name),
      )

  // v1.4 adds the shear design tab. Older files have no shear cases: seed one
  // case per ULS combination (Vu = 0, same axial load and name) so the tab opens
  // on the file's own load set and the user only has to enter the shear forces.
  const shearCases: ShearLoadCase[] = Array.isArray(rawState.shearCases)
    ? rawState.shearCases.map((c: any, idx: number) =>
        mapShearCase(c, typeof c?.id === 'string' ? c.id : `sc-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `SC${idx + 1}`),
      )
    : rawState.cases.map((c: any, idx: number) =>
        mapShearCase(
          { Vu: 0, Pu: Number.isFinite(c?.Pu) ? Number(c.Pu) : 0 },
          `sc-fallback-${idx + 1}-${Date.now()}`,
          typeof c?.name === 'string' ? c.name : `SC${idx + 1}`,
        ),
      )

  const rawShear = rawState.shear && typeof rawState.shear === 'object' ? rawState.shear : {}
  /** Normalised 0…1 member positions, deduped and sorted. */
  const sanitiserPositions = (v: any): number[] => {
    if (!Array.isArray(v)) return []
    const out: number[] = []
    for (const raw of v) {
      // only numbers (or numeric strings) count — null / booleans are not positions
      if (typeof raw !== 'number' && typeof raw !== 'string') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      // keep slightly out-of-range entries: the editor reports them instead of
      // quietly moving the user's link layout
      const u = Math.min(Math.max(n, -1), 2)
      if (out.every((x) => Math.abs(x - u) > 1e-6)) out.push(u)
    }
    return out.sort((a, b) => a - b)
  }
  const shearAxis: ShearAxis = rawShear.axis === 'x' ? 'x' : 'y'
  const faceOptions = tensionFaceOptions(shearAxis)
  const shear: ShearSettings = {
    axis: shearAxis,
    tensionFace: faceOptions.includes(rawShear.tensionFace) ? rawShear.tensionFace : faceOptions[0],
    member: (rawShear.member === 'beam' || rawShear.member === 'column' ? rawShear.member : DEFAULT_SHEAR.member) as ShearMember,
    linkDia: Number.isFinite(rawShear.linkDia) && rawShear.linkDia > 0 ? Number(rawShear.linkDia) : DEFAULT_SHEAR.linkDia,
    linkLegs: Number.isInteger(rawShear.linkLegs) && rawShear.linkLegs >= 2 ? Number(rawShear.linkLegs) : DEFAULT_SHEAR.linkLegs,
    linkSpacing: Number.isFinite(rawShear.linkSpacing) && rawShear.linkSpacing > 0 ? Number(rawShear.linkSpacing) : DEFAULT_SHEAR.linkSpacing,
    bOverride: Number.isFinite(rawShear.bOverride) && rawShear.bOverride > 0 ? Number(rawShear.bOverride) : null,
    dOverride: Number.isFinite(rawShear.dOverride) && rawShear.dOverride > 0 ? Number(rawShear.dOverride) : null,
    aslOverride: Number.isFinite(rawShear.aslOverride) && rawShear.aslOverride > 0 ? Number(rawShear.aslOverride) : null,
    criticalDistance: Number.isFinite(rawShear.criticalDistance) && rawShear.criticalDistance > 0 ? Number(rawShear.criticalDistance) : 0,
    enhance: rawShear.enhance === true,
    cotTheta: Number.isFinite(rawShear.cotTheta)
      ? Math.min(MAX_COT_THETA, Math.max(MIN_COT_THETA, Number(rawShear.cotTheta)))
      : DEFAULT_SHEAR.cotTheta,
    // v1.5 link detailing: shape, arrangement source and manual leg / tie lists.
    linkShape:
      rawShear.linkShape === 'rectangular' || rawShear.linkShape === 'circular' ? rawShear.linkShape : DEFAULT_SHEAR.linkShape,
    linkLayout: rawShear.linkLayout === 'manual' ? 'manual' : DEFAULT_SHEAR.linkLayout,
    legPositions: sanitiserPositions(rawShear.legPositions),
    tiePositions: sanitiserPositions(rawShear.tiePositions),
  }

  const sanitized: AppState = {
    code,
    geometry: {
      boundary: rawState.geometry.boundary.map((p: any) => ({
        x: Number.isFinite(p?.x) ? Number(p.x) : 0,
        y: Number.isFinite(p?.y) ? Number(p.y) : 0,
      })),
      voids: Array.isArray(rawState.geometry.voids)
        ? rawState.geometry.voids.map((v: any) =>
            Array.isArray(v)
              ? v.map((p: any) => ({
                  x: Number.isFinite(p?.x) ? Number(p.x) : 0,
                  y: Number.isFinite(p?.y) ? Number(p.y) : 0,
                }))
              : []
          )
        : [],
    },
    bars: rawState.bars.map((b: any) => {
      const validFaces: RebarFace[] = ['bottom', 'right', 'top', 'left']
      const faces = Array.isArray(b?.faces) ? b.faces.filter((f: any): f is RebarFace => validFaces.includes(f)) : undefined
      const positioning: RebarPositioningMode | undefined =
        b?.positioning === 'automatic' || b?.positioning === 'manual' ? b.positioning : undefined
      const surface: RebarSurface | undefined = b?.surface === 'inner' || b?.surface === 'outer' ? b.surface : undefined
      const bar: Rebar = {
        x: Number.isFinite(b?.x) ? Number(b.x) : 0,
        y: Number.isFinite(b?.y) ? Number(b.y) : 0,
        dia: Number.isFinite(b?.dia) && b.dia > 0 ? Number(b.dia) : 20,
      }
      if (positioning) bar.positioning = positioning
      const face = validFaces.includes(b?.face) ? (b.face as RebarFace) : faces?.[0]
      if (face) bar.face = face
      if (faces?.length) bar.faces = faces
      if (surface) bar.surface = surface
      if (Number.isInteger(b?.voidIndex) && b.voidIndex >= 0) bar.voidIndex = Number(b.voidIndex)
      if (Number.isInteger(b?.layer) && b.layer >= 0) bar.layer = Number(b.layer)
      if (typeof b?.groupId === 'string') bar.groupId = b.groupId
      if (b?.axis === 'x' || b?.axis === 'y') bar.axis = b.axis
      if (Number.isFinite(b?.u)) bar.u = Math.max(0, Math.min(1, Number(b.u)))
      if (b?.radial === true) bar.radial = true
      return bar
    }),
    predefined: rawState.predefined ?? null,
    shapeClass: ['rect', 'circ'].includes(rawState.shapeClass) ? rawState.shapeClass : defState.shapeClass,
    fck: Number.isFinite(rawState.fck) && rawState.fck > 0 ? Number(rawState.fck) : defState.fck,
    steelGrade: typeof rawState.steelGrade === 'string' ? rawState.steelGrade : defState.steelGrade,
    // v1.0 files stored a single cover number; v1.1 stores it per face.
    cover: normalizeCover(rawState.cover, defState.cover),
    tieDia: Number.isFinite(rawState.tieDia) ? Number(rawState.tieDia) : defState.tieDia,
    barDia: Number.isFinite(rawState.barDia) ? Number(rawState.barDia) : defState.barDia,
    memberLength: Number.isFinite(rawState.memberLength) ? Number(rawState.memberLength) : defState.memberLength,
    cases: rawState.cases.map((c: any, idx: number) =>
      mapCase(c, typeof c?.id === 'string' ? c.id : `lc-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `LC${idx + 1}`),
    ),
    slsCases,
    // v1.3 crack-width load cases; older files inherit the (sanitized) SLS set.
    crackCases,
    crackWidth: {
      exposure: exposureOk ? rawCw.exposure : DEFAULT_EXPOSURE[code],
      longTerm: rawCw.longTerm === true,
    },
    shearCases,
    // v1.4 shear inputs; older files open with the code-neutral defaults.
    shear,
    mesh:
      rawState.mesh && typeof rawState.mesh === 'object'
        ? {
            nTheta: Number.isFinite(rawState.mesh.nTheta) ? Number(rawState.mesh.nTheta) : defState.mesh.nTheta,
            nDepth: Number.isFinite(rawState.mesh.nDepth) ? Number(rawState.mesh.nDepth) : defState.mesh.nDepth,
          }
        : defState.mesh,
  }

  // v1.0/v1.1 files did not carry placement metadata. If an old predefined
  // layout still exactly matches the generator, migrate only that layout to
  // automatic; hand-edited coordinates remain manual and are never guessed.
  const legacyRows = rawState.bars.every((b: any) => b?.positioning == null)
  if (legacyRows && sanitized.predefined && typeof sanitized.predefined === 'object') {
    try {
      const generated = generateSection(sanitized.predefined, {
        cover: sanitized.cover,
        tieDia: sanitized.tieDia,
        barDia: sanitized.barDia,
      })
      const sameLayout =
        generated.bars.length === sanitized.bars.length &&
        generated.bars.every((bar, i) => {
          const saved = sanitized.bars[i]
          return Math.abs(bar.x - saved.x) < 0.01 && Math.abs(bar.y - saved.y) < 0.01 && Math.abs(bar.dia - saved.dia) < 0.01
        })
      if (sameLayout) sanitized.bars = generated.bars
    } catch {
      // A malformed legacy parametric definition is still loaded as its saved
      // coordinate table; the normal geometry/cover validation will report it.
    }
  }

  return sanitized
}
