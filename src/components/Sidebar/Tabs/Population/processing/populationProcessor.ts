import type { NormalizedBiRow } from "../biData/biDataTypes";
import { yieldToMain } from "../../../../../data/storage/yieldToMain";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import {
  buildCertScanPortIndex,
  matchXrayIdAgainstPortEntries,
  parseCertScanPasteText
} from "./certScanParser";
import type {
  BiEnrichmentStatus,
  BiFieldFillSummary,
  CertScanEntry,
  CertScanMatchStatus,
  PopulationProcessingInput,
  PopulationProcessingResult,
  PreparedPopulationRow,
  RemovedPopulationRow
} from "./populationProcessingTypes";
import { normalizeText, normalizeArabicText } from "./textNormalization";
import { attachLazyRawRow } from "../../../../../data/population/populationTypes";

type PreparedDraftRow = {
  stage: string | null;
  xrayImageId: string;
  xrayEntryDate: string | null;

  portCode: string | null;
  portType: string | null;
  portName: string | null;

  declarationNumber: string | null;
  transitDeclarationNumber: string | null;
  declarationDate: string | null;
  declarationHijriDate: string | null;

  manifestNumber: string | null;
  manifestType: string | null;
  manifestDate: string | null;

  plateOrContainerNumber: string | null;
  chassisNumber: string | null;
  finalDestination: string | null;

  xrayLevelOneResult: string | null;
  xrayLevelTwoResult: string | null;

  movementType: string | null;
  movementNumber: string | null;
  movementDate: string | null;
  movementHijriDate: string | null;
  reportNumber: string | null;

  entryDate: string | null;
  exitDate: string | null;

  targetedByRiskEngine: string | null;
  riskMessage: string | null;

  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  // Other (non-L1/L2) team raw results — carried from risk, BI-enriched when blank.
  manualResult: string | null;
  manualResultCode: string | null;
  oppositeResult: string | null;
  oppositeResultCode: string | null;
  oppositeEmployee: string | null;
  liveMeansResult: string | null;
  liveMeansResultCode: string | null;
  liveMeansEmployee: string | null;
  notes: string | null;

  rawRow: Record<string, unknown>;
  sourceSheetName: string;
  sourceRowNumber: number;
};

type DraftFillableField =
  | "xrayEntryDate"
  | "portType"
  | "portName"
  | "declarationNumber"
  | "declarationDate"
  | "declarationHijriDate"
  | "plateOrContainerNumber"
  | "chassisNumber"
  | "xrayLevelOneResult"
  | "xrayLevelTwoResult"
  | "movementNumber"
  | "movementDate"
  | "movementHijriDate";

type BiMatch = {
  row: NormalizedBiRow;
  key: string;
};

type CertScanMatchResult = {
  certScanStatus: CertScanMatchStatus;
  certScanSnippet: string | null;
  originalCertScanSnippet: string | null;
};

const INVALID_ID_VALUES = new Set([
  "",
  "-",
  "NULL",
  "UNDEFINED",
  "N/A",
  "NA",
  "#N/A",
  "#VALUE!",
  "#REF!",
  "#DIV/0!",
  "ERROR"
]);

const BI_FILLABLE_FIELDS: Array<{
  fieldName: DraftFillableField;
  biFieldName: keyof NormalizedBiRow;
  label: string;
}> = [
  {
    fieldName: "xrayEntryDate",
    biFieldName: "xrayEntryDate",
    label: "تاريخ دخول الأشعة"
  },
  {
    fieldName: "portType",
    biFieldName: "portType",
    label: "نوع المنفذ"
  },
  {
    fieldName: "portName",
    biFieldName: "portName",
    label: "اسم المنفذ"
  },
  {
    fieldName: "declarationNumber",
    biFieldName: "declarationNumber",
    label: "رقم البيان"
  },
  {
    fieldName: "declarationDate",
    biFieldName: "declarationDate",
    label: "تاريخ البيان"
  },
  {
    fieldName: "plateOrContainerNumber",
    biFieldName: "plateOrContainerNumber",
    label: "رقم اللوحة/الحاوية"
  },
  {
    fieldName: "chassisNumber",
    biFieldName: "chassisNumber",
    label: "رقم الهيكل"
  },
  {
    fieldName: "xrayLevelOneResult",
    biFieldName: "levelOneResult",
    label: "نتيجة المستوى الأول للأشعة"
  },
  {
    fieldName: "xrayLevelTwoResult",
    biFieldName: "levelTwoResult",
    label: "نتيجة المستوى الثاني للأشعة"
  },
  {
    fieldName: "declarationHijriDate",
    biFieldName: "declarationHijriDate",
    label: "تاريخ البيان هجري"
  },
  {
    fieldName: "movementNumber",
    biFieldName: "movementNumber",
    label: "رقم الحركة"
  },
  {
    fieldName: "movementDate",
    biFieldName: "movementDate",
    label: "تاريخ الحركة"
  },
  {
    fieldName: "movementHijriDate",
    biFieldName: "movementHijriDate",
    label: "تاريخ الحركة هجري"
  }
];

