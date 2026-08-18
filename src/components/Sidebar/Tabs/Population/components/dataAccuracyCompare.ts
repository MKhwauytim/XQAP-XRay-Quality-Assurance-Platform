/**
 * Pure comparison + display logic behind `DataAccuracyReport.tsx`.
 *
 * Kept in its own non-component module so the .tsx file exports components
 * only (`react-refresh/only-export-components` is an error under `lint:ci`),
 * and so the normalization rules can be unit-tested without rendering.
 */
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import type { NormalizedBiRow } from "../biData/biDataTypes";
import { makeBiMatchKey } from "../processing/populationProcessor";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { yieldToMain } from "../../../../../data/storage/yieldToMain";

// Fix (population, 2026-08-18): this comparison used to run fully
// synchronously inside a render-time useMemo. Over a real population (tens to
// hundreds of thousands of risk rows × ~14 columns each) that is millions of
// iterations blocking the main thread in one go -- the app reads as frozen
// and unclickable for the whole duration, worst right after a Phase 1 upload
// when the user first lands on Phase 2. `CHUNK_SIZE` rows run per turn, then
// control yields back to the browser so clicks/paints are serviced between
// chunks. Chunking a straight-line loop with periodic awaits does not change
// what it computes -- same rows, same order, same result -- only when control
// returns to the caller.
const CHUNK_SIZE = 2000;

// ── column mapping definition ─────────────────────────────────────────────────

type ColMapping = {
  key: string;
  label: string;
  getRisk: (r: NormalizedRiskRow) => string | null;
  getBi:   (b: NormalizedBiRow)   => string | null;
};

const COLUMN_MAPPINGS: ColMapping[] = [
  { key: "xrayEntryDate",          label: "تاريخ دخول الأشعة",        getRisk: r => r.xrayEntryDate,           getBi: b => b.xrayEntryDate },
  { key: "portCode",               label: "رمز المنفذ",               getRisk: r => r.portCode,                getBi: b => b.portCode },
  { key: "portName",               label: "اسم المنفذ",               getRisk: r => r.portName,                getBi: b => b.portName },
  { key: "portType",               label: "نوع المنفذ",               getRisk: r => r.portType,                getBi: b => b.portType },
  { key: "declarationNumber",      label: "رقم البيان",               getRisk: r => r.declarationNumber,       getBi: b => b.declarationNumber },
  { key: "declarationDate",        label: "تاريخ البيان",             getRisk: r => r.declarationDate,         getBi: b => b.declarationDate },
  { key: "declarationHijriDate",   label: "تاريخ البيان هجري",       getRisk: r => r.declarationHijriDate,    getBi: b => b.declarationHijriDate },
  { key: "plateOrContainerNumber", label: "رقم اللوحة/الحاوية",       getRisk: r => r.plateOrContainerNumber,  getBi: b => b.plateOrContainerNumber },
  { key: "chassisNumber",          label: "رقم الهيكل",               getRisk: r => r.chassisNumber,           getBi: b => b.chassisNumber },
  { key: "levelOneResult",         label: "نتيجة المستوى الأول",      getRisk: r => r.xrayLevelOneResult,      getBi: b => b.levelOneResult },
  { key: "levelTwoResult",         label: "نتيجة المستوى الثاني",     getRisk: r => r.xrayLevelTwoResult,      getBi: b => b.levelTwoResult },
  { key: "manualInspectionResult", label: "نتيجة التفتيش اليدوي",    getRisk: r => r.inspectorResult,         getBi: b => b.manualInspectionResult },
  { key: "oppositeInspectionResult",label:"نتيجة التفتيش المعاكس",   getRisk: r => r.oppositeInspectorResult, getBi: b => b.oppositeInspectionResult },
  { key: "liveMeansResult",        label: "نتيجة الوسائل الحية",     getRisk: r => r.liveMeansResult,         getBi: b => b.liveMeansResult },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function norm(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = val.toString().trim();
  // Normalize ISO-style dates: "2025-1-5" → "2025-01-05"
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
  // Normalize DD/MM/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2,"0")}-${slash[1].padStart(2,"0")}`;
  return s.toLowerCase().replace(/\s+/g, " ");
}


// ── Result-value semantic normalization ───────────────────────────────────────
// Result columns (level-1/2, manual, opposite, live-means) store their values
// differently across the two source systems: the risk workbook may use numeric
// codes (1, 2) while the BI workbook stores full Arabic phrases — or the same
// concept is expressed with slightly different wording.  We map all known
// variants to a canonical Arabic label so they compare equal AND so the UI can
// show that one canonical label instead of the source-system spelling.

const RESULT_COLUMN_KEYS = new Set([
  "levelOneResult",
  "levelTwoResult",
  "manualInspectionResult",
  "oppositeInspectionResult",
  "liveMeansResult",
]);

export const RESULT_CANONICAL_CLEAN = "سليمة";
export const RESULT_CANONICAL_SUSPECT = "اشتباه";

export function canonicalizeResult(normed: string): string {
  // Numeric codes used by the risk workbook
  if (normed === "1") return RESULT_CANONICAL_CLEAN;
  if (normed === "2") return RESULT_CANONICAL_SUSPECT;
  // Normalize Arabic letters for soft-matching (ة→ه, أإآ→ا, ى→ي)
  const ar = normed
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ةه]/g, "ه");
  if (ar.startsWith("سليم") || ar.includes("يمكن فسحها") || ar.includes("مبدئ")) return RESULT_CANONICAL_CLEAN;
  if (ar.startsWith("اشتباه") || ar.startsWith("مشتبه")) return RESULT_CANONICAL_SUSPECT;
  return normed;
}

