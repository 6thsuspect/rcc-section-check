/**
 * Settings — the header's gear button opens this.
 *
 * The panel is presentational: it renders the settings it is handed and reports
 * every choice back through `onChange`, so the state lives in one place
 * (`src/useSettings.ts`) and this file stays testable without a browser.
 *
 * Sections follow the reference app's Settings dialog — Theme, the drafting
 * sheet (its canvas theme), Interface font size, Accent colour and a Preview —
 * with the controls built from this app's own components (`SubCard`,
 * `SegGroup`/`SegButton`, `Check`) so the panel reads as part of the app rather
 * than as a dialog bolted on. There is no canvas-theme colour editor here: this
 * app's figures draw their palette from the design tokens, so the figure colours
 * follow the theme instead of being chosen one by one.
 *
 * **Mouse-wheel increment** is the one section that is not about looks: it sets
 * how far one wheel notch moves a numeric field, everywhere in the app. The
 * change takes effect on the very next notch of every field, because the value
 * is published to the live store in `src/settings.ts` as it is applied — the
 * fields' wheel listeners are native ones and read it when the wheel turns.
 */
import { useEffect, useState } from 'react'
import {
  ACCENT_COLORS,
  FONT_SIZES,
  SHEET_THEMES,
  WHEEL_STEP_MAX,
  WHEEL_STEP_MIN,
  WHEEL_STEPS,
  normalizeWheelStep,
  type AppSettings,
} from '../settings'
import {
  Check,
  fieldBoxCls,
  fieldCls,
  Icon,
  SegButton,
  SegGroup,
  SubCard,
  btnPrimaryCls,
  noteSmCls,
  useWheelStep,
} from './ui'
import { Modal } from './Modal'

/**
 * The custom increment box beside the presets.
 *
 * What is being typed is held as a draft, so a half-typed value ("0.", "") does
 * not snap the box back to the old number mid-keystroke — and the wheel, which
 * reads the applied setting, keeps stepping by the last good one until the
 * entry is a number. Anything outside the bounds is brought to the nearest end,
 * and the box shows the value that was actually stored as soon as it is left.
 */
