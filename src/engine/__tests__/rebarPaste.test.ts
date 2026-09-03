import { describe, expect, it } from 'vitest'
import { parseRebarPaste } from '../rebarPaste'

describe('parseRebarPaste', () => {
  it('acceptance: three pasted bars keep exact x, y, dia', () => {
    const r = parseRebarPaste('-100,200,16\n0,200,20\n100,200,16\n')
    expect(r.errors).toEqual([])
    expect(r.bars).toEqual([
      { x: -100, y: 200, dia: 16 },
      { x: 0, y: 200, dia: 20 },
      { x: 100, y: 200, dia: 16 },
    ])
  })

  it('accepts a bar at the origin', () => {
    const r = parseRebarPaste('0,0,20')
    expect(r.errors).toEqual([])
    expect(r.bars).toEqual([{ x: 0, y: 0, dia: 20 }])
  })

  it('accepts negative coordinates', () => {
    const r = parseRebarPaste('-250,-150,25')
    expect(r.errors).toEqual([])
    expect(r.bars).toEqual([{ x: -250, y: -150, dia: 25 }])
  })

  it('accepts decimal coordinates', () => {
    const r = parseRebarPaste('100.50,250.75,16')
    expect(r.errors).toEqual([])
    expect(r.bars).toEqual([{ x: 100.5, y: 250.75, dia: 16 }])
  })

  it('accepts many bars at once, incl. CRLF and whitespace padding', () => {
    const r = parseRebarPaste('-250,300,20\r\n 0 , 300 , 20 \r\n250,300,20\n-250,100,16')
    expect(r.errors).toEqual([])
    expect(r.bars).toHaveLength(4)
    expect(r.bars[1]).toEqual({ x: 0, y: 300, dia: 20 })
  })

  it('ignores empty lines but reports physical line numbers', () => {
    const r = parseRebarPaste('10,10,16\n\n\nbadline')
    expect(r.bars).toEqual([{ x: 10, y: 10, dia: 16 }])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(4)
  })

  it('rejects lines with a wrong number of comma-separated values', () => {
    const r = parseRebarPaste('10,20\n10,20,16,5\n10')
    expect(r.bars).toEqual([])
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3])
    for (const e of r.errors) expect(e.message).toMatch(/invalid format/i)
  })

  it('rejects non-numeric values with specific messages', () => {
    expect(parseRebarPaste('a,1,16').errors[0]).toMatchObject({ line: 1, message: 'X must be numeric' })
    expect(parseRebarPaste('1,b,16').errors[0]).toMatchObject({ line: 1, message: 'Y must be numeric' })
    expect(parseRebarPaste('1,2,x').errors[0]).toMatchObject({ line: 1, message: 'Diameter must be numeric' })
    expect(parseRebarPaste('10,,16').errors[0]).toMatchObject({ line: 1, message: 'Y must be numeric' })
  })

  it('rejects zero and negative diameters', () => {
    expect(parseRebarPaste('0,0,0').errors[0].message).toBe('Diameter must be greater than zero')
    expect(parseRebarPaste('0,0,-5').errors[0].message).toBe('Diameter must be greater than zero')
  })

  it('keeps valid bars while reporting invalid lines', () => {
    const r = parseRebarPaste('10,10,16\nnonsense\n20,20,20')
    expect(r.bars).toEqual([
      { x: 10, y: 10, dia: 16 },
      { x: 20, y: 20, dia: 20 },
    ])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(2)
    expect(r.count).toBe(3)
  })

  it('returns an empty result for empty input', () => {
    const r = parseRebarPaste('  \n\n')
    expect(r.bars).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.count).toBe(0)
  })

  it('accepts tab-separated values pasted directly from Excel', () => {
    const r = parseRebarPaste('-250\t300\t20\n0\t300\t20\n250\t300\t25')
    expect(r.errors).toEqual([])
    expect(r.bars).toEqual([
      { x: -250, y: 300, dia: 20 },
      { x: 0, y: 300, dia: 20 },
      { x: 250, y: 300, dia: 25 },
    ])
  })
})