/** Comparison normalizer for result columns: apply base norm then canonicalize. */
function normResult(val: string | null | undefined): string {
  return canonicalizeResult(norm(val));
}

/** Picks the right normalizer based on whether the column is a result column. */
function normForCol(val: string | null | undefined, colKey: string): string {
  return RESULT_COLUMN_KEYS.has(colKey) ? normResult(val) : norm(val);
}

export function isResultColumn(colKey: string): boolean {
  return RESULT_COLUMN_KEYS.has(colKey);
}

export type DisplayTone = "clean" | "suspect" | "empty" | "plain";

export type DisplayValue = { text: string; tone: DisplayTone };

/**
 * Display helper for one mismatch cell (3b design handoff).
 *
 * Result columns render the CANONICAL value only — سليمة or اشتباه — never the
 * source-system code (`1`/`2`) or its original wording ("يمكن فسحها", "مشتبه",
 * "مبدئي"…), and with no "raw (canonical)" annotation. A value that maps to
 * neither canonical label (an unrecognised spelling) still falls back to its
 * trimmed raw text rather than being hidden — showing nothing would be worse
 * than showing the thing the reviewer has to go and fix.
 *
 * Non-result columns (dates, port type, numbers) keep their raw value verbatim.
 *
 * An empty value renders "—", except on the BI side where it renders
 * "— فارغ في BI" so an unmatched BI cell is distinguishable from a blank one.
 */
export function displayForCol(
  val: string | null | undefined,
  colKey: string,
  side: "risk" | "bi" = "risk",
): DisplayValue {
  const labels = getLabels();
  if (val === null || val === undefined || val.trim() === "") {
    return {
      text: side === "bi" ? labels.p2_value_empty_in_bi : labels.p2_value_empty,
      tone: "empty",
    };
  }
  const raw = val.trim();
  if (!RESULT_COLUMN_KEYS.has(colKey)) return { text: raw, tone: "plain" };

  const canonical = canonicalizeResult(norm(raw));
  if (canonical === RESULT_CANONICAL_CLEAN) return { text: labels.p2_result_clean, tone: "clean" };
  if (canonical === RESULT_CANONICAL_SUSPECT) return { text: labels.p2_result_suspect, tone: "suspect" };
  return { text: raw, tone: "plain" };
}

