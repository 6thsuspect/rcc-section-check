import { useEffect, useMemo, useRef, useState } from 'react'
import type { Rebar } from '../engine/types'
import { isAutomaticBar } from '../engine/reinforcement'
import type { PredefinedSection } from '../engine/sections'
import {
  ARRANGEMENT_LABELS,
  defaultCircularRebarConfig,
  defaultLayer,
  generateCircularRebar,
  pitchRadius,
  sanitizeCircularConfig,
  resolveBundleBarDias,
  type CircularArrangementKind,
  type CircularBarAnalysis,
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
  Chip,
  DiameterField,
  fieldBoxCls,
  fieldCls,
  Icon,
  NumField,
  Readout,
  rowDelCls,
  SubCard,
  noteCls,
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
  onAnalysis,
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
  /** Notify parent of overlap / spacing analysis so the section figure can highlight. */
  onAnalysis?: (analysis: CircularBarAnalysis | null) => void
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
    if (R == null)
      return {
        bars: [] as Rebar[],
        warnings: [] as string[],
        analysis: null as CircularBarAnalysis | null,
        key: '',
      }
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

  // Push spacing / overlap analysis to the parent for section-figure highlighting.
  useEffect(() => {
    onAnalysis?.(result.analysis)
  }, [result.analysis, onAnalysis])

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
      next.bundleBarDias =
        cfg.bundleBarDias?.length === next.barsPerBundle
          ? cfg.bundleBarDias
          : Array.from({ length: next.barsPerBundle }, (_, i) => cfg.bundleBarDias?.[i] ?? cfg.barDia)
      next.bundleInnerGap = cfg.bundleInnerGap || cfg.barDia + Math.max(cfg.barDia, 25)
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
                onChange={(v) => {
                  const per = Math.round(v)
                  const dias = resolveBundleBarDias({ ...cfg, barsPerBundle: per })
                  // Grow / shrink the diameter list to match the new count.
                  const nextDias = Array.from({ length: Math.max(1, per) }, (_, i) => dias[i] ?? cfg.barDia)
                  patch({ barsPerBundle: per, bundleBarDias: nextDias })
                }}
              />
              <NumField
                label="Number of bundles"
                value={cfg.nBundles}
                min={4}
                step={1}
                onChange={(v) => patch({ nBundles: Math.round(v) })}
              />
              <NumField
                label="Bundle spacing (clear)"
                unit="mm"
                value={cfg.bundleSpacing ?? 0}
                min={0}
                step={5}
                hint="Clear gap between adjacent bundles (not within-bundle). 0 = equal angular only."
                onChange={(v) => patch({ bundleSpacing: v > 0 ? v : null })}
              />
              <NumField
                label="Spacing within bundle"
                unit="mm"
                value={cfg.bundleInnerGap}
                min={0}
                step={5}
                hint="Centre-to-centre of bars inside one bundle"
                onChange={(v) => patch({ bundleInnerGap: v })}
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
            </>
          )}
        </div>

        {/* Per-bar diameters inside a bundle — independent of count */}
        {cfg.kind === 'bundle' && (
          <SubCard
            title={
              <span className="flex items-center gap-1.5">
                Bundle bar diameters
                <span className="font-body text-[10px] font-normal normal-case tracking-normal text-ink-3">
                  one ⌀ per bar in the bundle · {cfg.barsPerBundle} slot{cfg.barsPerBundle === 1 ? '' : 's'}
                </span>
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-3">
              {resolveBundleBarDias(cfg).map((d, i) => (
                <DiameterField
                  key={`bundle-dia-${i}`}
                  label={`Bar ${i + 1} ⌀`}
                  value={d}
                  onChange={(v) => {
                    const next = resolveBundleBarDias(cfg).slice()
                    next[i] = v
                    // Keep cfg.barDia = max so pitch / shared panel stay conservative.
                    const maxD = Math.max(...next)
                    patch({ bundleBarDias: next, barDia: maxD })
                  }}
                  onCustomizeChange={onBarDiaCustomizeChange}
                />
              ))}
            </div>
            <p className={`${noteSmCls} mt-1.5`}>
              Diameters may differ inside a bundle. Bundle spacing (clear) is measured between neighbouring
              bundles; within-bundle bars are not checked against the normal minimum bar-spacing rule.
            </p>
          </SubCard>
        )}

        {/* Bundle / spacing analysis summary */}
        {result.analysis && (cfg.kind === 'bundle' || !result.analysis.overlapOk || !result.analysis.spacingOk) && (
          <div
            className={`rounded-lg border p-2.5 ${
              !result.analysis.overlapOk
                ? 'border-bad/35 bg-bad/8'
                : !result.analysis.spacingOk
                  ? 'border-warn2/35 bg-warn2/8'
                  : 'border-line bg-panel/55'
            }`}
            data-testid="circular-rebar-analysis"
          >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
                Spacing & overlap
              </span>
              <span className="flex items-center gap-1.5">
                <Chip status={result.analysis.overlapOk ? 'pass' : 'fail'} />
                <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.05em] text-ink-3">
                  {result.analysis.overlapOk ? 'no overlap' : 'overlap'}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {result.analysis.bundle && (
                <>
                  <Readout label="Bundles" value={`${result.analysis.bundle.nBundles}`} />
                  <Readout
                    label="Bars / bundle"
                    value={`${result.analysis.bundle.barsPerBundle}`}
                  />
                  <Readout
                    label="Bundle bar ⌀"
                    value={result.analysis.bundle.barDias.map((d) => d.toFixed(d % 1 ? 1 : 0)).join(' / ')}
                    title="Diameter of each bar slot inside a bundle"
                  />
                  <Readout
                    label="Bundle spacing (req.)"
                    value={
                      result.analysis.bundle.bundleSpacing != null
                        ? `${result.analysis.bundle.bundleSpacing.toFixed(0)} mm`
                        : 'equal angular'
                    }
                    title="Requested clear spacing between adjacent bundles"
                  />
                  <Readout
                    label="Bundle clear (achieved)"
                    value={
                      result.analysis.bundle.achievedBundleClear != null
                        ? `${result.analysis.bundle.achievedBundleClear.toFixed(1)} mm`
                        : '—'
                    }
                    title="Minimum clear distance between bars of neighbouring bundles"
                    className={
                      result.analysis.spacingOk ? 'font-semibold text-ok' : 'font-semibold text-bad'
                    }
                  />
                  <Readout
                    label="Within-bundle c/c"
                    value={`${result.analysis.bundle.innerGap.toFixed(0)} mm`}
                    title="Centre-to-centre of bars inside one bundle (exempt from min-spacing check)"
                  />
                </>
              )}
              <Readout
                label="Min clear (inter-group)"
                value={
                  result.analysis.minClearBetweenGroups != null
                    ? `${result.analysis.minClearBetweenGroups.toFixed(1)} mm`
                    : '—'
                }
                title="Minimum clear between bars of different bundles/groups — used for the min-spacing check"
              />
              <Readout
                label="Min spacing limit"
                value={`≥ ${result.analysis.clearLimit.toFixed(0)} mm`}
                title="max(smallest bar ⌀, 25 mm); applied only between different bundles/groups"
              />
              <Readout
                label="Overlap status"
                value={
                  result.analysis.overlapOk
                    ? 'None'
                    : `${result.analysis.overlappingBarIndices.length} bar(s)`
                }
                className={
                  result.analysis.overlapOk ? 'font-semibold text-ok' : 'font-semibold text-bad'
                }
                title="Solid sections must not intersect — overlapping bars are highlighted red on the section figure"
              />
            </div>
            {!result.analysis.overlapOk && (
              <p className={`${noteCls} mt-1.5 text-bad`}>
                Overlapping reinforcement is highlighted in <b>red</b> on the section figure. Adjust bundle
                spacing, diameters, or count to clear the intersections.
                {result.analysis.overlaps.length > 0 && (
                  <>
                    {' '}
                    Worst pair: bars{' '}
                    {result.analysis.overlaps
                      .slice(0, 3)
                      .map((o) => `${o.i + 1}–${o.j + 1}`)
                      .join(', ')}
                    {result.analysis.overlaps.length > 3 ? '…' : ''}.
                  </>
                )}
              </p>
            )}
            <p className={`${noteSmCls} mt-1`}>
              Minimum clear-spacing is checked between bars of <b>different</b> bundles only; bars inside the
              same bundle are exempt from that rule but still fail if they physically overlap.
            </p>
          </div>
        )}

        {/* Layered editor */}
        <div className="grid grid-cols-2 gap-1.5">
          <Readout
            label="Pitch radius"
            value={`${outerPitch.toFixed(0)} mm`}
            title="R − cover − ⌀tie − ⌀bar/2, from the per-face cover in the cover panel"
          />
          <Readout label="Bars generated" value={`${result.bars.length}`} />
        </div>
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
