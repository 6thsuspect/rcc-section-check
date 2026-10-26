/**
 * Clipboard — the coordinate tables the app can put on it, and the write itself.
 *
 * Two tables, in the one shape the next step wants: a title line, a header line,
 * then one tab-separated row per point, so a paste into Excel lands in columns
 * and the columns can be fed to AutoCAD or STAAD from there.
 *
 *  1. **Section coordinates** — the outer boundary and every opening in it
 *     (voids, holes, cutouts, ducts), each point numbered and attributed to the
 *     ring it belongs to, in the section's own coordinate system;
 *  2. **Reinforcement bar coordinates** — every longitudinal bar with its
 *     number, diameter, face, surface and placement, in the same coordinate
 *     system as the section.
 *
 * Nothing is re-derived here: the values are the app's own state, written exactly
 * as it holds them — the same numbers the input fields and the coordinate tables
 * show, so a copied section is the section on screen, at full precision, signs
 * and all, with no rounding, re-scaling or unit conversion applied on the way out.
 * A coordinate that is not a finite number is left out rather than written as
 * `NaN`, and nothing is offered at all when there is no section boundary or no
 * bar to copy — the caller says so instead of copying something wrong.
 */
import type { Point, Rebar, SectionGeometry } from './engine/types'

/** What a copy button puts on the clipboard, and what it should say afterwards. */
export interface CopyText {
  /** The table: a title line, a header line, then one row per point. */
  text: string
  /** Coordinate rows in `text` — the title and header lines are not counted. */
  count: number
  /** Entries left out because they are not usable coordinates. */
  skipped: number
}

/**
 * One cell of a number: the value as the app holds it, so the copy is the value
 * on screen — `170.16666666666666` stays that, `-40` keeps its sign, and a
 * negative zero is written as `0`. Anything that is not a finite number has no
 * cell at all and the row is left out.
 */
export function cell(v: number): string {
  if (!Number.isFinite(v)) return ''
  return Object.is(v, -0) ? '0' : String(v)
}

/** The one title line each table starts with, naming the units and the origin. */
function title(what: string): string {
  return `${what} — RCC Section Check · mm, x to the right, y up, origin at the section's own (0, 0)`
}

/** The points of a ring that can be written, and how many of them cannot. */
function usablePoints(ring: readonly Point[] | undefined): { points: Point[]; bad: number } {
  const points: Point[] = []
  let bad = 0
  for (const p of ring ?? []) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p)
    else bad += 1
  }
  return { points, bad }
}

/** Append one ring as numbered rows, under the part name it belongs to. */
function pushRing(rows: string[], part: string, points: readonly Point[]) {
  points.forEach((p, i) => {
    rows.push([part, String(i + 1), cell(p.x), cell(p.y)].join('\t'))
  })
}

/**
 * The section as a TSV table: every boundary vertex, then every opening — a
 * hollow core, a box cell, a bolt hole, a duct or a cutout — each numbered from
 * 1 within its own ring and named in the `Part` column.
 *
 * `null` when there is no boundary to copy (fewer than three usable points):
 * that is not a section, and writing three lines of it would be worse than
 * saying so.
 */
export function sectionCoordinatesText(geometry: SectionGeometry | null | undefined): CopyText | null {
  const boundary = usablePoints(geometry?.boundary)
  if (boundary.points.length < 3) return null

  const rows: string[] = []
  let skipped = boundary.bad
  pushRing(rows, 'Boundary', boundary.points)

  ;(geometry?.voids ?? []).forEach((voidRing, i) => {
    const ring = usablePoints(voidRing)
    if (ring.points.length < 3) {
      // not a ring: an opening needs three points before it means anything
      skipped += ring.points.length + ring.bad
      return
    }
    pushRing(rows, `Void ${i + 1}`, ring.points)
    skipped += ring.bad
  })

  return {
    text: [title('Section coordinates'), 'Part\tPoint\tX (mm)\tY (mm)', ...rows].join('\n'),
    count: rows.length,
    skipped,
  }
}

/**
 * The reinforcement as a TSV table: every bar with its number, its coordinates,
 * its diameter and — where the bar records them — the face it lies against, the
 * surface (outer or inner/void) and whether the app placed it automatically or
 * the user placed it by hand.
 *
 * `null` when there is no bar to copy at all.
 */
export function barCoordinatesText(bars: readonly Rebar[] | null | undefined): CopyText | null {
  const rows: string[] = []
  let skipped = 0
  let n = 0
  for (const bar of bars ?? []) {
    if (!bar || !Number.isFinite(bar.x) || !Number.isFinite(bar.y)) {
      skipped += 1
      continue
    }
    n += 1
    rows.push(
      [
        String(n),
        cell(bar.x),
        cell(bar.y),
        bar.dia > 0 ? cell(bar.dia) : '',
        bar.face ?? bar.faces?.[0] ?? '',
        bar.surface ?? '',
        bar.positioning ?? '',
      ].join('\t'),
    )
  }
  if (rows.length === 0) return null

  return {
    text: [
      title('Reinforcement bar coordinates'),
      'Bar\tX (mm)\tY (mm)\tDia (mm)\tFace\tSurface\tPlacement',
      ...rows,
    ].join('\n'),
    count: rows.length,
    skipped,
  }
}

/**
 * Put text on the clipboard. `navigator.clipboard` is tried first; when the page
 * is not allowed to use it — an embedded frame, a browser that blocks it, a
 * non-secure origin — the older selection route is used instead, which works
 * from the same click. `false` means neither route worked, and the caller tells
 * the user rather than pretending the copy happened.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clip && typeof clip.writeText === 'function') {
      await clip.writeText(text)
      return true
    }
  } catch {
    /* blocked or refused — try the selection route below */
  }
  try {
    if (typeof document === 'undefined' || !document.body) return false
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    // off-screen rather than hidden: a hidden element cannot be selected
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.left = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
