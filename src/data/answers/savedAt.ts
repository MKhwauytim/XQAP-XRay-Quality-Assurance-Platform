/**
 * The one comparator for `ItemAnswer.lastSavedAt` values. Plain string order
 * is wrong for ISO-8601 instants that differ in precision: a legacy stamp
 * without milliseconds (`…:00Z`) sorts ABOVE `…:00.000Z` from the same second
 * (`"Z"` > `"."`), so an equal or older value could look newer. Compares the
 * parsed instants; when either side is unparseable it falls back to string
 * order (the previous behaviour) rather than guessing.
 * Returns a negative, zero or positive number like `Array.prototype.sort`.
 */
export function compareSavedAt(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a < b ? -1 : a > b ? 1 : 0;
  return ta - tb;
}
