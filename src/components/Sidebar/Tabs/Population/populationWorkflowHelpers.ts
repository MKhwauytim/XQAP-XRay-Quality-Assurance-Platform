import type { DistributionEntry, DistributionEvent } from "../../../../data/distribution/distributionTypes";
import type { MonthEditData, MonthLoadScope } from "../../../../data/population/populationStorage";
import { MonthClosedError } from "../../../../data/population/monthLock";
import {
  codedMessage,
  logCodedError,
  resolveErrorCode
} from "../../../../data/storage/errorCodes";
import type { BiWorkbookResult, NormalizedBiRow } from "./biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "./riskData/riskDataTypes";
import type {
  PopulationProcessingResult,
  PreparedPopulationRow
} from "./processing/populationProcessingTypes";

export type PhaseDefinition = {
  id: number;
  title: string;
  description: string;
};

export const PHASES: PhaseDefinition[] = [
  { id: 1, title: "رفع البيانات", description: "رفع ملفات Excel المطلوبة لبدء معالجة بيانات المجتمع." },
  { id: 2, title: "تقرير البيانات والمعالجة", description: "عرض تقرير مصغر للملفات ثم متابعة منطق المعالجة." },
  { id: 3, title: "اختيار العينة", description: "تطبيق منطق اختيار العينة حسب قواعد العمل المعتمدة." },
  { id: 4, title: "توزيع العينة", description: "توزيع عناصر العينة على الموظفين المصرح لهم داخل النظام." }
];

