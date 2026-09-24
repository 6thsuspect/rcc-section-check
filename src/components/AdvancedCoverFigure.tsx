import type { Point, SectionGeometry } from '../engine/types'
import {
  faceFromNormal,
  FACE_LABELS,
  getCoverForFace,
  inboundNormal,
  innerCover,
  outerCover,
  type CoverAudit,
  type CoverSpec,
  type SectionCoverType,
} from '../engine/cover'
import { signedArea } from '../engine/geometry'
import type { ActiveFace } from './CoverPanel'

const FONT = "Bahnschrift, 'Avenir Next', 'Segoe UI', sans-serif"
const W = 320
const H = 250
const PAD = 50
const LABEL_FS = 9.5

/**
 * Cover value of one face exactly as the matching Advanced Cover input shows it
 * (same numbering and orientation as the fields in ClearCoverPanel).
 */
export function faceCoverForInput(
  cover: CoverSpec,
  geometry: SectionGeometry,
  sectionType: SectionCoverType,
  surface: 'outer' | 'inner',
  faceIndex: number,
  voidIndex = 0,
): number {
  if (sectionType === 'circle' || sectionType === 'hollow-circle') {
    if (surface === 'outer') return cover.uniformOuterCover ?? outerCover(cover, 'bottom')
    return cover.uniformInnerCover ?? innerCover(cover, 'bottom')
  }
  if (sectionType === 'rectangular' && surface === 'outer') {
    const poly = geometry.boundary
    const a = poly[faceIndex]
    const b = poly[(faceIndex + 1) % poly.length]
    const nrm = inboundNormal(a, b, signedArea(poly) >= 0)
    return outerCover(cover, faceFromNormal(nrm.x, nrm.y))
  }
  return getCoverForFace(cover, surface, faceIndex, voidIndex, geometry)
}

/** Name of a face as used by the Advanced Cover inputs. */
export function faceName(
  geometry: SectionGeometry,
  sectionType: SectionCoverType,
  surface: 'outer' | 'inner',
  faceIndex: number,
  voidIndex = 0,
): string {
  if (sectionType === 'rectangular' && surface === 'outer') {
    const poly = geometry.boundary
    const a = poly[faceIndex]
    const b = poly[(faceIndex + 1) % poly.length]
    const nrm = inboundNormal(a, b, signedArea(poly) >= 0)
    return FACE_LABELS[faceFromNormal(nrm.x, nrm.y)]
  }
  if (surface === 'outer') return `F${faceIndex + 1}`
  return geometry.voids.length > 1 ? `V${voidIndex + 1}F${faceIndex + 1}` : `VF${faceIndex + 1}`
}

interface Line {
  a: Point
  b: Point
}

/** Intersection of two infinite lines, or null when (nearly) parallel. */
function intersect(l1: Line, l2: Line): Point | null {
  const d1 = { x: l1.b.x - l1.a.x, y: l1.b.y - l1.a.y }
  const d2 = { x: l2.b.x - l2.a.x, y: l2.b.y - l2.a.y }
  const den = d1.x * d2.y - d1.y * d2.x
  const L = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)
  if (Math.abs(den) < 1e-6 * L) return null
  const t = ((l2.a.x - l1.a.x) * d2.y - (l2.a.y - l1.a.y) * d2.x) / den
  return { x: l1.a.x + t * d1.x, y: l1.a.y + t * d1.y }
}

/**
 * Offset every edge of a ring by its own cover into the concrete and trim the
 * offset lines against their neighbours → the clear-cover line of each face.
 * `intoConcrete` is +1 for the outer boundary (offset inward) and −1 for a
 * void (offset away from the hole).
 */
function coverLines(poly: Point[], covers: number[], intoConcrete: 1 | -1): { seg: Line; normal: Point }[] {
  const n = poly.length
  const ccw = signedArea(poly) >= 0
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n]
    const nr = inboundNormal(a, b, ccw)
    const k = covers[i] * intoConcrete
    return {
      line: { a: { x: a.x + nr.x * k, y: a.y + nr.y * k }, b: { x: b.x + nr.x * k, y: b.y + nr.y * k } },
      normal: { x: nr.x * intoConcrete, y: nr.y * intoConcrete },
    }
  })
  return lines.map((cur, i) => {
    const prev = lines[(i - 1 + n) % n]
    const next = lines[(i + 1) % n]
    const s = intersect(prev.line, cur.line) ?? cur.line.a
    const e = intersect(cur.line, next.line) ?? cur.line.b
    return { seg: { a: s, b: e }, normal: cur.normal }
  })
}

