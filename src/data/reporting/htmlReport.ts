// Shared utility for building self-contained Arabic RTL HTML reports

/**
 * Opens `html` in a new tab via `document.write`, falling back to a file
 * download if the popup is blocked. Deliberately does NOT use
 * `window.open(url, "_blank", "noopener")` on a blob: URL — per spec,
 * passing "noopener" makes `window.open` always return `null` even when the
 * tab opens successfully, so that pattern can never detect success, always
 * falls through to the download fallback, and revokes the blob URL
 * synchronously while the popup is still navigating to it (a real source of
 * a blank/broken opened tab). `window.open("", "_blank")` (no feature
 * string) returns a real handle instead, letting us sever `opener` directly
 * and write the document in, with no blob URL and no revoke race at all —
 * same pattern already proven in
 * Sidebar/Tabs/Population/reporting/reportExporter.ts (2026-07-21).
 */
/**
 * Opens the same blank same-origin window `openOrDownload` would, but WITHOUT
 * writing anything into it yet. Split out (P3-7) so callers whose HTML build
 * is chunked with `await yieldToMain()` breaks (main-thread-friendly report
 * builders) can still open the tab synchronously, inside the original click
 * handler and before the first `await` — once an `await` has run, the click's
 * transient user-activation may have lapsed and `window.open` can be silently
 * popup-blocked. Pair with `writeReportToWindow` once the (now async) HTML is
 * ready. Callers that build HTML synchronously should keep using
 * `openOrDownload`, unchanged.
 */
export function openReportWindow(): Window | null {
  const reportWindow = window.open("", "_blank");
  if (reportWindow) {
    try {
      reportWindow.opener = null;
    } catch {
      // Ignore; document.open()/write() in writeReportToWindow still work.
    }
  }
  return reportWindow;
}

/**
 * Writes `html` into a window previously returned by `openReportWindow`,
 * falling back to a file download when the window is null or writing fails —
 * identical fallback behavior to `openOrDownload`.
 */
export function writeReportToWindow(reportWindow: Window | null, html: string, filename: string): void {
  if (reportWindow) {
    try {
      reportWindow.document.open();
      reportWindow.document.write(html);
      reportWindow.document.close();
      return;
    } catch {
      try {
        reportWindow.close();
      } catch {
        // Ignore close errors.
      }
    }
  }
  downloadHtml(html, filename);
}

function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openOrDownload(html: string, filename: string): void {
  writeReportToWindow(openReportWindow(), html, filename);
}

/**
 * Runs `buildHtml` and writes its result into `reportWindow` (opened earlier
 * via `openReportWindow`, before the build's first `await` — P3-7's "open
 * early, write once ready" pattern). If `buildHtml` throws, the window it was
 * meant to fill in would otherwise sit open and permanently blank — the write
 * only happens on the success path below, and nothing else ever touches
 * `reportWindow` on a failure. Closing it here instead re-establishes the
 * pre-P3-7 guarantee (a failed build never leaves a visible tab behind) while
 * keeping the async/chunked, main-thread-friendly build. Rethrows so the
 * caller's existing error-toast handling still fires unchanged.
 */
export async function writeOrCloseOnFailure(
  reportWindow: Window | null,
  buildHtml: () => Promise<string>,
  filename: string,
): Promise<void> {
  let html: string;
  try {
    html = await buildHtml();
  } catch (err) {
    if (reportWindow) {
      try {
        reportWindow.close();
      } catch {
        // Ignore; nothing more we can do if the browser refuses to close it.
      }
    }
    throw err;
  }
  writeReportToWindow(reportWindow, html, filename);
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-SA-u-nu-latn");
  } catch {
    return iso;
  }
}
