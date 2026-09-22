import { useState } from 'react'
import type { LoadCase, Rebar, SectionGeometry } from '../engine/types'
import { CODES, type CodeSpec } from '../engine/codes'
import {
  defaultPredefined,
  generateSection,
  SHAPE_LABELS,
  type PredefinedSection,
} from '../engine/sections'
import type { AppState } from '../state'
import { newCaseId } from '../state'
import { isAutomaticBar, repositionAutomaticBars } from '../engine/reinforcement'
import {
  Banner,
  Card,
  cellCls,
  DiameterField,
  Icon,
  InfoTooltip,
  NumField,
  noteCls,
  Readout,
  SegButton,
  SegGroup,
  selectCls,
  selectInlineCls,
  STANDARD_BAR_DIAMETERS,
  SubCard,
  tblCls,
  tdCls,
  thCls,
  rowDelCls,
  btnCls,
  btnDangerCls,
  codeChipCls,
} from './ui'

export function CodeMaterialsPanel({
  state,
  update,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
}) {
  const spec = CODES[state.code]
  return (
    <Card title="Design code & materials" subtitle="governs the checks and stress blocks">
      <SegGroup className="mb-1">
        {(Object.keys(CODES) as (keyof typeof CODES)[]).map((id) => (
          <SegButton
            key={id}
            active={state.code === id}
            title={`${CODES[id].name} — ${CODES[id].edition}`}
            onClick={() => {
              const s = CODES[id]
              const patch: Partial<AppState> = { code: id }
              if (!s.concreteGrades.includes(state.fck)) patch.fck = s.concreteGrades.includes(30) ? 30 : s.concreteGrades[0]
              if (!s.steelGrades.some((g) => g.label === state.steelGrade)) patch.steelGrade = 'Fe500'
              update(patch)
            }}
          >
            {id === 'IS456' ? 'IS 456' : id === 'IRC112' ? 'IRC 112' : 'IRS CBC'}
          </SegButton>
        ))}
      </SegGroup>
      <p className="mb-3 text-[11px] leading-snug text-ink-2">
        {spec.name} — {spec.edition}
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Concrete grade
          </span>
          <select
            className={selectCls}
            value={state.fck}
            onChange={(e) => update({ fck: Number(e.target.value) })}
          >
            {spec.concreteGrades.map((g) => (
              <option key={g} value={g}>
                M{g}
                {spec.gradeWarnAbove && g > spec.gradeWarnAbove ? ' ⚠' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Steel grade (IS 1786)
          </span>
          <select
            className={selectCls}
            value={state.steelGrade}
            onChange={(e) => update({ steelGrade: e.target.value })}
          >
            {spec.steelGrades.map((g) => (
              <option key={g.label} value={g.label}>
                {g.label} ({g.fy} MPa)
              </option>
            ))}
          </select>
        </label>
        <NumField label="Tie / link dia" unit="mm" value={state.tieDia} min={6} onChange={(v) => update({ tieDia: v })} />
        <NumField
          label="Unsupported length (0 = n/a)"
          unit="mm"
          value={state.memberLength}
          min={0}
          step={100}
          onChange={(v) => update({ memberLength: v })}
        />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <Readout label="Partial factor γc" value={`${spec.gammaC} concrete`} />
        <Readout label="Partial factor γs" value={`${spec.gammaS} steel`} />
      </div>
      <p className={`${noteCls} mt-2`}>
        Loads are entered already factored; material factors are applied internally by the stress blocks.
      </p>
    </Card>
  )
}

export function SectionPanel({
  state,
  update,
  onBarDiaCustomizeChange,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  onBarDiaCustomizeChange?: (enabled: boolean) => void
}) {
  const [shape, setShape] = useState<PredefinedSection>(state.predefined ?? defaultPredefined('rect'))
  const [loop, setLoop] = useState(0) // 0 = boundary, 1.. = void index+1
  const [frozen, setFrozen] = useState(false)

  const apply = (def: PredefinedSection, opts?: { keepBars?: boolean }) => {
    if (frozen) return
    const gen = generateSection(def, { cover: state.cover, tieDia: state.tieDia, barDia: state.barDia })
    // Circular sections own their bar layout via CircularRebarPanel — keep existing
    // bars when only geometry params change so arrangement settings are not wiped.
    const isCirc = def.kind === 'circle' || def.kind === 'hollowCircle'
    const hasManualBars = state.bars.some((bar) => !isAutomaticBar(bar))
    const hasAutomaticDiameterOverride = state.bars.some(
      (bar) => isAutomaticBar(bar) && Math.abs(bar.dia - state.barDia) > 1e-9,
    )
    const keepBars =
      opts?.keepBars ??
      (hasManualBars ||
        hasAutomaticDiameterOverride ||
        (isCirc && state.predefined?.kind === def.kind && state.bars.length > 0))
    update({
      geometry: gen.geometry,
      bars: keepBars
        ? repositionAutomaticBars(state.bars, state.geometry, gen.geometry, state.cover, state.cover, state.tieDia, state.tieDia)
        : gen.bars,
      predefined: def,
      shapeClass: gen.shapeClass,
    })
  }

  const poly = loop === 0 ? state.geometry.boundary : state.geometry.voids[loop - 1]
  const setPoly = (p: { x: number; y: number }[]) => {
    if (frozen) return
    const geometry: SectionGeometry =
      loop === 0
        ? { ...state.geometry, boundary: p }
        : { ...state.geometry, voids: state.geometry.voids.map((v, i) => (i === loop - 1 ? p : v)) }
    update({ geometry, predefined: null })
  }

  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

  return (
    <Card
      title="Section geometry"
      subtitle={state.predefined ? `${SHAPE_LABELS[state.predefined.kind]} · parametric` : 'custom boundary'}
      action={
        <button
          type="button"
          onClick={() => setFrozen(!frozen)}
          className={frozen ? btnDangerCls : btnCls}
          title={frozen ? 'Section geometry is frozen (click to unfreeze)' : 'Freeze section geometry to prevent changes'}
        >
          <Icon name={frozen ? 'lock' : 'unlock'} size={12} />
          <span>{frozen ? 'Frozen' : 'Freeze'}</span>
        </button>
      }
    >
      <div
        className={`flex flex-col gap-2.5 transition-opacity duration-200 ease-ui ${
          frozen ? 'pointer-events-none opacity-60 select-none' : ''
        }`}
      >
        <div className="flex flex-wrap gap-1">
          {(Object.keys(SHAPE_LABELS) as PredefinedSection['kind'][]).map((k) => (
            <button
              key={k}
              disabled={frozen}
              aria-pressed={shape.kind === k}
              className={`rounded-field border px-2 py-[5px] font-display text-[11px] font-semibold leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-ui disabled:pointer-events-none disabled:opacity-45 ${
                shape.kind === k
                  ? 'border-accent bg-accent-wash text-accent-strong shadow-[inset_0_-2px_0_rgb(37_106_191/0.35)]'
                  : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel hover:text-ink'
              }`}
              onClick={() => {
                const def = defaultPredefined(k)
                setShape(def)
                apply(def)
                setLoop(0)
              }}
            >
              {SHAPE_LABELS[k]}
            </button>
          ))}
        </div>

        <ShapeParams
          shape={shape}
          disabled={frozen}
          onChange={(def) => {
            setShape(def)
            apply(def)
          }}
          barDia={state.barDia}
          setBarDia={(v) => {
            if (frozen) return
            update({
              barDia: v,
              bars: state.bars.map((bar) => ({ ...bar, dia: v })),
            })
          }}
          onBarDiaCustomizeChange={onBarDiaCustomizeChange}
        />

        <div className="mb-1.5 mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
          <span className="flex items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-[0.07em] text-ink-2">
            <Icon name="ruler" size={12} className="text-ink-3" />
            <span>Boundary coordinates (mm)</span>
            <span className="font-body text-[10px] font-normal normal-case tracking-normal text-ink-3">
              {state.predefined ? 'generated, editable' : 'custom'}
            </span>
            {frozen && <span className="font-semibold lowercase text-bad">(frozen)</span>}
          </span>
          {state.geometry.voids.length > 0 && (
            <select
              className={selectInlineCls}
              value={loop}
              disabled={frozen}
              onChange={(e) => setLoop(Number(e.target.value))}
            >
              <option value={0}>outer boundary</option>
              {state.geometry.voids.map((_, i) => (
                <option key={i} value={i + 1}>
                  void {i + 1}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="max-h-56 overflow-auto rounded-lg border border-line">
          <table className={tblCls}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-panel/95 backdrop-blur-sm border-b border-edge">
                <th className={`${thCls} w-9 text-left`}>#</th>
                <th className={`${thCls} text-left`}>x</th>
                <th className={`${thCls} text-left`}>y</th>
                <th className={`${thCls} w-8`}></th>
              </tr>
            </thead>
            <tbody>
              {poly.map((p, i) => (
                <tr key={i} className="border-t border-line transition-colors duration-150 hover:bg-panel/60">
                  <td className={`${tdCls} font-mono text-[11px] text-ink-3`}>{i + 1}</td>
                  <td className={tdCls}>
                    <input
                      className={cellCls}
                      type="number"
                      value={p.x}
                      disabled={frozen}
                      onChange={(e) => setPoly(poly.map((q, j) => (j === i ? { ...q, x: num(e.target.value) } : q)))}
                    />
                  </td>
                  <td className={tdCls}>
                    <input
                      className={cellCls}
                      type="number"
                      value={p.y}
                      disabled={frozen}
                      onChange={(e) => setPoly(poly.map((q, j) => (j === i ? { ...q, y: num(e.target.value) } : q)))}
                    />
                  </td>
                  <td className={`${tdCls} text-center`}>
                    <button
                      className={`${rowDelCls} mx-auto`}
                      title="Remove vertex"
                      disabled={frozen}
                      onClick={() => setPoly(poly.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <button className={btnCls} disabled={frozen} onClick={() => setPoly([...poly, { x: 0, y: 0 }])}>
            <Icon name="plus" size={12} />
            <span>Vertex</span>
          </button>
          {frozen && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-bad">
              <Icon name="lock" size={11} />
              Section geometry is locked
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

function ShapeParams({
  shape,
  onChange,
  barDia,
  setBarDia,
  onBarDiaCustomizeChange,
  disabled,
}: {
  shape: PredefinedSection
  onChange: (s: PredefinedSection) => void
  barDia: number
  setBarDia: (v: number) => void
  onBarDiaCustomizeChange?: (enabled: boolean) => void
  disabled?: boolean
}) {
  const f = (label: string, key: string, step = 10) => {
    const value = (shape as unknown as Record<string, number>)[key]
    return (
      <NumField
        label={label}
        unit="mm"
        value={value}
        step={step}
        disabled={disabled}
        onChange={(v) => onChange({ ...shape, [key]: v } as PredefinedSection)}
      />
    )
  }
  const n = (label: string, key: string) => {
    const value = (shape as unknown as Record<string, number>)[key]
    return (
      <NumField
        label={label}
        value={value}
        step={1}
        min={0}
        disabled={disabled}
        onChange={(v) => onChange({ ...shape, [key]: Math.round(v) } as PredefinedSection)}
      />
    )
  }
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-3">
      {shape.kind === 'rect' && (
        <>
          {f('Width B', 'B')}
          {f('Depth D', 'D')}
          <DiameterField
            label="Bar ⌀"
            value={barDia}
            disabled={disabled}
            onChange={setBarDia}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
          {n('Bars/face (x)', 'nx')}
          {n('Side bars (y)', 'ny')}
        </>
      )}
      {shape.kind === 'circle' && (
        <>
          {f('Diameter D', 'D')}
          <p className="col-span-2 flex items-start gap-1.5 self-end pb-1 text-[10.5px] leading-snug text-ink-2">
            <Icon name="info" size={12} className="mt-px shrink-0 text-ink-3" />
            <span>Reinforcement layout is configured in the <b className="font-semibold text-ink">Circular reinforcement</b> panel below.</span>
          </p>
        </>
      )}
      {shape.kind === 'tee' && (
        <>
          {f('Flange bf', 'bf')}
          {f('Flange tf', 'tf')}
          {f('Web bw', 'bw')}
          {f('Depth D', 'D')}
          {n('Flange bars', 'nFlange')}
          {n('Web bars', 'nWeb')}
          <DiameterField
            label="Bar ⌀"
            value={barDia}
            disabled={disabled}
            onChange={setBarDia}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
        </>
      )}
      {shape.kind === 'ishape' && (
        <>
          {f('Top bf₁', 'bf1')}
          {f('Top tf₁', 'tf1')}
          {f('Bot bf₂', 'bf2')}
          {f('Bot tf₂', 'tf2')}
          {f('Web tw', 'tw')}
          {f('Depth D', 'D')}
          {n('Flange bars', 'nFlange')}
          {n('Web bars', 'nWeb')}
          <DiameterField
            label="Bar ⌀"
            value={barDia}
            disabled={disabled}
            onChange={setBarDia}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
        </>
      )}
      {shape.kind === 'angle' && (
        <>
          {f('Leg B', 'B')}
          {f('Leg D', 'D')}
          {f('Thk tw', 'tw')}
          {f('Thk tf', 'tf')}
          <DiameterField
            label="Bar ⌀"
            value={barDia}
            disabled={disabled}
            onChange={setBarDia}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
        </>
      )}
      {shape.kind === 'box' && (
        <>
          {f('Outer B', 'B')}
          {f('Outer D', 'D')}
          {f('Wall tw', 'tw')}
          {f('Wall tf', 'tf')}
          {n('Bars/face (x)', 'nx')}
          {n('Side bars (y)', 'ny')}
          <DiameterField
            label="Bar ⌀"
            value={barDia}
            disabled={disabled}
            onChange={setBarDia}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
        </>
      )}
      {shape.kind === 'hollowCircle' && (
        <>
          {f('Outer Do', 'Do')}
          {f('Inner Di', 'Di')}
          <p className="col-span-1 flex items-start gap-1.5 self-end pb-1 text-[10.5px] leading-snug text-ink-2">
            <Icon name="info" size={12} className="mt-px shrink-0 text-ink-3" />
            <span>Use the <b className="font-semibold text-ink">Circular reinforcement</b> panel — choose <b className="font-semibold text-ink">Layered</b> for an inner ring.</span>
          </p>
        </>
      )}
    </div>
  )
}

/** Append / replace choice for the paste-into-table behaviour. */
function PasteMode({
  mode,
  onMode,
  groupName,
  replaceHint,
}: {
  mode: 'append' | 'replace'
  onMode: (m: 'append' | 'replace') => void
  groupName: string
  replaceHint: string
}) {
  const opt = (v: 'append' | 'replace', text: string) => (
    <label
      className={`flex cursor-pointer items-center gap-1.5 rounded-field border px-2 py-1 text-[11px] transition-[background-color,border-color,color] duration-150 ease-ui ${
        mode === v
          ? v === 'replace'
            ? 'border-bad/35 bg-bad/8 text-bad'
            : 'border-accent/45 bg-accent-wash text-accent-strong'
          : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel'
      }`}
    >
      <input
        type="radio"
        name={groupName}
        value={v}
        checked={mode === v}
        onChange={() => onMode(v)}
        className="h-3 w-3 cursor-pointer accent-accent"
      />
      <span className={mode === v ? 'font-semibold' : ''}>{text}</span>
    </label>
  )
  return (
    <SubCard
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="cursor" size={12} className="text-ink-3" />
          Paste from Excel
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {opt('append', 'Append on paste')}
        {opt('replace', 'Replace all on paste')}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
        Copy cells and press{' '}
        <code className={codeChipCls}>Ctrl+V</code>{' '}
        anywhere in the table — rows are added automatically. {replaceHint}
      </p>
    </SubCard>
  )
}

/** Result of the explicit Validate action. */
function ValidateBanner({
  status,
  noun,
}: {
  status:
    | { kind: 'idle' }
    | { kind: 'ok'; count: number }
    | { kind: 'empty'; message: string }
    | { kind: 'errors'; errors: { line: number; message: string }[] }
  noun: string
}) {
  if (status.kind === 'idle') return null
  if (status.kind === 'ok') {
    return (
      <Banner tone="ok">
        <b className="font-display text-[10px] uppercase tracking-[0.07em]">Valid</b>
        <span className="ml-1.5">
          {status.count} {noun}
          {status.count === 1 ? '' : 's'} configured.
        </span>
      </Banner>
    )
  }
  if (status.kind === 'empty') return <Banner tone="info">{status.message}</Banner>
  return (
    <Banner tone="error">
      <b className="font-display text-[10px] uppercase tracking-[0.07em]">
        {status.errors.length} invalid {noun}
        {status.errors.length === 1 ? '' : 's'}
      </b>
      <ul className="mt-0.5 max-h-20 space-y-px overflow-y-auto font-mono text-[11px] tnum">
        {status.errors.map((err, i) => (
          <li key={i}>
            Row {err.line}: {err.message}
          </li>
        ))}
      </ul>
    </Banner>
  )
}

export function RebarPanel({
  bars,
  update,
  customizeBarDiameter,
}: {
  bars: Rebar[]
  update: (bars: Rebar[]) => void
  customizeBarDiameter: boolean
}) {
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
  const DIAS = STANDARD_BAR_DIAMETERS
  const diameterOptions = (value: number) =>
    DIAS.includes(value) ? DIAS : [...DIAS, value].sort((a, b) => a - b)

  const [pasteMode, setPasteMode] = useState<'append' | 'replace'>('append')
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; count: number }
    | { kind: 'empty'; message: string }
    | { kind: 'errors'; errors: { line: number; message: string }[] }
  >({ kind: 'idle' })

  // Excel paste handler that automatically expands rows and populates values
  const handleExcelPaste = (e: React.ClipboardEvent) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText) return

    const lines = rawText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) return

    e.preventDefault()

    const pastedBars: Rebar[] = []
    for (const line of lines) {
      const parts = line.split(/[\t,]+/).map((p) => p.trim())
      if (parts.length >= 2) {
        const x = Number(parts[0])
        const y = Number(parts[1])
        const dia = Number(parts[2] ?? 20)
        pastedBars.push({
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          dia: Number.isFinite(dia) && dia > 0 ? dia : 20,
        })
      }
    }

    if (pastedBars.length > 0) {
      if (pasteMode === 'replace') {
        update(pastedBars)
      } else {
        update([...bars, ...pastedBars])
      }
      setStatus({ kind: 'ok', count: pastedBars.length })
    }
  }

  const validate = () => {
    if (bars.length === 0) {
      setStatus({ kind: 'empty', message: 'No reinforcement bars defined — paste Excel rows or add a bar.' })
      return
    }

    const errs: { line: number; message: string }[] = []
    bars.forEach((b, i) => {
      if (!Number.isFinite(b.x)) errs.push({ line: i + 1, message: 'X Coordinate must be numeric' })
      if (!Number.isFinite(b.y)) errs.push({ line: i + 1, message: 'Y Coordinate must be numeric' })
      if (!Number.isFinite(b.dia) || b.dia <= 0) errs.push({ line: i + 1, message: 'Bar Diameter must be greater than zero' })
    })

    if (errs.length > 0) setStatus({ kind: 'errors', errors: errs })
    else setStatus({ kind: 'ok', count: bars.length })
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="bars" size={13} className="text-ink-3" />
          <span>Reinforcement bars</span>
          <InfoTooltip
            content={
              <span>
                Copy cells directly from <b>Excel</b> and paste (
                <code className={codeChipCls}>Ctrl+V</code>
                ) anywhere into the table below. The table will <b>automatically add rows</b> and populate X, Y, and Bar Dia.
              </span>
            }
          />
        </span>
      }
      subtitle={`${bars.length} bar${bars.length === 1 ? '' : 's'} in the table${bars.some(isAutomaticBar) ? ` · ${bars.filter(isAutomaticBar).length} automatic` : ''}`}
      action={
        <button className={btnCls} onClick={() => update([...bars, { x: 0, y: 0, dia: 20 }])}>
          <Icon name="plus" size={12} />
          <span>Bar</span>
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <PasteMode mode={pasteMode} onMode={setPasteMode} groupName="tabPasteMode" replaceHint="" />
        {/* 3-Column Interactive Excel Table */}
        <div
          className="max-h-64 overflow-auto rounded-lg border border-line focus:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/12"
          onPaste={handleExcelPaste}
          tabIndex={0}
          title="Paste Excel cells directly into this table (Ctrl+V / Cmd+V) — rows will auto-expand"
        >
          <table className={tblCls}>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-edge bg-panel/95 backdrop-blur-sm">
                <th className={`${thCls} w-9 text-left`}>#</th>
                <th className={`${thCls} text-left`}>
                  X coordinate <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">x</code>
                </th>
                <th className={`${thCls} text-left`}>
                  Y coordinate <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">y</code>
                </th>
                <th className={`${thCls} text-left`}>
                  Bar diameter <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">⌀</code>
                </th>
                <th className={`${thCls} w-9`}></th>
              </tr>
            </thead>
            <tbody>
              {bars.length > 0 ? (
                bars.map((b, i) => (
                  <tr key={i} className="border-t border-line transition-colors duration-150 hover:bg-panel/60">
                    <td className={`${tdCls} font-mono text-[11px] text-ink-3`}>{i + 1}</td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        type="number"
                        value={b.x}
                        placeholder="0"
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            bars.map((q, j) =>
                              j === i ? { ...q, x: num(e.target.value), positioning: 'manual' as const } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        type="number"
                        value={b.y}
                        placeholder="0"
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            bars.map((q, j) =>
                              j === i ? { ...q, y: num(e.target.value), positioning: 'manual' as const } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={tdCls}>
                      {customizeBarDiameter ? (
                        <input
                          className={cellCls}
                          type="number"
                          value={b.dia}
                          min={0.0001}
                          step={0.0001}
                          aria-label={`Bar ${i + 1} diameter (custom)`}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value)
                            if (!Number.isFinite(raw) || raw <= 0) return
                            const dia = Math.max(0.0001, Math.round(raw * 10000) / 10000)
                            setStatus({ kind: 'idle' })
                            update(
                              bars.map((q, j) =>
                                j === i ? { ...q, dia } : q
                              )
                            )
                          }}
                        />
                      ) : (
                        <select
                          className={`${cellCls} sel pr-5`}
                          value={b.dia}
                          onChange={(e) => {
                            setStatus({ kind: 'idle' })
                            update(
                              bars.map((q, j) =>
                                j === i ? { ...q, dia: Number(e.target.value) } : q
                              )
                            )
                          }}
                        >
                          {diameterOptions(b.dia).map((d) => (
                            <option key={d} value={d}>
                              ⌀ {d} mm{DIAS.includes(d) ? '' : ' (custom)'}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <button
                        className={`${rowDelCls} mx-auto`}
                        title="Remove bar"
                        onClick={() => {
                          setStatus({ kind: 'idle' })
                          update(bars.filter((_, j) => j !== i))
                        }}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-7 text-center text-[11.5px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="plus" size={13} className="text-ink-3" />
                      No bars yet — add a row below, or paste rows from Excel with <b>Ctrl+V</b>.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ValidateBanner status={status} noun="bar" />

        {/* Table Toolbar & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button className={btnCls} onClick={validate}>
              <Icon name="shield" size={12} />
              <span>Validate</span>
            </button>
            <button className={btnCls} onClick={() => { setStatus({ kind: 'idle' }); update([...bars, { x: 0, y: 0, dia: 20 }]) }}>
              <Icon name="plus" size={12} />
              <span>Add row</span>
            </button>
            {bars.length > 0 && (
              <button
                type="button"
                className={btnDangerCls}
                onClick={() => {
                  if (confirm('Are you sure you want to clear all reinforcement bars?')) {
                    setStatus({ kind: 'idle' })
                    update([])
                  }
                }}
              >
                <Icon name="close" size={12} />
                <span>Clear table</span>
              </button>
            )}
          </div>
          <span className="font-mono text-[11px] text-ink-3 tnum">
            {bars.length} {bars.length === 1 ? 'bar' : 'bars'}
          </span>
        </div>
      </div>
    </Card>
  )
}

export function LoadCasesPanel({
  cases,
  selected,
  update,
  select,
}: {
  cases: LoadCase[]
  selected: string | null
  update: (cases: LoadCase[]) => void
  select: (id: string) => void
}) {
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

  const [pasteMode, setPasteMode] = useState<'append' | 'replace'>('append')
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; count: number }
    | { kind: 'empty'; message: string }
    | { kind: 'errors'; errors: { line: number; message: string }[] }
  >({ kind: 'idle' })

  // Excel paste handler that automatically expands rows and populates 4 columns
  const handleExcelPaste = (e: React.ClipboardEvent) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText) return

    const lines = rawText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) return

    e.preventDefault()

    const pastedCases: LoadCase[] = []
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[\t,]+/).map((p) => p.trim())
      if (parts.length >= 3) {
        let name = `LC${pastedCases.length + (pasteMode === 'append' ? cases.length : 0) + 1}`
        let puVal = 0
        let muxVal = 0
        let muyVal = 0

        if (parts.length >= 4) {
          name = parts[0] || name
          puVal = Number(parts[1])
          muxVal = Number(parts[2])
          muyVal = Number(parts[3])
        } else {
          puVal = Number(parts[0])
          muxVal = Number(parts[1])
          muyVal = Number(parts[2])
        }

        pastedCases.push({
          id: newCaseId(),
          name,
          Pu: Number.isFinite(puVal) ? puVal : 1000,
          Mux: Number.isFinite(muxVal) ? muxVal : 0,
          Muy: Number.isFinite(muyVal) ? muyVal : 0,
        })
      }
    }

    if (pastedCases.length > 0) {
      if (pasteMode === 'replace') {
        update(pastedCases)
        if (pastedCases[0]) select(pastedCases[0].id)
      } else {
        const nextCases = [...cases, ...pastedCases]
        update(nextCases)
        if (!selected && nextCases[0]) select(nextCases[0].id)
      }
      setStatus({ kind: 'ok', count: pastedCases.length })
    }
  }

  const validate = () => {
    if (cases.length === 0) {
      setStatus({ kind: 'empty', message: 'No load cases defined — paste Excel rows or add a load case.' })
      return
    }

    const errs: { line: number; message: string }[] = []
    cases.forEach((c, i) => {
      if (!c.name || c.name.trim() === '') errs.push({ line: i + 1, message: 'Load case name cannot be empty' })
      if (!Number.isFinite(c.Pu)) errs.push({ line: i + 1, message: 'Pu must be numeric' })
      if (!Number.isFinite(c.Mux)) errs.push({ line: i + 1, message: 'Mux must be numeric' })
      if (!Number.isFinite(c.Muy)) errs.push({ line: i + 1, message: 'Muy must be numeric' })
    })

    if (errs.length > 0) setStatus({ kind: 'errors', errors: errs })
    else setStatus({ kind: 'ok', count: cases.length })
  }

  const addCase = () => {
    setStatus({ kind: 'idle' })
    const newCase = {
      id: newCaseId(),
      name: `LC${cases.length + 1}`,
      Pu: 1000,
      Mux: 100,
      Muy: 50,
    }
    const nextCases = [...cases, newCase]
    update(nextCases)
    if (!selected) select(newCase.id)
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="layers" size={13} className="text-ink-3" />
          <span>Load cases</span>
          <InfoTooltip
            content={
              <span>
                Copy cells directly from <b>Excel</b> and paste (
                <code className={codeChipCls}>Ctrl+V</code>
                ) anywhere into the table below. The table will <b>automatically add rows</b> and populate Name, Pu, Mux, and Muy.
              </span>
            }
          />
        </span>
      }
      subtitle="factored ULS actions"
      action={
        <button className={btnCls} onClick={addCase}>
          <Icon name="plus" size={12} />
          <span>Case</span>
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <PasteMode
          mode={pasteMode}
          onMode={setPasteMode}
          groupName="casePasteMode"
          replaceHint="Four columns (Name, Pu, Mux, Muy) or three (Pu, Mux, Muy)."
        />
        {/* 4-Column Interactive Excel Table */}
        <div
          className="max-h-64 overflow-auto rounded-lg border border-line focus:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/12"
          onPaste={handleExcelPaste}
          tabIndex={0}
          title="Paste 4 Excel columns directly into this table (Name, Pu, Mux, Muy) — rows will auto-expand"
        >
          <table className={tblCls}>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-edge bg-panel/95 backdrop-blur-sm">
                <th className={`${thCls} w-7`} title="Plot focus">
                  <span className="sr-only">Focus</span>
                </th>
                <th className={`${thCls} text-left`}>Name</th>
                <th className={`${thCls} text-left`}>
                  Pu <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">kN</code>
                </th>
                <th className={`${thCls} text-left`}>
                  Mux <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">kN·m</code>
                </th>
                <th className={`${thCls} text-left`}>
                  Muy <code className="font-mono text-[10px] font-normal normal-case tracking-normal text-accent">kN·m</code>
                </th>
                <th className={`${thCls} w-9`}></th>
              </tr>
            </thead>
            <tbody>
              {cases.length > 0 ? (
                cases.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`border-t border-line transition-colors duration-150 hover:bg-panel/60 ${
                      selected === c.id ? 'bg-accent-wash/60 shadow-rowmark' : ''
                    }`}
                  >
                    <td className={`${tdCls} text-center`}>
                      <input
                        type="radio"
                        name="sel-case"
                        checked={selected === c.id}
                        onChange={() => select(c.id)}
                        aria-label={`Focus ${c.name}`}
                        className="h-3 w-3 cursor-pointer accent-accent"
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        value={c.name}
                        placeholder={`LC${i + 1}`}
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            cases.map((q, j) =>
                              j === i ? { ...q, name: e.target.value } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        type="number"
                        value={c.Pu}
                        placeholder="1000"
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            cases.map((q, j) =>
                              j === i ? { ...q, Pu: num(e.target.value) } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        type="number"
                        value={c.Mux}
                        placeholder="100"
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            cases.map((q, j) =>
                              j === i ? { ...q, Mux: num(e.target.value) } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={cellCls}
                        type="number"
                        value={c.Muy}
                        placeholder="50"
                        onChange={(e) => {
                          setStatus({ kind: 'idle' })
                          update(
                            cases.map((q, j) =>
                              j === i ? { ...q, Muy: num(e.target.value) } : q
                            )
                          )
                        }}
                        onPaste={handleExcelPaste}
                      />
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <button
                        className={`${rowDelCls} mx-auto`}
                        title="Remove load case"
                        onClick={() => {
                          setStatus({ kind: 'idle' })
                          const filtered = cases.filter((_, j) => j !== i)
                          update(filtered)
                          if (selected === c.id && filtered.length > 0) {
                            select(filtered[0].id)
                          }
                        }}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-7 text-center text-[11.5px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="plus" size={13} className="text-ink-3" />
                      No load cases yet — add one below, or paste rows from Excel with <b>Ctrl+V</b>.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ValidateBanner status={status} noun="case" />

        {/* Table Toolbar & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button className={btnCls} onClick={validate}>
              <Icon name="shield" size={12} />
              <span>Validate</span>
            </button>
            <button className={btnCls} onClick={addCase}>
              <Icon name="plus" size={12} />
              <span>Add case</span>
            </button>
            {cases.length > 0 && (
              <button
                type="button"
                className={btnDangerCls}
                onClick={() => {
                  if (confirm('Are you sure you want to clear all load cases?')) {
                    setStatus({ kind: 'idle' })
                    update([])
                  }
                }}
              >
                <Icon name="close" size={12} />
                <span>Clear cases</span>
              </button>
            )}
          </div>
          <span className="font-mono text-[11px] text-ink-3 tnum">
            {cases.length} {cases.length === 1 ? 'case' : 'cases'}
          </span>
        </div>
      </div>
      <p className={`${noteCls} mt-2.5`}>
        Compression positive (+Pu). +Mux compresses the +Y face, +Muy compresses the +X face. Moments are about the
        centroidal axes of the section.
      </p>
    </Card>
  )
}

export function specFor(code: AppState['code']): CodeSpec {
  return CODES[code]
}
