import type { CaseResult, ComplianceCheck } from '../engine/types'
import { fmtN } from '../state'
import { Card, Chip, noteCls, tblCls, tdCls, thCls } from './ui'

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