/** Severity bucket for a column's accuracy — drives the dot/bar/number colour. */
export function severityOf(pct: number): "perfect" | "warn" | "critical" {
  if (pct === 100) return "perfect";
  if (pct < 60) return "critical";
  return "warn";
}

// ── types ─────────────────────────────────────────────────────────────────────

type Mismatch = {
  xrayImageId: string;
  colKey:      string;
  colLabel:    string;
  riskValue:   string | null;
  biValue:     string | null;
};

export type ColStat = {
  key:       string;
  label:     string;
  matched:   number;
  mismatched: number;
  accuracy:  number;
};

export type AccuracyCompareResult = {
  totalRiskRows:     number;
  matchedIds:        number;
  onlyInRisk:        number;
  onlyInBi:          number;
  rowsWithMismatch:  number;
  totalComparisons:  number;
  totalMismatches:   number;
  overallAccuracy:   number;
  colStats:          ColStat[];
  mismatches:        Mismatch[];
};

// ── computation ───────────────────────────────────────────────────────────────

/**
 * Async, chunked twin of the loop below — same computation, same result, but
 * yields to the browser every `CHUNK_SIZE` risk rows so the UI stays
 * responsive on a real-sized population. This is the version production code
 * should call; `compareAccuracy` stays for callers that already know their
 * input is small (tests) and want a plain synchronous result.
 */
export async function compareAccuracyAsync(
  riskRows: NormalizedRiskRow[],
  biRows: NormalizedBiRow[],
): Promise<AccuracyCompareResult> {
  const biMap = new Map<string, NormalizedBiRow>();
  for (const b of biRows) {
    if (b.xrayImageId) biMap.set(makeBiMatchKey(b.xrayImageId, b.portName), b);
  }

  const colCounters: Record<string, { matched: number; mismatched: number }> = {};
  for (const col of COLUMN_MAPPINGS) colCounters[col.key] = { matched: 0, mismatched: 0 };

  const mismatches: Mismatch[] = [];
  let matchedIds       = 0;
  let onlyInRisk       = 0;
  let rowsWithMismatch = 0;

  for (let i = 0; i < riskRows.length; i++) {
    const r = riskRows[i]!;
    if (r.xrayImageId) {
      const b = biMap.get(makeBiMatchKey(r.xrayImageId, r.portName));
      if (!b) {
        onlyInRisk++;
      } else {
        matchedIds++;
        let rowHasMismatch = false;
        for (const col of COLUMN_MAPPINGS) {
          const rv = normForCol(col.getRisk(r), col.key);
          const bv = normForCol(col.getBi(b), col.key);
          if (rv !== bv) {
            colCounters[col.key].mismatched++;
            mismatches.push({
              xrayImageId: r.xrayImageId,
              colKey:      col.key,
              colLabel:    col.label,
              riskValue:   col.getRisk(r),
              biValue:     col.getBi(b),
            });
            rowHasMismatch = true;
          } else {
            colCounters[col.key].matched++;
          }
        }
        if (rowHasMismatch) rowsWithMismatch++;
      }
    }
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToMain();
  }

  const riskKeys = new Set(
    riskRows.filter(r => r.xrayImageId).map(r => makeBiMatchKey(r.xrayImageId, r.portName))
  );
  let onlyInBi = 0;
  for (let i = 0; i < biRows.length; i++) {
    const b = biRows[i]!;
    if (b.xrayImageId && !riskKeys.has(makeBiMatchKey(b.xrayImageId, b.portName))) onlyInBi++;
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToMain();
  }

  const totalComparisons = matchedIds * COLUMN_MAPPINGS.length;
  const totalMismatches  = mismatches.length;
  const overallAccuracy  = totalComparisons > 0
    ? Math.round(((totalComparisons - totalMismatches) / totalComparisons) * 100)
    : 100;

  const colStats: ColStat[] = COLUMN_MAPPINGS.map(col => {
    const { matched, mismatched } = colCounters[col.key];
    const total = matched + mismatched;
    return {
      key:       col.key,
      label:     col.label,
      matched,
      mismatched,
      accuracy:  total > 0 ? Math.round((matched / total) * 100) : 100,
    };
  });

  return {
    totalRiskRows:   riskRows.filter(r => r.xrayImageId).length,
    matchedIds,
    onlyInRisk,
    onlyInBi,
    rowsWithMismatch,
    totalComparisons,
    totalMismatches,
    overallAccuracy,
    colStats,
    mismatches,
  };
}

