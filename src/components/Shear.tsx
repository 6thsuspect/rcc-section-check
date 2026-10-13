import { useState } from 'react'
import type { DesignCodeId, RebarFace } from '../engine/types'
import { CODES } from '../engine/codes'
import { barArea } from '../engine/geometry'
import {
  MAX_COT_THETA,
  MIN_COT_THETA,
  SHEAR_CODE_INFO,
  tensionFaceOptions,
  type ShearCaseResult,
  type ShearLoadCase,
  type ShearSectionData,
  type ShearSettings,
  type ShearStep,
  type ShearSummary,
} from '../engine/shear'
import { fmtN, newShearCaseId, type AppState } from '../state'
import {
  Card,
  Check,
  Chip,
  Icon,
  InfoTooltip,
  NumField,
  Readout,
  SegButton,
  SegGroup,
  SubCard,
  ZoomableSvg,
  btnMiniCls,
  cellCls,
  codeChipCls,
  noteCls,
  noteSmCls,
  tblCls,
  tdCls,
  thCls,
} from './ui'

const FACE_LABEL: Record<RebarFace, string> = { bottom: 'Bottom', right: 'Right', top: 'Top', left: 'Left' }

const numCls = 'text-right'
/** Figure fonts inherit from the theme, matching the other SVG figures. */
const FONT = 'inherit'

