import { useMemo, useRef, useState } from 'react'
import type { CaseResult } from './engine/types'
import { CODES } from './engine/codes'
import { ensureCCW, isSimplePolygon, sectionProperties, signedArea } from './engine/geometry'
import { generateSection } from './engine/sections'
import { buildAnalysisModel } from './engine/integrator'
import { checkLoadCase, flexuralCapacity, generateSurface, naForDirection } from './engine/surface'
import { complianceChecks } from './engine/checks'
import { auditCovers, radialCover } from './engine/cover'
import { isAutomaticBar, repositionAutomaticBars, validateOuterCoverFit } from './engine/reinforcement'
import { exportReport } from './report'
import { exportProjectFile, parseProjectFile } from './projectFile'
import { initialState, type AppState } from './state'
import { SectionPreview, type NAInfo, type StressOverlay } from './components/SectionPreview'
import { PMChart, ContourChart } from './components/Charts'
import { CodeMaterialsPanel, LoadCasesPanel, RebarPanel, SectionPanel } from './components/Editors'
import { ClearCoverPanel, type ActiveFace } from './components/CoverPanel'
import { CircularRebarPanel, isCircularSection } from './components/CircularRebarPanel'
import { CompliancePanel, NeutralAxisPanel, ReinforcementSpacingPanel, ResultsTable } from './components/Results'
import { SlsCalculationPanel, SlsResultsTable, SlsSummaryPanel } from './components/SLSResults'
import { CrackWidthDetailPanel, CrackWidthInputsPanel, CrackWidthResultsTable } from './components/CrackWidth'
import { neutralAxisAnalysis, type NeutralAxisResult } from './engine/flexure'
import {
  buildSlsModel,
  slsMaterialLimits,
  slsStress,
  type SlsCaseResult,
  type SlsInputs,
} from './engine/sls'
import {
  crackWidthCheck,
  DEFAULT_EXPOSURE,
  type CrackWidthResult,
  type CrackWidthSettings,
} from './engine/crackWidth'
import { spacingReport } from './engine/barSpacing'
import {
  Banner,
  Card,
  EmptyState,
  Icon,
  SegButton,
  SegGroup,
  STANDARD_BAR_DIAMETERS,
  btnCls,
  btnPrimaryCls,
} from './components/ui'

/** Page container, shared by the header bar and the working area. */
const shell = 'mx-auto w-full max-w-[1640px] px-3 sm:px-5'

