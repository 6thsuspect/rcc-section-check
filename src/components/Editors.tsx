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
import { Card, NumField } from './ui'
import { PasteReinforcement } from './PasteReinforcement'

const cellCls =
  'w-full border border-edge rounded px-1.5 py-0.5 text-[12.5px] tnum bg-card focus:outline-none focus:border-accent'
const btnCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-edge-strong rounded px-2 py-1 text-ink-2 hover:border-accent hover:text-accent'

export function CodeMaterialsPanel({
  state,
  update,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
}) {
  const spec = CODES[state.code]
  return (
    <Card title="Design code & materials">
      <div className="flex gap-1.5 mb-3">
        {(Object.keys(CODES) as (keyof typeof CODES)[]).map((id) => (
          <button
            key={id}
            className={`flex-1 font-display text-[12px] font-semibold rounded border px-2 py-1.5 ${
              state.code === id
                ? 'border-accent bg-accent-wash text-accent-strong'
                : 'border-edge text-ink-2 hover:border-edge-strong'
            }`}
            onClick={() => {
              const s = CODES[id]
              const patch: Partial<AppState> = { code: id }
              if (!s.concreteGrades.includes(state.fck)) patch.fck = s.concreteGrades.includes(30) ? 30 : s.concreteGrades[0]
              if (!s.steelGrades.some((g) => g.label === state.steelGrade)) patch.steelGrade = 'Fe500'
              update(patch)
            }}
          >
            {id === 'IS456' ? 'IS 456' : id === 'IRC112' ? 'IRC 112' : 'IRS CBC'}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-3 mb-3">{spec.name} — {spec.edition}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-3 font-display tracking-wide">Concrete grade</span>
          <select
            className={cellCls}
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
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-3 font-display tracking-wide">Steel grade (IS 1786)</span>
          <select
            className={cellCls}
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
        <NumField label="Clear cover" unit="mm" value={state.cover} min={20} onChange={(v) => update({ cover: v })} />
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
      <p className="text-[11px] text-ink-3 mt-2.5">
        γc = {spec.gammaC}, γs = {spec.gammaS}. Loads are entered already factored; material factors are applied
        internally by the stress blocks.
      </p>
    </Card>
  )
}

export function SectionPanel({
  state,
  update,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
}) {
  const [shape, setShape] = useState<PredefinedSection>(state.predefined ?? defaultPredefined('rect'))
  const [loop, setLoop] = useState(0) // 0 = boundary, 1.. = void index+1

  const apply = (def: PredefinedSection) => {
    const gen = generateSection(def, { cover: state.cover, tieDia: state.tieDia, barDia: state.barDia })
    update({ geometry: gen.geometry, bars: gen.bars, predefined: def, shapeClass: gen.shapeClass })
  }

  const poly = loop === 0 ? state.geometry.boundary : state.geometry.voids[loop - 1]
  const setPoly = (p: { x: number; y: number }[]) => {
    const geometry: SectionGeometry =
      loop === 0
        ? { ...state.geometry, boundary: p }
        : { ...state.geometry, voids: state.geometry.voids.map((v, i) => (i === loop - 1 ? p : v)) }
    update({ geometry, predefined: null })
  }

  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

  return (
    <Card title="Section geometry">
      <div className="flex flex-wrap gap-1 mb-2">
        {(Object.keys(SHAPE_LABELS) as PredefinedSection['kind'][]).map((k) => (
          <button
            key={k}
            className={`font-display text-[11px] font-semibold rounded border px-1.5 py-1 ${
              shape.kind === k ? 'border-accent bg-accent-wash text-accent-strong' : 'border-edge text-ink-2'
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

      <ShapeParams shape={shape} onChange={(def) => { setShape(def); apply(def) }} barDia={state.barDia} setBarDia={(v) => update({ barDia: v })} />

      <div className="flex items-center justify-between mt-4 mb-1.5">
        <span className="text-[11px] text-ink-3 font-display tracking-wide uppercase">
          Boundary coordinates (mm) — {state.predefined ? 'generated, editable' : 'custom'}
        </span>
        {state.geometry.voids.length > 0 && (
          <select className={`${cellCls} !w-auto`} value={loop} onChange={(e) => setLoop(Number(e.target.value))}>
            <option value={0}>outer boundary</option>
            {state.geometry.voids.map((_, i) => (
              <option key={i} value={i + 1}>
                void {i + 1}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto border border-edge rounded">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] font-display uppercase tracking-wider text-ink-3">
              <th className="text-left px-2 py-1">#</th>
              <th className="text-left px-1 py-1">x</th>
              <th className="text-left px-1 py-1">y</th>
              <th className="px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {poly.map((p, i) => (
              <tr key={i} className="border-t border-edge">
                <td className="px-2 py-0.5 text-ink-3 tnum">{i + 1}</td>
                <td className="px-1 py-0.5">
                  <input className={cellCls} type="number" value={p.x} onChange={(e) => setPoly(poly.map((q, j) => (j === i ? { ...q, x: num(e.target.value) } : q)))} />
                </td>
                <td className="px-1 py-0.5">
                  <input className={cellCls} type="number" value={p.y} onChange={(e) => setPoly(poly.map((q, j) => (j === i ? { ...q, y: num(e.target.value) } : q)))} />
                </td>
                <td className="px-1 py-0.5 text-center">
                  <button className="text-bad text-[13px] leading-none" title="Remove vertex" onClick={() => setPoly(poly.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5">
        <button className={btnCls} onClick={() => setPoly([...poly, { x: 0, y: 0 }])}>+ vertex</button>
      </div>
    </Card>
  )
}

function ShapeParams({
  shape,
  onChange,
  barDia,
  setBarDia,
}: {
  shape: PredefinedSection
  onChange: (s: PredefinedSection) => void
  barDia: number
  setBarDia: (v: number) => void
}) {
  const f = (label: string, key: string, step = 10) => {
    const value = (shape as unknown as Record<string, number>)[key]
    return (
      <NumField
        label={label}
        unit="mm"
        value={value}
        step={step}
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
        onChange={(v) => onChange({ ...shape, [key]: Math.round(v) } as PredefinedSection)}
      />
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {shape.kind === 'rect' && (
        <>
          {f('Width B', 'B')}
          {f('Depth D', 'D')}
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
          {n('Bars/face (x)', 'nx')}
          {n('Side bars (y)', 'ny')}
        </>
      )}
      {shape.kind === 'circle' && (
        <>
          {f('Diameter D', 'D')}
          {n('Bars', 'nBars')}
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
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
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
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
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
        </>
      )}
      {shape.kind === 'angle' && (
        <>
          {f('Leg B', 'B')}
          {f('Leg D', 'D')}
          {f('Thk tw', 'tw')}
          {f('Thk tf', 'tf')}
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
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
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
        </>
      )}
      {shape.kind === 'hollowCircle' && (
        <>
          {f('Outer Do', 'Do')}
          {f('Inner Di', 'Di')}
          {n('Bars', 'nBars')}
          <NumField label="Bar ⌀" unit="mm" value={barDia} onChange={setBarDia} />
          <label className="flex items-end gap-1.5 text-[12px] text-ink-2 pb-1">
            <input
              type="checkbox"
              checked={shape.innerRing}
              onChange={(e) => onChange({ ...shape, innerRing: e.target.checked })}
            />
            inner ring
          </label>
        </>
      )}
    </div>
  )
}

export function RebarPanel({
  bars,
  geometry,
  update,
}: {
  bars: Rebar[]
  geometry?: SectionGeometry
  update: (bars: Rebar[]) => void
}) {
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
  const DIAS = [8, 10, 12, 16, 20, 25, 28, 32, 36, 40]
  return (
    <Card
      title={`Reinforcement bars (${bars.length})`}
      action={
        <span className="flex items-center gap-1.5">
          <PasteReinforcement
            existingBars={bars}
            geometry={geometry}
            onAdd={(newBars) => update([...bars, ...newBars])}
            onReplace={(newBars) => update(newBars)}
            onDeleteBar={(index) => update(bars.filter((_, i) => i !== index))}
            onDeleteAllBars={() => update([])}
          />
          <button className={btnCls} onClick={() => update([...bars, { x: 0, y: 0, dia: 20 }])}>
            + bar
          </button>
        </span>
      }
    >
      <div className="max-h-64 overflow-y-auto border border-edge rounded">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] font-display uppercase tracking-wider text-ink-3">
              <th className="text-left px-2 py-1">#</th>
              <th className="text-left px-1 py-1">x (mm)</th>
              <th className="text-left px-1 py-1">y (mm)</th>
              <th className="text-left px-1 py-1">⌀</th>
              <th className="px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b, i) => (
              <tr key={i} className="border-t border-edge">
                <td className="px-2 py-0.5 text-ink-3 tnum">{i + 1}</td>
                <td className="px-1 py-0.5">
                  <input className={cellCls} type="number" value={b.x} onChange={(e) => update(bars.map((q, j) => (j === i ? { ...q, x: num(e.target.value) } : q)))} />
                </td>
                <td className="px-1 py-0.5">
                  <input className={cellCls} type="number" value={b.y} onChange={(e) => update(bars.map((q, j) => (j === i ? { ...q, y: num(e.target.value) } : q)))} />
                </td>
                <td className="px-1 py-0.5">
                  <select className={cellCls} value={b.dia} onChange={(e) => update(bars.map((q, j) => (j === i ? { ...q, dia: Number(e.target.value) } : q)))}>
                    {DIAS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-0.5 text-center">
                  <button className="text-bad text-[13px] leading-none" title="Remove bar" onClick={() => update(bars.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  return (
    <Card
      title="Load cases (factored)"
      action={
        <button
          className={btnCls}
          onClick={() => update([...cases, { id: newCaseId(), name: `LC${cases.length + 1}`, Pu: 1000, Mux: 100, Muy: 50 }])}
        >
          + case
        </button>
      }
    >
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] font-display uppercase tracking-wider text-ink-3">
            <th className="px-1 py-1" title="Plot focus"></th>
            <th className="text-left px-1 py-1">Name</th>
            <th className="text-left px-1 py-1">Pu (kN)</th>
            <th className="text-left px-1 py-1">Mux (kN·m)</th>
            <th className="text-left px-1 py-1">Muy (kN·m)</th>
            <th className="px-1 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => (
            <tr key={c.id} className="border-t border-edge">
              <td className="px-1 py-0.5 text-center">
                <input type="radio" name="sel-case" checked={selected === c.id} onChange={() => select(c.id)} />
              </td>
              <td className="px-1 py-0.5">
                <input className={cellCls} value={c.name} onChange={(e) => update(cases.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))} />
              </td>
              <td className="px-1 py-0.5">
                <input className={cellCls} type="number" value={c.Pu} onChange={(e) => update(cases.map((q, j) => (j === i ? { ...q, Pu: num(e.target.value) } : q)))} />
              </td>
              <td className="px-1 py-0.5">
                <input className={cellCls} type="number" value={c.Mux} onChange={(e) => update(cases.map((q, j) => (j === i ? { ...q, Mux: num(e.target.value) } : q)))} />
              </td>
              <td className="px-1 py-0.5">
                <input className={cellCls} type="number" value={c.Muy} onChange={(e) => update(cases.map((q, j) => (j === i ? { ...q, Muy: num(e.target.value) } : q)))} />
              </td>
              <td className="px-1 py-0.5 text-center">
                <button className="text-bad text-[13px] leading-none" title="Remove case" onClick={() => update(cases.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-ink-3 mt-2">
        Compression positive. +Mux compresses the +Y face, +Muy the +X face. Moments about centroidal axes;
        include second-order effects upstream for slender members.
      </p>
    </Card>
  )
}

export function specFor(code: AppState['code']): CodeSpec {
  return CODES[code]
}
