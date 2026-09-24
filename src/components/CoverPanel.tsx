import { useEffect, useId, useState } from 'react'
import { AdvancedCoverFigure, faceCoverForInput } from './AdvancedCoverFigure'
import { generateSection } from '../engine/sections'
import {
  COVER_FACES,
  detectSectionType,
  FACE_HINTS,
  FACE_LABELS,
  getCoverForFace,
  hasInnerOverrides,
  innerCover,
  outerCover,
  radialCover,
  setAllOuterCover,
  setInnerFaceCover,
  setInnerCover,
  setOuterFaceCover,
  setOuterCover,
  setUniformInnerCover,
  setUniformOuterCover,
  snapBarsToCover,
  type CoverAudit,
  type CoverFace,
  type CoverSpec,
} from '../engine/cover'
import type { AppState } from '../state'
import {
  Banner,
  btnCls,
  btnPrimaryCls,
  btnMiniCls,
  Card,
  fieldBoxCls,
  fieldCls,
  Icon,
  InfoTooltip,
  NumField,
  SubCard,
  noteSmCls,
} from './ui'

/** Stable fingerprint of a bar list — used to detect an out-of-date layout. */
function barsKey(bars: AppState['bars']): string {
  return bars.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.dia}`).join('|')
}

/** Every face cover of the section, as the Advanced Cover inputs display it. */
function allFaceCovers(cover: CoverSpec, geometry: AppState['geometry'], sectionType: ReturnType<typeof detectSectionType>): number[] {
  if (sectionType === 'circle' || sectionType === 'hollow-circle') {
    // a ring takes the governing face value, so every stored face value must agree for "uniform"
    const out = [faceCoverForInput(cover, geometry, sectionType, 'outer', 0), ...COVER_FACES.map((f) => outerCover(cover, f))]
    if (sectionType === 'hollow-circle') out.push(faceCoverForInput(cover, geometry, sectionType, 'inner', 0), radialCover(cover, 'inner'))
    return out
  }
  const out = geometry.boundary.map((_, i) => faceCoverForInput(cover, geometry, sectionType, 'outer', i))
  geometry.voids.forEach((v, vi) => v.forEach((_, i) => out.push(faceCoverForInput(cover, geometry, sectionType, 'inner', i, vi))))
  return out.length ? out : [outerCover(cover, 'bottom')]
}

export interface ActiveFace {
  surface: 'outer' | 'inner'
  faceIndex: number
  voidIndex?: number
}

/**
 * Nominal clear cover, entered **independently for each concrete face**.
 */
export function ClearCoverPanel({
  state,
  update,
  audit,
  activeFace,
  setActiveFace,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  audit: CoverAudit
  activeFace?: ActiveFace | null
  setActiveFace?: (face: ActiveFace | null) => void
}) {
  const cover = state.cover
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  const hasVoid = state.geometry.voids.length > 0
  const sectionType = detectSectionType(state.geometry, state.predefined, state.shapeClass)
  const circular = state.shapeClass === 'circ'
  const advancedId = useId()

  // every face value exactly as the Advanced Cover inputs show it
  const faceValues = allFaceCovers(cover, state.geometry, sectionType)
  const coverMin = Math.min(...faceValues)
  const coverMax = Math.max(...faceValues)
  const uniform = coverMax - coverMin < 1e-9
  const faceCount =
    sectionType === 'circle'
      ? 1
      : sectionType === 'hollow-circle'
        ? 2
        : state.geometry.boundary.length + state.geometry.voids.reduce((n, v) => n + v.length, 0)
  const uniformValue = uniform ? coverMin : radialCover(cover)
  // Advanced cover is hidden by default; a project that already carries
  // individual face values opens with it visible so they are not concealed.
  const [showAdvanced, setShowAdvanced] = useState(() => !uniform)

  const patchCover = (next: CoverSpec) => {
    setNote(null)
    update({ cover: next })
  }

  /** Uniform cover: one value for every outer and void face (the default mode). */
  const setUniform = (v: number) => {
    const base = setAllOuterCover(cover, v)
    patchCover(circular ? setUniformOuterCover(base, v, state.geometry) : base)
  }

  // Auto-focus field when activeFace is selected from SVG
  useEffect(() => {
    if (activeFace) {
      const id = `cover-input-${activeFace.surface}-${activeFace.voidIndex ?? 0}-${activeFace.faceIndex}`
      const el = document.getElementById(id)
      if (el) {
        el.focus()
      }
    }
  }, [activeFace])

  // --- generated-layout sync -------------------------------------------------
  const def = state.predefined
  const isCircularDef = def?.kind === 'circle' || def?.kind === 'hollowCircle'
  const gen = def && !isCircularDef ? generateSection(def, { cover, tieDia: state.tieDia, barDia: state.barDia }) : null
  const outOfSync = !!gen && barsKey(gen.bars) !== barsKey(state.bars)

  const applyToLayout = () => {
    if (!gen) return
    update({ bars: gen.bars })
    setNote({ kind: 'ok', text: `Bar layout regenerated at the entered cover (${gen.bars.length} bars).` })
  }

  const snapBars = () => {
    const r = snapBarsToCover(state.bars, state.geometry, cover, state.tieDia)
    update({ bars: r.bars })
    setNote(
      r.unfixable > 0
        ? { kind: 'warn', text: `${r.moved} bar(s) moved; ${r.unfixable} cannot meet the cover inside this section.` }
        : { kind: 'ok', text: `${r.moved} bar(s) shifted inward to reach the cover of their face.` },
    )
  }

  const worst = audit.worst
  const minOk = audit.nShort === 0
  const boundaryCount = state.geometry.boundary.length

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="target" size={13} className="text-ink-3" />
          <span>Clear cover</span>
          <InfoTooltip
            content={
              <span>
                Nominal cover is measured from each concrete face to the outside of the <b>links</b>. Uniform cover
                applies one value to every face; open <b>Advanced cover</b> to detail each face individually.
              </span>
            }
          />
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* --- UNIFORM COVER: default, primary, highlighted --- */}
        <div
          className={`rounded-lg border px-2.5 pb-2.5 pt-2 transition-colors ${
            uniform ? 'border-accent/45 bg-accent-wash/55 shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-edge bg-panel/50'
          }`}
          data-testid="uniform-cover"
        >
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-accent-strong">
              <Icon name="check" size={11} />
              Uniform cover
              <span className="rounded-full border border-accent/40 bg-card px-1.5 py-px font-body text-[9px] font-semibold normal-case tracking-normal text-accent">
                default
              </span>
            </span>
            {!uniform && (
              <span className="rounded-full border border-warn2/35 bg-warn2/10 px-1.5 py-px text-[9.5px] font-semibold text-warn2">
                advanced values active · {coverMin}–{coverMax} mm
              </span>
            )}
          </div>
          <NumField
            id="cover-input-uniform"
            label="Clear cover — all faces"
            unit="mm"
            value={uniformValue}
            min={0}
            step={5}
            hint={
              uniform
                ? hasVoid
                  ? 'Applied to every outer and void face'
                  : 'Applied to every concrete face'
                : 'Entering a value resets every face to it'
            }
            onChange={setUniform}
          />
        </div>

        <p className="flex items-start gap-1.5 rounded-field border border-accent/20 bg-accent-wash/45 px-2 py-1.5 text-[10.5px] leading-snug text-ink-2">
          <Icon name="target" size={12} className="mt-px shrink-0 text-accent" />
          <span>
            <b className="font-display text-[9.5px] uppercase tracking-[0.07em] text-accent-strong">Clear cover → rebar position.</b>{' '}
            Automatic bars maintain cover measured normal/perpendicular to their nearest face.
          </span>
        </p>

        {/* --- ADVANCED COVER toggle: options + figure are shown / hidden together --- */}
        <button
          type="button"
          className={`${btnCls} w-full justify-between`}
          aria-expanded={showAdvanced}
          aria-controls={advancedId}
          onClick={() => setShowAdvanced((v) => !v)}
          title="Detail an individual cover value for each face"
        >
          <span className="flex items-center gap-1.5">
            <Icon name="ruler" size={12} />
            {showAdvanced ? 'Hide advanced cover' : 'Show advanced cover'}
          </span>
          <span className="text-[10.5px] font-normal text-ink-3">
            {faceCount} face{faceCount === 1 ? '' : 's'} {showAdvanced ? '▴' : '▾'}
          </span>
        </button>

        {showAdvanced && (
          <div id={advancedId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-card/60 p-2" data-testid="advanced-cover">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
              Advanced cover — individual face values
            </span>
            {/* --- 1. RECTANGULAR SECTION --- */}
            {sectionType === 'rectangular' && (
              <>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4">
                  {COVER_FACES.map((face, idx) => {
                    const isActive = activeFace?.surface === 'outer' && activeFace?.faceIndex === idx
                    return (
                      <div
                        key={face}
                        className={`rounded-field p-1 transition-colors ${
                          isActive ? 'bg-accent-wash ring-1 ring-accent' : ''
                        }`}
                        onMouseEnter={() => setActiveFace?.({ surface: 'outer', faceIndex: idx })}
                        onMouseLeave={() => setActiveFace?.(null)}
                      >
                        <NumField
                          id={`cover-input-outer-0-${idx}`}
                          label={FACE_LABELS[face]}
                          unit="mm"
                          value={outerCover(cover, face)}
                          min={0}
                          step={5}
                          hint={FACE_HINTS[face]}
                          onChange={(v) => patchCover(setOuterCover(cover, face, v))}
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* --- 2. SOLID CIRCLE SECTION --- */}
            {sectionType === 'circle' && (
              <div className="flex flex-col gap-2">
                <NumField
                  id="cover-input-outer-0-0"
                  label="Uniform Cover"
                  unit="mm"
                  value={cover.uniformOuterCover ?? outerCover(cover, 'bottom')}
                  min={0}
                  step={5}
                  hint="Uniform clear cover around the circumference"
                  onChange={(v) => patchCover(setUniformOuterCover(cover, v, state.geometry))}
                />
              </div>
            )}

            {/* --- 3. HOLLOW CIRCLE SECTION --- */}
            {sectionType === 'hollow-circle' && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <NumField
                  id="cover-input-outer-0-0"
                  label="Outer Clear Cover"
                  unit="mm"
                  value={cover.uniformOuterCover ?? outerCover(cover, 'bottom')}
                  min={0}
                  step={5}
                  hint="Uniform outer circumference cover"
                  onChange={(v) => patchCover(setUniformOuterCover(cover, v, state.geometry))}
                />
                <NumField
                  id="cover-input-inner-0-0"
                  label="Inner Clear Cover"
                  unit="mm"
                  value={cover.uniformInnerCover ?? innerCover(cover, 'bottom')}
                  min={0}
                  step={5}
                  hint="Uniform inner void circumference cover"
                  onChange={(v) => patchCover(setUniformInnerCover(cover, v, state.geometry))}
                />
              </div>
            )}

            {/* --- 4. POLYGON / IRREGULAR SECTION --- */}
            {(sectionType === 'polygon' || sectionType === 'hollow-polygon') && (
              <div className="flex flex-col gap-2">
                <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-3">
                  Outer Boundary Faces ({boundaryCount} detected)
                </span>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-3">
                  {Array.from({ length: boundaryCount }).map((_, idx) => {
                    const val = getCoverForFace(cover, 'outer', idx, 0, state.geometry)
                    const isActive = activeFace?.surface === 'outer' && activeFace?.faceIndex === idx
                    return (
                      <div
                        key={`outer-${idx}`}
                        className={`rounded-field p-1 transition-colors ${
                          isActive ? 'bg-accent-wash ring-1 ring-accent' : ''
                        }`}
                        onMouseEnter={() => setActiveFace?.({ surface: 'outer', faceIndex: idx })}
                        onMouseLeave={() => setActiveFace?.(null)}
                      >
                        <NumField
                          id={`cover-input-outer-0-${idx}`}
                          label={`Face ${idx + 1}`}
                          unit="mm"
                          value={val}
                          min={0}
                          step={5}
                          onChange={(v) => patchCover(setOuterFaceCover(cover, idx, v, state.geometry))}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* --- HOLLOW SECTIONS INNER FACES --- */}
            {hasVoid && (
              <SubCard
                title={
                  <span className="flex items-center gap-1.5">
                    Void / inner faces ({state.geometry.voids.length} void{state.geometry.voids.length > 1 ? 's' : ''})
                    <InfoTooltip
                      content={
                        <span>
                          Cover for bars lining the faces of an internal void — the cell walls of a box pier, the soffit
                          under a voided deck. Leave a face blank to inherit the outer face of the same orientation.
                        </span>
                      }
                    />
                  </span>
                }
                action={
                  hasInnerOverrides(cover) ? (
                    <button
                      type="button"
                      className={btnMiniCls}
                      onClick={() =>
                        patchCover({
                          ...cover,
                          inner: { bottom: null, right: null, top: null, left: null },
                          innerFaces: undefined,
                          uniformInnerCover: undefined,
                        })
                      }
                      title="Clear the void-face values — they then follow the outer faces"
                    >
                      clear overrides
                    </button>
                  ) : undefined
                }
              >
                {sectionType === 'hollow-polygon' ? (
                  <div className="flex flex-col gap-3">
                    {state.geometry.voids.map((vPoly, vIdx) => (
                      <div key={`void-${vIdx}`} className="flex flex-col gap-1.5">
                        {state.geometry.voids.length > 1 && (
                          <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.07em] text-ink-3">
                            Void {vIdx + 1} ({vPoly.length} faces)
                          </span>
                        )}
                        <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-3">
                          {vPoly.map((_, idx) => {
                            const val = getCoverForFace(cover, 'inner', idx, vIdx, state.geometry)
                            const isActive =
                              activeFace?.surface === 'inner' &&
                              activeFace?.faceIndex === idx &&
                              (activeFace?.voidIndex ?? 0) === vIdx
                            return (
                              <div
                                key={`inner-${vIdx}-${idx}`}
                                className={`rounded-field p-1 transition-colors ${
                                  isActive ? 'bg-accent-wash ring-1 ring-accent' : ''
                                }`}
                                onMouseEnter={() =>
                                  setActiveFace?.({ surface: 'inner', faceIndex: idx, voidIndex: vIdx })
                                }
                                onMouseLeave={() => setActiveFace?.(null)}
                              >
                                <NumField
                                  id={`cover-input-inner-${vIdx}-${idx}`}
                                  label={`Face ${idx + 1}`}
                                  unit="mm"
                                  value={val}
                                  min={0}
                                  step={5}
                                  onChange={(v) => patchCover(setInnerFaceCover(cover, idx, v, vIdx, state.geometry))}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4">
                    {COVER_FACES.map((face) => (
                      <InnerCoverField
                        key={face}
                        face={face}
                        value={cover.inner[face]}
                        inherit={outerCover(cover, face)}
                        onChange={(v) => patchCover(setInnerCover(cover, face, v))}
                      />
                    ))}
                  </div>
                )}
              </SubCard>
            )}


            <figure className="rounded-lg border border-line bg-panel/40 px-2 pb-1.5 pt-2">
              <AdvancedCoverFigure
                geometry={state.geometry}
                cover={cover}
                sectionType={sectionType}
                audit={audit}
                activeFace={activeFace}
                setActiveFace={setActiveFace}
              />
              <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <span className="h-0 w-4 border-t border-dashed border-ok" aria-hidden="true" /> clear cover met
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0 w-4 border-t border-dashed border-bad" aria-hidden="true" /> short
                </span>
                <span className="normal-case tracking-normal">
                  {sectionType === 'rectangular'
                    ? 'face names match the inputs · mm'
                    : sectionType === 'circle' || sectionType === 'hollow-circle'
                      ? 'true shape · mm'
                      : `F n = Face n${hasVoid ? ', VF n = void Face n' : ''} · mm`}
                </span>
              </figcaption>
            </figure>
          </div>
        )}

        {circular && (
          <p className="flex items-start gap-1.5 rounded-field border border-warn2/30 bg-warn2/8 px-2 py-1.5 text-[11px] leading-snug text-warn2">
            <Icon name="info" size={12} className="mt-px shrink-0" />
            <span>
              Circular ring: the section is radially symmetric, so the governing (largest) face cover —{' '}
              <b>{radialCover(cover)} mm</b> — is applied around the ring
              {hasInnerOverrides(cover) ? `, and ${radialCover(cover, 'inner')} mm at the void face` : ''}.
            </span>
          </p>
        )}

        {/* Achieved cover audit list */}
        <Banner tone={minOk ? 'ok' : 'error'}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <b className="font-display text-[10px] uppercase tracking-[0.07em]">
              {minOk ? 'Cover satisfied' : 'Cover short'}
            </b>
            {audit.minAchieved == null ? (
              <span>— no bars to audit.</span>
            ) : (
              <span className="tnum">
                minimum achieved {audit.minAchieved.toFixed(1)} mm
                {worst
                  ? ` (bar ${worst.bar}, ${worst.surface === 'inner' ? 'void ' : ''}${
                      FACE_LABELS[worst.face]?.toLowerCase() ?? worst.faceName
                    } face, needs ${worst.required.toFixed(1)} mm)`
                  : ''}
                {audit.nShort > 0 ? ` — ${audit.nShort} bar(s) below required cover` : ''}
              </span>
            )}
          </div>
          {audit.minAchieved != null && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {COVER_FACES.map((face) => {
                const st = audit.faces[face]
                if (!st) return null
                const bad = st.min != null && st.min < st.required - 1
                return (
                  <span
                    key={face}
                    title={`Smallest achieved cover at the ${FACE_LABELS[face].toLowerCase()} face, against ${st.required.toFixed(0)} mm required`}
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] tnum ${
                      bad ? 'border-bad/35 bg-bad/10 text-bad' : 'border-line bg-panel/80 text-ink-2'
                    }`}
                  >
                    <span className="font-display text-[9px] font-bold uppercase tracking-[0.06em] text-ink-3">
                      {FACE_LABELS[face]}
                    </span>
                    {st.min == null ? '—' : `${st.min.toFixed(1)}`}
                    <span className="text-ink-3">/ {st.required.toFixed(0)}</span>
                  </span>
                )
              })}
            </div>
          )}
        </Banner>

        {note && (
          <p
            className={`flex items-start gap-1.5 text-[11px] leading-snug ${
              note.kind === 'ok' ? 'text-ok' : 'text-warn2'
            }`}
          >
            <Icon name={note.kind === 'ok' ? 'check' : 'alert'} size={12} className="mt-px shrink-0" />
            <span>{note.text}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <span className={`${noteSmCls} max-w-[34ch]`}>
            {isCircularDef
              ? 'The circular reinforcement panel re-generates at this cover automatically.'
              : 'Bars sit back from their face by cover + ⌀tie + ⌀bar/2.'}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {audit.nShort > 0 && state.bars.length > 0 && (
              <button type="button" className={btnCls} onClick={snapBars} title="Move bars inward until each face's cover is met">
                <Icon name="target" size={12} />
                <span>Snap bars to cover</span>
              </button>
            )}
            {gen && (
              <button
                type="button"
                className={outOfSync ? btnPrimaryCls : btnCls}
                onClick={applyToLayout}
                title="Re-generate the predefined bar layout at the entered per-face cover"
              >
                {outOfSync ? (
                  <Icon name="refresh" size={12} />
                ) : (
                  <Icon name="check" size={12} className="text-ok" />
                )}
                <span>{outOfSync ? 'Apply cover to layout' : 'Layout up to date'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function InnerCoverField({
  face,
  value,
  inherit,
  onChange,
}: {
  face: CoverFace
  value: number | null
  inherit: number
  onChange: (v: number | null) => void
}) {
  const inherited = value == null
  return (
    <label className="flex min-w-0 flex-col gap-[3px]">
      <span className="flex items-center justify-between gap-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.07em] text-ink-2">
        {FACE_LABELS[face]}
        {inherited && <span className="font-body text-[9px] font-normal normal-case tracking-normal text-ink-3">inherited</span>}
      </span>
      <span className={`${fieldBoxCls} ${inherited ? 'bg-panel/70' : 'border-accent/50'}`}>
        <input
          type="number"
          className={fieldCls}
          value={value ?? ''}
          placeholder={`same (${inherit})`}
          min={0}
          step={5}
          title={value == null ? `Inherits the ${FACE_LABELS[face].toLowerCase()} outer-face cover` : 'Custom void-face cover'}
          onChange={(e) => {
            const t = e.target.value
            if (t === '') onChange(null)
            else onChange(Number.isFinite(parseFloat(t)) ? parseFloat(t) : 0)
          }}
        />
        <span className="shrink-0 pr-2 text-[10.5px] leading-none text-ink-3" aria-hidden="true">
          mm
        </span>
      </span>
    </label>
  )
}

export function CoverDiagram({
  cover,
  hasVoid,
  audit,
}: {
  cover: CoverSpec
  hasVoid: boolean
  audit: CoverAudit
}) {
  const W = 250
  const H = 158
  const box = { x: 24, y: 18, w: W - 48, h: H - 46 }
  const maxC = Math.max(
    60,
    ...COVER_FACES.map((f) => Math.max(outerCover(cover, f), innerCover(cover, f))),
  )
  const k = 24 / maxC
  const inset = (v: number) => Math.max(5, Math.min(Math.min(box.w, box.h) / 2 - 10, v * k))

  const shortFaces = new Set(audit.bars.filter((s) => !s.ok).map((s) => `${s.surface}:${s.face}`))
  const col = (key: string) => (shortFaces.has(key) ? 'var(--color-bad)' : 'var(--color-ok)')

  const bo = outerCover(cover, 'bottom')
  const to = outerCover(cover, 'top')
  const le = outerCover(cover, 'left')
  const ri = outerCover(cover, 'right')
  const ib = innerCover(cover, 'bottom')
  const it = innerCover(cover, 'top')
  const il = innerCover(cover, 'left')
  const ir = innerCover(cover, 'right')

  const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [
    { x1: box.x, y1: box.y + box.h - inset(bo), x2: box.x + box.w, y2: box.y + box.h - inset(bo), key: 'outer:bottom' },
    { x1: box.x, y1: box.y + inset(to), x2: box.x + box.w, y2: box.y + inset(to), key: 'outer:top' },
    { x1: box.x + inset(le), y1: box.y, x2: box.x + inset(le), y2: box.y + box.h, key: 'outer:left' },
    { x1: box.x + box.w - inset(ri), y1: box.y, x2: box.x + box.w - inset(ri), y2: box.y + box.h, key: 'outer:right' },
  ]
  const tags: { x: number; y: number; text: string; key: string }[] = [
    { x: box.x + box.w / 2, y: box.y + box.h - inset(bo) / 2 + 3, text: `${bo}`, key: 'outer:bottom' },
    { x: box.x + box.w / 2, y: box.y + inset(to) / 2 + 3, text: `${to}`, key: 'outer:top' },
    { x: box.x + inset(le) / 2 - 2, y: box.y + box.h / 2, text: `${le}`, key: 'outer:left' },
    { x: box.x + box.w - inset(ri) / 2 + 2, y: box.y + box.h / 2, text: `${ri}`, key: 'outer:right' },
  ]

  const vx = box.x + box.w * 0.3
  const vy = box.y + box.h * 0.3
  const vw = box.w - 2 * box.w * 0.3
  const vh = box.h - 2 * box.h * 0.3
  if (hasVoid) {
    lines.push(
      { x1: vx, y1: vy + vh + inset(ib), x2: vx + vw, y2: vy + vh + inset(ib), key: 'inner:bottom' },
      { x1: vx, y1: vy - inset(it), x2: vx + vw, y2: vy - inset(it), key: 'inner:top' },
      { x1: vx - inset(il), y1: vy, x2: vx - inset(il), y2: vy + vh, key: 'inner:left' },
      { x1: vx + vw + inset(ir), y1: vy, x2: vx + vw + inset(ir), y2: vy + vh, key: 'inner:right' },
    )
    tags.push(
      { x: vx + vw / 2, y: vy + vh + inset(ib) / 2 + 3, text: `${ib}`, key: 'inner:bottom' },
      { x: vx + vw / 2, y: vy - inset(it) / 2 + 3, text: `${it}`, key: 'inner:top' },
    )
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto block w-full max-w-[280px]"
      role="img"
      aria-label="Per-face cover sketch"
    >
      <rect x={box.x} y={box.y} width={box.w} height={box.h} className="fill-concrete stroke-ink" strokeWidth="1.6" rx="1.5" />
      {[
        { x: box.x + box.w / 2, y: H - 16, t: 'bottom' },
        { x: box.x + box.w / 2, y: 11, t: 'top' },
        { x: box.x - 14, y: box.y + box.h / 2, t: 'left' },
        { x: box.x + box.w + 14, y: box.y + box.h / 2, t: 'right' },
      ].map((f) => (
        <text
          key={f.t}
          x={f.x}
          y={f.y}
          fontSize="7"
          textAnchor="middle"
          letterSpacing="0.5"
          fill="var(--color-ink-3)"
          style={{ textTransform: 'uppercase' }}
        >
          {f.t}
        </text>
      ))}
      {hasVoid && (
        <rect x={vx} y={vy} width={vw} height={vh} className="fill-paper stroke-ink" strokeWidth="1.2" />
      )}
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={col(l.key)}
          strokeWidth="1"
          strokeDasharray="4 3"
        />
      ))}
      {tags.map((t, i) => (
        <text key={`t-${i}`} x={t.x} y={t.y} fontSize="9" fontWeight="600" textAnchor="middle" fill={col(t.key)}>
          {t.text}
        </text>
      ))}
      <text x={box.x} y={H - 4} fontSize="8" fill="var(--color-ink-3)">
        nominal cover to the links · spacing schematic, numbers in mm
      </text>
    </svg>
  )
}
