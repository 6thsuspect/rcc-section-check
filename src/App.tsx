import { useMemo, useRef, useState } from 'react'
import type { CaseResult } from './engine/types'
import { CODES } from './engine/codes'
import { ensureCCW, isSimplePolygon, sectionProperties, signedArea } from './engine/geometry'
import { buildAnalysisModel } from './engine/integrator'
import { checkLoadCase, flexuralCapacity, generateSurface, naForDirection } from './engine/surface'
import { complianceChecks } from './engine/checks'
import { exportReport } from './report'
import { exportProjectFile, parseProjectFile } from './projectFile'
import { initialState, type AppState } from './state'
import { SectionPreview, type NAInfo } from './components/SectionPreview'
import { PMChart, ContourChart } from './components/Charts'
import { CodeMaterialsPanel, LoadCasesPanel, RebarPanel, SectionPanel } from './components/Editors'
import { CompliancePanel, ResultsTable } from './components/Results'
import { Card } from './components/ui'

export default function App() {
  const [state, setState] = useState<AppState>(initialState)
  const [selCase, setSelCase] = useState<string | null>(state.cases[0]?.id ?? null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }))

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const newAppState = parseProjectFile(text)
        setState(newAppState)
        if (newAppState.cases.length > 0) {
          setSelCase(newAppState.cases[0].id)
        }
        setImportError(null)
        setImportSuccess(`Successfully imported project from "${file.name}"`)
        setTimeout(() => setImportSuccess(null), 5000)
      } catch (err: any) {
        setImportSuccess(null)
        setImportError(err.message || 'Failed to parse project file.')
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.readAsText(file)
  }

  const handleExportClick = () => {
    exportProjectFile(state)
  }

  const spec = CODES[state.code]
  const grade = spec.steelGrades.find((g) => g.label === state.steelGrade) ?? spec.steelGrades[0]

  // --- validation ---
  const issues = useMemo(() => {
    const out: string[] = []
    const b = state.geometry.boundary
    if (b.length < 3) out.push('Boundary needs at least 3 vertices.')
    else {
      if (Math.abs(signedArea(b)) < 100) out.push('Boundary area is (near) zero.')
      if (!isSimplePolygon(b)) out.push('Boundary polygon self-intersects.')
    }
    for (let i = 0; i < state.geometry.voids.length; i++) {
      const v = state.geometry.voids[i]
      if (v.length >= 3 && !isSimplePolygon(v)) out.push(`Void ${i + 1} self-intersects.`)
    }
    if (state.bars.length === 0) out.push('No reinforcement bars defined.')
    const seen = new Set<string>()
    for (const bar of state.bars) {
      const k = `${bar.x.toFixed(1)}|${bar.y.toFixed(1)}`
      if (seen.has(k)) {
        out.push('Duplicate bar coordinates present.')
        break
      }
      seen.add(k)
    }
    return out
  }, [state.geometry, state.bars])

  const valid = issues.length === 0

  const props = useMemo(
    () => (valid ? sectionProperties(state.geometry, state.bars) : null),
    [valid, state.geometry, state.bars],
  )

  // --- interaction surface (the expensive step) ---
  const surface = useMemo(() => {
    if (!valid || !props) return null
    const conc = spec.concrete(state.fck)
    const steel = spec.steel(grade.fy)
    const model = buildAnalysisModel(
      { boundary: ensureCCW(state.geometry.boundary), voids: state.geometry.voids.map(ensureCCW) },
      state.bars,
      { x: props.cx, y: props.cy },
      props.area,
      conc,
      steel,
      spec.epsSteelLimit(grade),
    )
    return generateSurface(model, state.mesh)
  }, [valid, props, spec, grade, state.geometry, state.bars, state.fck, state.mesh])

  const results: CaseResult[] = useMemo(() => {
    if (!surface || !props) return []
    return state.cases.map((lc) =>
      checkLoadCase(surface, lc, spec, state.fck, grade.fy, props.area, props.Asc, state.shapeClass),
    )
  }, [surface, props, state.cases, spec, state.fck, grade.fy, state.shapeClass])

  const checks = useMemo(() => {
    if (!props) return []
    return complianceChecks(spec, {
      props,
      bars: state.bars,
      geometry: state.geometry,
      fck: state.fck,
      fy: grade.fy,
      cases: state.cases,
      shapeClass: state.shapeClass,
      memberLength: state.memberLength > 0 ? state.memberLength : undefined,
    })
  }, [props, spec, state.bars, state.geometry, state.fck, grade.fy, state.cases, state.shapeClass, state.memberLength])

  const selected = state.cases.find((c) => c.id === selCase) ?? state.cases[0] ?? null
  const selResult = results.find((r) => r.loadCase.id === selected?.id) ?? null
  const anyFail = results.some((r) => !r.ok) || checks.some((c) => c.status === 'fail')

  const flex = useMemo(() => (surface ? flexuralCapacity(surface) : null), [surface])

  // governing neutral axis of the capacity state for the selected case
  const naInfo: NAInfo | null = useMemo(() => {
    if (!surface || !selected || !selResult || selResult.axialGoverned || selResult.MEd < 1) return null
    const cp = naForDirection(surface, selected.Pu * 1e3, selected.Mux, selected.Muy)
    if (!cp || Math.abs(cp.b) < 1e-9) return null
    return {
      theta: cp.theta,
      vna: -cp.a / cp.b,
      caption: `Neutral axis at the capacity state for ${selected.name} (P = Pu along the demand direction; NA angle ${((cp.theta * 180) / Math.PI).toFixed(0)}°)`,
    }
  }, [surface, selected, selResult])

  const exportPdf = () => {
    if (!surface || !props || results.length === 0) return
    const grab = (id: string, base: string) => {
      const el = document.getElementById(id)
      return el ? el.outerHTML.replace(/viewBox="[^"]*"/, `viewBox="${base}"`) : '<p><i>figure unavailable</i></p>'
    }
    exportReport({
      state,
      spec,
      grade,
      props,
      surface,
      results,
      checks,
      flex,
      selectedName: selected?.name ?? '',
      svgs: {
        section: grab('fig-section', '0 0 460 340'),
        pm: grab('fig-pm', '0 0 520 400'),
        contour: grab('fig-contour', '0 0 460 420'),
      },
    })
  }

  return (
    <div className="min-h-full">
      <header className="border-b-2 border-ink bg-card">
        <div className="max-w-[1500px] mx-auto px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-[20px] font-bold tracking-tight">RCC Section Check</h1>
            <span className="text-[12px] text-ink-3">
              biaxial P–Mx–My interaction · {spec.name}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,.rcc"
              className="hidden"
            />
            <button
              type="button"
              onClick={handleImportClick}
              className="font-display font-semibold tracking-wide uppercase border border-edge-strong bg-panel text-ink-2 rounded px-2.5 py-1 hover:border-accent hover:text-accent transition-colors flex items-center gap-1.5"
              title="Import a saved project JSON file"
            >
              <span>📂 Import project</span>
            </button>
            <button
              type="button"
              onClick={handleExportClick}
              className="font-display font-semibold tracking-wide uppercase border border-edge-strong bg-panel text-ink-2 rounded px-2.5 py-1 hover:border-accent hover:text-accent transition-colors flex items-center gap-1.5"
              title="Export current project state to a JSON file"
            >
              <span>💾 Export project</span>
            </button>

            {surface && props && (
              <div className="flex items-center gap-3 tnum text-ink-2 ml-2 pl-3 border-l border-edge">
                <span>Puz = {(surface.Puz / 1e3).toFixed(0)} kN</span>
                <span>Pt = {(surface.Pt / 1e3).toFixed(0)} kN</span>
                <span
                  className={`font-display font-bold text-[13px] px-2 py-0.5 rounded ${
                    anyFail ? 'bg-bad/10 text-bad' : 'bg-accent-wash text-ok'
                  }`}
                >
                  {anyFail ? 'CHECK FAILS' : 'ALL CHECKS PASS'}
                </span>
                <button
                  className="font-display font-semibold tracking-wide uppercase border border-accent text-accent rounded px-2.5 py-1 hover:bg-accent-wash"
                  onClick={exportPdf}
                  title="Open the full calculation report in a print window — use 'Save as PDF'"
                >
                  ⭳ PDF report
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Status Notification Banner for Import Success / Error */}
        {(importError || importSuccess) && (
          <div className="max-w-[1500px] mx-auto px-5 pb-2">
            {importError && (
              <div className="bg-bad/10 border border-bad/40 text-bad rounded px-3 py-1.5 text-[12px] flex items-center justify-between">
                <span>⚠️ {importError}</span>
                <button onClick={() => setImportError(null)} className="font-bold text-[14px] leading-none">×</button>
              </div>
            )}
            {importSuccess && (
              <div className="bg-ok/10 border border-ok/40 text-ok rounded px-3 py-1.5 text-[12px] flex items-center justify-between">
                <span>✓ {importSuccess}</span>
                <button onClick={() => setImportSuccess(null)} className="font-bold text-[14px] leading-none">×</button>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="max-w-[1500px] mx-auto px-5 py-4 grid gap-4 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-4 min-w-0">
          <CodeMaterialsPanel state={state} update={update} />
          <SectionPanel state={state} update={update} />
          <RebarPanel bars={state.bars} update={(bars) => update({ bars, predefined: state.predefined })} />
          <LoadCasesPanel
            cases={state.cases}
            selected={selected?.id ?? null}
            update={(cases) => update({ cases })}
            select={setSelCase}
          />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          {issues.length > 0 && (
            <div className="bg-bad/10 border border-bad/40 rounded-lg px-4 py-3 text-[13px] text-bad">
              <b className="font-display text-[11px] uppercase tracking-wider">Input errors</b>
              <ul className="list-disc pl-5 mt-1">
                {issues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Section">
              <SectionPreview geometry={state.geometry} bars={state.bars} props={props} na={naInfo} />
            </Card>
            <Card title={selected ? `Mx–My contour — ${selected.name}` : 'Mx–My contour'}>
              {surface ? (
                <ContourChart surface={surface} result={selResult} />
              ) : (
                <div className="text-sm text-ink-3 p-4">Fix input errors to run the analysis.</div>
              )}
            </Card>
          </div>

          <Card title={selected ? `P–M interaction — direction of ${selected.name}` : 'P–M interaction'}>
            {surface ? (
              <PMChart surface={surface} cases={state.cases} selected={selected} />
            ) : (
              <div className="text-sm text-ink-3 p-4">Fix input errors to run the analysis.</div>
            )}
          </Card>

          <ResultsTable results={results} selected={selected?.id ?? null} select={setSelCase} />
          <CompliancePanel checks={checks} />

          <p className="text-[11px] text-ink-3 leading-relaxed pb-6">
            Design aid only — the engineer of record remains responsible for the design, code applicability and
            clause interpretation. Loads must be factored per the load-combination rules of the governing loading
            standard (IS 875/1893, IRC:6 Annex B Table B.2, or IRS Bridge Rules). Second-order / slenderness
            moments are not added by this tool. See <span className="font-mono">docs/</span> for the full method
            statement and clause basis.
          </p>
        </div>
      </main>
    </div>
  )
}