export function sourceFileMetadata(file: File | null): { name: string; size: number; lastModified: number } | null {
  return file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Large-Population Performance Proposal, Phase A step 3: what a wizard month-load
 * should actually fetch, given the active sub-tab and the viewer's own capabilities.
 *
 * `summary`/`sample`/`distribution` are always requested regardless of sub-tab or
 * capability -- they're small, never row-scaled governance files, and the phase
 * stepper/status bar need them to render correctly even for a Browse-only viewer
 * who later switches back to "process" without reselecting the month (there is no
 * separate lazy top-up for these three; only `population` gets one, via
 * `ensurePopulationLoaded` in index.tsx, because only `population`/`raw` can each
 * hold up to ~400k rows -- the two fields actually worth deferring).
 *
 * `population` loads only on the "process" sub-tab, and only for a viewer who can
 * actually act on it (draw a sample, or reprocess) -- a view-only employee/guest,
 * the exact population the original perf complaint was about, never pays for it.
 * This intentionally drops the proposal doc's literal "or the month has no sample
 * yet" clause: knowing sample-existence ahead of the load would need its own
 * look-ahead read, and every role that can act on a not-yet-sampled month already
 * holds draw-sample/process-population capability, so the clause added no coverage
 * this simpler capability-only check doesn't already provide.
 *
 * `raw` is requested whenever `population` is (a viewer who may reprocess may also
 * need the originally-uploaded workbook for Phase 1/2 display); `loadMonthForEditing`
 * itself still applies its own independent manifest-status gate on top (A1 perf
 * finding), so this never re-reads the two raw files for an already-processed month.
 */
/**
 * The Population tab's sub-tab ids. Lives here (rather than only in index.tsx) so
 * `computeMonthLoadScope` and the tab itself cannot drift apart when a sub-tab is
 * added -- `population/adhoc-import` was added on 2026-08-21 and, like "browse",
 * needs no population/raw read.
 */
export type PopulationSubTab = "process" | "browse" | "adhoc-import";

export function computeMonthLoadScope(params: {
  activeSubTab: PopulationSubTab;
  canDrawSample: boolean;
  canProcessPopulation: boolean;
}): MonthLoadScope {
  const needsPopulation =
    params.activeSubTab === "process" && (params.canDrawSample || params.canProcessPopulation);
  return {
    summary: true,
    sample: true,
    distribution: true,
    population: needsPopulation,
    raw: needsPopulation,
  };
}

export function isSupportedExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function reconstructedRiskWorkbook(rows: MonthEditData["riskRawRows"]): RiskWorkbookResult | null {
  if (rows.length === 0) return null;
  return {
    rows: rows as unknown as NormalizedRiskRow[],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0
  };
}

function reconstructedBiWorkbook(rows: MonthEditData["biRawRows"]): BiWorkbookResult | null {
  if (rows.length === 0) return null;
  return {
    rows: rows as unknown as NormalizedBiRow[],
    sheetSummaries: [],
    unknownSheetNames: [],
    unmatchedSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0
  };
}

function fallbackProcessingSummary(data: MonthEditData): PopulationProcessingResult["summary"] {
  const populationCount = data.populationRows?.length ?? 0;
  return {
    riskOriginalRows: populationCount,
    validRiskIdRows: populationCount,
    invalidRiskIdRows: 0,
    duplicateRiskIdRows: 0,
    rowsAfterDeduplication: populationCount,
    removedInvalidResultRows: 0,
    finalPreparedPopulationRows: populationCount,
    certScanRows: data.certScanRows,
    nonCertScanRows: data.nonCertScanRows,
    certScanPercentage: populationCount > 0 ? Math.round((data.certScanRows / populationCount) * 100) : 0,
    nonCertScanPercentage: populationCount > 0 ? Math.round((data.nonCertScanRows / populationCount) * 100) : 0,
    biProvided: data.biRawRows.length > 0,
    biMatchedRows: 0,
    biUnmatchedRows: 0,
    biMatchPercentage: 0,
    totalBiFilledFields: 0,
    biFieldFillSummary: []
  };
}

export function reconstructedPopulation(data: MonthEditData): PopulationProcessingResult | null {
  if (!data.populationRows) return null;
  return {
    preparedRows: data.populationRows as unknown as PreparedPopulationRow[],
    removedRows: data.processingSummary?.removedRows ?? [],
    duplicateRows: data.processingSummary?.duplicateRows ?? [],
    invalidResultRows: data.processingSummary?.invalidResultRows ?? [],
    summary: data.processingSummary?.summary ?? fallbackProcessingSummary(data)
  };
}

/**
 * Phase derivation must not depend solely on `data.populationRows`: under Phase A's
 * opt-in MonthLoadScope, a screen can legitimately load sample/distribution/summary
 * without population, and must still report the month's true phase rather than
 * regressing an already-processed/sampled month back toward phase 1.
 *
 * `data.manifest.status` is always loaded regardless of scope (see
 * `loadMonthForEditing`), so it's the scope-independent source of truth here --
 * checked ahead of the data-presence heuristics below for that reason. Sample/
 * distribution presence is still checked FIRST, though: `saveSampleMaster`/
 * `updateMonthStatus("sampled")` are two separate, non-atomic writes in the wizard's
 * draw-sample handler, so a real (rare) partial-failure state can have a sample file
 * on disk while the manifest status write itself lagged -- in that case the file that
 * actually exists should win over a stale status string.
 */
function derivePhase(data: MonthEditData): { current: number; completed: number[] } | null {
  if (data.distributionCurrent || data.sampleData) {
    return { current: 4, completed: [1, 2, 3] };
  }
  const status = data.manifest?.status;
  if (status === "sampled" || status === "distributed" || status === "closed") {
    return { current: 4, completed: [1, 2, 3] };
  }
  if (status === "processed-saved" || data.processingSummary || data.populationRows) {
    return { current: 3, completed: [1, 2] };
  }
  return null;
}

export function buildLoadedMonthState(data: MonthEditData) {
  const phase = derivePhase(data);
  return {
    riskWorkbook: reconstructedRiskWorkbook(data.riskRawRows),
    biWorkbook: reconstructedBiWorkbook(data.biRawRows),
    population: reconstructedPopulation(data),
    sample: data.sampleData,
    distribution: data.distributionCurrent,
    phase,
    manifest: data.manifest,
    // Owner requirement: for a locked month, `population` above is always
    // null (loadMonthForEditing deliberately skips the row read) — the tab
    // renders from these two instead of falling back to any row read.
    populationLocked: data.populationLocked,
    populationAggregate: data.populationAggregate,
  };
}

export function buildAssignedEntryMap(
  events: DistributionEvent[],
  sampleRows: PreparedPopulationRow[]
): Map<string, DistributionEntry[]> {
  const rows = new Map(sampleRows.map((row) => [row.xrayImageId, row]));
  const assignments = new Map<string, DistributionEntry[]>();
  for (const event of events) {
    if (event.eventType !== "assigned") continue;
    const row = rows.get(event.xrayImageId);
    if (!row) continue;
    const entries = assignments.get(event.assignedTo) ?? [];
    entries.push({
      xrayImageId: event.xrayImageId,
      assignedTo: event.assignedTo,
      status: "pending",
      replacedById: null,
      lastEventAt: event.eventAt,
      row
    });
    assignments.set(event.assignedTo, entries);
  }
  return assignments;
}

export function distributionErrorText(error: unknown, monthClosedText: string): string {
  if (error instanceof MonthClosedError) return monthClosedText;
  // Only thrown exceptions reach here — domain-level failures carry their own
  // Arabic text through the `result.ok === false` branch at every call site.
  // Those exception messages are internal English (safeWrite validation text,
  // "Browser cannot write ..."), which has no place in an Arabic UI; the raw
  // detail goes to the admin error log instead of the user's screen.
  // The code's OWN label, not a fixed generic sentence. This function is wired
  // into all five Phase 4 actions (assign, reassign, complete, request
  // replacement, bulk distribute), so it was the widest remaining instance of
  // the "resolve the code, then ignore it" bug: it printed
  // `msg_unexpected_write_error` — which ends "أعد المحاولة" — for XQ-IO-030,
  // the one cause where retrying can never succeed, and for XQ-IO-020, where
  // the disk is full. Correct code, actively wrong advice.
  const code = resolveErrorCode(error) ?? "XQ-DIST-001";
  logCodedError("distribution:action-failed", code, error);
  return codedMessage(code);
}
