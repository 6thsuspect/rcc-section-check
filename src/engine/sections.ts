import type {
  Point,
  Rebar,
  RebarFace,
  RebarSurface,
  SectionGeometry,
} from './types'
import { COVER_FACES, barOffset, faceOffsets, getCoverForFace, uniformCover, type CoverSpec, type FaceOffsets } from './cover'

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

interface LinePlacement {
  face?: RebarFace
  surface?: RebarSurface
  voidIndex?: number
  /** Faces meeting the start/end of a line, used for corner bars. */
  startFaces?: RebarFace[]
  endFaces?: RebarFace[]
  faceIndex?: number
  startFaceIndex?: number
  endFaceIndex?: number
  layer?: number
  groupId?: string
}

interface BarPlacement {
  faces?: RebarFace[]
  face?: RebarFace
  surface?: RebarSurface
  voidIndex?: number
  faceIndex?: number
  secondaryFaceIndex?: number
  startFaceIndex?: number
  endFaceIndex?: number
  faceIndices?: number[]
  layer?: number
  groupId?: string
  axis?: 'x' | 'y'
  u?: number
  radial?: boolean
}

function automaticBar(x: number, y: number, dia: number, placement: BarPlacement = {}): Rebar {
  const faces = placement.faces?.length ? [...new Set(placement.faces)] : placement.face ? [placement.face] : undefined
  const faceIndices = placement.faceIndices?.length
    ? [...new Set(placement.faceIndices)]
    : placement.faceIndex !== undefined
      ? [placement.faceIndex, ...(placement.secondaryFaceIndex !== undefined ? [placement.secondaryFaceIndex] : [])]
      : undefined

  return {
    x,
    y,
    dia,
    positioning: 'automatic',
    face: placement.face ?? faces?.[0],
    faces,
    faceIndex: placement.faceIndex ?? faceIndices?.[0],
    secondaryFaceIndex: placement.secondaryFaceIndex,
    startFaceIndex: placement.startFaceIndex,
    endFaceIndex: placement.endFaceIndex,
    faceIndices,
    surface: placement.surface ?? 'outer',
    voidIndex: placement.voidIndex,
    layer: placement.layer,
    groupId: placement.groupId,
    axis: placement.axis,
    u: placement.u,
    radial: placement.radial,
  }
}

function barsOnLine(
  p1: Point,
  p2: Point,
  n: number,
  dia: number,
  includeEnds: boolean,
  placement: LinePlacement,
): Rebar[] {
  if (n <= 0) return []
  const out: Rebar[] = []
  const axis: 'x' | 'y' = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? 'x' : 'y'
  if (includeEnds && n === 1) {
    return [
      automaticBar(
        (p1.x + p2.x) / 2,
        (p1.y + p2.y) / 2,
        dia,
        {
          faces: placement.face ? [placement.face] : undefined,
          face: placement.face,
          faceIndex: placement.faceIndex,
          secondaryFaceIndex: placement.startFaceIndex,
          startFaceIndex: placement.startFaceIndex,
          endFaceIndex: placement.endFaceIndex,
          surface: placement.surface,
          voidIndex: placement.voidIndex,
          layer: placement.layer,
          groupId: placement.groupId,
          axis,
          u: 0.5,
        },
      ),
    ]
  }
  for (let i = 0; i < n; i++) {
    const t = includeEnds ? i / (n - 1) : (i + 1) / (n + 1)
    const endpointFaces = t <= 1e-9 ? placement.startFaces ?? [] : t >= 1 - 1e-9 ? placement.endFaces ?? [] : []
    const secFaceIdx = t <= 1e-9 ? placement.startFaceIndex : t >= 1 - 1e-9 ? placement.endFaceIndex : undefined

    out.push(
      automaticBar(p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y), dia, {
        faces: placement.face ? [placement.face, ...endpointFaces] : undefined,
        face: placement.face,
        faceIndex: placement.faceIndex,
        secondaryFaceIndex: secFaceIdx,
        startFaceIndex: placement.startFaceIndex,
        endFaceIndex: placement.endFaceIndex,
        surface: placement.surface,
        voidIndex: placement.voidIndex,
        layer: placement.layer,
        groupId: placement.groupId,
        axis,
        u: t,
      }),
    )
  }
  return out
}

export function barsOnRing(
  cx: number,
  cy: number,
  r: number,
  n: number,
  dia: number,
  startAngle = 0,
  placement: Omit<BarPlacement, 'axis' | 'u'> = {},
): Rebar[] {
  const out: Rebar[] = []
  for (let i = 0; i < n; i++) {
    const a = startAngle + (2 * Math.PI * i) / n
    out.push(
      automaticBar(cx + r * Math.cos(a), cy + r * Math.sin(a), dia, {
        ...placement,
        faces: placement.faces ?? COVER_FACES,
        radial: placement.radial ?? true,
      }),
    )
  }
  return out
}

