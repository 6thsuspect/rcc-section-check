import { useState } from 'react'
import { generateSection } from '../engine/sections'
import {
  COVER_FACES,
  FACE_HINTS,
  FACE_LABELS,
  hasInnerOverrides,
  innerCover,
  isUniformCover,
  outerCover,
  radialCover,
  setAllOuterCover,
  setInnerCover,
  setOuterCover,
  snapBarsToCover,
  type CoverAudit,
  type CoverFace,
  type CoverSpec,
} from '../engine/cover'
import type { AppState } from '../state'
import { Card, InfoTooltip, NumField } from './ui'

const btnCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-edge-strong rounded px-2 py-1 text-ink-2 hover:border-accent hover:text-accent'
const btnPrimaryCls =
  'font-display text-[11px] font-semibold tracking-wide uppercase border border-accent bg-accent-wash text-accent-strong rounded px-2.5 py-1 hover:bg-accent/20'

/** Stable fingerprint of a bar list — used to detect an out-of-date layout. */
function barsKey(bars: AppState['bars']): string {
  return bars.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.dia}`).join('|')
}

/**
 * Nominal clear cover, entered **independently for each concrete face** (and, for
 * hollow sections, for the void faces). Cover is measured to the outside of the
 * links; generated bar layouts set each bar back from the face it lies against by
 * cover + ⌀tie + ⌀bar/2, so the achieved cover equals the value entered here.
 */
export function ClearCoverPanel({
  state,
  update,
  audit,
}: {
  state: AppState
  update: (patch: Partial<AppState>) => void
  audit: CoverAudit
}) {
  const cover = state.cover
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  // "linked" is derived from the data, with an opt-out so a user can break the
  // link while the faces still happen to be equal (no stale state on import).
  const [unlinked, setUnlinked] = useState(false)

  const hasVoid = state.geometry.voids.length > 0
  const circular = state.shapeClass === 'circ'
  const allEqual = isUniformCover(cover)
  const linked = allEqual && !unlinked

  const patchCover = (next: CoverSpec) => {
    setNote(null)
    update({ cover: next })
  }

  const setFace = (face: CoverFace, v: number) => {
    patchCover(linked ? setAllOuterCover(cover, v) : setOuterCover(cover, face, v))
  }

  const toggleLink = (on: boolean) => {
    setUnlinked(!on)
    // adopting the governing (largest) face value keeps every face compliant
    if (on) patchCover(setAllOuterCover(cover, Math.max(...COVER_FACES.map((f) => outerCover(cover, f)))))
  }

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

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <span>Clear cover — per face</span>
          <InfoTooltip
            content={
              <span>
                Nominal cover is measured from the concrete face to the outside of the <b>links</b>. Each face of the
                section carries its own value, so an exposed soffit or a marine face can be detailed thicker than the
                rest. Hollow sections can also set the four <b>void</b> faces separately; any value left blank inherits
                the matching outer face.
              </span>
            }
          />
        </span>
      }
      action={
        <label className="flex items-center gap-1.5 text-[11px] text-ink-2 cursor-pointer select-none">
          <input type="checkbox" className="accent-accent" checked={linked} onChange={(e) => toggleLink(e.target.checked)} />
          <span className="font-display font-semibold uppercase tracking-wide text-[10.5px]">Link faces</span>
        </label>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          {COVER_FACES.map((face) => (
            <div key={face} className="flex flex-col">
              <NumField
                label={`${FACE_LABELS[face]}${linked ? ' *' : ''}`}
                unit="mm"
                value={outerCover(cover, face)}
                min={0}
                step={5}
                onChange={(v) => setFace(face, v)}
              />
              <span className="text-[9.5px] text-ink-3 mt-0.5 leading-tight">{FACE_HINTS[face]}</span>
            </div>
          ))}
        </div>

        {linked && (
          <p className="text-[11px] text-ink-3 -mt-1">
            <b>*</b> Faces linked — editing any face sets all four to{' '}
            <b>{outerCover(cover, 'bottom')} mm</b>. Unlink to detail them independently.
          </p>
        )}
        {!allEqual && (
          <p className="text-[11px] text-ink-3 -mt-1">
            Independent faces: {COVER_FACES.map((f) => `${FACE_LABELS[f].toLowerCase()} ${outerCover(cover, f)}`).join(' / ')} mm.
            <button type="button" className="ml-1.5 text-accent hover:underline" onClick={() => toggleLink(true)}>
              make equal
            </button>
          </p>
        )}

        {circular && (
          <p className="text-[11px] text-warn2 bg-warn2/10 border border-warn2/30 rounded px-2 py-1 leading-snug">
            Circular ring: the section is radially symmetric, so the governing (largest) face cover —{' '}
            <b>{radialCover(cover)} mm</b> — is applied around the ring
            {hasInnerOverrides(cover) ? `, and ${radialCover(cover, 'inner')} mm at the void face` : ''}.
          </p>
        )}

        {/* Void / internal faces */}
        {hasVoid && (
          <div className="border border-edge rounded p-2 bg-panel/40">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="flex items-center gap-1.5 font-display font-semibold uppercase tracking-wide text-[10.5px] text-ink-2">
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
              {hasInnerOverrides(cover) && (
                <button
                  type="button"
                  className="text-[10.5px] text-ink-3 hover:text-accent uppercase font-display font-semibold tracking-wide"
                  onClick={() => patchCover({ ...cover, inner: { bottom: null, right: null, top: null, left: null } })}
                  title="Clear the void-face values — they then follow the outer faces"
                >
                  clear overrides
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
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
          </div>
        )}

        <CoverDiagram cover={cover} hasVoid={hasVoid} audit={audit} />

        {/* Achieved cover */}
        <div
          className={`text-[11.5px] rounded px-2 py-1.5 border ${
            minOk ? 'bg-ok/10 border-ok/40 text-ok' : 'bg-bad/10 border-bad/40 text-bad'
          }`}
        >
          <b className="font-display text-[10px] uppercase tracking-wider">{minOk ? 'Cover satisfied' : 'Cover short'}</b>{' '}
          {audit.minAchieved == null ? (
            <span>— no bars to audit.</span>
          ) : (
            <span className="tnum">
              minimum achieved {audit.minAchieved.toFixed(1)} mm
              {worst ? ` (bar ${worst.bar}, ${worst.surface === 'inner' ? 'void ' : ''}${FACE_LABELS[worst.face].toLowerCase()} face, needs ${worst.required.toFixed(1)} mm)` : ''}
              {audit.nShort > 0 ? ` — ${audit.nShort} bar(s) below their face requirement` : ''}
            </span>
          )}
        </div>

        {note && (
          <p className={`text-[11px] ${note.kind === 'ok' ? 'text-ok' : 'text-warn2'}`}>{note.text}</p>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-ink-3">
            {isCircularDef
              ? 'The circular reinforcement panel re-generates at this cover automatically.'
              : 'Bars are set back by cover + ⌀tie + ⌀bar/2 from the face they lie against.'}
          </span>
          <div className="flex items-center gap-2">
            {audit.nShort > 0 && state.bars.length > 0 && (
              <button type="button" className={btnCls} onClick={snapBars} title="Move bars inward until each face's cover is met">
                Snap bars to cover
              </button>
            )}
            {gen && (
              <button
                type="button"
                className={outOfSync ? btnPrimaryCls : btnCls}
                onClick={applyToLayout}
                title="Re-generate the predefined bar layout at the entered per-face cover"
              >
                {outOfSync ? 'Apply cover to layout' : 'Layout up to date'}
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
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-3 font-display tracking-wide">{FACE_LABELS[face]}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="w-full border border-edge rounded px-2 py-1 text-[13px] tnum bg-card focus:outline-none focus:border-accent"
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
        <span className="text-[11px] text-ink-3 shrink-0">mm</span>
      </span>
    </label>
  )
}

/**
 * Schematic of the four face covers (spacing is schematic, numbers are the real
 * ones).  Each face draws the cover line a bar's outer link would sit on, in the
 * colour of its audit result, plus the void lining lines when they are in use.
 */
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

  // outer cover lines (screen y grows downward: the section bottom is at the bottom)
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

  // void lining lines, offset from the void faces into the surrounding concrete
  const vx = box.x + box.w * 0.3
  const vy = box.y + box.h * 0.3
  const vw = box.w - 2 * box.w * 0.3
  const vh = box.h - 2 * box.h * 0.3
  if (hasVoid) {
    // void lining lines sit in the concrete *around* the hole, offset from the
    // void face by that face's cover (same convention as the audit and preview)
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[290px] mx-auto" role="img" aria-label="Per-face cover sketch">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} className="fill-concrete stroke-ink" strokeWidth="1.6" />
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
      <text x={box.x + box.w / 2} y={H - 4} fontSize="8" fill="var(--color-ink-3)" textAnchor="middle">
        nominal cover to the links, per face — schematic spacing
      </text>
    </svg>
  )
}
