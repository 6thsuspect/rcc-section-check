/**
 * @vitest-environment jsdom
 *
 * The mouse-wheel increment, worked through the running app.
 *
 * Every other suite in this repo renders panels to static markup; a wheel notch
 * cannot be tested that way, because a ref is not markup. This file mounts the
 * app in a real DOM (jsdom, for this file only — `@vitest-environment` above),
 * turns the wheel over the fields the user reported and reads the values back
 * off the screen. It is the end-to-end half of `wheelStep.test.ts`, which pins
 * the stepping rule and the listener on their own.
 *
 * What it covers, in the user's terms:
 *  - the reported case: Circular Reinforcement → the bundle and triple-bar
 *    spacing fields step by the configured increment (1 by default), not by the
 *    5 mm their spinner arrows are set to;
 *  - the setting in the Settings panel changes it for the very next notch, on
 *    the field already on screen, with no reload;
 *  - it applies to every numeric field in the app, not only that one;
 *  - wheel up increases and wheel down decreases, and the page is held still
 *    while the wheel is over a field.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../../App'
import { DEFAULT_SETTINGS, SETTINGS_KEY, WHEEL_STEPS } from '../../settings'

// React 19 asks for this flag before it will run `act` in a test environment.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
})

/* ------------------------------- helpers -------------------------------- */

/** The app's own buttons, found by the text they show or the name they carry. */
const button = (text: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].find(
    (b) =>
      (b.textContent ?? '').trim().startsWith(text) ||
      b.getAttribute('aria-label') === text ||
      b.getAttribute('title') === text,
  )
  if (!found) throw new Error(`no button "${text}"`)
  return found as HTMLButtonElement
}

const click = async (text: string) => {
  await act(async () => button(text).dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

/** The input inside the labelled field whose label starts with `label`. */
const field = (label: string): HTMLInputElement => {
  const found = [...host.querySelectorAll('input[type="number"]')].find((i) =>
    (i.closest('label')?.textContent ?? '').trim().startsWith(label),
  )
  if (!found) throw new Error(`no numeric field labelled "${label}"`)
  return found as HTMLInputElement
}

/** Every enabled numeric input on screen, in document order. */
const numberFields = (): HTMLInputElement[] =>
  [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].filter((i) => !i.disabled)

/** One wheel notch over a field, the way a mouse delivers it. */
const wheel = async (el: HTMLInputElement, deltaY: number, many = 1): Promise<boolean[]> => {
  const prevented: boolean[] = []
  for (let i = 0; i < many; i++) {
    // each notch in its own commit, as a mouse delivers them: the field is
    // re-rendered between events and the next notch steps from what it shows
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      prevented.push(e.defaultPrevented)
    })
  }
  return prevented
}

/**
 * The automatic value a blank field is standing in for — printed in its
 * placeholder as "auto · 61" (or "equal · 239" where the panel calls it equal
 * spacing rather than automatic).
 */
const autoOf = (el: HTMLInputElement): number => {
  const m = /(?:auto|equal) · (\d+(?:\.\d+)?)/.exec(el.placeholder)
  if (!m) throw new Error(`field has no automatic value: ${JSON.stringify(el.placeholder)}`)
  return Number(m[1])
}

/** How a field reads in a failure message. */
const nameOf = (el: HTMLInputElement): string =>
  (el.closest('label')?.textContent ?? '').trim().slice(0, 40) ||
  el.getAttribute('aria-label') ||
  `placeholder "${el.placeholder}"`

