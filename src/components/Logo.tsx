/**
 * Application logo — the RCC section mark: a dark drafting tile carrying the
 * concrete boundary, the closed stirrup (with its two hooks) and the eight main
 * bars of a beam section.
 *
 * One artwork, three surfaces:
 *
 *  - the **header mark** of the app title (`AppLogo`);
 *  - the **printed report** header (`src/report.ts` emits HTML text, so it uses
 *    the markup builder directly);
 *  - the **browser icon** — `public/favicon.svg` is the same artwork as a
 *    standalone file, and `scripts/make-favicons.mjs` rasterises the same
 *    geometry for the PNG fallbacks. `src/components/__tests__/branding.test.tsx`
 *    keeps the three in step.
 *
 * The supplied artwork came on a 500 × 600 tile; the tile is squared to
 * 600 × 600 here so the mark fills a square icon slot — the header mark, the
 * favicon and the iOS home-screen icon — without transparencies down the sides.
 * The drawing inside is unchanged, only placed: see `LOGO_OFFSET_X` /
 * `LOGO_OFFSET_Y` below, which put the rectangular section exactly in the middle
 * of the tile — equal margins on both sides (120 left/right, 70 top/bottom), and
 * the section's own axes running through the centre of the tile, so the mark is
 * symmetric about both centre lines. The pattern path carries `fill="none"`: an
 * open path is filled as if closed, which would have washed a triangle over
 * every grid cell.
 */
import { useId } from 'react'

/** Design space of the artwork — a square canvas, like every icon surface. */
export const LOGO_VIEWBOX = '0 0 600 600'
/**
 * Placement of the supplied 500 × 600 drawing inside the squared 600 × 600 tile.
 * The drawing is 360 × 460, so at these offsets it sits exactly in the middle:
 * 120 units of tile on either side, 70 above and below, and its centre — like the
 * centres of the boundary, the core, the stirrup and the bar pattern — falls on
 * the centre of the tile at (300, 300).
 */
export const LOGO_OFFSET_X = 50
export const LOGO_OFFSET_Y = 30
/** Dark tile: size, corner radius and its two colours. */
export const LOGO_TILE = { size: 600, r: 40, fill: '#0a0a0a', edge: '#1e293b' }
/** Concrete boundary: the outer face and the hollow core inside it. */
export const LOGO_FRAME = { x: 70, y: 40, w: 360, h: 460, r: 40, fill: '#f8fafc' }
export const LOGO_CORE = { x: 90, y: 60, w: 320, h: 420, r: 20, fill: '#0a0a0a' }
/** Closed stirrup tangent to the bars, and the two hooks of its end. */
export const LOGO_STIRRUP = { x: 107, y: 77, w: 286, h: 386, r: 21, stroke: '#475569', width: 3 }
export const LOGO_HOOKS = [
  { x1: 138, y1: 77, x2: 159.2, y2: 98.2 },
  { x1: 107, y1: 108, x2: 128.2, y2: 129.2 },
] as const
/** Main reinforcement: eight bars, 3 top + 2 side + 3 bottom, and their cores. */
export const LOGO_BAR_R = 18
export const LOGO_BAR_STROKE = { fill: '#ffffff', stroke: '#0a0a0a', width: 2 }
export const LOGO_CORE_R = 6
export const LOGO_CORE_FILL = '#475569'
export const LOGO_CORE_OPACITY = 0.4
export const LOGO_BARS = [
  { cx: 128, cy: 98 },
  { cx: 250, cy: 98 },
  { cx: 372, cy: 98 },
  { cx: 128, cy: 270 },
  { cx: 372, cy: 270 },
  { cx: 128, cy: 442 },
  { cx: 250, cy: 442 },
  { cx: 372, cy: 442 },
] as const
/** Grid pattern drawn over the tile. */
export const LOGO_GRID = { step: 20, stroke: '#334155', width: 1, opacity: 0.3 }
/** Drop shadow cast by the drawing on the tile. */
export const LOGO_SHADOW = { dy: 8, blur: 10, flood: '#000000', opacity: 0.6 }

