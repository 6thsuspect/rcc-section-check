/**
 * About — the header's ⓘ button opens this.
 *
 * Content follows the reference app's About dialog: the brand row (mark, name,
 * tagline, version), what the app is for, the author, the key features, and the
 * copyright line over a Close button. Everything it claims is a feature this
 * app actually has — the check list is the three tabs, the codes, the report.
 *
 * Links open in a new tab and carry `rel="noopener noreferrer"`; the mail link
 * is a plain `mailto:`. Nothing here is read by the engine or the report.
 */
import type { ReactNode } from 'react'
import { AppLogo } from './Logo'
import { Icon, btnPrimaryCls, noteSmCls } from './ui'
import { Modal } from './Modal'

/** Shown in the brand row. Kept in step with `package.json` by a test. */
export const APP_VERSION = '1.0.0'

/** The author card, in one place so the links cannot drift apart. */
const AUTHOR = {
  name: 'Arvind Singh Rawat',
  role: 'Bridge & Structural Design Engineer',
  initials: 'AR',
  email: 'arvindrawat400@gmail.com',
  linkedin: 'https://www.linkedin.com/in/arvindrawat400/',
}

/** What the app does, for this app rather than for the reference one. */
const FEATURES = [
  'Three checks in one workspace — ULS, SLS and shear',
  'Biaxial P–Mx–My interaction with capacity ratios per load case',
  'Serviceability stresses to IS 456 Tables 21 and 22, with xu and lever arm',
  'Shear — concrete resistance, link design and spacing limits, clause by clause',
  'IS 456:2000 · IRC:112 · IRS CBC, selected per check',
  'Section editor with predefined, circular and hollow sections, plus cover audit',
  'Crack width, spacing check and a printable calculation report',
]

function LinkRow({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex items-center gap-2 text-accent-strong underline-offset-2 hover:underline"
    >
      {children}
    </a>
  )
}

export function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="About"
      icon={<Icon name="info" size={13} className="text-ink-2" />}
      width="w-[480px]"
      onClose={onClose}
      footer={
        <button type="button" className={btnPrimaryCls} onClick={onClose}>
          Close
        </button>
      }
    >
      {/* ---------------------------------------------------- brand */}
      <div className="flex items-center gap-3.5">
        <AppLogo className="h-14 w-14" title="RCC Section Check" />
        <div className="min-w-0">
          <h3 className="truncate font-display text-[1.25rem] font-bold leading-tight tracking-[-0.01em] text-ink">
            RCC Section Check
          </h3>
          <p className="leading-snug text-ink-2">Draw · Analyse · Design</p>
          <p className={`${noteSmCls} mt-0.5`}>Version {APP_VERSION}</p>
        </div>
      </div>

      <div className="mt-3.5 rounded-lg border border-line bg-panel/55 p-3">
        <p className="leading-relaxed text-ink-2">
          A reinforced-concrete section check for practising bridge and structural engineers. Draw the
          section and its reinforcement, then run the ultimate limit state, serviceability and shear
          checks — every step of the calculation is shown with its clause, and the whole report prints
          as a PDF.
        </p>
      </div>

      {/* ---------------------------------------------------- author */}
      <div className="mt-4">
        <h3 className="mb-2 font-display text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-ink-3">
          About the author
        </h3>
        <div className="rounded-lg border border-line bg-panel/55 p-3">
          <div className="flex items-start gap-3.5">
            <div
              aria-hidden="true"
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[1.25rem] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
            >
              {AUTHOR.initials}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-display font-bold leading-tight text-ink">{AUTHOR.name}</h4>
              <p className="mb-2 italic leading-snug text-accent-strong">{AUTHOR.role}</p>
              <p className="mb-2.5 leading-relaxed text-ink-2">
                Structural engineer with <strong>8+ years of experience</strong> in RCC, PSC and steel
                bridge design. Works at the meeting point of <strong>structural engineering, design
                codes and software</strong> to build tools that keep their calculations transparent.
              </p>
              <div className={`${noteSmCls} flex flex-col gap-1.5`}>
                <LinkRow href={`mailto:${AUTHOR.email}`}>
                  <Icon name="mail" size={13} />
                  {AUTHOR.email}
                </LinkRow>
                <LinkRow href={AUTHOR.linkedin}>
                  <Icon name="link" size={13} />
                  linkedin.com/in/arvindrawat400
                </LinkRow>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- features */}
      <div className="mt-4">
        <h3 className="mb-2 font-display text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-ink-3">
          Key features
        </h3>
        <ul className="flex flex-col gap-1 text-ink-2">
          {FEATURES.map((f) => (
            <li key={f} className="flex gap-2 leading-snug">
              <Icon name="check" size={13} className="mt-[3px] shrink-0 text-accent" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className={`${noteSmCls} mt-4 border-t border-line pt-3 text-center`}>
        © 2025 Arvind Singh Rawat. All Rights Reserved.
      </p>
    </Modal>
  )
}
