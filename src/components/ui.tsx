import { useRef, useState, type ReactNode, type PointerEvent } from 'react'

export function Card({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-card border border-edge rounded-lg overflow-hidden">
      <header className="flex items-center justify-between px-3.5 py-2 border-b border-edge bg-panel">
        <h2 className="font-display text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-2 flex items-center gap-1.5">{title}</h2>
        {action}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

export function InfoTooltip({ content }: { content: ReactNode }) {
  return (
    <div className="relative group inline-flex items-center">
      <button
        type="button"
        className="w-4 h-4 rounded-full border border-edge-strong bg-card text-ink-3 hover:text-accent hover:border-accent font-serif text-[11px] font-bold italic flex items-center justify-center cursor-help transition-colors leading-none"
        aria-label="Information"
      >
        i
      </button>
      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover:block z-50 w-72 p-2.5 bg-card border border-edge-strong rounded-md shadow-2xl text-[11.5px] text-ink-2 font-sans font-normal normal-case leading-relaxed pointer-events-none">
        {content}
      </div>
    </div>
  )
}

export function NumField({
  label,
  value,
  onChange,
  unit,
  step,
  min,
  w,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
  w?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${w ?? ''} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      <span className="text-[11px] text-ink-3 font-display tracking-wide">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          disabled={disabled}
          className="w-full border border-edge rounded px-2 py-1 text-[13px] tnum bg-card focus:outline-none focus:border-accent disabled:bg-panel disabled:cursor-not-allowed"
          value={Number.isFinite(value) ? value : ''}
          step={step ?? 1}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {unit && <span className="text-[11px] text-ink-3 shrink-0">{unit}</span>}
      </span>
    </label>
  )
}

export function Chip({ status }: { status: 'pass' | 'fail' | 'warn' | 'info' }) {
  const cls = {
    pass: 'bg-[--color-accent-wash] text-ok border-ok/40',
    fail: 'bg-bad/10 text-bad border-bad/40',
    warn: 'bg-warn2/10 text-warn2 border-warn2/40',
    info: 'bg-panel text-ink-3 border-edge-strong',
  }[status]
  const label = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO' }[status]
  return (
    <span className={`inline-block border rounded px-1.5 py-px font-display text-[10px] font-semibold tracking-wider ${cls}`}>
      {label}
    </span>
  )
}

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
    'w-7 h-7 grid place-items-center rounded border border-edge-strong bg-card text-ink-2 text-[15px] leading-none hover:border-accent hover:text-accent select-none'

  return (
    <div className="relative">
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
      <div className="absolute top-1 right-1 flex flex-col gap-1">
        <button className={zBtn} title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1.3)}>+</button>
        <button className={zBtn} title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}>−</button>
        <button
          className={`${zBtn} ${isFit ? 'opacity-40' : ''}`}
          title="Fit to view"
          aria-label="Fit to view"
          onClick={fit}
        >
          ⛶
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
