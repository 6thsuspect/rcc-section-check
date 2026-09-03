import type { AppState } from './state'
import { initialState } from './state'

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
    version: '1.0',
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
    bars: rawState.bars.map((b: any) => ({
      x: Number.isFinite(b?.x) ? Number(b.x) : 0,
      y: Number.isFinite(b?.y) ? Number(b.y) : 0,
      dia: Number.isFinite(b?.dia) && b.dia > 0 ? Number(b.dia) : 20,
    })),
    predefined: rawState.predefined ?? null,
    shapeClass: ['rect', 'circ'].includes(rawState.shapeClass) ? rawState.shapeClass : defState.shapeClass,
    fck: Number.isFinite(rawState.fck) && rawState.fck > 0 ? Number(rawState.fck) : defState.fck,
    steelGrade: typeof rawState.steelGrade === 'string' ? rawState.steelGrade : defState.steelGrade,
    cover: Number.isFinite(rawState.cover) ? Number(rawState.cover) : defState.cover,
    tieDia: Number.isFinite(rawState.tieDia) ? Number(rawState.tieDia) : defState.tieDia,
    barDia: Number.isFinite(rawState.barDia) ? Number(rawState.barDia) : defState.barDia,
    memberLength: Number.isFinite(rawState.memberLength) ? Number(rawState.memberLength) : defState.memberLength,
    cases: rawState.cases.map((c: any, idx: number) => ({
      id: typeof c?.id === 'string' ? c.id : `lc-${idx + 1}-${Date.now()}`,
      name: typeof c?.name === 'string' ? c.name : `LC${idx + 1}`,
      Pu: Number.isFinite(c?.Pu) ? Number(c.Pu) : 0,
      Mux: Number.isFinite(c?.Mux) ? Number(c.Mux) : 0,
      Muy: Number.isFinite(c?.Muy) ? Number(c.Muy) : 0,
    })),
    mesh:
      rawState.mesh && typeof rawState.mesh === 'object'
        ? {
            nTheta: Number.isFinite(rawState.mesh.nTheta) ? Number(rawState.mesh.nTheta) : defState.mesh.nTheta,
            nDepth: Number.isFinite(rawState.mesh.nDepth) ? Number(rawState.mesh.nDepth) : defState.mesh.nDepth,
          }
        : defState.mesh,
  }

  return sanitized
}
