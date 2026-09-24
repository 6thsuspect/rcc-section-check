import type { CaseResult, ComplianceCheck, LoadCase } from '../engine/types'
import type { NeutralAxisResult } from '../engine/flexure'
import type { SpacingReport } from '../engine/barSpacing'
import { fmtN } from '../state'
import { Card, Chip, noteCls, Readout, tblCls, tdCls, thCls } from './ui'

/** Numeric columns are right-aligned so magnitudes and decimals line up. */
const numCls = 'text-right'

export function ResultsTable({
  results,
  selected,
  select,
}: {
  results: CaseResult[]
  selected: string | null
  select: (id: string) => void
}) {
  return (
    <Card
      title="Capacity check per load case"
      subtitle={results.length > 0 ? `${results.length} case${results.length === 1 ? '' : 's'} · kN, kN·m` : undefined}
    >
      <div className="overflow-x-auto">
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Case</th>
              <th className={`${thCls} ${numCls}`}>Pu</th>
              <th className={`${thCls} ${numCls}`}>Mux</th>
              <th className={`${thCls} ${numCls}`}>Muy</th>
              <th className={`${thCls} ${numCls}`} title="Design moment capacity at the case's axial load">
                MRd@Pu
              </th>
              <th className={`${thCls} ${numCls}`} title="Uniaxial capacity about X at Pu">Mux1</th>
              <th className={`${thCls} ${numCls}`} title="Uniaxial capacity about Y at Pu">Muy1</th>
              <th className={`${thCls} ${numCls}`} title="Rigorous utilisation — demand / capacity along the load ray">
                U
              </th>
              <th className={`${thCls} ${numCls}`} title="Simplified power-law interaction value">
                Σ(M/M1)^α
              </th>
              <th className={`${thCls} ${numCls}`} title="Biaxial interaction exponent of the selected code">αn</th>
              <th className={`${thCls} text-center`}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.loadCase.id}
                aria-selected={selected === r.loadCase.id}
                className={`cursor-pointer border-b border-line transition-colors duration-150 ${
                  selected === r.loadCase.id
                    ? 'bg-accent-wash/70 shadow-rowmark'
                    : r.ok
                      ? 'hover:bg-panel/70'
                      : 'bg-bad/6 hover:bg-bad/10'
                }`}
                onClick={() => select(r.loadCase.id)}
              >
                <td className={`${tdCls} whitespace-nowrap font-semibold`}>{r.loadCase.name}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.loadCase.Pu, 0)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.loadCase.Mux, 0)}</td>
                <td className={`${tdCls} ${numCls}`}>{fmtN(r.loadCase.Muy, 0)}</td>
                <td className={`${tdCls} ${numCls}`}>{r.axialGoverned ? '—' : fmtN(r.MRd / 1e6, 0)}</td>
                <td className={`${tdCls} ${numCls}`}>{r.Mux1 ? fmtN(r.Mux1 / 1e6, 0) : '—'}</td>
                <td className={`${tdCls} ${numCls}`}>{r.Muy1 ? fmtN(r.Muy1 / 1e6, 0) : '—'}</td>
                <td
                  className={`${tdCls} ${numCls} font-bold ${r.ok ? 'text-ok' : 'text-bad'}`}
                  title={r.axialGoverned ? 'Axial load governs — no moment capacity at this P' : undefined}
                >
                  {fmtN(r.U, 3)}
                  {r.axialGoverned ? ' (axial)' : ''}
                </td>
                <td className={`${tdCls} ${numCls}`}>{r.simplified !== null ? fmtN(r.simplified, 3) : '—'}</td>
                <td className={`${tdCls} ${numCls}`}>{r.alphaN !== null ? fmtN(r.alphaN, 2) : '—'}</td>
                <td className={`${tdCls} text-center`}>
                  <Chip status={r.ok ? 'pass' : 'fail'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${noteCls} mt-2.5`}>
        U = rigorous utilisation: radial demand/capacity in the Mx–My plane at constant Pu (governs the verdict).
        Mux1 / Muy1 = uniaxial capacities at Pu from the interaction surface. Σ(M/M1)^α = the selected code's
        simplified biaxial check, reported for traceability.
      </p>
    </Card>
  )
}

export function CompliancePanel({ checks }: { checks: ComplianceCheck[] }) {
  const tally = (['pass', 'warn', 'fail'] as const)
    .map((status) => `${checks.filter((c) => c.status === status).length} ${status}`)
    .filter((part) => !part.startsWith('0 '))
  return (
    <Card
      title="Code compliance"
      subtitle={checks.length > 0 ? tally.join(' · ') : undefined}
    >
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
            {checks.map((c, i) => (
              <tr
                key={i}
                className={`border-b border-line align-top transition-colors duration-150 hover:bg-panel/50 ${
                  c.status === 'fail' ? 'bg-bad/6' : ''
                }`}
              >
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
    </Card>
  )
}

const f0 = (v: number) => fmtN(v, 0)

/**
 * Neutral-axis depth xu (actual, from strain compatibility at the case's Pu),
 * the code's limiting depth xu,max, the resulting under-/over-reinforced
 * classification and — for an under-reinforced section — the design moment
 * capacity Mu evaluated with the actual xu.
 */
export function NeutralAxisPanel({
  cases,
  results,
  selected,
  select,
  xuMaxLabel,
  ready,
}: {
  cases: LoadCase[]
  results: Map<string, NeutralAxisResult | null>
  selected: string | null
  select: (id: string) => void
  xuMaxLabel: string
  ready: boolean
}) {
  const sel = cases.find((c) => c.id === selected) ?? cases[0] ?? null
  const r = sel ? (results.get(sel.id) ?? null) : null
  return (
    <Card title="Neutral axis & moment capacity" subtitle={ready ? 'xu vs xu,max · mm, kN·m' : undefined}>
      {!ready ? (
        <p className={noteCls}>Fix the input errors to compute the neutral axis.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className={tblCls}>
              <thead>
                <tr className="border-b border-edge-strong bg-panel/60">
                  <th className={`${thCls} text-left`}>Case</th>
                  <th className={`${thCls} ${numCls}`} title="Effective depth: extreme compression fibre to the extreme tension bar">d</th>
                  <th className={`${thCls} ${numCls}`} title="Actual neutral-axis depth from the extreme compression fibre">xu</th>
                  <th className={`${thCls} ${numCls}`} title={xuMaxLabel}>xu,max</th>
                  <th className={`${thCls} ${numCls}`}>xu/d</th>
                  <th className={`${thCls} text-left`}>Section</th>
                  <th className={`${thCls} ${numCls}`} title="Design moment capacity with the actual xu (under-reinforced only)">Mu</th>
                  <th className={`${thCls} ${numCls}`} title="Resultant applied moment">MEd</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const n = results.get(c.id) ?? null
                  return (
                    <tr
                      key={c.id}
                      aria-selected={sel?.id === c.id}
                      onClick={() => select(c.id)}
                      className={`cursor-pointer border-b border-line transition-colors duration-150 ${
                        sel?.id === c.id ? 'bg-accent-wash/70 shadow-rowmark' : 'hover:bg-panel/70'
                      }`}
                    >
                      <td className={`${tdCls} whitespace-nowrap font-semibold`}>{c.name}</td>
                      {n ? (
                        <>
                          <td className={`${tdCls} ${numCls}`}>{f0(n.d)}</td>
                          <td className={`${tdCls} ${numCls} font-semibold`}>{f0(n.xu)}</td>
                          <td className={`${tdCls} ${numCls}`}>{f0(n.xuMax)}</td>
                          <td className={`${tdCls} ${numCls}`}>{fmtN(n.xu / n.d, 3)}</td>
                          <td className={`${tdCls} whitespace-nowrap`}>
                            <ClassBadge cls={n.classification} />
                          </td>
                          <td className={`${tdCls} ${numCls} font-semibold`}>{n.Mu !== null ? fmtN(n.Mu / 1e6, 1) : '—'}</td>
                          <td className={`${tdCls} ${numCls}`}>{fmtN(n.MEd / 1e6, 1)}</td>
                        </>
                      ) : (
                        <td className={`${tdCls} text-ink-3`} colSpan={7}>
                          {Math.hypot(c.Mux, c.Muy) < 1e-6 ? 'no bending moment — NA not defined' : 'axial load outside the section range'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {sel && r && (
            <div className="mt-3 rounded-lg border border-line bg-panel/45 px-3 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
                  Calculation — {sel.name}
                </span>
                <ClassBadge cls={r.classification} />
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] leading-snug text-ink-2 tnum sm:grid-cols-2">
                <Row k="Neutral axis depth xu" v={`${fmtN(r.xu, 1)} mm`} note={`from the extreme compression fibre, ${r.axisLabel}`} />
                <Row k="Effective depth d" v={`${fmtN(r.d, 1)} mm`} note="extreme compression fibre → extreme tension bar" />
                <Row k="xu,max / d" v={fmtN(r.xuMaxRatio, 3)} note={xuMaxLabel} />
                <Row k="xu,max" v={`${fmtN(r.xuMax, 1)} mm`} note={`= ${fmtN(r.xuMaxRatio, 3)} × ${fmtN(r.d, 1)}`} />
                <Row k="Strain εc (top) · εs (bar)" v={`${(r.epsTop * 1e3).toFixed(3)}‰ · ${(r.epsSteel * 1e3).toFixed(3)}‰`} note={`limiting tension strain ${(r.epsLimit * 1e3).toFixed(3)}‰`} />
                <Row
                  k="xu vs xu,max"
                  v={`${fmtN(r.xu, 1)} ${r.classification === 'under' ? '≤' : '>'} ${fmtN(r.xuMax, 1)} mm`}
                  note={r.classification === 'under' ? 'tension steel yields before the concrete crushes' : 'concrete crushes before the tension steel reaches its limiting strain'}
                />
              </dl>
              {r.classification === 'under' && r.Mu !== null ? (
                <p className="mt-2 rounded-field border border-ok/30 bg-ok/8 px-2 py-1.5 text-[11.5px] leading-snug text-ink">
                  <b>Under-reinforced</b> — Mu = ΣC·z of the stress resultants at xu = {fmtN(r.xu, 1)} mm (P = {f0(sel.Pu)} kN):{' '}
                  <b className="tnum">Mu = {fmtN(r.Mu / 1e6, 1)} kN·m</b> vs MEd = {fmtN(r.MEd / 1e6, 1)} kN·m{' '}
                  <span className={r.Mu >= r.MEd ? 'font-semibold text-ok' : 'font-semibold text-bad'}>
                    ({r.Mu >= r.MEd ? 'Mu ≥ MEd' : 'Mu < MEd'}, MEd/Mu = {fmtN(r.MEd / r.Mu, 3)})
                  </span>
                </p>
              ) : (
                <p className="mt-2 rounded-field border border-warn2/30 bg-warn2/8 px-2 py-1.5 text-[11.5px] leading-snug text-ink">
                  <b>Over-reinforced{sel.Pu > 0 ? ' / compression-controlled' : ''}</b> — xu exceeds xu,max
                  {r.naOutside ? ' (the NA lies outside the section — whole section in compression)' : ''}, so Mu is not
                  taken from the under-reinforced formula. Revise the section (depth, concrete grade or steel) for a
                  ductile flexural failure. The strain-compatibility capacity at this state is{' '}
                  {fmtN(r.MuState / 1e6, 1)} kN·m (the interaction check above remains the governing verdict).
                </p>
              )}
            </div>
          )}
          <p className={`${noteCls} mt-2.5`}>
            xu is solved from equilibrium (ΣF = Pu) with the resisting moment aligned to the case's moment direction;
            it is measured normal to the neutral axis — for uniaxial bending, along the global Y (bending about X) or
            X (bending about Y) axis. Click a row to show its neutral axis on the section.
          </p>
        </>
      )}
    </Card>
  )
}

function ClassBadge({ cls }: { cls: 'under' | 'over' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px font-display text-[9.5px] font-bold uppercase tracking-[0.05em] ${
        cls === 'under' ? 'border-ok/35 bg-ok/10 text-ok' : 'border-warn2/35 bg-warn2/10 text-warn2'
      }`}
    >
      {cls === 'under' ? 'Under-reinforced' : 'Over-reinforced'}
    </span>
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

