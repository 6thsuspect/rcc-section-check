import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'

/* ------------------------------------------------------------------ *
 * Shared presentation vocabulary.
 *
 * Every editor/panel composes its controls from the class constants and
 * components below, so spacing, borders, focus rings and motion stay
 * consistent across the app. Presentation only — no behaviour lives here.
 * ------------------------------------------------------------------ */

/** Compact input used inside data tables. */
export const cellCls =
  'w-full min-w-0 rounded-field border border-edge bg-card px-1.5 py-[3px] text-[12.5px] tnum text-ink ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ease-ui hover:border-edge-strong ' +
  'focus:border-accent focus:ring-[3px] focus:ring-accent/12'

/** Standard numeric/text field. */
export const fieldCls =
  'w-full min-w-0 border-0 bg-transparent px-2 py-[5px] text-[13px] tnum text-ink ' +
  'transition-[background-color] duration-150 ease-ui focus:outline-none'

/** Wrapper that carries the border + focus ring for `fieldCls` inputs. */
export const fieldBoxCls =
  'flex items-center gap-1 rounded-field border border-edge bg-card ' +
  'transition-[border-color,box-shadow,background-color] duration-150 ease-ui ' +
  'hover:border-edge-strong focus-within:border-accent focus-within:bg-card focus-within:ring-[3px] focus-within:ring-accent/12'

/** Dropdown — `sel` supplies the chevron (see index.css). */
export const selectCls =
  'sel w-full min-w-0 rounded-field border border-edge bg-card px-2 py-[5px] text-[13px] text-ink ' +
  'transition-[border-color,box-shadow] duration-150 ease-ui hover:border-edge-strong focus:border-accent'

/** Secondary action: outlined, quiet. */
export const btnCls =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-field border border-edge bg-card ' +
  'px-2.5 py-[5px] font-display text-[11px] font-semibold uppercase tracking-[0.06em] leading-none text-ink-2 no-underline ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-ui ' +
  'hover:border-edge-strong hover:bg-panel hover:text-ink active:translate-y-[0.5px] ' +
  'disabled:pointer-events-none disabled:opacity-45'

/** Primary action: one per view, filled. */
export const btnPrimaryCls =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-field border border-accent-strong ' +
  'bg-accent px-3 py-[6px] font-display text-[11px] font-semibold uppercase tracking-[0.06em] leading-none text-white ' +
  'shadow-[0_1px_2px_rgb(23_34_44/0.16)] transition-[background-color,box-shadow,transform] duration-150 ease-ui ' +
  'hover:bg-accent-strong hover:shadow-[0_2px_6px_-1px_rgb(28_92_171/0.45)] active:translate-y-[0.5px] ' +
  'disabled:pointer-events-none disabled:opacity-45'

/** Destructive action: delete, clear, locked state. */
export const btnDangerCls =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-field border border-bad/30 bg-bad/8 ' +
  'px-2.5 py-[5px] font-display text-[11px] font-semibold uppercase tracking-[0.06em] leading-none text-bad ' +
  'transition-[background-color,border-color,color,transform] duration-150 ease-ui ' +
  'hover:border-bad/55 hover:bg-bad/15 active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-45'

/** Remove-row control inside a table cell. */
export const rowDelCls =
  'grid h-[21px] w-[21px] place-items-center rounded text-[13px] leading-none text-ink-3 ' +
  'transition-[background-color,color] duration-150 ease-ui hover:bg-bad/12 hover:text-bad ' +
  'disabled:pointer-events-none disabled:opacity-40'

export const tblCls = 'w-full border-collapse text-[12.5px] tnum'
export const thCls =
  'px-2 py-[6px] text-[10px] font-display font-bold uppercase tracking-[0.07em] text-ink-2 align-bottom'
export const tdCls = 'px-2 py-[5px] align-top'

/** Inline mini action embedded in a hint strip ("make equal", "clear overrides"). */
export const btnMiniCls =
  'inline-flex items-center gap-1 rounded border border-edge bg-card px-1.5 py-px font-display text-[9.5px] ' +
  'font-bold uppercase leading-[1.6] tracking-[0.06em] text-ink-2 transition-colors duration-150 ease-ui ' +
  'hover:border-accent/50 hover:bg-accent-wash hover:text-accent-strong'

