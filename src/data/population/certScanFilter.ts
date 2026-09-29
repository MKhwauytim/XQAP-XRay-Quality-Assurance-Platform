// The one CertScan filter predicate (C2, 2026-09-28 corrective plan). A row is
// CertScan iff its processed `certScanStatus` is "Certscan" — the same rule
// the sampling split uses (sampleAlgorithmInternals.ts). Since C2 that status
// already folds in whole-port flags (processPopulation), so filters never need
// to know about `certScanPorts` themselves. The employee case queue
// (caseFilter.ts) and Population Browse both go through this module, so a chip
// can never disagree with the draw about what "CertScan" means.

export type CertScanFilter = "any" | "certscan" | "noncertscan";

/** Render order of the chips; "any" first because it is the default. */
export const CERTSCAN_FILTERS = ["any", "certscan", "noncertscan"] as const satisfies readonly CertScanFilter[];

export type CertScanFilterCounts = Record<CertScanFilter, number>;

type CertScanStatusCarrier = { row: { certScanStatus: string | null } };

export function matchesCertScanFilter(status: string | null | undefined, filter: CertScanFilter): boolean {
  if (filter === "any") return true;
  const isCertScan = status === "Certscan";
  return filter === "certscan" ? isCertScan : !isCertScan;
}

/** `entries` narrowed to the chip. Identity-stable for "any". */
export function filterByCertScan<T extends CertScanStatusCarrier>(entries: T[], filter: CertScanFilter): T[] {
  return filter === "any"
    ? entries
    : entries.filter((entry) => matchesCertScanFilter(entry.row.certScanStatus, filter));
}

/** How many rows each chip would show, over whatever set is passed in. */
export function countCertScanFilters(entries: readonly CertScanStatusCarrier[]): CertScanFilterCounts {
  const counts: CertScanFilterCounts = { any: entries.length, certscan: 0, noncertscan: 0 };
  for (const entry of entries) {
    if (matchesCertScanFilter(entry.row.certScanStatus, "certscan")) counts.certscan += 1;
    else counts.noncertscan += 1;
  }
  return counts;
}

// ── Population Browse (C2) ───────────────────────────────────────────────────
// Browse expresses the chip as an ordinary `certScanStatus` column filter, so
// it travels in PopulationQueryParams.columnFilters through BOTH the query
// worker and the main-thread fallback with no protocol change. Browse matches
// the exact stored value, so "noncertscan" selects "NonCertscan" rows — every
// processed row carries one of the two values, so this agrees with
// matchesCertScanFilter above in practice.

/** The Browse column the CertScan chip filters on. */
export const CERTSCAN_STATUS_COLUMN = "certScanStatus";

const STATUS_FOR_FILTER: Record<Exclude<CertScanFilter, "any">, string> = {
  certscan: "Certscan",
  noncertscan: "NonCertscan",
};

/** Which chip a Browse column-filter state corresponds to ("any" unless exactly one status is selected). */
export function certScanFilterFromColumnFilters(
  columnFilters: Readonly<Record<string, readonly string[]>>
): CertScanFilter {
  const selected = columnFilters[CERTSCAN_STATUS_COLUMN] ?? [];
  if (selected.length !== 1) return "any";
  if (selected[0] === STATUS_FOR_FILTER.certscan) return "certscan";
  if (selected[0] === STATUS_FOR_FILTER.noncertscan) return "noncertscan";
  return "any";
}

/** `columnFilters` with the CertScan chip applied ("any" removes the column filter). */
export function withCertScanFilter(
  columnFilters: Readonly<Record<string, string[]>>,
  filter: CertScanFilter
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...columnFilters };
  if (filter === "any") delete next[CERTSCAN_STATUS_COLUMN];
  else next[CERTSCAN_STATUS_COLUMN] = [STATUS_FOR_FILTER[filter]];
  return next;
}
