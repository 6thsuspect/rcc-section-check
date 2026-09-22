import { useMemo, useRef, useState } from 'react'
import type { CaseResult } from './engine/types'
import { CODES } from './engine/codes'
import { ensureCCW, isSimplePolygon, sectionProperties, signedArea } from './engine/geometry'
import { buildAnalysisModel } from './engine/integrator'
import { checkLoadCase, flexuralCapacity, generateSurface, naForDirection } from './engine/surface'
import { complianceChecks } from './engine/checks'
import { auditCovers, radialCover } from './engine/cover'
import { exportReport } from './report'
import { exportProjectFile, parseProjectFile } from './projectFile'
import { initialState, type AppState } from './state'
import { SectionPreview, type NAInfo } from './components/SectionPreview'
import { PMChart, ContourChart } from './components/Charts'
import { CodeMaterialsPanel, LoadCasesPanel, RebarPanel, SectionPanel } from './components/Editors'
import { ClearCoverPanel } from './components/CoverPanel'
import { CircularRebarPanel, isCircularSection } from './components/CircularRebarPanel'
import { CompliancePanel, ResultsTable } from './components/Results'
import { Banner, Card, EmptyState, Icon, STANDARD_BAR_DIAMETERS, btnCls, btnPrimaryCls } from './components/ui'

/** Page container, shared by the header bar and the working area. */
const shell = 'mx-auto w-full max-w-[1640px] px-3 sm:px-5'

