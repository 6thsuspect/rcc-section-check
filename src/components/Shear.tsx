import { useState, type ReactNode } from 'react'
import type { DesignCodeId, Rebar, RebarFace, SectionGeometry } from '../engine/types'
import { CODES } from '../engine/codes'
import { centroid } from '../engine/geometry'
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
import {
  RESTRAINT_LIMIT,
  autoLinkMembers,
  barColumns,
  hookPath,
  memberCoordinate,
  normalisedPosition,
  suggestMemberPosition,
  type LinkLayout,
  type LinkMemberKind,
  type LinkValidation,
  type ResolvedLinkMember,
} from '../engine/stirrups'
import { fmtN, newShearCaseId, type AppState } from '../state'
import {
  Card,
  Check,
  Chip,
  Banner,
  EmptyState,
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
  fieldBoxCls,
  fieldCls,
  noteCls,
  noteSmCls,
  rowDelCls,
  tblCls,
  tdCls,
  thCls,
} from './ui'

/** Normalised positions are kept to the entered precision. */
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Sorted, de-duplicated normalised position list. */
function tidyPositions(list: number[]): number[] {
  const out: number[] = []
  for (const v of [...list].sort((a, b) => a - b)) {
    if (!Number.isFinite(v)) continue
    if (!out.some((x) => Math.abs(x - v) < 1e-6)) out.push(round3(v))
  }
  return out
}

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
  layout,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  section: ShearSectionData
  /** Resolved link layout — supplies the effective leg count actually used. */
  layout: LinkLayout
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
          <div className="flex flex-wrap items-end gap-1.5">
            <NumField
              label="Link ⌀"
              unit="mm"
              w="w-[92px]"
              value={s.linkDia}
              step={2}
              min={6}
              onChange={(v) => setShear({ linkDia: v })}
            />
            <NumField
              label="Legs"
              w="w-[78px]"
              value={layout.effectiveLegs}
              disabled
              onChange={() => {}}
              hint="in the detailing editor"
              title="Legs of the closed link plus the intermediate legs crossing the shear plane — set them in the detailing editor below."
            />
            <NumField
              label="Spacing"
              unit="mm"
              w="min-w-[132px] flex-1"
              value={s.linkSpacing}
              min={25}
              step={10}
              onChange={(v) => setShear({ linkSpacing: v })}
              hint={
                section && s.linkSpacing > 0.75 * Math.max(section.d, 1) + 1e-9
                  ? `above 0.75 d = ${fmtN(0.75 * Math.max(section.d, 1), 0)} mm — see the code limit`
                  : undefined
              }
            />
          </div>
          <span className="text-[9.5px] leading-tight text-ink-3">
            A<sub>sv</sub> = {layout.effectiveLegs} × ⌀{fmtN(s.linkDia, 0)} = {fmtN(layout.totalLegArea, 1)} mm² per set of legs ·
            A<sub>sv</sub>/s<sub>v</sub> = {fmtN(layout.asvPerS, 3)} mm²/mm — {layout.intermediate.length} intermediate leg
            {layout.intermediate.length === 1 ? '' : 's'}
            {layout.ties.length > 0 ? ` · ${layout.ties.length} cross-tie${layout.ties.length === 1 ? '' : 's'}` : ''}
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
export function ShearSummaryPanel({ code, summary }: { code: DesignCodeId; summary: ShearSummary }) {
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

/** Figure viewBox — the print report captures exactly this box. */
const DIAG_W = 460
const DIAG_H = 340
/** Section panel: outline box, plus the margin reserved for dimension lines. */
const SEC_X0 = 12
const SEC_X1 = 266
const SEC_Y0 = 48
const SEC_Y1 = 236
const SEC_MARGIN = { left: 54, right: 46, top: 8, bottom: 34 }
/** Member elevation (link schedule) at the top of the right column. */
const ELEV_X0 = 272
const ELEV_X1 = 452
const ELEV_Y0 = 48
const ELEV_Y1 = 126
/** Legend rows under the elevation. */
const LEGEND_Y0 = 184
const LEGEND_DY = 13

/** Bars a member sits on, as 1-based labels ("2 and 8", "2, 5 and 9"). */
function barLabels(indexes: number[]): string {
  const l = indexes.map((i) => i + 1)
  if (l.length <= 1) return l.join('')
  if (l.length === 2) return `${l[0]} and ${l[1]}`
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`
}

/**
 * How a leg or cross-tie lines up with the longitudinal reinforcement: the bar
 * each end is hooked around, which is what makes an internal leg connect the
 * bottom reinforcement to the top (and a cross-tie the side-face bars).
 */
function memberAlignment(m: ResolvedLinkMember): { short: string; long: string } {
  const { a, b } = m.ends
  if (a !== null && b !== null) {
    return {
      short: `on bars ${a + 1} + ${b + 1}`,
      long: `hooked around bars ${a + 1} and ${b + 1}`,
    }
  }
  const one = a ?? b
  if (one !== null) {
    return {
      short: `on bar ${one + 1} only — check anchorage`,
      long: `hooked around bar ${one + 1} at one end only`,
    }
  }
  return {
    short: 'not aligned with a bar',
    long: `lines up with no longitudinal bar (nearest ${m.nearestBar === null ? '—' : `${fmtN(m.nearestBar, 0)} mm`})`,
  }
}

/** Line style per link member kind — the drawing, the legend and the editor share it. */
const MEMBER_STYLE: Record<
  LinkMemberKind,
  { cls: string; dot: string; dash?: string; width: number; label: string }
> = {
  leg: { cls: 'stroke-capacity', dot: 'fill-capacity', dash: '4 2', width: 1.5, label: 'Internal leg' },
  // dash-dot and neutral ink: a cross-tie restrains a bar but is not link steel
  // in Asv, so it must read differently from the blue legs at a glance
  tie: { cls: 'stroke-ink-2', dot: 'fill-ink-2', dash: '3 1.6 0.9 1.6', width: 1.2, label: 'Cross-tie' },
}

/**
 * Shear reinforcement diagram: the *actual* main cross-section (same geometry,
 * same clear cover and the same longitudinal bar coordinates as the section
 * preview), set out with the resolved link ring, the intermediate legs and the
 * cross-ties, next to a member elevation carrying the provided link spacing.
 *
 * Pure SVG so the print report captures the figure exactly like the others. The
 * drawing reports the geometry that the code check is run on — it is a detailing
 * view, never a compliance statement in itself.
 */
export function ShearDiagram({
  geometry,
  bars,
  section,
  settings,
  layout,
  validation,
  result,
  selected = null,
  onSelect,
  id,
}: {
  geometry: SectionGeometry
  bars: Rebar[]
  section: ShearSectionData
  settings: ShearSettings
  /** Ring, legs and cross-ties resolved once by the engine (single source of truth). */
  layout: LinkLayout
  /** Detailing validation of the same layout. */
  validation?: LinkValidation | null
  result: ShearCaseResult | null
  /** Selected member id (the editor highlighting). */
  selected?: string | null
  onSelect?: (id: string | null) => void
  /** DOM id so the print report can capture the figure (fig-shear). */
  id?: string
}) {
  const xs = geometry.boundary.map((p) => p.x)
  const ys = geometry.boundary.map((p) => p.y)
  if (xs.length < 3)
    return (
      <EmptyState
        icon="ruler"
        title="Enter at least 3 boundary vertices."
        note="The link ring, the legs and the cross-ties are set out from the section outline and the longitudinal bars."
      />
    )

  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  const spanX = Math.max(xmax - xmin, 1)
  const spanY = Math.max(ymax - ymin, 1)
  const availW = Math.max(SEC_X1 - SEC_X0 - SEC_MARGIN.left - SEC_MARGIN.right, 40)
  const availH = Math.max(SEC_Y1 - SEC_Y0 - SEC_MARGIN.top - SEC_MARGIN.bottom, 40)
  const sc = Math.max(Math.min(availW / spanX, availH / spanY), 1e-6)
  const ox = SEC_X0 + SEC_MARGIN.left + (availW - spanX * sc) / 2
  const oy = SEC_Y0 + SEC_MARGIN.top + (availH - spanY * sc) / 2
  const X = (x: number) => ox + (x - xmin) * sc
  const Y = (y: number) => oy + (ymax - y) * sc
  const toPath = (poly: { x: number; y: number }[]) =>
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ') + ' Z'

  const xL = X(xmin)
  const xR = X(xmax)
  const yT = Y(ymax)
  const yB = Y(ymin)
  const midX = (xL + xR) / 2
  const midY = (yT + yB) / 2

  /* ---- shear plane, compression fibre and effective depth ---- */
  const byY = section.axis === 'y'
  const tensionAtMax = section.tensionFace === 'bottom' || section.tensionFace === 'right'
  const dEff = Math.max(Math.min(section.d, byY ? spanY : spanX), 1)
  // depth direction on the page: +1 when the depth grows towards larger model coordinates
  const depthDir = byY !== tensionAtMax ? 1 : -1
  const compFibre = byY ? (tensionAtMax ? ymax : ymin) : tensionAtMax ? xmin : xmax
  const tensionLevel = compFibre + depthDir * dEff
  const tensionToBottom = (byY && section.tensionFace === 'bottom') || (!byY && section.tensionFace === 'right')

  /* ---- longitudinal bars ---- */
  const facesOf = (b: Rebar) => (b.faces?.length ? b.faces : b.face ? [b.face] : [])
  const vOf = (p: { x: number; y: number }) => (byY ? p.y : p.x)
  const vMid = (ymin + ymax) / 2
  const isTensionBar = (b: Rebar) => {
    if (!section.tensionByHalfDepth) return facesOf(b).includes(section.tensionFace)
    return tensionAtMax ? vOf(b) >= vMid : vOf(b) <= vMid
  }
  const barR = (dia: number) => Math.max(2.2, (dia / 2) * sc)

  /* ---- links ---- */
  const linkDia = Math.max(settings.linkDia, 1)
  const spacing = Math.max(settings.linkSpacing, 1)
  const hookLen = Math.min(6 * linkDia, 6 / sc)
  const centre = centroid(geometry.boundary)
  /** Position of a member in section millimetres, for tooltips and labels. */
  const memberPos = (m: ResolvedLinkMember) =>
    m.kind === 'leg' ? { axis: 'x' as const, value: byY ? m.a.x : m.a.y } : { axis: 'y' as const, value: byY ? m.a.y : m.a.x }

  /* ---- captions (kept short; the panels carry the rest) ---- */
  const leftLines = [
    `b = ${fmtN(section.b, 0)} · h = ${fmtN(section.h, 0)} mm net (mid-depth)`,
    `depth along ${section.axis} · d = ${fmtN(dEff, 0)} mm effective`,
    `tension steel: ${FACE_LABEL[section.tensionFace].toLowerCase()} face · Asl = ${fmtN(section.Asl, 0)} mm²`,
    `${section.tensionBarCount} tension bars · cover ${fmtN(section.coverTension, 0)} mm to the link`,
  ]
  // the components that make the provided Asv, read off the actual arrangement
  const rigText = `${layout.effectiveLegs} legs in Asv: 2 ring + ${layout.intermediate.length} internal`
  const rightLines = [
    `provided = ${fmtN(layout.effectiveLegs, 0)} × ${fmtN(layout.singleLegArea, 1)} mm² @ ${fmtN(spacing, 0)} c/c`,
    `Asv/sv = ${fmtN(layout.asvPerS, 3)} · req ${result ? fmtN(result.asvPerSReq, 3) : '—'} mm²/mm`,
    `sv,max = ${result ? `${fmtN(result.spaceMax, 0)} mm` : '—'} · sv,req = ${
      result && Number.isFinite(result.spaceReq) ? `${fmtN(result.spaceReq, 0)} mm` : '—'
    }`,
    `VRd = ${result ? `${fmtN(result.VRd / 1e3, 0)} kN` : '—'} vs VEd = ${result ? `${fmtN(result.VEd / 1e3, 0)} kN` : '—'}`,
  ]

  const status = validation?.status ?? 'ok'
  /** First sentence of a message — the figure has room for one line. */
  const firstIssue = (list: string[] | undefined) => {
    const text = list?.[0] ?? ''
    const cut = text.search(/ — |; |\. /)
    return (cut > 8 ? text.slice(0, cut) : text).trim()
  }
  const sep = (head: string, tail: string) => `${head}${tail ? ` · ${tail}` : ''}`
  const statusText =
    status === 'ok'
      ? 'Detailing: no exceptions raised for this arrangement.'
      : status === 'warn'
        ? `Detailing: ${validation?.warnings.length ?? 0} item(s) to verify by calculation — ${firstIssue(validation?.warnings)}`
        : `Detailing: ${validation?.errors.length ?? 0} correction(s) required — ${firstIssue(validation?.errors)}`
  // the editor below carries every message in full; the figure keeps one line
  const fit = (text: string, room = 88) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)
  const arrangementText = sep(
    `Ring ${layout.ring.shape} ⌀${fmtN(linkDia, 0)} ${settings.linkShape === 'auto' ? 'auto' : 'forced'} · ${
      // the source of the members is worth naming: the automatic layout is read off the bar table
      layout.mode === 'auto' ? `auto from ${bars.length} bars` : 'manual arrangement'
    }`,
    `${layout.effectiveLegs} legs = 2 ring + ${layout.intermediate.length} internal${layout.ties.length > 0 ? ` · ${layout.ties.length} cross-tie${layout.ties.length === 1 ? '' : 's'}` : ''}`,
  )

  /* ---- member elevation: link schedule at a fixed pitch (not to scale) ---- */
  const pitch = Math.min(30, Math.max(18, (ELEV_X1 - ELEV_X0 - 18) / 6))
  const nLinks = Math.max(2, Math.floor((ELEV_X1 - ELEV_X0 - 18) / pitch) + 1)
  const linkXs = Array.from({ length: nLinks }, (_, i) => ELEV_X0 + 9 + i * pitch)
  const barLineTop = ELEV_Y0 + 9
  const barLineBot = ELEV_Y1 - 9
  // the elevation can only show a tension face when the depth runs vertically
  const tensionBarTop = byY ? !tensionToBottom : null

  const legendRows: { text: string; swatch: ReactNode }[] = [
    {
      text: 'Bar — tension filled, other hollow',
      swatch: (
        <g>
          <circle cx={ELEV_X0 + 4} cy={LEGEND_Y0 + 1} r={3} className="fill-ink" />
          <circle cx={ELEV_X0 + 13} cy={LEGEND_Y0 + 1} r={3} className="fill-paper stroke-ink-2" strokeWidth={1} />
        </g>
      ),
    },
    {
      text: 'Outer link — 2 legs in Asv',
      swatch: (
        <line x1={ELEV_X0} y1={LEGEND_Y0 + 1} x2={ELEV_X0 + 17} y2={LEGEND_Y0 + 1} className="stroke-capacity" strokeWidth={1.7} />
      ),
    },
    {
      text: `Internal leg — in Asv (${layout.intermediate.length})`,
      swatch: (
        <line
          x1={ELEV_X0}
          y1={LEGEND_Y0 + 1}
          x2={ELEV_X0 + 17}
          y2={LEGEND_Y0 + 1}
          className="stroke-capacity"
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />
      ),
    },
    {
      text: `Cross-tie — not in Asv (${layout.ties.length})`,
      swatch: (
        <line
          x1={ELEV_X0}
          y1={LEGEND_Y0 + 1}
          x2={ELEV_X0 + 17}
          y2={LEGEND_Y0 + 1}
          className="stroke-ink-2"
          strokeWidth={1.2}
          strokeDasharray="3 1.6 0.9 1.6"
        />
      ),
    },
    {
      text: `Shear plane at d = ${fmtN(dEff, 0)} mm`,
      swatch: (
        <line x1={ELEV_X0} y1={LEGEND_Y0 + 1} x2={ELEV_X0 + 17} y2={LEGEND_Y0 + 1} className="stroke-ink-3" strokeWidth={0.9} strokeDasharray="1.5 3" />
      ),
    },
  ]

  return (
    <ZoomableSvg
      W={DIAG_W}
      H={DIAG_H}
      id={id}
      ariaLabel="Shear reinforcement diagram: the main cross-section with its longitudinal bars, link ring, intermediate legs and cross-ties, and a member elevation with the provided link spacing"
    >
      {/* ---------------- section panel ---------------- */}
      <text x={SEC_X0} y={16} fontSize={10} className="fill-ink-3" fontFamily={FONT} fontWeight={700} letterSpacing="0.06em">
        LINK CROSS-SECTION — SHEAR PLANE
      </text>

      {/* shear force, acting towards the flexural tension face */}
      <text x={midX} y={31} fontSize={9.5} textAnchor="middle" className="fill-demand">
        {result ? `Vu = ${fmtN(result.loadCase.Vu, 0)} kN` : 'Vu'}
      </text>
      {byY ? (
        <>
          <line x1={midX} y1={38} x2={midX} y2={44} className="stroke-demand" strokeWidth={2} />
          <path
            d={tensionToBottom ? `M ${midX - 4} 40 L ${midX} 46 L ${midX + 4} 40` : `M ${midX - 4} 44 L ${midX} 38 L ${midX + 4} 44`}
            fill="none"
            className="stroke-demand"
            strokeWidth={2}
          />
        </>
      ) : (
        <>
          <line x1={midX - 22} y1={40} x2={midX + 22} y2={40} className="stroke-demand" strokeWidth={2} />
          <path
            d={
              section.tensionFace === 'right'
                ? `M ${midX + 18} 36 L ${midX + 24} 40 L ${midX + 18} 44`
                : `M ${midX - 18} 36 L ${midX - 24} 40 L ${midX - 18} 44`
            }
            fill="none"
            className="stroke-demand"
            strokeWidth={2}
          />
        </>
      )}

      {/* concrete outline and voids — the section exactly as designed */}
      <path d={toPath(geometry.boundary)} className="fill-concrete stroke-ink" strokeWidth={1.3} />
      {geometry.voids.map((vd, i) => (
        <path key={i} d={toPath(vd)} className="fill-paper stroke-ink" strokeWidth={1.1} />
      ))}

      {/* link ring */}
      {layout.ring.circle ? (
        <circle
          cx={X(layout.ring.circle.cx)}
          cy={Y(layout.ring.circle.cy)}
          r={Math.max(layout.ring.circle.r * sc, 0.5)}
          fill="none"
          className="stroke-capacity"
          strokeWidth={1.7}
        >
          <title>{`Outer link — ⌀${fmtN(linkDia, 0)} circular hoop, 2 legs counted in Asv`}</title>
        </circle>
      ) : (
        <path d={toPath(layout.ring.path)} fill="none" className="stroke-capacity" strokeWidth={1.7}>
          <title>{`Outer link — ⌀${fmtN(linkDia, 0)} closed ${layout.ring.shape} link, 2 legs counted in Asv`}</title>
        </path>
      )}

      {/* shear plane at the tension steel centroid */}
      {byY ? (
        <line x1={xL} y1={Y(tensionLevel)} x2={xR} y2={Y(tensionLevel)} className="stroke-ink-3" strokeWidth={0.9} strokeDasharray="1.5 3" />
      ) : (
        <line x1={X(tensionLevel)} y1={yB} x2={X(tensionLevel)} y2={yT} className="stroke-ink-3" strokeWidth={0.9} strokeDasharray="1.5 3" />
      )}

      {/* intermediate legs and cross-ties */}
      {layout.members.map((m) => {
        const p1 = { x: X(m.a.x), y: Y(m.a.y) }
        const p2 = { x: X(m.b.x), y: Y(m.b.y) }
        const st = MEMBER_STYLE[m.kind]
        const isSel = selected === m.id
        const pos = memberPos(m)
        /* The tail of a hook turns towards the bar that end is anchored on (the
           component of "towards the bar" across the member); with no bar there it
           turns inboard towards the centroid, so no tail leaves the ring. */
        const axis = { x: m.b.x - m.a.x, y: m.b.y - m.a.y }
        const axisLen = Math.hypot(axis.x, axis.y) || 1
        const ux = axis.x / axisLen
        const uy = axis.y / axisLen
        const inward = (p: { x: number; y: number }, index: number | null) => {
          const centroidward = { x: centre.x - p.x, y: centre.y - p.y }
          if (index === null || !bars[index]) return centroidward
          const bar = bars[index]
          const raw = { x: bar.x - p.x, y: bar.y - p.y }
          const along = raw.x * ux + raw.y * uy
          const across = { x: raw.x - along * ux, y: raw.y - along * uy }
          return Math.hypot(across.x, across.y) > 1e-6 ? across : centroidward
        }
        const hooks =
          m.length > 4 * linkDia
            ? [
                hookPath(m.a, m.b, hookLen, inward(m.a, m.ends.a)),
                hookPath(m.b, m.a, hookLen, inward(m.b, m.ends.b)),
              ]
            : []
        const label = m.kind === 'leg' ? 'Leg' : 'Cross-tie'
        const align = memberAlignment(m)
        return (
          <g
            key={m.id}
            onClick={onSelect ? () => onSelect(isSel ? null : m.id) : undefined}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <title>
              {`${label} — ${pos.axis} = ${fmtN(pos.value, 0)} mm · ${fmtN(m.length, 0)} mm long · ${align.long}${
                m.bars.length > 0 ? ` · on the bar line of ${barLabels(m.bars)}` : ''
              } · ${m.kind === 'leg' ? `counted in Asv (legs now ${layout.effectiveLegs})` : 'runs across the width, not counted in Asv'}${
                m.manual ? ' · manual position' : ' · automatic position'
              }`}
            </title>
            {/* larger invisible hit area so the member stays clickable when zoomed out */}
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={9} />
            {isSel && <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="stroke-accent" strokeWidth={6} opacity={0.2} />}
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className={st.cls}
              strokeWidth={isSel ? st.width + 0.5 : st.width}
              strokeDasharray={st.dash}
              strokeLinecap="round"
            />
            {hooks.map((h, hi) => (
              <path
                key={hi}
                d={h.map((q, qi) => `${qi === 0 ? 'M' : 'L'}${X(q.x).toFixed(2)} ${Y(q.y).toFixed(2)}`).join(' ')}
                fill="none"
                className={st.cls}
                strokeWidth={st.width}
                strokeLinecap="round"
              />
            ))}
            <circle cx={p1.x} cy={p1.y} r={1.7} className={st.dot} />
            <circle cx={p2.x} cy={p2.y} r={1.7} className={st.dot} />
          </g>
        )
      })}

      {/* the longitudinal cage is drawn last, over the links: a leg or tie passes
          behind the bar it is hooked around, so nothing reads as a crossing */}
      {bars.map((b, i) => {
        const r = barR(b.dia)
        const tension = isTensionBar(b)
        return (
          <circle
            key={i}
            cx={X(b.x)}
            cy={Y(b.y)}
            r={r}
            className={tension ? 'fill-ink' : 'fill-paper stroke-ink-2'}
            strokeWidth={tension ? 0 : 1}
            pointerEvents="none"
          >
            <title>{`Bar ${i + 1} — (${fmtN(b.x, 0)}, ${fmtN(b.y, 0)}) ⌀${fmtN(b.dia, 0)}${
              tension ? ' · tension face, in Asl' : ''
            }${b.surface === 'inner' ? ' · void face' : ''}`}</title>
          </circle>
        )
      })}

      {/* width b */}
      {byY ? (
        <>
          <line x1={xL} y1={yB + 16} x2={xR} y2={yB + 16} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xL} y1={yB + 12} x2={xL} y2={yB + 20} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xR} y1={yB + 12} x2={xR} y2={yB + 20} className="stroke-ink-3" strokeWidth={0.9} />
          <text x={midX} y={yB + 30} fontSize={9.5} textAnchor="middle" className="fill-ink-2">
            b = {fmtN(section.b, 0)}
          </text>
        </>
      ) : (
        <>
          <line x1={xR + 14} y1={yB} x2={xR + 14} y2={yT} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xR + 10} y1={yB} x2={xR + 18} y2={yB} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xR + 10} y1={yT} x2={xR + 18} y2={yT} className="stroke-ink-3" strokeWidth={0.9} />
          <text
            x={xR + 27}
            y={midY}
            fontSize={9.5}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(-90 ${xR + 27} ${midY})`}
            className="fill-ink-2"
          >
            b = {fmtN(section.b, 0)}
          </text>
        </>
      )}

      {/* effective depth d, from the compression fibre to the shear plane */}
      {byY ? (
        <>
          <line x1={xL - 14} y1={Y(compFibre)} x2={xL - 14} y2={Y(tensionLevel)} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xL - 18} y1={Y(compFibre)} x2={xL - 10} y2={Y(compFibre)} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={xL - 18} y1={Y(tensionLevel)} x2={xL - 10} y2={Y(tensionLevel)} className="stroke-ink-3" strokeWidth={0.9} />
          <text
            x={xL - 21}
            y={(Y(compFibre) + Y(tensionLevel)) / 2}
            fontSize={9.5}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-ink-2"
          >
            d = {fmtN(dEff, 0)}
          </text>
        </>
      ) : (
        <>
          <line x1={X(compFibre)} y1={yB + 16} x2={X(tensionLevel)} y2={yB + 16} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={X(compFibre)} y1={yB + 12} x2={X(compFibre)} y2={yB + 20} className="stroke-ink-3" strokeWidth={0.9} />
          <line x1={X(tensionLevel)} y1={yB + 12} x2={X(tensionLevel)} y2={yB + 20} className="stroke-ink-3" strokeWidth={0.9} />
          <text x={(X(compFibre) + X(tensionLevel)) / 2} y={yB + 30} fontSize={9.5} textAnchor="middle" className="fill-ink-2">
            d = {fmtN(dEff, 0)}
          </text>
        </>
      )}

      {/* ---------------- member elevation: the provided link spacing ---------------- */}
      <text x={ELEV_X0} y={16} fontSize={10} className="fill-ink-3" fontFamily={FONT} fontWeight={700} letterSpacing="0.06em">
        LINKS ALONG THE MEMBER
      </text>
      <rect x={ELEV_X0} y={ELEV_Y0} width={ELEV_X1 - ELEV_X0} height={ELEV_Y1 - ELEV_Y0} className="fill-paper stroke-edge-strong" strokeWidth={1.1} />
      <line
        x1={ELEV_X0 + 2}
        y1={barLineTop}
        x2={ELEV_X1 - 2}
        y2={barLineTop}
        className={tensionBarTop === null ? 'stroke-ink-3' : tensionBarTop ? 'stroke-ink' : 'stroke-ink-3'}
        strokeWidth={tensionBarTop === true ? 1.8 : 1.2}
      />
      <line
        x1={ELEV_X0 + 2}
        y1={barLineBot}
        x2={ELEV_X1 - 2}
        y2={barLineBot}
        className={tensionBarTop === null ? 'stroke-ink-3' : tensionBarTop ? 'stroke-ink-3' : 'stroke-ink'}
        strokeWidth={tensionBarTop === false ? 1.8 : 1.2}
      />
      {linkXs.map((x, i) => (
        <g key={i}>
          <line x1={x} y1={ELEV_Y0 + 4} x2={x} y2={ELEV_Y1 - 4} className="stroke-capacity" strokeWidth={1.4} />
          <line x1={x + 2.6} y1={ELEV_Y0 + 4} x2={x + 2.6} y2={ELEV_Y1 - 4} className="stroke-capacity" strokeWidth={1.4} />
        </g>
      ))}
      {/* the components of the provided Asv, as drawn */}
      <text x={ELEV_X0 + 3} y={170} fontSize={9} className="fill-ink-2">
        {rigText}
      </text>

      {/* spacing dimension between the first two links — the elevation is not to scale */}
      <line x1={linkXs[0] + 1.3} y1={ELEV_Y1 + 16} x2={linkXs[1] + 1.3} y2={ELEV_Y1 + 16} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={linkXs[0] + 1.3} y1={ELEV_Y1 + 12} x2={linkXs[0] + 1.3} y2={ELEV_Y1 + 20} className="stroke-ink-3" strokeWidth={0.9} />
      <line x1={linkXs[1] + 1.3} y1={ELEV_Y1 + 12} x2={linkXs[1] + 1.3} y2={ELEV_Y1 + 20} className="stroke-ink-3" strokeWidth={0.9} />
      <text x={(linkXs[0] + linkXs[1]) / 2 + 1.3} y={ELEV_Y1 + 30} fontSize={9.5} textAnchor="middle" className="fill-ink-2">
        sv = {fmtN(spacing, 0)} mm
      </text>

      {/* line-style legend: every member kind drawn above, repeated once */}
      {legendRows.map((row, i) => (
        <g key={row.text}>
          {row.swatch}
          <text x={ELEV_X0 + 22} y={LEGEND_Y0 + i * LEGEND_DY + 1} fontSize={8.5} dominantBaseline="middle" className="fill-ink-2">
            {row.text}
          </text>
        </g>
      ))}

      {/* ---------------- captions ---------------- */}
      {leftLines.map((line, i) => (
        <text key={`l${i}`} x={SEC_X0} y={258 + i * 14} fontSize={9.5} className="fill-ink-2">
          {fit(line)}
        </text>
      ))}
      {rightLines.map((line, i) => (
        <text key={`r${i}`} x={SEC_X1} y={258 + i * 14} fontSize={9.5} className="fill-ink-2">
          {fit(line)}
        </text>
      ))}
      <text x={SEC_X0} y={316} fontSize={9} className={status === 'ok' ? 'fill-ok' : status === 'warn' ? 'fill-warn2' : 'fill-bad'}>
        {/* the editor below carries the full wording of every error and warning */}
        {fit(statusText, 92)}
      </text>
      <text x={SEC_X0} y={330} fontSize={9} className="fill-ink-3">
        {fit(arrangementText, 92)}
      </text>
    </ZoomableSvg>
  )
}

