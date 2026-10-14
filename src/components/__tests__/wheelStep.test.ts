/**
 * Mouse-wheel editing of numeric fields — the shared stepping rule and the
 * native listener the detailing fields attach to themselves.
 *
 * The listener is exercised through a fake element that provides only the
 * listener pair (`addEventListener` / `removeEventListener`) and a `wheel`
 * dispatcher, because the suite runs without a DOM; everything else in these
 * tests is the production code path.
 */
import { describe, expect, it, vi } from 'vitest'
import { attachWheelStep, wheelNotches, wheelStepValue, type WheelStepOpts } from '../ui'

interface FakeWheelEvent {
  deltaY: number
  defaultPrevented: boolean
  preventDefault(): void
}

/** Element stand-in: records the listeners it is given and dispatches to them. */
function fakeEl() {
  const listeners: { type: string; fn: (e: FakeWheelEvent) => void; opts: unknown }[] = []
  const el = {
    addEventListener(type: string, fn: (e: FakeWheelEvent) => void, opts: unknown) {
      listeners.push({ type, fn, opts })
    },
    removeEventListener(_type: string, fn: (e: FakeWheelEvent) => void) {
      const i = listeners.findIndex((l) => l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    },
  } as unknown as HTMLElement
  const wheel = (deltaY: number): FakeWheelEvent => {
    const e: FakeWheelEvent = {
      deltaY,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true
      },
    }
    for (const l of listeners) if (l.type === 'wheel') l.fn(e)
    return e
  }
  return { el, wheel, listeners }
}

const one = { value: 180, step: 10 }

describe('wheel step rule', () => {
  it('moves one field step per notch, up for a wheel up and down for a wheel down', () => {
    expect(wheelStepValue(one, 1)).toBe(190)
    expect(wheelStepValue(one, -1)).toBe(170)
    // and several notches at once move several steps
    expect(wheelStepValue(one, 3)).toBe(210)
    expect(wheelStepValue(one, -2)).toBe(160)
  })

  it('moves by the step from the value on screen, so no notch can be rounded away', () => {
    // the default section places an intermediate leg on the bar column at
    // 170.2 mm: a notch moves it a full 10 mm from where it is
    expect(wheelStepValue({ value: 170.2, step: 10 }, 1)).toBe(180.2)
    expect(wheelStepValue({ value: 170.2, step: 10 }, -1)).toBe(160.2)
    expect(wheelStepValue({ value: 170.2, step: 10 }, 2)).toBe(190.2)
    // a member position is stored to a thousandth of the section width, which on
    // a wide section is coarser than a millimetre: a snapped target would round
    // straight back onto 170.1 and the notch would do nothing
    expect(wheelStepValue({ value: 170.1, step: 10 }, -1)).not.toBe(170.1)
    expect(wheelStepValue({ value: 220.05, step: 10 }, 1)).toBeGreaterThan(220.05)
  })

  it('keeps the field own decimals, without floating point noise', () => {
    expect(wheelStepValue({ value: 0.2, step: 0.1 }, 1)).toBe(0.3)
    expect(wheelStepValue({ value: 0.3, step: 0.1 }, -1)).toBe(0.2)
    expect(wheelStepValue({ value: 12, step: 1 }, 1)).toBe(13)
    // a fraction of a millimetre survives the notch — a 10 mm move, not a 9.8 mm one
    expect(wheelStepValue({ value: 170.1666666667, step: 10 }, 1)).toBe(180.167)
  })

  it('honours the limits the field was given', () => {
    // the leg count cannot go below the two legs of the closed link
    expect(wheelStepValue({ value: 2, step: 1, min: 2 }, -1)).toBe(2)
    expect(wheelStepValue({ value: 3, step: 1, min: 2 }, -1)).toBe(2)
    expect(wheelStepValue({ value: 10, step: 1, min: 2, max: 10 }, 1)).toBe(10)
  })

  it('does not clamp a field that was given no limits, so an entered position is reported, not moved', () => {
    // a member position may be typed outside the section on purpose: the editor
    // reports it, so the wheel must be able to walk out of range as well
    expect(wheelStepValue({ value: 700, step: 10 }, 1)).toBe(710)
    expect(wheelStepValue({ value: -30, step: 10 }, -1)).toBe(-40)
  })

  it('treats a blank or non-finite value as zero and falls back to a step of one', () => {
    expect(wheelStepValue({ value: NaN, step: 1 }, 1)).toBe(1)
    expect(wheelStepValue({ value: NaN, step: 10, min: 0 }, -1)).toBe(0)
    // a blank member position steps below zero like any other position would
    expect(wheelStepValue({ value: NaN, step: 10 }, -1)).toBe(-10)
    expect(wheelStepValue({ value: 5 }, 1)).toBe(6)
    expect(wheelStepValue({ value: 5, step: 0 }, 1)).toBe(6)
  })

  it('reads a gesture as one notch either way, and a sideways gesture as none', () => {
    expect(wheelNotches(-100)).toBe(1)
    expect(wheelNotches(100)).toBe(-1)
    expect(wheelNotches(0)).toBe(0)
  })
})

