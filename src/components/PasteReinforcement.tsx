/**
 * "Paste Reinforcement" — add or replace customized reinforcement bars
 * using an interactive 3-column table (X Coordinate, Y Coordinate, Bar Dia)
 * that supports direct Excel copy-pasting. Automatically adds rows when multiple
 * rows are pasted from Excel.
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
const cellCls =
  'w-full border border-edge rounded px-2 py-1 text-[12.5px] font-mono tnum bg-card text-ink focus:outline-none focus:border-accent'

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

interface TableRow {
  id: string
  x: string
  y: string
  dia: string
}

const DEFAULT_ROWS: TableRow[] = [
  { id: '1', x: '-250', y: '300', dia: '20' },
  { id: '2', x: '0', y: '300', dia: '20' },
  { id: '3', x: '250', y: '300', dia: '20' },
]

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
        title="Paste or replace customized reinforcement coordinates (x,y,dia) from Excel"
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
  const [rows, setRows] = useState<TableRow[]>(DEFAULT_ROWS)
  const [status, setStatus] = useState<PasteStatus>({ kind: 'idle' })
  const [pasteMode, setPasteMode] = useState<'append' | 'replace'>('append')

  // Convert table rows to formatted x,y,dia text lines
  const rowsToText = (rList: TableRow[]) => {
    return rList
      .filter((r) => r.x.trim() !== '' || r.y.trim() !== '' || r.dia.trim() !== '')
      .map((r) => `${r.x.trim()},${r.y.trim()},${r.dia.trim()}`)
      .join('\n')
  }

  // Esc closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Handle Excel paste into the table
  const handleTablePaste = (e: React.ClipboardEvent) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText) return

    const lines = rawText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) return

    e.preventDefault()

    const newRows: TableRow[] = lines.map((line, idx) => {
      const parts = line.split(/[\t,]+/).map((p) => p.trim())
      return {
        id: `${Date.now()}-${idx}-${Math.random()}`,
        x: parts[0] ?? '',
        y: parts[1] ?? '',
        dia: parts[2] ?? '20',
      }
    })

    setRows(newRows)
    setStatus({ kind: 'idle' })
  }

  const updateCell = (id: string, field: 'x' | 'y' | 'dia', value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
    setStatus({ kind: 'idle' })
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, x: '0', y: '0', dia: '20' },
    ])
    setStatus({ kind: 'idle' })
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    setStatus({ kind: 'idle' })
  }

  const clearRows = () => {
    setRows([])
    setStatus({ kind: 'idle' })
  }

  const validate = () => {
    const text = rowsToText(rows)
    const r = parseRebarPaste(text)
    if (r.errors.length > 0) setStatus({ kind: 'errors', errors: r.errors })
    else if (r.count === 0) setStatus({ kind: 'empty', message: 'No valid rows found — paste Excel rows or enter x, y, Bar Dia values.' })
    else setStatus({ kind: 'ok', count: r.bars.length })
  }

  const handleApply = () => {
    const text = rowsToText(rows)
    const r = parseRebarPaste(text)
    if (r.errors.length > 0) {
      setStatus({ kind: 'errors', errors: r.errors })
      return
    }
    if (r.bars.length === 0) {
      setStatus({ kind: 'empty', message: 'No valid rows to add or replace — paste Excel rows or enter x, y, Bar Dia values.' })
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
        className="w-full max-w-2xl bg-card border border-edge rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
      >
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-edge bg-panel">
          <h2 className="font-display text-[12px] font-semibold tracking-[0.12em] uppercase text-ink-2">
            Paste / Replace Customized Reinforcement
          </h2>
          <button
            className="text-ink-3 hover:text-bad text-[16px] leading-none px-1"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="p-4 flex flex-col gap-3.5 overflow-y-auto">
          {/* Action Mode Toggle: Append vs Replace */}
          <div className="flex items-center justify-between bg-panel border border-edge rounded px-3 py-2 text-[12px]">
            <span className="font-display font-semibold text-[11px] uppercase tracking-wider text-ink-2">
              Action Mode:
            </span>
            <div className="flex gap-4">
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
            Copy cells directly from <b>Excel</b> and paste (`Ctrl+V` or `Cmd+V`) anywhere into the table below. The table will <b>automatically add rows</b> and populate X, Y, and Bar Dia.
          </p>

          {/* 3-Column Interactive Excel Table */}
          <div
            className="border border-edge rounded bg-card overflow-hidden focus:outline-none focus:border-accent"
            onPaste={handleTablePaste}
            tabIndex={0}
            title="Paste Excel cells directly into this table (Ctrl+V / Cmd+V)"
          >
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <thead>
                  <tr className="bg-panel border-b border-edge text-[10.5px] font-display uppercase tracking-wider text-ink-3 sticky top-0 z-10">
                    <th className="text-left px-3 py-1.5 w-10">#</th>
                    <th className="text-left px-2 py-1.5">
                      X Coordinate (<code className="font-mono text-accent">x</code>)
                    </th>
                    <th className="text-left px-2 py-1.5">
                      Y Coordinate (<code className="font-mono text-accent">y</code>)
                    </th>
                    <th className="text-left px-2 py-1.5">
                      Bar Diameter (<code className="font-mono text-accent">Bar Dia</code>)
                    </th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length > 0 ? (
                    rows.map((r, i) => (
                      <tr key={r.id} className="border-t border-edge hover:bg-panel/50">
                        <td className="px-3 py-1 text-ink-3 tnum font-mono">{i + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            className={cellCls}
                            value={r.x}
                            placeholder="-250"
                            onChange={(e) => updateCell(r.id, 'x', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            className={cellCls}
                            value={r.y}
                            placeholder="300"
                            onChange={(e) => updateCell(r.id, 'y', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            className={cellCls}
                            value={r.dia}
                            placeholder="20"
                            onChange={(e) => updateCell(r.id, 'dia', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            className="text-bad hover:bg-bad/10 rounded px-1.5 py-0.5 text-[14px] leading-none"
                            title="Remove row"
                            onClick={() => removeRow(r.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-ink-3 italic text-[12px]">
                        Table is empty. Click <b>+ Add Row</b> or press <b>Ctrl+V</b> anywhere to paste Excel rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-panel border-t border-edge px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button type="button" className={btnCls} onClick={addRow}>
                  + Add Row
                </button>
                {rows.length > 0 && (
                  <button type="button" className="text-[11px] text-bad hover:underline ml-2" onClick={clearRows}>
                    Clear Table
                  </button>
                )}
              </div>
              <span className="text-[11px] text-ink-3 tnum">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'}
              </span>
            </div>
          </div>

          {status.kind === 'errors' && (
            <div className="bg-bad/10 border border-bad/40 rounded px-2.5 py-2 text-[12px] text-bad">
              <b className="font-display text-[10.5px] uppercase tracking-wider">
                {status.errors.length} invalid {status.errors.length === 1 ? 'row' : 'rows'} — fix or remove before submitting
              </b>
              <ul className="mt-1 max-h-24 overflow-y-auto font-mono tnum">
                {status.errors.map((err, i) => (
                  <li key={i}>
                    Row {err.line}: {err.message}
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

          <div className="flex items-center justify-between pt-1">
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
