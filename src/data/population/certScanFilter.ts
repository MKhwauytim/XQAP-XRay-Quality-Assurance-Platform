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
