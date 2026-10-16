/**
 * Appearance settings — the module behind the header's Settings panel.
 *
 * Three things are pinned here, because they are the ones that break quietly:
 *  - `normalizeSettings` turns anything (a half-written entry, an older build's
 *    value, a hand-edited blob) into a complete settings object, one field at a
 *    time, so an unreadable preference never costs the user the others;
 *  - reading and writing never throw — a storage that is missing, empty, full or
 *    blocked must leave the app working, and the app must open on its defaults;
 *  - `applySettings` writes exactly the three attributes and the two properties
 *    the stylesheet keys off, and the stylesheet really does define them: the
 *    dark palette, the sheet tints, the dark shadows and the grid switch are
 *    all read back out of `src/index.css`, which vitest cannot import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ACCENT_COLORS,
  DEFAULT_SETTINGS,
  FONT_SIZES,
  SETTINGS_KEY,
  SHEET_THEMES,
  WHEEL_STEP_MAX,
  WHEEL_STEP_MIN,
  WHEEL_STEPS,
  accentInk,
  applySettings,
  fontSizePx,
  liveWheelStep,
  normalizeSettings,
  normalizeWheelStep,
  readSettings,
  setWheelStep,
  subscribeWheelStep,
  writeSettings,
  type AppSettings,
} from '../settings'

/** No test may leave the app stepping by anything but the default. */
afterEach(() => setWheelStep(DEFAULT_SETTINGS.wheelStep))

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

/** Just enough of `Storage` for the two helpers, with optional failure modes. */
function memStorage(seed: Record<string, string> = {}, opts: { failRead?: boolean; failWrite?: boolean } = {}) {
  const map = new Map(Object.entries(seed))
  const written: string[] = []
  return {
    written,
    getItem(k: string) {
      if (opts.failRead) throw new Error('blocked')
      return map.get(k) ?? null
    },
    setItem(k: string, v: string) {
      if (opts.failWrite) throw new Error('quota')
      written.push(`${k}=${v}`)
      map.set(k, v)
    },
  } as unknown as Storage & { written: string[] }
}

/** An element stand-in: `applySettings` only touches `dataset` and `style`. */
function stubRoot() {
  const props = new Map<string, string>()
  return {
    props,
    el: {
      dataset: {} as DOMStringMap,
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
        fontSize: '',
      },
    } as unknown as HTMLElement & { dataset: DOMStringMap; style: { fontSize: string } },
  }
}

describe('settings defaults', () => {
  it('opens on the app it has always been: light, medium, drafting blue, paper', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'light',
      fontSize: 'medium',
      accentColor: '#256abf',
      sheet: 'paper',
      grid: true,
      wheelStep: 1,
    })
    // the accent the app ships with is the first swatch, so the panel shows one
    // selection rather than six unselected colours
    expect(ACCENT_COLORS[0].hex).toBe(DEFAULT_SETTINGS.accentColor)
    // medium is the size the interface has always had: 16 px root, the browser
    // default the rem values in the app were written against
    expect(FONT_SIZES.map((f) => [f.id, f.px])).toEqual([
      ['small', 14],
      ['medium', 16],
      ['large', 18],
    ])
  })

  it('opens with a wheel increment of one, offered by the presets', () => {
    expect(DEFAULT_SETTINGS.wheelStep).toBe(1)
    // the presets include the default, so the panel shows one selection rather
    // than a row of unselected buttons beside the number it is stepping by
    expect(WHEEL_STEPS.map((s) => s.value)).toContain(DEFAULT_SETTINGS.wheelStep)
    expect(WHEEL_STEPS.map((s) => s.value)).toEqual([0.1, 1, 5, 10])
    // and the bounds leave room for a fine ⌀ or a coarse walk over a big value
    expect(WHEEL_STEP_MIN).toBeLessThan(0.1)
    expect(WHEEL_STEP_MAX).toBeGreaterThan(10)
  })

  it('offers the four drafting sheets, each with the swatch the CSS paints', () => {
    expect(SHEET_THEMES.map((s) => s.id)).toEqual(['paper', 'blueprint', 'graph', 'cream'])
    for (const sheet of SHEET_THEMES) {
      const token = /var\((--tint-[a-z]+)\)/.exec(sheet.swatch)?.[1]
      expect(token).toBeTruthy()
      expect(css).toContain(`${token}: #`)
      expect(css).toContain(`--color-canvas: var(${token})`)
    }
  })
})

