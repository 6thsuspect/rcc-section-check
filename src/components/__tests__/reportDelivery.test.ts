/**
 * Report delivery guard.
 *
 * "PDF report" has to work wherever the app is running: a window of its own is
 * refused in an embedded preview (and refused silently — `window.open` just
 * returns null), so the delivery falls back to a hidden frame in the page and,
 * in the last resort, to the file itself. It must also never print a document
 * that has not loaded — a fresh window has already loaded `about:blank` — and
 * must not let one stuck route hold up the next. These tests drive that routing
 * and timing against a stand-in host, with no DOM and no browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  READY_TIMEOUT_MS,
  REPORT_FILE_NAME,
  SETTLE_MS,
  deliverReport,
  type PrintTarget,
  type ReportHost,
} from '../../reportDelivery'

/** A stand-in print target that records what the delivery does to it. */
function fakeTarget() {
  const log: string[] = []
  let loaded = false
  let onLoad: (() => void) | null = null
  const target: PrintTarget = {
    onLoad: (run) => {
      onLoad = run
    },
    load: (url) => log.push(`load ${url}`),
    hasReport: () => loaded,
    print: () => log.push('print'),
    dispose: () => log.push('dispose'),
  }
  return {
    target,
    log,
    /** The report document finishes loading. */
    arrive: () => {
      loaded = true
      onLoad?.()
    },
    /** A document loads that is not the report (a window's first `about:blank`). */
    loadSomethingElse: () => onLoad?.(),
  }
}

/** A stand-in page: which of its routes are available, and what it was asked to do. */
function fakeHost(routes: { window?: ReturnType<typeof fakeTarget>; frame?: ReturnType<typeof fakeTarget> }) {
  const log: string[] = []
  const host: ReportHost = {
    fileUrl: (html) => {
      log.push(`fileUrl ${html.length}`)
      return 'blob:report'
    },
    releaseUrl: (url) => log.push(`release ${url}`),
    newWindow: () => {
      log.push('newWindow')
      return routes.window?.target ?? null
    },
    newFrame: () => {
      log.push('newFrame')
      return routes.frame?.target ?? null
    },
    download: (url, fileName) => log.push(`download ${fileName} from ${url}`),
    after: (ms, run) => void setTimeout(run, ms),
  }
  return { host, log }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('report delivery', () => {
  it('prints in a window of its own when the browser opens one', async () => {
    const win = fakeTarget()
    const frame = fakeTarget()
    const { host, log } = fakeHost({ window: win, frame })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    // the report is loaded first, and nothing is printed before it has arrived
    expect(win.log).toEqual(['load blob:report'])

    win.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(win.log).toEqual(['load blob:report', 'print'])
    // the frame route was never touched, and the URL is dropped once used
    expect(log).not.toContain('newFrame')
    expect(log).toContain('release blob:report')
    await expect(done).resolves.toBe('window')
  })

  it('ignores a document that is not the report', async () => {
    const win = fakeTarget()
    const { host } = fakeHost({ window: win })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    // the window's first `about:blank` finishes loading — not the report
    win.loadSomethingElse()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(win.log).toEqual(['load blob:report'])
    await expect(Promise.race([done, Promise.resolve('pending')])).resolves.toBe('pending')

    win.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(win.log).toEqual(['load blob:report', 'print'])
    await expect(done).resolves.toBe('window')
  })

  it('prints from a hidden frame when the browser refuses a window', async () => {
    const frame = fakeTarget()
    const { host, log } = fakeHost({ frame })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    // a refused window is not an error and not a dead end
    expect(log).toContain('newWindow')
    expect(log).toContain('newFrame')
    frame.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(frame.log).toEqual(['load blob:report', 'print'])
    expect(frame.log).not.toContain('dispose') // the dialog may still be reading it
    await expect(done).resolves.toBe('frame')
  })

  it('moves on from a window that never loads its report', async () => {
    const win = fakeTarget()
    const frame = fakeTarget()
    const { host, log } = fakeHost({ window: win, frame })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    // the window swallowed the report: it is closed and the frame takes over
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS)
    expect(win.log).toEqual(['load blob:report', 'dispose'])
    expect(log).toContain('newFrame')
    frame.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(frame.log).toEqual(['load blob:report', 'print'])
    await expect(done).resolves.toBe('frame')
  })

  it('moves on when the print dialog itself is refused', async () => {
    const win = fakeTarget()
    win.target.print = () => {
      throw new Error('sandboxed')
    }
    const frame = fakeTarget()
    const { host } = fakeHost({ window: win, frame })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    win.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    // the window was no use, so the frame that can print takes the job
    expect(win.log).toContain('dispose')
    frame.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(frame.log).toEqual(['load blob:report', 'print'])
    await expect(done).resolves.toBe('frame')
  })

  it('hands the report over as a file when printing is blocked outright', async () => {
    const { host, log } = fakeHost({})
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toContain(`download ${REPORT_FILE_NAME} from blob:report`)
    await expect(done).resolves.toBe('download')
  })

  it('gives up on a target that refuses the navigation', async () => {
    // a sandboxed window we cannot reach from this page throws on navigation
    const win = fakeTarget()
    win.target.load = () => {
      throw new Error('cross-origin')
    }
    const frame = fakeTarget()
    const { host } = fakeHost({ window: win, frame })
    const done = deliverReport('<html>report</html>', host)
    await vi.advanceTimersByTimeAsync(0)
    expect(win.log).toContain('dispose')
    frame.arrive()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await expect(done).resolves.toBe('frame')
  })
})
