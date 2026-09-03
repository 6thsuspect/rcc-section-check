import { useEffect, useMemo, useRef, useState } from 'react'
import type { Rebar } from '../engine/types'
import type { PredefinedSection } from '../engine/sections'
import {
  ARRANGEMENT_LABELS,
  defaultCircularRebarConfig,
  defaultLayer,
  generateCircularRebar,
  pitchRadius,
  sanitizeCircularConfig,
  type CircularArrangementKind,
  type CircularLayerDef,
  type CircularRebarConfig,
} from '../engine/circularRebar'
import { Card, NumField } from './ui'

const cellCls =
  'w-full border border-edge rounded px-1.5 py-0.5 text-[12.5px] tnum bg-card focus:outline-none focus:border-accent'
const btnCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-edge-strong rounded px-2 py-1 text-ink-2 hover:border-accent hover:text-accent'
const btnPrimaryCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-accent bg-accent-wash text-accent-strong rounded px-2.5 py-1 hover:bg-accent/20'

const DIAS = [8, 10, 12, 16, 20, 25, 28, 32, 36, 40]

const KINDS: CircularArrangementKind[] = ['uniform', 'alternate', 'bundle', 'triple', 'layered']

export function isCircularSection(predefined: PredefinedSection | null): boolean {
  return predefined?.kind === 'circle' || predefined?.kind === 'hollowCircle'
}

function sectionOuterRadius(predefined: PredefinedSection | null): number | null {
  if (!predefined) return null
  if (predefined.kind === 'circle') return predefined.D / 2
  if (predefined.kind === 'hollowCircle') return predefined.Do / 2
  return null
}

function sectionInnerRadius(predefined: PredefinedSection | null): number {
  if (predefined?.kind === 'hollowCircle') return predefined.Di / 2
  return 0
}