/** PASS/FAIL chip from a boolean. */
function Verdict({ ok }: { ok: boolean }) {
  return <Chip status={ok ? 'pass' : 'fail'} />
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Shear design inputs — direction of the shear force, the tension face that
 * sets which reinforcement counts, member type, the provided links, and the
 * optional manual overrides of the values the section layout supplies
 * automatically. Only the shear tab reads these fields; the ULS and SLS modules
 * never see them.
 */
export function ShearInputsPanel({
  state,
  update,
  section,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  section: ShearSectionData
}) {
  const s = state.shear
  const setShear = (patch: Partial<ShearSettings>) => update({ shear: { ...s, ...patch } })
  const faces = tensionFaceOptions(s.axis)
  const info = SHEAR_CODE_INFO[state.code]
  const auto = (v: number) => `0 = automatic (${fmtN(v, 0)} mm)`

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="link" size={13} className="text-ink-3" />
          <span>Shear design inputs</span>
        </span>
      }
      subtitle={info.maxSpacing}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Shear direction
          </span>
          <SegGroup>
            <SegButton
              active={s.axis === 'y'}
              onClick={() => setShear({ axis: 'y', tensionFace: 'bottom' })}
              title="Design shear force acting along the section y-axis (bending about x); depth measured along y."
            >
              Along y
            </SegButton>
            <SegButton
              active={s.axis === 'x'}
              onClick={() => setShear({ axis: 'x', tensionFace: 'right' })}
              title="Design shear force acting along the section x-axis (bending about y); depth measured along x."
            >
              Along x
            </SegButton>
          </SegGroup>
          <span className="text-[9.5px] leading-tight text-ink-3">
            The shear plane and the effective depth lie in the {s.axis === 'y' ? 'Mx' : 'My'} bending plane.
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Flexural tension face
          </span>
          <SegGroup>
            {faces.map((f) => (
              <SegButton
                key={f}
                active={s.tensionFace === f}
                onClick={() => setShear({ tensionFace: f })}
                title={`Bars on the ${FACE_LABEL[f].toLowerCase()} face resist the shear-induced flexure.`}
              >
                {FACE_LABEL[f]}
              </SegButton>
            ))}
          </SegGroup>
          <span className="text-[9.5px] leading-tight text-ink-3">
            Sets the compression fibre, the effective depth d and the tension steel A<sub>sl</sub>.
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Member type
          </span>
          <SegGroup>
            <SegButton
              active={s.member === 'beam'}
              onClick={() => setShear({ member: 'beam' })}
              title="Beam / slab strip — no axial-compression enhancement of the concrete shear strength."
            >
              Beam
            </SegButton>
            <SegButton
              active={s.member === 'column'}
              onClick={() => setShear({ member: 'column' })}
              title="Column / pier — axial compression enhances the concrete shear strength (IS 456 Cl 40.2.2, IRS CBC Cl 15.6.6)."
            >
              Column
            </SegButton>
          </SegGroup>
          <span className="text-[9.5px] leading-tight text-ink-3">
            Axial compression raises the concrete shear strength under the provisions of the selected code.
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Provided links (stirrups)
          </span>
          <div className="grid grid-cols-3 items-end gap-1.5">
            <NumField label="Link ⌀" unit="mm" value={s.linkDia} step={2} min={6} onChange={(v) => setShear({ linkDia: v })} />
            <NumField
              label="Legs"
              value={s.linkLegs}
              min={2}
              step={1}
              onChange={(v) => setShear({ linkLegs: Math.max(2, Math.round(v)) })}
              title="Number of vertical legs of a closed link crossing the shear plane."
            />
            <NumField label="Spacing" unit="mm" value={s.linkSpacing} min={25} step={10} onChange={(v) => setShear({ linkSpacing: v })} />
          </div>
          <span className="text-[9.5px] leading-tight text-ink-3">
            A<sub>sv</sub> = {s.linkLegs} × ⌀{fmtN(s.linkDia, 0)} = {fmtN(s.linkLegs * barArea(s.linkDia), 1)} mm² per link ·
            A<sub>sv</sub>/s<sub>v</sub> = {fmtN((s.linkLegs * barArea(s.linkDia)) / Math.max(s.linkSpacing, 1), 3)} mm²/mm
          </span>
        </div>
      </div>

      {state.code === 'IRC112' && (
        <SubCard title="Strut inclination — IRC:112 Cl 10.3.3.2" tone="accent" >
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
            <NumField
              label="cot θ"
              value={s.cotTheta}
              min={MIN_COT_THETA}
              step={0.05}
              onChange={(v) => setShear({ cotTheta: Math.min(MAX_COT_THETA, Math.max(MIN_COT_THETA, v)) })}
              hint={`${MIN_COT_THETA} = 45° (θ measured to member axis) … ${MAX_COT_THETA} = 21.8°`}
              title="Strut inclination cotangent. Larger values (shallower struts) reduce the link steel but also reduce VRd,max."
            />
            <SegGroup>
              {[1.0, 1.5, 2.0, 2.5].map((v) => (
                <SegButton
                  key={v}
                  active={Math.abs(s.cotTheta - v) < 1e-9}
                  onClick={() => setShear({ cotTheta: v })}
                  title={`θ = ${((Math.atan(1 / v) * 180) / Math.PI).toFixed(1)}°`}
                >
                  {v.toFixed(1)}
                </SegButton>
              ))}
            </SegGroup>
          </div>
          <p className={`${noteSmCls} mt-1.5`}>
            Default cot θ = 1.0 (45°) — the code's upper bound on the crushing capacity. The web-crushing
            check VRd,max below decides whether a shallower strut may be used.
          </p>
        </SubCard>
      )}

      <SubCard
        title={
          <span className="flex items-center gap-1.5">
            <span>Section values used</span>
            <InfoTooltip
              content={
                <span>
                  b, d and A<sub>sl</sub> are read from the section layout and the bar table. Enter a value here
                  only to override that automatic value (0 = automatic). The ULS/SLS modules are not affected.
                </span>
              }
            />
          </span>
        }
      >
        <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Readout label="Depth h" value={`${fmtN(section.h, 0)} mm`} title="Overall depth in the shear/bending plane" />
          <Readout label="Web width b" value={`${fmtN(section.b, 0)} mm`} title="Chords at mid-depth, voids deducted" />
          <Readout label="Effective depth d" value={`${fmtN(section.d, 0)} mm`} title="Compression fibre → tension steel centroid" />
          <Readout label="Tension steel Asl" value={`${fmtN(section.Asl, 0)} mm²`} title={`${section.tensionBarCount} bars on the tension face`} />
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <NumField
            label="b override"
            unit="mm"
            value={s.bOverride ?? 0}
            min={0}
            step={25}
            onChange={(v) => setShear({ bOverride: v > 0 ? v : null })}
            hint={auto(section.bAuto)}
            title="Web width for the shear check. 0 uses the net chord width at mid-depth."
          />
          <NumField
            label="d override"
            unit="mm"
            value={s.dOverride ?? 0}
            min={0}
            step={10}
            onChange={(v) => setShear({ dOverride: v > 0 ? v : null })}
            hint={auto(section.dAuto)}
            title="Effective depth. 0 uses the compression face → tension steel distance."
          />
          <NumField
            label="Asl override"
            unit="mm²"
            value={s.aslOverride ?? 0}
            min={0}
            step={100}
            onChange={(v) => setShear({ aslOverride: v > 0 ? v : null })}
            hint={`0 = automatic (${fmtN(section.AslAuto, 0)} mm²)`}
            title="Tension reinforcement area used for the percentage pt. 0 uses the bars on the tension face."
          />
        </div>
        <div className="mt-2.5 grid grid-cols-1 items-end gap-2.5 sm:grid-cols-2">
          <NumField
            label="Support distance av (0 = n/a)"
            unit="mm"
            value={s.criticalDistance}
            min={0}
            step={50}
            onChange={(v) => setShear({ criticalDistance: Math.max(0, v) })}
            hint="Distance from the face of the support to the critical section, for the enhanced-shear rule."
          />
          {state.code === 'IS456' && (
            <Check
              checked={s.enhance}
              onChange={(v) => setShear({ enhance: v })}
              label="Enhanced shear near support (Cl 40.3)"
              title="Multiply τc by 2d/av when av < 2d — only when the support reaction is compressive and the end region is not disturbed."
            />
          )}
        </div>
      </SubCard>

      <p className={`${noteCls} mt-2`}>
        b = {fmtN(section.b, 0)} mm is the concrete width across the shear plane
        (net chord at mid-depth with voids deducted, or the entered override); d = {fmtN(section.d, 0)} mm is measured
        from the {FACE_LABEL[section.compressionFace].toLowerCase()} face to the {FACE_LABEL[s.tensionFace].toLowerCase()}-face
        bar centroid. pt = 100·A<sub>sl</sub>/(b·d) = {fmtN((100 * section.Asl) / Math.max(section.b * section.d, 1), 3)}%.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Load cases                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shear load cases — an independent Vu / Pu list (factored design shear force
 * and the accompanying axial load of the same combination). Excel paste accepts
 * `name, Vu, Pu` or `Vu, Pu` columns.
 */
export function ShearCasesPanel({
  cases,
  selected,
  update,
  select,
}: {
  cases: ShearLoadCase[]
  selected: string | null
  update: (cases: ShearLoadCase[]) => void
  select: (id: string) => void
}) {
  const [status, setStatus] = useState<string | null>(null)

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text) return
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) return
    const rows: ShearLoadCase[] = []
    for (const line of lines) {
      const parts = line.split(/[\t,]+/).map((p) => p.trim())
      if (parts.length < 2) continue
      const numeric = parts.map((p) => Number(p))
      const named = !Number.isFinite(numeric[0])
      const name = named ? parts[0] || `SC${cases.length + rows.length + 1}` : `SC${cases.length + rows.length + 1}`
      const [vu, pu] = named ? [numeric[1], numeric[2]] : [numeric[0], numeric[1]]
      rows.push({
        id: newShearCaseId(),
        name,
        Vu: Number.isFinite(vu) ? vu : 0,
        Pu: Number.isFinite(pu) ? pu : 0,
      })
    }
    if (rows.length === 0) return
    e.preventDefault()
    update([...cases, ...rows])
    if (!selected) select(rows[0].id)
    setStatus(`Pasted ${rows.length} shear case${rows.length === 1 ? '' : 's'}.`)
  }

  const setRow = (id: string, patch: Partial<ShearLoadCase>) =>
    update(cases.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const addCase = () => {
    const next: ShearLoadCase = { id: newShearCaseId(), name: `SC${cases.length + 1}`, Vu: 300, Pu: 0 }
    update([...cases, next])
    select(next.id)
    setStatus(null)
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="layers" size={13} className="text-ink-3" />
          <span>Shear load cases</span>
          <InfoTooltip
            content={
              <span>
                Paste cells from <b>Excel</b> (<code className={codeChipCls}>name, Vu, Pu</code> or{' '}
                <code className={codeChipCls}>Vu, Pu</code>) anywhere in the table to add rows. Enter the{' '}
                <b>factored design shear force</b> V<sub>u</sub> and the axial load P<sub>u</sub> of the same
                combination (compression positive) — independent of the ULS and SLS lists.
              </span>
            }
          />
        </span>
      }
      subtitle="factored Vu / Pu · kN"
      action={
        <button type="button" className={btnMiniCls} onClick={addCase} title="Add a shear load case">
          <Icon name="plus" size={11} />
          Add case
        </button>
      }
    >
      <div className="overflow-x-auto" onPaste={handlePaste}>
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Case</th>
              <th className={`${thCls} ${numCls}`} title="Factored design shear force at the critical section">
                Vu (kN)
              </th>
              <th className={`${thCls} ${numCls}`} title="Factored axial load of the same combination, compression positive">
                Pu (kN)
              </th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr
                key={c.id}
                aria-selected={selected === c.id}
                onClick={() => select(c.id)}
                className={`cursor-pointer border-b border-line transition-colors duration-150 ${
                  selected === c.id ? 'bg-accent-wash/70 shadow-rowmark' : 'hover:bg-panel/70'
                }`}
              >
                <td className="px-1 py-[3px]">
                  <input
                    className={`${cellCls} w-full min-w-[5.5rem]`}
                    value={c.name}
                    onChange={(e) => setRow(c.id, { name: e.target.value })}
                    aria-label="Shear case name"
                  />
                </td>
                <td className="px-1 py-[3px]">
                  <input
                    className={`${cellCls} w-full text-right`}
                    type="number"
                    value={Number.isFinite(c.Vu) ? c.Vu : 0}
                    onChange={(e) => setRow(c.id, { Vu: parseFloat(e.target.value) || 0 })}
                    aria-label="Design shear force Vu"
                  />
                </td>
                <td className="px-1 py-[3px]">
                  <input
                    className={`${cellCls} w-full text-right`}
                    type="number"
                    value={Number.isFinite(c.Pu) ? c.Pu : 0}
                    onChange={(e) => setRow(c.id, { Pu: parseFloat(e.target.value) || 0 })}
                    aria-label="Axial load Pu"
                  />
                </td>
                <td className="px-1 py-[3px] text-center">
                  <button
                    type="button"
                    className={btnMiniCls}
                    title="Delete this shear case"
                    disabled={cases.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      update(cases.filter((x) => x.id !== c.id))
                    }}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${noteSmCls} mt-1.5`}>
        {status ?? 'Factors are applied by the checking code; enter already-factored actions. Only Vu drives the shear check — Pu enters through the axial-compression provisions.'}
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Per-case results                                                    */
/* ------------------------------------------------------------------ */

/** Concrete-strength column label differs per code (τc / βs·vc). */
function concreteLabel(code: DesignCodeId): string {
  return code === 'IRSCBC' ? 'βs·vc' : 'τc'
}

/**
 * Shear check per load case: the design shear force, the nominal shear stress,
 * the concrete resistance, the required and provided shear reinforcement and
 * the spacing requirement, with the code's verdict.
 */
export function ShearResultsTable({
  code,
  results,
  selected,
  select,
  section,
}: {
  code: DesignCodeId
  results: ShearCaseResult[]
  selected: string | null
  select: (id: string) => void
  section: ShearSectionData | null
}) {
  const allPass = results.length > 0 && results.every((r) => r.ok)
  return (
    <Card
      title="Shear check per load case"
      subtitle={
        results.length > 0
          ? `${results.length} case${results.length === 1 ? '' : 's'} · kN, mm, N/mm²${
              section ? ` · b = ${fmtN(section.b, 0)}, d = ${fmtN(section.d, 0)} mm` : ''
            }`
          : undefined
      }
      action={results.length > 0 ? <Chip status={allPass ? 'pass' : 'fail'} /> : undefined}
    >
      <div className="overflow-x-auto">
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Case</th>
              <th className={`${thCls} ${numCls}`} title="Design shear force at the critical section">
                Vu
              </th>
              <th className={`${thCls} ${numCls}`} title="Nominal shear stress VEd/(b·d)">
                τv
              </th>
              <th className={`${thCls} ${numCls}`} title={`Design shear strength of concrete (${concreteLabel(code)})`}>
                {concreteLabel(code)}
              </th>
              <th className={`${thCls} ${numCls}`} title="Maximum shear stress the web can take (τc,max / vmax)">
                τmax
              </th>
              <th className={`${thCls} ${numCls}`} title="Concrete contribution to the shear resistance">
                Vc
              </th>
              <th className={`${thCls} ${numCls}`} title="Required shear reinforcement (total legs), per unit length">
                Asv/s req
              </th>
              <th className={`${thCls} ${numCls}`} title="Provided shear reinforcement (total legs), per unit length">
                Asv/s prov
              </th>
              <th className={`${thCls} ${numCls}`} title="Maximum permitted link spacing">
                sv max
              </th>
              <th className={`${thCls} ${numCls}`} title="Design shear force / shear resistance">
                VEd/VRd
              </th>
              <th className={`${thCls} text-center`}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.loadCase.id}
                aria-selected={selected === r.loadCase.id}
                onClick={() => select(r.loadCase.id)}
                className={`cursor-pointer border-b border-line transition-colors duration-150 ${
                  selected === r.loadCase.id
                    ? 'bg-accent-wash/70 shadow-rowmark'
                    : r.ok
                      ? 'hover:bg-panel/70'
                      : 'bg-bad/6 hover:bg-bad/10'
                }`}
              >
                <td className={`${tdCls} whitespace-nowrap font-semibold`}>{r.loadCase.name}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.loadCase.Vu, 0)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.tauV, 3)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.tauC, 3)}</td>
                <td className={`${tdCls} ${numCls} ${r.stressRatio > 1 ? 'font-bold text-bad' : ''}`}>
                  {fmtN(r.tauCMax, 2)}
                </td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.Vc / 1e3, 0)}</td>
                <td className={`${tdCls} ${numCls} font-semibold`}>{fmtN(r.asvPerSReq, 3)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.asvPerSProvided, 3)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.spaceMax, 0)}</td>
                <td className={`${tdCls} ${numCls} font-bold ${r.ok ? 'text-ok' : 'text-bad'}`}>
                  {Number.isFinite(r.ratio) ? fmtN(r.ratio, 3) : '—'}
                </td>
                <td className={`${tdCls} text-center`}>
                  <Verdict ok={r.ok} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${noteSmCls} mt-1.5`}>
        As<sub>v</sub>/s is the total cross-sectional area of all link legs per mm of member length. V<sub>Ed</sub>/V
        <sub>Rd</sub> ≤ 1.000 passes; the web-crushing limit τ<sub>v</sub> ≤ τ<sub>max</sub> is checked separately and
        can fail on its own.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/**
 * Verdict strip plus the governing case's numbers: the shear diagram, the
 * governing capacity and the utilisation of the provided reinforcement.
 */
