import { useEffect, useState } from 'react'
import { generateSection } from '../engine/sections'
import {
  COVER_FACES,
  detectSectionType,
  FACE_HINTS,
  FACE_LABELS,
  getCoverForFace,
  hasInnerOverrides,
  innerCover,
  isUniformCover,
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
import type { Point, SectionGeometry } from '../engine/types'
import type { AppState } from '../state'
import {
  Banner,
  btnCls,
  btnPrimaryCls,
  btnMiniCls,
  Card,
  Check,
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

export interface ActiveFace {
  surface: 'outer' | 'inner'
  faceIndex: number
  voidIndex?: number
}

/**
 * Nominal clear cover. **Uniform Cover** is the primary control; face-wise
 * (advanced) options are collapsed behind a Show/Hide toggle.
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
  const [unlinked, setUnlinked] = useState(false)
  /** Advanced (face-wise) cover editors — hidden by default. */
  const [showAdvanced, setShowAdvanced] = useState(false)

  const hasVoid = state.geometry.voids.length > 0
  const sectionType = detectSectionType(state.geometry, state.predefined, state.shapeClass)
  const circular = state.shapeClass === 'circ'
  const allEqual = isUniformCover(cover)
  const linked = allEqual && !unlinked

  /** Representative uniform value shown in the primary field. */
  const uniformOuterValue =
    cover.uniformOuterCover ??
    Math.max(...COVER_FACES.map((f) => outerCover(cover, f)), outerCover(cover, 'bottom'))

  const patchCover = (next: CoverSpec) => {
    setNote(null)
    update({ cover: next })
  }

  const setUniform = (v: number) => {
    setUnlinked(false)
    if (circular || sectionType === 'circle' || sectionType === 'hollow-circle') {
      patchCover(setUniformOuterCover(cover, v, state.geometry))
    } else if (sectionType === 'polygon' || sectionType === 'hollow-polygon') {
      // Apply the same value to every outer face index
      let next = setAllOuterCover(cover, v)
      next = setUniformOuterCover(next, v, state.geometry)
      const n = state.geometry.boundary.length
      for (let i = 0; i < n; i++) next = setOuterFaceCover(next, i, v, state.geometry)
      patchCover(next)
    } else {
      patchCover(setAllOuterCover(cover, v))
    }
  }

  const setFace = (face: CoverFace, v: number) => {
    patchCover(linked ? setAllOuterCover(cover, v) : setOuterCover(cover, face, v))
  }

  const toggleLink = (on: boolean) => {
    setUnlinked(!on)
    if (on) patchCover(setAllOuterCover(cover, Math.max(...COVER_FACES.map((f) => outerCover(cover, f)))))
  }

  const toggleAdvanced = () => {
    setShowAdvanced((open) => {
      const next = !open
      // Opening advanced on a non-uniform cover implies face-wise editing
      if (next && !allEqual) setUnlinked(true)
      return next
    })
  }

  // Auto-focus field when activeFace is selected from SVG — open advanced so the field exists
  useEffect(() => {
    if (activeFace) {
      setShowAdvanced(true)
      const id = `cover-input-${activeFace.surface}-${activeFace.voidIndex ?? 0}-${activeFace.faceIndex}`
      // defer until advanced panel has rendered
      requestAnimationFrame(() => {
        const el = document.getElementById(id)
        if (el) el.focus()
      })
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

  /** Face-wise editors (non-circular / void faces). The cover sketch always lives under Advanced Cover. */
  const hasFaceWiseEditors =
    sectionType === 'rectangular' ||
    sectionType === 'polygon' ||
    sectionType === 'hollow-polygon' ||
    (hasVoid && sectionType !== 'hollow-circle' && sectionType !== 'circle')

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="target" size={13} className="text-ink-3" />
          <span>Clear cover</span>
          <InfoTooltip
            content={
              <span>
                Nominal cover is measured from each concrete face to the outside of the <b>links</b>.
                <b> Uniform Cover</b> is the default and applies the same value to every face. Open{' '}
                <b>Advanced Cover</b> only when individual faces need different values.
              </span>
            }
          />
        </span>
      }
      subtitle="uniform by default"
    >
      <div className="flex flex-col gap-2.5">
        <p className="flex items-start gap-1.5 rounded-field border border-accent/20 bg-accent-wash/45 px-2 py-1.5 text-[10.5px] leading-snug text-ink-2">
          <Icon name="target" size={12} className="mt-px shrink-0 text-accent" />
          <span>
            <b className="font-display text-[9.5px] uppercase tracking-[0.07em] text-accent-strong">Clear cover → rebar position.</b>{' '}
            Automatic bars maintain cover measured normal/perpendicular to their nearest face.
          </span>
        </p>

        {/* -------- PRIMARY: Uniform Cover (always visible, highlighted) -------- */}
        <div
          className="rounded-lg border-2 border-accent/40 bg-accent-wash/50 p-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]"
          data-testid="uniform-cover-primary"
        >
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <span className="inline-flex items-center gap-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-accent-strong">
              <Icon name="link" size={12} className="text-accent" />
              Uniform Cover
              <span className="rounded-full border border-accent/35 bg-card px-1.5 py-px font-display text-[9px] font-bold uppercase tracking-[0.06em] text-accent">
                Default
              </span>
            </span>
            {allEqual ? (
              <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.06em] text-ok">All faces equal</span>
            ) : (
              <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.06em] text-warn2">
                Faces differ — see Advanced
              </span>
            )}
          </div>

          {sectionType === 'hollow-circle' ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <NumField
                id="cover-input-uniform-outer"
                label="Outer Clear Cover"
                unit="mm"
                value={cover.uniformOuterCover ?? outerCover(cover, 'bottom')}
                min={0}
                step={5}
                hint="Primary · uniform around the outer circumference"
                onChange={(v) => patchCover(setUniformOuterCover(cover, v, state.geometry))}
              />
              <NumField
                id="cover-input-uniform-inner"
                label="Inner Clear Cover"
                unit="mm"
                value={cover.uniformInnerCover ?? innerCover(cover, 'bottom')}
                min={0}
                step={5}
                hint="Primary · uniform around the void circumference"
                onChange={(v) => patchCover(setUniformInnerCover(cover, v, state.geometry))}
              />
            </div>
          ) : sectionType === 'circle' ? (
            <NumField
              id="cover-input-outer-0-0"
              label="Uniform Cover"
              unit="mm"
              value={cover.uniformOuterCover ?? outerCover(cover, 'bottom')}
              min={0}
              step={5}
              hint="Primary · uniform clear cover around the circumference"
              onChange={(v) => patchCover(setUniformOuterCover(cover, v, state.geometry))}
            />
          ) : (
            <NumField
              id="cover-input-uniform-outer"
              label="Uniform Cover"
              unit="mm"
              value={uniformOuterValue}
              min={0}
              step={5}
              hint="Primary · sets the same clear cover on every outer face"
              onChange={setUniform}
            />
          )}

          <p className={`${noteSmCls} mt-1.5`}>
            {allEqual
              ? `One value (${uniformOuterValue} mm) applied to all faces. Open Advanced Cover only if a face needs a different cover.`
              : `Face covers currently differ. Editing Uniform Cover resets every face to the same value. Open Advanced Cover to edit faces individually.`}
          </p>
        </div>

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

        {/* -------- ADVANCED COVER toggle + panel (face editors + cover sketch) -------- */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleAdvanced}
            aria-expanded={showAdvanced}
            data-testid="advanced-cover-toggle"
            className={`flex w-full items-center justify-between gap-2 rounded-field border px-2.5 py-1.5 text-left transition-[background-color,border-color] duration-150 ease-ui ${
              showAdvanced
                ? 'border-edge-strong bg-panel'
                : 'border-edge bg-card hover:border-edge-strong hover:bg-panel/70'
            }`}
            title={
              showAdvanced
                ? 'Hide face-wise cover options and the cover sketch'
                : 'Show face-wise cover options and the cover sketch'
            }
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="layers" size={13} className="shrink-0 text-ink-3" />
              <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-2">
                {showAdvanced ? 'Hide Advanced Cover' : 'Show Advanced Cover'}
              </span>
              {!showAdvanced && !allEqual && (
                <span className="rounded-full border border-warn2/35 bg-warn2/10 px-1.5 py-px font-display text-[9px] font-bold uppercase tracking-[0.05em] text-warn2">
                  custom faces
                </span>
              )}
            </span>
            <span className="font-display text-[10px] font-bold text-ink-3" aria-hidden="true">
              {showAdvanced ? '▴' : '▾'}
            </span>
          </button>

          {showAdvanced && (
            <div
              className="flex flex-col gap-2.5 rounded-lg border border-edge bg-panel/40 p-2.5"
              data-testid="advanced-cover-panel"
            >
              {hasFaceWiseEditors && (
                <p className={`${noteSmCls}`}>
                  Face-wise cover — each concrete face can take its own nominal clear cover. Prefer Uniform Cover
                  unless a face truly needs a different value.
                </p>
              )}

              {/* --- RECTANGULAR: four directional faces --- */}
              {sectionType === 'rectangular' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-3">
                      Outer faces
                    </span>
                    <Check
                      checked={linked}
                      onChange={toggleLink}
                      label={
                        <span className="inline-flex items-center gap-1">
                          <Icon
                            name={linked ? 'link' : 'close'}
                            size={11}
                            className={linked ? 'text-accent' : 'text-ink-3'}
                          />
                          Link faces
                        </span>
                      }
                      title={
                        linked
                          ? 'All faces share one value — click to detail them independently'
                          : 'Use one value for every face'
                      }
                    />
                  </div>
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
                            label={`${FACE_LABELS[face]}${linked ? ' *' : ''}`}
                            unit="mm"
                            value={outerCover(cover, face)}
                            min={0}
                            step={5}
                            hint={FACE_HINTS[face]}
                            onChange={(v) => setFace(face, v)}
                          />
                        </div>
                      )
                    })}
                  </div>
                  {linked && (
                    <p className={`${noteSmCls} -mt-0.5`}>
                      <b>*</b> Faces linked — editing any face sets all four to{' '}
                      <b>{outerCover(cover, 'bottom')} mm</b>. Unlink to detail them independently.
                    </p>
                  )}
                </>
              )}

              {/* --- POLYGON: per-boundary-face --- */}
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

              {/* --- VOID / INNER FACES (advanced) --- */}
              {hasVoid && hasFaceWiseEditors && (
                <SubCard
                  title={
                    <span className="flex items-center gap-1.5">
                      Void / inner faces ({state.geometry.voids.length} void
                      {state.geometry.voids.length > 1 ? 's' : ''})
                      <InfoTooltip
                        content={
                          <span>
                            Cover for bars lining the faces of an internal void — the cell walls of a box pier, the
                            soffit under a voided deck. Leave a face blank to inherit the outer face of the same
                            orientation.
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
                                    onChange={(v) =>
                                      patchCover(setInnerFaceCover(cover, idx, v, vIdx, state.geometry))
                                    }
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

              {/* Cover section sketch — only visible when Advanced Cover is shown */}
              <figure
                className="rounded-lg border border-line bg-card/70 px-2 pb-1.5 pt-2"
                data-testid="advanced-cover-figure"
              >
                <CoverDiagram
                  cover={cover}
                  geometry={state.geometry}
                  sectionType={sectionType}
                  audit={audit}
                />
                <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-px w-4 bg-ok" aria-hidden="true" /> cover met
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-px w-4 bg-bad" aria-hidden="true" /> short
                  </span>
                  <span>
                    {sectionType.replace('-', ' ')}
                    {state.geometry.boundary.length >= 3
                      ? ` · ${state.geometry.boundary.length} outer face${state.geometry.boundary.length === 1 ? '' : 's'}`
                      : ''}
                    {hasVoid ? ` · ${state.geometry.voids.length} void${state.geometry.voids.length === 1 ? '' : 's'}` : ''}
                  </span>
                </figcaption>
              </figure>
            </div>
          )}
        </div>

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
  geometry,
  sectionType,
  audit,
}: {
  cover: CoverSpec
  geometry: SectionGeometry
  sectionType: 'rectangular' | 'polygon' | 'circle' | 'hollow-polygon' | 'hollow-circle'
  audit: CoverAudit
}) {
  const W = 320
  const H = 220
  const MARGIN = 46

  const bnd = geometry.boundary
  const voids = geometry.voids
  const isCircle = sectionType === 'circle' || sectionType === 'hollow-circle'
  const isHollowCircle = sectionType === 'hollow-circle'
  const isRect = bnd.length === 4 && !isCircle

  if (!bnd.length) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[360px]" role="img">
        <text x={W / 2} y={H / 2} fontSize="10" textAnchor="middle" fill="var(--color-ink-3)">
          no geometry
        </text>
      </svg>
    )
  }

  // World bounds from concrete + voids only (reinforcement not drawn).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const extend = (p: Point) => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  bnd.forEach(extend)
  voids.forEach((vp) => vp.forEach(extend))

  const gW = maxX - minX || 1
  const gH = maxY - minY || 1
  const scale = Math.min((W - 2 * MARGIN) / gW, (H - 2 * MARGIN) / gH)
  const offX = (W - gW * scale) / 2
  const offY = (H - gH * scale) / 2
  const X = (x: number) => offX + (x - minX) * scale
  const Y = (y: number) => offY + (maxY - y) * scale

  // Circle radii / centre.
  let cx = 0, cy = 0, R = 0, Ri = 0
  if (isCircle) {
    cx = (minX + maxX) / 2
    cy = (minY + maxY) / 2
    R = (maxX - minX) / 2
    if (isHollowCircle && voids.length) {
      let vminX = Infinity, vminY = Infinity, vmaxX = -Infinity, vmaxY = -Infinity
      voids[0].forEach((p) => {
        if (p.x < vminX) vminX = p.x
        if (p.y < vminY) vminY = p.y
        if (p.x > vmaxX) vmaxX = p.x
        if (p.y > vmaxY) vmaxY = p.y
      })
      Ri = (vmaxX - vminX) / 2
    }
  }

  const polySA = (poly: Point[]): number => {
    let s = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      s += a.x * b.y - b.x * a.y
    }
    return s / 2
  }
  const segNormal = (poly: Point[], i: number, intoConcrete: boolean) => {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const ccw = polySA(poly) >= 0
    const inx = ccw ? -dy / len : dy / len
    const iny = ccw ? dx / len : -dy / len
    const nx = intoConcrete ? inx : -inx
    const ny = intoConcrete ? iny : -iny
    return { a, b, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, nx, ny, len }
  }

  const shortFaces = new Set<string>()
  for (const s of audit.bars) if (!s.ok) shortFaces.add(`${s.surface}:${s.voidIndex ?? 0}:${s.faceIndex}`)
  const fcol = (key: string) => (shortFaces.has(key) ? 'var(--color-bad)' : 'var(--color-ink-2)')

  const polyPath = (poly: Point[]) =>
    poly
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`)
      .join(' ') + ' Z'

  // Offset a polygon by `d` mm along the inward normals to produce the dashed
  // clear-cover guide. For voids the guide lies outside the void (concrete side).
  const offsetPolyPts = (poly: Point[], d: number, intoConcrete: boolean): Point[] => {
    return poly.map((_, i) => {
      const s = segNormal(poly, i, intoConcrete)
      const prev = segNormal(poly, (i - 1 + poly.length) % poly.length, intoConcrete)
      const ax = (s.nx + prev.nx) / 2
      const ay = (s.ny + prev.ny) / 2
      const al = Math.hypot(ax, ay) || 1
      return { x: s.a.x + (ax / al) * d, y: s.a.y + (ay / al) * d }
    })
  }
  const offsetPath = (poly: Point[], d: number, intoConcrete: boolean) => {
    const pts = offsetPolyPts(poly, d, intoConcrete)
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`)
      .join(' ') + (Math.abs(d) > 1e-6 ? '' : '')
  }

  type FaceDim = {
    x1: number
    y1: number
    x2: number
    y2: number
    valX: number
    valY: number
    valAnchor: 'start' | 'end' | 'middle'
    faceLblX: number
    faceLblY: number
    label: string
    faceName: string
    color: string
  }
  const faceDims: FaceDim[] = []

  const faceName = (surface: 'outer' | 'inner', i: number) => {
    if (isRect && surface === 'outer') return FACE_LABELS[COVER_FACES[i]]
    if (isRect && surface === 'inner') return `Inner ${FACE_LABELS[COVER_FACES[i]]}`
    if (surface === 'outer') return `Face ${i + 1}`
    return `Inner Face ${i + 1}`
  }

  const addFace = (
    poly: Point[],
    surface: 'outer' | 'inner',
    i: number,
    voidIndex: number,
  ) => {
    const intoConcrete = surface === 'outer'
    const s = segNormal(poly, i, intoConcrete)
    const cov = getCoverForFace(cover, surface, i, voidIndex, geometry)

    const endW = { x: s.mx + s.nx * cov, y: s.my + s.ny * cov }
    const x1 = X(s.mx)
    const y1 = Y(s.my)
    const x2 = X(endW.x)
    const y2 = Y(endW.y)

    const ndx = x2 - x1
    const ndy = y2 - y1
    const nlen = Math.hypot(ndx, ndy) || 1
    const ux = ndx / nlen
    const uy = ndy / nlen

    const outDist = 18 / scale
    const fW = { x: s.mx - s.nx * outDist, y: s.my - s.ny * outDist }
    const faceLblX = X(fW.x)
    const faceLblY = Y(fW.y) + 3

    const pastPx = 10
    const valX = x2 + ux * pastPx
    const valY = y2 + uy * pastPx + 3
    let valAnchor: 'start' | 'end' | 'middle' = 'middle'
    if (Math.abs(ux) > Math.abs(uy)) valAnchor = ux > 0 ? 'start' : 'end'

    faceDims.push({
      x1, y1, x2, y2,
      valX, valY, valAnchor,
      faceLblX, faceLblY,
      label: `${cov}`,
      faceName: faceName(surface, i),
      color: fcol(`${surface}:${voidIndex}:${i}`),
    })
  }

  const addRing = (poly: Point[], surface: 'outer' | 'inner', voidIndex = 0) => {
    for (let i = 0; i < poly.length; i++) addFace(poly, surface, i, voidIndex)
  }

  const outerCoverVal = cover.uniformOuterCover ?? outerCover(cover, 'bottom')
  const innerCoverVal = isHollowCircle
    ? (cover.uniformInnerCover ?? innerCover(cover, 'bottom'))
    : 0

  if (isCircle) {
    // Representative radial ticked leader at the bottom of the circle.
    const addCircDim = (
      r0: number,
      cov: number,
      inward: boolean,
      name: string,
      col: string,
    ) => {
      const faceY = inward ? cy + r0 : cy - r0
      const dir = inward ? -1 : +1
      const endY = faceY + dir * cov
      const x1 = X(cx)
      const y1 = Y(faceY)
      const x2 = X(cx)
      const y2 = Y(endY)
      const fY = faceY - dir * (16 / scale)
      faceDims.push({
        x1, y1, x2, y2,
        valX: x2 + 8, valY: y2 + 3, valAnchor: 'start',
        faceLblX: X(cx), faceLblY: Y(fY) + 3,
        label: `${cov}`,
        faceName: name,
        color: col,
      })
    }
    addCircDim(
      R, outerCoverVal, true, 'Bottom',
      audit.nShort === 0 ? 'var(--color-ink-2)' : 'var(--color-bad)',
    )
    if (isHollowCircle) {
      addCircDim(
        Ri, innerCoverVal, false, 'Inner bottom',
        audit.bars.some((s) => s.surface === 'inner' && !s.ok) ? 'var(--color-bad)' : 'var(--color-ink-2)',
      )
    }
  } else {
    addRing(bnd, 'outer', 0)
    voids.forEach((vp, vi) => addRing(vp, 'inner', vi))
  }

  const RS = R * scale
  const RiS = Ri * scale
  const cxS = X(cx)
  const cyS = Y(cy)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto block w-full max-w-[360px]"
      role="img"
      aria-label="Advanced cover figure: concrete section outline with dashed clear-cover guides"
    >
      {/* Concrete outline */}
      {isCircle ? (
        <circle cx={cxS} cy={cyS} r={RS} className="fill-concrete stroke-ink" strokeWidth="1.6" />
      ) : (
        <path d={polyPath(bnd)} className="fill-concrete stroke-ink" strokeWidth="1.6" strokeLinejoin="round" />
      )}
      {/* Voids */}
      {isHollowCircle && (
        <circle cx={cxS} cy={cyS} r={RiS} className="fill-paper stroke-ink" strokeWidth="1.2" />
      )}
      {!isCircle && voids.map((vp, i) => (
        <path
          key={`v-${i}`}
          d={polyPath(vp)}
          className="fill-paper stroke-ink"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ))}

      {/* Dashed clear-cover offset guides */}
      {isCircle ? (
        <>
          <circle
            cx={cxS}
            cy={cyS}
            r={Math.max(1, RS - outerCoverVal * scale)}
            stroke="var(--color-ink-2)"
            strokeWidth="1"
            strokeDasharray="4 3"
            fill="none"
          />
          {isHollowCircle && Ri > 0 && (
            <circle
              cx={cxS}
              cy={cyS}
              r={Math.max(1, RiS + innerCoverVal * scale)}
              stroke="var(--color-ink-2)"
              strokeWidth="1"
              strokeDasharray="4 3"
              fill="none"
            />
          )}
        </>
      ) : (
        <>
          <path
            d={offsetPath(bnd, outerCoverVal, true)}
            stroke="var(--color-ink-2)"
            strokeWidth="1"
            strokeDasharray="4 3"
            fill="none"
            strokeLinejoin="round"
          />
          {voids.map((vp, vi) => {
            const innerCov = getCoverForFace(cover, 'inner', 0, vi, geometry)
            return (
              <path
                key={`vo-${vi}`}
                d={offsetPath(vp, innerCov, false)}
                stroke="var(--color-ink-2)"
                strokeWidth="1"
                strokeDasharray="4 3"
                fill="none"
                strokeLinejoin="round"
              />
            )
          })}
        </>
      )}

      {/* Per-face leaders, value labels, and face names */}
      {faceDims.map((d, idx) => {
        const tk = 3
        const dx = d.x2 - d.x1
        const dy = d.y2 - d.y1
        const dl = Math.hypot(dx, dy) || 1
        const ux = dx / dl
        const uy = dy / dl
        const px = -uy * tk
        const py = ux * tk
        return (
          <g key={`fd-${idx}`}>
            <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke={d.color} strokeWidth="0.9" />
            <line x1={d.x1 - px} y1={d.y1 - py} x2={d.x1 + px} y2={d.y1 + py} stroke={d.color} strokeWidth="1.1" />
            <line x1={d.x2 - px} y1={d.y2 - py} x2={d.x2 + px} y2={d.y2 + py} stroke={d.color} strokeWidth="1.1" />
            <circle cx={d.x1} cy={d.y1} r="1.2" fill={d.color} />
            <text
              x={d.valX}
              y={d.valY}
              fontSize="9"
              fontWeight="700"
              textAnchor={d.valAnchor}
              fill={d.color}
            >
              {d.label}
              <tspan fontSize="7" fill="var(--color-ink-3)" dx="1"> mm</tspan>
            </text>
            <text
              x={d.faceLblX}
              y={d.faceLblY}
              fontSize="7.5"
              fontWeight="700"
              textAnchor="middle"
              fill="var(--color-ink-2)"
              style={{ textTransform: 'uppercase', letterSpacing: '0.4px' }}
            >
              {d.faceName}
            </text>
          </g>
        )
      })}

      <text x={8} y={H - 6} fontSize="7.5" fill="var(--color-ink-3)">
        {isCircle
          ? `⌀${(R * 2).toFixed(0)} mm${isHollowCircle ? ` · void ⌀${(Ri * 2).toFixed(0)} mm` : ''} · dashed = nominal clear cover (mm)`
          : `${bnd.length} outer face${bnd.length === 1 ? '' : 's'}${voids.length ? ` · ${voids.length} void${voids.length === 1 ? '' : 's'}` : ''} · dashed = nominal clear cover (mm)`}
      </text>
    </svg>
  )
}