/* ------------------------------------------------------------------ */
/* Detailing editor                                                    */
/* ------------------------------------------------------------------ */

/** Compact inline millimetre field for the member rows. */
function MmField({
  value,
  onChange,
  title,
  w = 'w-[92px]',
}: {
  value: number
  onChange: (v: number) => void
  title: string
  w?: string
}) {
  return (
    <span className={`${fieldBoxCls} ${w}`} title={title}>
      <input
        type="number"
        step={10}
        className={fieldCls}
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={title}
      />
      <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
        mm
      </span>
    </span>
  )
}

/**
 * Stirrup detailing: the link type, the automatic or manual arrangement of the
 * intermediate legs and cross-ties, and the resulting Asv — shown next to the
 * drawing it edits. Every edit is validated as entered and reported with its
 * reason; nothing is silently moved or clamped, and the resistance equations in
 * `engine/shear.ts` are never touched here.
 */
export function ShearDetailingCard({
  state,
  update,
  geometry,
  bars,
  section,
  layout,
  validation,
  result,
  circular,
  figureId,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  geometry: SectionGeometry
  bars: Rebar[]
  section: ShearSectionData
  layout: LinkLayout
  validation: LinkValidation
  result: ShearCaseResult | null
  /** Circular sections: the hoop stays concentric, internal members are straight. */
  circular: boolean
  figureId?: string
}) {
  const settings = state.shear
  const [selected, setSelected] = useState<string | null>(null)
  const [symmetry, setSymmetry] = useState(true)
  const setShear = (patch: Partial<ShearSettings>) => update({ shear: { ...settings, ...patch } })

  const legs = settings.legPositions
  const ties = settings.tiePositions
  const manual = settings.linkLayout === 'manual'
  const auto = autoLinkMembers(layout.ring, geometry, bars, settings, circular)

  // What is on the drawing now: the entered positions in manual mode, the
  // derived ones in automatic mode. Editing any of them switches to manual with
  // the drawn arrangement as the starting point, so nothing jumps.
  const baseLegs = manual ? legs : layout.intermediate.map((m) => round3(m.u))
  const baseTies = manual ? ties : layout.ties.map((m) => round3(m.u))

  /** As drawn: switch to manual, seeded from the current layout. */
  const startManual = (seed?: { legs?: number[]; ties?: number[] }) =>
    setShear({
      linkLayout: 'manual',
      legPositions: tidyPositions(seed?.legs ?? baseLegs),
      tiePositions: tidyPositions(seed?.ties ?? baseTies),
    })

  const mirror = (u: number) => round3(1 - u)

  /** Every edit lands in one state update, always in manual mode. */
  const write = (patch: { legs?: number[]; ties?: number[] }) =>
    setShear({
      linkLayout: 'manual',
      legPositions: tidyPositions(patch.legs ?? baseLegs),
      tiePositions: tidyPositions(patch.ties ?? baseTies),
    })

  const addMember = (kind: LinkMemberKind) => {
    const list = kind === 'leg' ? baseLegs : baseTies
    const u = suggestMemberPosition(kind, list, layout.ring, geometry, bars, settings, circular)
    const next = tidyPositions(symmetry ? [...list, u, mirror(u)] : [...list, u])
    write(kind === 'leg' ? { legs: next } : { ties: next })
  }

  const removeMember = (kind: LinkMemberKind, u: number) => {
    const list = kind === 'leg' ? baseLegs : baseTies
    const drop = symmetry ? [u, mirror(u)] : [u]
    const next = list.filter((v) => !drop.some((d) => Math.abs(d - v) < 0.005))
    write(kind === 'leg' ? { legs: next } : { ties: next })
  }

  const moveMember = (kind: LinkMemberKind, from: number, to: number) => {
    if (!Number.isFinite(to)) return
    const list = kind === 'leg' ? baseLegs : baseTies
    const next = list.map((v) => (Math.abs(v - from) < 0.005 ? round3(to) : v))
    if (symmetry) {
      const mFrom = mirror(from)
      const mTo = mirror(to)
      for (let i = 0; i < next.length; i++) if (Math.abs(next[i] - mFrom) < 0.005) next[i] = mTo
    }
    write(kind === 'leg' ? { legs: next } : { ties: next })
  }

  const toggleKind = (u: number) => {
    // the member keeps the coordinate it was entered at but swaps the axis it cuts
    const isLeg = baseLegs.some((v) => Math.abs(v - u) < 0.005)
    if (isLeg) write({ legs: baseLegs.filter((v) => Math.abs(v - u) >= 0.005), ties: [...baseTies, u] })
    else write({ ties: baseTies.filter((v) => Math.abs(v - u) >= 0.005), legs: [...baseLegs, u] })
  }

  /** Even distribution between the outermost members of a kind. */
  const distribute = (kind: LinkMemberKind) => {
    const list = [...(kind === 'leg' ? baseLegs : baseTies)]
    if (list.length < 3) return
    const lo = list[0]
    const hi = list[list.length - 1]
    const next = list.map((_, i) => round3(lo + ((hi - lo) * i) / (list.length - 1)))
    write(kind === 'leg' ? { legs: next } : { ties: next })
  }

  /** Leg count control: total legs crossing the shear plane (2 outer + intermediate). */
  const setLegCount = (total: number) => {
    const n = Math.max(0, Math.min(Math.round(total) - 2, 8))
    if (n === 0) {
      write({ legs: [] })
      return
    }
    const cands = auto.legs
    const lo = cands.length > 0 ? Math.min(...cands) : 0.1
    const hi = cands.length > 0 ? Math.max(...cands) : 0.9
    const next: number[] = []
    for (let i = 0; i < n; i++) {
      const even = lo + ((hi - lo) * (i + 1)) / (n + 1)
      const snap = cands.reduce<number | null>((best, c) => {
        if (best !== null && Math.abs(c - even) >= Math.abs(best - even)) return best
        return c
      }, null)
      const u = snap !== null && Math.abs(snap - even) <= 0.04 && !next.some((v) => Math.abs(v - snap) < 0.02) ? snap : round3(even)
      next.push(u)
    }
    write({ legs: next })
  }

  /** The longitudinal bar columns an internal leg can run along. */
  const legColumns = barColumns(bars, 'leg', settings.axis)

  const rows: { kind: LinkMemberKind; u: number; member: ResolvedLinkMember | null }[] = []
  for (const m of layout.members) rows.push({ kind: m.kind, u: m.u, member: m })
  // manual positions that could not be drawn still get a row, so they can be fixed
  for (const d of layout.dropped) rows.push({ kind: d.kind, u: d.u, member: null })
  rows.sort((a, b) => (a.kind === b.kind ? a.u - b.u : a.kind === 'leg' ? -1 : 1))

  const clearGap = (kind: LinkMemberKind) => {
    const list = kind === 'leg' ? baseLegs : baseTies
    if (list.length < 2) return null
    let min = Infinity
    for (let i = 1; i < list.length; i++) min = Math.min(min, (list[i] - list[i - 1]) * (kind === 'leg' ? section.b : section.h))
    return Number.isFinite(min) ? min : null
  }

  const singleLeg = layout.singleLegArea
  const provided = result ? result.asvPerSProvided : layout.asvPerS
  const required = result ? result.asvPerSReq : null
  const minOk = required === null || provided + 1e-9 >= required

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="link" size={13} className="text-ink-3" />
          <span>Stirrup detailing</span>
        </span>
      }
      subtitle="links, intermediate legs and cross-ties — drawn on the section they are checked on"
      action={<Chip status={validation.status === 'ok' ? 'pass' : validation.status === 'warn' ? 'warn' : 'fail'} />}
    >
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
        <div className="min-w-0">
          <ShearDiagram
            id={figureId}
            geometry={geometry}
            bars={bars}
            section={section}
            settings={settings}
            layout={layout}
            validation={validation}
            result={result}
            selected={selected}
            onSelect={setSelected}
          />
          <p className={`mt-2 ${noteSmCls}`}>
            The drawing is a detailing view of the entered arrangement — it is not evidence of compliance. The
            resistance check uses ⌀{fmtN(settings.linkDia, 0)}, the {layout.effectiveLegs} legs counted in A
            <sub>sv</sub> and s<sub>v</sub> = {fmtN(settings.linkSpacing, 0)} mm from the same settings.
            {layout.mode === 'manual' ? ' Positions entered here are used exactly as entered.' : ' Positions are derived from the longitudinal bars.'}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="flex items-center gap-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
              Link type
              <InfoTooltip
                content={
                  <>
                    The default follows the section: a closed rectangular link in a rectangular section, a concentric
                    hoop in a circular one. A forced type is honoured when it fits — an arrangement that cannot be
                    built from this section and cover is reported below rather than changed for you.
                  </>
                }
              />
            </span>
            <SegGroup>
              {(['auto', 'rectangular', 'circular'] as const).map((shape) => (
                <SegButton
                  key={shape}
                  active={settings.linkShape === shape}
                  onClick={() => setShear({ linkShape: shape })}
                  title={
                    shape === 'auto'
                      ? 'Follow the section shape (rectangular link / concentric hoop).'
                      : `Force a ${shape} link — the arrangement is validated, not adjusted.`
                  }
                >
                  {shape === 'auto' ? 'Auto' : shape === 'rectangular' ? 'Rect.' : 'Circular'}
                </SegButton>
              ))}
            </SegGroup>
            <span className="text-[9.5px] leading-tight text-ink-3">
              Drawn as {layout.ring.shape}
              {layout.ring.auto ? ' (from the section)' : ' (entered)'}; ring inset {fmtN(layout.ring.inset, 0)} mm to
              the ⌀{fmtN(settings.linkDia, 0)} centreline.
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
              Arrangement
            </span>
            <SegGroup>
              <SegButton
                active={!manual}
                onClick={() => setShear({ linkLayout: 'auto' })}
                title="Place intermediate legs on the outermost bar rows and cross-ties on the side-face bar columns; re-derived whenever the bars or the section change."
              >
                Automatic
              </SegButton>
              <SegButton
                active={manual}
                onClick={() =>
                  manual
                    ? undefined
                    : startManual()
                }
                title="Enter every leg and cross-tie position yourself. Nothing is moved for you; anything that cannot be built is reported."
              >
                Manual
              </SegButton>
              <Check
                checked={symmetry}
                onChange={setSymmetry}
                label="Symmetry"
                title="Mirror every edit about the section centreline: adding a member adds its twin, moving one moves its twin."
                className="px-1"
              />
            </SegGroup>
            <span className="text-[9.5px] leading-tight text-ink-3">
              {manual
                ? `${legs.length} entered intermediate leg${legs.length === 1 ? '' : 's'} and ${ties.length} cross-tie${ties.length === 1 ? '' : 's'}. Restoring automatic keeps them until the lists are cleared.`
                : layout.intermediate.length === 0
                  ? 'No intermediate legs are needed by the bar layout; the closed link supplies 2 legs.'
                  : `${layout.intermediate.length} intermediate leg${layout.intermediate.length === 1 ? '' : 's'} placed on the bar layout${layout.ties.length > 0 ? `, ${layout.ties.length} cross-tie${layout.ties.length === 1 ? '' : 's'}` : ''} — re-derived on every change to the bars or the section.`}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-1.5">
            <NumField
              label="Legs in Asv"
              w="w-[92px]"
              value={manual ? 2 + legs.length : layout.effectiveLegs}
              min={2}
              step={1}
              onChange={setLegCount}
              title="Total legs crossing the shear plane: the 2 legs of the closed link plus the intermediate legs. In manual mode this adds or removes intermediate legs."
            />
            <span className="inline-flex items-end gap-1">
              <button type="button" className={btnMiniCls} onClick={() => addMember('leg')} title="Add an intermediate leg, on the nearest unrestrained bar where one is available.">
                <Icon name="plus" size={11} /> Leg
              </button>
              <button type="button" className={btnMiniCls} onClick={() => addMember('tie')} title="Add a cross-tie across the width to restrain a side-face bar (not counted in Asv).">
                <Icon name="plus" size={11} /> Tie
              </button>
            </span>
            {manual && (
              <button
                type="button"
                className={btnMiniCls}
                onClick={() => setShear({ linkLayout: 'auto' })}
                title="Return to the arrangement derived from the longitudinal bars (the manual positions are kept in case you switch back)."
              >
                <Icon name="refresh" size={11} /> Restore automatic
              </button>
            )}
          </div>

          {rows.length === 0 && (
            <p className={noteSmCls}>
              Two legs of the closed link cross the shear plane. Add intermediate legs to credit more; the automatic
              rule places them on the columns of the longitudinal bars.
            </p>
          )}

          {rows.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
                Members on the bar columns
                <InfoTooltip
                  content={
                    <>
                      A <b>leg</b> crosses the shear plane and is counted in A<sub>sv</sub>; a <b>cross-tie</b> runs
                      across the width to restrain a bar and is <b>not</b> counted. Both are placed on the{' '}
                      <b>columns of the longitudinal bars</b>, so a leg runs from the bottom reinforcement to the top
                      reinforcement and a cross-tie is hooked around bars on its level. Positions are section
                      coordinates in mm along the axis the member cuts: legs across the width, cross-ties across the
                      depth.
                      {legColumns.length > 0 && (
                        <>
                          {' '}
                          Legs can run on the bar columns at{' '}
                          {legColumns.map((c) => `${fmtN(c.coord, 0)}${c.spans ? '' : '*'}`).join(', ')} mm
                          {legColumns.some((c) => !c.spans) ? ' (* column without a bar at both ends)' : ''}.
                        </>
                      )}
                    </>
                  }
                />
              </span>
              {rows.map((r) => {
                const st = MEMBER_STYLE[r.kind]
                const isSel = selected !== null && r.member !== null && selected === r.member.id
                const mm = memberCoordinate(geometry, r.kind, r.u, settings.axis)
                const label = r.kind === 'leg' ? 'Leg' : 'Cross-tie'
                return (
                  <div
                    key={`${r.kind}-${r.u}`}
                    className={`flex min-w-0 items-center gap-1.5 rounded-field border px-1.5 py-1 ${
                      isSel ? 'border-accent bg-accent-wash/60' : 'border-line bg-panel/40'
                    }`}
                  >
                    <button
                      type="button"
                      className={`${btnMiniCls} w-[54px] justify-center`}
                      onClick={() => toggleKind(r.u)}
                      title={`${label} — click to switch this member to the ${r.kind === 'leg' ? 'cross-tie' : 'leg'} orientation (it keeps the coordinate it was entered at).`}
                    >
                      {r.kind === 'leg' ? 'Leg' : 'Tie'}
                    </button>
                    <MmField
                      value={mm}
                      onChange={(v) => moveMember(r.kind, r.u, normalisedPosition(geometry, r.kind, v, settings.axis))}
                      title={`${label} position — ${r.kind === 'leg' ? 'x' : 'y'} coordinate in mm`}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[9.5px] leading-tight text-ink-3"
                      title={
                        r.member
                          ? `${fmtN(r.member.length, 0)} mm long, ${memberAlignment(r.member).long}${
                              r.member.bars.length > 0 ? `; runs along the bar line of ${barLabels(r.member.bars)}` : ''
                            }`
                          : 'does not cross the ring'
                      }
                    >
                      {r.member
                        ? `${fmtN(r.member.length, 0)} mm long · ${memberAlignment(r.member).short}`
                        : 'does not cross the ring'}
                    </span>
                    <span className={`h-3 w-4 shrink-0 rounded-sm border border-line ${st.cls.replace('stroke-', 'bg-')}`} />
                    <button type="button" className={rowDelCls} onClick={() => removeMember(r.kind, r.u)} title="Remove this member (with its mirror when symmetry is on)." aria-label="Remove member">
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {(['leg', 'tie'] as const).map((kind) => {
                  const list = kind === 'leg' ? legs : ties
                  if (list.length < 3) return null
                  return (
                    <button key={kind} type="button" className={btnMiniCls} onClick={() => distribute(kind)} title={`Spread the ${kind} positions evenly between the outermost two.`}>
                      Even {kind === 'leg' ? 'legs' : 'ties'}
                    </button>
                  )
                })}
                <span className={noteSmCls}>
                  spacing between legs:{' '}
                  {clearGap('leg') === null ? '—' : `${fmtN(clearGap('leg')!, 0)} mm (≥ ${fmtN(Math.max(25, settings.linkDia), 0)} mm)`}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <Readout label="One leg" value={`${fmtN(singleLeg, 1)} mm²`} title={`Area of a ⌀${fmtN(settings.linkDia, 0)} leg`} />
            <Readout
              label="Legs in Asv"
              value={`${layout.effectiveLegs} (2 + ${layout.intermediate.length})`}
              title="Legs of the closed link plus the intermediate legs crossing the shear plane"
            />
            <Readout label="Asv" value={`${fmtN(layout.totalLegArea, 0)} mm²`} title="Effective legs × the area of one leg" />
            <Readout
              label="Provided Asv/sv"
              value={`${fmtN(provided, 3)} mm²/mm`}
              title={`${layout.effectiveLegs} legs × ${fmtN(singleLeg, 1)} mm² / ${fmtN(settings.linkSpacing, 0)} mm`}
            />
            <Readout
              label="Required Asv/sv"
              value={required === null ? '—' : `${fmtN(required, 3)} mm²/mm`}
              title="Governing requirement of the selected code (shear requirement or minimum links)"
            />
            <Readout
              label="Minimum links"
              value={required === null ? '—' : minOk ? 'satisfied' : 'not satisfied'}
              className={required === null ? '' : minOk ? 'text-ok' : 'text-bad'}
              title="The provided legs must also meet the code's minimum shear reinforcement"
            />
          </div>

          {validation.errors.length > 0 && (
            <Banner tone="error">
              <b className="font-display text-[10px] uppercase tracking-[0.07em]">
                {validation.errors.length} correction{validation.errors.length === 1 ? '' : 's'} required
              </b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.errors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Banner>
          )}
          {validation.warnings.length > 0 && (
            <Banner tone="warn">
              <b className="font-display text-[10px] uppercase tracking-[0.07em]">
                {validation.warnings.length} item{validation.warnings.length === 1 ? '' : 's'} to verify
              </b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.warnings.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Banner>
          )}
          {validation.errors.length === 0 && validation.warnings.length === 0 && (
            <Banner tone="ok">
              Restraint, ring fit and member spacing are within the detailing limits of the selected code
              {validation.unrestrained.length === 0 ? ' — every longitudinal bar is restrained.' : '.'}
            </Banner>
          )}

          {layout.notes.length > 0 && (
            <ul className={`flex flex-col gap-0.5 ${noteSmCls}`}>
              {layout.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              <li>
                Restraint limit {fmtN(RESTRAINT_LIMIT, 0)} mm, minimum clear spacing between members{' '}
                {fmtN(Math.max(25, settings.linkDia), 0)} mm (selected code).
              </li>
            </ul>
          )}
        </div>
      </div>
    </Card>
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
