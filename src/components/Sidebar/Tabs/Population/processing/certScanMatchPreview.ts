import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import {
  buildCertScanPortIndex,
  matchXrayIdAgainstPortEntries,
  parseCertScanPasteText,
  type PortMatchTier
} from "./certScanParser";
import { isValidXrayImageId, normalizeXrayId } from "./populationProcessor";
import { normalizeText } from "./textNormalization";

/**
 * Pre-processing CertScan match preview.
 *
 * The owner's report — "there is only 30 certscan sample while if I do the
 * process myself I get more than 30k" — was only visible *after* running the
 * full population processing and reading the summary card. This module
 * computes the same headline numbers (and, critically, a per-port breakdown)
 * from the current risk upload + CertScan paste alone, before the user commits
 * to processing, so a ~30-vs-~30,000 mismatch is obvious immediately.
 *
 * Deliberately reuses processPopulation's own candidate-row rules (valid X-ray
 * ID + first-seen dedup, via `isValidXrayImageId`/`normalizeXrayId`) and its
 * own port-matching ladder (via `buildCertScanPortIndex`/
 * `matchXrayIdAgainstPortEntries`) so the preview can never drift from what
 * the real run will actually do.
 */

export type CertScanPortBreakdownRow = {
  /** Port name as it appears in the population (risk upload). */
  populationPortName: string;
  /** Candidate population rows (valid ID, deduplicated) at this port. */
  populationRowCount: number;
  /** How many of those rows this preview expects to match a CertScan device. */
  matchedRowCount: number;
  /** The pasted CertScan port name aligned to this population port, or null if none aligned. */
  alignedPastePortName: string | null;
  /** How loose the port-name alignment was, or null when no CertScan port aligned at all. */
  tier: PortMatchTier | null;
};

export type CertScanMatchPreview = {
  /** Whether there is enough input (paste text) to compute a preview at all. */
  hasPasteData: boolean;
  /** Distinct CertScan devices parsed from the paste. */
  totalCertScanEntries: number;
  /** Candidate population rows (valid ID + deduplicated) this preview matched against. */
  totalPopulationRows: number;
  /** Rows expected to match a CertScan device. */
  totalMatchedRows: number;
  totalMatchPercentage: number;
  /** One row per population port with at least one candidate row, sorted by row count desc. */
  portBreakdown: CertScanPortBreakdownRow[];
  /** Port names named in the CertScan paste but absent from the population entirely. */
  pasteOnlyPorts: string[];
  /** Port names present in the population with zero CertScan alignment (paste-side has nothing close). */
  populationOnlyPorts: string[];
  /** Port alignments made at a tier looser than exact — must be surfaced for user confirmation. */
  looseTierAlignments: Array<{
    populationPortName: string;
    pastePortName: string;
    tier: PortMatchTier;
  }>;
};

function emptyPreview(certScanEntryCount: number): CertScanMatchPreview {
  return {
    hasPasteData: certScanEntryCount > 0,
    totalCertScanEntries: certScanEntryCount,
    totalPopulationRows: 0,
    totalMatchedRows: 0,
    totalMatchPercentage: 0,
    portBreakdown: [],
    pasteOnlyPorts: [],
    populationOnlyPorts: [],
    looseTierAlignments: []
  };
}

export function computeCertScanMatchPreview(
  riskRows: readonly NormalizedRiskRow[],
  certScanPasteText: string
): CertScanMatchPreview {
  const certScanEntries = parseCertScanPasteText(certScanPasteText);

  if (certScanEntries.length === 0) {
    return emptyPreview(0);
  }

  // Same candidate-row rules processPopulation applies before CertScan matching:
  // valid X-ray ID, first-seen-wins deduplication. Level 1/2 result validity and
  // BI enrichment are intentionally NOT applied here — this preview only needs to
  // answer "will CertScan matching work", not reproduce the full pipeline.
  const seenXrayIds = new Set<string>();
  const candidateRows: { xrayImageId: string; portName: string | null }[] = [];

  for (const row of riskRows) {
    if (!isValidXrayImageId(row.xrayImageId)) continue;
    const normalizedId = normalizeXrayId(row.xrayImageId);
    if (seenXrayIds.has(normalizedId)) continue;
    seenXrayIds.add(normalizedId);
    candidateRows.push({ xrayImageId: normalizedId, portName: row.portName });
  }

  if (candidateRows.length === 0) {
    return emptyPreview(certScanEntries.length);
  }

  const { entriesByPopulationPort, alignment } = buildCertScanPortIndex(
    certScanEntries,
    candidateRows.map((row) => row.portName)
  );

  const tierByPopulationPort = new Map(
    alignment.alignments.map((a) => [a.populationPortName, a] as const)
  );

  const breakdownByPort = new Map<string, CertScanPortBreakdownRow>();

  for (const row of candidateRows) {
    const portName = normalizeText(row.portName);
    if (!portName) continue;

    let breakdown = breakdownByPort.get(portName);
    if (!breakdown) {
      const portAlignment = tierByPopulationPort.get(portName) ?? null;
      breakdown = {
        populationPortName: portName,
        populationRowCount: 0,
        matchedRowCount: 0,
        alignedPastePortName: portAlignment?.pastePortName ?? null,
        tier: portAlignment?.tier ?? null
      };
      breakdownByPort.set(portName, breakdown);
    }

    breakdown.populationRowCount += 1;

    const entries = entriesByPopulationPort.get(portName) ?? [];
    const snippetMatch = matchXrayIdAgainstPortEntries(row.xrayImageId, entries);
    if (snippetMatch.matched) {
      breakdown.matchedRowCount += 1;
    }
  }

  const portBreakdown = Array.from(breakdownByPort.values()).sort(
    (a, b) => b.populationRowCount - a.populationRowCount
  );

  const totalMatchedRows = portBreakdown.reduce((sum, p) => sum + p.matchedRowCount, 0);
  const totalPopulationRows = candidateRows.length;

  const looseTierAlignments = alignment.alignments
    .filter((a) => a.tier !== "exact")
    .map((a) => ({
      populationPortName: a.populationPortName,
      pastePortName: a.pastePortName,
      tier: a.tier
    }));

  return {
    hasPasteData: true,
    totalCertScanEntries: certScanEntries.length,
    totalPopulationRows,
    totalMatchedRows,
    totalMatchPercentage:
      totalPopulationRows === 0
        ? 0
        : Number(((totalMatchedRows / totalPopulationRows) * 100).toFixed(2)),
    portBreakdown,
    pasteOnlyPorts: alignment.unmatchedPastePorts,
    populationOnlyPorts: alignment.unmatchedPopulationPorts,
    looseTierAlignments
  };
}
