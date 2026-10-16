/**
 * Rasterises the application logo (public/favicon.svg) to the PNG fallbacks
 * browsers without SVG-favicon support ask for, plus the iOS home-screen icon.
 *
 *   node scripts/make-favicons.mjs
 *
 * No dependencies: the mark is drawn from signed-distance fields with analytic
 * edge coverage (antialiased), a blurred drop shadow for the halo the SVG filter
 * casts, and encoded as PNG with node:zlib.
 *
 * The geometry below mirrors public/favicon.svg and src/components/Logo.tsx
 * exactly — change them together (the numbers in branding.test.tsx fail if the
 * SVG and the component drift apart; this file is checked by running it and
 * looking at the two PNGs).
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public')

/* ----------------------------- the mark ------------------------------ */
/** Design space of the artwork (square, like the SVG viewBox). */
const DESIGN = 600
/** The drawing sits at (x + 50, y + 30) inside the squared tile — the placement
 *  that centres the 360 × 460 section on the 600 × 600 tile (equal margins on
 *  both sides). */
const DX = 50
const DY = 30
/** Dark drafting tile. */
const TILE = { size: 600, r: 40, fill: [0x0a, 0x0a, 0x0a], edge: [0x1e, 0x29, 0x3b], edgeW: 2 }
/** Grid pattern over the tile. */
const GRID = { step: 20, width: 1, rgb: [0x33, 0x41, 0x55], alpha: 0.3 }
/** Drop shadow the drawing casts on the tile. */
const SHADOW = { dy: 8, blur: 10, rgb: [0, 0, 0], alpha: 0.6 }
/** Concrete boundary and the hollow core. */
const FRAME = { x: 70, y: 40, w: 360, h: 460, r: 40, fill: [0xf8, 0xfa, 0xfc] }
const CORE = { x: 90, y: 60, w: 320, h: 420, r: 20, fill: [0x0a, 0x0a, 0x0a] }
/** Closed stirrup and the two hooks of its end. */
const STIRRUP = { x: 107, y: 77, w: 286, h: 386, r: 21, rgb: [0x47, 0x55, 0x69], stroke: 3 }
const HOOKS = [
  { x1: 138, y1: 77, x2: 159.2, y2: 98.2 },
  { x1: 107, y1: 108, x2: 128.2, y2: 129.2 },
]
/** Main reinforcement: eight bars (3 top + 2 side + 3 bottom) and their cores. */
const BARS = [
  { cx: 128, cy: 98 },
  { cx: 250, cy: 98 },
  { cx: 372, cy: 98 },
  { cx: 128, cy: 270 },
  { cx: 372, cy: 270 },
  { cx: 128, cy: 442 },
  { cx: 250, cy: 442 },
  { cx: 372, cy: 442 },
]
const BAR_R = 18
const BAR_FILL = [0xff, 0xff, 0xff]
const BAR_STROKE = [0x0a, 0x0a, 0x0a]
const BAR_STROKE_W = 2
const CORE_R = 6
const CORE_RGB = [0x47, 0x55, 0x69]
const CORE_ALPHA = 0.4

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

/** Coverage of a pixel centre at signed distance `sd` from an edge (device units). */
const coverage = (sd) => Math.min(1, Math.max(0, 0.5 - sd))

/**
 * Coverage of a pixel by a band of width `w` (device units) whose centreline is
 * `sd` away. Strokes are thinner than a pixel at icon sizes, where the half-plane
 * model above would paint them at nearly full strength; the box convolution of a
 * band is capped at the band's own width.
 */
const coverageBand = (sd, w) => Math.min(Math.min(1, w), Math.max(0, (w + 1) / 2 - Math.abs(sd)))

