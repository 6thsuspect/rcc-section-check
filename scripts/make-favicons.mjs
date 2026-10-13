/**
 * Rasterises the application logo (public/favicon.svg) to the PNG fallbacks
 * browsers without SVG-favicon support ask for, plus the iOS home-screen icon.
 *
 *   node scripts/make-favicons.mjs
 *
 * No dependencies: the mark is drawn from signed-distance fields with analytic
 * edge coverage (antialiased) and encoded as PNG with node:zlib. The geometry
 * below mirrors public/favicon.svg exactly — change both together, and keep the
 * header mark in src/App.tsx in step.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public')

/* ----------------------------- the mark ------------------------------ */
/** Design space of the SVG (32 × 32 units). */
const DESIGN = 32
/** Rounded-tile corner radius, design units. */
const RADIUS = 7.5
/** Ink tile + white lattice (light browser chrome). */
const TILE = [0x17, 0x22, 0x2c] // --color-ink
const BARS = [0xff, 0xff, 0xff]
/** Lattice geometry, design units: two verticals and two horizontals. */
const LATTICE = {
  xs: [8.875, 23.125],
  ys: [11.25, 20.75],
  y0: 6.5,
  y1: 25.5,
  /** Stroke width. */
  w: 2.3,
}

/* --------------------------- shape fields ---------------------------- */
/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - (halfW - r)
  const qy = Math.abs(py) - (halfH - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** Signed distance to the segment a→b. */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - ax - t * vx, py - ay - t * vy)
}

/** Coverage of a pixel centre at signed distance `sd` (device units). */
const coverage = (sd) => Math.min(1, Math.max(0, 0.5 - sd))

/* ------------------------------ drawing ------------------------------ */
/**
 * Render the logo at `size` px. `square` draws a full-bleed tile (the iOS
 * home-screen icon, which the platform masks itself) instead of rounded corners.
 */
function render(size, { square = false, dark = false } = {}) {
  const tileRgb = dark ? [0xe8, 0xf0, 0xfa] : TILE
  const barRgb = dark ? [0x17, 0x22, 0x2c] : BARS
  const s = size / DESIGN
  const half = size / 2
  const halfW = (DESIGN / 2) * s
  const r = square ? 0 : RADIUS * s
  const barHalf = (LATTICE.w / 2) * s
  const cx = (v) => (v - DESIGN / 2) * s
  const rgba = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half
      const py = y + 0.5 - half
      const tileA = coverage(sdRoundRect(px, py, halfW, halfW, r))

      let barA = 0
      for (const vx of LATTICE.xs) {
        const d = sdSegment(px, py, cx(vx), cx(LATTICE.y0), cx(vx), cx(LATTICE.y1)) - barHalf
        barA = Math.max(barA, coverage(d))
      }
      for (const vy of LATTICE.ys) {
        const d = sdSegment(px, py, cx(LATTICE.xs[0]), cx(vy), cx(LATTICE.xs[1]), cx(vy)) - barHalf
        barA = Math.max(barA, coverage(d))
      }

      // lattice (bar) over tile, in straight (non-premultiplied) alpha
      const a = barA + tileA * (1 - barA)
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = a > 0 ? (barRgb[c] * barA + tileRgb[c] * tileA * (1 - barA)) / a : 0
        rgba[i + c] = Math.round(Math.min(255, Math.max(0, v)))
      }
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return rgba
}

/* ----------------------------- PNG output ---------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function toPng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------- build ------------------------------- */
const targets = [
  // browsers without SVG favicons (older Safari) — rounded tile
  { file: 'favicon-32.png', size: 32, square: false, dark: false },
  // iOS "Add to Home Screen" — full-bleed tile, the platform masks the corners
  { file: 'apple-touch-icon.png', size: 180, square: true, dark: false },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const { file, size, square, dark } of targets) {
  const png = toPng(size, render(size, { square, dark }))
  writeFileSync(resolve(OUT_DIR, file), png)
  console.log(`wrote public/${file} (${size}×${size}, ${png.length} bytes)`)
}
