/**
 * The app's one modal shell — the Settings and About panels are built on it, so
 * the backdrop, the title bar, the scrolling body, the footer and the keyboard
 * behaviour are written once.
 *
 * Behaviour, in the order it matters:
 *  - the backdrop covers the whole window and sits above the sticky header
 *    (`z-50` against the header's `z-40`);
 *  - Esc and a click on the backdrop close it, a click inside the panel does not;
 *  - focus moves into the panel on open and back to whatever had it on close,
 *    and the page behind does not scroll while the panel is open.
 *
 * It is purely presentational: who is open is the caller's state, so a closed
 * panel is not in the tree at all.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './ui'

export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  width = 'w-[400px]',
}: {
  title: ReactNode
  /** Optional line icon shown before the title, matching the header buttons. */
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Sticky block under the scroll area — the panel's action button. */
  footer?: ReactNode
  /** Panel width above the phone breakpoint; it is capped to the viewport. */
  width?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[85vh] flex-col overflow-hidden rounded-card border border-edge bg-card shadow-pop outline-none ${width} max-w-full`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel/80 px-3.5 py-2.5">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-1.5 font-display text-[0.8125rem] font-bold uppercase tracking-[0.07em] text-ink"
          >
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="grid h-6 w-6 shrink-0 place-items-center rounded border border-transparent text-ink-2 transition-colors duration-150 hover:border-edge hover:bg-card hover:text-ink"
          >
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-edge bg-panel/60 px-3.5 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
