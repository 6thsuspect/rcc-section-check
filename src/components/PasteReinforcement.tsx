/**
 * "Paste Reinforcement" — add or replace customized reinforcement bars
 * by pasting `x,y,dia` lines (bar-centre coordinates in the section's existing 0,0
 * coordinate system, dia in mm).
 */
import { useEffect, useState } from 'react'
import type { Rebar } from '../engine/types'
import { parseRebarPaste, type RebarPasteError } from '../engine/rebarPaste'

/* Same visual language as the panel buttons in Editors.tsx */
const btnCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-edge-strong rounded px-2 py-1 text-ink-2 hover:border-accent hover:text-accent inline-flex items-center gap-1'
const primaryCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-accent bg-accent text-white rounded px-2.5 py-1 hover:bg-accent-strong inline-flex items-center gap-1'
const dangerCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-bad/50 bg-bad/10 text-bad rounded px-2.5 py-1 hover:bg-bad hover:text-white inline-flex items-center gap-1 transition-colors'

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

export function PasteReinforcement({
  onAdd,
  onReplace,
}: {
  onAdd: (newBars: Rebar[]) => void
  onReplace?: (newBars: Rebar[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={btnCls}
        onClick={() => setOpen(true)}
        title="Paste or replace customized reinforcement coordinates (x,y,dia)"
      >
        <PasteIcon />
        Customize Paste
      </button>
      {open && (
        <PasteReinforcementModal
          onClose={() => setOpen(false)}
          onAdd={(newBars) => {
            onAdd(newBars)
            setOpen(false)
          }}
          onReplace={(newBars) => {
            if (onReplace) onReplace(newBars)
            else onAdd(newBars)
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
  onReplace,
}: {
  onClose: () => void
  onAdd: (newBars: Rebar[]) => void
  onReplace: (newBars: Rebar[]) => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<PasteStatus>({ kind: 'idle' })
  const [pasteMode, setPasteMode] = useState<'append' | 'replace'>('append')

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

  const handleApply = () => {
    const r = parseRebarPaste(text)
    if (r.errors.length > 0) {
      setStatus({ kind: 'errors', errors: r.errors })
      return
    }
    if (r.bars.length === 0) {
      setStatus({ kind: 'empty', message: 'No bars to add or replace — paste at least one line (x,y,dia).' })
      return
    }

    if (pasteMode === 'replace') {
      onReplace(r.bars)
    } else {
      onAdd(r.bars)
    }
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
        className="w-full max-w-lg bg-card border border-edge rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
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

        <div className="p-3.5 flex flex-col gap-3 overflow-y-auto">
          {/* Action Mode Toggle: Append vs Replace */}
          <div className="flex items-center justify-between bg-panel border border-edge rounded p-2 text-[12px]">
            <span className="font-display font-semibold text-[11px] uppercase tracking-wider text-ink-2">
              Action Mode:
            </span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="pasteMode"
                  value="append"
                  checked={pasteMode === 'append'}
                  onChange={() => setPasteMode('append')}
                  className="accent-accent"
                />
                <span className={pasteMode === 'append' ? 'font-semibold text-accent' : 'text-ink-2'}>
                  Append to Existing Bars
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="pasteMode"
                  value="replace"
                  checked={pasteMode === 'replace'}
                  onChange={() => setPasteMode('replace')}
                  className="accent-accent"
                />
                <span className={pasteMode === 'replace' ? 'font-semibold text-bad' : 'text-ink-2'}>
                  Replace All Existing Bars
                </span>
              </label>
            </div>
          </div>

          <p className="text-[12px] text-ink-3 leading-relaxed">
            One bar per line. Format: <code className="font-mono text-ink-2 bg-panel border border-edge rounded px-1 py-px">x,y,dia</code>
            &nbsp;(x, y = bar centre in section coordinate system, mm; dia = bar diameter, mm; comma-separated).
            Empty lines are ignored. Negative and zero coordinates are allowed.
          </p>

          <textarea
            className="w-full h-40 border border-edge rounded p-2 font-mono text-[12.5px] tnum bg-card text-ink resize-y focus:outline-none focus:border-accent"
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
            {text.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-bad hover:underline"
                onClick={() => {
                  setText('')
                  setStatus({ kind: 'idle' })
                }}
              >
                Clear Buffer
              </button>
            )}
          </div>

          {status.kind === 'errors' && (
            <div className="bg-bad/10 border border-bad/40 rounded px-2.5 py-2 text-[12px] text-bad">
              <b className="font-display text-[10.5px] uppercase tracking-wider">
                {status.errors.length} invalid {status.errors.length === 1 ? 'line' : 'lines'} — fix or remove before submitting
              </b>
              <ul className="mt-1 max-h-24 overflow-y-auto font-mono tnum">
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
                {status.count} {status.count === 1 ? 'bar' : 'bars'} ready — click “{pasteMode === 'replace' ? 'Replace All Bars' : 'Add Bars'}” to update the section.
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
              <button
                className={pasteMode === 'replace' ? dangerCls : primaryCls}
                onClick={handleApply}
                title={pasteMode === 'replace' ? 'Replace all existing reinforcement bars with pasted bars' : 'Append pasted bars to existing reinforcement table'}
              >
                {pasteMode === 'replace' ? 'Replace All Bars' : 'Add Bars'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