export default function App() {
  const [state, setState] = useState<AppState>(initialState)
  const [customizeBarDiameter, setCustomizeBarDiameter] = useState(false)
  const [selCase, setSelCase] = useState<string | null>(state.cases[0]?.id ?? null)
  const [slsSelCase, setSlsSelCase] = useState<string | null>(state.slsCases[0]?.id ?? null)
  const [activeFace, setActiveFace] = useState<ActiveFace | null>(null)
  /** Which top-bar module is open: the ULS interaction check or the SLS stress check. */
  const [view, setView] = useState<'uls' | 'sls'>('uls')
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Apply input changes and keep automatic reinforcement derived from the
   * relationship section → face cover → tie/bar diameter.  Coordinate-table
   * edits are marked manual by RebarPanel, so this never overwrites an
   * intentional absolute placement.
   */
  const update = (patch: Partial<AppState>) =>
    setState((s) => {
      const next: AppState = { ...s, ...patch }
      // A code change invalidates the crack-width exposure class (each code
      // uses its own exposure taxonomy) — reset it to the new code's default.
      if (patch.code !== undefined && patch.code !== s.code) {
        next.crackWidth = { ...next.crackWidth, exposure: DEFAULT_EXPOSURE[patch.code] }
      }
      const automaticDiameterChanged =
        patch.bars !== undefined &&
        patch.bars.some((bar, i) => isAutomaticBar(bar) && bar.dia !== s.bars[i]?.dia)
      const placementChanged =
        patch.cover !== undefined ||
        patch.tieDia !== undefined ||
        patch.barDia !== undefined ||
        patch.geometry !== undefined ||
        automaticDiameterChanged

      // A supplied bar list may already be a freshly generated layout (shape
      // changes and circular live updates). For a non-circular predefined
      // shape, regenerate from its parametric definition so irregular faces
      // (T/I/L webs and flange offsets) remain exact; preserve any manual rows
      // by index. Circular arrangements have their own live generator below.
      const driverChanged = patch.cover !== undefined || patch.tieDia !== undefined || patch.barDia !== undefined
      const def = s.predefined
      const nonCircularPredefined = def && def.kind !== 'circle' && def.kind !== 'hollowCircle'
      const barsForDiameterCheck = patch.bars !== undefined ? next.bars : s.bars
      const hasAutomaticDiameterOverride = barsForDiameterCheck.some(
        (bar) => isAutomaticBar(bar) && Math.abs(bar.dia - next.barDia) > 1e-9,
      )
      if (
        placementChanged &&
        driverChanged &&
        nonCircularPredefined &&
        s.bars.some(isAutomaticBar) &&
        !hasAutomaticDiameterOverride
      ) {
        const generated = generateSection(def, { cover: next.cover, tieDia: next.tieDia, barDia: next.barDia })
        const base = patch.bars !== undefined ? next.bars : s.bars
        next.bars =
          base.length === generated.bars.length
            ? base.map((bar, i) => (isAutomaticBar(bar) ? generated.bars[i] : bar))
            : repositionAutomaticBars(base, s.geometry, next.geometry, s.cover, next.cover, s.tieDia, next.tieDia)
      } else if (placementChanged && (patch.bars === undefined || patch.geometry === undefined)) {
        // Custom geometry, circular arrangements, and per-row diameter edits
        // use the generic face/radial relationship. Manual rows are filtered.
        next.bars = repositionAutomaticBars(
          patch.bars !== undefined ? next.bars : s.bars,
          s.geometry,
          next.geometry,
          s.cover,
          next.cover,
          s.tieDia,
          next.tieDia,
        )
      }
      return next
    })

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
        if (newAppState.slsCases.length > 0) {
          setSlsSelCase(newAppState.slsCases[0].id)
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

  const coverFitIssues = useMemo(
    () => validateOuterCoverFit(state.geometry, state.bars, state.cover, state.tieDia),
    [state.geometry, state.bars, state.cover, state.tieDia],
  )

  const props = useMemo(
    () => (valid ? sectionProperties(state.geometry, state.bars) : null),
    [valid, state.geometry, state.bars],
  )

  // --- analysis model + interaction surface (the expensive step) ---
  const model = useMemo(() => {
    if (!valid || !props) return null
    const conc = spec.concrete(state.fck)
    const steel = spec.steel(grade.fy)
    return buildAnalysisModel(
      { boundary: ensureCCW(state.geometry.boundary), voids: state.geometry.voids.map(ensureCCW) },
      state.bars,
      { x: props.cx, y: props.cy },
      props.area,
      conc,
      steel,
      spec.epsSteelLimit(grade),
    )
  }, [valid, props, spec, grade, state.geometry, state.bars, state.fck])

  const surface = useMemo(() => (model ? generateSurface(model, state.mesh) : null), [model, state.mesh])

  /** Neutral-axis depth, xu,max, classification and Mu for every load case (read-only use of the kernel). */
  const naResults = useMemo(() => {
    const out = new Map<string, NeutralAxisResult | null>()
    if (!model || !surface) return out
    const ecu = spec.concrete(state.fck).ecu
    for (const lc of state.cases) out.set(lc.id, neutralAxisAnalysis(model, surface, lc, { spec, fy: grade.fy, ecu }))
    return out
  }, [model, surface, state.cases, spec, grade.fy, state.fck])

  /** Bundle-aware spacing and overlap audit of the bar table (all section types). */
  const spacing = useMemo(() => spacingReport(state.bars), [state.bars])

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
  // Selected service (SLS) case — independent from the ULS selection above.
  const slsSelected = state.slsCases.find((c) => c.id === slsSelCase) ?? state.slsCases[0] ?? null
  const anyFail =
    results.some((r) => !r.ok) || checks.some((c) => c.status === 'fail') || spacing.overlaps.length > 0

  const flex = useMemo(() => (surface ? flexuralCapacity(surface) : null), [surface])

  const selNA = selected ? (naResults.get(selected.id) ?? null) : null

  // governing neutral axis of the capacity state for the selected case
  const naInfo: NAInfo | null = useMemo(() => {
    if (!surface || !selected || !selResult || selResult.axialGoverned || selResult.MEd < 1) return null
    if (selNA) {
      return {
        theta: selNA.theta,
        vna: selNA.vna,
        xu: selNA.xu,
        vTop: selNA.vTop,
        caption: `Neutral axis at the capacity state for ${selected.name} (P = Pu along the demand direction; NA angle ${((selNA.theta * 180) / Math.PI).toFixed(0)}°) — xu = ${selNA.xu.toFixed(0)} mm ${selNA.classification === 'under' ? '≤' : '>'} xu,max = ${selNA.xuMax.toFixed(0)} mm`,
      }
    }
    const cp = naForDirection(surface, selected.Pu * 1e3, selected.Mux, selected.Muy)
    if (!cp || Math.abs(cp.b) < 1e-9) return null
    return {
      theta: cp.theta,
      vna: -cp.a / cp.b,
      caption: `Neutral axis at the capacity state for ${selected.name} (P = Pu along the demand direction; NA angle ${((cp.theta * 180) / Math.PI).toFixed(0)}°)`,
    }
  }, [surface, selected, selResult, selNA])

  /* ------------------------------------------------------------------ *
   * SLS stress check (working-stress method) — shares the same section,
   * materials, reinforcement and load cases as the ULS module; nothing
   * here mutates state, so switching tabs never alters the inputs.
   * ------------------------------------------------------------------ */
  const slsLimits = useMemo(() => {
    const maxDia = state.bars.length ? Math.max(...state.bars.map((b) => b.dia)) : 0
    return slsMaterialLimits(state.fck, grade.fy, maxDia)
  }, [state.fck, grade.fy, state.bars])

  const slsInputs: SlsInputs = useMemo(
    () => ({
      geometry: state.geometry,
      bars: state.bars,
      fck: state.fck,
      fy: grade.fy,
      m: slsLimits.m,
      sigmaCbc: slsLimits.sigmaCbc,
      sigmaSt: slsLimits.sigmaSt,
      sigmaSc: slsLimits.sigmaSc,
    }),
    [state.geometry, state.bars, state.fck, grade.fy, slsLimits],
  )

  const slsModel = useMemo(() => (valid ? buildSlsModel(slsInputs) : null), [valid, slsInputs])

  const slsResults = useMemo(() => {
    const out = new Map<string, SlsCaseResult | null>()
    if (!slsModel) return out
    for (const lc of state.slsCases) out.set(lc.id, slsStress(slsModel, slsInputs, lc))
    return out
  }, [slsModel, slsInputs, state.slsCases])

  const slsList: SlsCaseResult[] = useMemo(
    () => state.slsCases.map((c) => slsResults.get(c.id) ?? null).filter((r): r is SlsCaseResult => r !== null),
    [slsResults, state.slsCases],
  )
  const slsAnyFail = slsList.some((r) => !r.ok)
  const slsSel = slsSelected ? (slsResults.get(slsSelected.id) ?? null) : null

  const slsNaInfo: NAInfo | null = useMemo(() => {
    if (!slsSel || !Number.isFinite(slsSel.xu)) return null
    return {
      theta: slsSel.phi,
      vna: slsSel.vna,
      vTop: slsSel.vTop,
      xu: slsSel.xu,
      caption: `SLS neutral axis for ${slsSel.caseName} at the service moment (MEd = ${(slsSel.MEd / 1e6).toFixed(1)} kN·m, NA angle ${((slsSel.phi * 180) / Math.PI).toFixed(0)}°) — xu = ${slsSel.xu.toFixed(0)} mm from the extreme compression fibre`,
    }
  }, [slsSel])

  const slsStressOverlay: StressOverlay | null =
    slsSel && Number.isFinite(slsSel.xu)
      ? {
          sigmaC: slsSel.sigmaC,
          sigmaCbc: slsSel.sigmaCbc,
          sigmaSt: slsSel.sigmaSt,
          sigmaStPerm: slsSel.sigmaStPerm,
          tensionBar: slsSel.tensionBar,
        }
      : null

  /**
   * Crack-width check per SLS load case — reuses the SLS cracked-section
   * results (σs, xu, d, φ) and the shared geometry/reinforcement, applying the
   * method of the selected code. Recomputes automatically whenever the
   * section, reinforcement, material, service loads or exposure change.
   */
  const crackWidthResults = useMemo(() => {
    const out = new Map<string, CrackWidthResult | null>()
    if (!slsModel) return out
    for (const lc of state.slsCases) {
      const res = slsResults.get(lc.id) ?? null
      out.set(lc.id, res ? crackWidthCheck(state.code, state.fck, slsModel, state.bars, res, state.crackWidth) : null)
    }
    return out
  }, [slsModel, slsResults, state.slsCases, state.code, state.fck, state.bars, state.crackWidth])

  const updateCrackWidth = (patch: Partial<CrackWidthSettings>) =>
    update({ crackWidth: { ...state.crackWidth, ...patch } })

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
      naResults: state.cases.map((c) => naResults.get(c.id) ?? null),
      xuMaxLabel: spec.xuMaxLabel,
      spacing,
      selectedName: selected?.name ?? '',
      svgs: {
        section: grab('fig-section', '0 0 460 340'),
        pm: grab('fig-pm', '0 0 520 400'),
        contour: grab('fig-contour', '0 0 460 420'),
      },
    })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="shrink-0 sticky top-0 z-40 border-b border-edge bg-card/90 shadow-[0_1px_2px_rgb(23_34_44/0.04)] backdrop-blur-md">
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

          <SegGroup className="shrink-0" aria-label="Check module">
            <SegButton active={view === 'uls'} onClick={() => setView('uls')} title="Ultimate limit state — P–Mx–My interaction & capacity checks">
              <Icon name="target" size={13} />
              ULS Check
            </SegButton>
            <SegButton active={view === 'sls'} onClick={() => setView('sls')} title="Serviceability limit state — working-stress concrete & reinforcement stress checks">
              <Icon name="shield" size={13} />
              SLS Check
            </SegButton>
          </SegGroup>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,.rcc"
              className="hidden"
            />
            {view === 'uls' && surface && props && (
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

            {view === 'sls' && slsList.length > 0 && (
              <div className="mr-1 hidden items-center gap-3 rounded-lg border border-line bg-panel/70 px-3 py-[5px] text-[11.5px] text-ink-2 tnum lg:flex">
                <span title="Permissible concrete stress in bending (IS 456 Table 21)">
                  <span className="mr-1 font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">σcbc</span>
                  {slsLimits.sigmaCbc.toFixed(1)} N/mm²
                </span>
                <span className="h-3.5 w-px bg-edge" />
                <span title="Permissible tensile steel stress (IS 456 Table 22)">
                  <span className="mr-1 font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">σst</span>
                  {slsLimits.sigmaSt.toFixed(0)} N/mm²
                </span>
                <span className="h-3.5 w-px bg-edge" />
                <span
                  className={`inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.05em] ${
                    slsAnyFail ? 'text-bad' : 'text-ok'
                  }`}
                >
                  <span
                    className={`grid h-[15px] w-[15px] place-items-center rounded-full ${slsAnyFail ? 'bg-bad/12' : 'bg-ok/12'}`}
                  >
                    <Icon name={slsAnyFail ? 'alert' : 'check'} size={10} />
                  </span>
                  {slsAnyFail ? 'SLS FAILS' : 'SLS PASSES'}
                </span>
              </div>
            )}

            {view === 'uls' && surface && props && (
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

            {view === 'sls' && slsList.length > 0 && (
              <span
                className={`mr-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-display text-[10px] font-bold uppercase tracking-[0.05em] lg:hidden ${
                  slsAnyFail ? 'border-bad/35 bg-bad/8 text-bad' : 'border-ok/35 bg-ok/8 text-ok'
                }`}
                title="SLS stress verdict across all load cases"
              >
                <Icon name={slsAnyFail ? 'alert' : 'check'} size={10} />
                {slsAnyFail ? 'SLS FAILS' : 'SLS PASSES'}
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
          <div className={`${shell} shrink-0 pb-2`}>
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
        className={`${shell} flex-1 min-h-0 grid grid-cols-1 items-start gap-3.5 py-4 overflow-y-auto lg:grid-cols-[minmax(0,392px)_minmax(0,1fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]`}
      >
        <div className="flex min-w-0 flex-col gap-3.5 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5 lg:pb-4">
          <CodeMaterialsPanel state={state} update={update} />
          <ClearCoverPanel
            state={state}
            update={update}
            audit={coverAudit}
            activeFace={activeFace}
            setActiveFace={setActiveFace}
          />
          <SectionPanel
            state={state}
            update={update}
            onBarDiaCustomizeChange={setCustomizeBarDiameter}
          />
          {isCircularSection(state.predefined) && (
            <CircularRebarPanel
              predefined={state.predefined}
              bars={state.bars}
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
            cases={view === 'uls' ? state.cases : state.slsCases}
            selected={view === 'uls' ? selected?.id ?? null : slsSelected?.id ?? null}
            update={(cases) => update(view === 'uls' ? { cases } : { slsCases: cases })}
            select={view === 'uls' ? setSelCase : setSlsSelCase}
            subtitle={view === 'uls' ? 'factored ULS actions' : 'service (characteristic) SLS actions'}
          />
        </div>

        {view === 'uls' && (
        <div className="flex min-w-0 flex-col gap-3.5 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5 lg:pb-4">
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
          {coverFitIssues.length > 0 && (
            <Banner tone="warn">
              <b className="font-display text-[10px] uppercase tracking-[0.07em]">Reinforcement fit warning</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {coverFitIssues.map((issue) => (
                  <li key={issue.axis}>{issue.message} Reduce the face covers, use a smaller bar, or increase the section size.</li>
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
                overlapping={spacing.overlapping}
                activeFace={activeFace}
                onHoverFace={setActiveFace}
                onSelectFace={setActiveFace}
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
          <NeutralAxisPanel
            cases={state.cases}
            results={naResults}
            selected={selected?.id ?? null}
            select={setSelCase}
            xuMaxLabel={spec.xuMaxLabel}
            ready={!!surface}
          />
          <ReinforcementSpacingPanel report={spacing} />
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
        )}

        {view === 'sls' && (
          <div className="flex min-w-0 flex-col gap-3.5 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5 lg:pb-4">
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
            {coverFitIssues.length > 0 && (
              <Banner tone="warn">
                <b className="font-display text-[10px] uppercase tracking-[0.07em]">Reinforcement fit warning</b>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {coverFitIssues.map((issue) => (
                    <li key={issue.axis}>
                      {issue.message} Reduce the face covers, use a smaller bar, or increase the section size.
                    </li>
                  ))}
                </ul>
              </Banner>
            )}

            <div className="grid grid-cols-1 gap-3.5 2xl:grid-cols-2">
              <Card
                title="Section"
                subtitle={state.predefined ? 'generated from the shape parameters, editable' : 'custom boundary'}
              >
                <SectionPreview
                  geometry={state.geometry}
                  bars={state.bars}
                  props={props}
                  na={slsNaInfo}
                  cover={state.cover}
                  audit={coverAudit}
                  radialCoverOnly={state.shapeClass === 'circ'}
                  overlapping={spacing.overlapping}
                  activeFace={activeFace}
                  onHoverFace={setActiveFace}
                  onSelectFace={setActiveFace}
                  stress={slsStressOverlay}
                />
              </Card>
              <SlsSummaryPanel
                results={slsList}
                limits={slsLimits}
                anyFail={slsAnyFail}
                extrapolated={slsLimits.extrapolated}
              />
            </div>

            <SlsResultsTable
              cases={state.slsCases}
              results={slsResults}
              selected={slsSelected?.id ?? null}
              select={setSlsSelCase}
            />
            <SlsCalculationPanel lc={slsSelected} result={slsSel} />

            <CrackWidthInputsPanel code={state.code} settings={state.crackWidth} update={updateCrackWidth} />
            <CrackWidthResultsTable
              code={state.code}
              cases={state.slsCases}
              results={crackWidthResults}
              selected={slsSelected?.id ?? null}
              select={setSlsSelCase}
            />
            <CrackWidthDetailPanel
              code={state.code}
              settings={state.crackWidth}
              lc={slsSelected}
              result={(slsSelected && crackWidthResults.get(slsSelected.id)) ?? null}
            />

            <footer className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-card border border-edge bg-card/70 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2 shadow-card">
              <p className="max-w-[92ch]">
                SLS stresses are checked by the working-stress (direct stress) method of IS 456:2000 Annex C on a
                cracked transformed section under the service actions of each load case. Service load cases are
                entered separately from the factored ULS cases (Load Cases panel) — enter characteristic
                (unfactored) service moments for a code-consistent SLS check.
              </p>
              <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
                Serviceability · IS 456 Annex C
              </span>
            </footer>
          </div>
        )}
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
