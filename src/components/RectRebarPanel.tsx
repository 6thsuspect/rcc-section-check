import { useMemo } from 'react'
import type { RebarFace, SectionGeometry } from '../engine/types'
import { FACE_HINTS, FACE_LABELS, type CoverSpec } from '../engine/cover'
import {
  autoUnitSpacingForLayer,
  defaultRectFaceUnit,
  defaultRectLayer,
  expandLayerToUnits,
  generateRectAdvancedRebar,
  layerBundleDiameters,
  RECT_ARRANGEMENT_LABELS,
  RECT_FACE_INDEX,
  RECT_FACES,
  unitDiameters,
  type RectAdvancedRebarConfig,
  type RectBundleOrientation,
  type RectFaceConfig,
  type RectFaceLayer,
  type RectFaceUnit,
  type RectLayerKind,
} from '../engine/rectRebar'
import type { ActiveFace } from './CoverPanel'
import {
  Banner,
  btnCls,
  btnDangerCls,
  btnMiniCls,
  Card,
  Check,
  DiameterField,
  fieldBoxCls,
  fieldCls,
  fieldLabelCls,
  Icon,
  noteSmCls,
  NumField,
  Readout,
  rowDelCls,
  SegButton,
  SegGroup,
  SubCard,
  useWheelStepSize,
  wheelBase,
  wheelHint,
  wheelRef,
} from './ui'

const LAYER_KINDS: RectLayerKind[] = ['uniform', 'alternate', 'bundle', 'customGroups']

const OPPOSITE_RECT_FACE: Record<RebarFace, RebarFace> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

const ORIENTATION_LABELS: Record<RectBundleOrientation, string> = {
  cluster: 'Cluster',
  along: 'Along face',
  inward: 'Stacked inward',
}

/** Optional millimetre input: blank = automatic (`null`), wheel starts from `auto`. */
function OptionalMmField({
  label,
  value,
  auto,
  placeholder,
  title,
  allowZero = false,
  onChange,
}: {
  label: string
  value: number | null
  auto: number
  placeholder: string
  title?: string
  allowZero?: boolean
  onChange: (v: number | null) => void
}) {
  const step = useWheelStepSize()
  return (
    <label className="flex min-w-0 flex-col gap-[3px]" title={title ? `${title} ${wheelHint(step, 'mm')}` : title}>
      <span className={fieldLabelCls}>
        {label}
      </span>
      <span className={fieldBoxCls}>
        <input
          ref={wheelRef<HTMLInputElement>(() => ({
            value: wheelBase(value, auto),
            min: 0,
            onChange: (v) => onChange(allowZero ? (v >= 0 ? v : null) : v > 0 ? v : null),
          }))}
          type="number"
          className={fieldCls}
          value={value ?? ''}
          placeholder={placeholder}
          step={5}
          min={0}
          onChange={(e) => {
            const t = e.target.value
            if (t === '' || t === undefined) {
              onChange(null)
              return
            }
            const v = parseFloat(t)
            if (!Number.isFinite(v)) {
              onChange(null)
              return
            }
            onChange(allowZero ? (v >= 0 ? v : null) : v > 0 ? v : null)
          }}
        />
        <span className="shrink-0 pr-2 text-[0.65625rem] leading-none text-ink-3" aria-hidden="true">
          mm
        </span>
      </span>
    </label>
  )
}

