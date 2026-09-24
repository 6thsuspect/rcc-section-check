import type { AppState } from './state'
import { initialState } from './state'
import { normalizeCover } from './engine/cover'
import { generateSection } from './engine/sections'
import type { Rebar, RebarFace, RebarPositioningMode, RebarSurface, LoadCase } from './engine/types'

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
    version: '1.2',
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

  if (!rawState.geometry || typeof rawState.geometry !== 'object' || !Array.isArray(rawState.geometry.boundary)) {
    throw new Error('Invalid project file: missing or invalid geometry boundary.')
  }

  if (!Array.isArray(rawState.bars)) {
    throw new Error('Invalid project file: missing or invalid reinforcement bars list.')
  }

  if (!Array.isArray(rawState.cases)) {
    throw new Error('Invalid project file: missing or invalid load cases list.')
  }

  const sanitized: AppState = {
    code: ['IS456', 'IRC112', 'IRSCBC'].includes(rawState.code) ? rawState.code : defState.code,
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
    // v1.2 adds separate service (SLS) load cases. Older files have none, so we
    // seed the SLS set from the ULS cases (with fresh ids) to keep the two lists
    // independently editable; v1.2 files round-trip their own slsCases.
    slsCases: Array.isArray(rawState.slsCases)
      ? rawState.slsCases.map((c: any, idx: number) =>
          mapCase(c, typeof c?.id === 'string' ? c.id : `slc-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `SLC${idx + 1}`),
        )
      : rawState.cases.map((c: any, idx: number) =>
          mapCase(c, `slc-fallback-${idx + 1}-${Date.now()}`, typeof c?.name === 'string' ? c.name : `SLC${idx + 1}`),
        ),
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