export function ShearSummaryPanel({
  code,
  summary,
  settings,
  section,
  figureId,
}: {
  code: DesignCodeId
  summary: ShearSummary
  settings: ShearSettings
  section: ShearSectionData
  /** DOM id for the diagram so the print report can capture it (fig-shear). */
  figureId?: string
}) {
  const info = SHEAR_CODE_INFO[code]
  const g = summary.governing
  return (
    <Card
      title="Shear check summary"
      subtitle={g ? `governing case ${g.loadCase.name}` : 'no shear cases'}
      action={<Chip status={summary.ok ? 'pass' : 'fail'} />}
    >
      {!g ? (
        <p className={noteCls}>Add a shear load case to run the check.</p>
      ) : (
        <>
          <div
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${
              g.ok ? 'border-ok/30 bg-ok/8' : 'border-bad/30 bg-bad/8'
            }`}
          >
            <Verdict ok={g.ok} />
            <div className="flex items-baseline gap-2 tnum">
              <span className={`text-[20px] font-bold ${g.ok ? 'text-ink' : 'text-bad'}`}>{fmtN(g.ratio, 3)}</span>
              <span className="text-[11.5px] text-ink-3">VEd/VRd at {g.loadCase.name}</span>
              <span className={`ml-2 text-[13px] font-bold ${g.ok ? 'text-ok' : 'text-bad'}`}>
                {fmtN(g.VEd / 1e3, 0)} kN vs {fmtN(g.VRd / 1e3, 0)} kN
              </span>
            </div>
            <span className="text-[11.5px] text-ink-3">
              concrete {fmtN(g.Vc / 1e3, 0)} kN · links {fmtN(Math.max(g.VRd - g.Vc, 0) / 1e3, 0)} kN
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Readout
              label="Required Asv/sv"
              value={`${fmtN(summary.worstRequired, 3)} mm²/mm`}
              title="Largest requirement over all shear cases (minimum rules included)"
            />
            <Readout label="Provided Asv/sv" value={`${fmtN(summary.provided, 3)} mm²/mm`} title="Link legs × area / spacing" />
            <Readout
              label="Worst τv/τmax"
              value={fmtN(summary.worstStressRatio, 3)}
              title="Utilisation against the web-crushing limit"
              className={summary.worstStressRatio > 1 ? 'text-bad font-bold' : ''}
            />
            <Readout
              label="Cases failing"
              value={summary.ok ? 'none — all pass' : `${summary.failCount} fail`}
              title="Shear checks across all cases"
              className={summary.ok ? 'text-ok' : 'text-bad'}
            />
          </div>

          <div className="mt-3">
            <ShearDiagram id={figureId} section={section} settings={settings} result={g} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SubCard title="Maximum shear stress">
              <p className={`${noteSmCls} tnum`}>{info.maxStress}</p>
            </SubCard>
            <SubCard title="Minimum shear reinforcement">
              <p className={`${noteSmCls} tnum`}>{info.minLinks}</p>
            </SubCard>
            <SubCard title="Maximum spacing">
              <p className={`${noteSmCls} tnum`}>{info.maxSpacing}</p>
            </SubCard>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {info.references.map((ref) => (
              <span key={ref} className={codeChipCls}>
                {ref}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Diagram                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shear diagram: the link (stirrup) cross-section with its legs on the left and
 * a member elevation with the provided link spacing on the right, annotated
 * with the shear force and the effective depth. Pure SVG so it can be captured
 * into the print report exactly like the other figures.
 */
export function ShearDiagram({
  section,
  settings,
  result,
  id,
}: {
  section: ShearSectionData
  settings: ShearSettings
  result: ShearCaseResult | null
  /** DOM id so the print report can capture the figure (fig-shear). */
  id?: string
}) {
  const b = Math.max(section.b, 1)
  const h = Math.max(section.h, 1)
  const d = Math.min(Math.max(section.d, 1), h)
  const legs = Math.max(Math.round(settings.linkLegs), 2)
  const spacing = Math.max(settings.linkSpacing, 1)
  const cover = section.coverTension
  const axisName = section.axis === 'y' ? 'y' : 'x'

  /* ---- left panel: the section in the shear/bending plane (scale drawing) ---- */
  const boxX = 66 // leaves room for the d dimension on the left of a wide section
  const boxY = 56
  const boxW = 118
  const boxH = 136
  const sc = Math.min(boxW / b, boxH / h)
  const w = b * sc
  const hh = h * sc
  const x0 = boxX + (boxW - w) / 2
  const y0 = boxY + (boxH - hh) / 2
  const cx = x0 + w / 2
  const midY = y0 + hh / 2
  const tensionAtBottom = section.tensionFace === 'bottom' || section.tensionFace === 'right'
  const compY = tensionAtBottom ? y0 : y0 + hh
  const tensY = tensionAtBottom ? y0 + hh : y0
  const dEnd = compY + (tensionAtBottom ? 1 : -1) * d * sc
  const barInset = Math.max(Math.min(cover * sc, 11), 3.5)
  const linkInset = Math.max(Math.min((cover + settings.linkDia) * sc, Math.min(w, hh) / 3), barInset)
  const lx = x0 + linkInset
  const ly = y0 + linkInset
  const lw = Math.max(w - 2 * linkInset, 2)
  const lh = Math.max(hh - 2 * linkInset, 2)
  const step = (w - 2 * barInset) / 3
  const barXs = [0, 1, 2, 3].map((i) => x0 + barInset + i * step)

  /* ---- right panel: member elevation with links at the provided spacing ---- */
  const ex = 252
  const exR = 446
  const eyTop = 64
  const eh = 126
  const eyBot = eyTop + eh
  // Links are drawn at a legible pitch and the dimension between them carries the
  // real spacing value, so the elevation is deliberately not to scale.
  const pitch = Math.min(46, Math.max(24, (exR - ex) / 4))
  const nLinks = Math.max(2, Math.floor((exR - ex - 12) / pitch) + 1)
  const linkXs = Array.from({ length: nLinks }, (_, i) => ex + 6 + i * pitch)

  const provided = result ? result.asvPerSProvided : (legs * barArea(settings.linkDia)) / spacing
  const leftLines = [
    `b = ${fmtN(b, 0)} mm net (mid-depth) · h = ${fmtN(h, 0)} mm`,
    `depth along ${axisName} · d = ${fmtN(d, 0)} mm`,
    `tension face: ${FACE_LABEL[section.tensionFace].toLowerCase()} · Asl = ${fmtN(section.Asl, 0)} mm²`,
    `${section.tensionBarCount} tension bars · clear cover ${fmtN(cover, 0)} mm`,
  ]
  const rightLines = [
    `⌀${fmtN(settings.linkDia, 0)} @ ${fmtN(spacing, 0)} c/c · ${legs} legs · Asv/sv = ${fmtN(provided, 3)}`,
    result
      ? `required ${fmtN(result.asvPerSReq, 3)} mm²/mm · ${result.asvPerSProvided + 1e-9 >= result.asvPerSReq ? 'passes' : 'fails'}`
      : 'required — (no case selected)',
    `sv,max = ${fmtN(result ? result.spaceMax : 0.75 * d, 0)} mm · sv,req = ${
      result && Number.isFinite(result.spaceReq) ? `${fmtN(result.spaceReq, 0)} mm` : '—'
    }`,
    `VRd = ${fmtN(result ? result.VRd / 1e3 : 0, 0)} kN · VEd = ${fmtN(result ? result.VEd / 1e3 : 0, 0)} kN`,
  ]

  return (
    <ZoomableSvg
      W={460}
      H={300}
      id={id}
      ariaLabel="Shear reinforcement diagram: link cross-section in the shear plane and a member elevation with the provided link spacing"
    >
      {/* ---------------- link cross-section ---------------- */}
      <text x={14} y={18} fontSize={10} className="fill-ink-3" fontFamily={FONT} fontWeight={700} letterSpacing="0.06em">
        LINK CROSS-SECTION
      </text>

      {/* shear force arrow, pointing towards the face in tension */}
      <text x={cx} y={32} fontSize={9.5} textAnchor="middle" className="fill-demand">
        {result ? `Vu = ${fmtN(result.loadCase.Vu, 0)} kN` : 'Vu'}
      </text>
      <line x1={cx} y1={38} x2={cx} y2={52} className="stroke-demand" strokeWidth={2} />
      <path
        d={
          tensionAtBottom
            ? `M ${cx - 4} 45 L ${cx} 52 L ${cx + 4} 45`
            : `M ${cx - 4} 45 L ${cx} 38 L ${cx + 4} 45`
        }
        fill="none"
        className="stroke-demand"
        strokeWidth={2}
      />

      {/* section, links and longitudinal bars */}
      <rect x={x0} y={y0} width={w} height={hh} rx={1.5} className="fill-concrete stroke-ink" strokeWidth={1.3} />
      <rect x={lx} y={ly} width={lw} height={lh} rx={3} fill="none" className="stroke-capacity" strokeWidth={1.5} />
      {Array.from({ length: legs }, (_, i) => {
        const x = lx + ((i + 0.5) / legs) * lw
        return <line key={i} x1={x} y1={ly} x2={x} y2={ly + lh} className="stroke-capacity" strokeWidth={1.3} />
      })}
      {barXs.map((x, i) => (
        <circle key={`t${i}`} cx={x} cy={tensY + (tensionAtBottom ? -barInset : barInset)} r={2.6} className="fill-ink" />
      ))}
      {barXs.slice(1, 3).map((x, i) => (
        <circle
          key={`c${i}`}
          cx={x}
          cy={compY + (tensionAtBottom ? barInset : -barInset)}
          r={2.4}
          fill="none"
          className="stroke-ink-2"
          strokeWidth={1}
        />
      ))}

      {/* effective depth d, measured from the compression fibre */}
      <line x1={x0 - 12} y1={compY} x2={x0 - 12} y2={dEnd} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0 - 16} y1={compY} x2={x0 - 8} y2={compY} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0 - 16} y1={dEnd} x2={x0 - 8} y2={dEnd} className="stroke-ink-3" strokeWidth={0.9} />
      <text
        x={x0 - 18}
        y={compY + (tensionAtBottom ? 1 : -1) * ((d * sc) / 2)}
        fontSize={9.5}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-ink-2"
      >
        d = {fmtN(d, 0)}
      </text>

      {/* overall depth and the tension-steel tag (right of the section) */}
      <line x1={x0 + w + 6} y1={y0} x2={x0 + w + 6} y2={y0 + hh} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0 + w + 2} y1={y0} x2={x0 + w + 10} y2={y0} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0 + w + 2} y1={y0 + hh} x2={x0 + w + 10} y2={y0 + hh} className="stroke-ink-3" strokeWidth={0.9} />
      <text x={x0 + w + 13} y={midY} fontSize={9.5} dominantBaseline="middle" className="fill-ink-2">
        h = {fmtN(h, 0)}
      </text>
      {Math.abs(tensY - midY) > 26 && (
        <text
          x={x0 + w + 13}
          y={tensY + (tensionAtBottom ? -6 : 9)}
          fontSize={8.5}
          dominantBaseline="middle"
          className="fill-ink-3"
        >
          tension steel
        </text>
      )}

      {/* width dimension b under the section */}
      <line x1={x0} y1={204} x2={x0 + w} y2={204} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0} y1={200} x2={x0} y2={208} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={x0 + w} y1={200} x2={x0 + w} y2={208} className="stroke-ink-3" strokeWidth={0.9} />
      <text x={cx} y={218} fontSize={9.5} textAnchor="middle" className="fill-ink-2">
        b = {fmtN(b, 0)}
      </text>

      {/* ---------------- member elevation ---------------- */}
      <text x={ex} y={18} fontSize={10} className="fill-ink-3" fontFamily={FONT} fontWeight={700} letterSpacing="0.06em">
        LINKS
      </text>
      <line x1={ex} y1={eyTop} x2={exR} y2={eyTop} className="stroke-edge-strong" strokeWidth={1.1} />
      <line x1={ex} y1={eyBot} x2={exR} y2={eyBot} className="stroke-edge-strong" strokeWidth={1.1} />
      {linkXs.map((x, i) => (
        <g key={i}>
          <line x1={x} y1={eyTop + 4} x2={x} y2={eyBot - 4} className="stroke-capacity" strokeWidth={1.6} />
          <line x1={x + 2.8} y1={eyTop + 4} x2={x + 2.8} y2={eyBot - 4} className="stroke-capacity" strokeWidth={1.6} />
        </g>
      ))}
      {/* spacing dimension between the first two links */}
      <line x1={linkXs[0] + 1.4} y1={204} x2={linkXs[1] + 1.4} y2={204} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={linkXs[0] + 1.4} y1={200} x2={linkXs[0] + 1.4} y2={208} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={linkXs[1] + 1.4} y1={200} x2={linkXs[1] + 1.4} y2={208} className="stroke-ink-3" strokeWidth={0.9} />
      <text x={(linkXs[0] + linkXs[1]) / 2 + 1.4} y={218} fontSize={9.5} textAnchor="middle" className="fill-ink-2">
        sv = {fmtN(spacing, 0)}
      </text>

      {/* data captions under each panel — the elevation is not to scale */}
      {leftLines.map((line, i) => (
        <text key={i} x={14} y={242 + i * 14} fontSize={9.5} className="fill-ink-2">
          {line}
        </text>
      ))}
      {rightLines.map((line, i) => (
        <text key={i} x={ex} y={242 + i * 14} fontSize={9.5} className="fill-ink-2">
          {line}
        </text>
      ))}
    </ZoomableSvg>
  )
}

/* ------------------------------------------------------------------ */
/* Step-by-step calculation                                            */
/* ------------------------------------------------------------------ */

function StepRow({ step }: { step: ShearStep }) {
  return (
    <tr className="border-b border-line align-top">
      <td className={`${tdCls} whitespace-nowrap font-mono text-[11px] text-ink-2`}>{step.clause}</td>
      <td className={`${tdCls} font-medium`}>
        {step.title}
        {step.expr && <div className="font-mono text-[10.5px] font-normal leading-snug text-ink-3">{step.expr}</div>}
      </td>
      <td className={`${tdCls} font-mono text-[11.5px]`}>{step.value}</td>
    </tr>
  )
}

/**
 * Step-by-step shear calculation for the selected load case: every line the
 * engine used, with its substituted values and clause reference, followed by the
 * individual compliance checks of that case.
 */
export function ShearStepPanel({
  code,
  lc,
  result,
  section,
}: {
  code: DesignCodeId
  lc: ShearLoadCase | null
  result: ShearCaseResult | null
  section: ShearSectionData
}) {
  if (!lc || !result) {
    return (
      <Card title="Shear calculation" subtitle="select a load case">
        <p className={noteCls}>Select a shear load case to see the step-by-step calculation.</p>
      </Card>
    )
  }
  const info = SHEAR_CODE_INFO[code]
  return (
    <Card title={`Shear calculation — ${lc.name}`} subtitle={CODES[code].name}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-4">
        <SummaryRow k="Design shear force VEd" v={`${fmtN(result.VEd / 1e3, 1)} kN`} />
        <SummaryRow k="Nominal shear stress τv" v={`${fmtN(result.tauV, 3)} N/mm²`} />
        <SummaryRow k="Concrete strength" v={`${fmtN(result.tauC, 3)} N/mm²`} />
        <SummaryRow k="Web crushing limit" v={`${fmtN(result.tauCMax, 2)} N/mm²`} />
        <SummaryRow k="Concrete resistance Vc" v={`${fmtN(result.Vc / 1e3, 0)} kN`} />
        <SummaryRow k="Links carry Vs" v={`${fmtN(result.Vs / 1e3, 0)} kN`} />
        <SummaryRow k="Required Asv/sv" v={`${fmtN(result.asvPerSReq, 3)} mm²/mm`} />
        <SummaryRow k="Provided Asv/sv" v={`${fmtN(result.asvPerSProvided, 3)} mm²/mm`} />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Clause</th>
              <th className={`${thCls} text-left`}>Step</th>
              <th className={`${thCls} text-left`}>Substituted value</th>
            </tr>
          </thead>
          <tbody>
            {result.steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
          </tbody>
        </table>
      </div>

      <SubCard title={`Compliance — ${CODES[code].name}`}>
        <div className="overflow-x-auto">
          <table className={tblCls}>
            <thead>
              <tr className="border-b border-edge-strong bg-panel/60">
                <th className={`${thCls} text-left`}>Clause</th>
                <th className={`${thCls} text-left`}>Check</th>
                <th className={`${thCls} text-left`}>Computed</th>
                <th className={`${thCls} text-left`}>Limit</th>
                <th className={`${thCls} text-center`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.checks.map((c, i) => (
                <tr key={i} className={`border-b border-line align-top ${c.status === 'fail' ? 'bg-bad/6' : ''}`}>
                  <td className={`${tdCls} whitespace-nowrap font-mono text-[11px] text-ink-2`}>{c.clause}</td>
                  <td className={`${tdCls} font-medium`}>
                    {c.title}
                    {c.note && <div className="mt-0.5 text-[10.5px] font-normal leading-snug text-ink-2">{c.note}</div>}
                  </td>
                  <td className={`${tdCls} tnum`}>{c.demand}</td>
                  <td className={`${tdCls} tnum text-ink-2`}>{c.limit}</td>
                  <td className={`${tdCls} text-center`}>
                    <Chip status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SubCard>

      {result.notes.length > 0 && (
        <ul className={`${noteCls} mt-2 list-disc space-y-0.5 pl-4`}>
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <p className={`${noteCls} mt-2.5`}>
        <b>{CODES[code].name}</b> — {info.method}
      </p>
      <p className={`${noteSmCls} mt-1`}>
        Section used: h = {fmtN(section.h, 0)} mm, b = {fmtN(section.b, 0)} mm, d = {fmtN(section.d, 0)} mm, A
        <sub>sl</sub> = {fmtN(section.Asl, 0)} mm²
        {section.tensionByHalfDepth ? ' (tension bars inferred from the tension half of the section)' : ''}.
      </p>
    </Card>
  )
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-display text-[9.5px] font-bold uppercase leading-tight tracking-[0.07em] text-ink-3">{k}</span>
      <span className="tnum">{v}</span>
    </div>
  )
}
