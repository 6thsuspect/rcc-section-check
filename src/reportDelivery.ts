/**
 * Delivery of the calculation report to a print dialog.
 *
 * The report is one self-contained HTML document (`src/report.ts` builds it), and
 * there is more than one way to get it printed — a print window is not always
 * available, and when it is refused the refusal is silent: `window.open` simply
 * returns null, or a window whose document never arrives. So the report is
 * delivered by the **first route that works**:
 *
 *   1. **a window of its own** — the nicest result (a document of its own, the
 *      browser's normal "Save as PDF"), but it needs popups to be allowed;
 *   2. **a hidden frame in this page** — needs no permission at all, which is
 *      what makes the button work inside an embedded preview or a sandboxed
 *      frame, where a popup is never granted;
 *   3. **the file itself, downloaded** — when printing is blocked outright the
 *      user still gets the report, to open and print from their own browser.
 *
 * A route counts as working only when the report document has actually loaded in
 * it (a fresh window loads `about:blank` first, and a route that never loads must
 * not hold up the next one), and the print only happens once the document has had
 * a moment to lay out. That routing and timing lives here, away from the DOM, so
 * it can be unit-tested with a stand-in host (`browserPrintHost` at the bottom is
 * the only part that touches the page).
 */

/** How the report reached the user, so the caller can say what happened. */
export type ReportDelivery = 'window' | 'frame' | 'download'

/** Name of the downloaded report; matches the printed document's own title. */
export const REPORT_FILE_NAME = 'RCC-Section-Check-Report.html'

/** A route that has not loaded the report by now is given up on. */
export const READY_TIMEOUT_MS = 4000
/** How long the loaded document gets to lay out before the dialog reads it. */
export const SETTLE_MS = 250

/** The part of a print target the delivery drives. */
export interface PrintTarget {
  /** Register the ready callback — before `load`. */
  onLoad(run: () => void): void
  /** Begin loading the report into this target. */
  load(url: string): void
  /** Is the loaded document the report? A window's first document is `about:blank`. */
  hasReport(): boolean
  /** Bring the target forward and print it. */
  print(): void
  /** Leave nothing behind (close the window / remove the frame). */
  dispose(): void
}

/** What the delivery needs from the page around it. */
export interface ReportHost {
  /** A URL the report can be loaded from. */
  fileUrl(html: string): string
  /** Drop a URL once its document has been used. */
  releaseUrl(url: string): void
  /** A window of its own; null when the browser (or the frame the app runs in) refuses. */
  newWindow(): PrintTarget | null
  /** A hidden frame in this page; null when none can be created. */
  newFrame(): PrintTarget | null
  /** Hand the file to the browser's downloader. */
  download(url: string, fileName: string): void
  /** Run after `ms` (also used to let the printed document settle). */
  after(ms: number, run: () => void): void
}

/**
 * Print `html`, by whichever route will have it. Resolves with the route that
 * worked, so the caller can tell the user when only the file was available.
 */
export async function deliverReport(html: string, host: ReportHost = browserPrintHost): Promise<ReportDelivery> {
  const url = host.fileUrl(html)
  if (await printVia(host, url, host.newWindow())) return 'window'
  if (await printVia(host, url, host.newFrame())) return 'frame'
  host.download(url, REPORT_FILE_NAME)
  return 'download'
}

/**
 * Load the report into `target` and print it. Resolves `false` — and takes the
 * target away again — when that route never loaded the report, so the caller can
 * move on to the next one.
 */
function printVia(host: ReportHost, url: string, target: PrintTarget | null): Promise<boolean> {
  if (!target) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let settled = false
    /** This route is no good: leave nothing behind and let the next one try. */
    const fail = () => {
      if (settled) return
      settled = true
      target.dispose()
      resolve(false)
    }
    const print = () => {
      if (settled) return
      settled = true
      // let the document lay out (SVG figures, fonts) before the dialog reads it
      host.after(SETTLE_MS, () => {
        try {
          target.print()
        } catch {
          target.dispose()
          resolve(false)
          return
        }
        host.releaseUrl(url)
        resolve(true)
      })
    }
    try {
      target.onLoad(() => {
        // A window loads twice: `about:blank` first, then the report. Only the
        // report counts — anything else leaves the route waiting (the timer
        // below decides when to give up on it).
        if (target.hasReport()) print()
      })
      target.load(url)
    } catch {
      // the target refused us (a sandboxed window we cannot even reach)
      fail()
      return
    }
    host.after(READY_TIMEOUT_MS, () => (target.hasReport() ? print() : fail()))
  })
}

/* ------------------------------ the live page ------------------------------ */

/** Marker the report document carries in its `<body>`, so a loaded document can
 *  be told apart from a blank one. */
export const REPORT_MARKER = 'data-report'

/** Is `doc` the loaded report? False for `about:blank` or an unreachable document. */
function isReport(doc: Document | null | undefined): boolean {
  try {
    return doc?.querySelector(`[${REPORT_MARKER}]`) != null
  } catch {
    // cross-origin (or sandboxed with an opaque origin): not ours to print
    return false
  }
}

/** The frame left behind by a previous export, removed when the next one starts. */
let lastFrame: HTMLIFrameElement | null = null

/** A window of its own, opened blank so the report can be watched while it loads. */
function windowTarget(win: Window): PrintTarget {
  return {
    onLoad: (run) => win.addEventListener('load', run),
    // `replace` keeps the blank window out of the back history
    load: (url) => win.location.replace(url),
    hasReport: () => isReport(win.document),
    print: () => {
      win.focus()
      win.print()
    },
    dispose: () => {
      try {
        win.close()
      } catch {
        // a window we no longer control: nothing to do about it
      }
    },
  }
}

/**
 * A 0 × 0 frame at the corner of the page, carrying the report. It is never
 * seen; printing it opens the browser's dialog on the report alone. (Not
 * `display: none`, which would leave it without a layout to print.)
 */
function frameTarget(): PrintTarget | null {
  if (!document.body) return null
  lastFrame?.remove()
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.title = 'Calculation report (print copy)'
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  lastFrame = frame
  return {
    onLoad: (run) => frame.addEventListener('load', run),
    load: (url) => {
      frame.src = url
    },
    hasReport: () => isReport(frame.contentDocument),
    print: () => {
      const win = frame.contentWindow
      if (!win) return
      win.focus()
      win.print()
    },
    // Kept until the next export: the dialog may still be reading it
    dispose: () => frame.remove(),
  }
}

/** The delivery against the live page. */
export const browserPrintHost: ReportHost = {
  fileUrl: (html) => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })),
  // the loaded document holds its own copy, so the URL is only needed until then
  releaseUrl: (url) => window.setTimeout(() => URL.revokeObjectURL(url), 1000),
  newWindow: () => {
    let win: Window | null = null
    try {
      win = window.open('about:blank', '_blank')
    } catch {
      win = null
    }
    return win ? windowTarget(win) : null
  },
  newFrame: frameTarget,
  download: (url, fileName) => {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    // the download reads the URL for a moment after the click
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },
  after: (ms, run) => window.setTimeout(run, ms),
}
