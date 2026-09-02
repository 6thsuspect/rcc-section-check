/**
 * Parser/validator for the "Paste Reinforcement" feature.
 *
 * Accepts pasted lines of `x,y,dia` (one bar per line) in the section's
 * existing user coordinate system (origin at 0,0), and converts them into
 * plain `Rebar` objects identical to bars entered via the rebar table.
 *
 * The text is never modified: surrounding whitespace around tokens is
 * tolerated, values are parsed strictly, and any invalid line is reported
 * with its physical (1-based) line number.
 */
import type { Rebar } from './types'

export interface RebarPasteError {
  /** Physical 1-based line number in the pasted text. */
  line: number
  message: string
}

export interface RebarPasteResult {
  /** Bars parsed from valid lines, in pasted order. Invalid lines never produce bars. */
  bars: Rebar[]
  /** One error per invalid non-empty line. */
  errors: RebarPasteError[]
  /** Number of non-empty lines examined (= bars.length + errors.length). */
  count: number
}

/** Strict numeric parse: rejects empty tokens and non-finite results. */
const toNumber = (token: string): number | null => {
  if (token === '') return null
  const v = Number(token)
  return Number.isFinite(v) ? v : null
}

export function parseRebarPaste(text: string): RebarPasteResult {
  const bars: Rebar[] = []
  const errors: RebarPasteError[] = []
  const lines = text.split(/\r\n|\r|\n/)

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const trimmed = lines[i].trim()
    if (trimmed === '') continue // empty lines are ignored (line numbers stay physical)

    const parts = trimmed.split(',').map((p) => p.trim())
    if (parts.length !== 3) {
      errors.push({ line: lineNo, message: 'Invalid format — expected exactly 3 comma-separated values (x,y,dia)' })
      continue
    }

    const x = toNumber(parts[0])
    if (x === null) {
      errors.push({ line: lineNo, message: 'X must be numeric' })
      continue
    }
    const y = toNumber(parts[1])
    if (y === null) {
      errors.push({ line: lineNo, message: 'Y must be numeric' })
      continue
    }
    const dia = toNumber(parts[2])
    if (dia === null) {
      errors.push({ line: lineNo, message: 'Diameter must be numeric' })
      continue
    }
    if (dia <= 0) {
      errors.push({ line: lineNo, message: 'Diameter must be greater than zero' })
      continue
    }

    bars.push({ x, y, dia })
  }

  return { bars, errors, count: bars.length + errors.length }
}
