import type { ConcreteModel, SteelModel } from './types'

export const ES = 200000 // N/mm²

/** Parabola–rectangle design stress at strain eps (compression positive). */
export function concreteStress(m: ConcreteModel, eps: number): number {
  if (eps <= 0) return 0
  if (eps >= m.ec2) return m.fcd
  return m.fcd * (1 - Math.pow(1 - eps / m.ec2, m.n))
}

/**
 * Piecewise-linear steel stress; odd-symmetric, plateau beyond the last point.
 * Sign convention here matches the strain-plane convention: compression positive.
 * An optional compressionCap (IRS CBC fyc) limits the compression side only.
 */
export function steelStress(s: SteelModel, eps: number): number {
  const sign = eps < 0 ? -1 : 1
  const e = Math.abs(eps)
  const pts = s.points
  const last = pts[pts.length - 1]
  let mag = last.sig
  if (e < last.eps) {
    for (let i = 1; i < pts.length; i++) {
      if (e <= pts[i].eps) {
        const a = pts[i - 1]
        const b = pts[i]
        const t = (e - a.eps) / (b.eps - a.eps)
        mag = a.sig + t * (b.sig - a.sig)
        break
      }
    }
  }
  if (sign > 0 && s.compressionCap !== undefined) mag = Math.min(mag, s.compressionCap)
  return sign * mag
}

/**
 * IS 456 / SP 16 curve for HYSD (cold-worked characteristics) bars:
 * linear to 0.8·fyd, then the SP 16 knee offsets, plateau at fyd = 0.87·fy
 * reached at strain fyd/Es + 0.002.
 */
export function steelIS456(fy: number): SteelModel {
  const fyd = 0.87 * fy
  const knees: [number, number][] = [
    // [stress ratio of fyd, inelastic strain offset]
    [0.8, 0.0],
    [0.85, 0.0001],
    [0.9, 0.0003],
    [0.95, 0.0007],
    [0.975, 0.001],
    [1.0, 0.002],
  ]
  const points = [{ eps: 0, sig: 0 }]
  for (const [r, off] of knees) {
    points.push({ eps: (r * fyd) / ES + off, sig: r * fyd })
  }
  return { points, fyd, Es: ES }
}

/** Bilinear design curve with a horizontal top branch at fyk/γs. */
export function steelBilinear(fy: number, gammaS: number): SteelModel {
  const fyd = fy / gammaS
  return {
    points: [
      { eps: 0, sig: 0 },
      { eps: fyd / ES, sig: fyd },
    ],
    fyd,
    Es: ES,
  }
}
