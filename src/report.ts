import type {
  CaseResult,
  ComplianceCheck,
  InteractionSurface,
  SectionProperties,
} from './engine/types'
import type { CodeSpec, SteelGradeSpec } from './engine/codes'
import { contourAtP, pmCurve } from './engine/surface'
import type { AppState } from './state'

/**
 * Calculation report export. Builds a self-contained print document (all
 * figures embedded as inline SVG, all styles inlined) in a new window and
 * invokes the browser print dialog — "Save as PDF" produces the deliverable.
 */

const f = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface ReportContext {
  state: AppState
  spec: CodeSpec
  grade: SteelGradeSpec
  props: SectionProperties
  surface: InteractionSurface
  results: CaseResult[]
  checks: ComplianceCheck[]
  flex: { MxPos: number; MxNeg: number; MyPos: number; MyNeg: number } | null
  selectedName: string
  svgs: { section: string; pm: string; contour: string }
}

export function exportReport(ctx: ReportContext): void {
  const { state, spec, grade, props, surface, results, checks, flex, svgs } = ctx
  const conc = spec.concrete(state.fck)
  const steel = spec.steel(grade.fy)
  const PuzS = spec.simplifiedPuz(state.fck, grade.fy, props.area, props.Asc)
  const now = new Date()

  const sel = results.find((r) => r.loadCase.name === ctx.selectedName) ?? results[0] ?? null
  const thetaM = sel ? Math.atan2(sel.loadCase.Muy, sel.loadCase.Mux) : 0
  const curve = pmCurve(surface, thetaM, 60)
  const curveRows = curve.filter((_, i) => i % 3 === 0)
  const contour = sel ? contourAtP(surface, sel.loadCase.Pu * 1e3) : null

  const geoRows = state.geometry.boundary
    .map((p, i) => `<tr><td>${i + 1}</td><td>${f(p.x, 1)}</td><td>${f(p.y, 1)}</td></tr>`)
    .join('')
  const voidBlocks = state.geometry.voids
    .map(
      (v, k) =>
        `<p class="small"><b>Void ${k + 1}:</b> ${v.map((p) => `(${f(p.x, 0)}, ${f(p.y, 0)})`).join(' · ')}</p>`,
    )
    .join('')
  const barRows = state.bars
    .map((b, i) => `<tr><td>${i + 1}</td><td>${f(b.x, 1)}</td><td>${f(b.y, 1)}</td><td>${b.dia}</td></tr>`)
    .join('')
  const caseRows = state.cases
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${f(c.Pu, 1)}</td><td>${f(c.Mux, 1)}</td><td>${f(c.Muy, 1)}</td></tr>`,
    )
    .join('')

  const caseBlocks = results
    .map((r) => {
      const lc = r.loadCase
      const MEd = r.MEd / 1e6
      const th = (Math.atan2(lc.Muy, lc.Mux) * 180) / Math.PI
      const ratio = lc.Pu * 1e3 > 0 ? (lc.Pu * 1e3) / PuzS : 0
      const tx = r.Mux1 > 0 ? Math.abs(lc.Mux * 1e6) / r.Mux1 : 0
      const ty = r.Muy1 > 0 ? Math.abs(lc.Muy * 1e6) / r.Muy1 : 0
      return `
      <div class="case">
        <h4>Case ${esc(lc.name)} — ${r.ok ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'}</h4>
        <table class="calc">
          <tr><td>Applied actions</td><td>P<sub>u</sub> = ${f(lc.Pu, 1)} kN; M<sub>ux</sub> = ${f(lc.Mux, 1)} kN·m; M<sub>uy</sub> = ${f(lc.Muy, 1)} kN·m</td></tr>
          <tr><td>Resultant demand</td><td>M<sub>Ed</sub> = √(M<sub>ux</sub>² + M<sub>uy</sub>²) = ${f(MEd, 1)} kN·m at θ<sub>M</sub> = ${f(th, 1)}°</td></tr>
          <tr><td>Axial range</td><td>P<sub>t</sub> = ${f(surface.Pt / 1e3, 0)} kN ≤ P<sub>u</sub> ≤ P<sub>uz,rig</sub> = ${f(surface.Puz / 1e3, 0)} kN ${r.axialGoverned ? '— <b>axial governs</b>' : '✓'}</td></tr>
          ${
            r.axialGoverned
              ? `<tr><td>Verdict</td><td>U = ${f(r.U, 3)} (axial) — ${r.ok ? 'PASS' : 'FAIL'}</td></tr>`
              : `
          <tr><td>Uniaxial capacities at P<sub>u</sub> (from surface)</td><td>M<sub>ux1</sub> = ${f(r.Mux1 / 1e6, 1)} kN·m; M<sub>uy1</sub> = ${f(r.Muy1 / 1e6, 1)} kN·m</td></tr>
          <tr><td>Capacity along demand direction</td><td>M<sub>Rd</sub>(P<sub>u</sub>, θ<sub>M</sub>) = ${f(r.MRd / 1e6, 1)} kN·m</td></tr>
          <tr><td><b>Rigorous utilisation (governs)</b></td><td><b>U = M<sub>Ed</sub> / M<sub>Rd</sub> = ${f(MEd, 1)} / ${f(r.MRd / 1e6, 1)} = ${f(r.U, 3)}</b> → ${r.ok ? 'PASS' : 'FAIL'}</td></tr>
          ${
            r.simplified !== null && r.alphaN !== null
              ? `<tr><td>Simplified check (${esc(spec.name)})</td><td>
                 P<sub>uz</sub> = ${f(PuzS / 1e3, 0)} kN; P<sub>u</sub>/P<sub>uz</sub> = ${f(ratio, 3)}; α<sub>n</sub> = ${f(r.alphaN, 3)}<br>
                 (${f(tx, 3)})<sup>${f(r.alphaN, 2)}</sup> + (${f(ty, 3)})<sup>${f(r.alphaN, 2)}</sup> = ${f(Math.pow(tx, r.alphaN), 3)} + ${f(Math.pow(ty, r.alphaN), 3)} = <b>${f(r.simplified, 3)}</b> ${r.simplified <= 1 ? '≤ 1.0 ✓' : '> 1.0 ✗'}</td></tr>`
              : ''
          }`
          }
        </table>
      </div>`
    })
    .join('')

  const checkRows = checks
    .map(
      (c) => `<tr>
        <td class="mono">${esc(c.clause)}</td>
        <td>${esc(c.title)}${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}</td>
        <td>${esc(c.demand)}</td><td>${esc(c.limit)}</td>
        <td class="${c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'warn'}">${c.status.toUpperCase()}</td>
      </tr>`,
    )
    .join('')

  const curveTable = curveRows
    .map((p) => `<tr><td>${f(p.P / 1e3, 0)}</td><td>${f(p.M / 1e6, 1)}</td></tr>`)
    .join('')
  const contourTable = contour
    ? contour
        .map(
          (p) =>
            `<tr><td>${f((p.theta * 180) / Math.PI, 0)}</td><td>${f(p.Mx / 1e6, 1)}</td><td>${f(p.My / 1e6, 1)}</td></tr>`,
        )
        .join('')
    : ''

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>RCC Section Check — Calculation Report</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #17222c; margin: 0; padding: 24px; }
  h1 { font-size: 21px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #17222c; }
  h4 { font-size: 12.5px; margin: 14px 0 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; margin: 6px 0 10px; }
  th, td { border: 1px solid #c9d2da; padding: 3px 7px; text-align: left; vertical-align: top; }
  th { background: #eef2f6; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { font-variant-numeric: tabular-nums; }
  table.calc td:first-child { width: 34%; color: #485866; }
  .meta { color: #485866; font-size: 11px; margin-bottom: 4px; }
  .small { font-size: 10px; color: #75828e; }
  .mono { font-family: Consolas, monospace; font-size: 10px; white-space: nowrap; }
  .pass { color: #006300; font-weight: 600; }
  .fail { color: #b93434; font-weight: 600; }
  .warn { color: #8a5a00; font-weight: 600; }
  .cols { display: flex; gap: 18px; } .cols > div { flex: 1; }
  .fig { border: 1px solid #dde4ea; border-radius: 6px; padding: 10px; margin: 8px 0; page-break-inside: avoid; }
  .fig p { margin: 6px 0 0; font-size: 10.5px; color: #485866; }
  .case { page-break-inside: avoid; }
  .pb { page-break-before: always; }
  svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  /* svg theme classes (light palette, matching the app) */
  .fill-concrete{fill:#e9eef3}.fill-paper{fill:#fbfcfd}.fill-capacity{fill:#2a78d6}.fill-demand{fill:#eb6834}
  .fill-ink{fill:#17222c}.fill-ink-2{fill:#485866}.fill-ink-3{fill:#75828e}
  .stroke-ink{stroke:#17222c}.stroke-ink-3{stroke:#75828e}.stroke-capacity{stroke:#2a78d6}.stroke-demand{stroke:#eb6834}
  .stroke-edge{stroke:#dde4ea}.stroke-edge-strong{stroke:#b9c4cd}
  .disclaimer { margin-top: 18px; padding-top: 8px; border-top: 1.5px solid #17222c; font-size: 10px; color: #485866; }
  @media print { body { padding: 0; } }
</style></head><body>

<h1>RCC Section Check — Calculation Report</h1>
<div class="meta">
  Design code: <b>${esc(spec.name)}</b> (${esc(spec.edition)}) &nbsp;·&nbsp;
  Date: ${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN')} &nbsp;·&nbsp;
  Method: ULS strain-compatibility interaction surface (biaxial P–M<sub>x</sub>–M<sub>y</sub>)
</div>

<h2>1 &nbsp;Input data</h2>
<div class="cols">
  <div>
    <h4>Materials & member</h4>
    <table class="calc">
      <tr><td>Concrete grade</td><td>M${state.fck} (f<sub>ck</sub> = ${state.fck} N/mm², 28-day cube)</td></tr>
      <tr><td>Steel grade</td><td>${esc(grade.label)} (f<sub>y</sub> = ${grade.fy} N/mm², IS 1786)</td></tr>
      <tr><td>Clear cover / tie ⌀</td><td>${state.cover} mm / ${state.tieDia} mm</td></tr>
      <tr><td>Unsupported length</td><td>${state.memberLength > 0 ? `${f(state.memberLength, 0)} mm` : 'not provided'}</td></tr>
      <tr><td>Partial factors</td><td>γ<sub>c</sub> = ${spec.gammaC}, γ<sub>s</sub> = ${spec.gammaS}</td></tr>
    </table>
    <h4>Load cases (factored)</h4>
    <table><tr><th>Case</th><th>Pu (kN)</th><th>Mux (kN·m)</th><th>Muy (kN·m)</th></tr>${caseRows}</table>
  </div>
  <div>
    <h4>Boundary vertices (mm)</h4>
    <table><tr><th>#</th><th>x</th><th>y</th></tr>${geoRows}</table>
    ${voidBlocks}
  </div>
  <div>
    <h4>Reinforcement (${state.bars.length} bars)</h4>
    <table><tr><th>#</th><th>x (mm)</th><th>y (mm)</th><th>⌀</th></tr>${barRows}</table>
  </div>
</div>

<h2>2 &nbsp;Section properties (centroidal)</h2>
<table class="calc">
  <tr><td>Gross area A<sub>g</sub></td><td>${f(props.area, 0)} mm²</td></tr>
  <tr><td>Centroid G (input coords)</td><td>(${f(props.cx, 1)}, ${f(props.cy, 1)}) mm</td></tr>
  <tr><td>I<sub>xx</sub> / I<sub>yy</sub> / I<sub>xy</sub></td><td>${f(props.Ixx / 1e6, 1)} / ${f(props.Iyy / 1e6, 1)} / ${f(props.Ixy / 1e6, 1)} ×10⁶ mm⁴</td></tr>
  <tr><td>Steel A<sub>sc</sub></td><td>${f(props.Asc, 0)} mm² &nbsp;(p = ${f(props.p, 2)}% of gross, ${props.barCount} bars)</td></tr>
  <tr><td>Bounding box</td><td>${f(props.bbox.xmax - props.bbox.xmin, 0)} × ${f(props.bbox.ymax - props.bbox.ymin, 0)} mm</td></tr>
</table>

<h2>3 &nbsp;Design material parameters (${esc(spec.name)})</h2>
<table class="calc">
  <tr><td>Concrete design curve</td><td>Parabola–rectangle: σ<sub>c</sub> = f<sub>cd</sub>·[1 − (1 − ε/ε<sub>c2</sub>)<sup>n</sup>], plateau to ε<sub>cu</sub></td></tr>
  <tr><td>f<sub>cd</sub></td><td>${f(conc.fcd, 2)} N/mm²</td></tr>
  <tr><td>ε<sub>c2</sub> / ε<sub>cu</sub> / n</td><td>${conc.ec2.toFixed(5)} / ${conc.ecu.toFixed(5)} / ${f(conc.n, 2)}</td></tr>
  <tr><td>Steel design stress</td><td>f<sub>yd</sub> = ${f(steel.fyd, 1)} N/mm²; E<sub>s</sub> = 200 000 N/mm²${steel.compressionCap ? `; compression capped at f<sub>yc</sub> = ${f(steel.compressionCap, 1)} N/mm² (IRS CBC Cl 15.6.3.3)` : ''}</td></tr>
  <tr><td>Strain-plane pivots</td><td>Pivot B: ε<sub>cu</sub> at extreme fibre (NA inside section); Pivot C: ε<sub>c2</sub> at (1 − ε<sub>c2</sub>/ε<sub>cu</sub>)·h from the compressed face (section fully compressed); steel tension cap ${spec.epsSteelLimit(grade).toFixed(3)}</td></tr>
  <tr><td>Surface mesh</td><td>${state.mesh.nTheta} neutral-axis orientations × ${state.mesh.nDepth + 1} strain profiles; exact Gauss scanline integration of the stress block over the polygon; displaced concrete deducted at compression bars</td></tr>
</table>

<h2>4 &nbsp;Axial & flexural section capacity</h2>
<table class="calc">
  <tr><td>Pure axial compression (rigorous, uniform ε<sub>c2</sub>)</td><td>P<sub>uz,rig</sub> = ${f(surface.Puz / 1e3, 0)} kN</td></tr>
  <tr><td>Simplified squash load (${esc(spec.name)})</td><td>P<sub>uz</sub> = ${f(PuzS / 1e3, 0)} kN</td></tr>
  <tr><td>Pure axial tension</td><td>P<sub>t</sub> = ${f(surface.Pt / 1e3, 0)} kN</td></tr>
  ${
    flex
      ? `<tr><td>Flexural capacity at P = 0 (pure bending)</td><td>
      +M<sub>x0</sub> = ${f(flex.MxPos / 1e6, 1)} kN·m; −M<sub>x0</sub> = ${f(flex.MxNeg / 1e6, 1)} kN·m;
      +M<sub>y0</sub> = ${f(flex.MyPos / 1e6, 1)} kN·m; −M<sub>y0</sub> = ${f(flex.MyNeg / 1e6, 1)} kN·m</td></tr>`
      : ''
  }
</table>

<h2>5 &nbsp;Load-case verification</h2>
${caseBlocks}
<p class="small">The rigorous utilisation (radial demand/capacity in the M<sub>x</sub>–M<sub>y</sub> plane at constant P<sub>u</sub>)
governs the verdict; the code's simplified power-law value is reported for traceability.</p>

<h2 class="pb">6 &nbsp;Figures ${sel ? `(case ${esc(sel.loadCase.name)})` : ''}</h2>
<div class="fig">${ctx.svgs.section}<p>Section with reinforcement, centroidal axes${sel && !sel.axialGoverned ? ', governing neutral axis and compression zone at the capacity state' : ''}.</p></div>
<div class="fig">${svgs.pm}<p>P–M interaction diagram along the selected case's moment direction, all load cases overlaid.</p></div>
<div class="fig">${svgs.contour}<p>M<sub>x</sub>–M<sub>y</sub> capacity contour at the selected case's axial load with the demand point and utilisation ray.</p></div>

<h2>7 &nbsp;Interaction diagram data</h2>
<div class="cols">
  <div>
    <h4>P–M capacity curve (θ<sub>M</sub> = ${f((thetaM * 180) / Math.PI, 1)}°)</h4>
    <table><tr><th>P (kN)</th><th>M<sub>Rd</sub> (kN·m)</th></tr>${curveTable}</table>
  </div>
  <div>
    <h4>M<sub>x</sub>–M<sub>y</sub> contour ${sel ? `at P = ${f(sel.loadCase.Pu, 0)} kN` : ''}</h4>
    <table><tr><th>NA angle θ (°)</th><th>M<sub>x</sub> (kN·m)</th><th>M<sub>y</sub> (kN·m)</th></tr>${contourTable}</table>
  </div>
</div>

<h2>8 &nbsp;Code compliance (${esc(spec.name)})</h2>
<table><tr><th>Clause</th><th>Check</th><th>Computed</th><th>Limit</th><th>Status</th></tr>${checkRows}</table>

<div class="disclaimer">
  <b>Method statement.</b> Plane sections remain plane; concrete tension ignored; concrete and steel follow the
  design stress–strain relations of the selected code with the partial factors above; ultimate strain planes fan
  about the code pivot points; section resultants are integrated exactly over the boundary polygon (voids negative)
  by Gauss scanline quadrature; discrete bars contribute A<sub>b</sub>·(σ<sub>s</sub> − σ<sub>c,displaced</sub>).
  Loads are entered already factored; second-order/slenderness moments are the analyst's responsibility.<br><br>
  <b>Disclaimer.</b> This report is generated by a design aid. Responsibility for the adequacy of the design, the
  applicability of the selected code and the interpretation of its clauses remains with the engineer of record.
</div>

</body></html>`

  const win = window.open('', '_blank')
  if (!win) {
    window.alert('Popup blocked — allow popups for this site to export the PDF report.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.document.title = 'RCC-Section-Check-Report'
  window.setTimeout(() => {
    win.focus()
    win.print()
  }, 450)
}