/** Choose a measurement increment from the Settings panel. */
const setWheelStep = async (value: number) => {
  await click('Settings')
  const preset = [...host.querySelectorAll('button')].find(
    (b) => b.title === `One wheel notch moves a field by ${value}`,
  )
  if (!preset) throw new Error(`no wheel preset for ${value}`)
  await act(async () => preset.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await click('Done')
}

/** Circular Reinforcement → Bundle bars, with its spacing fields on screen. */
const circular = async (...kind: string[]) => {
  await click('Circle')
  for (const k of kind) await click(k)
}

/* ---------------------------------- tests -------------------------------- */

describe('the reported fields: spacing in bundle and triple bars', () => {
  it('steps the bar spacing in a bundle by the configured increment, not by 5', async () => {
    await circular('Bundle bars')
    const inner = field('Bar spacing in bundle (c/c)')

    // the field is blank (it is using the automatic spacing) and its spinner
    // arrows keep the 5 mm step they have always had
    expect(inner.value).toBe('')
    expect(inner.getAttribute('step')).toBe('5')
    const auto = autoOf(inner)

    // one notch up: the automatic value it was standing in for, plus the
    // default increment of 1 — not zero, and not a jump of 5
    expect(await wheel(inner, -100)).toEqual([true])
    expect(Number(inner.value)).toBe(auto + 1)
    expect(await wheel(inner, -100)).toEqual([true])
    expect(Number(inner.value)).toBe(auto + 2)

    // and back down, one increment at a time
    await wheel(inner, 100)
    expect(Number(inner.value)).toBe(auto + 1)
  })

  it('steps the bundle-to-bundle spacing the same way', async () => {
    await circular('Bundle bars')
    const spacing = field('Bundle spacing (c/c)')
    const auto = autoOf(spacing)
    expect(spacing.getAttribute('step')).toBe('5')
    // the placeholder prints the automatic spacing in whole millimetres while
    // the value itself carries a fraction: the notch starts from the value the
    // app is using, so it lands within that rounding — then moves by exactly one
    await wheel(spacing, -100)
    const first = Number(spacing.value)
    expect(first - auto).toBeGreaterThan(0)
    expect(first - auto).toBeLessThanOrEqual(1.5)
    await wheel(spacing, -100)
    expect(Number(spacing.value)).toBe(first + 1)
    await wheel(spacing, 100)
    expect(Number(spacing.value)).toBe(first)
  })

  it('steps the triple-bar group spacing, a field with a value of its own', async () => {
    await circular('Triple bars')
    const group = field('Spacing within group')
    const start = Number(group.value)
    expect(start).toBeGreaterThan(0)
    await wheel(group, -100)
    expect(Number(group.value)).toBe(start + 1)
    await wheel(group, 100, 2)
    expect(Number(group.value)).toBe(start - 1)
  })
})

describe('the setting in the Settings panel', () => {
  it('changes the increment for the very next notch of the field on screen', async () => {
    await circular('Bundle bars')
    const inner = field('Bar spacing in bundle (c/c)')
    const auto = autoOf(inner)

    expect(await wheel(inner, -100)).toEqual([true])
    expect(Number(inner.value)).toBe(auto + 1)

    // the panel offers the increment, and the preset that is in force is the
    // pressed one; picking 5 takes effect at once
    await setWheelStep(5)

    // …and the field says so before it is touched again: the tooltip names the
    // increment in force, so what a field promises and what it does agree
    expect(inner.closest('label')?.getAttribute('title')).toContain('step it by 5 mm')
    await wheel(inner, -100)
    expect(Number(inner.value)).toBe(auto + 6)
    await wheel(inner, 100)
    expect(Number(inner.value)).toBe(auto + 1)
  })

  it('offers the presets and any other number, and stores what is chosen', async () => {
    await circular('Bundle bars')
    await click('Settings')
    for (const s of WHEEL_STEPS) {
      expect(
        [...host.querySelectorAll('button')].some(
          (b) => b.title === `One wheel notch moves a field by ${s.label}`,
        ),
      ).toBe(true)
    }
    // a number that is not one of the presets, typed into the box
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Mouse-wheel increment per notch"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(box, '2.5')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // it is stored, so the app opens on it next time
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).wheelStep).toBe(2.5)
    await click('Done')

    // and the field on screen steps by it — a fraction of a millimetre per notch
    const inner = field('Bar spacing in bundle (c/c)')
    const auto = autoOf(inner)
    await wheel(inner, -100)
    expect(Number(inner.value)).toBe(auto + 2.5)
    await wheel(inner, -100)
    expect(Number(inner.value)).toBe(auto + 5)
  })

  it('opens on the default of one, and on what was stored', async () => {
    // the app as it opens: one unit per notch
    expect(DEFAULT_SETTINGS.wheelStep).toBe(1)
    const depth = field('Depth D')
    await wheel(depth, -100)
    expect(depth.value).toBe('601')

    // a stored 10 — the choice made in the panel an earlier session
    await setWheelStep(10)
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).wheelStep).toBe(10)

    // a fresh mount reads it back: the increment is a preference, not a session
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<App />))
    const fresh = field('Depth D')
    await wheel(fresh, -100)
    expect(fresh.value).toBe('610')
  })
})

describe('every numeric field, not only the reported one', () => {
  it('moves a section dimension by the configured increment, not by its own 10 mm step', async () => {
    const depth = field('Depth D')
    expect(depth.value).toBe('600')
    expect(depth.getAttribute('step')).toBe('10') // the arrows keep their step
    await wheel(depth, -100)
    expect(depth.value).toBe('601')
    await wheel(depth, 100)
    expect(depth.value).toBe('600')
  })

  it('moves a load case, a bar position and a cover, all by the one increment', async () => {
    await setWheelStep(5)

    // a load case (the first factored load row, placeholder "1000")
    const pu = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].filter(
      (i) => i.placeholder === '1000',
    )[0]
    const p0 = Number(pu.value)
    await wheel(pu, -100)
    expect(pu.value).toBe(String(p0 + 5))

    // the first bar's x in the reinforcement table (placeholder "0")
    const barX = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].filter(
      (i) => i.placeholder === '0',
    )[0]
    const x0 = Number(barX.value)
    await wheel(barX, -100)
    expect(Number(barX.value)).toBe(x0 + 5)

    const cover = field('Clear cover')
    const c0 = Number(cover.value)
    await wheel(cover, -100)
    expect(Number(cover.value)).toBe(c0 + 5)
  })

  it('holds the page still over a field, and steps every enabled field on screen', async () => {
    const fields = numberFields()
    // the whole numeric surface of the open tab: section, cover, bars, load cases
    expect(fields.length).toBeGreaterThan(40)

    const unmoved: string[] = []
    const scrolled: string[] = []
    for (let i = 0; i < fields.length; i++) {
      // the field is re-rendered between notches, so re-read the element each
      // time (a notch on one field can move another)
      const before = fields.map((f) => f.value)
      const el = numberFields()[i]
      const prevented = await wheel(el, -100)
      if (!prevented[0]) scrolled.push(nameOf(el))
      if (before[i] === numberFields()[i]?.value) unmoved.push(nameOf(el))
    }

    // every notch was taken by its field — none scrolled the page away
    expect(scrolled).toEqual([])
    // and every enabled numeric field in the app moved
    expect(unmoved).toEqual([])
  })

  it('leaves a locked field inert, so the page keeps scrolling over it', async () => {
    await click('Freeze')
    const width = field('Width B')
    expect(width.disabled).toBe(true)
    expect(await wheel(width, -100)).toEqual([false])
  })
})