describe('normalizeSettings', () => {
  it('accepts a complete, valid object unchanged', () => {
    const s: AppSettings = {
      theme: 'dark',
      fontSize: 'large',
      accentColor: '#8b5cf6',
      sheet: 'cream',
      grid: false,
      wheelStep: 5,
    }
    expect(normalizeSettings(s)).toEqual(s)
  })

  it('falls back to the defaults for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'dark', [], true]) {
      expect(normalizeSettings(junk)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('repairs each field on its own — one bad value does not reset the rest', () => {
    expect(
      normalizeSettings({
        theme: 'sepia',
        fontSize: 'huge',
        accentColor: 'chartreuse',
        sheet: 'marble',
        grid: 'yes',
      }),
    ).toEqual(DEFAULT_SETTINGS)

    expect(
      normalizeSettings({
        theme: 'dark',
        fontSize: 16, // a number from some other build
        accentColor: '#22C55E', // upper case is still a hex
        sheet: 'graph',
        grid: false,
        wheelStep: '2.5', // a string from a hand-edited entry is still a number
      }),
    ).toEqual({
      theme: 'dark',
      fontSize: 'medium',
      accentColor: '#22c55e',
      sheet: 'graph',
      grid: false,
      wheelStep: 2.5,
    })
  })

  it('drops unknown keys instead of carrying them around', () => {
    const s = normalizeSettings({ theme: 'dark', dimensionFontScale: 1.5, canvasTheme: 'grasshopper' })
    expect(Object.keys(s).sort()).toEqual(['accentColor', 'fontSize', 'grid', 'sheet', 'theme', 'wheelStep'])
  })
})

describe('the wheel increment', () => {
  it('falls back to the default for anything that would not move a field', () => {
    // a notch that moved the value nowhere would read as a broken field
    for (const junk of [undefined, null, 0, -5, NaN, Infinity, '', 'abc', {}, [], false]) {
      expect(normalizeWheelStep(junk)).toBe(DEFAULT_SETTINGS.wheelStep)
    }
  })

  it('keeps an entered increment, within the bounds', () => {
    expect(normalizeWheelStep(1)).toBe(1)
    expect(normalizeWheelStep(5)).toBe(5)
    expect(normalizeWheelStep(0.5)).toBe(0.5)
    expect(normalizeWheelStep(0.001)).toBe(0.001)
    expect(normalizeWheelStep('0.25')).toBe(0.25)
    // more precision than a notch can mean is trimmed, not carried around
    expect(normalizeWheelStep(0.123456)).toBe(0.123)
    // out of bounds is brought to the nearest end, not dropped
    expect(normalizeWheelStep(1e6)).toBe(WHEEL_STEP_MAX)
    expect(normalizeWheelStep(1e-9)).toBe(WHEEL_STEP_MIN)
  })

  it('is published as it is applied, so a field steps by it on its next notch', () => {
    const { el } = stubRoot()
    expect(liveWheelStep()).toBe(1) // the default the app opens on
    applySettings({ ...DEFAULT_SETTINGS, wheelStep: 5 }, el)
    expect(liveWheelStep()).toBe(5)
    // a value that arrives from storage unreadable never reaches the store
    applySettings({ ...DEFAULT_SETTINGS, wheelStep: -1 }, el)
    expect(liveWheelStep()).toBe(1)
  })

  it('notifies subscribers on a change, and only on a change', () => {
    const seen = vi.fn()
    const stop = subscribeWheelStep(seen)
    setWheelStep(5)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(liveWheelStep()).toBe(5)
    setWheelStep(5) // same value: nothing to re-render
    expect(seen).toHaveBeenCalledTimes(1)
    setWheelStep(2)
    expect(seen).toHaveBeenCalledTimes(2)
    stop()
    setWheelStep(3)
    expect(seen).toHaveBeenCalledTimes(2)
    // the value itself keeps changing whether or not anyone is listening
    expect(liveWheelStep()).toBe(3)
  })
})

describe('storage', () => {
  it('round-trips through the one key the app owns', () => {
    const store = memStorage()
    writeSettings({ ...DEFAULT_SETTINGS, theme: 'dark', sheet: 'blueprint' }, store)
    expect(store.written).toEqual([`${SETTINGS_KEY}=${JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'dark', sheet: 'blueprint' })}`])
    expect(readSettings(store)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', sheet: 'blueprint' })
  })

  it('opens on the defaults when there is nothing stored, or nothing readable', () => {
    expect(readSettings(memStorage())).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(memStorage({ [SETTINGS_KEY]: '{ not json' }))).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(memStorage({}, { failRead: true }))).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('normalises what it reads, so an older entry still opens on valid settings', () => {
    const store = memStorage({ [SETTINGS_KEY]: JSON.stringify({ theme: 'dark', fontSize: 'small', canvasTheme: 'dark' }) })
    expect(readSettings(store)).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      fontSize: 'small',
    })
  })

  it('survives a storage that refuses the write', () => {
    expect(() => writeSettings(DEFAULT_SETTINGS, memStorage({}, { failWrite: true }))).not.toThrow()
    expect(() => writeSettings(DEFAULT_SETTINGS, null)).not.toThrow()
  })
})

describe('applySettings', () => {
  it('writes the theme, sheet and grid attributes plus the accent and the root size', () => {
    const { el, props } = stubRoot()
    applySettings(
      { theme: 'dark', fontSize: 'large', accentColor: '#ec4899', sheet: 'graph', grid: false, wheelStep: 2 },
      el,
    )
    expect(el.dataset.theme).toBe('dark')
    expect(el.dataset.sheet).toBe('graph')
    expect(el.dataset.grid).toBe('off')
    expect(props.get('--color-accent')).toBe('#ec4899')
    // pink takes dark type: white on it is 3.5:1
    expect(props.get('--color-accent-ink')).toBe('#0b1620')
    expect(el.style.fontSize).toBe('18px')
  })

  it('turns the grid back on, and switches the sheet off the dark canvas', () => {
    const { el } = stubRoot()
    applySettings(DEFAULT_SETTINGS, el)
    expect(el.dataset.theme).toBe('light')
    expect(el.dataset.sheet).toBe('paper')
    expect(el.dataset.grid).toBe('on')
    expect(el.style.fontSize).toBe('16px')
  })

  it('gives every accent a readable ink for the filled buttons', () => {
    // the app's own accent carries white type, as it always has
    expect(accentInk(ACCENT_COLORS[0].hex)).toBe('#ffffff')
    // the pale swatches do not: white on them sits near 2.3:1
    for (const name of ['Green', 'Orange', 'Pink', 'Cyan']) {
      const swatch = ACCENT_COLORS.find((c) => c.name === name)
      expect(swatch, name).toBeTruthy()
      expect(accentInk(swatch!.hex)).toBe('#0b1620')
    }
    // anything unreadable is treated as the default accent
    expect(accentInk('chartreuse')).toBe('#ffffff')
  })

  it('maps every preset to a root font size', () => {
    expect(fontSizePx('small')).toBe(14)
    expect(fontSizePx('medium')).toBe(16)
    expect(fontSizePx('large')).toBe(18)
  })
})

describe('the stylesheet the settings are written into', () => {
  it('defines the dark theme as token overrides, and flips the native controls', () => {
    const dark = css.slice(css.indexOf("html[data-theme='dark'] {"))
    const block = dark.slice(0, dark.indexOf('\n}'))
    // every token the interface and the figures are drawn from needs a dark
    // value, or that part of the app would stay lit for the light theme
    for (const token of [
      '--color-ink:',
      '--color-ink-2:',
      '--color-ink-3:',
      '--color-panel:',
      '--color-card:',
      '--color-canvas:',
      '--color-edge:',
      '--color-edge-strong:',
      '--color-line:',
      '--color-grid:',
      '--color-concrete:',
      '--color-ok:',
      '--color-bad:',
      '--color-warn2:',
      '--color-accent-strong:',
    ]) {
      expect(block).toContain(token)
    }
    expect(block).toContain('color-scheme: dark')
    expect(css).toContain('html[data-theme=\'dark\'] .sel')
  })

  it('re-states the shadow utilities for the dark theme', () => {
    // Tailwind writes `shadow-*` values out in full, so re-pointing the tokens
    // is not enough — without these rules the dark theme keeps light shadows
    for (const cls of ['shadow-card', 'shadow-pop', 'shadow-header', 'shadow-btn']) {
      expect(css).toContain(`html[data-theme='dark'] .${cls} {`)
    }
  })

  it('turns the drafting grid off, and tints the canvas per sheet', () => {
    expect(css).toContain("html[data-grid='off'] body {")
    expect(css).toContain('background-image: none')
    for (const id of ['blueprint', 'graph', 'cream']) {
      expect(css).toContain(`html[data-sheet='${id}'] {`)
    }
    // the canvas tint and the grid line must come from tokens, not from a
    // literal that a dark theme could not override
    expect(css).toContain('var(--color-grid) 1px, transparent 1px')
    expect(css).not.toContain('rgb(23 34 44 / 0.028) 1px, transparent 1px')
  })

  it('keeps the interface in rem, so the font-size setting can scale it', () => {
    expect(css).toContain('font-size: 0.875rem')
    expect(css).not.toMatch(/text-\[[0-9.]+px\]/)
  })
})
