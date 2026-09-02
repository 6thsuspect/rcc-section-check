/**
 * "Paste Reinforcement" — add customized reinforcement bars by pasting
 * `x,y,dia` lines (bar-centre coordinates in the section's existing 0,0
 * coordinate system, dia in mm).
 *
 * Self-contained: renders its own trigger button and modal dialog, owns the
 * open state, and reports validated bars through `onAdd`. The parent appends
 * them through its existing rebar `update` path, so pasted bars behave
 * exactly like bars typed into the rebar table.
 */
import { useEffect, useState } from 'react'
import type { Rebar } from '../engine/types'
import { parseRebarPaste, type RebarPasteError } from '../engine/rebarPaste'

/* Same visual language as the panel buttons in Editors.tsx (kept local so
   the existing module stays untouched). */
const btnCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-edge-strong rounded px-2 py-1 text-ink-2 hover:border-accent hover:text-accent inline-flex items-center gap-1'
const primaryCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-accent bg-accent text-white rounded px-2.5 py-1 hover:bg-accent-strong inline-flex items-center gap-1'

function PasteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11v6" />
      <path d="m9 14 3 3 3-3" />
    </svg>
  )
}

type PasteStatus =
  | { kind: 'idle' }
  | { kind: 'ok'; count: number }
  | { kind: 'empty'; message: string }
  | { kind: 'errors'; errors: RebarPasteError[] }

export function PasteReinforcement({ onAdd }: { onAdd: (newBars: Rebar[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={btnCls}
        onClick={() => setOpen(true)}
        title="Paste customized reinforcement coordinates (x,y,dia)"
      >
        <PasteIcon />
        Paste
      </button>
      {open && (
        <PasteReinforcementModal
          onClose={() => setOpen(false)}
          onAdd={(newBars) => {
            onAdd(newBars)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function PasteReinforcementModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (newBars: Rebar[]) => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<PasteStatus>({ kind: 'idle' })

  const lineCount = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').length

  // Esc closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const validate = () => {
    const r = parseRebarPaste(text)
    if (r.errors.length > 0) setStatus({ kind: 'errors', errors: r.errors })
    else if (r.count === 0) setStatus({ kind: 'empty', message: 'No bars found — paste at least one line (x,y,dia).' })
    else setStatus({ kind: 'ok', count: r.bars.length })
  }

  const add = () => {
    const r = parseRebarPaste(text)
    if (r.errors.length > 0) {
      setStatus({ kind: 'errors', errors: r.errors })
      return
    }
    if (r.bars.length === 0) {
      setStatus({ kind: 'empty', message: 'No bars to add — paste at least one line (x,y,dia).' })
      return
    }
    onAdd(r.bars)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paste customized reinforcement"
        className="w-full max-w-lg bg-card border border-edge rounded-lg overflow-hidden shadow-2xl"
      >
        <header className="flex items-center justify-between px-3.5 py-2 border-b border-edge bg-panel">
          <h2 className="font-display text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-2">
            Paste Customized Reinforcement
          </h2>
          <button
            className="text-ink-3 hover:text-bad text-[15px] leading-none px-1"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="p-3.5 flex flex-col gap-2.5">
          <p className="text-[12px] text-ink-3 leading-relaxed">
            One bar per line. Format: <code className="font-mono text-ink-2 bg-panel border border-edge rounded px-1 py-px">x,y,dia</code>
            &nbsp;(x, y = bar centre in the section coordinate system, mm; dia = bar diameter, mm; comma-separated).
            Empty lines are ignored. Negative and zero coordinates are allowed.
          </p>

          <textarea
            className="w-full h-44 border border-edge rounded p-2 font-mono text-[12.5px] tnum bg-card text-ink resize-y focus:outline-none focus:border-accent"
            placeholder={'-250,300,20\n0,300,20\n250,300,20\n-250,100,16'}
            value={text}
            autoFocus
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value)
              setStatus({ kind: 'idle' })
            }}
          />

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3 tnum">
              {lineCount} non-empty {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </div>

          {status.kind === 'errors' && (
            <div className="bg-bad/10 border border-bad/40 rounded px-2.5 py-2 text-[12px] text-bad">
              <b className="font-display text-[10.5px] uppercase tracking-wider">
                {status.errors.length} invalid {status.errors.length === 1 ? 'line' : 'lines'} — fix or remove before adding
              </b>
              <ul className="mt-1 max-h-28 overflow-y-auto font-mono tnum">
                {status.errors.map((err, i) => (
                  <li key={i}>
                    Line {err.line}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {status.kind === 'ok' && (
            <div className="bg-ok/10 border border-ok/40 rounded px-2.5 py-2 text-[12px] text-ok">
              <b className="font-display text-[10.5px] uppercase tracking-wider">Valid</b>
              <span className="ml-1.5">
                {status.count} {status.count === 1 ? 'bar' : 'bars'} ready — click “Add Bars” to append them to the
                reinforcement table.
              </span>
            </div>
          )}
          {status.kind === 'empty' && (
            <div className="bg-panel border border-edge-strong rounded px-2.5 py-2 text-[12px] text-ink-2">
              {status.message}
            </div>
          )}

          <div className="flex items-center justify-between pt-0.5">
            <button className={btnCls} onClick={validate}>
              Validate
            </button>
            <span className="flex items-center gap-1.5">
              <button className={btnCls} onClick={onClose}>
                Cancel
              </button>
              <button className={primaryCls} onClick={add} title="Validate and append the pasted bars to the reinforcement table">
                Add Bars
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