export function normalizeXrayId(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function isBlank(value: unknown): boolean {
  return normalizeText(value) === "";
}

function hasValue(value: unknown): boolean {
  return !isBlank(value);
}

// Exported so the pre-processing CertScan match preview (certScanMatchPreview.ts)
// can build the exact same candidate-row set (valid ID + first-seen dedup) that
// processPopulation matches CertScan against — the preview would otherwise risk
// drifting from real processing and reporting a misleading denominator.
export function isValidXrayImageId(value: string | null): boolean {
  const normalizedId = normalizeXrayId(value);

  if (INVALID_ID_VALUES.has(normalizedId)) {
    return false;
  }

  if (normalizedId.startsWith("RMI") || normalizedId.startsWith("XRA")) {
    return false;
  }

  return normalizedId.length >= 4;
}

// Arabic month names for date parsing
const ARABIC_MONTHS: Record<string, number> = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5,
  "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9,
  "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12
};
const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function excelSerialToIso(serial: number): string | null {
  // Excel day 0 is Dec 30, 1899 and 25569 is the Excel serial of Jan 1, 1970.
  // That constant ALREADY absorbs Excel's phantom 29-Feb-1900, so for every
  // serial past the phantom day `(serial - 25569)` is the whole conversion —
  // applying a second leap-year correction here shifted every imported date one
  // day early (fixed 2026-08-18; verified against the vendored SheetJS's own
  // `XLSX.SSF.parse_date_code`, which is what actually read the cell).
  // The serials at or below the phantom day (1..59 = 1900-01-01..1900-02-28) are
  // the ones needing an adjustment, and it is +1, not -1. `normalizeDate` only
  // routes serials in 25000..60000 here so that branch is unreachable today; it
  // is kept correct rather than left as a trap if the range guard ever widens.
  const adjusted = serial > 59 ? serial : serial + 1;
  const ms = (adjusted - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Normalize diverse date representations to YYYY-MM-DD.
 * Handles: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DDMMMYYYY, DD/MMM/YYYY,
 * Excel serial numbers (optionally with a fractional time-of-day part),
 * datetime strings ("2026-05-01 18:04:11", with or without fractional
 * seconds), JS `Date` objects (SheetJS can hand these back when a workbook
 * reader opts into `cellDates: true`, even though this app's own workbook
 * readers currently pass `cellDates: false`), and already-ISO dates.
 */
export function normalizeDate(value: string | number | Date | null): string | null {
  if (value === null || value === undefined) return null;

  // Already a parsed Date (e.g. from a SheetJS reader with cellDates: true) —
  // read its calendar fields directly rather than round-tripping through a string.
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  // A genuine numeric Excel serial passed as a JS number rather than a string
  // (guarded to the same plausible range as the string form below).
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 25000 && value <= 60000) {
      return excelSerialToIso(Math.floor(value)) ?? String(value);
    }
    return String(value);
  }

  const raw = value.trim();
  if (!raw) return null;

  // Already ISO: YYYY-MM-DD, optionally followed by a time-of-day component
  // ("2026-05-01 18:04:11" or "2026-05-16 09:14:30.000000" with fractional
  // seconds) — the field is a date, so the time is simply dropped.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Excel serial number, optionally with a fractional time-of-day part
  // (pure number in plausible range 25000–60000 ≈ 1968–2064). The range guard
  // keeps a genuine numeric ID from being mistaken for a serial date.
  const serialMatch = raw.match(/^(\d{4,5})(?:\.\d+)?$/);
  if (serialMatch) {
    const n = parseInt(serialMatch[1], 10);
    if (n >= 25000 && n <= 60000) return excelSerialToIso(n) ?? raw;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY  (day first assumed for Arabic data)
  const numMatch = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (numMatch) {
    const [, d, m, y0] = numMatch;
    let y = y0;
    if (y.length === 2) y = parseInt(y, 10) >= 50 ? `19${y}` : `20${y}`;
    const day = parseInt(d, 10), month = parseInt(m, 10), year = parseInt(y, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    // Day-first is syntactically impossible (the "month" slot is 13-31, which
    // can never be a real month) but the month-first reading IS valid — the
    // only unambiguous interpretation left. This never touches the genuinely
    // ambiguous both-valid case (e.g. "03/04/2026"), which stays gated behind
    // the day-first check above and is completely unaffected.
    if (day >= 1 && day <= 12 && month >= 13 && month <= 31) {
      return `${year}-${pad2(day)}-${pad2(month)}`;
    }
  }

  // DDMmmYYYY or DD/Mmm/YYYY or DD-Mmm-YYYY (e.g. 12Dec2025, 12/Dec/2025)
  const mixedMatch = raw.match(/^(\d{1,2})[/\-.]?([A-Za-z\u0600-\u06ff]+)[/\-.]?(\d{2,4})$/);
  if (mixedMatch) {
    const [, d, monthStr, y] = mixedMatch;
    const key = monthStr.toLowerCase().substring(0, 3);
    const month = ENGLISH_MONTHS[key] ?? ARABIC_MONTHS[monthStr];
    if (month) {
      let year = parseInt(y, 10);
      if (y.length === 2) year = year >= 50 ? 1900 + year : 2000 + year;
      return `${year}-${pad2(month)}-${pad2(parseInt(d, 10))}`;
    }
  }

  // Arabic month name: "12 ديسمبر 2025"
  for (const [arMonth, monthNum] of Object.entries(ARABIC_MONTHS)) {
    const arMatch = raw.match(new RegExp(`(\\d{1,2})\\s*${arMonth}\\s*(\\d{2,4})`));
    if (arMatch) {
      let year = parseInt(arMatch[2], 10);
      if (arMatch[2].length === 2) year = year >= 50 ? 1900 + year : 2000 + year;
      return `${year}-${pad2(monthNum)}-${pad2(parseInt(arMatch[1], 10))}`;
    }
  }

  return raw; // return as-is if no format matched
}

export function normalizeResultValue(
  value: string | null
): "سليمة" | "اشتباه" | null {
  const normalizedValue = normalizeArabicText(value);

  if (!normalizedValue) {
    return null;
  }

  // Numeric codes: 1 = سليمة, 2 = اشتباه
  if (normalizedValue === "1") return "سليمة";
  if (normalizedValue === "2") return "اشتباه";

  // Leading numeric code with a parenthesised label, e.g. "2 (اشتباه)" /
  // "1 (سليمة)". The agency's own numeric code is its authoritative encoding,
  // so it takes precedence over whatever text follows in parentheses.
  const leadingCodeMatch = normalizedValue.match(/^(\d+)\s*\(/);
  if (leadingCodeMatch) {
    if (leadingCodeMatch[1] === "1") return "سليمة";
    if (leadingCodeMatch[1] === "2") return "اشتباه";
  }

  // English codes
  const upper = normalizedValue.toUpperCase();
  if (upper === "CLEAR" || upper === "OK" || upper === "PASS") return "سليمة";
  if (upper === "ALERT" || upper === "FAIL" || upper === "SUSPECT") return "اشتباه";

  // Arabic text — match on substring (handles "سليمة - 123" etc.).
  //
  // IMPORTANT — check اشتباه (suspect) BEFORE سليم (clear). Real BI values can
  // be compound and contain BOTH tokens, e.g. "نتيجة اشتباه -مبدئي (سليمة)"
  // ("suspicion result — preliminary (clear)"). Neither docs/reference/
  // APP_AUDIT_MODEL.md nor DEPARTMENT_GLOSSARY.md explicitly defines what a
  // compound value like this means (an initial suspicion later cleared, vs.
  // still a recorded suspicion) — checked both and the ambiguity is not
  // resolved there. Checking سليم first used to let a value the risk agency
  // recorded as اشتباه silently resolve to سليمة, which is a wrong audit
  // outcome, not a cosmetic bug. Given the ambiguity, this picks the SAFE
  // reading for an audit app: never let a recorded suspicion be silently
  // downgraded to "clear", so اشتباه wins whenever both tokens are present.
  if (
    normalizedValue.includes("اشتباه") ||
    normalizedValue.includes("مريب") ||
    normalizedValue.includes("مشبوه")
  ) {
    return "اشتباه";
  }

  if (
    normalizedValue.includes("سليم") ||
    normalizedValue.includes("نظيف") ||
    normalizedValue.includes("مقبول")
  ) {
    return "سليمة";
  }

  return null;
}

const DIAGNOSTIC_RAW_VALUE_MAX_LENGTH = 40;

/**
 * How many dropped rows get a per-row diagnostic reason before falling back to
 * the shared constant below. The report surfaces at most 3 examples per cause
 * bucket, so this is generous; the cap exists purely to bound allocation on a
 * wholesale-drop month (see the OOM guard at the invalid-level push site).
 */
const DIAGNOSTIC_DETAILED_ROW_LIMIT = 50;

/**
 * Shared, interned fallback used once DIAGNOSTIC_DETAILED_ROW_LIMIT is hit.
 * Deliberately carries no `[L1]`/`[L2]` tag so it lands in the report's
 * "other" bucket rather than misattributing a cause it did not measure.
 */
const INVALID_LEVEL_REASON_UNDETAILED = "Invalid level result (تفاصيل إضافية محذوفة)";

/** Truncates a raw offending value for inclusion in a dropped-row diagnostic
 *  reason — long free-text cells (or an entire merged paragraph landing in the
 *  wrong column) must not blow up the reason string or the exported report. */
function truncateForDiagnostics(raw: string | null): string {
  if (raw === null) return "<فارغ/غير موجود>";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "<فارغ/غير موجود>";
  return collapsed.length > DIAGNOSTIC_RAW_VALUE_MAX_LENGTH
    ? `${collapsed.slice(0, DIAGNOSTIC_RAW_VALUE_MAX_LENGTH)}…`
    : collapsed;
}

/**
 * Builds a self-diagnosing reason for a row dropped by the "valid L1 and L2
 * required" gate (see the test "a row missing valid L1 or L2 is still
 * excluded" and `decisionFactTable.ts`'s "population entry requires valid L1
 * and L2" — this is a deliberate, tested invariant, not a bug). Historically
 * this only recorded the fixed string "Invalid level 1 or level 2 result",
 * which gave a 100%-drop report no way to distinguish "the level-1 column
 * isn't recognized at all" from "a handful of rows have a genuinely garbled
 * value" — the two have very different fixes (alias list vs. source data).
 *
 * The `[L1]` / `[L2]` / `[L1+L2]` tag is a stable, parseable prefix —
 * `PopulationProcessingReport.tsx`'s "most common cause" summary reads it
 * back out. Keep the tag format in sync if this changes.
 */
function describeInvalidLevelReason(params: {
  levelOneRaw: string | null;
  levelOneValid: boolean;
  levelTwoRaw: string | null;
  levelTwoValid: boolean;
}): string {
  const { levelOneRaw, levelOneValid, levelTwoRaw, levelTwoValid } = params;
  const tag = !levelOneValid && !levelTwoValid ? "L1+L2" : !levelOneValid ? "L1" : "L2";

  const parts: string[] = [];
  if (!levelOneValid) {
    parts.push(`xrayLevelOneResult="${truncateForDiagnostics(levelOneRaw)}"`);
  }
  if (!levelTwoValid) {
    parts.push(`xrayLevelTwoResult="${truncateForDiagnostics(levelTwoRaw)}"`);
  }

  return `Invalid level result [${tag}]: ${parts.join("; ")}`;
}

function createRemovedRow(
  reason: string,
  row: NormalizedRiskRow | PreparedDraftRow
): RemovedPopulationRow {
  return {
    reason,
    xrayImageId: row.xrayImageId ?? null,
    portName: row.portName ?? null,
    sourceSheetName: row.sourceSheetName ?? null,
    sourceRowNumber: row.sourceRowNumber ?? null
  };
}

function toPreparedDraftRow(row: NormalizedRiskRow): PreparedDraftRow {
  return {
    stage: row.stage,
    xrayImageId: normalizeXrayId(row.xrayImageId),
    xrayEntryDate: normalizeDate(row.xrayEntryDate),

    portCode: row.portCode,
    portType: row.portType,
    portName: row.portName,

    declarationNumber: row.declarationNumber,
    transitDeclarationNumber: row.transitDeclarationNumber,
    declarationDate: normalizeDate(row.declarationDate),
    declarationHijriDate: row.declarationHijriDate,

    manifestNumber: row.manifestNumber,
    manifestType: row.manifestType,
    manifestDate: normalizeDate(row.manifestDate),

    plateOrContainerNumber: row.plateOrContainerNumber,
    chassisNumber: row.chassisNumber,
    finalDestination: row.finalDestination,

    xrayLevelOneResult: row.xrayLevelOneResult,
    xrayLevelTwoResult: row.xrayLevelTwoResult,

    movementType: row.movementType,
    movementNumber: row.movementNumber,
    movementDate: normalizeDate(row.movementDate),
    movementHijriDate: row.movementHijriDate,
    reportNumber: row.reportNumber,

    entryDate: normalizeDate(row.entryDate),
    exitDate: normalizeDate(row.exitDate),

    targetedByRiskEngine: row.targetedByRiskEngine,
    riskMessage: row.riskMessage,

    levelOneEmployee: null,
    levelTwoEmployee: null,

    manualResult: row.inspectorResult,
    manualResultCode: null,
    oppositeResult: row.oppositeInspectorResult,
    oppositeResultCode: null,
    oppositeEmployee: null,
    liveMeansResult: row.liveMeansResult,
    liveMeansResultCode: null,
    liveMeansEmployee: null,
    notes: null,

    rawRow: row.rawRow ?? {},
    sourceSheetName: row.sourceSheetName,
    sourceRowNumber: row.sourceRowNumber
  };
}

export function makeBiMatchKey(
  xrayImageId: string | null,
  portName: string | null
): string {
  return `${normalizeXrayId(xrayImageId)}|${normalizeArabicText(portName)}`;
}

function buildBiMatchMap(biRows: NormalizedBiRow[]): Map<string, BiMatch> {
  const map = new Map<string, BiMatch>();

  for (const row of biRows) {
    const key = makeBiMatchKey(row.xrayImageId, row.portName);

    if (!map.has(key)) {
      map.set(key, {
        row,
        key
      });
    }
  }

  return map;
}

function initializeBiFieldFillSummary(): Map<string, BiFieldFillSummary> {
  const map = new Map<string, BiFieldFillSummary>();

  for (const field of BI_FILLABLE_FIELDS) {
    map.set(field.label, {
      fieldName: field.label,
      riskEmptyBefore: 0,
      filledFromBi: 0,
      stillEmptyAfter: 0,
      fillPercentage: 0
    });
  }

  return map;
}

function enrichDraftRowFromBi(params: {
  draftRow: PreparedDraftRow;
  biMatch: BiMatch | undefined;
  biProvided: boolean;
  fieldSummaryMap: Map<string, BiFieldFillSummary>;
}): {
  row: PreparedDraftRow;
  biEnrichmentStatus: BiEnrichmentStatus;
  biMatched: boolean;
  biFilledFields: string[];
  /**
   * B7 (OOM fix, 2026-08-12): the raw-row keys BI actually added or
   * overrode, kept separate from `draftRow.rawRow` (never copied here) so the
   * caller can attach them as a lazy accessor instead of eagerly building a
   * full duplicate raw row per matched row. `null` when nothing was added —
   * distinct from `{}` only in that the caller treats both the same, but
   * `null` avoids allocating an empty object on the (very common) unmatched
   * path.
   */
  rawRowExtras: Record<string, unknown> | null;
} {
  const { draftRow, biMatch, biProvided, fieldSummaryMap } = params;

  if (!biProvided) {
    return {
      row: draftRow,
      biEnrichmentStatus: "BI Not Provided",
      biMatched: false,
      biFilledFields: [],
      rawRowExtras: null
    };
  }

  if (!biMatch) {
    for (const field of BI_FILLABLE_FIELDS) {
      if (isBlank(draftRow[field.fieldName])) {
        const summary = fieldSummaryMap.get(field.label);

        if (summary) {
          summary.riskEmptyBefore += 1;
          summary.stillEmptyAfter += 1;
        }
      }
    }

    return {
      row: draftRow,
      biEnrichmentStatus: "BI Not Matched",
      biMatched: false,
      biFilledFields: [],
      rawRowExtras: null
    };
  }

  const filledFields: string[] = [];
  // B7 (OOM fix, 2026-08-12): only the keys BI actually fills get collected
  // here — `draftRow.rawRow` itself is never spread/copied. Equivalent to the
  // old `{ ...draftRow.rawRow, ...filteredBiKeys }` merge, just deferred:
  // see `attachLazyRawRow` in populationTypes.ts for where the two are
  // actually combined (lazily, at read time).
  const rawRowExtras: Record<string, unknown> = {};
  const baseRawRow = draftRow.rawRow;
  for (const [key, val] of Object.entries(biMatch.row.rawRow ?? {})) {
    const baseVal = baseRawRow[key];
    if (
      val !== null && val !== undefined &&
      (baseVal === null || baseVal === undefined || baseVal === "")
    ) {
      rawRowExtras[key] = val;
    }
  }
  const biRow = biMatch.row;
  const fillFromBi = (
    draftValue: string | null,
    biValue: string | null
  ): string | null => (isBlank(draftValue) && hasValue(biValue) ? biValue : draftValue);

  const enrichedRow: PreparedDraftRow = {
    ...draftRow,
    // rawRow deliberately left as draftRow's own (unmerged) rawRow here —
    // the caller attaches the lazily-merged view via attachLazyRawRow using
    // rawRowExtras returned below, rather than merging eagerly on this object.
    levelOneEmployee: biRow.levelOneEmployee ?? draftRow.levelOneEmployee ?? null,
    levelTwoEmployee: biRow.levelTwoEmployee ?? draftRow.levelTwoEmployee ?? null,

    // Other-team sources: fill result/code/employee from BI only when the risk
    // value is blank (mirrors the L1/L2 BI-enrichment rule above).
    manualResult: fillFromBi(draftRow.manualResult, biRow.manualInspectionResult),
    manualResultCode: fillFromBi(draftRow.manualResultCode, biRow.manualInspectionResultCode),
    oppositeResult: fillFromBi(draftRow.oppositeResult, biRow.oppositeInspectionResult),
    oppositeResultCode: fillFromBi(draftRow.oppositeResultCode, biRow.oppositeInspectionResultCode),
    oppositeEmployee: fillFromBi(draftRow.oppositeEmployee, biRow.oppositeInspectionEmployee),
    liveMeansResult: fillFromBi(draftRow.liveMeansResult, biRow.liveMeansResult),
    liveMeansResultCode: fillFromBi(draftRow.liveMeansResultCode, biRow.liveMeansResultCode),
    liveMeansEmployee: fillFromBi(draftRow.liveMeansEmployee, biRow.liveMeansEmployee),
    notes: fillFromBi(draftRow.notes, biRow.notes),
  };

  // Hijri fields (declarationHijriDate, movementHijriDate) are deliberately excluded —
  // normalizeDate() assumes Gregorian date rules and would corrupt a Hijri value.
  const DATE_FIELDS: DraftFillableField[] = ["xrayEntryDate", "declarationDate", "movementDate"];

  for (const field of BI_FILLABLE_FIELDS) {
    const riskValue = enrichedRow[field.fieldName];
    const biValue = biMatch.row[field.biFieldName];
    const summary = fieldSummaryMap.get(field.label);

    if (isBlank(riskValue)) {
      if (summary) {
        summary.riskEmptyBefore += 1;
      }

      if (hasValue(biValue)) {
        const rawFill = normalizeText(biValue);
        enrichedRow[field.fieldName] = DATE_FIELDS.includes(field.fieldName)
          ? (normalizeDate(rawFill) ?? rawFill)
          : rawFill;
        filledFields.push(field.label);

        if (summary) {
          summary.filledFromBi += 1;
        }
      } else if (summary) {
        summary.stillEmptyAfter += 1;
      }
    }
  }

  return {
    row: enrichedRow,
    biEnrichmentStatus: "BI Matched",
    biMatched: true,
    biFilledFields: filledFields,
    rawRowExtras: Object.keys(rawRowExtras).length > 0 ? rawRowExtras : null
  };
}

function matchCertScan(params: {
  xrayImageId: string;
  portName: string | null;
  entriesByPopulationPort: Map<string, CertScanEntry[]>;
}): CertScanMatchResult {
  const { xrayImageId, portName, entriesByPopulationPort } = params;

  const portKey = normalizeText(portName);
  const entries = entriesByPopulationPort.get(portKey) ?? [];

  const snippetMatch = matchXrayIdAgainstPortEntries(xrayImageId, entries);

  if (!snippetMatch.matched) {
    return {
      certScanStatus: "NonCertscan",
      certScanSnippet: null,
      originalCertScanSnippet: null
    };
  }

  return {
    certScanStatus: "Certscan",
    certScanSnippet: snippetMatch.snippet,
    originalCertScanSnippet: snippetMatch.originalSerial
  };
}

function finalizeBiFieldFillSummary(
  fieldSummaryMap: Map<string, BiFieldFillSummary>
): BiFieldFillSummary[] {
  return Array.from(fieldSummaryMap.values()).map((summary) => ({
    ...summary,
    fillPercentage:
      summary.riskEmptyBefore === 0
        ? 0
        : Number(
            ((summary.filledFromBi / summary.riskEmptyBefore) * 100).toFixed(2)
          )
  }));
}


export async function processPopulation(
  input: PopulationProcessingInput,
  onProgress?: (stage: string, percent: number) => void
): Promise<PopulationProcessingResult> {
  const { riskWorkbookResult, biWorkbookResult, certScanPasteText } = input;

  onProgress?.("بدء معالجة المجتمع...", 0);
  await yieldToMain();

  const certScanEntries = parseCertScanPasteText(certScanPasteText);

  onProgress?.("تحليل بيانات ذكاء الأعمال...", 10);
  await yieldToMain();

  const biRows = biWorkbookResult?.rows ?? [];
  const biProvided = biRows.length > 0;
  const biMatchMap = buildBiMatchMap(biRows);
  const biFieldSummaryMap = initializeBiFieldFillSummary();

  const removedRows: RemovedPopulationRow[] = [];
  const duplicateRows: RemovedPopulationRow[] = [];
  const invalidResultRows: RemovedPopulationRow[] = [];

  const validIdRows: NormalizedRiskRow[] = [];

  onProgress?.("التحقق من معرفات الأشعة وصلاحيتها...", 20);
  await yieldToMain();

  const riskRows = riskWorkbookResult.rows;
  const validationChunkSize = 1000;
  for (let i = 0; i < riskRows.length; i += validationChunkSize) {
    const chunk = riskRows.slice(i, i + validationChunkSize);
    for (const row of chunk) {
      if (!isValidXrayImageId(row.xrayImageId)) {
        removedRows.push(createRemovedRow("Invalid X-ray ID", row));
        continue;
      }
      validIdRows.push(row);
    }
    if (riskRows.length > validationChunkSize) {
      onProgress?.(
        `التحقق من معرفات الأشعة: تم التحقق من ${Math.min(i + validationChunkSize, riskRows.length)} / ${riskRows.length} صف...`,
        Math.round(20 + (i / riskRows.length) * 15)
      );
      await yieldToMain();
    }
  }

  onProgress?.("تصفية مكررات معرفات الأشعة...", 35);
  await yieldToMain();

  const seenXrayIds = new Set<string>();
  const deduplicatedRows: NormalizedRiskRow[] = [];
  const deduplicationChunkSize = 1000;

  for (let i = 0; i < validIdRows.length; i += deduplicationChunkSize) {
    const chunk = validIdRows.slice(i, i + deduplicationChunkSize);
    for (const row of chunk) {
      const normalizedId = normalizeXrayId(row.xrayImageId);
      if (seenXrayIds.has(normalizedId)) {
        duplicateRows.push(createRemovedRow("Duplicate X-ray ID", row));
        continue;
      }
      seenXrayIds.add(normalizedId);
      deduplicatedRows.push(row);
    }
    if (validIdRows.length > deduplicationChunkSize) {
      onProgress?.(
        `تصفية المكررات: تم فحص ${Math.min(i + deduplicationChunkSize, validIdRows.length)} / ${validIdRows.length} صف...`,
        Math.round(35 + (i / validIdRows.length) * 15)
      );
      await yieldToMain();
    }
  }

  // Port index is built from the deduplicated population's own port names —
  // not just the raw CertScan port list — so port-name alignment (and the
  // exact/normalized/fuzzy tier disclosed for each) reflects the actual
  // population being matched against, not just what happens to be in the paste.
  const { entriesByPopulationPort: certScanByPort } = buildCertScanPortIndex(
    certScanEntries,
    deduplicatedRows.map((row) => row.portName)
  );

  const preparedRows: PreparedPopulationRow[] = [];

  let biMatchedRows = 0;
  let biUnmatchedRows = 0;
  let totalBiFilledFields = 0;
  let certScanRows = 0;
  let nonCertScanRows = 0;

  onProgress?.("مطابقة البيانات وتعبئة الخانات الناقصة من ذكاء الأعمال...", 50);
  await yieldToMain();

  const processingChunkSize = 500;
  for (let i = 0; i < deduplicatedRows.length; i += processingChunkSize) {
    const chunk = deduplicatedRows.slice(i, i + processingChunkSize);

    for (const riskRow of chunk) {
      const draftRow = toPreparedDraftRow(riskRow);
      const biKey = makeBiMatchKey(draftRow.xrayImageId, draftRow.portName);
      const biMatch = biMatchMap.get(biKey);

      const enrichment = enrichDraftRowFromBi({
        draftRow,
        biMatch,
        biProvided,
        fieldSummaryMap: biFieldSummaryMap
      });

      if (enrichment.biMatched) {
        biMatchedRows += 1;
      } else if (biProvided) {
        biUnmatchedRows += 1;
      }

      totalBiFilledFields += enrichment.biFilledFields.length;

      const levelOneResult = normalizeResultValue(
        enrichment.row.xrayLevelOneResult
      );
      const levelTwoResult = normalizeResultValue(
        enrichment.row.xrayLevelTwoResult
      );

      if (!levelOneResult || !levelTwoResult) {
        // OOM guard (2026-08-12): describeInvalidLevelReason builds a UNIQUE
        // string per row. The previous fixed reason was one interned literal
        // shared by every dropped row, so on a month where the level columns
        // fail wholesale — the exact case this diagnostic exists for — the
        // tagged version allocated one fresh string per dropped row and blew
        // the heap on a 500k-row population.
        //
        // The report only ever renders 3 examples per bucket, so per-row
        // detail beyond the first DIAGNOSTIC_DETAILED_ROW_LIMIT is pure waste:
        // past that point fall back to the shared constant. Row objects are
        // still pushed unconditionally, because every summary count is derived
        // from these arrays' `.length`.
        invalidResultRows.push(
          createRemovedRow(
            invalidResultRows.length < DIAGNOSTIC_DETAILED_ROW_LIMIT
              ? describeInvalidLevelReason({
                  levelOneRaw: enrichment.row.xrayLevelOneResult,
                  levelOneValid: levelOneResult !== null,
                  levelTwoRaw: enrichment.row.xrayLevelTwoResult,
                  levelTwoValid: levelTwoResult !== null
                })
              : INVALID_LEVEL_REASON_UNDETAILED,
            enrichment.row
          )
        );
        continue;
      }

      const certScanMatch = matchCertScan({
        xrayImageId: enrichment.row.xrayImageId,
        portName: enrichment.row.portName,
        entriesByPopulationPort: certScanByPort
      });

      if (certScanMatch.certScanStatus === "Certscan") {
        certScanRows += 1;
      } else {
        nonCertScanRows += 1;
      }

      const preparedRow: PreparedPopulationRow = {
        stage: enrichment.row.stage,
        xrayImageId: enrichment.row.xrayImageId,
        xrayEntryDate: enrichment.row.xrayEntryDate,

        portCode: enrichment.row.portCode,
        portType: enrichment.row.portType,
        portName: enrichment.row.portName,

        declarationNumber: enrichment.row.declarationNumber,
        transitDeclarationNumber: enrichment.row.transitDeclarationNumber,
        declarationDate: enrichment.row.declarationDate,
        declarationHijriDate: enrichment.row.declarationHijriDate,

        manifestNumber: enrichment.row.manifestNumber,
        manifestType: enrichment.row.manifestType,
        manifestDate: enrichment.row.manifestDate,

        plateOrContainerNumber: enrichment.row.plateOrContainerNumber,
        chassisNumber: enrichment.row.chassisNumber,
        finalDestination: enrichment.row.finalDestination,

        xrayLevelOneResult: levelOneResult,
        xrayLevelTwoResult: levelTwoResult,

        movementType: enrichment.row.movementType,
        movementNumber: enrichment.row.movementNumber,
        movementDate: enrichment.row.movementDate,
        movementHijriDate: enrichment.row.movementHijriDate,
        reportNumber: enrichment.row.reportNumber,

        entryDate: enrichment.row.entryDate,
        exitDate: enrichment.row.exitDate,

        targetedByRiskEngine: enrichment.row.targetedByRiskEngine,
        riskMessage: enrichment.row.riskMessage,

        certScanStatus: certScanMatch.certScanStatus,
        certScanSnippet: certScanMatch.certScanSnippet,
        originalCertScanSnippet: certScanMatch.originalCertScanSnippet,

        levelOneEmployee: enrichment.row.levelOneEmployee,
        levelTwoEmployee: enrichment.row.levelTwoEmployee,

        otherResults: {
          manual: {
            result: normalizeResultValue(enrichment.row.manualResult),
            code: enrichment.row.manualResultCode,
            employeeId: null
          },
          opposite: {
            result: normalizeResultValue(enrichment.row.oppositeResult),
            code: enrichment.row.oppositeResultCode,
            employeeId: enrichment.row.oppositeEmployee
          },
          liveMeans: {
            result: normalizeResultValue(enrichment.row.liveMeansResult),
            code: enrichment.row.liveMeansResultCode,
            employeeId: enrichment.row.liveMeansEmployee
          }
        },
        notes: enrichment.row.notes,

        biEnrichmentStatus: enrichment.biEnrichmentStatus,
        biMatched: enrichment.biMatched,
        biFilledFields: enrichment.biFilledFields,

        // rawRow attached below via attachLazyRawRow (B7, OOM fix 2026-08-12):
        // avoids eagerly copying/merging the full raw row for every row.
        rawRow: undefined,
        sourceSheetName: enrichment.row.sourceSheetName,
        sourceRowNumber: enrichment.row.sourceRowNumber
      };
      attachLazyRawRow(preparedRow, enrichment.row.rawRow, enrichment.rawRowExtras);
      preparedRows.push(preparedRow);
    }

    onProgress?.(
      `معالجة وتطبيع الصفوف: تم إنجاز ${Math.min(i + processingChunkSize, deduplicatedRows.length)} / ${deduplicatedRows.length} صف...`,
      Math.round(50 + (i / deduplicatedRows.length) * 45)
    );
    await yieldToMain();
  }

  onProgress?.("إنشاء التقرير والملخص النهائي...", 95);
  await yieldToMain();

  const finalPreparedPopulationRows = preparedRows.length;

  const result = {
    preparedRows,
    removedRows,
    duplicateRows,
    invalidResultRows,
    summary: {
      riskOriginalRows: riskWorkbookResult.totalOriginalRows,
      validRiskIdRows: validIdRows.length,
      invalidRiskIdRows: removedRows.length,

      duplicateRiskIdRows: duplicateRows.length,
      rowsAfterDeduplication: deduplicatedRows.length,

      removedInvalidResultRows: invalidResultRows.length,
      finalPreparedPopulationRows,

      certScanRows,
      nonCertScanRows,
      // W-owner-2026-08-12c: `certScanEntries` is the parsed result of
      // `certScanPasteText` (empty when nothing was pasted, or when the paste
      // had no rows / unrecognized headers) -- entries.length > 0 means at
      // least one usable CertScan device reference existed for this run.
      certScanProvided: certScanEntries.length > 0,
      certScanPercentage:
        finalPreparedPopulationRows === 0
          ? 0
          : Number(
              ((certScanRows / finalPreparedPopulationRows) * 100).toFixed(2)
            ),
      nonCertScanPercentage:
        finalPreparedPopulationRows === 0
          ? 0
          : Number(
              ((nonCertScanRows / finalPreparedPopulationRows) * 100).toFixed(2)
            ),

      biProvided,
      biMatchedRows,
      biUnmatchedRows,
      biMatchPercentage:
        biProvided && deduplicatedRows.length > 0
          ? Number(((biMatchedRows / deduplicatedRows.length) * 100).toFixed(2))
          : 0,
      totalBiFilledFields,

      biFieldFillSummary: finalizeBiFieldFillSummary(biFieldSummaryMap)
    }
  };

  onProgress?.("اكتملت معالجة المجتمع بنجاح", 100);
  await yieldToMain();

  return result;
}