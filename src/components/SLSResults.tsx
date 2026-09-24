import type { LoadCase } from '../engine/types'
import type { SlsCaseResult, SlsMaterialLimits } from '../engine/sls'
import { fmtN } from '../state'
import { Card, Chip, noteCls, Readout, tblCls, tdCls, thCls } from './ui'

const numCls = 'text-right'

/** PASS/FAIL chip driven by a boolean. */
function Verdict({ ok }: { ok: boolean }) {
  return <Chip status={ok ? 'pass' : 'fail'} />
}

/** A ratio cell coloured by whether it exceeds 1. */
function RatioCell({ ratio, ok }: { ratio: number; ok: boolean }) {
  return (
    <span className={`font-bold ${ok ? 'text-ok' : 'text-bad'}`} title={ok ? 'within the permissible stress' : 'exceeds the permissible stress'}>
      {Number.isFinite(ratio) ? fmtN(ratio, 3) : '—'}
    </span>
  )
}

/**
 * Per-case SLS stress-check table: the service resultant moment, the cracked
 * transformed-section neutral-axis depth, the extreme-fibre concrete stress and
 * the governing steel stress, each against its IS 456 permissible value, with
 * the utilisation ratio and a PASS/FAIL verdict.
 */
export function SlsResultsTable({
  cases,
  results,
  selected,
  select,
}: {
  cases: LoadCase[]
  results: Map<string, SlsCaseResult | null>
  selected: string | null
  select: (id: string) => void
}) {
  return (
    <Card
      title="SLS stress check per load case"
      subtitle="service actions · N/mm², kN·m, mm"
    >
      <div className="overflow-x-auto">
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Case</th>
              <th className={`${thCls} ${numCls}`} title="Resultant service moment MEd = √(Mux²+Muy²)">MEd</th>
              <th className={`${thCls} ${numCls}`} title="Neutral-axis depth from the extreme compression fibre">xu</th>
              <th className={`${thCls} ${numCls}`} title="Concrete compressive stress at the extreme fibre">σc</th>
              <th className={`${thCls} ${numCls}`} title="Permissible concrete stress in bending (IS 456 Table 21)">σcbc</th>
              <th className={`${thCls} ${numCls}`} title="Concrete utilisation σc/σcbc">σc/σcbc</th>
              <th className={`${thCls} ${numCls}`} title="Governing tensile steel stress">σst</th>
              <th className={`${thCls} ${numCls}`} title="Permissible tensile steel stress (IS 456 Table 22)">σst,lim</th>
              <th className={`${thCls} ${numCls}`} title="Steel utilisation σst/σst,lim">σst/σst,lim</th>
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
                    selected === c.id
                      ? 'bg-accent-wash/70 shadow-rowmark'
                      : r && !r.ok
                        ? 'bg-bad/6 hover:bg-bad/10'
                        : 'hover:bg-panel/70'
                  }`}
                >
                  <td className={`${tdCls} whitespace-nowrap font-semibold`}>{c.name}</td>
                  {r ? (
                    <>
                      <td className={`${tdCls} ${numCls}`}>{fmtN(r.MEd / 1e6, 1)}</td>
                      <td className={`${tdCls} ${numCls}`}>{Number.isFinite(r.xu) ? fmtN(r.xu, 0) : '—'}</td>
                      <td className={`${tdCls} ${numCls} font-semibold ${r.concreteOk ? '' : 'text-bad'}`}>{fmtN(r.sigmaC, 2)}</td>
                      <td className={`${tdCls} ${numCls} text-ink-2`}>{fmtN(r.sigmaCbc, 1)}</td>
                      <td className={`${tdCls} ${numCls}`}>
                        <RatioCell ratio={r.concreteRatio} ok={r.concreteOk} />
                      </td>
                      <td className={`${tdCls} ${numCls} font-semibold ${r.steelOk ? '' : 'text-bad'}`}>{fmtN(r.sigmaSt, 1)}</td>
                      <td className={`${tdCls} ${numCls} text-ink-2`}>{fmtN(r.sigmaStPerm, 0)}</td>
                      <td className={`${tdCls} ${numCls}`}>
                        <RatioCell ratio={r.steelRatio} ok={r.steelOk} />
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <Verdict ok={r.ok} />
                      </td>
                    </>
                  ) : (
                    <td className={`${tdCls} text-ink-3`} colSpan={9}>
                      no service action to check
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={`${noteCls} mt-2.5`}>
        Permissible stresses per IS 456:2000 (working-stress basis): σcbc from Table 21 and σst / σsc from Table 22,
        with modular ratio m = 280/(3·σcbc). xu is the cracked transformed-section neutral-axis depth from the
        extreme compression fibre. Click a row to show its neutral axis and stress annotations on the section.
      </p>
    </Card>
  )
}

/**
 * Governing SLS verdict and material limits — the stress-check counterpart of
 * the ULS header summary.
 */
export function SlsSummaryPanel({
  results,
  limits,
  anyFail,
  extrapolated,
}: {
  results: SlsCaseResult[]
  limits: SlsMaterialLimits
  anyFail: boolean
  extrapolated: boolean
}) {
  const worstC = results.reduce((m, r) => Math.max(m, r.concreteRatio), 0)
  const worstS = results.reduce((m, r) => Math.max(m, r.steelRatio), 0)
  return (
    <Card
      title="SLS stress summary"
      subtitle={results.length > 0 ? `${results.length} case${results.length === 1 ? '' : 's'} · working stress method` : undefined}
    >
      {results.length === 0 ? (
        <p className={noteCls}>Fix the input errors to run the SLS stress check.</p>
      ) : (
        <>
          <div
            className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.05em] ${
              anyFail ? 'border-bad/35 bg-bad/8 text-bad' : 'border-ok/35 bg-ok/8 text-ok'
            }`}
          >
            {anyFail ? 'SLS stress check fails' : 'SLS stresses within limits'}
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <Readout label="Modular ratio m" value={fmtN(limits.m, 2)} title="m = 280/(3·σcbc), IS 456 Cl C-2.1" />
            <Readout label="σcbc (limit)" value={`${fmtN(limits.sigmaCbc, 1)} N/mm²`} title="Permissible concrete stress in bending, Table 21" />
            <Readout label="σst (limit)" value={`${fmtN(limits.sigmaSt, 0)} N/mm²`} title="Permissible tensile steel stress, Table 22" />
            <Readout
              label="Worst σc/σcbc"
              value={fmtN(worstC, 3)}
              className={worstC > 1 ? 'text-bad' : ''}
              title="Governing concrete utilisation across all cases"
            />
            <Readout
              label="Worst σst/σst"
              value={fmtN(worstS, 3)}
              className={worstS > 1 ? 'text-bad' : ''}
              title="Governing steel utilisation across all cases"
            />
            <Readout label="σsc (comp.)" value={`${fmtN(limits.sigmaSc, 0)} N/mm²`} title="Permissible compressive steel stress in column bars, Table 22" />
          </div>
          {extrapolated && (
            <p className={`${noteCls} mt-2`}>
              fck = M{limits.fck} exceeds the tabulated range of IS 456 Table 21; σcbc is a linear extrapolation and the
              high-strength design parameters should be checked against the applicable literature.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

/**
 * Step-by-step calculation block for the selected case, mirroring the ULS
 * neutral-axis calculation panel: inputs, the solved neutral axis, and each
 * stress against its permissible limit.
 */
export function SlsCalculationPanel({
  lc,
  result,
}: {
  lc: LoadCase | null
  result: SlsCaseResult | null
}) {
  if (!lc || !result) {
    return (
      <Card title="SLS calculation detail" subtitle="select a load case">
        <p className={noteCls}>Select a load case to see the working-stress calculation.</p>
      </Card>
    )
  }
  const pureAxial = !Number.isFinite(result.xu)
  return (
    <Card title={`SLS calculation — ${lc.name}`} subtitle="working-stress (direct stress) method">
      <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-2">
        <Row k="Service moment MEd" v={`${fmtN(result.MEd / 1e6, 1)} kN·m`} note={`Mux ${fmtN(result.Mux, 1)} · Muy ${fmtN(result.Muy, 1)} kN·m, θ = ${fmtN((result.phi * 180) / Math.PI, 0)}°`} />
        <Row k="Service axial Pu" v={`${fmtN(result.Pu, 0)} kN`} note="compression positive" />
        <Row k="Modular ratio m" v={fmtN(result.m, 2)} note="280/(3·σcbc)" />
        {pureAxial ? (
          <Row k="Neutral axis" v="— (uniform strain)" note="no bending — whole section in one zone" />
        ) : (
          <>
            <Row k="Neutral-axis depth xu" v={`${fmtN(result.xu, 1)} mm`} note={result.naOutside ? 'NA outside the section' : 'from the extreme compression fibre'} />
            <Row k="Effective depth d" v={`${fmtN(result.d, 1)} mm`} note="extreme compression fibre → extreme tension bar" />
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <StressLine
          label="Concrete (bending compression)"
          value={result.sigmaC}
          limit={result.sigmaCbc}
          ratio={result.concreteRatio}
          ok={result.concreteOk}
        />
        <StressLine
          label="Reinforcement (tension)"
          value={result.sigmaSt}
          limit={result.sigmaStPerm}
          ratio={result.steelRatio}
          ok={result.steelOk}
        />
        {result.compBar >= 0 && result.sigmaSc > 0 && (
          <StressLine
            label="Reinforcement (compression bars)"
            value={result.sigmaSc}
            limit={result.sigmaScPerm}
            ratio={result.compSteelRatio}
            ok={result.compSteelOk}
          />
        )}
      </div>

      <p className={`${noteCls} mt-2.5`}>
        The section is analysed as a cracked transformed section under the service actions: concrete carries
        compression only, longitudinal steel is transformed to m·As, and plane sections remain plane. The neutral
        axis is solved from equilibrium (ΣN = Pu) along the resultant-moment direction; σc at the extreme compression
        fibre and σst at the most-tensioned bar are checked against the IS 456 permissible stresses.
      </p>
    </Card>
  )
}

function StressLine({
  label,
  value,
  limit,
  ratio,
  ok,
}: {
  label: string
  value: number
  limit: number
  ratio: number
  ok: boolean
}) {
  return (
    <div className={`rounded-field border px-2.5 py-2 ${ok ? 'border-ok/30 bg-ok/8' : 'border-bad/30 bg-bad/8'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-2">{label}</span>
        <Verdict ok={ok} />
      </div>
      <div className="mt-1 flex items-baseline gap-2 tnum">
        <span className={`text-[16px] font-bold ${ok ? 'text-ink' : 'text-bad'}`}>{fmtN(value, value < 20 ? 2 : 1)}</span>
        <span className="text-[11px] text-ink-3">≤ {fmtN(limit, limit < 20 ? 1 : 0)} N/mm²</span>
        <span className={`ml-auto text-[12px] font-bold ${ok ? 'text-ok' : 'text-bad'}`}>
          {Number.isFinite(ratio) ? `${fmtN(ratio * 100, 1)}%` : '—'}
        </span>
      </div>
    </div>
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