/* ------------------------------ drawing ------------------------------ */
/** Three-pass box blur (≈ Gaussian) of a coverage mask, in place-safe copies. */
function blur(mask, size, radius) {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return mask
  let src = mask
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(size * size)
    const out = new Float32Array(size * size)
    const norm = 2 * r + 1
    for (let y = 0; y < size; y++) {
      let sum = 0
      for (let x = -r; x <= r; x++) sum += src[y * size + Math.min(size - 1, Math.max(0, x))]
      for (let x = 0; x < size; x++) {
        tmp[y * size + x] = sum / norm
        const drop = src[y * size + Math.min(size - 1, Math.max(0, x - r))]
        const add = src[y * size + Math.min(size - 1, Math.max(0, x + r + 1))]
        sum += add - drop
      }
    }
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(size - 1, Math.max(0, y)) * size + x]
      for (let y = 0; y < size; y++) {
        out[y * size + x] = sum / norm
        const drop = tmp[Math.min(size - 1, Math.max(0, y - r)) * size + x]
        const add = tmp[Math.min(size - 1, Math.max(0, y + r + 1)) * size + x]
        sum += add - drop
      }
    }
    src = out
  }
  return src
}

/**
 * Render the logo at `size` px. `square` draws a full-bleed tile (the iOS
 * home-screen icon, which the platform masks itself) instead of rounded corners.
 */