/**
 * The artwork as standalone SVG markup. `uid` prefixes the pattern/filter ids so
 * several instances on one page cannot capture each other's definitions, and
 * `attrs` carries the sizing/accessibility attributes of the caller.
 */
export function logoSvgMarkup(uid = '', attrs = ''): string {
  const grid = `${uid}grid`
  const shadow = `${uid}shadow`
  const rect = (r: { x: number; y: number; w: number; h: number; r: number }) =>
    `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}"`
  const bars = LOGO_BARS.map(
    (b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${LOGO_BAR_R}" />`,
  ).join('')
  const cores = LOGO_BARS.map(
    (b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${LOGO_CORE_R}" />`,
  ).join('')
  const hooks = LOGO_HOOKS.map(
    (h) => `<line x1="${h.x1}" y1="${h.y1}" x2="${h.x2}" y2="${h.y2}" />`,
  ).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}"${attrs ? ` ${attrs}` : ''}>`,
    '<defs>',
    `<pattern id="${grid}" width="${LOGO_GRID.step}" height="${LOGO_GRID.step}" patternUnits="userSpaceOnUse">`,
    `<path d="M ${LOGO_GRID.step} 0 L 0 0 0 ${LOGO_GRID.step}" fill="none" stroke="${LOGO_GRID.stroke}" stroke-width="${LOGO_GRID.width}" opacity="${LOGO_GRID.opacity}"/>`,
    '</pattern>',
    '<filter id="' + shadow + '" x="-10%" y="-10%" width="120%" height="120%">',
    `<feDropShadow dx="0" dy="${LOGO_SHADOW.dy}" stdDeviation="${LOGO_SHADOW.blur}" flood-color="${LOGO_SHADOW.flood}" flood-opacity="${LOGO_SHADOW.opacity}"/>`,
    '</filter>',
    '</defs>',
    `<rect width="${LOGO_TILE.size}" height="${LOGO_TILE.size}" rx="${LOGO_TILE.r}" fill="${LOGO_TILE.fill}" />`,
    `<rect width="${LOGO_TILE.size}" height="${LOGO_TILE.size}" rx="${LOGO_TILE.r}" fill="url(#${grid})" />`,
    `<rect width="${LOGO_TILE.size}" height="${LOGO_TILE.size}" rx="${LOGO_TILE.r}" fill="none" stroke="${LOGO_TILE.edge}" stroke-width="2" />`,
    `<g filter="url(#${shadow})" transform="translate(${LOGO_OFFSET_X} ${LOGO_OFFSET_Y})">`,
    `<rect ${rect(LOGO_FRAME)} fill="${LOGO_FRAME.fill}" />`,
    `<rect ${rect(LOGO_CORE)} fill="${LOGO_CORE.fill}" />`,
    `<rect ${rect(LOGO_STIRRUP)} fill="none" stroke="${LOGO_STIRRUP.stroke}" stroke-width="${LOGO_STIRRUP.width}" />`,
    `<g stroke="${LOGO_STIRRUP.stroke}" stroke-width="${LOGO_STIRRUP.width}" stroke-linecap="round">${hooks}</g>`,
    `<g fill="${LOGO_BAR_STROKE.fill}" stroke="${LOGO_BAR_STROKE.stroke}" stroke-width="${LOGO_BAR_STROKE.width}">${bars}</g>`,
    `<g fill="${LOGO_CORE_FILL}" opacity="${LOGO_CORE_OPACITY}">${cores}</g>`,
    '</g>',
    '</svg>',
  ].join('')
}

/**
 * The logo as the mark of the app title: a square tile that keeps its own
 * rounded corners and border, sized by `className` (30 × 30 in the header).
 * Decorative by default — the app name beside it carries the meaning — with an
 * accessible name when one is given.
 */
export function AppLogo({
  className = 'h-[30px] w-[30px]',
  title,
}: {
  className?: string
  /** Accessible name; without one the mark is hidden from assistive tech. */
  title?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const a11y = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"'
  return (
    <span
      data-logo="app"
      className={`inline-block shrink-0 align-middle ${className}`}
      dangerouslySetInnerHTML={{ __html: logoSvgMarkup(uid, `${a11y} width="100%" height="100%"`) }}
    />
  )
}
