import type { LoadCase } from '../engine/types'
import type { DesignCodeId } from '../engine/types'
import type { CrackWidthResult, CrackWidthSettings } from '../engine/crackWidth'
import { EXPOSURE_OPTIONS, clauseFor, wMaxFor } from '../engine/crackWidth'
import { fmtN } from '../state'
import { Card, Chip, Readout, SegButton, SegGroup, noteCls, selectCls, tblCls, tdCls, thCls } from './ui'

const numCls = 'text-right'

/** PASS/FAIL chip driven by a boolean. */
function Verdict({ ok }: { ok: boolean }) {
  return <Chip status={ok ? 'pass' : 'fail'} />
}

/** A ratio cell coloured by whether it exceeds 1. */
function RatioCell({ ratio, ok }: { ratio: number; ok: boolean }) {
  return (
    <span className={`font-bold ${ok ? 'text-ok' : 'text-bad'}`} title={ok ? 'within the permissible width' : 'exceeds the permissible width'}>
      {Number.isFinite(ratio) ? fmtN(ratio, 3) : '—'}
    </span>
  )
}

/**
 * Crack-width **input parameters** for the selected code: the exposure class
 * (which sets the permissible width) and the load duration (which sets k_t for
 * IRC:112). Section geometry, cover, bar diameter, effective depth and the
 * tension-steel stress are taken automatically from the shared inputs and the
 * SLS cracked-section analysis, so they are shown read-only, not re-entered.
 */
