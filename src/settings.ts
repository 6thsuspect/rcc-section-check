/**
 * Appearance preferences — the small set of choices behind the header's
 * Settings panel (the gear button), plus the single storage key the app owns.
 *
 * Everything here is deliberately framework-free: the values are plain data,
 * `applySettings` writes them onto an element as attributes and custom
 * properties, and the palette itself lives in the stylesheet
 * (`src/index.css`: `[data-theme='dark']`, `[data-sheet='…']`,
 * `[data-grid='off']`). Nothing in the analysis engine, the report or the
 * figures' geometry reads these values — they only restyle what is drawn.
 *
 * The theme is carried by `data-theme` on the document element because every
 * colour in the app already resolves through the `--color-*` custom properties
 * of `@theme`, and Tailwind 4 emits those tokens as `var(--color-…)` in its
 * utilities. Overriding the tokens for one attribute is therefore enough to
 * flip the whole interface, including the SVG figures.
 */

/** Which way the interface is lit. */
export type ThemeName = 'light' | 'dark'

/** Root font size preset; every size in the interface is in `rem`. */
export type FontSizeName = 'small' | 'medium' | 'large'

/** The tint of the drafting sheet the app draws on. */
export type SheetName = 'paper' | 'blueprint' | 'graph' | 'cream'

export type AppSettings = {
  theme: ThemeName
  fontSize: FontSizeName
  /** Accent for buttons, focus rings, tabs — one hex, `#rrggbb`. */
  accentColor: string
  sheet: SheetName
  /** Faint drafting grid behind the panels. */
  grid: boolean
}

/** The one key this app writes to `localStorage`. */
export const SETTINGS_KEY = 'rcc-section-check-settings'

/** Accent swatches: the app's own drafting blue first, then the reference set. */
export const ACCENT_COLORS = [
  { name: 'Drafting blue', hex: '#256abf' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Cyan', hex: '#06b6d4' },
] as const

/**
 * Interface size presets. These are the root font size in px: every text size
 * in the app is a `rem` value expressed against a 16 px root, so `medium`
 * (16 px) is the size the interface has always had and the other two scale the
 * whole interface — type, spacing and controls — by ∓12.5 %.
 */
export const FONT_SIZES = [
  { id: 'small', label: 'Small', px: 14 },
  { id: 'medium', label: 'Medium', px: 16 },
  { id: 'large', label: 'Large', px: 18 },
] as const satisfies readonly { id: FontSizeName; label: string; px: number }[]

/**
 * Drafting sheet tints. These are the light theme's canvas; the Settings panel
 * shows `swatch` on each option and `src/index.css` paints the canvas with the
 * same `--tint-*` token, so the two cannot drift apart.
 */
export const SHEET_THEMES = [
  { id: 'paper', label: 'Paper', note: 'Neutral drafting paper', swatch: 'var(--tint-paper)' },
  { id: 'blueprint', label: 'Blueprint', note: 'Pale blue sheet', swatch: 'var(--tint-blueprint)' },
  { id: 'graph', label: 'Graph', note: 'Pale green grid sheet', swatch: 'var(--tint-graph)' },
  { id: 'cream', label: 'Cream', note: 'Warm tracing paper', swatch: 'var(--tint-cream)' },
] as const satisfies readonly { id: SheetName; label: string; note: string; swatch: string }[]

/**
 * Defaults. The theme and the interface size are the values the app opened
 * with before this panel existed — light and the 16 px root — so a first visit
 * (and a cleared storage) looks exactly like the published app.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 'medium',
  accentColor: ACCENT_COLORS[0].hex,
  sheet: 'paper',
  grid: true,
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/**
 * The ink to put on a filled accent button for a given accent. The app's own
 * accent is dark enough for white type, but the pale swatches (green, orange,
 * cyan) are not: on those, white type sits at around 2.3:1, which is below every
 * contrast threshold there is. The nearer of the two inks wins, measured rather
 * than guessed, so any accent a user picks keeps its label readable.
 */
export function accentInk(accentColor: string): string {
  if (!HEX.test(accentColor)) return '#ffffff'
  const l = luminance(accentColor)
  return (l + 0.05) / 0.0575 > 1.05 / (l + 0.05) ? '#0b1620' : '#ffffff'
}

function pick<T extends string>(value: unknown, allowed: readonly { id: T }[], fallback: T): T {
  return allowed.some((o) => o.id === value) ? (value as T) : fallback
}

/**
 * Coerce anything (a half-written storage entry, a value from an older build,
 * a hand-edited JSON blob) to a complete, valid settings object. Unknown keys
 * are dropped and a bad field falls back to its default on its own, so one
 * unreadable preference never costs the user the others.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    theme: o.theme === 'dark' ? 'dark' : 'light',
    fontSize: pick(o.fontSize, FONT_SIZES, DEFAULT_SETTINGS.fontSize),
    accentColor:
      typeof o.accentColor === 'string' && HEX.test(o.accentColor)
        ? o.accentColor.toLowerCase()
        : DEFAULT_SETTINGS.accentColor,
    sheet: pick(o.sheet, SHEET_THEMES, DEFAULT_SETTINGS.sheet),
    grid: typeof o.grid === 'boolean' ? o.grid : DEFAULT_SETTINGS.grid,
  }
}

/** Root font size in px for a preset. */
export function fontSizePx(name: FontSizeName): number {
  return FONT_SIZES.find((f) => f.id === name)?.px ?? 16
}

/**
 * Read the stored settings. Anything missing, unparsable or invalid falls back
 * to the defaults, and a storage that throws (private mode, a blocked origin)
 * is treated as an empty one — the app must open either way.
 */
export function readSettings(storage?: Storage | null): AppSettings {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (!store) return { ...DEFAULT_SETTINGS }
  try {
    const raw = store.getItem(SETTINGS_KEY)
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Persist the settings; a storage that refuses the write is not an error. */
export function writeSettings(s: AppSettings, storage?: Storage | null): void {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (!store) return
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* the preference simply does not survive this session */
  }
}

/**
 * Push the settings onto an element — the document element in the app, a stub
 * in the tests. Only three things happen: the theme, sheet and grid attributes
 * the stylesheet keys off, the accent colour, and the root font size. The accent
 * is the one token written here; the derived `--color-accent-strong` and
 * `--color-accent-wash` are `color-mix()` of it in the stylesheet, so they
 * follow the accent — and the theme — on their own.
 */
export function applySettings(s: AppSettings, root: HTMLElement): void {
  root.dataset.theme = s.theme
  root.dataset.sheet = s.sheet
  root.dataset.grid = s.grid ? 'on' : 'off'
  root.style.setProperty('--color-accent', s.accentColor)
  root.style.setProperty('--color-accent-ink', accentInk(s.accentColor))
  root.style.fontSize = `${fontSizePx(s.fontSize)}px`
}
