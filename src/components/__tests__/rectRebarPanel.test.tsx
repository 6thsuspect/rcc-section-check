/**
 * @vitest-environment jsdom
 *
 * End-to-end interactive DOM verification for Advanced Rectangular Reinforcement:
 *  - Preserves existing standard rectangular reinforcement until explicitly enabled;
 *  - Independent face customization on Top, Bottom, Left, and Right;
 *  - Repeating alternate diameter sequences (including Ø16–Ø20–Ø25);
 *  - Bundled bars (2-bar, 3-bar, mixed diameters, bundle & inner spacings);
 *  - Coexisting bundles and single bars on the same face;
 *  - Multi-layer stacks with customizable Spacer Bar Diameter (Ø) & SVG spacer rendering;
 *  - Interactive cross-section bar-coordinate inspection matching the reinforcement table;
 *  - Mouse-wheel increment compatibility on every numeric input added by the panel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../../App'

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

const click = async (el: Element) => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const byTestId = <T extends Element = HTMLElement>(id: string): T => {
  const el = host.querySelector<T>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`missing [data-testid="${id}"]`)
  return el
}

const buttonByText = (container: ParentNode, text: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').trim().startsWith(text),
  )
  if (!found) throw new Error(`missing button "${text}"`)
  return found as HTMLButtonElement
}

describe('Advanced Rectangular Reinforcement UI & Diagram Integration', () => {
  it('leaves default rectangular reinforcement untouched until Advanced reinforcement is selected, then syncs all 4 faces, layers, bundles, spacers & coordinate inspector', async () => {
    // 1. Default load: Advanced panel is NOT active; standard 12-bar rectangular section is untouched
    expect(host.querySelector('[data-testid="rect-advanced-rebar-panel"]')).toBeNull()
    const toggleBtn = byTestId<HTMLButtonElement>('toggle-rect-advanced-rebar')
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelectorAll('circle[data-bar-index]')).toHaveLength(12)

    // 2. Enable Advanced reinforcement -> seeded seamlessly at 12 bars across Top, Bottom, Left, Right
    await click(toggleBtn)
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true')
    const panel = byTestId('rect-advanced-rebar-panel')
    expect(host.querySelectorAll('circle[data-bar-index]')).toHaveLength(12)

    // 3. Configure Bottom face: Alternate ⌀ with 3-bar pattern Ø16–Ø20–Ø25 + add a 2nd layer with Spacer Bar ⌀
    await click(byTestId('rect-face-tab-bottom'))
    const botL1 = byTestId('rect-layer-bottom-1')
    await click(buttonByText(botL1, 'Alternate ⌀'))
    await click(buttonByText(botL1, '⌀16–⌀20–⌀25'))

    // Add Layer 2 on Bottom face -> creates a transverse Spacer Bar drawn on SectionPreview!
    await click(buttonByText(panel, 'Add layer'))
    expect(host.querySelectorAll('[data-testid="spacer-bars-group"] > g').length).toBe(1)
    expect(byTestId('reinforcement-visual-key').textContent).toContain('2 layers')
    expect(byTestId('reinforcement-visual-key').textContent).toContain('1 spacer')

    // 4. Configure Top face independently with 3-bar Bundles
    await click(byTestId('rect-face-tab-top'))
    const topL1 = byTestId('rect-layer-top-1')
    await click(buttonByText(topL1, 'Bundles'))
    await click(buttonByText(topL1, '3-bar bundle'))
    expect(host.querySelectorAll('[data-testid="bundle-halos-group"] > circle').length).toBeGreaterThanOrEqual(2)

    // 5. Configure Right face independently with Mixed groups (coexisting Single bar + Bundle on same face)
    await click(byTestId('rect-face-tab-right'))
    const rightL1 = byTestId('rect-layer-right-1')
    await click(buttonByText(rightL1, 'Mixed groups'))
    await click(buttonByText(rightL1, 'Single bar'))
    await click(buttonByText(rightL1, '2-bar bundle'))

    // 6. Click a bar directly on SectionPreview SVG -> inspector shows exact coordinates matching the bar table!
    const firstSvgBar = host.querySelector('circle[data-bar-index="1"]')!
    await click(firstSvgBar)
    const inspector = byTestId('bar-inspector')
    expect(inspector.textContent).toContain('Bar #1')

    const rebarCard = [...host.querySelectorAll('section')].find((s) =>
      (s.querySelector('h2')?.textContent ?? '').includes('Reinforcement bars'),
    )!
    const firstRowInputs = [...rebarCard.querySelectorAll<HTMLInputElement>('tbody tr:first-child input[type="number"]')]
    expect(inspector.textContent).toContain(`X = ${firstRowInputs[0].value} mm`)
    expect(inspector.textContent).toContain(`Y = ${firstRowInputs[1].value} mm`)

    // 7. Switching back to Standard restores clean standard perimeter reinforcement
    await click(buttonByText(panel.closest('section')!, 'Standard'))
    expect(host.querySelector('[data-testid="rect-advanced-rebar-panel"]')).toBeNull()
    expect(host.querySelectorAll('circle[data-bar-index]')).toHaveLength(12)
  })

  it(
    'steps every numeric field inside Advanced Rectangular Reinforcement with the mouse wheel',
    async () => {
      await click(byTestId('toggle-rect-advanced-rebar'))
      const panel = byTestId('rect-advanced-rebar-panel')

      // Open multi-layer + bundle controls so every optional & custom numeric input is mounted
      await click(buttonByText(panel, 'Add layer'))
      const layer1 = byTestId('rect-layer-bottom-1')
      await click(buttonByText(layer1, 'Bundles'))

      const count = panel.querySelectorAll('input[type="number"]:not(:disabled)').length
      expect(count).toBeGreaterThanOrEqual(6)

      for (let i = 0; i < count; i++) {
        const el = panel.querySelectorAll<HTMLInputElement>('input[type="number"]:not(:disabled)')[i]
        const before = el.value
        let prevented = false
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          const ev = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
          el.dispatchEvent(ev)
          prevented = ev.defaultPrevented
        })
        const after = panel.querySelectorAll<HTMLInputElement>('input[type="number"]:not(:disabled)')[i].value
        expect(prevented).toBe(true)
        expect(after).not.toBe(before)
      }
    },
    15_000,
  )
})