export function CrackWidthInputsPanel({
  code,
  settings,
  update,
}: {
  code: DesignCodeId
  settings: CrackWidthSettings
  update: (patch: Partial<CrackWidthSettings>) => void
}) {
  const options = EXPOSURE_OPTIONS[code]
  const wmax = wMaxFor(code, settings.exposure)
  return (
    <Card title="Crack width check — inputs" subtitle={clauseFor(code)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Exposure class
          </span>
          <select
            className={selectCls}
            value={settings.exposure}
            onChange={(e) => update({ exposure: e.target.value })}
            aria-label="Exposure class"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-[9.5px] leading-tight text-ink-3">
            Sets the permissible crack width for the selected code.
          </span>
        </label>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
            Load duration
          </span>
          <SegGroup>
            <SegButton active={!settings.longTerm} onClick={() => update({ longTerm: false })} title="Short-term loading — k_t = 0.6 (IRC:112)">
              Short-term
            </SegButton>
            <SegButton active={settings.longTerm} onClick={() => update({ longTerm: true })} title="Long-term loading — k_t = 0.4 (IRC:112)">
              Long-term
            </SegButton>
          </SegGroup>
          <span className="text-[9.5px] leading-tight text-ink-3">
            {code === 'IRC112'
              ? 'Sets the load-duration factor k_t in ε_sm − ε_cm.'
              : 'Recorded for reference; the Annex F strain is taken at the service stress.'}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Readout label="Permissible w max" value={`${fmtN(wmax, 2)} mm`} title="Maximum crack width for the selected exposure" />
        <Readout label="Method" value={code === 'IRC112' ? 'w_k = s_r,max·(ε_sm−ε_cm)' : 'w = 3·a_cr·ε_m / (1+2(a_cr−c_min)/(h−x))'} title="Crack-width equation of the selected code" />
        <Readout label="Clause" value={clauseFor(code)} title="Governing code clause" />
      </div>

      <p className={`${noteCls} mt-2.5`}>
        Section geometry, concrete cover, bar diameter, effective depth and the tension-steel stress σs are taken
        automatically from the shared inputs and the SLS cracked-section analysis for each load case — only the
        exposure class and load duration are entered here.
      </p>
    </Card>
  )
}

/**
 * Per-case crack-width table: the governing tension-steel stress and neutral
 * axis (from the SLS cracked section), the calculated crack width against the
 * permissible width for the exposure, the utilisation and a PASS/FAIL verdict.
 */
export function CrackWidthResultsTable({
  code,
  cases,
  results,
  selected,
  select,
}: {
  code: DesignCodeId
  cases: LoadCase[]
  results: Map<string, CrackWidthResult | null>
  selected: string | null
  select: (id: string) => void
}) {
  const list = cases.map((c) => results.get(c.id) ?? null).filter((r): r is CrackWidthResult => r !== null)
  const anyFail = list.some((r) => !r.ok)
  const worst = list.reduce((m, r) => Math.max(m, Number.isFinite(r.ratio) ? r.ratio : 0), 0)
  const wmax = list.length ? list[0].wmax : wMaxFor(code, EXPOSURE_OPTIONS[code][0].value)
  return (
    <Card
      title="Crack width check per load case"
      subtitle="service actions · crack width in mm"
      action={
        list.length > 0 ? (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-display text-[10px] font-bold uppercase tracking-[0.05em] ${anyFail ? 'border-bad/35 bg-bad/8 text-bad' : 'border-ok/35 bg-ok/8 text-ok'}`}>
            {anyFail ? 'crack width fails' : 'crack width ok'}
          </span>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <p className={noteCls}>No service load case has flexural tension to check for cracking.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tblCls}>
            <thead>
              <tr className="border-b border-edge-strong bg-panel/60">
                <th className={`${thCls} text-left`}>Case</th>
                <th className={`${thCls} ${numCls}`} title="Governing tension-steel stress from the cracked section">σs</th>
                <th className={`${thCls} ${numCls}`} title="Neutral-axis depth from the extreme compression fibre">xu</th>
                <th className={`${thCls} ${numCls}`} title="Calculated design crack width">w</th>
                <th className={`${thCls} ${numCls}`} title="Permissible crack width for the exposure">w max</th>
                <th className={`${thCls} ${numCls}`} title="Utilisation w / w max">w/w max</th>
                <th className={`${thCls} text-center`}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const r = results.get(c.id) ?? null
                return (
                  <tr
                    key={c.id}
                    aria-selected={selected === c.id}
                    onClick={() => select(c.id)}
                    className={`cursor-pointer border-b border-line transition-colors duration-150 ${
                      selected === c.id ? 'bg-accent-wash/70 shadow-rowmark' : r && !r.ok ? 'bg-bad/6 hover:bg-bad/10' : 'hover:bg-panel/70'
                    }`}
                  >
                    <td className={`${tdCls} whitespace-nowrap font-semibold`}>{c.name}</td>
                    {r ? (
                      <>
                        <td className={`${tdCls} ${numCls}`}>{fmtN(r.sigmaS, 0)}</td>
                        <td className={`${tdCls} ${numCls}`}>{fmtN(r.detail.x, 0)}</td>
                        <td className={`${tdCls} ${numCls} font-semibold ${r.ok ? '' : 'text-bad'}`}>{fmtN(r.w, 3)}</td>
                        <td className={`${tdCls} ${numCls} text-ink-2`}>{fmtN(r.wmax, 2)}</td>
                        <td className={`${tdCls} ${numCls}`}>
                          <RatioCell ratio={r.ratio} ok={r.ok} />
                        </td>
                        <td className={`${tdCls} text-center`}>
                          <Verdict ok={r.ok} />
                        </td>
                      </>
                    ) : (
                      <td className={`${tdCls} text-ink-3`} colSpan={6}>
                        no flexural tension — cracking not applicable
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Readout label="Worst w/w max" value={fmtN(worst, 3)} className={worst > 1 ? 'text-bad' : ''} title="Governing crack-width utilisation across all cases" />
          <Readout label="Permissible w max" value={`${fmtN(wmax, 2)} mm`} title="Permissible crack width for the exposure" />
          <Readout label="Clause" value={clauseFor(code)} title="Governing code clause" />
        </div>
      )}
      <p className={`${noteCls} mt-2.5`}>
        σs and xu come from the cracked transformed-section SLS solve for each case; w is the code's design surface
        crack width. Click a row to see the full calculation.
      </p>
    </Card>
  )
}

/**
 * Step-by-step crack-width calculation for the selected load case: the inputs
 * (σs, xu, d, h, b, A_s, c, φ and the exposure), the code equation evaluated
 * term by term, the calculated width against the permissible width and the
 * verdict with its clause.
 */
export function CrackWidthDetailPanel({
  code,
  settings,
  lc,
  result,
}: {
  code: DesignCodeId
  settings: CrackWidthSettings
  lc: LoadCase | null
  result: CrackWidthResult | null
}) {
  if (!lc || !result) {
    return (
      <Card title="Crack width calculation" subtitle="select a load case">
        <p className={noteCls}>Select a load case to see the crack-width calculation.</p>
      </Card>
    )
  }
  const d = result.detail
  const irc = code === 'IRC112'
  return (
    <Card title={`Crack width calculation — ${lc.name}`} subtitle={result.clause}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-3">
        <Row k="Tension steel stress σs" v={`${fmtN(result.sigmaS, 1)} N/mm²`} note="cracked transformed section" />
        <Row k="Neutral-axis depth x" v={`${fmtN(d.x, 1)} mm`} note="from extreme compression fibre" />
        <Row k="Effective depth d" v={`${fmtN(d.d, 1)} mm`} note="compression fibre → tension bar" />
        <Row k="Overall depth h" v={`${fmtN(d.h, 1)} mm`} note="in the bending plane" />
        <Row k="Section width b" v={`${fmtN(d.b, 1)} mm`} note="net area / h" />
        <Row k="Tension steel A_s" v={`${fmtN(d.As, 0)} mm²`} />
        <Row k="Clear cover c" v={`${fmtN(d.c, 1)} mm`} note="to the tension bar surface" />
        <Row k="Bar diameter φ" v={`${fmtN(d.phi, 1)} mm`} />
        <Row k="Exposure" v={settings.exposure} note={`w max = ${fmtN(result.wmax, 2)} mm`} />
      </div>

      <div className="mt-3 rounded-lg border border-line bg-panel/55 p-2.5">
        <div className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
          {irc ? 'Eurocode w_k = s_r,max · (ε_sm − ε_cm)' : 'Annex F surface crack width'}
        </div>
        {irc ? (
          <div className="mt-1 grid grid-cols-1 gap-x-5 gap-y-1 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-2">
            <Row k="A_c,eff" v={`${fmtN(d.AcEff ?? 0, 0)} mm²`} note="b·min[2.5(h−d), (h−x)/3, h/2]" />
            <Row k="ρ_p,eff" v={fmtN(d.rhoPeff ?? 0, 4)} note="A_s / A_c,eff" />
            <Row k="s_r,max" v={`${fmtN(d.srmax ?? 0, 1)} mm`} note="3.4c + 0.425·k₁·k₂·φ/ρ_p,eff" />
            <Row k="ε_sm − ε_cm" v={(d.epsSmCm ?? 0).toExponential(3)} note={`k_t = ${fmtN(d.kt ?? 0, 1)}, ≥ 0.6σs/Es`} />
          </div>
        ) : (
          <div className="mt-1 grid grid-cols-1 gap-x-5 gap-y-1 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-2">
            <Row k="ε_1 = σs/E_s" v={(result.sigmaS / 200000).toExponential(3)} note="bar strain, cracked section" />
            <Row k="ε_m" v={(d.epsM ?? 0).toExponential(3)} note="with tension stiffening" />
            <Row k="a_cr = c_min = c" v={`${fmtN(d.c, 1)} mm`} note="surface crack over the bar" />
          </div>
        )}
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${result.ok ? 'border-ok/30 bg-ok/8' : 'border-bad/30 bg-bad/8'}`}>
        <Verdict ok={result.ok} />
        <div className="flex items-baseline gap-2 tnum">
          <span className={`text-[20px] font-bold ${result.ok ? 'text-ink' : 'text-bad'}`}>{fmtN(result.w, 3)} mm</span>
          <span className="text-[11.5px] text-ink-3">≤ {fmtN(result.wmax, 2)} mm</span>
          <span className={`ml-2 text-[13px] font-bold ${result.ok ? 'text-ok' : 'text-bad'}`}>
            {Number.isFinite(result.ratio) ? `${fmtN(result.ratio * 100, 1)}%` : '—'}
          </span>
        </div>
        {result.uncracked && <span className="text-[11px] text-ink-3">section uncracked under this service action</span>}
      </div>

      <p className={`${noteCls} mt-2.5`}>
        {result.uncracked
          ? 'The service action does not crack the section in bending, so no crack width arises.'
          : irc
            ? 'Crack width per IRC:112 Cl 12.3.4 (EN 1992-2): the maximum crack spacing times the mean steel–concrete strain difference, checked against the Table 12.1 limit for the exposure class.'
            : 'Crack width per the Annex F / BS 8110-2 surface formula: three times the cover times the mean steel strain (allowing for tension stiffening), checked against the code limit for the exposure class.'}
      </p>
    </Card>
  )
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">{k}</dt>
      <dd className="font-semibold text-ink">
        {v}
        {note && <span className="ml-1 font-normal text-[10.5px] text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}
