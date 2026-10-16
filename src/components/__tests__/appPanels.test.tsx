/**
 * The two header dialogs — Settings and About.
 *
 * Both are presentational, so they render to static markup: what is pinned here
 * is the content the reference app's dialogs carry (the settings sections, the
 * author card, the copyright line) and the state each control reports — the
 * chosen theme, sheet, size and accent are the pressed ones — plus the fact that
 * a closed dialog is not in the tree at all. The behaviour of the shell as a
 * dialog (Esc, the backdrop, the scroll lock) lives in `Modal.tsx` and is
 * asserted from its source, because vitest in this repo has no DOM.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { AboutPanel, APP_VERSION } from '../AboutPanel'
import { SettingsPanel } from '../SettingsPanel'
import { Modal } from '../Modal'
import App from '../../App'
import { ACCENT_COLORS, DEFAULT_SETTINGS, FONT_SIZES, SHEET_THEMES, type AppSettings } from '../../settings'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const modalSource = read('../Modal.tsx')

const noop = () => {}

const panel = (s: AppSettings = DEFAULT_SETTINGS) =>
  renderToStaticMarkup(<SettingsPanel settings={s} onChange={noop} onClose={noop} />)

/** The label of every control that reports itself as pressed/selected. */
function pressed(markup: string): string[] {
  return [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((m) => /aria-pressed="true"/.test(m[1]))
    .map((m) => `${/aria-label="([^"]*)"/.exec(m[1])?.[1] ?? ''}${m[2].replace(/<[^>]*>/g, '')}`)
    .map((s) => s.trim())
}

describe('settings panel', () => {
  it('renders every section of the reference dialog', () => {
    const html = panel()
    for (const section of ['Theme', 'Drafting sheet', 'Interface font size', 'Accent colour', 'Preview']) {
      expect(html).toContain(section)
    }
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    // one control per option, and each option is offered exactly once
    for (const size of FONT_SIZES) expect(html).toContain(`>${size.label}<`)
    for (const sheet of SHEET_THEMES) expect(html).toContain(`>${sheet.label}<`)
    for (const c of ACCENT_COLORS) expect(html).toContain(`aria-label="Accent colour ${c.name}"`)
    expect([...html.matchAll(/aria-label="Accent colour /g)]).toHaveLength(ACCENT_COLORS.length)
    expect(html).toContain('Drafting grid')
    expect(html).toContain('>Done<')
  })

  it('marks the stored choices, not the first option of each row', () => {
    const html = panel({
      theme: 'dark',
      fontSize: 'large',
      accentColor: '#8b5cf6',
      sheet: 'cream',
      grid: false,
    })
    const chosen = pressed(html)
    expect(chosen).toContain('Dark')
    expect(chosen).toContain('Large')
    expect(chosen).toContain('Cream')
    expect(chosen).toContain('Accent colour Purple')
    for (const other of ['Light', 'Small', 'Medium', 'Paper', 'Blueprint', 'Graph']) {
      expect(chosen).not.toContain(other)
    }
    // the grid checkbox carries the stored value in both directions
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
    expect(panel({ ...DEFAULT_SETTINGS, grid: true })).toMatch(/type="checkbox"[^>]*checked/)
    // the sheet tint is the light theme's, and the panel says so rather than
    // leaving a tinted option looking selected while the dark canvas is painted
    expect(html).toContain('the dark theme draws its own sheet')
  })

  it('still names the accent when it is not one of the swatches', () => {
    const html = panel({ ...DEFAULT_SETTINGS, accentColor: '#123456' })
    expect(html).toContain('Current accent: #123456')
    expect(pressed(html)).not.toContain('Accent colour Drafting blue')
  })

  it('shows the defaults selected on a first visit', () => {
    const chosen = pressed(panel())
    expect(chosen).toEqual(expect.arrayContaining(['Light', 'Medium', 'Paper', 'Accent colour Drafting blue']))
    expect(chosen).toHaveLength(4)
  })
})

describe('about panel', () => {
  const html = renderToStaticMarkup(<AboutPanel onClose={noop} />)

  it('carries the app mark, name, tagline and version', () => {
    expect(html).toContain('data-logo="app"')
    expect(html).toContain('RCC Section Check')
    expect(html).toContain('Draw · Analyse · Design')
    expect(html).toContain(`Version ${APP_VERSION}`)
    expect(html).toContain('Key features')
    expect(html).toContain('>Close<')
  })

  it('credits the author, with the links working', () => {
    expect(html).toContain('About the author')
    expect(html).toContain('Arvind Singh Rawat')
    expect(html).toContain('Bridge &amp; Structural Design Engineer')
    expect(html).toContain('8+ years of experience')
    expect(html).toContain('href="mailto:arvindrawat400@gmail.com"')
    // the profile link, opened safely: a new tab, no window.opener
    expect(html).toContain('href="https://www.linkedin.com/in/arvindrawat400/"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('linkedin.com/in/arvindrawat400')
  })

  it('keeps the copyright line, and lists only features the app has', () => {
    expect(html).toContain('© 2025 Arvind Singh Rawat. All Rights Reserved.')
    expect(html).toContain('ULS, SLS and shear')
    expect(html).toContain('IS 456:2000 · IRC:112 · IRS CBC')
    expect(html).toContain('printable calculation report')
    expect([...html.matchAll(/<li /g)].length).toBeGreaterThanOrEqual(6)
    // the version in the panel is the version in package.json
    const pkg = JSON.parse(read('../../../package.json')) as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
  })
})

describe('modal shell', () => {
  it('is a labelled dialog with its own close button', () => {
    const html = renderToStaticMarkup(
      <Modal title="Sample" onClose={noop}>
        body
      </Modal>,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('body')
  })

  it('closes on Escape and on the backdrop, and locks the page behind it', () => {
    // the shell is where the behaviour lives, so it is pinned at the source: a
    // dialog that cannot be dismissed from the keyboard is a trap
    expect(modalSource).toContain("e.key === 'Escape'")
    expect(modalSource).toContain('if (e.target === e.currentTarget) onClose()')
    expect(modalSource).toContain("document.body.style.overflow = 'hidden'")
    expect(modalSource).toContain('document.body.style.overflow = prevOverflow')
    // and it takes focus on open, and hands it back on close
    expect(modalSource).toContain('panelRef.current?.focus()')
    expect(modalSource).toContain('restoreRef.current?.focus()')
    // above the sticky header, which is z-40
    expect(modalSource).toContain('z-50')
  })

  it('is not in the app until it is opened', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).not.toContain('role="dialog"')
    expect(html).toContain('aria-label="Settings"')
    expect(html).toContain('aria-label="About"')
  })
})

describe('dark theme readiness', () => {
  it('leaves no figure colour hard-coded to the light theme', () => {
    // the sheet behind the figures is a token now: a literal white fallback
    // would paint a white rectangle over the dark sheet
    for (const f of ['../SectionPreview.tsx', '../AdvancedCoverFigure.tsx']) {
      expect(read(f)).not.toContain('--color-card, #fff')
    }
    // a label colour that ignored the theme would vanish on the dark sheet
    expect(read('../SectionPreview.tsx')).toContain("const labelInk = labelColor || 'var(--color-ink)'")
  })

  it('does not scale the figures with the interface size', () => {
    // the figures are drawn in user units, so the root font size cannot move
    // them — a `rem`-sized label inside an SVG would be the bug
    for (const f of ['../Charts.tsx', '../Shear.tsx', '../SectionPreview.tsx']) {
      expect(read(f)).not.toMatch(/fontSize=\{?['"]?[0-9.]+rem/)
    }
  })
})