describe('wheel listener on a field', () => {
  const opts = (over: Partial<WheelStepOpts> = {}): WheelStepOpts => ({
    value: 180,
    onChange: () => {},
    step: 10,
    ...over,
  })

  it('listens non-passively, so the page can be held still while the value is edited', () => {
    const { el, listeners, wheel } = fakeEl()
    attachWheelStep(el, () => opts())
    expect(listeners).toHaveLength(1)
    expect(listeners[0].type).toBe('wheel')
    // React registers its own `onWheel` at the root as a passive listener, where
    // preventDefault is ignored — this listener has to be native to hold the page
    expect(listeners[0].opts).toMatchObject({ passive: false })
    const e = wheel(-100)
    expect(e.defaultPrevented).toBe(true)
  })

  it('steps the value up and down by the field step and updates on every notch', () => {
    const { el, wheel } = fakeEl()
    const onChange = vi.fn()
    attachWheelStep(el, () => opts({ onChange }))
    wheel(-100)
    expect(onChange).toHaveBeenLastCalledWith(190)
    wheel(100)
    expect(onChange).toHaveBeenLastCalledWith(170)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('steps from the value on screen, one notch per event', () => {
    const { el, wheel } = fakeEl()
    const onChange = vi.fn()
    let value = 180
    const field = () => opts({ value, onChange: (v: number) => { value = v; onChange(v) } })
    attachWheelStep(el, field)
    wheel(-100) // 190, and the parent renders it
    wheel(-100) // 200
    wheel(100) // 190
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([190, 200, 190])
  })

  it('asks for one step from the value on screen, so a field that clamps cannot drift', () => {
    // the leg count is capped at 10: each notch asks the panel for one more leg
    // than the value shown, and the panel decides. No notch is banked up, so the
    // first wheel down after a wheel up at the cap moves the count straight away.
    const { el, wheel } = fakeEl()
    const onChange = vi.fn()
    let value = 10
    attachWheelStep(el, () => opts({ step: 1, value, min: 2, onChange: (v) => { value = Math.min(10, v); onChange(v) } }))
    wheel(-100)
    wheel(-100)
    expect(value).toBe(10)
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([11, 11])
    wheel(100)
    expect(onChange).toHaveBeenLastCalledWith(9)
  })

  it('leaves the page alone on a sideways gesture', () => {
    const { el, wheel } = fakeEl()
    const onChange = vi.fn()
    attachWheelStep(el, () => opts({ onChange }))
    const e = wheel(0)
    expect(e.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is inert on a field that has not opted in or is locked, so the page keeps scrolling', () => {
    const { el, wheel } = fakeEl()
    const onChange = vi.fn()
    attachWheelStep(el, () => opts({ onChange, enabled: false }))
    const e = wheel(-100)
    expect(e.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops listening once detached', () => {
    const { el, wheel, listeners } = fakeEl()
    const onChange = vi.fn()
    const detach = attachWheelStep(el, () => opts({ onChange }))
    expect(listeners).toHaveLength(1)
    detach()
    expect(listeners).toHaveLength(0)
    wheel(-100)
    expect(onChange).not.toHaveBeenCalled()
  })
})
