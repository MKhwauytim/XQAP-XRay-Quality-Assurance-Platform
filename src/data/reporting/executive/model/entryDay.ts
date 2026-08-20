/**
 * Day-of-month extractor for the daily-trend page.
 *
 * `PreparedPopulationRow.xrayEntryDate` is ALREADY normalized to `YYYY-MM-DD`
 * by Phase 2 (`populationProcessor.ts:484` → the exported `normalizeDate`), so
 * there is deliberately no date PARSING here — building a second parser would
 * be a second source of truth for date semantics, and the processor's is the
 * one that already handles Excel serials, DD/MM/YYYY, DD-MMM-YYYY and the rest.
 *
 * The one thing this helper must handle is that `normalizeDate` FALLS BACK to
 * returning its input unchanged when it cannot parse (`?? raw`, `?? rawFill`,
 * `String(value)`). So the field is usually, but not guaranteed, ISO. Anything
 * that is not a well-formed ISO date with an in-range day returns `null` and
 * is counted into the page's غير مؤرخ bucket — never guessed at, never dropped
 * silently.
 *
 * Pure: no Date construction, no locale dependence, no I/O.
 */
export function entryDayOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^\d{4}-\d{2}-(\d{2})(?:[T ]|$)/.exec(iso);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}
