import { useEffect, useMemo, useRef, useState } from 'react'
import type { Rebar } from '../engine/types'
import { isAutomaticBar } from '../engine/reinforcement'
import { spacingReport } from '../engine/barSpacing'
import type { PredefinedSection } from '../engine/sections'
import {
  ARRANGEMENT_LABELS,
  defaultCircularRebarConfig,
  defaultLayer,
  generateCircularRebar,
  bundleDiameters,
  bundleInnerSpacingUsed,
  bundleSpacingUsed,
  pitchRadius,
  sanitizeCircularConfig,
  type CircularArrangementKind,
  type CircularLayerDef,
  type CircularRebarConfig,
} from '../engine/circularRebar'
import {
  Banner,
  btnCls,
  btnPrimaryCls,
  cellCls,
  Card,
  Check,
  DiameterField,
  fieldBoxCls,
  fieldCls,
  Icon,
  NumField,
  Readout,
  rowDelCls,
  SubCard,
  noteSmCls,
} from './ui'

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
  bars = [],
  cover,
  tieDia,
  barDia,
  setBarDia,
  onBarDiaCustomizeChange,
  onApply,
}: {
  predefined: PredefinedSection | null
  /** Existing rows are inspected so an intentionally manual layout is not replaced on mount. */
  bars?: Rebar[]
  cover: number
  tieDia: number
  barDia: number
  setBarDia: (v: number) => void
  onBarDiaCustomizeChange?: (enabled: boolean) => void
  onApply: (bars: Rebar[], meta?: { barDia: number; nBarsHint?: number }) => void
}) {
  const R = sectionOuterRadius(predefined)
  const Ri = sectionInnerRadius(predefined)
  const [cfg, setCfg] = useState<CircularRebarConfig>(() =>
    defaultCircularRebarConfig('uniform', R ?? 300, cover, tieDia, barDia),
  )
  const [autoApply, setAutoApply] = useState(() => bars.length === 0 || bars.some(isAutomaticBar))
  const [lastApplied, setLastApplied] = useState(0)
  const lastKeyRef = useRef('')

  // A manual table edit is an explicit opt-out from live regeneration. The
  // user can still press Apply layout or turn the live checkbox back on.
  useEffect(() => {
    if (bars.length > 0 && bars.every((bar) => !isAutomaticBar(bar))) setAutoApply(false)
  }, [bars])

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

  // A diameter edited in the shared section panel is also a driver for the
  // circular layout. Keep the arrangement configuration in step so its live
  // generator recomputes the pitch radius rather than only changing the table
  // diameter after the fact.
  useEffect(() => {
    setCfg((prev) => {
      if (prev.barDia === barDia) return prev
      return {
        ...prev,
        barDia,
        altBarDia: prev.altBarDia === prev.barDia ? barDia : prev.altBarDia,
        layers: prev.layers.map((layer, idx) => (idx === 0 && layer.barDia === prev.barDia ? { ...layer, barDia } : layer)),
      }
    })
  }, [barDia])

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

  const applyBars = (generatedBars: Rebar[], preserveManual = true) => {
    const primaryDia = cfg.kind === 'layered' ? (cfg.layers[0]?.barDia ?? cfg.barDia) : cfg.barDia
    const hasManual = bars.some((bar) => !isAutomaticBar(bar))
    let nextBars = generatedBars
    if (preserveManual && hasManual) {
      // Keep intentional coordinate rows in place while the still-automatic
      // rows receive the newly generated face/cover positions. When the count
      // changes, retain manual rows after the generated automatic arrangement.
      nextBars =
        bars.length === generatedBars.length
          ? generatedBars.map((bar, i) => (isAutomaticBar(bars[i]) ? bar : bars[i]))
          : [...generatedBars, ...bars.filter((bar) => !isAutomaticBar(bar))]
    }
    const key = barsKey(generatedBars)
    if (key === lastKeyRef.current && nextBars.length === bars.length) return
    lastKeyRef.current = key
    onApply(nextBars, { barDia: primaryDia, nBarsHint: nextBars.length })
    setBarDia(primaryDia)
    setLastApplied(nextBars.length)
  }

  // Live-update the bar table while auto-apply is on (keyed so identical layouts skip).
  useEffect(() => {
    if (!autoApply || R == null) return
    applyBars(result.bars)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.key, autoApply, R, Ri])

  if (R == null) return null

  const outerPitch = pitchRadius(R, cover, tieDia, cfg.barDia)
  const liveCfg = sanitizeCircularConfig({ ...cfg, sectionRadius: R, innerRadius: Ri > 0 ? Ri : undefined, cover, tieDia })
  const bundleDias = bundleDiameters(liveCfg)
  const bundleEq = Math.sqrt(bundleDias.reduce((a, d) => a + d * d, 0))
  const bundleCheck = spacingReport(result.bars)

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
      next.bundleSpacing = cfg.bundleSpacing ?? null
      next.bundleInnerSpacing = cfg.bundleInnerSpacing ?? null
      next.bundleMixedDia = cfg.bundleMixedDia ?? false
      next.bundleBarDias = cfg.bundleBarDias?.length ? cfg.bundleBarDias : next.bundleBarDias
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
          <Icon name="target" size={13} className="text-ink-3" />
          <span>Circular reinforcement</span>
        </span>
      }
      subtitle={`${ARRANGEMENT_LABELS[cfg.kind]} · ${result.bars.length} bars`}
      action={
        <button
          type="button"
          className={btnPrimaryCls}
          onClick={() => {
            lastKeyRef.current = ''
            applyBars(result.bars, false)
          }}
          title="Write generated bars into the reinforcement table"
        >
          <Icon name="check" size={12} />
          <span>Apply layout</span>
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
              aria-pressed={cfg.kind === k}
              className={`rounded-field border px-2 py-[5px] font-display text-[11px] font-semibold leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-ui ${
                cfg.kind === k
                  ? 'border-accent bg-accent-wash text-accent-strong shadow-[inset_0_-2px_0_rgb(37_106_191/0.35)]'
                  : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel hover:text-ink'
              }`}
              onClick={() => setKind(k)}
            >
              {ARRANGEMENT_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Shared + kind-specific inputs */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
          {(cfg.kind === 'uniform' ||
            cfg.kind === 'alternate' ||
            cfg.kind === 'bundle' ||
            cfg.kind === 'triple') && (
            <DiameterField
              label="Bar diameter"
              value={cfg.barDia}
              onChange={(v) => patch({ barDia: v, altBarDia: cfg.kind === 'alternate' ? cfg.altBarDia : v })}
              onCustomizeChange={onBarDiaCustomizeChange}
            />
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
              <DiameterField
                label="Alternate bar ⌀"
                value={cfg.altBarDia}
                onChange={(v) => patch({ altBarDia: v })}
                onCustomizeChange={onBarDiaCustomizeChange}
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
              <OptionalMmField
                label="Bundle spacing (c/c)"
                value={cfg.bundleSpacing ?? null}
                placeholder={`equal · ${bundleSpacingUsed({ ...cfg, bundleSpacing: null }).toFixed(0)}`}
                title="Centre-to-centre distance between adjacent bundles on the pitch circle. Blank = bundles equally spaced around the ring."
                onChange={(v) => patch({ bundleSpacing: v, angularSpacingDeg: null })}
              />
              <OptionalMmField
                label="Bar spacing in bundle (c/c)"
                value={cfg.bundleInnerSpacing ?? null}
                placeholder={`auto · ${bundleInnerSpacingUsed({ ...cfg, bundleInnerSpacing: null }).toFixed(0)}`}
                title="Centre-to-centre distance between bars inside one bundle — independent of the bundle spacing. Enter the bar diameter for bars in contact."
                onChange={(v) => patch({ bundleInnerSpacing: v })}
              />
              <div className="col-span-2">
                <Check
                  checked={!!cfg.bundleMixedDia}
                  onChange={(on) =>
                    patch({
                      bundleMixedDia: on,
                      bundleBarDias: on
                        ? Array.from({ length: Math.max(cfg.barsPerBundle, cfg.bundleBarDias?.length ?? 0) }, (_, k) => cfg.bundleBarDias?.[k] ?? cfg.barDia)
                        : cfg.bundleBarDias,
                    })
                  }
                  label="Different ⌀ per bar in bundle"
                  title="Give each bar position of the bundle its own diameter. The list is kept when the bars-per-bundle count changes."
                />
              </div>
              {cfg.bundleMixedDia &&
                bundleDias.map((d, k) => (
                  <DiameterField
                    key={`bdia-${k}`}
                    label={`Bundle bar ${k + 1} ⌀`}
                    value={d}
                    onChange={(v) => {
                      const next = Array.from({ length: Math.max(cfg.bundleBarDias?.length ?? 0, k + 1) }, (_, j) => cfg.bundleBarDias?.[j] ?? cfg.barDia)
                      next[k] = v
                      patch({ bundleBarDias: next })
                    }}
                    onCustomizeChange={onBarDiaCustomizeChange}
                  />
                ))}
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
              {cfg.kind !== 'bundle' && (
              <label className="flex min-w-0 flex-col gap-[3px]">
                <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
                  Angular spacing (blank = equal)
                </span>
                <span className={fieldBoxCls}>
                  <input
                    type="number"
                    className={fieldCls}
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
                  <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
                    °
                  </span>
                </span>
              </label>
              )}
            </>
          )}
        </div>

        {/* Layered editor */}
        <div className="grid grid-cols-2 gap-1.5">
          <Readout
            label="Pitch radius"
            value={`${outerPitch.toFixed(0)} mm`}
            title="R − cover − ⌀tie − ⌀bar/2, from the per-face cover in the cover panel"
          />
          <Readout label="Bars generated" value={`${result.bars.length}`} />
        </div>
        {cfg.kind === 'bundle' && (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="bundle-summary">
            <Readout
              label="Bundle ⌀ (equiv.)"
              value={`${bundleEq.toFixed(1)} mm`}
              title={`√Σφ² of ⌀ ${bundleDias.join(' + ')} — a bundle is treated as one bar of equal area`}
            />
            <Readout label="Bars per bundle" value={`${bundleDias.length} · ⌀ ${bundleDias.join('+')}`} />
            <Readout
              label="Bundle spacing c/c"
              value={`${bundleSpacingUsed(liveCfg).toFixed(0)} mm`}
              title={cfg.bundleSpacing ? 'Entered bundle spacing' : 'Equal spacing around the pitch circle'}
            />
            <Readout label="Spacing in bundle c/c" value={`${bundleInnerSpacingUsed(liveCfg).toFixed(0)} mm`} />
            <Readout
              label="Min clear (outside bundle)"
              value={
                bundleCheck.minClear === null
                  ? '—'
                  : `${bundleCheck.minClear.toFixed(0)} / ≥ ${bundleCheck.clearLimit.toFixed(0)} mm ${bundleCheck.minClearOk ? '✓' : '✗'}`
              }
              title="Clear gap between adjacent bars of different bundles; bars inside one bundle are excluded"
            />
            <Readout
              label="Overlap"
              value={bundleCheck.overlaps.length === 0 ? 'none ✓' : `${bundleCheck.overlaps.length} pair(s) ✗`}
              title="Intersection check of every bar, including bars inside a bundle"
            />
          </div>
        )}
        <p className={`${noteSmCls} -mt-0.5`}>
          Pitch radius = R − cover − ⌀tie − ⌀bar/2, using the governing face cover from the cover panel. Generated
          bars fill the reinforcement table and stay individually editable.
        </p>

        {cfg.kind === 'layered' && (
          <SubCard
            title={`Layers (${cfg.layers.length})`}
            action={
              <button type="button" className={btnCls} onClick={addLayer}>
                <Icon name="plus" size={12} />
                <span>Add layer</span>
              </button>
            }
          >
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {cfg.layers.map((layer, idx) => (
                <div
                  key={layer.id}
                  className="rounded-lg border border-line bg-card p-2 transition-shadow duration-150 ease-ui hover:shadow-card"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
                      <span className="grid h-[15px] w-[15px] place-items-center rounded bg-panel text-[9px] text-ink-3">
                        {idx + 1}
                      </span>
                      Layer {idx + 1}
                      <span className="font-mono text-[10px] font-normal normal-case tracking-normal text-ink-3">
                        {layer.radius != null
                          ? `r = ${layer.radius.toFixed(0)} mm`
                          : `r ≈ auto (${Math.max(0, outerPitch - idx * (layer.barDia + Math.max(layer.barDia, 25))).toFixed(0)} mm)`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={rowDelCls}
                      disabled={cfg.layers.length <= 1}
                      title="Remove layer"
                      onClick={() => removeLayer(layer.id)}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-3">
                    <label className="flex min-w-0 flex-col gap-[3px]">
                      <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
                        Radius (mm)
                      </span>
                      <input
                        type="number"
                        className={`${cellCls} px-2 py-[5px] text-[13px]`}
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
                    <DiameterField
                      label="Bar ⌀"
                      value={layer.barDia}
                      onChange={(v) => updateLayer(layer.id, { barDia: v })}
                      onCustomizeChange={onBarDiaCustomizeChange}
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
                    <label className="flex min-w-0 flex-col gap-[3px]">
                      <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
                        Angular spacing
                      </span>
                      <span className={fieldBoxCls}>
                        <input
                          type="number"
                          className={fieldCls}
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
                        <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
                          °
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </SubCard>
        )}

        {/* Warnings + apply controls */}
        {result.warnings.length > 0 && (
          <Banner tone="warn">
            <b className="font-display text-[10px] uppercase tracking-[0.07em]">Layout warnings</b>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <Check
            checked={autoApply}
            onChange={setAutoApply}
            label="Live-update bar table"
            title="Keep the reinforcement table in sync with these settings"
          />
          <div className="flex items-center gap-2">
            {!autoApply && (
              <button
                type="button"
                className={btnPrimaryCls}
                onClick={() => {
                  lastKeyRef.current = ''
                  applyBars(result.bars, false)
                }}
              >
                <Icon name="check" size={12} />
                <span>Apply to table</span>
              </button>
            )}
            <span className="font-mono text-[11px] text-ink-3 tnum">
              {result.bars.length} bar{result.bars.length === 1 ? '' : 's'}
              {lastApplied > 0 && autoApply ? ' · synced' : ''}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Optional millimetre input: blank = automatic (null). */
function OptionalMmField({
  label,
  value,
  placeholder,
  title,
  onChange,
}: {
  label: string
  value: number | null
  placeholder: string
  title?: string
  onChange: (v: number | null) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-[3px]" title={title}>
      <span className="font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">{label}</span>
      <span className={fieldBoxCls}>
        <input
          type="number"
          className={fieldCls}
          value={value ?? ''}
          placeholder={placeholder}
          step={5}
          min={0}
          onChange={(e) => {
            const t = e.target.value
            const v = parseFloat(t)
            onChange(t === '' || !Number.isFinite(v) || v <= 0 ? null : v)
          }}
        />
        <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
          mm
        </span>
      </span>
    </label>
  )
}