function CustomWheelStep({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const wheelInput = useWheelStep<HTMLInputElement>({
    value,
    min: WHEEL_STEP_MIN,
    onChange: (v) => onChange(v),
  })
  // a preset click (or a wheel notch) writes the setting: show what it wrote
  useEffect(() => setDraft(String(value)), [value])

  return (
    <label
      className={`${fieldBoxCls} min-w-[7.5rem] flex-1`}
      title={`Type any increment from ${WHEEL_STEP_MIN} to ${WHEEL_STEP_MAX}, or scroll the wheel over the field to step it by ${value}.`}
    >
      <input
        ref={wheelInput}
        type="number"
        className={fieldCls}
        value={draft}
        min={WHEEL_STEP_MIN}
        max={WHEEL_STEP_MAX}
        step={0.1}
        aria-label="Mouse-wheel increment per notch"
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          const v = parseFloat(text)
          // only a positive number is committed; a half-typed entry waits
          if (Number.isFinite(v) && v > 0) onChange(normalizeWheelStep(v))
        }}
        onBlur={() => setDraft(String(value))}
      />
      <span className="shrink-0 pr-2 text-[0.65625rem] leading-none text-ink-3" aria-hidden="true">
        per notch
      </span>
    </label>
  )
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
}) {
  const accent = ACCENT_COLORS.find((c) => c.hex === settings.accentColor)

  return (
    <Modal
      title="Settings"
      icon={<Icon name="gear" size={13} className="text-ink-2" />}
      onClose={onClose}
      footer={
        <button type="button" className={btnPrimaryCls} onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* -------------------------------------------------- theme */}
        <SubCard title="Theme">
          <SegGroup gap="gap-2" aria-label="Theme">
            <SegButton
              active={settings.theme === 'dark'}
              onClick={() => onChange({ theme: 'dark' })}
              title="Dark interface"
            >
              <Icon name="moon" size={12} />
              Dark
            </SegButton>
            <SegButton
              active={settings.theme === 'light'}
              onClick={() => onChange({ theme: 'light' })}
              title="Light interface"
            >
              <Icon name="sun" size={12} />
              Light
            </SegButton>
          </SegGroup>
          <p className={`${noteSmCls} mt-2`}>
            Dark re-lights every panel, table and figure — the printed report stays on white paper.
          </p>
        </SubCard>

        {/* -------------------------------------------------- drafting sheet */}
        <SubCard title="Drafting sheet">
          <div className="grid grid-cols-2 gap-2">
            {SHEET_THEMES.map((sheet) => (
              <SegButton
                key={sheet.id}
                active={settings.sheet === sheet.id}
                onClick={() => onChange({ sheet: sheet.id })}
                title={sheet.note}
                className="justify-start"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-[3px] border border-edge-strong"
                  style={{ background: sheet.swatch }}
                />
                {sheet.label}
              </SegButton>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <Check
              checked={settings.grid}
              onChange={(v) => onChange({ grid: v })}
              label="Drafting grid"
              title="The faint grid drawn on the canvas behind the panels"
            />
            <p className={`${noteSmCls} max-w-[19rem]`}>
              {settings.theme === 'dark' && settings.sheet !== 'paper'
                ? 'The sheet tints are the light theme’s canvas; the dark theme draws its own sheet.'
                : 'The tint of the canvas and of the grid drawn on it.'}
            </p>
          </div>
        </SubCard>

        {/* -------------------------------------------------- interface size */}
        <SubCard title="Interface font size">
          <SegGroup gap="gap-2" aria-label="Interface font size">
            {FONT_SIZES.map((size) => (
              <SegButton
                key={size.id}
                active={settings.fontSize === size.id}
                onClick={() => onChange({ fontSize: size.id })}
                title={`${size.label} — ${size.px} px`}
              >
                {size.label}
              </SegButton>
            ))}
          </SegGroup>
          <p className={`${noteSmCls} mt-2`}>
            Scales the whole interface — type, spacing and controls. Medium is the size the app has
            always used; the figures keep their own scale.
          </p>
        </SubCard>

        {/* -------------------------------------------------- accent */}
        <SubCard title="Accent colour">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => onChange({ accentColor: c.hex })}
                aria-label={`Accent colour ${c.name}`}
                aria-pressed={settings.accentColor === c.hex}
                title={`${c.name} — ${c.hex}`}
                className="h-8 w-8 rounded-lg border-2 transition-transform duration-150 ease-ui hover:scale-110"
                style={{
                  background: c.hex,
                  borderColor: settings.accentColor === c.hex ? 'var(--color-ink)' : 'transparent',
                }}
              />
            ))}
          </div>
          <p className={`${noteSmCls} mt-2`}>
            {accent ? `Current accent: ${accent.name} (${accent.hex}).` : `Current accent: ${settings.accentColor}.`}
          </p>
        </SubCard>

        {/* -------------------------------------------------- mouse wheel */}
        <SubCard title="Mouse-wheel increment">
          <div className="flex flex-wrap items-center gap-2">
            <SegGroup gap="gap-1.5" aria-label="Mouse-wheel increment">
              {WHEEL_STEPS.map((s) => (
                <SegButton
                  key={s.value}
                  active={settings.wheelStep === s.value}
                  onClick={() => onChange({ wheelStep: s.value })}
                  title={`One wheel notch moves a field by ${s.label}`}
                >
                  {s.label}
                </SegButton>
              ))}
            </SegGroup>
            <CustomWheelStep value={settings.wheelStep} onChange={(v) => onChange({ wheelStep: v })} />
          </div>
          <p className={`${noteSmCls} mt-2`}>
            One wheel notch over a numeric field moves it by this much, in the field's own unit — millimetres for a
            dimension, kN for a load. It applies to every numeric field in the app as you scroll, including the
            bundle and triple-bar spacings in the circular reinforcement panel, and it takes effect at once: no
            reload, no re-entry. The spinner arrows keep the field's own step. Default <b>1</b>.
          </p>
        </SubCard>

        {/* -------------------------------------------------- preview */}
        <div className="rounded-lg border border-edge bg-panel/55 p-3">
          <div className="mb-2 font-display text-[0.625rem] font-bold uppercase tracking-[0.07em] text-ink-3">
            Preview
          </div>
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 shrink-0 rounded-lg border border-edge"
              style={{ background: 'var(--color-accent)' }}
            />
            <div className="min-w-0">
              <div className="font-display font-bold leading-tight text-ink">Sample heading</div>
              <div className="leading-snug text-ink-3">Secondary text at the chosen interface size</div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* a span, not a button: nothing here should look clickable and do
                nothing — it is a sample of the primary-button style */}
            <span className={btnPrimaryCls} aria-hidden="true">
              <Icon name="report" size={13} />
              Action
            </span>
            <span className="rounded-field border border-edge bg-card px-2 py-1 text-ink-2">Panel</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