interface LabelBox {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (p: LabelBox, q: LabelBox) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

/**
 * Advanced Cover section figure. Draws the actual concrete outline of the
 * selected section (true shape and proportions — rectangular, circular, T, I,
 * L, box, hollow circle or any custom polygon) with, for every applicable
 * face, a dashed clear-cover line offset by that face's cover and a dashed
 * guide/dimension line from the face. Face names and cover values sit outside
 * the concrete. Reinforcement is deliberately not drawn.
 */
export function AdvancedCoverFigure({
  geometry,
  cover,
  sectionType,
  audit,
  activeFace,
  setActiveFace,
}: {
  geometry: SectionGeometry
  cover: CoverSpec
  sectionType: SectionCoverType
  audit?: CoverAudit | null
  activeFace?: ActiveFace | null
  setActiveFace?: (face: ActiveFace | null) => void
}) {
  const poly = geometry.boundary
  if (poly.length < 3) return null
  const circular = sectionType === 'circle' || sectionType === 'hollow-circle'
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  const scale = Math.min((W - 2 * PAD) / Math.max(1, xmax - xmin), (H - 2 * PAD) / Math.max(1, ymax - ymin))
  const ox = (W - (xmax - xmin) * scale) / 2
  const oy = (H - (ymax - ymin) * scale) / 2
  const X = (x: number) => ox + (x - xmin) * scale
  const Y = (y: number) => H - oy - (y - ymin) * scale
  const pts = (p: Point[]) => p.map((q) => `${X(q.x).toFixed(2)},${Y(q.y).toFixed(2)}`).join(' ')
  // keep a hairline gap between the face and its cover line even for very small covers
  const minInset = 2.5 / scale
  const shown = (c: number) => (c > 0 ? Math.max(c, minInset) : 0)

  const shortKeys = new Set(
    (audit?.bars ?? []).filter((s) => !s.ok).map((s) => `${s.surface}:${s.voidIndex ?? 0}:${s.faceIndex ?? -1}`),
  )
  const isActive = (surface: 'outer' | 'inner', faceIndex: number, voidIndex = 0) =>
    !!activeFace &&
    activeFace.surface === surface &&
    (circular || activeFace.faceIndex === faceIndex) &&
    (surface === 'outer' || (activeFace.voidIndex ?? 0) === voidIndex)

  const dashed: { seg: Line; key: string; active: boolean; bad: boolean }[] = []
  const guides: { from: Point; to: Point; ext: Point; key: string; active: boolean; bad: boolean }[] = []
  const labels: {
    x: number
    y: number
    anchor: 'start' | 'middle' | 'end'
    name: string
    value: number
    key: string
    face: ActiveFace
    active: boolean
    bad: boolean
  }[] = []
  const placed: LabelBox[] = []

  // screen-space box of the concrete, so outer labels never sit on the section
  const concreteBox: LabelBox = { x: X(xmin), y: Y(ymax), w: (xmax - xmin) * scale, h: (ymax - ymin) * scale }

  const placeLabel = (
    anchorPt: { x: number; y: number },
    dir: { x: number; y: number },
    name: string,
    value: number,
    avoid: LabelBox[],
    minPush: number,
  ) => {
    const text = `${name} ${value}`
    const w = text.length * LABEL_FS * 0.64 + 4
    const h = LABEL_FS + 3
    const anchor: 'start' | 'middle' | 'end' = Math.abs(dir.x) > 0.45 ? (dir.x > 0 ? 'start' : 'end') : 'middle'
    // candidates: push further out along the face normal, or slide along the face
    // (needed inside narrow voids where pushing inward only meets the opposite label)
    const tan = { x: -dir.y, y: dir.x }
    const step = anchor === 'middle' ? w / 2 + 3 : h + 2
    const cands: { push: number; shift: number; cost: number }[] = []
    for (let push = minPush; push < minPush + 80; push += 4)
      for (const k of [0, 1, -1, 2, -2]) cands.push({ push, shift: k * step, cost: push - minPush + Math.abs(k) * 7 })
    cands.sort((p, q) => p.cost - q.cost)
    for (const c of cands) {
      const x = anchorPt.x + dir.x * c.push + tan.x * c.shift
      const y = anchorPt.y + dir.y * c.push + tan.y * c.shift
      const bx = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
      const box = { x: bx, y: y - h / 2, w, h }
      if (!placed.some((p) => overlaps(p, box)) && !avoid.some((p) => overlaps(p, box))) {
        placed.push(box)
        return { x, y, anchor }
      }
    }
    const x = anchorPt.x + dir.x * minPush
    const y = anchorPt.y + dir.y * minPush
    return { x, y, anchor }
  }

  if (circular) {
    // a circle is one face all round: one dashed ring, one radial guide, one label
    const cxm = (xmin + xmax) / 2
    const cym = (ymin + ymax) / 2
    const R = (xmax - xmin) / 2
    const c = faceCoverForInput(cover, geometry, sectionType, 'outer', 0)
    const ang = Math.PI / 4
    const dir = { x: Math.cos(ang), y: Math.sin(ang) }
    const face = { x: cxm + R * dir.x, y: cym + R * dir.y }
    const inner = { x: cxm + (R - shown(c)) * dir.x, y: cym + (R - shown(c)) * dir.y }
    const active = isActive('outer', 0)
    const bad = [...shortKeys].some((k) => k.startsWith('outer:'))
    guides.push({ from: inner, to: face, ext: { x: face.x + (14 / scale) * dir.x, y: face.y + (14 / scale) * dir.y }, key: 'o', active, bad })
    const at = placeLabel({ x: X(face.x), y: Y(face.y) }, { x: dir.x, y: -dir.y }, 'Outer', c, [concreteBox], 18)
    labels.push({ ...at, name: 'Outer', value: c, key: 'o', face: { surface: 'outer', faceIndex: 0 }, active, bad })
    const ringR = Math.max(0, R - shown(c))
    dashed.push({
      seg: { a: { x: cxm, y: cym }, b: { x: ringR, y: 0 } },
      key: 'ring-o',
      active,
      bad,
    })
    geometry.voids.forEach((v, vi) => {
      if (v.length < 3) return
      const vx = v.map((p) => p.x)
      const Ri = (Math.max(...vx) - Math.min(...vx)) / 2
      const vcx = (Math.max(...vx) + Math.min(...vx)) / 2
      const vcy = (Math.max(...v.map((p) => p.y)) + Math.min(...v.map((p) => p.y))) / 2
      const ci = faceCoverForInput(cover, geometry, sectionType, 'inner', 0, vi)
      const a2 = (5 * Math.PI) / 4
      const d2 = { x: Math.cos(a2), y: Math.sin(a2) }
      const f2 = { x: vcx + Ri * d2.x, y: vcy + Ri * d2.y }
      const o2 = { x: vcx + (Ri + shown(ci)) * d2.x, y: vcy + (Ri + shown(ci)) * d2.y }
      const act = isActive('inner', 0, vi)
      const bd = [...shortKeys].some((k) => k.startsWith(`inner:${vi}:`))
      guides.push({ from: o2, to: f2, ext: { x: vcx, y: vcy }, key: `i${vi}`, active: act, bad: bd })
      labels.push({
        x: X(vcx),
        y: Y(vcy),
        anchor: 'middle',
        name: 'Inner',
        value: ci,
        key: `i${vi}`,
        face: { surface: 'inner', faceIndex: 0, voidIndex: vi },
        active: act,
        bad: bd,
      })
      dashed.push({ seg: { a: { x: vcx, y: vcy }, b: { x: Ri + shown(ci), y: 0 } }, key: `ring-i${vi}`, active: act, bad: bd })
    })
  } else {
    const oc = poly.map((_, i) => faceCoverForInput(cover, geometry, sectionType, 'outer', i))
    const segs = coverLines(poly, oc.map(shown), 1)
    segs.forEach(({ seg, normal }, i) => {
      if (!(oc[i] > 0)) return
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const active = isActive('outer', i)
      const bad = shortKeys.has(`outer:0:${i}`)
      dashed.push({ seg, key: `o${i}`, active, bad })
      // guide / dimension line: from the cover line, through the face, out to the label
      const inner = { x: mid.x + normal.x * shown(oc[i]), y: mid.y + normal.y * shown(oc[i]) }
      const ext = { x: mid.x - normal.x * (10 / scale), y: mid.y - normal.y * (10 / scale) }
      guides.push({ from: inner, to: mid, ext, key: `o${i}`, active, bad })
      const name = faceName(geometry, sectionType, 'outer', i)
      const out = { x: -normal.x, y: normal.y } // outward, in screen coordinates
      const at = placeLabel({ x: X(mid.x), y: Y(mid.y) }, out, name, oc[i], [], 14)
      labels.push({ ...at, name, value: oc[i], key: `o${i}`, face: { surface: 'outer', faceIndex: i }, active, bad })
    })
    geometry.voids.forEach((v, vi) => {
      if (v.length < 3) return
      const ic = v.map((_, i) => faceCoverForInput(cover, geometry, sectionType, 'inner', i, vi))
      const vsegs = coverLines(v, ic.map(shown), -1)
      vsegs.forEach(({ seg, normal }, i) => {
        if (!(ic[i] > 0)) return
        const a = v[i]
        const b = v[(i + 1) % v.length]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const active = isActive('inner', i, vi)
        const bad = shortKeys.has(`inner:${vi}:${i}`)
        dashed.push({ seg, key: `v${vi}-${i}`, active, bad })
        const inner = { x: mid.x + normal.x * shown(ic[i]), y: mid.y + normal.y * shown(ic[i]) }
        const ext = { x: mid.x - normal.x * (8 / scale), y: mid.y - normal.y * (8 / scale) }
        guides.push({ from: inner, to: mid, ext, key: `v${vi}-${i}`, active, bad })
        const name = faceName(geometry, sectionType, 'inner', i, vi)
        // void labels sit inside the hole (outside the concrete), stepped in from the face
        const into = { x: -normal.x, y: normal.y }
        const at = placeLabel({ x: X(mid.x), y: Y(mid.y) }, into, name, ic[i], [], 12)
        labels.push({ ...at, name, value: ic[i], key: `v${vi}-${i}`, face: { surface: 'inner', faceIndex: i, voidIndex: vi }, active, bad })
      })
    })
  }

  const col = (active: boolean, bad: boolean) =>
    bad ? 'var(--color-bad)' : active ? 'var(--color-accent)' : 'var(--color-ok)'

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto block w-full max-w-[360px]"
      role="img"
      aria-label="Advanced cover — section outline with the clear cover of each face"
      data-testid="advanced-cover-figure"
    >
      {/* concrete outline only — reinforcement is intentionally not drawn */}
      <path
        d={
          `M${pts(poly).replace(/ /g, ' L')} Z ` +
          geometry.voids.map((v) => (v.length >= 3 ? `M${pts(v).replace(/ /g, ' L')} Z` : '')).join(' ')
        }
        fillRule="evenodd"
        className="fill-concrete stroke-ink"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* clear-cover lines, dashed, one per face */}
      {dashed.map((l) =>
        l.key.startsWith('ring-') ? (
          <circle
            key={l.key}
            cx={X(l.seg.a.x)}
            cy={Y(l.seg.a.y)}
            r={l.seg.b.x * scale}
            fill="none"
            stroke={col(l.active, l.bad)}
            strokeWidth={l.active ? 1.6 : 1.1}
            strokeDasharray="4 3"
            data-cover-line={l.key}
          />
        ) : (
          <line
            key={l.key}
            x1={X(l.seg.a.x)}
            y1={Y(l.seg.a.y)}
            x2={X(l.seg.b.x)}
            y2={Y(l.seg.b.y)}
            stroke={col(l.active, l.bad)}
            strokeWidth={l.active ? 1.6 : 1.1}
            strokeDasharray="4 3"
            data-cover-line={l.key}
          />
        ),
      )}

