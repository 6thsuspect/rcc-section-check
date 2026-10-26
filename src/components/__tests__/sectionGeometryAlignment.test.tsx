/**
 * @vitest-environment jsdom
 *
 * UI alignment invariants for Section Geometry & Advanced Reinforcement Layer Configuration:
 *  - Width B, Depth D, and Bar ⌀ (standard dropdown & custom numeric mode) share
 *    identical label strip height, bottom-aligned labels, gap, and control height.
 *  - Under Advanced Reinforcement → Layer Configuration across all 4 faces (Top,
 *    Bottom, Left, Right) and multiple layers (Layer 1, Layer 2, ...), Number of Bars,
 *    Bar Diameter, and Bar Spacing (c/c) use a narrower proportional count track,
 *    spacious Bar Diameter & Bar Spacing tracks, single-line aligned labels, and
 *    identical `h-[1.875rem]` input box heights.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SectionPanel } from '../Editors'
import { RectRebarPanel } from '../RectRebarPanel'
import { fieldBoxCls, fieldLabelCls, selectCls } from '../ui'
import { RECT_FACES, rectConfigFromSection } from '../../engine/rectRebar'
import { initialState } from '../../state'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('Section Geometry & Advanced Reinforcement UI alignment', () => {
  it('aligns Width B, Depth D, Bar ⌀ (standard & custom), Bars/face (x), and Side bars (y) across Section Geometry', async () => {
    const state = initialState()
    await act(async () => {
      root.render(<SectionPanel state={state} update={() => {}} />)
    })

    const grid = host.querySelector('.grid.grid-cols-2')!
    expect(grid.className).toContain('items-start')

    const labels = [...grid.querySelectorAll('label')]
    expect(labels).toHaveLength(5)

    for (const lbl of labels) {
      expect(lbl.className).toContain('flex min-w-0 flex-col gap-[3px]')
      const hdr = lbl.firstElementChild as HTMLElement
      for (const token of fieldLabelCls.split(' ')) {
        expect(hdr.classList.contains(token), `missing class "${token}" on ${hdr.textContent}`).toBe(true)
      }
      const control = lbl.children[1] as HTMLElement
      expect(control.className).toContain('h-[1.875rem]')
    }
    expect(fieldBoxCls).toContain('h-[1.875rem]')
    expect(selectCls).toContain('h-[1.875rem]')

    const customizeBtn = labels[2].querySelector('button')!
    expect(customizeBtn.textContent).toBe('Customize')
    expect(customizeBtn.className).toContain('h-[0.8125rem]')
    expect(customizeBtn.className).toContain('leading-none')

    await act(async () => {
      customizeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(customizeBtn.textContent).toBe('Use standard')
    expect((labels[2].children[1] as HTMLElement).className).toContain('h-[1.875rem]')
  })

  it('aligns Number of bars, Bar diameter, and Bar spacing (c/c) consistently across all faces and multiple layers with narrower Number of bars column', async () => {
    const base = initialState()
    let cfg = rectConfigFromSection(base.predefined, base.barDia, true)

    // Add a second inner layer on every face so all 4 faces × 2 layers are verified
    for (const face of RECT_FACES) {
      cfg = {
        ...cfg,
        faces: {
          ...cfg.faces,
          [face]: {
            ...cfg.faces[face],
            layers: [
              cfg.faces[face].layers[0],
              { ...cfg.faces[face].layers[0], id: `${face}-layer-2`, nBars: 2 },
            ],
          },
        },
      }
    }

    for (const face of RECT_FACES) {
      const faceCfg = { ...cfg, activeFace: face }
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        root.render(
          <RectRebarPanel
            config={faceCfg}
            geometry={base.geometry}
            cover={base.cover}
            tieDia={base.tieDia}
            onChange={(next) => {
              cfg = next
            }}
            onDisable={() => {}}
          />,
        )
      })

      for (const layerNum of [1, 2]) {
        const row = host.querySelector(`[data-testid="rect-layer-fields-${face}-${layerNum}"]`)!
        expect(row, `missing field grid for ${face} layer ${layerNum}`).toBeTruthy()
        expect(row.className).toContain('items-end')
        // Proportional column sizing: Number of bars (0.8fr) is narrower than Bar diameter (1.24fr) & Bar spacing (0.96fr)
        expect(row.className).toContain('min-[480px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.24fr)_minmax(0,0.96fr)]')

        const fields = [...row.querySelectorAll('label')]
        expect(fields).toHaveLength(3)
        expect(fields[0].textContent).toContain('Number of bars')
        expect(fields[1].textContent).toContain('Bar diameter')
        expect(fields[2].textContent).toContain('Bar spacing (c/c)')

        for (const f of fields) {
          expect(f.className).toContain('flex min-w-0 flex-col gap-[3px]')
          const hdr = f.firstElementChild as HTMLElement
          for (const token of fieldLabelCls.split(' ')) {
            expect(hdr.classList.contains(token)).toBe(true)
          }
          const control = f.children[1] as HTMLElement
          expect(control.className).toContain('h-[1.875rem]')
        }

        // Responsive adaptation for narrower (<480px) containers
        expect(fields[2].className).toContain('col-span-2')
        expect(fields[2].className).toContain('min-[480px]:col-span-1')
      }
    }
  })
})
