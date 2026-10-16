/**
 * Feedback for the two copy buttons (section coordinates, bar coordinates).
 *
 * The button hands the table to `copy`; the note it returns is what the panel
 * shows beside it — what was copied, or why nothing was, or that this browser
 * would not let the page near the clipboard. The note clears itself after a few
 * seconds so the panel goes quiet again, the same way the app's other transient
 * messages do.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { copyToClipboard, type CopyText } from './clipboard'

export interface CopyNote {
  ok: boolean
  text: string
}

/** Said when neither clipboard route worked — the copy did not happen. */
export const CLIPBOARD_BLOCKED =
  'Could not reach the clipboard — this browser blocked it. Select the cells below and press Ctrl+C.'

/** What a successful copy reports: how much went, and what was left out. */
export function copiedNote(payload: CopyText, noun: string): string {
  const left = payload.skipped
    ? ` ${payload.skipped} unusable ${payload.skipped === 1 ? 'entry' : 'entries'} left out.`
    : ''
  return `Copied ${payload.count} ${noun}${payload.count === 1 ? '' : 's'} to the clipboard.${left}`
}

/** How long a copy note stays on screen, ms. */
const CLEAR_AFTER_MS = 7000

export function useCopyFeedback(noun: string, empty: string) {
  const [note, setNote] = useState<CopyNote | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A note that outlives the panel is nothing to keep
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const report = useCallback((ok: boolean, text: string) => {
    if (timer.current) clearTimeout(timer.current)
    setNote({ ok, text })
    timer.current = setTimeout(() => setNote(null), CLEAR_AFTER_MS)
  }, [])

  const copy = useCallback(
    async (payload: CopyText | null) => {
      if (!payload) {
        report(false, empty)
        return
      }
      const done = await copyToClipboard(payload.text)
      if (!done) {
        report(false, CLIPBOARD_BLOCKED)
        return
      }
      report(true, copiedNote(payload, noun))
    },
    [empty, noun, report],
  )

  return { note, copy }
}