      {/* guide / dimension lines from each face, with ticks at the face and at the cover line */}
      {guides.map((g) => {
        const fx = X(g.to.x)
        const fy = Y(g.to.y)
        const ix = X(g.from.x)
        const iy = Y(g.from.y)
        const ex = X(g.ext.x)
        const ey = Y(g.ext.y)
        const L = Math.hypot(ex - ix, ey - iy) || 1
        const tx = (-(ey - iy) / L) * 3
        const ty = ((ex - ix) / L) * 3
        const c = col(g.active, g.bad)
        return (
          <g key={`g-${g.key}`}>
            <line x1={ix} y1={iy} x2={ex} y2={ey} stroke={c} strokeWidth="0.8" strokeDasharray="2 2" />
            <line x1={ix - tx} y1={iy - ty} x2={ix + tx} y2={iy + ty} stroke={c} strokeWidth="1" />
            <line x1={fx - tx} y1={fy - ty} x2={fx + tx} y2={fy + ty} stroke={c} strokeWidth="1" />
          </g>
        )
      })}

      {/* face names + cover values, outside the concrete */}
      {labels.map((t) => (
        <text
          key={`t-${t.key}`}
          x={t.x}
          y={t.y}
          fontSize={LABEL_FS}
          fontFamily={FONT}
          textAnchor={t.anchor}
          dominantBaseline="middle"
          paintOrder="stroke"
          stroke="var(--color-panel, #f5f7f9)"
          strokeWidth="3"
          style={{ cursor: setActiveFace ? 'pointer' : undefined }}
          onMouseEnter={() => setActiveFace?.(t.face)}
          onMouseLeave={() => setActiveFace?.(null)}
          onClick={() => setActiveFace?.(t.face)}
        >
          <tspan fontWeight="700" fill={t.active ? 'var(--color-accent)' : 'var(--color-ink-2)'}>
            {t.name}
          </tspan>
          <tspan dx="3" fontWeight="600" fill={col(t.active, t.bad)}>
            {t.value}
          </tspan>
        </text>
      ))}
    </svg>
  )
}
