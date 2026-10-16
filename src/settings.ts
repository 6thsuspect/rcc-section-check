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
 *
 * One preference here is not about looks: `wheelStep`, the increment a wheel
 * notch moves a numeric field by. It is stored and normalized like the rest,
 * and `applySettings` publishes it to the small live store at the foot of this
 * file, because the wheel listeners are native ones attached to the inputs —
 * outside the React tree the settings live in — and each of them must step by
 * the value in force at the moment of the notch.
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
  /**
   * How far one mouse-wheel notch moves a numeric field, in that field's own
   * unit — millimetres for a dimension, kN for a load, mm for a bar position.
   * Default 1 (`DEFAULT_SETTINGS`). A field's own spinner arrows and typed
   * validation keep their own step; this is the wheel only.
   */
  wheelStep: number
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
 * Mouse-wheel increment presets for the Settings panel — the values most
 * engineering inputs want: a tenth of a unit for a fine ⌀ or a small spacing,
 * one for a millimetre dimension, five or ten for a coarse walk over a large
 * value. Any other positive number can be typed into the field beside them.
 */
export const WHEEL_STEPS = [
  { value: 0.1, label: '0.1' },
  { value: 1, label: '1' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
] as const

/** Bounds of a typed wheel increment: a notch must move the value, not jump it. */
export const WHEEL_STEP_MIN = 0.001
export const WHEEL_STEP_MAX = 1000

/**
 * Defaults. The theme and the interface size are the values the app opened
 * with before this panel existed — light and the 16 px root — so a first visit
 * (and a cleared storage) looks exactly like the published app. The wheel
 * increment starts at 1: one notch, one unit.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 'medium',
  accentColor: ACCENT_COLORS[0].hex,
  sheet: 'paper',
  grid: true,
  wheelStep: 1,
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
 * A wheel increment from anywhere (storage, a preset button, a typed string, a
 * hand-edited blob) as a positive number within the bounds. Zero, a negative, a
 * blank or anything unreadable falls back to the default — a notch that moved
 * nothing would read as a broken field — and a value out of bounds is brought
 * to the nearest end rather than dropped, so a large entry still works.
 */
export function normalizeWheelStep(raw: unknown): number {
  const v = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_SETTINGS.wheelStep
  return Math.min(WHEEL_STEP_MAX, Math.max(WHEEL_STEP_MIN, Math.round(v * 1000) / 1000))
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
    wheelStep: normalizeWheelStep(o.wheelStep),
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
 *
 * The wheel increment is published to the live store below at the same moment,
 * so a field starts stepping by the new value on its very next notch — the
 * listeners are native and read it when the wheel turns, not when the panel
 * re-renders.
 */
export function applySettings(s: AppSettings, root: HTMLElement): void {
  root.dataset.theme = s.theme
  root.dataset.sheet = s.sheet
  root.dataset.grid = s.grid ? 'on' : 'off'
  root.style.setProperty('--color-accent', s.accentColor)
  root.style.setProperty('--color-accent-ink', accentInk(s.accentColor))
  root.style.fontSize = `${fontSizePx(s.fontSize)}px`
  setWheelStep(s.wheelStep)
}

/* ---------------------------- the live wheel step -------------------------- */

/**
 * The increment one wheel notch moves a numeric field by, right now.
 *
 * The wheel listeners the inputs carry are native ones, attached long before —
 * and outside — the React tree the settings state lives in, and they must see a
 * change the instant the Settings panel writes one, without waiting for that
 * field to re-render. Publishing the value here keeps `settings.ts` the one
 * place that knows what the preferences are, in the same spirit as
 * `applySettings` writing the theme onto the document element for the
 * stylesheet: the interface is told, and so is the code that cannot ask React.
 * A field's tooltip reads it too (`useWheelStepSize`), so what a field promises
 * and what it does cannot drift apart.
 */
let wheelStep = DEFAULT_SETTINGS.wheelStep
const wheelStepListeners = new Set<() => void>()

/** The wheel increment in force — read by every wheel listener when a notch turns. */
export function liveWheelStep(): number {
  return wheelStep
}

/** Publish a new increment; the next notch of every field uses it. */
export function setWheelStep(v: number): void {
  const next = normalizeWheelStep(v)
  if (next === wheelStep) return
  wheelStep = next
  // a listener that unsubscribes from inside its own notification is fine: the
  // set iterates what is still in it
  for (const notify of wheelStepListeners) notify()
}

/** Subscribe to changes in the built-in store protocol (`useSyncExternalStore`). */
export function subscribeWheelStep(notify: () => void): () => void {
  wheelStepListeners.add(notify)
  return () => {
    wheelStepListeners.delete(notify)
  }
}
