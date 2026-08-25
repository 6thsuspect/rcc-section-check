import type { CaseResult, ComplianceCheck } from '../engine/types'
import { fmtN } from '../state'
import { Card, Chip } from './ui'

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
    <Card title="Capacity check per load case">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] tnum">
          <thead>
            <tr className="text-[10.5px] font-display uppercase tracking-wider text-ink-3 border-b border-edge-strong">
              <th className="text-left px-1.5 py-1">Case</th>
              <th className="text-right px-1.5 py-1">Pu kN</th>
              <th className="text-right px-1.5 py-1">Mux</th>
              <th className="text-right px-1.5 py-1">Muy</th>
              <th className="text-right px-1.5 py-1">MRd@Pu</th>
              <th className="text-right px-1.5 py-1">Mux1</th>
              <th className="text-right px-1.5 py-1">Muy1</th>
              <th className="text-right px-1.5 py-1">U</th>
              <th className="text-right px-1.5 py-1" title="Simplified power-law interaction value">
                Σ(M/M1)^α
              </th>
              <th className="text-right px-1.5 py-1">αn</th>
              <th className="text-center px-1.5 py-1">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.loadCase.id}
                className={`border-b border-edge cursor-pointer ${selected === r.loadCase.id ? 'bg-accent-wash' : 'hover:bg-panel'}`}
                onClick={() => select(r.loadCase.id)}
              >
                <td className="px-1.5 py-1 font-medium">{r.loadCase.name}</td>
                <td className="text-right px-1.5 py-1">{fmtN(r.loadCase.Pu, 0)}</td>
                <td className="text-right px-1.5 py-1">{fmtN(r.loadCase.Mux, 0)}</td>
                <td className="text-right px-1.5 py-1">{fmtN(r.loadCase.Muy, 0)}</td>
                <td className="text-right px-1.5 py-1">{r.axialGoverned ? '—' : fmtN(r.MRd / 1e6, 0)}</td>
                <td className="text-right px-1.5 py-1">{r.Mux1 ? fmtN(r.Mux1 / 1e6, 0) : '—'}</td>
                <td className="text-right px-1.5 py-1">{r.Muy1 ? fmtN(r.Muy1 / 1e6, 0) : '—'}</td>
                <td className={`text-right px-1.5 py-1 font-semibold ${r.ok ? 'text-ok' : 'text-bad'}`}>
                  {fmtN(r.U, 3)}
                  {r.axialGoverned ? ' (axial)' : ''}
                </td>
                <td className="text-right px-1.5 py-1">{r.simplified !== null ? fmtN(r.simplified, 3) : '—'}</td>
                <td className="text-right px-1.5 py-1">{r.alphaN !== null ? fmtN(r.alphaN, 2) : '—'}</td>
                <td className="text-center px-1.5 py-1">
                  <Chip status={r.ok ? 'pass' : 'fail'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3 mt-2">
        U = rigorous utilisation: radial demand/capacity in the Mx–My plane at constant Pu (governs the verdict).
        Mux1 / Muy1 = uniaxial capacities at Pu from the interaction surface. Σ(M/M1)^α = the selected code's
        simplified biaxial check, reported for traceability.
      </p>
    </Card>
  )
}

export function CompliancePanel({ checks }: { checks: ComplianceCheck[] }) {
  return (
    <Card title="Code compliance">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] font-display uppercase tracking-wider text-ink-3 border-b border-edge-strong">
              <th className="text-left px-1.5 py-1">Clause</th>
              <th className="text-left px-1.5 py-1">Check</th>
              <th className="text-left px-1.5 py-1">Computed</th>
              <th className="text-left px-1.5 py-1">Limit</th>
              <th className="text-center px-1.5 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={i} className="border-b border-edge align-top">
                <td className="px-1.5 py-1 whitespace-nowrap font-mono text-[11px] text-ink-2">{c.clause}</td>
                <td className="px-1.5 py-1">
                  {c.title}
                  {c.note && <div className="text-[10.5px] text-ink-3 mt-0.5">{c.note}</div>}
                </td>
                <td className="px-1.5 py-1 tnum">{c.demand}</td>
                <td className="px-1.5 py-1 tnum">{c.limit}</td>
                <td className="px-1.5 py-1 text-center">
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