export function generateSection(def: PredefinedSection, opts: BarLayoutOpts): GeneratedSection {
  const dia = opts.barDia
  const coverSpec = toCoverSpec(opts.cover)
  const tieDia = opts.tieDia
  const { radial, radialInner } = layoutOffsets(opts)

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
      const xl = barOffset(getCoverForFace(coverSpec, 'outer', 3, 0, geometry), tieDia, dia)
      const xr = B - barOffset(getCoverForFace(coverSpec, 'outer', 1, 0, geometry), tieDia, dia)
      const yb = barOffset(getCoverForFace(coverSpec, 'outer', 0, 0, geometry), tieDia, dia)
      const yt = D - barOffset(getCoverForFace(coverSpec, 'outer', 2, 0, geometry), tieDia, dia)
      const bars: Rebar[] = [
        ...barsOnLine({ x: xl, y: yb }, { x: xr, y: yb }, Math.max(2, nx), dia, true, {
          face: 'bottom',
          faceIndex: 0,
          startFaceIndex: 3,
          endFaceIndex: 1,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: xl, y: yt }, { x: xr, y: yt }, Math.max(2, nx), dia, true, {
          face: 'top',
          faceIndex: 2,
          startFaceIndex: 3,
          endFaceIndex: 1,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: xl, y: yb }, { x: xl, y: yt }, ny, dia, false, {
          face: 'left',
          faceIndex: 3,
        }),
        ...barsOnLine({ x: xr, y: yb }, { x: xr, y: yt }, ny, dia, false, {
          face: 'right',
          faceIndex: 1,
        }),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'circle': {
      const { D, nBars } = def
      const R = D / 2
      return {
        geometry: { boundary: circlePoly(0, 0, R), voids: [] },
        bars: barsOnRing(0, 0, R - radial, Math.max(6, nBars), dia, Math.PI / 2, {
          surface: 'outer',
          faces: COVER_FACES,
          radial: true,
        }),
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
      const off = (i: number) => barOffset(getCoverForFace(coverSpec, 'outer', i, 0, geometry), tieDia, dia)
      const yFl = D - tf

      const bars: Rebar[] = [
        ...barsOnLine({ x: off(5), y: D - off(4) }, { x: bf - off(3), y: D - off(4) }, Math.max(2, nFlange), dia, true, {
          face: 'top',
          faceIndex: 4,
          startFaceIndex: 5,
          endFaceIndex: 3,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        automaticBar(off(5), yFl + off(6), dia, { faceIndex: 6, secondaryFaceIndex: 5, faces: ['bottom', 'left'], axis: 'x', u: 0 }),
        automaticBar(bf - off(3), yFl + off(2), dia, { faceIndex: 2, secondaryFaceIndex: 3, faces: ['bottom', 'right'], axis: 'x', u: 1 }),
        ...barsOnLine(
          { x: wl + off(7), y: off(0) },
          { x: wl + off(7), y: yFl - off(6) },
          Math.max(2, nWeb),
          dia,
          true,
          { face: 'left', faceIndex: 7, startFaceIndex: 0, endFaceIndex: 6, startFaces: ['bottom'], endFaces: ['top'] },
        ),
        ...barsOnLine(
          { x: wl + bw - off(1), y: off(0) },
          { x: wl + bw - off(1), y: yFl - off(2) },
          Math.max(2, nWeb),
          dia,
          true,
          { face: 'right', faceIndex: 1, startFaceIndex: 0, endFaceIndex: 2, startFaces: ['bottom'], endFaces: ['top'] },
        ),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'ishape': {
      const { bf1, tf1, bf2, tf2, tw, D, nFlange, nWeb } = def
      const bmax = Math.max(bf1, bf2)
      const t1 = (bmax - bf1) / 2
      const b1 = (bmax - bf2) / 2
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
      const off = (i: number) => barOffset(getCoverForFace(coverSpec, 'outer', i, 0, geometry), tieDia, dia)

      const bars: Rebar[] = [
        ...barsOnLine(
          { x: t1 + off(7), y: D - off(6) },
          { x: t1 + bf1 - off(5), y: D - off(6) },
          Math.max(2, nFlange),
          dia,
          true,
          { face: 'top', faceIndex: 6, startFaceIndex: 7, endFaceIndex: 5, startFaces: ['left'], endFaces: ['right'] },
        ),
        automaticBar(t1 + off(7), D - tf1 + off(8), dia, { faceIndex: 8, secondaryFaceIndex: 7 }),
        automaticBar(t1 + bf1 - off(5), D - tf1 + off(4), dia, { faceIndex: 4, secondaryFaceIndex: 5 }),
        ...barsOnLine(
          { x: b1 + off(11), y: off(0) },
          { x: b1 + bf2 - off(1), y: off(0) },
          Math.max(2, nFlange),
          dia,
          true,
          { face: 'bottom', faceIndex: 0, startFaceIndex: 11, endFaceIndex: 1, startFaces: ['left'], endFaces: ['right'] },
        ),
        automaticBar(b1 + off(11), tf2 - off(10), dia, { faceIndex: 10, secondaryFaceIndex: 11 }),
        automaticBar(b1 + bf2 - off(1), tf2 - off(2), dia, { faceIndex: 2, secondaryFaceIndex: 1 }),
        ...barsOnLine(
          { x: wl + off(9), y: tf2 + off(10) },
          { x: wl + off(9), y: D - tf1 - off(8) },
          nWeb,
          dia,
          false,
          { face: 'left', faceIndex: 9 },
        ),
        ...barsOnLine(
          { x: wl + tw - off(3), y: tf2 + off(2) },
          { x: wl + tw - off(3), y: D - tf1 - off(4) },
          nWeb,
          dia,
          false,
          { face: 'right', faceIndex: 3 },
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
      const off = (i: number) => barOffset(getCoverForFace(coverSpec, 'outer', i, 0, geometry), tieDia, dia)

      const bars: Rebar[] = [
        ...barsOnLine({ x: off(5), y: off(0) }, { x: off(5), y: D - off(4) }, 3, dia, true, {
          face: 'left',
          faceIndex: 5,
          startFaceIndex: 0,
          endFaceIndex: 4,
          startFaces: ['bottom'],
          endFaces: ['top'],
        }),
        ...barsOnLine({ x: tw - off(3), y: tf + off(2) }, { x: tw - off(3), y: D - off(4) }, 2, dia, true, {
          face: 'right',
          faceIndex: 3,
          startFaceIndex: 2,
          endFaceIndex: 4,
          startFaces: ['bottom'],
          endFaces: ['top'],
        }),
        ...barsOnLine({ x: tw + off(5), y: off(0) }, { x: B - off(1), y: off(0) }, 2, dia, true, {
          face: 'bottom',
          faceIndex: 0,
          startFaceIndex: 5,
          endFaceIndex: 1,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: tw + off(3), y: tf - off(2) }, { x: B - off(1), y: tf - off(2) }, 2, dia, true, {
          face: 'top',
          faceIndex: 2,
          startFaceIndex: 3,
          endFaceIndex: 1,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
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
      const offO = (i: number) => barOffset(getCoverForFace(coverSpec, 'outer', i, 0, geometry), tieDia, dia)
      const offI = (i: number) => barOffset(getCoverForFace(coverSpec, 'inner', i, 0, geometry), tieDia, dia)

      const vb = tf - offI(0)
      const vt = D - tf + offI(2)
      const vl = tw - offI(3)
      const vr = B - tw + offI(1)

      const bars: Rebar[] = [
        ...barsOnLine({ x: offO(3), y: offO(0) }, { x: B - offO(1), y: offO(0) }, nxi, dia, true, {
          face: 'bottom',
          faceIndex: 0,
          startFaceIndex: 3,
          endFaceIndex: 1,
          surface: 'outer',
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: offO(3), y: D - offO(2) }, { x: B - offO(1), y: D - offO(2) }, nxi, dia, true, {
          face: 'top',
          faceIndex: 2,
          startFaceIndex: 3,
          endFaceIndex: 1,
          surface: 'outer',
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: offO(3), y: offO(0) }, { x: offO(3), y: D - offO(2) }, ny, dia, false, {
          face: 'left',
          faceIndex: 3,
          surface: 'outer',
        }),
        ...barsOnLine({ x: B - offO(1), y: offO(0) }, { x: B - offO(1), y: D - offO(2) }, ny, dia, false, {
          face: 'right',
          faceIndex: 1,
          surface: 'outer',
        }),
        ...barsOnLine({ x: vl, y: vb }, { x: vr, y: vb }, nxi, dia, true, {
          face: 'bottom',
          faceIndex: 0,
          startFaceIndex: 3,
          endFaceIndex: 1,
          surface: 'inner',
          voidIndex: 0,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: vl, y: vt }, { x: vr, y: vt }, nxi, dia, true, {
          face: 'top',
          faceIndex: 2,
          startFaceIndex: 3,
          endFaceIndex: 1,
          surface: 'inner',
          voidIndex: 0,
          startFaces: ['left'],
          endFaces: ['right'],
        }),
        ...barsOnLine({ x: vl, y: vb }, { x: vl, y: vt }, ny, dia, false, {
          face: 'left',
          faceIndex: 3,
          surface: 'inner',
          voidIndex: 0,
        }),
        ...barsOnLine({ x: vr, y: vb }, { x: vr, y: vt }, ny, dia, false, {
          face: 'right',
          faceIndex: 1,
          surface: 'inner',
          voidIndex: 0,
        }),
      ]
      return { geometry, bars, shapeClass: 'rect' }
    }

    case 'hollowCircle': {
      const { Do, Di, nBars, innerRing } = def
      const Ro = Do / 2
      const Ri = Di / 2
      const bars: Rebar[] = barsOnRing(0, 0, Ro - radial, Math.max(6, nBars), dia, Math.PI / 2, {
        surface: 'outer',
        faces: COVER_FACES,
        radial: true,
      })
      if (innerRing)
        bars.push(
          ...barsOnRing(0, 0, Ri + radialInner, Math.max(6, nBars), dia, Math.PI / 2 + Math.PI / nBars, {
            surface: 'inner',
            faces: COVER_FACES,
            voidIndex: 0,
            radial: true,
          }),
        )
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