export function RectRebarPanel({
  config,
  geometry,
  cover,
  tieDia,
  onChange,
  onDisable,
  onBarDiaCustomizeChange,
  onSelectFace,
}: {
  config: RectAdvancedRebarConfig
  geometry: SectionGeometry
  cover: CoverSpec
  tieDia: number
  onChange: (next: RectAdvancedRebarConfig) => void
  onDisable: () => void
  onBarDiaCustomizeChange?: (enabled: boolean) => void
  onSelectFace?: (face: ActiveFace | null) => void
}) {
  const wheelStep = useWheelStepSize()
  const activeFace = config.activeFace
  const faceCfg = config.faces[activeFace]

  const result = useMemo(
    () => generateRectAdvancedRebar(config, geometry, cover, tieDia),
    [config, geometry, cover, tieDia],
  )

  const totalArea = useMemo(
    () =>
      RECT_FACES.reduce(
        (sum, f) => sum + result.summaries[f].reduce((s, l) => s + l.area, 0),
        0,
      ),
    [result],
  )

  const selectFace = (face: RebarFace) => {
    onChange({ ...config, activeFace: face })
    onSelectFace?.({ surface: 'outer', faceIndex: RECT_FACE_INDEX[face] })
  }

  const updateFace = (face: RebarFace, patch: Partial<RectFaceConfig>) => {
    onChange({
      ...config,
      faces: {
        ...config.faces,
        [face]: { ...config.faces[face], ...patch },
      },
    })
  }

  const updateLayer = (face: RebarFace, layerId: string, patch: Partial<RectFaceLayer>) => {
    const cur = config.faces[face]
    updateFace(face, {
      layers: cur.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
    })
  }

  const addLayerOnFace = (face: RebarFace) => {
    const cur = config.faces[face]
    const refLayer = cur.layers[cur.layers.length - 1]
    const nDefault = refLayer ? Math.max(2, refLayer.kind === 'bundle' ? refLayer.nBundles : refLayer.nBars) : 2
    const diaDefault = refLayer ? refLayer.barDia : 20
    const nextLayer = defaultRectLayer({
      nBars: nDefault,
      barDia: diaDefault,
      horizontalAlign: 'stackFirst',
    })
    updateFace(face, {
      enabled: true,
      layers: [...cur.layers, nextLayer],
    })
  }

  const removeLayerOnFace = (face: RebarFace, layerId: string) => {
    const cur = config.faces[face]
    if (cur.layers.length <= 1) return
    updateFace(face, {
      layers: cur.layers.filter((l) => l.id !== layerId),
    })
  }

  const copyToOppositeFace = () => {
    const opp = OPPOSITE_RECT_FACE[activeFace]
    const clonedLayers = faceCfg.layers.map((l) => ({
      ...l,
      id: `${opp}-${l.id}-${Math.random().toString(36).slice(2, 5)}`,
      patternDias: [...l.patternDias],
      bundleBarDias: [...l.bundleBarDias],
      units: l.units.map((u) => ({
        ...u,
        id: `${opp}-${u.id}-${Math.random().toString(36).slice(2, 5)}`,
        dias: [...u.dias],
      })),
    }))
    updateFace(opp, {
      enabled: faceCfg.enabled,
      spanMode: faceCfg.spanMode,
      spacerDiaOverride: faceCfg.spacerDiaOverride,
      layers: clonedLayers,
    })
  }

  const faceSummaries = result.summaries[activeFace]
  const faceBarsCount = faceSummaries.reduce((s, l) => s + l.barCount, 0)
  const faceSteelArea = faceSummaries.reduce((s, l) => s + l.area, 0)
  const errorIssues = result.issues.filter((i) => i.severity === 'error')
  const warnIssues = result.issues.filter((i) => i.severity === 'warn')

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="layers" size={13} className="text-ink-3" />
          <span>Advanced reinforcement</span>
        </span>
      }
      subtitle={`${result.bars.length} bar${result.bars.length === 1 ? '' : 's'} · As ${totalArea.toFixed(0)} mm²`}
      action={
        <button
          type="button"
          className={btnCls}
          onClick={onDisable}
          title="Return to standard perimeter rectangular reinforcement"
        >
          <Icon name="refresh" size={12} />
          <span>Standard</span>
        </button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="rect-advanced-rebar-panel">
        {/* Global Spacer Bar Diameter + Section Totals */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 items-end">
          <DiameterField
            label="Spacer bar ⌀"
            value={config.spacerDia > 0 ? config.spacerDia : 25}
            onChange={(v) => onChange({ ...config, spacerDia: v })}
            onCustomizeChange={onBarDiaCustomizeChange}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Readout
              label="Total bars"
              value={`${result.bars.length}`}
              title="All longitudinal bars generated across Top, Bottom, Left and Right faces"
            />
            <Readout
              label="Spacer bars"
              value={`${result.spacers.length}`}
              title="Transverse pin bars placed between multi-layer reinforcement stacks"
            />
          </div>
        </div>

        {/* Four-Face Independent Selector Tabs: Top, Bottom, Left, Right */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-display text-[0.625rem] font-bold uppercase tracking-[0.07em] text-ink-2">
              Select face to configure
            </span>
            <span className={noteSmCls}>{FACE_HINTS[activeFace]}</span>
          </div>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Rectangular section faces">
            {RECT_FACES.map((face) => {
              const fCfg = config.faces[face]
              const sums = result.summaries[face]
              const count = sums.reduce((s, l) => s + l.barCount, 0)
              const nLayers = fCfg.enabled ? fCfg.layers.length : 0
              const isSelected = activeFace === face
              return (
                <button
                  key={face}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`rect-face-tab-${face}`}
                  onClick={() => selectFace(face)}
                  className={`flex flex-col items-center justify-center rounded-field border px-1.5 py-1.5 text-center transition-[background-color,border-color,color,box-shadow] duration-150 ease-ui ${
                    isSelected
                      ? 'border-accent bg-accent-wash text-accent-strong shadow-tabmark'
                      : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel hover:text-ink'
                  }`}
                >
                  <span className="font-display text-[0.6875rem] font-bold uppercase leading-none tracking-[0.05em]">
                    {FACE_LABELS[face]}
                  </span>
                  <span className="mt-1 font-mono text-[0.625rem] leading-none text-ink-3 tnum">
                    {fCfg.enabled ? `${count} bar${count === 1 ? '' : 's'}${nLayers > 1 ? ` · ${nLayers}L` : ''}` : 'off'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Active Face Header & Controls */}
        <SubCard
          tone="accent"
          title={
            <span className="flex items-center gap-2">
              <Check
                checked={faceCfg.enabled}
                onChange={(enabled) => updateFace(activeFace, { enabled })}
                label={`${FACE_LABELS[activeFace]} face`}
                title={`Enable or disable longitudinal reinforcement along the ${FACE_LABELS[activeFace].toLowerCase()} concrete face`}
              />
            </span>
          }
          action={
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className={btnMiniCls}
                onClick={copyToOppositeFace}
                title={`Copy ${FACE_LABELS[activeFace]} face arrangement to ${FACE_LABELS[OPPOSITE_RECT_FACE[activeFace]]} face`}
              >
                <Icon name="copy" size={10} />
                <span>Copy → {FACE_LABELS[OPPOSITE_RECT_FACE[activeFace]]}</span>
              </button>
              <button
                type="button"
                className={btnMiniCls}
                onClick={() => addLayerOnFace(activeFace)}
                title={`Add an inner reinforcement layer on the ${FACE_LABELS[activeFace].toLowerCase()} face`}
              >
                <Icon name="plus" size={10} />
                <span>Add layer</span>
              </button>
            </div>
          }
        >
          {!faceCfg.enabled ? (
            <p className={noteSmCls}>
              No reinforcement bars placed on the <b>{FACE_LABELS[activeFace]}</b> face. Tick the checkbox above or click{' '}
              <b>Add layer</b> to add bars on this face.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* Span mode + Face summary */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-[0.59375rem] font-bold uppercase tracking-[0.06em] text-ink-3">
                    Corner span:
                  </span>
                  <SegGroup>
                    <SegButton
                      active={faceCfg.spanMode === 'full'}
                      onClick={() => updateFace(activeFace, { spanMode: 'full' })}
                      title="Include the two corner bar positions at the ends of this face"
                    >
                      Include corners
                    </SegButton>
                    <SegButton
                      active={faceCfg.spanMode === 'between'}
                      onClick={() => updateFace(activeFace, { spanMode: 'between' })}
                      title="Distribute bars strictly between the perpendicular face corner bars (prevents duplicate corner bars)"
                    >
                      Between corners
                    </SegButton>
                  </SegGroup>
                </div>
                <span className="font-mono text-[0.65625rem] text-ink-2 tnum">
                  {faceBarsCount} bar{faceBarsCount === 1 ? '' : 's'} · As {faceSteelArea.toFixed(0)} mm²
                </span>
              </div>

              {/* Layer stack on active face */}
              <div className="flex flex-col gap-2.5">
                {faceCfg.layers.map((layer, layerIdx) => {
                  const summary = faceSummaries.find((s) => s.layerIndex === layerIdx) ?? null
                  const autoSpacing = autoUnitSpacingForLayer(config, activeFace, layerIdx, geometry, cover, tieDia)
                  const inheritedSpacer = faceCfg.spacerDiaOverride ?? config.spacerDia
                  const effectiveSpacer = layer.spacerDiaOverride ?? inheritedSpacer

                  return (
                    <LayerCard
                      key={layer.id}
                      face={activeFace}
                      layer={layer}
                      layerIdx={layerIdx}
                      totalLayers={faceCfg.layers.length}
                      summary={summary}
                      autoSpacing={autoSpacing}
                      inheritedSpacer={inheritedSpacer}
                      effectiveSpacer={effectiveSpacer}
                      onPatch={(p) => updateLayer(activeFace, layer.id, p)}
                      onRemove={() => removeLayerOnFace(activeFace, layer.id)}
                      onBarDiaCustomizeChange={onBarDiaCustomizeChange}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </SubCard>

        {/* Validation Diagnostics — never silently mutates user inputs */}
        {errorIssues.length > 0 && (
          <Banner tone="error">
            <b className="font-display text-[0.625rem] uppercase tracking-[0.07em]">
              Reinforcement placement errors ({errorIssues.length})
            </b>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {errorIssues.map((it, idx) => (
                <li key={idx}>{it.message}</li>
              ))}
            </ul>
          </Banner>
        )}

        {warnIssues.length > 0 && (
          <Banner tone="warn">
            <b className="font-display text-[0.625rem] uppercase tracking-[0.07em]">
              Detailing warnings ({warnIssues.length})
            </b>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnIssues.map((it, idx) => (
                <li key={idx}>{it.message}</li>
              ))}
            </ul>
          </Banner>
        )}

        <p className={noteSmCls}>
          Coordinates, individual bar areas, section centroid, ULS interaction surface, SLS stresses, crack width and
          shear effective depth update automatically. Wheel over any numeric input steps by {wheelStep} (configured in
          Settings).
        </p>
      </div>
    </Card>
  )
}

function LayerCard({
  face,
  layer,
  layerIdx,
  totalLayers,
  summary,
  autoSpacing,
  inheritedSpacer,
  effectiveSpacer,
  onPatch,
  onRemove,
  onBarDiaCustomizeChange,
}: {
  face: RebarFace
  layer: RectFaceLayer
  layerIdx: number
  totalLayers: number
  summary: ReturnType<typeof generateRectAdvancedRebar>['summaries'][RebarFace][number] | null
  autoSpacing: number
  inheritedSpacer: number
  effectiveSpacer: number
  onPatch: (patch: Partial<RectFaceLayer>) => void
  onRemove: () => void
  onBarDiaCustomizeChange?: (enabled: boolean) => void
}) {
  const bundleDias = layerBundleDiameters(layer)
  const bundleEqDia = Math.sqrt(bundleDias.reduce((s, d) => s + d * d, 0))

  const switchKind = (nextKind: RectLayerKind) => {
    if (nextKind === layer.kind) return
    if (nextKind === 'customGroups') {
      onPatch({
        kind: 'customGroups',
        units: layer.units.length > 0 ? layer.units : expandLayerToUnits(layer),
      })
      return
    }
    if (nextKind === 'bundle') {
      const per = Math.max(2, layer.barsPerBundle || 2)
      onPatch({
        kind: 'bundle',
        barsPerBundle: per,
        nBundles: Math.max(1, layer.nBundles || 2),
        bundleBarDias:
          layer.bundleBarDias.length >= per
            ? layer.bundleBarDias
            : Array.from({ length: per }, (_, i) => layer.bundleBarDias[i] ?? layer.barDia),
      })
      return
    }
    onPatch({ kind: nextKind })
  }

  const updatePatternSlot = (slotIdx: number, dia: number) => {
    const next = [...layer.patternDias]
    next[slotIdx] = dia
    onPatch({ patternDias: next })
  }

  const addPatternSlot = () => {
    const last = layer.patternDias[layer.patternDias.length - 1] ?? layer.barDia
    onPatch({ patternDias: [...layer.patternDias, last] })
  }

  const removePatternSlot = (slotIdx: number) => {
    if (layer.patternDias.length <= 2) return
    onPatch({ patternDias: layer.patternDias.filter((_, i) => i !== slotIdx) })
  }

  const updateUnit = (unitId: string, patchUnit: Partial<RectFaceUnit>) => {
    onPatch({
      units: layer.units.map((u) => (u.id === unitId ? { ...u, ...patchUnit } : u)),
    })
  }

  const addUnit = (kind: 'single' | 'bundle', barsPerBundle = 2) => {
    onPatch({
      units: [...layer.units, defaultRectFaceUnit(kind, layer.barDia, barsPerBundle)],
    })
  }

  const removeUnit = (unitId: string) => {
    onPatch({
      units: layer.units.filter((u) => u.id !== unitId),
    })
  }

  const moveUnit = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= layer.units.length) return
    const next = [...layer.units]
    const [picked] = next.splice(idx, 1)
    next.splice(target, 0, picked)
    onPatch({ units: next })
  }

  return (
    <div
      data-testid={`rect-layer-${face}-${layerIdx + 1}`}
      className="rounded-lg border border-line bg-card p-2.5 shadow-2xs"
    >
      {/* Layer header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="grid h-[16px] px-1.5 place-items-center rounded bg-panel font-display text-[0.59375rem] font-bold uppercase tracking-[0.06em] text-ink-2">
            L{layerIdx + 1}
          </span>
          <span className="font-display text-[0.65625rem] font-bold uppercase tracking-[0.06em] text-ink">
            Layer {layerIdx + 1} {layerIdx === 0 ? '(outer)' : `(inner #${layerIdx})`}
          </span>
          {summary && (
            <span className="font-mono text-[0.625rem] text-ink-3 tnum">
              · {summary.barCount} bar{summary.barCount === 1 ? '' : 's'} · d<sub>c</sub> = {summary.centroidDepth.toFixed(1)} mm
            </span>
          )}
        </div>
        {totalLayers > 1 && (
          <button
            type="button"
            className={rowDelCls}
            onClick={onRemove}
            title={`Remove Layer ${layerIdx + 1}`}
            aria-label={`Remove Layer ${layerIdx + 1}`}
          >
            <Icon name="close" size={11} />
          </button>
        )}
      </div>

      {/* Arrangement selector for this layer */}
      <div className="mb-2.5 flex flex-wrap gap-1">
        {LAYER_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={layer.kind === k}
            onClick={() => switchKind(k)}
            className={`rounded-field border px-2 py-[4px] font-display text-[0.65625rem] font-semibold leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-ui ${
              layer.kind === k
                ? 'border-accent bg-accent-wash text-accent-strong shadow-tabmark'
                : 'border-edge bg-card text-ink-2 hover:border-edge-strong hover:bg-panel hover:text-ink'
            }`}
          >
            {RECT_ARRANGEMENT_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Inner-layer Spacer Bar & Layer-to-Layer Arrangement controls (Layers 2+) */}
      {layerIdx > 0 && (
        <div className="mb-2.5 rounded-field border border-line bg-panel/45 p-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <span className="font-display text-[0.59375rem] font-bold uppercase tracking-[0.06em] text-ink-2">
              Spacer & layer {layerIdx}→{layerIdx + 1} arrangement
            </span>
            <SegGroup>
              <SegButton
                active={layer.horizontalAlign === 'stackFirst'}
                onClick={() => onPatch({ horizontalAlign: 'stackFirst' })}
                title="Align bars directly behind outer Layer 1 bar positions (standard vertical line alignment)"
              >
                Align w/ L1
              </SegButton>
              <SegButton
                active={layer.horizontalAlign === 'independent'}
                onClick={() => onPatch({ horizontalAlign: 'independent' })}
                title="Distribute bars evenly across this layer's span independently of Layer 1"
              >
                Even span
              </SegButton>
            </SegGroup>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <OptionalMmField
              label="Layer spacer ⌀"
              value={layer.spacerDiaOverride}
              auto={inheritedSpacer}
              allowZero
              placeholder={`global · ${inheritedSpacer}`}
              title="Spacer bar diameter separating the previous layer from this layer (blank inherits global spacer ⌀)."
              onChange={(v) => onPatch({ spacerDiaOverride: v })}
            />
            <OptionalMmField
              label="Layer clear gap"
              value={layer.clearGapOverride}
              auto={effectiveSpacer}
              allowZero
              placeholder={`spacer · ${effectiveSpacer}`}
              title="Clear perpendicular distance between the previous layer and this layer (blank = spacer ⌀)."
              onChange={(v) => onPatch({ clearGapOverride: v })}
            />
          </div>
        </div>
      )}

      {/* --- MODE 1: UNIFORM SINGLE BARS --- */}
      {layer.kind === 'uniform' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-3">
            <NumField
              label="Number of bars"
              value={layer.nBars}
              min={1}
              step={1}
              onChange={(v) => onPatch({ nBars: Math.max(0, Math.round(v)) })}
            />
            <DiameterField
              label="Bar diameter"
              value={layer.barDia}
              onChange={(v) => onPatch({ barDia: v })}
              onCustomizeChange={onBarDiaCustomizeChange}
            />
            <OptionalMmField
              label="Bar spacing (c/c)"
              value={layer.spacing}
              auto={autoSpacing}
              placeholder={autoSpacing > 0 ? `equal · ${autoSpacing.toFixed(0)}` : 'equal'}
              title="Centre-to-centre bar spacing along this layer. Blank distributes bars equally across the available span."
              onChange={(v) => onPatch({ spacing: v })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
            <span className={noteSmCls}>
              {summary?.unitPitch != null
                ? `Pitch ${summary.unitPitch.toFixed(1)} mm c/c · clear ${summary.minClearAlong?.toFixed(1) ?? '—'} mm`
                : 'Single bar centred on face'}
            </span>
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => onPatch({ kind: 'customGroups', units: expandLayerToUnits(layer) })}
              title="Convert these bars into individual editable items so you can mix bundles and custom bar diameters"
            >
              <Icon name="bars" size={10} />
              <span>Edit individual bars / bundles</span>
            </button>
          </div>
        </div>
      )}

      {/* --- MODE 2: ALTERNATE BARS WITH REPEATING DIAMETER SEQUENCE --- */}
      {layer.kind === 'alternate' && (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            <NumField
              label="Number of bars"
              value={layer.nBars}
              min={2}
              step={1}
              onChange={(v) => onPatch({ nBars: Math.max(0, Math.round(v)) })}
            />
            <OptionalMmField
              label="Bar spacing (c/c)"
              value={layer.spacing}
              auto={autoSpacing}
              placeholder={autoSpacing > 0 ? `equal · ${autoSpacing.toFixed(0)}` : 'equal'}
              title="Centre-to-centre spacing between adjacent bars along this face. Blank spaces centres equally."
              onChange={(v) => onPatch({ spacing: v })}
            />
          </div>

          <div className="rounded-field border border-line bg-panel/40 p-2">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-display text-[0.59375rem] font-bold uppercase tracking-[0.06em] text-ink-2">
                Repeating ⌀ pattern ({layer.patternDias.length} slots)
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={btnMiniCls}
                  onClick={() => onPatch({ patternDias: [16, 20] })}
                  title="Quick 2-bar alternating sequence Ø16–Ø20"
                >
                  ⌀16–⌀20
                </button>
                <button
                  type="button"
                  className={btnMiniCls}
                  onClick={() => onPatch({ patternDias: [16, 20, 25] })}
                  title="Quick 3-bar repeating sequence Ø16–Ø20–Ø25"
                >
                  ⌀16–⌀20–⌀25
                </button>
                <button
                  type="button"
                  className={btnMiniCls}
                  onClick={addPatternSlot}
                  title="Add another bar diameter to the repeating sequence"
                >
                  <Icon name="plus" size={10} />
                  <span>Slot</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {layer.patternDias.map((d, sIdx) => (
                <div key={sIdx} className="relative flex items-end gap-1">
                  <div className="min-w-0 flex-1">
                    <DiameterField
                      label={`Seq ${sIdx + 1} ⌀`}
                      value={d}
                      onChange={(v) => updatePatternSlot(sIdx, v)}
                      onCustomizeChange={onBarDiaCustomizeChange}
                    />
                  </div>
                  {layer.patternDias.length > 2 && (
                    <button
                      type="button"
                      className={`${rowDelCls} mb-1 shrink-0`}
                      title={`Remove sequence slot ${sIdx + 1}`}
                      onClick={() => removePatternSlot(sIdx)}
                    >
                      <Icon name="close" size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {layer.nBars > 0 && (
              <p className={`${noteSmCls} mt-2 font-mono`}>
                Sequence ({layer.nBars}):{' '}
                {Array.from({ length: Math.min(layer.nBars, 8) }, (_, i) => `⌀${layer.patternDias[i % layer.patternDias.length]}`).join(' – ')}
                {layer.nBars > 8 ? ' …' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* --- MODE 3: BUNDLED REINFORCEMENT GROUPS --- */}
      {layer.kind === 'bundle' && (
        <div className="flex flex-col gap-2.5">
          {/* Bundle size quick presets: 2-bar, 3-bar, 4-bar, or any custom count */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="font-display text-[0.59375rem] font-bold uppercase tracking-[0.06em] text-ink-3">
              Bundle size preset:
            </span>
            <div className="flex flex-wrap gap-1">
              {[2, 3, 4].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  aria-pressed={layer.barsPerBundle === sz}
                  onClick={() =>
                    onPatch({
                      barsPerBundle: sz,
                      bundleBarDias: Array.from(
                        { length: Math.max(sz, layer.bundleBarDias.length) },
                        (_, k) => layer.bundleBarDias[k] ?? layer.barDia,
                      ),
                    })
                  }
                  className={`rounded border px-2 py-[3px] font-display text-[0.625rem] font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${
                    layer.barsPerBundle === sz
                      ? 'border-accent bg-accent-wash text-accent-strong'
                      : 'border-edge bg-card text-ink-2 hover:bg-panel'
                  }`}
                >
                  {sz}-bar bundle
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            <NumField
              label="Bars per bundle"
              value={layer.barsPerBundle}
              min={2}
              step={1}
              onChange={(v) => {
                const per = Math.max(1, Math.round(v))
                onPatch({
                  barsPerBundle: per,
                  bundleBarDias: Array.from(
                    { length: Math.max(per, layer.bundleBarDias.length) },
                    (_, k) => layer.bundleBarDias[k] ?? layer.barDia,
                  ),
                })
              }}
            />
            <NumField
              label="Number of bundles"
              value={layer.nBundles}
              min={1}
              step={1}
              onChange={(v) => onPatch({ nBundles: Math.max(0, Math.round(v)) })}
            />
            {!layer.bundleMixedDia && (
              <DiameterField
                label="Bundle bar ⌀"
                value={layer.barDia}
                onChange={(v) => onPatch({ barDia: v })}
                onCustomizeChange={onBarDiaCustomizeChange}
              />
            )}
            <NumField
              label="Spacing in bundle (clear)"
              unit="mm"
              value={layer.bundleInnerClear}
              min={0}
              step={1}
              onChange={(v) => onPatch({ bundleInnerClear: Math.max(0, v) })}
            />
            <OptionalMmField
              label="Bundle spacing (c/c)"
              value={layer.bundleSpacing}
              auto={autoSpacing}
              placeholder={autoSpacing > 0 ? `equal · ${autoSpacing.toFixed(0)}` : 'equal'}
              title="Centre-to-centre distance between adjacent bundles along this face. Blank spaces bundles equally."
              onChange={(v) => onPatch({ bundleSpacing: v })}
            />
          </div>

          {/* Individual diameters within bundle toggle */}
          <div className="flex flex-col gap-2 rounded-field border border-line bg-panel/40 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Check
                checked={layer.bundleMixedDia}
                onChange={(on) =>
                  onPatch({
                    bundleMixedDia: on,
                    bundleBarDias: Array.from(
                      { length: Math.max(layer.barsPerBundle, layer.bundleBarDias.length) },
                      (_, k) => layer.bundleBarDias[k] ?? layer.barDia,
                    ),
                  })
                }
                label="Different ⌀ per bar in bundle"
              />
              <SegGroup>
                {(['cluster', 'along', 'inward'] as RectBundleOrientation[]).map((ori) => (
                  <SegButton
                    key={ori}
                    active={layer.bundleOrientation === ori}
                    onClick={() => onPatch({ bundleOrientation: ori })}
                  >
                    {ORIENTATION_LABELS[ori]}
                  </SegButton>
                ))}
              </SegGroup>
            </div>

            {layer.bundleMixedDia && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {bundleDias.map((d, k) => (
                  <DiameterField
                    key={k}
                    label={`Bar ${k + 1} in bundle ⌀`}
                    value={d}
                    onChange={(v) => {
                      const next = Array.from(
                        { length: Math.max(layer.bundleBarDias.length, k + 1) },
                        (_, j) => layer.bundleBarDias[j] ?? layer.barDia,
                      )
                      next[k] = v
                      onPatch({ bundleBarDias: next })
                    }}
                    onCustomizeChange={onBarDiaCustomizeChange}
                  />
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <Readout
                label="Equivalent ⌀eq"
                value={`${bundleEqDia.toFixed(1)} mm`}
                title={`√Σφ² across [${bundleDias.map((d) => `⌀${d}`).join(', ')}]`}
              />
              <Readout
                label="Min clear gap"
                value={summary?.minClearAlong != null ? `${summary.minClearAlong.toFixed(1)} mm` : '—'}
                title="Clear distance between adjacent bundles along this layer"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => onPatch({ kind: 'customGroups', units: expandLayerToUnits(layer) })}
              title="Mix these bundles with single bars or customize individual bundles independently on the same face"
            >
              <Icon name="plus" size={10} />
              <span>Mix bundles + single bars on this face</span>
            </button>
          </div>
        </div>
      )}

      {/* --- MODE 4: MIXED GROUPS (BUNDLES + INDIVIDUAL SINGLE BARS COEXISTING ON THE SAME FACE) --- */}
      {layer.kind === 'customGroups' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => addUnit('single', 2)}
              title="Append an individual single reinforcement bar on this face"
            >
              <Icon name="plus" size={10} />
              <span>Single bar</span>
            </button>
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => addUnit('bundle', 2)}
              title="Append a 2-bar bundle on this face"
            >
              <Icon name="plus" size={10} />
              <span>2-bar bundle</span>
            </button>
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => addUnit('bundle', 3)}
              title="Append a 3-bar bundle on this face"
            >
              <Icon name="plus" size={10} />
              <span>3-bar bundle</span>
            </button>
            <button
              type="button"
              className={btnMiniCls}
              onClick={() => addUnit('bundle', 4)}
              title="Append a custom-size bundle (4+ or any count) on this face"
            >
              <Icon name="plus" size={10} />
              <span>Custom bundle</span>
            </button>
            {layer.units.length > 0 && (
              <button
                type="button"
                className={`${btnDangerCls} ml-auto !px-2 !py-[3px] !text-[0.59375rem]`}
                onClick={() => onPatch({ units: [] })}
                title="Clear all items in this layer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Individual bar / bundle cards along the face */}
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {layer.units.map((u, uIdx) => {
              const uDias = unitDiameters(u)
              return (
                <div
                  key={u.id}
                  data-testid={`rect-unit-${uIdx + 1}`}
                  className="rounded-field border border-line bg-panel/40 p-2"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[0.625rem] font-semibold text-ink-3">#{uIdx + 1}</span>
                      <SegGroup>
                        <SegButton
                          active={u.kind === 'single'}
                          onClick={() => updateUnit(u.id, { kind: 'single' })}
                        >
                          Single bar
                        </SegButton>
                        <SegButton
                          active={u.kind === 'bundle'}
                          onClick={() => {
                            const per = Math.max(2, u.barsPerBundle || 2)
                            updateUnit(u.id, {
                              kind: 'bundle',
                              barsPerBundle: per,
                              dias: Array.from({ length: per }, (_, k) => u.dias[k] ?? u.barDia),
                            })
                          }}
                        >
                          Bundle ({u.kind === 'bundle' ? uDias.length : Math.max(2, u.barsPerBundle)})
                        </SegButton>
                      </SegGroup>
                    </div>

                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="rounded px-1 text-[0.6875rem] text-ink-3 hover:bg-panel hover:text-ink disabled:opacity-35"
                        disabled={uIdx === 0}
                        onClick={() => moveUnit(uIdx, -1)}
                        title="Move earlier along face"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-[0.6875rem] text-ink-3 hover:bg-panel hover:text-ink disabled:opacity-35"
                        disabled={uIdx === layer.units.length - 1}
                        onClick={() => moveUnit(uIdx, 1)}
                        title="Move later along face"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={rowDelCls}
                        onClick={() => removeUnit(u.id)}
                        title="Remove group"
                      >
                        <Icon name="close" size={10} />
                      </button>
                    </div>
                  </div>

                  {u.kind === 'single' ? (
                    <DiameterField
                      label="Bar diameter ⌀"
                      value={u.barDia}
                      onChange={(v) => updateUnit(u.id, { barDia: v })}
                      onCustomizeChange={onBarDiaCustomizeChange}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <NumField
                          label="Bars in bundle"
                          value={u.barsPerBundle}
                          min={2}
                          step={1}
                          onChange={(v) => {
                            const per = Math.max(2, Math.round(v))
                            updateUnit(u.id, {
                              barsPerBundle: per,
                              dias: Array.from(
                                { length: Math.max(per, u.dias.length) },
                                (_, k) => u.dias[k] ?? u.barDia,
                              ),
                            })
                          }}
                        />
                        <OptionalMmField
                          label="Bundle inner gap"
                          value={u.innerClear}
                          auto={layer.bundleInnerClear}
                          allowZero
                          placeholder={`layer · ${layer.bundleInnerClear}`}
                          title="Clear gap between bars inside this bundle (0 = contact)."
                          onChange={(v) => updateUnit(u.id, { innerClear: v })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {uDias.map((d, k) => (
                          <DiameterField
                            key={k}
                            label={`Bar ${k + 1} ⌀`}
                            value={d}
                            onChange={(v) => {
                              const next = Array.from(
                                { length: Math.max(u.dias.length, k + 1) },
                                (_, j) => u.dias[j] ?? u.barDia,
                              )
                              next[k] = v
                              updateUnit(u.id, { dias: next, barDia: next[0] })
                            }}
                            onCustomizeChange={onBarDiaCustomizeChange}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-2 border-t border-line pt-2">
            <OptionalMmField
              label="Group spacing (c/c)"
              value={layer.spacing}
              auto={autoSpacing}
              placeholder={autoSpacing > 0 ? `equal · ${autoSpacing.toFixed(0)}` : 'equal'}
              title="Centre-to-centre spacing between adjacent groups/bars along this face. Blank spaces groups equally."
              onChange={(v) => onPatch({ spacing: v })}
            />
            <NumField
              label="Default bundle clear"
              unit="mm"
              value={layer.bundleInnerClear}
              min={0}
              step={1}
              onChange={(v) => onPatch({ bundleInnerClear: Math.max(0, v) })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