export function compareAccuracy(
  riskRows: NormalizedRiskRow[],
  biRows: NormalizedBiRow[],
): AccuracyCompareResult {
  // Match on the SAME normalized ID+port key the population processor uses
  // (makeBiMatchKey) so this accuracy report reflects the real BI→risk join —
  // a bare `xrayImageId.trim()` key silently over- or under-counted matches.
  const biMap = new Map<string, NormalizedBiRow>();
  for (const b of biRows) {
    if (b.xrayImageId) biMap.set(makeBiMatchKey(b.xrayImageId, b.portName), b);
  }

  const colCounters: Record<string, { matched: number; mismatched: number }> = {};
  for (const col of COLUMN_MAPPINGS) colCounters[col.key] = { matched: 0, mismatched: 0 };

  const mismatches: Mismatch[] = [];
  let matchedIds       = 0;
  let onlyInRisk       = 0;
  let rowsWithMismatch = 0;

  for (const r of riskRows) {
    if (!r.xrayImageId) continue;
    const b = biMap.get(makeBiMatchKey(r.xrayImageId, r.portName));
    if (!b) { onlyInRisk++; continue; }
    matchedIds++;

    let rowHasMismatch = false;
    for (const col of COLUMN_MAPPINGS) {
      const rv = normForCol(col.getRisk(r), col.key);
      const bv = normForCol(col.getBi(b), col.key);
      if (rv !== bv) {
        colCounters[col.key].mismatched++;
        mismatches.push({
          xrayImageId: r.xrayImageId,
          colKey:      col.key,
          colLabel:    col.label,
          riskValue:   col.getRisk(r),
          biValue:     col.getBi(b),
        });
        rowHasMismatch = true;
      } else {
        colCounters[col.key].matched++;
      }
    }
    if (rowHasMismatch) rowsWithMismatch++;
  }

  const riskKeys = new Set(
    riskRows.filter(r => r.xrayImageId).map(r => makeBiMatchKey(r.xrayImageId, r.portName))
  );
  let onlyInBi = 0;
  for (const b of biRows) {
    if (b.xrayImageId && !riskKeys.has(makeBiMatchKey(b.xrayImageId, b.portName))) onlyInBi++;
  }

  const totalComparisons = matchedIds * COLUMN_MAPPINGS.length;
  const totalMismatches  = mismatches.length;
  const overallAccuracy  = totalComparisons > 0
    ? Math.round(((totalComparisons - totalMismatches) / totalComparisons) * 100)
    : 100;

  const colStats: ColStat[] = COLUMN_MAPPINGS.map(col => {
    const { matched, mismatched } = colCounters[col.key];
    const total = matched + mismatched;
    return {
      key:       col.key,
      label:     col.label,
      matched,
      mismatched,
      accuracy:  total > 0 ? Math.round((matched / total) * 100) : 100,
    };
  });

  return {
    totalRiskRows:   riskRows.filter(r => r.xrayImageId).length,
    matchedIds,
    onlyInRisk,
    onlyInBi,
    rowsWithMismatch,
    totalComparisons,
    totalMismatches,
    overallAccuracy,
    colStats,
    mismatches,
  };
}