/** Keyboard-shortcut chip. */
export const codeChipCls = 'rounded border border-edge bg-panel px-1 py-px font-mono text-[10px] text-ink-2'

/** Grouped micro-controls (font stepper, colour swatches). */
export const chipGroupCls = 'inline-flex items-center gap-1 rounded border border-edge bg-card px-1 py-[3px]'

/** Labelled, non-editable value (calculated readouts). */
export const readoutCls = 'rounded-field border border-line bg-panel/70 px-2 py-1'

/** Checkbox / radio row. */
export const checkCls =
  'inline-flex cursor-pointer select-none items-center gap-1.5 font-display text-[10.5px] font-semibold ' +
  'uppercase tracking-[0.06em] text-ink-2 transition-colors duration-150 hover:text-ink'

/** Muted supporting sentence under a control group. */
export const noteCls = 'text-[11px] leading-relaxed text-ink-2'

/** Tighter variant for hints squeezed under a field or a readout. */
export const noteSmCls = 'text-[10.5px] leading-snug text-ink-3'

export const STANDARD_BAR_DIAMETERS = [8, 10, 12, 16, 20, 25, 28, 32, 36, 40]

/* --------------------------------- icons -------------------------------- */

/** Line icons, one path per subpath — `currentColor` so they inherit state. */
const ICONS = {
  folder: ['M20 20a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  report: ['M15 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l4 4v12a2 2 0 0 1-2 2Z', 'M15 3v4h4', 'M16 13H8', 'M16 17H8'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z'],
  unlock: ['M7 11V7a5 5 0 0 1 9.9-1', 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['m20 6-11 11-5-5'],
  alert: ['m10.3 3.9-8.8 15A2 2 0 0 0 3.2 21.5h17.6a2 2 0 0 0 1.7-2.6l-8.8-15a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 16v-4', 'M12 8h.01'],
  zoomIn: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm20.5 20.5-4-4', 'M11 8v6', 'M8 11h6'],
  zoomOut: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm20.5 20.5-4-4', 'M8 11h6'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M16 21h3a2 2 0 0 0 2-2v-3', 'M3 16v3a2 2 0 0 0 2 2h3'],
  refresh: ['M3 12a9 9 0 0 1 15.3-6.4L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15.3 6.4L3 16', 'M3 21v-5h5'],
  target: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
  ruler: ['m3 8.5 5.5-5.5L21 15.5 15.5 21Z', 'm7 9.5 2.5 2.5', 'm10 6.5 2.5 2.5', 'm13.5 10 2.5 2.5', 'm16.5 7 2.5 2.5'],
  layers: ['m12 2 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
  grid: ['M3 3h18v18H3z', 'M9 3v18', 'M15 3v18', 'M3 9h18', 'M3 15h18'],
  chart: ['M3 3v18h18', 'm7 15 4-5 3 3 5-7'],
  cursor: ['m4 4 7 16 2.2-6.8L20 11Z'],
  shield: ['M12 21s7-3.4 7-9V5.5L12 3 5 5.5v6.5c0 5.6 7 9 7 9Z', 'm9 12 2 2 4-4'],
  bars: ['M6 4v16', 'M18 4v16', 'M6 8h12', 'M6 16h12'],
  link: ['M9 15 15 9', 'M10.5 6.5 12 5a4.2 4.2 0 0 1 6 6l-1.5 1.5', 'M13.5 17.5 12 19a4.2 4.2 0 0 1-6-6l1.5-1.5'],
}

export type IconName = keyof typeof ICONS

/** Line icon in the current colour — keeps buttons and chips visually quiet. */
export function Icon({ name, size = 13, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {ICONS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

/* --------------------------------- card ---------------------------------- */

export function Card({
  title,
  subtitle,
  children,
  action,
}: {
  title: ReactNode
  /** Short context shown next to the title on wide screens. */
  subtitle?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-card border border-edge bg-card shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-t-card border-b border-edge bg-panel/80 px-3 py-[7px]">
        <h2 className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-[11.5px] font-bold uppercase tracking-[0.07em] text-ink">
          <span className="flex items-center gap-1.5">{title}</span>
          {subtitle && <span className={`${noteSmCls} font-body font-normal normal-case tracking-normal`}>{subtitle}</span>}
        </h2>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

/** Bordered sub-group inside a card (void covers, paste modes, layer lists). */
export function SubCard({
  title,
  action,
  children,
  tone = 'plain',
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  tone?: 'plain' | 'accent'
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        tone === 'accent' ? 'border-accent/25 bg-accent-wash/45' : 'border-line bg-panel/55'
      }`}
    >
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
            {title}
          </span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

/** Small labelled value that the app computed — visually distinct from inputs. */
export function Readout({
  label,
  value,
  title,
  className = '',
}: {
  label: ReactNode
  value: ReactNode
  title?: string
  className?: string
}) {
  return (
    <div className={readoutCls} title={title}>
      <div className="font-display text-[9.5px] font-bold uppercase leading-tight tracking-[0.07em] text-ink-3">{label}</div>
      <div className={`tnum text-[12.5px] leading-tight text-ink ${className}`}>{value}</div>
    </div>
  )
}

/* -------------------------------- tooltip -------------------------------- */

export function InfoTooltip({ content }: { content: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center align-middle">
      <button
        type="button"
        className="grid h-[15px] w-[15px] place-items-center rounded-full border border-edge-strong bg-card font-serif text-[10px] font-bold italic leading-none text-ink-3 transition-colors duration-150 ease-ui hover:border-accent hover:bg-accent-wash hover:text-accent-strong"
        aria-label="Information"
      >
        i
      </button>
      <span className="invisible absolute left-1/2 top-full z-50 mt-1.5 w-[19rem] max-w-[86vw] -translate-x-1/2 translate-y-[-3px] rounded-lg border border-edge-strong bg-card p-2.5 text-left font-body text-[11.5px] font-normal normal-case leading-relaxed tracking-normal text-ink-2 opacity-0 shadow-pop transition-[opacity,transform,visibility] duration-150 ease-ui group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <span className="absolute -top-[5px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-edge-strong bg-card" />
        <span className="relative block">{content}</span>
      </span>
    </span>
  )
}

/* --------------------------------- fields -------------------------------- */

export function NumField({
  label,
  value,
  onChange,
  unit,
  step,
  min,
  w,
  disabled,
  hint,
  title,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
  w?: string
  disabled?: boolean
  /** One-line explanation under the field. */
  hint?: ReactNode
  title?: string
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-[3px] ${w ?? ''} ${disabled ? 'opacity-55' : ''}`} title={title}>
      <span className="flex items-center gap-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
        {label}
        {disabled && <span className="font-body text-[9px] font-normal normal-case tracking-normal text-ink-3">locked</span>}
      </span>
      <span className={`${fieldBoxCls} ${disabled ? 'bg-panel' : ''}`}>
        <input
          type="number"
          disabled={disabled}
          className={fieldCls}
          value={Number.isFinite(value) ? value : ''}
          step={step ?? 1}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {unit && (
          <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
      {hint && <span className="text-[9.5px] leading-tight text-ink-3">{hint}</span>}
    </label>
  )
}

function nearestStandardDiameter(value: number): number {
  return STANDARD_BAR_DIAMETERS.reduce((nearest, diameter) =>
    Math.abs(diameter - value) < Math.abs(nearest - value) ? diameter : nearest,
  )
}

/**
 * Bar diameter selector with a small opt-in customizer. Standard IS 1786
 * diameters stay easy to pick, while generated layouts can also use any
 * positive diameter, entered to a maximum of four decimal places.
 */
export function DiameterField({
  label,
  value,
  onChange,
  disabled,
  onCustomizeChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  onCustomizeChange?: (enabled: boolean) => void
}) {
  const [customized, setCustomized] = useState(() => !STANDARD_BAR_DIAMETERS.includes(value))

  // An imported project or another editor may supply a non-standard value.
  // Switch to the custom input rather than rendering a select with no option.
  useEffect(() => {
    if (!STANDARD_BAR_DIAMETERS.includes(value)) setCustomized(true)
  }, [value])

  const toggleCustomization = () => {
    if (disabled) return
    if (customized) {
      setCustomized(false)
      onCustomizeChange?.(false)
      onChange(nearestStandardDiameter(value))
    } else {
      setCustomized(true)
      onCustomizeChange?.(true)
    }
  }

  const setCustomValue = (raw: string) => {
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return
    const rounded = Math.round(parsed * 10000) / 10000
    onChange(Math.max(0.0001, rounded))
  }

  return (
    <label className={`flex min-w-0 flex-col gap-[3px] ${disabled ? 'opacity-55' : ''}`}>
      <span className="flex items-center justify-between gap-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
        <span>{label}</span>
        <button
          type="button"
          aria-pressed={customized}
          disabled={disabled}
          onClick={toggleCustomization}
          className={`rounded border px-1.5 py-[1px] font-display text-[9px] font-bold uppercase tracking-[0.05em] leading-[1.5] transition-colors duration-150 ease-ui disabled:cursor-not-allowed ${
            customized
              ? 'border-accent/45 bg-accent-wash text-accent-strong hover:bg-accent/15'
              : 'border-edge bg-card text-ink-3 hover:border-edge-strong hover:text-ink'
          }`}
          title={customized ? 'Use a standard bar diameter' : 'Enable a custom bar diameter'}
        >
          {customized ? 'Use standard' : 'Customize'}
        </button>
      </span>
      {customized ? (
        <span className={`${fieldBoxCls} border-accent/60`}>
          <input
            type="number"
            className={fieldCls}
            value={Number.isFinite(value) ? value : ''}
            min={0.0001}
            step={0.0001}
            disabled={disabled}
            aria-label={`${label} (custom)`}
            onChange={(e) => setCustomValue(e.target.value)}
          />
          <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
            mm
          </span>
        </span>
      ) : (
        <select
          className={selectCls}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {STANDARD_BAR_DIAMETERS.map((diameter) => (
            <option key={diameter} value={diameter}>
              ⌀ {diameter} mm
            </option>
          ))}
        </select>
      )}
    </label>
  )
}

/* ------------------------------- indicators ------------------------------ */

const CHIP_TONE = {
  pass: 'border-ok/35 bg-ok/10 text-ok',
  fail: 'border-bad/35 bg-bad/10 text-bad',
  warn: 'border-warn2/35 bg-warn2/10 text-warn2',
  info: 'border-edge-strong bg-panel text-ink-2',
} as const

export function Chip({ status }: { status: keyof typeof CHIP_TONE }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] font-display text-[9.5px] font-bold uppercase leading-[1.5] tracking-[0.07em] ${CHIP_TONE[status]}`}
    >
      {status}
    </span>
  )
}

/** Status strip for validation and import feedback. */
export function Banner({
  tone,
  children,
  onDismiss,
  className = '',
}: {
  tone: 'ok' | 'error' | 'warn' | 'info'
  children: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const map = {
    ok: { cls: 'border-ok/30 bg-ok/8 text-ok', icon: 'check' as IconName },
    error: { cls: 'border-bad/30 bg-bad/8 text-bad', icon: 'alert' as IconName },
    warn: { cls: 'border-warn2/30 bg-warn2/8 text-warn2', icon: 'alert' as IconName },
    info: { cls: 'border-edge-strong bg-panel text-ink-2', icon: 'info' as IconName },
  }[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-relaxed ${map.cls} ${className}`}
    >
      <Icon name={map.icon} size={14} className="mt-[1px]" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-70 transition-opacity duration-150 hover:bg-black/5 hover:opacity-100"
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  )
}

/** Placeholder shown in a card when there is nothing to draw yet. */
export function EmptyState({
  title,
  note,
  tone = 'muted',
  icon = 'info',
}: {
  title: ReactNode
  note?: ReactNode
  tone?: 'muted' | 'alert'
  icon?: IconName
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center ${
        tone === 'alert' ? 'border-bad/30 bg-bad/6 text-bad' : 'border-edge-strong/70 bg-panel/50 text-ink-2'
      }`}
    >
      <Icon name={icon} size={17} className={tone === 'alert' ? 'text-bad' : 'text-ink-3'} />
      <p className="max-w-[46ch] text-[12px] leading-snug">{title}</p>
      {note && <p className="max-w-[52ch] text-[10.5px] leading-snug text-ink-3">{note}</p>}
    </div>
  )
}

/* --------------------------------- toggles ------------------------------- */

export function Check({
  checked,
  onChange,
  label,
  title,
  className = '',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  title?: string
  className?: string
}) {
  return (
    <label className={`${checkCls} ${className}`} title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
      />
      <span>{label}</span>
    </label>
  )
}

/** Segmented choice row (codes, shapes, paste mode, arrangements). */
export function SegGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-stretch gap-1 ${className}`}>{children}</div>
}

export function SegButton({
  active,
  onClick,
  children,
  disabled,
  title,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-field border px-2 py-[6px] font-display text-[11px] font-semibold leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-ui disabled:pointer-events-none disabled:opacity-45 ${
        active
          ? 'border-accent bg-accent-wash text-accent-strong shadow-[inset_0_-2px_0_rgb(37_106_191/0.35)]'
          : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/* --------------------------------- figures ------------------------------- */

/**
 * SVG wrapper with zoom in / zoom out / fit-to-view controls and drag-to-pan,
 * implemented purely through the viewBox so all internal figure coordinates
 * stay valid. `onContentMove` reports the pointer position in content
 * (viewBox) coordinates via the screen CTM, so hover overlays keep working at
 * any zoom level.
 */
export function ZoomableSvg({
  W,
  H,
  id,
  ariaLabel,
  children,
  onContentMove,
  onContentLeave,
}: {
  W: number
  H: number
  id?: string
  ariaLabel: string
  children: ReactNode
  onContentMove?: (pt: { x: number; y: number }) => void
  onContentLeave?: () => void
}) {
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const isFit = vb.x === 0 && vb.y === 0 && vb.w === W

  const zoom = (f: number) =>
    setVb((v) => {
      const w = Math.max(W / 16, Math.min(W * 4, v.w / f))
      const h = w * (H / W)
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }
    })
  const fit = () => setVb({ x: 0, y: 0, w: W, h: H })

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    if (drag.current) {
      const scale = vb.w / svg.clientWidth
      const dx = (e.clientX - drag.current.x) * scale
      const dy = (e.clientY - drag.current.y) * scale
      if (Math.abs(dx) + Math.abs(dy) > 0) drag.current.moved = true
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
      return
    }
    if (onContentMove) {
      const m = svg.getScreenCTM()
      if (!m) return
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
      onContentMove({ x: p.x, y: p.y })
    }
  }
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const zBtn =
    'grid h-[24px] w-[24px] place-items-center rounded-[5px] text-ink-2 transition-[background-color,color] duration-150 ease-ui hover:bg-card hover:text-accent'

  return (
    <div className="group/fig relative overflow-hidden rounded-lg border border-line bg-paper">
      <svg
        ref={svgRef}
        id={id}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full touch-none select-none"
        style={{ cursor: drag.current ? 'grabbing' : isFit ? 'default' : 'grab' }}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          drag.current = null
          onContentLeave?.()
        }}
      >
        {children}
      </svg>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-px rounded-md border border-edge bg-panel/85 p-px opacity-70 shadow-card backdrop-blur-sm transition-opacity duration-150 ease-ui group-hover/fig:opacity-100">
        <button className={zBtn} title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1.3)}>
          <Icon name="zoomIn" size={13} />
        </button>
        <button className={zBtn} title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}>
          <Icon name="zoomOut" size={13} />
        </button>
        <span className="h-4 w-px bg-edge" />
        <button
          className={`${zBtn} ${isFit ? 'opacity-40' : ''}`}
          title="Fit to view"
          aria-label="Fit to view"
          onClick={fit}
        >
          <Icon name="fit" size={13} />
        </button>
      </div>
    </div>
  )
}

/** "Nice" tick positions covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [lo]
  const span = hi - lo
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag
  const first = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let v = first; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}
