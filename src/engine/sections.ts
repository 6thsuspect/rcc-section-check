import type { Point, Rebar, SectionGeometry } from './types'
import { faceOffsets, uniformCover, type CoverSpec, type FaceOffsets } from './cover'

/**
 * Predefined parametric sections. Each generator returns an ordinary
 * boundary/void/bar model — the user can edit everything afterwards.
 * All dimensions mm. Bar offset rule (docs/04 §4.2): every bar is set back from
 * the concrete face it lies against by
 *   offset(face) = cover(face) + tieDia + barDia/2
 * where cover(face) is that face's nominal clear cover — entered independently
 * for bottom / right / top / left, plus separate values for void faces.
 */

export interface BarLayoutOpts {
  /** Per-face nominal clear cover, mm. A bare number = all faces equal. */
  cover: CoverSpec | number
  tieDia: number
  barDia: number
}

export type CoverInput = CoverSpec | number

export function toCoverSpec(cover: CoverInput): CoverSpec {
  return typeof cover === 'number' ? uniformCover(cover) : cover
}

/** Bar-centre offsets per face (cover + link dia + half bar dia). */
export function layoutOffsets(opts: BarLayoutOpts): FaceOffsets {
  return faceOffsets(toCoverSpec(opts.cover), opts.tieDia, opts.barDia)
}

export type PredefinedSection =
  | { kind: 'rect'; B: number; D: number; nx: number; ny: number }
  | { kind: 'circle'; D: number; nBars: number }
  | { kind: 'tee'; bf: number; tf: number; bw: number; D: number; nFlange: number; nWeb: number }
  | { kind: 'ishape'; bf1: number; tf1: number; bf2: number; tf2: number; tw: number; D: number; nFlange: number; nWeb: number }
  | { kind: 'angle'; B: number; D: number; tw: number; tf: number }
  | { kind: 'box'; B: number; D: number; tw: number; tf: number; nx: number; ny: number }
  | { kind: 'hollowCircle'; Do: number; Di: number; nBars: number; innerRing: boolean }

export interface GeneratedSection {
  geometry: SectionGeometry
  bars: Rebar[]
  /** Shape class used by the simplified biaxial exponent rules. */
  shapeClass: 'rect' | 'circ'
}

function circlePoly(cx: number, cy: number, r: number, nSeg = 64): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < nSeg; i++) {
    const a = (2 * Math.PI * i) / nSeg
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return pts
}

function barsOnLine(p1: Point, p2: Point, n: number, dia: number, includeEnds: boolean): Rebar[] {
  if (n <= 0) return []
  const out: Rebar[] = []
  if (includeEnds && n === 1) {
    return [{ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, dia }]
  }
  for (let i = 0; i < n; i++) {
    const t = includeEnds ? i / (n - 1) : (i + 1) / (n + 1)
    out.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y), dia })
  }
  return out
}

export function barsOnRing(cx: number, cy: number, r: number, n: number, dia: number, startAngle = 0): Rebar[] {
  const out: Rebar[] = []
  for (let i = 0; i < n; i++) {
    const a = startAngle + (2 * Math.PI * i) / n
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), dia })
  }
  return out
}

