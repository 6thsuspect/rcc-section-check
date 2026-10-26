/**
 * The app's appearance state: read once, applied to the document element, and
 * written back whenever it changes.
 *
 * Two details worth knowing:
 *  - the state is initialised from storage (lazily, on first render) rather than
 *    loaded in an effect; this app renders in the browser only, so there is no
 *    hydration mismatch to dodge and no frame where the defaults are on screen
 *    before the stored values arrive. `src/main.tsx` applies the stored settings
 *    even earlier — before React renders — so a dark theme never flashes light;
 *  - writes go through the same code path as the initial read, so a storage that
 *    refuses to be written (private mode) leaves the app working.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  applySettings,
  readSettings,
  writeSettings,
  type AppSettings,
} from './settings'

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => readSettings())

  // Every change is pushed onto the document element in the same commit, so the
  // interface and the token overrides can never disagree.
  useEffect(() => {
    applySettings(settings, document.documentElement)
  }, [settings])

  useEffect(() => {
    writeSettings(settings)
  }, [settings])

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  return { settings, update }
}