function render(size, { square = false } = {}) {
  const s = size / DESIGN
  const rgba = Buffer.alloc(size * size * 4)
  /** Accrued (straight-alpha) colour per pixel. */
  const acc = new Float32Array(size * size * 4)

  const paint = (i, rgb, a) => {
    if (a <= 0) return
    const da = acc[i + 3]
    const outA = a + da * (1 - a)
    for (let c = 0; c < 3; c++) {
      const dst = da > 0 ? acc[i + c] : 0
      acc[i + c] = outA > 0 ? (rgb[c] * a + dst * da * (1 - a)) / outA : 0
    }
    acc[i + 3] = outA
  }

  // tile geometry, in device units, centred on the canvas
  const tileHalf = (TILE.size / 2) * s
  const tileR = square ? 0 : TILE.r * s
  const frame = { halfW: (FRAME.w / 2) * s, halfH: (FRAME.h / 2) * s, radius: FRAME.r * s, cx: (FRAME.x + DX + FRAME.w / 2 - DESIGN / 2) * s, cy: (FRAME.y + DY + FRAME.h / 2 - DESIGN / 2) * s }
  const core = { halfW: (CORE.w / 2) * s, halfH: (CORE.h / 2) * s, radius: CORE.r * s, cx: (CORE.x + DX + CORE.w / 2 - DESIGN / 2) * s, cy: (CORE.y + DY + CORE.h / 2 - DESIGN / 2) * s }
  const stirrup = { halfW: (STIRRUP.w / 2) * s, halfH: (STIRRUP.h / 2) * s, radius: STIRRUP.r * s, cx: (STIRRUP.x + DX + STIRRUP.w / 2 - DESIGN / 2) * s, cy: (STIRRUP.y + DY + STIRRUP.h / 2 - DESIGN / 2) * s }
  const px = (v) => (v + DX - DESIGN / 2) * s
  const py = (v) => (v + DY - DESIGN / 2) * s

  // 1. the tile — pixel-centre coordinates, in device units about the canvas centre
  const centre = (v) => v + 0.5 - size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = centre(x)
      const cy = centre(y)
      const i = (y * size + x) * 4
      paint(i, TILE.fill, coverage(sdRoundRect(cx, cy, tileHalf, tileHalf, tileR)))
    }
  }

  // 2. grid pattern over the tile
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = centre(x)
      const cy = centre(y)
      const i = (y * size + x) * 4
      const inTile = coverage(sdRoundRect(cx, cy, tileHalf, tileHalf, tileR))
      if (inTile <= 0) continue
      // the pattern is anchored at the viewBox origin, so the lines sit at
      // multiples of `step` in design units measured from the canvas corner
      const near = (v) => {
        const r = ((((v / s + DESIGN / 2) % GRID.step) + GRID.step) % GRID.step)
        return Math.min(r, GRID.step - r)
      }
      const line = Math.max(
        coverageBand(near(cx) * s, GRID.width * s),
        coverageBand(near(cy) * s, GRID.width * s),
      )
      paint(i, GRID.rgb, inTile * line * GRID.alpha)
    }
  }

  // 3. the tile's own border
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = centre(x)
      const cy = centre(y)
      const i = (y * size + x) * 4
      const d = sdRoundRect(cx, cy, tileHalf, tileHalf, tileR)
      paint(i, TILE.edge, coverageBand(d, TILE.edgeW * s))
    }
  }

  // 4. the drop shadow the drawing casts (blurred silhouette of the boundary)
  const mask = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      mask[y * size + x] = coverage(
        sdRoundRect(centre(x) - frame.cx, centre(y) - SHADOW.dy * s - frame.cy, frame.halfW, frame.halfH, frame.radius),
      )
    }
  }
  const blurred = blur(mask, size, SHADOW.blur * s)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      paint((y * size + x) * 4, SHADOW.rgb, Math.min(1, blurred[y * size + x]) * SHADOW.alpha)
    }
  }

  // 5. the drawing: boundary, core, stirrup, hooks, bars and their cores
  const shapes = []
  shapes.push({ sd: (x, y) => sdRoundRect(x - frame.cx, y - frame.cy, frame.halfW, frame.halfH, frame.radius), rgb: FRAME.fill, a: 1 })
  shapes.push({ sd: (x, y) => sdRoundRect(x - core.cx, y - core.cy, core.halfW, core.halfH, core.radius), rgb: CORE.fill, a: 1 })
  shapes.push({
    band: (x, y) => sdRoundRect(x - stirrup.cx, y - stirrup.cy, stirrup.halfW, stirrup.halfH, stirrup.radius),
    w: STIRRUP.stroke * s,
    rgb: STIRRUP.rgb,
    a: 1,
  })
  for (const h of HOOKS) {
    shapes.push({
      band: (x, y) => sdSegment(x, y, px(h.x1), py(h.y1), px(h.x2), py(h.y2)),
      w: STIRRUP.stroke * s,
      rgb: STIRRUP.rgb,
      a: 1,
    })
  }
  for (const b of BARS) {
    const cx = px(b.cx)
    const cy = py(b.cy)
    shapes.push({ sd: (x, y) => Math.hypot(x - cx, y - cy) - BAR_R * s, rgb: BAR_FILL, a: 1 })
    shapes.push({ band: (x, y) => Math.hypot(x - cx, y - cy) - BAR_R * s, w: BAR_STROKE_W * s, rgb: BAR_STROKE, a: 1 })
    shapes.push({ sd: (x, y) => Math.hypot(x - cx, y - cy) - CORE_R * s, rgb: CORE_RGB, a: CORE_ALPHA })
  }
  // shadow of the drawing itself was painted above; the shapes go over it
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = centre(x)
      const cy = centre(y)
      const i = (y * size + x) * 4
      for (const sh of shapes) {
        const cover = sh.band ? coverageBand(sh.band(cx, cy), sh.w) : coverage(sh.sd(cx, cy))
        paint(i, sh.rgb, cover * sh.a)
      }
    }
  }

  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 3; c++) {
      rgba[i * 4 + c] = Math.round(Math.min(255, Math.max(0, acc[i * 4 + c])))
    }
    rgba[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, acc[i * 4 + 3])) * 255)
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
  { file: 'favicon-32.png', size: 32, square: false },
  // iOS "Add to Home Screen" — full-bleed tile, the platform masks the corners
  { file: 'apple-touch-icon.png', size: 180, square: true },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const { file, size, square } of targets) {
  const png = toPng(size, render(size, { square }))
  writeFileSync(resolve(OUT_DIR, file), png)
  console.log(`wrote public/${file} (${size}×${size}, ${png.length} bytes)`)
}