/**
 * Physical reinforcement audit: overlapping / intersecting bars for every
 * layout, bundle properties and the minimum clear spacing between adjacent
 * bars / bundles (bars inside one bundle excluded).
 */
export function ReinforcementSpacingPanel({ report }: { report: SpacingReport }) {
  const { overlaps, bundles } = report
  const perBundle = [...new Set(bundles.map((b) => b.bars.length))]
  const diaSets = [...new Set(bundles.map((b) => b.dias.join(' + ')))]
  const eq = bundles.length ? Math.max(...bundles.map((b) => b.eqDia)) : 0
  const env = bundles.length ? Math.max(...bundles.map((b) => b.envelope)) : 0
  return (
    <Card
      title="Reinforcement spacing & overlap"
      subtitle={overlaps.length > 0 ? `${overlaps.length} overlap${overlaps.length === 1 ? '' : 's'}` : 'no overlaps'}
    >
      <div className="overflow-x-auto">
        <table className={tblCls}>
          <thead>
            <tr className="border-b border-edge-strong bg-panel/60">
              <th className={`${thCls} text-left`}>Check</th>
              <th className={`${thCls} text-left`}>Computed</th>
              <th className={`${thCls} text-left`}>Limit</th>
              <th className={`${thCls} text-center`}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className={`border-b border-line align-top ${overlaps.length ? 'bg-bad/6' : ''}`}>
              <td className={`${tdCls} font-medium`}>
                Bar overlap / intersection
                <div className="mt-0.5 text-[10.5px] font-normal leading-snug text-ink-2">All bars, including bars inside a bundle</div>
              </td>
              <td className={`${tdCls} tnum`}>
                {overlaps.length === 0 ? (
                  'none'
                ) : (
                  <ul className="space-y-0.5">
                    {overlaps.slice(0, 8).map((o) => (
                      <li key={`${o.i}-${o.j}`} className="text-bad">
                        bars {o.i + 1} & {o.j + 1} overlap by {o.depth.toFixed(1)} mm{o.sameBundle ? ' (same bundle)' : ''}
                      </li>
                    ))}
                    {overlaps.length > 8 && <li className="text-bad">… and {overlaps.length - 8} more</li>}
                  </ul>
                )}
              </td>
              <td className={`${tdCls} tnum text-ink-2`}>no intersection</td>
              <td className={`${tdCls} text-center`}>
                <Chip status={overlaps.length ? 'fail' : 'pass'} />
              </td>
            </tr>
            {report.minClear !== null && (
              <tr className="border-b border-line align-top">
                <td className={`${tdCls} font-medium`}>
                  {bundles.length ? 'Min. clear spacing between bars / bundles' : 'Min. clear spacing between bars'}
                  <div className="mt-0.5 text-[10.5px] font-normal leading-snug text-ink-2">
                    {bundles.length
                      ? 'Adjacent bars outside the bundle; bars within one bundle excluded'
                      : 'Surface-to-surface distance of the closest pair'}
                    {report.minClearPair ? ` · bars ${report.minClearPair[0] + 1} & ${report.minClearPair[1] + 1}` : ''}
                  </div>
                </td>
                <td className={`${tdCls} tnum`}>{report.minClear.toFixed(1)} mm</td>
                <td className={`${tdCls} tnum text-ink-2`}>
                  ≥ {report.clearLimit.toFixed(0)} mm{bundles.length ? ' (max of ⌀, bundle ⌀eq, 25)' : ' (max of ⌀, 25)'}
                </td>
                <td className={`${tdCls} text-center`}>
                  <Chip status={report.minClear < 0 ? 'fail' : report.minClearOk ? 'pass' : 'warn'} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {bundles.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Readout label="Bundles" value={`${bundles.length}`} />
          <Readout label="Bars per bundle" value={perBundle.join(' / ')} />
          <Readout label="Bar ⌀ in bundle" value={diaSets.length === 1 ? `⌀ ${diaSets[0]}` : 'varies'} />
          <Readout label="Bundle ⌀ (equivalent)" value={`${eq.toFixed(1)} mm`} title="√Σφ² — a bundle is treated as one bar of equal area" />
          <Readout label="Bundle envelope" value={`${env.toFixed(0)} mm`} title="Overall width across the bars of one bundle" />
          <Readout
            label="Bundle spacing c/c"
            value={
              report.bundleSpacing
                ? Math.abs(report.bundleSpacing.max - report.bundleSpacing.min) < 0.5
                  ? `${report.bundleSpacing.min.toFixed(0)} mm`
                  : `${report.bundleSpacing.min.toFixed(0)}–${report.bundleSpacing.max.toFixed(0)} mm`
                : '—'
            }
            title="Centre-to-centre distance between neighbouring bundle centroids"
          />
        </div>
      )}
      <p className={`${noteCls} mt-2.5`}>
        Overlapping bars are drawn in red on the section. The code clear-distance clause is listed under Code
        compliance; this table adds the physical overlap audit and the bundle-to-bundle gap.
      </p>
    </Card>
  )
}