export default function App() {
  const [state, setState] = useState<AppState>(initialState)
  const [customizeBarDiameter, setCustomizeBarDiameter] = useState(false)
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
        setCustomizeBarDiameter(!STANDARD_BAR_DIAMETERS.includes(newAppState.barDia))
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

  /**
   * Per-face cover audit (docs/09 V3): every bar's achieved cover against the
   * cover entered for the face it lies against. Drives the preview overlay, the
   * cover panel and the clause check — the layout never re-places bars on its own.
   */
  const coverAudit = useMemo(
    () => auditCovers(state.bars, state.geometry, state.cover, state.tieDia),
    [state.bars, state.geometry, state.cover, state.tieDia],
  )

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
      cover: state.cover,
      tieDia: state.tieDia,
      coverAudit,
    })
  }, [
    props,
    spec,
    state.bars,
    state.geometry,
    state.fck,
    grade.fy,
    state.cases,
    state.shapeClass,
    state.memberLength,
    state.cover,
    state.tieDia,
    coverAudit,
  ])

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
      <header className="sticky top-0 z-40 border-b border-edge bg-card/90 shadow-[0_1px_2px_rgb(23_34_44/0.04)] backdrop-blur-md">
        <div className={`${shell} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]"
            >
              <Icon name="bars" size={15} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[16.5px] font-bold leading-none tracking-[-0.01em] text-ink">
                RCC Section Check
              </h1>
              <p className="mt-[5px] truncate text-[11px] leading-none text-ink-3">
                Biaxial P–Mx–My interaction · <span className="text-ink-2">{spec.name}</span>
                <span className="mx-1 text-edge-strong">|</span>
                {spec.edition}
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,.rcc"
              className="hidden"
            />
            {surface && props && (
              <div className="mr-1 hidden items-center gap-3 rounded-lg border border-line bg-panel/70 px-3 py-[5px] text-[11.5px] text-ink-2 tnum lg:flex">
                <span title="Pure axial (squash) capacity of the section">
                  <span className="mr-1 font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">Puz</span>
                  {(surface.Puz / 1e3).toFixed(0)} kN
                </span>
                <span className="h-3.5 w-px bg-edge" />
                <span title="Tension limit of the section">
                  <span className="mr-1 font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">Pt</span>
                  {(surface.Pt / 1e3).toFixed(0)} kN
                </span>
                <span className="h-3.5 w-px bg-edge" />
                <span
                  className={`inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.05em] ${
                    anyFail ? 'text-bad' : 'text-ok'
                  }`}
                >
                  <span
                    className={`grid h-[15px] w-[15px] place-items-center rounded-full ${anyFail ? 'bg-bad/12' : 'bg-ok/12'}`}
                  >
                    <Icon name={anyFail ? 'alert' : 'check'} size={10} />
                  </span>
                  {anyFail ? 'CHECK FAILS' : 'ALL CHECKS PASS'}
                </span>
              </div>
            )}

            {surface && props && (
              <span
                className={`mr-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-display text-[10px] font-bold uppercase tracking-[0.05em] lg:hidden ${
                  anyFail ? 'border-bad/35 bg-bad/8 text-bad' : 'border-ok/35 bg-ok/8 text-ok'
                }`}
                title="Compliance verdict across all load cases"
              >
                <Icon name={anyFail ? 'alert' : 'check'} size={10} />
                {anyFail ? 'CHECK FAILS' : 'ALL CHECKS PASS'}
              </span>
            )}

            <button
              type="button"
              onClick={handleImportClick}
              className={btnCls}
              title="Import a saved project JSON file"
            >
              <Icon name="folder" size={13} />
              <span className="hidden sm:inline">Import project</span>
            </button>
            <button
              type="button"
              onClick={handleExportClick}
              className={btnCls}
              title="Export current project state to a JSON file"
            >
              <Icon name="download" size={13} />
              <span className="hidden sm:inline">Export project</span>
            </button>
            <button
              type="button"
              className={btnPrimaryCls}
              onClick={exportPdf}
              disabled={!surface || !props}
              title="Open the full calculation report in a print window — use 'Save as PDF'"
            >
              <Icon name="report" size={13} />
              <span className="hidden sm:inline">PDF report</span>
            </button>
          </div>
        </div>

        {/* Status Notification Banner for Import Success / Error */}
        {(importError || importSuccess) && (
          <div className={`${shell} pb-2`}>
            {importError && (
              <Banner tone="error" onDismiss={() => setImportError(null)}>
                {importError}
              </Banner>
            )}
            {importSuccess && (
              <Banner tone="ok" onDismiss={() => setImportSuccess(null)}>
                {importSuccess}
              </Banner>
            )}
          </div>
        )}
      </header>

      <main
        className={`${shell} grid grid-cols-1 items-start gap-3.5 py-4 lg:grid-cols-[minmax(0,392px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]`}
      >
        <div className="flex min-w-0 flex-col gap-3.5">
          <CodeMaterialsPanel state={state} update={update} />
          <ClearCoverPanel state={state} update={update} audit={coverAudit} />
          <SectionPanel
            state={state}
            update={update}
            onBarDiaCustomizeChange={setCustomizeBarDiameter}
          />
          {isCircularSection(state.predefined) && (
            <CircularRebarPanel
              predefined={state.predefined}
              cover={radialCover(state.cover)}
              tieDia={state.tieDia}
              barDia={state.barDia}
              setBarDia={(barDia) => update({ barDia })}
              onBarDiaCustomizeChange={setCustomizeBarDiameter}
              onApply={(bars, meta) => {
                const patch: Partial<AppState> = { bars }
                if (meta?.barDia) patch.barDia = meta.barDia
                // Keep predefined nBars in sync for uniform layouts so re-opening
                // the shape params still reflects the current count.
                if (
                  state.predefined &&
                  (state.predefined.kind === 'circle' || state.predefined.kind === 'hollowCircle') &&
                  meta?.nBarsHint
                ) {
                  patch.predefined = { ...state.predefined, nBars: meta.nBarsHint }
                }
                update(patch)
              }}
            />
          )}
          <RebarPanel
            bars={state.bars}
            customizeBarDiameter={customizeBarDiameter}
            update={(bars) => update({ bars, predefined: state.predefined })}
          />
          <LoadCasesPanel
            cases={state.cases}
            selected={selected?.id ?? null}
            update={(cases) => update({ cases })}
            select={setSelCase}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          {issues.length > 0 && (
            <Banner tone="error">
              <b className="font-display text-[10px] uppercase tracking-[0.07em]">Input errors</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {issues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Banner>
          )}

          <div className="grid grid-cols-1 gap-3.5 2xl:grid-cols-2">
            <Card
              title="Section"
              subtitle={
                state.predefined
                  ? 'generated from the shape parameters, editable'
                  : 'custom boundary'
              }
            >
              <SectionPreview
                geometry={state.geometry}
                bars={state.bars}
                props={props}
                na={naInfo}
                cover={state.cover}
                audit={coverAudit}
                radialCoverOnly={state.shapeClass === 'circ'}
              />
            </Card>
            <Card
              title={selected ? `Mx–My contour — ${selected.name}` : 'Mx–My contour'}
              subtitle="capacity at the case's axial load"
            >
              {surface ? <ContourChart surface={surface} result={selResult} /> : <NoAnalysis />}
            </Card>
          </div>

          <Card
            title={selected ? `P–M interaction — direction of ${selected.name}` : 'P–M interaction'}
            subtitle="demand points over the generated surface"
          >
            {surface ? <PMChart surface={surface} cases={state.cases} selected={selected} /> : <NoAnalysis />}
          </Card>

          <ResultsTable results={results} selected={selected?.id ?? null} select={setSelCase} />
          <CompliancePanel checks={checks} />

          <footer className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-card border border-edge bg-card/70 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2 shadow-card">
            <p className="max-w-[92ch]">
              Design aid only — the engineer of record remains responsible for the design, code applicability and
              clause interpretation. Loads must be factored per the load-combination rules of the governing loading
              standard (IS 875/1893, IRC:6 Annex B Table B.2, or IRS Bridge Rules). Second-order / slenderness
              moments are not added by this tool.
            </p>
            <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
              Method statement · docs/
            </span>
          </footer>
        </div>
      </main>
    </div>
  )
}

/** Placeholder for the figures while the inputs are incomplete. */
function NoAnalysis() {
  return (
    <EmptyState
      icon="chart"
      title="Fix input errors to run the analysis."
      note="The interaction surface is generated from the section geometry, material grades and bar table."
    />
  )
}