export function generateSection(def: PredefinedSection, opts: BarLayoutOpts): GeneratedSection {
  const dia = opts.barDia
  const { outer: o, inner: vi, radial, radialInner } = layoutOffsets(opts)

  switch (def.kind) {
    case 'rect': {
      const { B, D, nx, ny } = def
      const geometry: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: B, y: 0 },
          { x: B, y: D },
          { x: 0, y: D },
        ],
        voids: [],
      }
      const xl = o.left
      const xr = B - o.right
      const yb = o.bottom
      const yt = D - o.top
      const bars: Rebar[] = [
        ...barsOnLine({ x: xl, y: yb }, { x: xr, y: yb }, Math.max(2, nx), dia, true),
        ...barsOnLine({ x: xl, y: yt }, { x: xr, y: yt }, Math.max(2, nx), dia, true),
        ...barsOnLine({ x: xl, y: yb }, { x: xl, y: yt }, ny, dia, false),
        ...barsOnLine({ x: xr, y: yb }, { x: xr, y: yt }, ny, dia, false),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'circle': {
      const { D, nBars } = def
      const R = D / 2
      return {
        geometry: { boundary: circlePoly(0, 0, R), voids: [] },
        bars: barsOnRing(0, 0, R - radial, Math.max(6, nBars), dia, Math.PI / 2),
        shapeClass: 'circ',
      }
    }

    case 'tee': {
      const { bf, tf, bw, D, nFlange, nWeb } = def
      const wl = (bf - bw) / 2
      const geometry: SectionGeometry = {
        boundary: [
          { x: wl, y: 0 },
          { x: wl + bw, y: 0 },
          { x: wl + bw, y: D - tf },
          { x: bf, y: D - tf },
          { x: bf, y: D },
          { x: 0, y: D },
          { x: 0, y: D - tf },
          { x: wl, y: D - tf },
        ],
        voids: [],
      }
      const yFl = D - tf // flange underside — the face the tip bars sit above
      const bars: Rebar[] = [
        // flange top face
        ...barsOnLine({ x: o.left, y: D - o.top }, { x: bf - o.right, y: D - o.top }, Math.max(2, nFlange), dia, true),
        // flange soffit tips: set back from the side faces and from the flange underside
        { x: o.left, y: yFl + o.bottom, dia },
        { x: bf - o.right, y: yFl + o.bottom, dia },
        // web verticals, bottom corners included; top ends sit below the flange
        ...barsOnLine(
          { x: wl + o.left, y: o.bottom },
          { x: wl + o.left, y: yFl - o.top },
          Math.max(2, nWeb),
          dia,
          true,
        ),
        ...barsOnLine(
          { x: wl + bw - o.right, y: o.bottom },
          { x: wl + bw - o.right, y: yFl - o.top },
          Math.max(2, nWeb),
          dia,
          true,
        ),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'ishape': {
      const { bf1, tf1, bf2, tf2, tw, D, nFlange, nWeb } = def
      const bmax = Math.max(bf1, bf2)
      const t1 = (bmax - bf1) / 2 // top flange left offset
      const b1 = (bmax - bf2) / 2 // bottom flange left offset
      const wl = (bmax - tw) / 2
      const geometry: SectionGeometry = {
        boundary: [
          { x: b1, y: 0 },
          { x: b1 + bf2, y: 0 },
          { x: b1 + bf2, y: tf2 },
          { x: wl + tw, y: tf2 },
          { x: wl + tw, y: D - tf1 },
          { x: t1 + bf1, y: D - tf1 },
          { x: t1 + bf1, y: D },
          { x: t1, y: D },
          { x: t1, y: D - tf1 },
          { x: wl, y: D - tf1 },
          { x: wl, y: tf2 },
          { x: b1, y: tf2 },
        ],
        voids: [],
      }
      const bars: Rebar[] = [
        ...barsOnLine(
          { x: t1 + o.left, y: D - o.top },
          { x: t1 + bf1 - o.right, y: D - o.top },
          Math.max(2, nFlange),
          dia,
          true,
        ),
        ...barsOnLine(
          { x: b1 + o.left, y: o.bottom },
          { x: b1 + bf2 - o.right, y: o.bottom },
          Math.max(2, nFlange),
          dia,
          true,
        ),
        // web bars run between the flange inner faces: bottom end above the
        // bottom flange, top end below the top flange
        ...barsOnLine({ x: wl + o.left, y: tf2 + o.bottom }, { x: wl + o.left, y: D - tf1 - o.top }, nWeb, dia, false),
        ...barsOnLine(
          { x: wl + tw - o.right, y: tf2 + o.bottom },
          { x: wl + tw - o.right, y: D - tf1 - o.top },
          nWeb,
          dia,
          false,
        ),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'angle': {
      const { B, D, tw, tf } = def
      const geometry: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: B, y: 0 },
          { x: B, y: tf },
          { x: tw, y: tf },
          { x: tw, y: D },
          { x: 0, y: D },
        ],
        voids: [],
      }
      const bars: Rebar[] = [
        // vertical leg — outer face at x = 0, inner face at x = tw
        ...barsOnLine({ x: o.left, y: o.bottom }, { x: o.left, y: D - o.top }, 3, dia, true),
        ...barsOnLine({ x: tw - o.right, y: tf + o.bottom }, { x: tw - o.right, y: D - o.top }, 2, dia, true),
        // horizontal leg (heel bar shared corner region)
        ...barsOnLine({ x: tw + o.left, y: o.bottom }, { x: B - o.right, y: o.bottom }, 2, dia, true),
        ...barsOnLine({ x: tw + o.left, y: tf - o.top }, { x: B - o.right, y: tf - o.top }, 2, dia, true),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'box': {
      const { B, D, tw, tf, nx, ny } = def
      const geometry: SectionGeometry = {
        boundary: [
          { x: 0, y: 0 },
          { x: B, y: 0 },
          { x: B, y: D },
          { x: 0, y: D },
        ],
        voids: [
          [
            { x: tw, y: tf },
            { x: B - tw, y: tf },
            { x: B - tw, y: D - tf },
            { x: tw, y: D - tf },
          ],
        ],
      }
      const nxi = Math.max(2, nx)
      // Void-face keys name the void face the lining bars are set back from, which
      // is exactly how the cover audit classifies a bar (see cover.ts): the bars
      // hanging below the void's bottom face use inner.bottom, those above the
      // void's top face use inner.top, and the cell walls use inner.left / right.
      const vb = tf - vi.bottom // bottom slab, lining the void soffit
      const vt = D - tf + vi.top // top slab, lining the void ceiling
      const vl = tw - vi.left // left cell wall
      const vr = B - tw + vi.right // right cell wall
      const bars: Rebar[] = [
        // outer ring
        ...barsOnLine({ x: o.left, y: o.bottom }, { x: B - o.right, y: o.bottom }, nxi, dia, true),
        ...barsOnLine({ x: o.left, y: D - o.top }, { x: B - o.right, y: D - o.top }, nxi, dia, true),
        ...barsOnLine({ x: o.left, y: o.bottom }, { x: o.left, y: D - o.top }, ny, dia, false),
        ...barsOnLine({ x: B - o.right, y: o.bottom }, { x: B - o.right, y: D - o.top }, ny, dia, false),
        // inner ring (void-side faces)
        ...barsOnLine({ x: vl, y: vb }, { x: vr, y: vb }, nxi, dia, true),
        ...barsOnLine({ x: vl, y: vt }, { x: vr, y: vt }, nxi, dia, true),
        ...barsOnLine({ x: vl, y: vb }, { x: vl, y: vt }, ny, dia, false),
        ...barsOnLine({ x: vr, y: vb }, { x: vr, y: vt }, ny, dia, false),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'hollowCircle': {
      const { Do, Di, nBars, innerRing } = def
      const Ro = Do / 2
      const Ri = Di / 2
      const bars: Rebar[] = barsOnRing(0, 0, Ro - radial, Math.max(6, nBars), dia, Math.PI / 2)
      if (innerRing) bars.push(...barsOnRing(0, 0, Ri + radialInner, Math.max(6, nBars), dia, Math.PI / 2 + Math.PI / nBars))
      return {
        geometry: { boundary: circlePoly(0, 0, Ro), voids: [circlePoly(0, 0, Ri)] },
        bars,
        shapeClass: 'circ',
      }
    }
  }
}

export const SHAPE_LABELS: Record<PredefinedSection['kind'], string> = {
  rect: 'Rectangle',
  circle: 'Circle',
  tee: 'Tee',
  ishape: 'I-shape',
  angle: 'Angle (L)',
  box: 'Box',
  hollowCircle: 'Hollow circle',
}

export function defaultPredefined(kind: PredefinedSection['kind']): PredefinedSection {
  switch (kind) {
    case 'rect':
      return { kind, B: 450, D: 600, nx: 3, ny: 2 }
    case 'circle':
      return { kind, D: 600, nBars: 8 }
    case 'tee':
      return { kind, bf: 1200, tf: 200, bw: 300, D: 900, nFlange: 6, nWeb: 3 }
    case 'ishape':
      return { kind, bf1: 500, tf1: 150, bf2: 500, tf2: 150, tw: 200, D: 900, nFlange: 4, nWeb: 3 }
    case 'angle':
      return { kind, B: 600, D: 600, tw: 200, tf: 200 }
    case 'box':
      return { kind, B: 1200, D: 1200, tw: 250, tf: 250, nx: 5, ny: 3 }
    case 'hollowCircle':
      return { kind, Do: 1200, Di: 700, nBars: 12, innerRing: false }
  }
}