/** Stable fingerprint of a bar list so live-apply can skip no-op updates. */
function barsKey(bars: Rebar[]): string {
  return bars.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.dia}`).join('|')
}

/**
 * Circular-section reinforcement arrangement builder.
 * Generates ordinary {x,y,dia} bars that feed the shared reinforcement table.
 */
export function CircularRebarPanel({
  predefined,
  cover,
  tieDia,
  barDia,
  setBarDia,
  onApply,
}: {
  predefined: PredefinedSection | null
  cover: number
  tieDia: number
  barDia: number
  setBarDia: (v: number) => void
  onApply: (bars: Rebar[], meta?: { barDia: number; nBarsHint?: number }) => void
}) {
  const R = sectionOuterRadius(predefined)
  const Ri = sectionInnerRadius(predefined)
  const [cfg, setCfg] = useState<CircularRebarConfig>(() =>
    defaultCircularRebarConfig('uniform', R ?? 300, cover, tieDia, barDia),
  )
  const [autoApply, setAutoApply] = useState(true)
  const [lastApplied, setLastApplied] = useState(0)
  const lastKeyRef = useRef('')

  // Keep section geometry / cover / tie in sync when the parent changes them.
  useEffect(() => {
    if (R == null) return
    setCfg((prev) => {
      if (
        prev.sectionRadius === R &&
        (prev.innerRadius ?? 0) === Ri &&
        prev.cover === cover &&
        prev.tieDia === tieDia
      ) {
        return prev
      }
      return sanitizeCircularConfig({
        ...prev,
        sectionRadius: R,
        innerRadius: Ri > 0 ? Ri : undefined,
        cover,
        tieDia,
      })
    })
  }, [R, Ri, cover, tieDia])

  // Seed nBars from the predefined shape when the user first opens a circle.
  useEffect(() => {
    if (!predefined) return
    if (predefined.kind === 'circle' || predefined.kind === 'hollowCircle') {
      setCfg((prev) => {
        if (prev.kind !== 'uniform') return prev
        if (prev.nBars === predefined.nBars && prev.barDia === barDia) return prev
        return { ...prev, nBars: predefined.nBars, barDia }
      })
    }
    // Only re-seed when the shape kind changes, not on every nBars sync from apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predefined?.kind])

  const patch = (p: Partial<CircularRebarConfig>) => {
    setCfg((prev) => sanitizeCircularConfig({ ...prev, ...p }))
  }

  const result = useMemo(() => {
    if (R == null) return { bars: [] as Rebar[], warnings: [] as string[], key: '' }
    const generated = generateCircularRebar(
      sanitizeCircularConfig({
        ...cfg,
        sectionRadius: R,
        innerRadius: Ri > 0 ? Ri : undefined,
        cover,
        tieDia,
      }),
    )
    return { ...generated, key: barsKey(generated.bars) }
  }, [cfg, R, Ri, cover, tieDia])

  const applyBars = (bars: Rebar[]) => {
    const primaryDia = cfg.kind === 'layered' ? (cfg.layers[0]?.barDia ?? cfg.barDia) : cfg.barDia
    const key = barsKey(bars)
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key
    onApply(bars, { barDia: primaryDia, nBarsHint: bars.length })
    setBarDia(primaryDia)
    setLastApplied(bars.length)
  }

  // Live-update the bar table while auto-apply is on (keyed so identical layouts skip).
  useEffect(() => {
    if (!autoApply || R == null) return
    applyBars(result.bars)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.key, autoApply, R, Ri])

  if (R == null) return null

  const outerPitch = pitchRadius(R, cover, tieDia, cfg.barDia)

  const setKind = (kind: CircularArrangementKind) => {
    const next = defaultCircularRebarConfig(kind, R, cover, tieDia, cfg.barDia || barDia)
    // Preserve shared fields the user already set.
    next.startAngleDeg = cfg.startAngleDeg
    next.angularSpacingDeg = cfg.angularSpacingDeg
    next.barDia = cfg.barDia
    next.altBarDia = cfg.altBarDia
    if (kind === 'uniform' || kind === 'alternate') {
      next.nBars = cfg.nBars || (predefined && 'nBars' in predefined ? predefined.nBars : 8)
    }
    if (kind === 'bundle') {
      next.nBundles = cfg.nBundles || 6
      next.barsPerBundle = cfg.barsPerBundle || 2
    }
    if (kind === 'triple') {
      next.nGroups = cfg.nGroups || 6
      next.groupSpacing = cfg.groupSpacing || cfg.barDia + Math.max(cfg.barDia, 25)
    }
    if (kind === 'layered') {
      next.layers =
        cfg.layers.length > 0
          ? cfg.layers
          : [
              defaultLayer(cfg.barDia, 8, cfg.startAngleDeg),
              {
                ...defaultLayer(cfg.barDia, 6, cfg.startAngleDeg + 15),
                radius: Math.max(0, outerPitch - (cfg.barDia + Math.max(cfg.barDia, 25))),
              },
            ]
    }
    setCfg(sanitizeCircularConfig(next))
  }

  const updateLayer = (id: string, patchLayer: Partial<CircularLayerDef>) => {
    patch({
      layers: cfg.layers.map((l) => (l.id === id ? { ...l, ...patchLayer } : l)),
    })
  }

  const removeLayer = (id: string) => {
    if (cfg.layers.length <= 1) return
    patch({ layers: cfg.layers.filter((l) => l.id !== id) })
  }

  const addLayer = () => {
    const idx = cfg.layers.length
    const clear = Math.max(cfg.barDia, 25)
    const r = Math.max(0, outerPitch - idx * (cfg.barDia + clear))
    patch({
      layers: [
        ...cfg.layers,
        {
          ...defaultLayer(cfg.barDia, Math.max(6, 8 - idx), cfg.startAngleDeg + idx * 15),
          radius: r,
        },
      ],
    })
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <span>Circular reinforcement</span>
          <span className="font-mono normal-case tracking-normal text-[10px] text-ink-3 font-normal">
            {ARRANGEMENT_LABELS[cfg.kind]} · {result.bars.length} bars
          </span>
        </span>
      }
      action={
        <button
          type="button"
          className={btnPrimaryCls}
          onClick={() => {
            lastKeyRef.current = ''
            applyBars(result.bars)
          }}
          title="Write generated bars into the reinforcement table"
        >
          Apply layout
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Arrangement kind selector */}
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`font-display text-[11px] font-semibold rounded border px-1.5 py-1 ${
                cfg.kind === k
                  ? 'border-accent bg-accent-wash text-accent-strong'
                  : 'border-edge text-ink-2 hover:border-edge-strong'
              }`}
              onClick={() => setKind(k)}
            >
              {ARRANGEMENT_LABELS[k]}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-ink-3 leading-relaxed -mt-1">
          Pitch radius ≈ {outerPitch.toFixed(0)} mm (D/2 − cover − tie − ⌀/2). Generated bars fill the X, Y, Bar Dia
          table and remain individually editable.
        </p>

        {/* Shared + kind-specific inputs */}
        <div className="grid grid-cols-2 gap-2">
          {(cfg.kind === 'uniform' ||
            cfg.kind === 'alternate' ||
            cfg.kind === 'bundle' ||
            cfg.kind === 'triple') && (
            <DiaSelect label="Bar diameter" value={cfg.barDia} onChange={(v) => patch({ barDia: v, altBarDia: cfg.kind === 'alternate' ? cfg.altBarDia : v })} />
          )}

          {cfg.kind === 'uniform' && (
            <NumField label="Number of bars" value={cfg.nBars} min={6} step={1} onChange={(v) => patch({ nBars: Math.round(v) })} />
          )}

          {cfg.kind === 'alternate' && (
            <>
              <NumField
                label="Number of bars"
                value={cfg.nBars}
                min={6}
                step={1}
                onChange={(v) => patch({ nBars: Math.round(v) })}
              />
              <DiaSelect
                label="Alternate bar ⌀"
                value={cfg.altBarDia}
                onChange={(v) => patch({ altBarDia: v })}
              />
            </>
          )}

          {cfg.kind === 'bundle' && (
            <>
              <NumField
                label="Bars per bundle"
                value={cfg.barsPerBundle}
                min={2}
                step={1}
                onChange={(v) => patch({ barsPerBundle: Math.round(v) })}
              />
              <NumField
                label="Number of bundles"
                value={cfg.nBundles}
                min={4}
                step={1}
                onChange={(v) => patch({ nBundles: Math.round(v) })}
              />
            </>
          )}

          {cfg.kind === 'triple' && (
            <>
              <NumField
                label="Triple-bar groups"
                value={cfg.nGroups}
                min={4}
                step={1}
                onChange={(v) => patch({ nGroups: Math.round(v) })}
              />
              <NumField
                label="Spacing within group"
                unit="mm"
                value={cfg.groupSpacing}
                min={0}
                step={5}
                onChange={(v) => patch({ groupSpacing: v })}
              />
            </>
          )}

          {cfg.kind !== 'layered' && (
            <>
              <NumField
                label="Starting angle"
                unit="°"
                value={cfg.startAngleDeg}
                step={5}
                onChange={(v) => patch({ startAngleDeg: v })}
              />
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-ink-3 font-display tracking-wide">
                  Angular spacing (blank = equal)
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    className={cellCls + ' py-1 px-2 text-[13px]'}
                    value={cfg.angularSpacingDeg ?? ''}
                    placeholder="auto"
                    step={5}
                    min={0}
                    onChange={(e) => {
                      const t = e.target.value
                      if (t === '' || t === undefined) patch({ angularSpacingDeg: null })
                      else patch({ angularSpacingDeg: parseFloat(t) || null })
                    }}
                  />
                  <span className="text-[11px] text-ink-3 shrink-0">°</span>
                </span>
              </label>
            </>
          )}
        </div>

        {/* Layered editor */}
        {cfg.kind === 'layered' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-3 font-display tracking-wide uppercase">
                Layers ({cfg.layers.length})
              </span>
              <button type="button" className={btnCls} onClick={addLayer}>
                + Add layer
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {cfg.layers.map((layer, idx) => (
                <div key={layer.id} className="border border-edge rounded p-2 bg-panel/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                      Layer {idx + 1}
                      <span className="ml-1.5 font-mono normal-case tracking-normal text-ink-3 font-normal">
                        {layer.radius != null
                          ? `r = ${layer.radius.toFixed(0)} mm`
                          : `r ≈ auto (${Math.max(0, outerPitch - idx * (layer.barDia + Math.max(layer.barDia, 25))).toFixed(0)} mm)`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-bad text-[12px] disabled:opacity-30"
                      disabled={cfg.layers.length <= 1}
                      title="Remove layer"
                      onClick={() => removeLayer(layer.id)}
                    >
                      × remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10.5px] text-ink-3 font-display tracking-wide">Radius (mm)</span>
                      <input
                        type="number"
                        className={cellCls}
                        value={layer.radius ?? ''}
                        placeholder="auto"
                        step={5}
                        min={0}
                        onChange={(e) => {
                          const t = e.target.value
                          updateLayer(layer.id, {
                            radius: t === '' ? null : parseFloat(t) || null,
                          })
                        }}
                      />
                    </label>
                    <DiaSelect
                      label="Bar ⌀"
                      value={layer.barDia}
                      onChange={(v) => updateLayer(layer.id, { barDia: v })}
                    />
                    <NumField
                      label="Bars"
                      value={layer.nBars}
                      min={0}
                      step={1}
                      onChange={(v) => updateLayer(layer.id, { nBars: Math.round(v) })}
                    />
                    <NumField
                      label="Start angle"
                      unit="°"
                      value={layer.startAngleDeg}
                      step={5}
                      onChange={(v) => updateLayer(layer.id, { startAngleDeg: v })}
                    />
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10.5px] text-ink-3 font-display tracking-wide">
                        Angular spacing
                      </span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          className={cellCls}
                          value={layer.angularSpacingDeg ?? ''}
                          placeholder="auto"
                          step={5}
                          min={0}
                          onChange={(e) => {
                            const t = e.target.value
                            updateLayer(layer.id, {
                              angularSpacingDeg: t === '' ? null : parseFloat(t) || null,
                            })
                          }}
                        />
                        <span className="text-[11px] text-ink-3 shrink-0">°</span>
                      </span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings + apply controls */}
        {result.warnings.length > 0 && (
          <div className="bg-warn2/10 border border-warn2/40 rounded px-2.5 py-1.5 text-[11.5px] text-warn2">
            <b className="font-display text-[10px] uppercase tracking-wider">Layout warnings</b>
            <ul className="mt-0.5 list-disc pl-4">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
            />
            Live-update bar table
          </label>
          <div className="flex items-center gap-2">
            {!autoApply && (
              <button
                type="button"
                className={btnPrimaryCls}
                onClick={() => {
                  lastKeyRef.current = ''
                  applyBars(result.bars)
                }}
              >
                Apply to table
              </button>
            )}
            <span className="text-[11px] text-ink-3 tnum font-mono">
              {result.bars.length} bar{result.bars.length === 1 ? '' : 's'}
              {lastApplied > 0 && autoApply ? ' · synced' : ''}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function DiaSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const opts = DIAS.includes(value) ? DIAS : [...DIAS, value].sort((a, b) => a - b)
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-3 font-display tracking-wide">{label}</span>
      <select className={cellCls + ' py-1 px-2 text-[13px]'} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {opts.map((d) => (
          <option key={d} value={d}>
            ⌀ {d} mm
          </option>
        ))}
      </select>
    </label>
  )
}
