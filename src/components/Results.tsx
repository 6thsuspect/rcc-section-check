import type { CaseResult, ComplianceCheck, NeutralAxisDetail } from '../engine/types'
import { fmtN } from '../state'
import { Card, Chip, noteCls, noteSmCls, Readout, tblCls, tdCls, thCls } from './ui'

function classLabel(c: NeutralAxisDetail['classification']): string {
  switch (c) {
    case 'under-reinforced':
      return 'Under-reinforced'
    case 'over-reinforced':
      return 'Over-reinforced'
    case 'fully-compressed':
      return 'Fully compressed'
    case 'no-compression':
      return 'No compression zone'
  }
}

function classTone(c: NeutralAxisDetail['classification']): 'pass' | 'fail' | 'warn' | 'info' {
  switch (c) {
    case 'under-reinforced':
      return 'pass'
    case 'over-reinforced':
      return 'fail'
    case 'fully-compressed':
      return 'warn'
    default:
      return 'info'
  }
}

function fmtXu(v: number | null | undefined, d = 1): string {
  if (v == null) return '—'
  if (!Number.isFinite(v)) return '∞ (outside section)'
  return `${fmtN(v, d)} mm`
}

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
              <th className={`${thCls} ${numCls}`} title="Neutral-axis depth from extreme compression fibre">xu</th>
              <th className={`${thCls} ${numCls}`} title="Limiting neutral-axis depth xu,max = k·d">xu,max</th>
              <th className={`${thCls} text-center`} title="Under-reinforced if xu ≤ xu,max">Class</th>
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
                <td className={`${tdCls} ${numCls}`}>
                  {r.na && r.na.xu != null && Number.isFinite(r.na.xu) ? fmtN(r.na.xu, 0) : '—'}
                </td>
                <td className={`${tdCls} ${numCls}`}>
                  {r.na && r.na.xuMax != null ? fmtN(r.na.xuMax, 0) : '—'}
                </td>
                <td className={`${tdCls} text-center`}>
                  {r.na ? (
                    <span
                      className={
                        r.na.classification === 'under-reinforced'
                          ? 'font-semibold text-ok'
                          : r.na.classification === 'over-reinforced'
                            ? 'font-semibold text-bad'
                            : 'text-ink-2'
                      }
                      title={classLabel(r.na.classification)}
                    >
                      {r.na.classification === 'under-reinforced'
                        ? 'UR'
                        : r.na.classification === 'over-reinforced'
                          ? 'OR'
                          : r.na.classification === 'fully-compressed'
                            ? 'FC'
                            : '—'}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
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
        Mux1 / Muy1 = uniaxial capacities at Pu from the interaction surface. xu = NA depth from the extreme
        compression fibre; xu,max = limiting depth (k·d). Class: UR = under-reinforced (xu ≤ xu,max), OR =
        over-reinforced, FC = fully compressed. Σ(M/M1)^α = the selected code's simplified biaxial check,
        reported for traceability.
      </p>
    </Card>
  )
}

/**
 * Neutral-axis depth, xu,max, under/over-reinforced classification and
 * design moment capacity Mu for the selected load case.
 */
