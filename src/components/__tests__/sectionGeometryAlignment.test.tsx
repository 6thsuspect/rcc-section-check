/**
 * @vitest-environment jsdom
 *
 * UI alignment invariants for Section Geometry:
 *  1. Bar Diameter input box aligns horizontally at the exact same vertical level
 *     and shares the exact control height as Width B and Depth D (in both standard
 *     dropdown and custom numeric modes).
 *  2. Input labels above Width B, Depth D, and Bar ⌀ share the exact same label
 *     header height, bottom alignment, gap, and font styling.
 *  3. The Customize / Use standard button sits inside the bottom-aligned label row
 *     without expanding the label row height beyond adjacent labels.
 *  4. Uniform input heights and label spacing apply across all fields in Section Geometry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SectionPanel } from '../Editors'
import { fieldBoxCls, fieldLabelCls, selectCls } from '../ui'
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

describe('Section Geometry field alignment', () => {
  it('gives Width B, Depth D, Bar ⌀ (standard & custom), Bars/face (x), and Side bars (y) identical label heights, bottom-aligned headers, gap, and control height', async () => {
    const state = initialState()
    await act(async () => {
      root.render(<SectionPanel state={state} update={() => {}} />)
    })

    const grid = host.querySelector('.grid.grid-cols-2')!
    expect(grid.className).toContain('items-start')

    const labels = [...grid.querySelectorAll('label')]
    expect(labels).toHaveLength(5)

    // Every label wrapper uses identical flex column + 3px label-to-input gap
    for (const lbl of labels) {
      expect(lbl.className).toContain('flex min-w-0 flex-col gap-[3px]')
    }

    // Every label header row shares `fieldLabelCls` (`min-h-[0.875rem] items-end ...`)
    const headerRows = labels.map((l) => l.firstElementChild as HTMLElement)
    for (const hdr of headerRows) {
      for (const token of fieldLabelCls.split(' ')) {
        expect(hdr.classList.contains(token), `missing class "${token}" on ${hdr.textContent}`).toBe(true)
      }
    }

    // Customize button sits inside the 0.875rem bottom-aligned header row without overflowing its height
    const customizeBtn = labels[2].querySelector('button')!
    expect(customizeBtn.textContent).toBe('Customize')
    expect(customizeBtn.className).toContain('h-[0.8125rem]')
    expect(customizeBtn.className).toContain('leading-none')

    // All 5 control boxes (Width B, Depth D, Bar ⌀ <select>, Bars/face (x), Side bars (y)) share exact h-[1.875rem]
    for (const lbl of labels) {
      const control = lbl.children[1] as HTMLElement
      expect(control.className).toContain('h-[1.875rem]')
    }
    expect(fieldBoxCls).toContain('h-[1.875rem]')
    expect(selectCls).toContain('h-[1.875rem]')

    // Switching Bar ⌀ to custom mode keeps the exact same label header & control height
    await act(async () => {
      customizeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(customizeBtn.textContent).toBe('Use standard')
    const customControl = labels[2].children[1] as HTMLElement
    expect(customControl.className).toContain('h-[1.875rem]')
  })
})