export function NeutralAxisPanel({
  result,
  codeName,
  fy,
}: {
  result: CaseResult | null
  codeName: string
  fy: number
}) {
  if (!result) {
    return (
      <Card title="Neutral axis & flexural capacity" subtitle="select a load case">
        <p className={noteCls}>Select a load case to inspect xu, xu,max and Mu.</p>
      </Card>
    )
  }

  const na = result.na
  const lc = result.loadCase

  if (result.axialGoverned && (!na || na.classification === 'fully-compressed' || na.classification === 'no-compression')) {
    return (
      <Card title="Neutral axis & flexural capacity" subtitle={`${lc.name} · axial-governed`}>
        <p className={noteCls}>
          {result.loadCase.Pu > 0
            ? 'Axial load governs this case — the section is fully compressed (no flexural neutral axis inside the section).'
            : 'Tension axial load governs — no compression zone develops.'}
        </p>
        {na && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Readout label="xu" value={fmtXu(na.xu)} />
            <Readout label="xu,max" value={fmtXu(na.xuMax)} title={`xu,max = ${fmtN(na.xuMaxRatio, 3)} · d`} />
            <Readout label="d (eff.)" value={fmtXu(na.d)} />
            <Readout label="Class" value={classLabel(na.classification)} />
          </div>
        )}
      </Card>
    )
  }

  if (!na) {
    return (
      <Card title="Neutral axis & flexural capacity" subtitle={lc.name}>
        <p className={noteCls}>Neutral-axis detail is not available for this case.</p>
      </Card>
    )
  }

  const under = na.classification === 'under-reinforced'
  const over = na.classification === 'over-reinforced'
  // Design Mu based on actual xu: the capacity moment of the governing strain plane
  const MuKNm = na.Mu != null && Number.isFinite(na.Mu) ? na.Mu / 1e6 : null
  const Mu0KNm = na.Mu0 != null && Number.isFinite(na.Mu0) ? na.Mu0 / 1e6 : null
  const ang = ((na.theta * 180) / Math.PI + 360) % 360

  return (
    <Card
      title="Neutral axis & flexural capacity"
      subtitle={`${lc.name} · ${codeName}`}
      action={<Chip status={classTone(na.classification)} />}
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <Readout
          label="xu"
          value={fmtXu(na.xu)}
          title="Depth of the neutral axis from the extreme compression fibre, along the compression normal"
          className="font-semibold"
        />
        <Readout
          label="xu,max"
          value={fmtXu(na.xuMax)}
          title={`Limiting NA depth = ${fmtN(na.xuMaxRatio, 4)} × d  (fy = ${fy} N/mm²)`}
        />
        <Readout
          label="xu / xu,max"
          value={
            na.xu != null && Number.isFinite(na.xu) && na.xuMax && na.xuMax > 0
              ? fmtN(na.xu / na.xuMax, 3)
              : '—'
          }
          title="Ratio ≤ 1 → under-reinforced (tension failure); > 1 → over-reinforced"
          className={under ? 'font-semibold text-ok' : over ? 'font-semibold text-bad' : ''}
        />
        <Readout label="d (eff.)" value={fmtXu(na.d)} title="Extreme compression fibre → extreme tension steel" />
        <Readout label="h (section)" value={fmtXu(na.h)} title="Overall depth along the compression normal" />
        <Readout
          label="NA angle θ"
          value={`${fmtN(ang, 1)}°`}
          title="Orientation of the neutral axis (compression normal = θ + 90°)"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Readout
          label="xu along global X"
          value={na.xuGlobalX != null ? `${fmtN(na.xuGlobalX, 1)} mm` : '—'}
          title="Component of the xu depth vector along the global X axis (from extreme compression fibre toward the NA)"
        />
        <Readout
          label="xu along global Y"
          value={na.xuGlobalY != null ? `${fmtN(na.xuGlobalY, 1)} mm` : '—'}
          title="Component of the xu depth vector along the global Y axis (from extreme compression fibre toward the NA)"
        />
        <Readout
          label="Section class"
          value={classLabel(na.classification)}
          title={
            under
              ? 'xu ≤ xu,max — tension steel yields before concrete crushes (ductile)'
              : over
                ? 'xu > xu,max — concrete crushes before tension steel yields (brittle)'
                : classLabel(na.classification)
          }
          className={under ? 'font-semibold text-ok' : over ? 'font-semibold text-bad' : 'font-semibold'}
        />
        <Readout
          label={under ? 'Mu (at actual xu)' : 'MRd @ Pu'}
          value={MuKNm != null ? `${fmtN(MuKNm, 1)} kN·m` : '—'}
          title={
            under
              ? 'Design moment capacity of the capacity strain plane based on the actual neutral-axis depth xu (under-reinforced)'
              : 'Moment capacity of the governing strain plane at Pu along the demand direction'
          }
          className="font-semibold"
        />
      </div>

      {under && Mu0KNm != null && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Readout
            label="Mu0 (pure bending)"
            value={`${fmtN(Mu0KNm, 1)} kN·m`}
            title="Pure-bending (P = 0) moment capacity along the same direction — classical beam Mu"
          />
          <Readout
            label="MRd @ Pu"
            value={MuKNm != null ? `${fmtN(MuKNm, 1)} kN·m` : '—'}
            title="Moment capacity at the case axial load Pu (used for the utilisation check)"
          />
          <Readout label="MEd (demand)" value={`${fmtN(result.MEd / 1e6, 1)} kN·m`} />
          <Readout
            label="xu,max / d"
            value={fmtN(na.xuMaxRatio, 4)}
            title={`IS 456 Cl 38.1: xu,max/d = 0.0035 / (0.0055 + 0.87·fy/Es) for fy = ${fy}`}
          />
        </div>
      )}

      {!under && Mu0KNm != null && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Readout
            label="Mu0 (pure bending)"
            value={`${fmtN(Mu0KNm, 1)} kN·m`}
            title="Pure-bending capacity along the demand direction"
          />
          <Readout label="MEd (demand)" value={`${fmtN(result.MEd / 1e6, 1)} kN·m`} />
          <Readout
            label="xu,max / d"
            value={fmtN(na.xuMaxRatio, 4)}
            title={`Limiting ratio for fy = ${fy} N/mm²`}
          />
        </div>
      )}

      <p className={`${noteSmCls} mt-2.5`}>
        <b>xu</b> is measured from the extreme compression fibre to the neutral axis along the compression
        normal (perpendicular to the NA). <b>xu,max = (xu,max/d)·d</b> with{' '}
        <span className="tnum">xu,max/d = {fmtN(na.xuMaxRatio, 4)}</span> for {codeName} at fy = {fy} N/mm²
        and d = distance from the extreme compression fibre to the extreme tension steel.
        {under
          ? ' Under-reinforced: design Mu is the moment capacity of the strain plane at the actual xu.'
          : over
            ? ' Over-reinforced: xu exceeds xu,max — the section fails by concrete crushing before the tension steel yields; Mu is still reported from the strain-compatibility capacity plane but ductility is limited.'
            : ''}{' '}
        Global X/Y components locate the xu depth vector on the section diagram axes.
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
