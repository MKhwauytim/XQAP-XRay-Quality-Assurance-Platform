import type { NormalizedBiRow } from "../biData/biDataTypes";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import {
  normalizeCertScanPortName,
  normalizeCertScanXrayId,
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

type PreparedDraftRow = {
  stage: string | null;
  xrayImageId: string;
  xrayEntryDate: string | null;

  portCode: string | null;
  portType: string | null;
  portName: string | null;

  declarationNumber: string | null;
  declarationDate: string | null;

  plateOrContainerNumber: string | null;
  chassisNumber: string | null;

  xrayLevelOneResult: string | null;
  xrayLevelTwoResult: string | null;

  movementType: string | null;
  reportNumber: string | null;

  targetedByRiskEngine: string | null;
  riskMessage: string | null;

  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

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
  | "plateOrContainerNumber"
  | "chassisNumber"
  | "xrayLevelOneResult"
  | "xrayLevelTwoResult";

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
  }
];

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeArabicText(value: unknown): string {
  return normalizeText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function normalizeXrayId(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function isBlank(value: unknown): boolean {
  return normalizeText(value) === "";
}

function hasValue(value: unknown): boolean {
  return !isBlank(value);
}

function isValidXrayImageId(value: string | null): boolean {
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
  // Excel epoch: Dec 30, 1899. JS epoch: Jan 1, 1970. Diff = 25569 days.
  // Excel incorrectly treats 1900 as a leap year, so subtract 1 for dates after Feb 28 1900.
  const adjusted = serial > 59 ? serial - 1 : serial;
  const ms = (adjusted - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Normalize diverse date representations to YYYY-MM-DD.
 * Handles: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DDMMMYYYY, DD/MMM/YYYY,
 * Excel serial numbers, and already-ISO dates.
 */
export function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Excel serial number (pure number in plausible range 25000–60000 ≈ 1968–2064)
  if (/^\d{4,5}$/.test(raw)) {
    const n = parseInt(raw, 10);
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

  // English codes
  const upper = normalizedValue.toUpperCase();
  if (upper === "CLEAR" || upper === "OK" || upper === "PASS") return "سليمة";
  if (upper === "ALERT" || upper === "FAIL" || upper === "SUSPECT") return "اشتباه";

  // Arabic text — match on prefix substring (handles "سليمة - 123" etc.)
  if (
    normalizedValue.includes("سليم") ||
    normalizedValue.includes("نظيف") ||
    normalizedValue.includes("مقبول")
  ) {
    return "سليمة";
  }

  if (
    normalizedValue.includes("اشتباه") ||
    normalizedValue.includes("مريب") ||
    normalizedValue.includes("مشبوه")
  ) {
    return "اشتباه";
  }

  return null;
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
    declarationDate: normalizeDate(row.declarationDate),

    plateOrContainerNumber: row.plateOrContainerNumber,
    chassisNumber: row.chassisNumber,

    xrayLevelOneResult: row.xrayLevelOneResult,
    xrayLevelTwoResult: row.xrayLevelTwoResult,

    movementType: row.movementType,
    reportNumber: row.reportNumber,

    targetedByRiskEngine: row.targetedByRiskEngine,
    riskMessage: row.riskMessage,

    levelOneEmployee: null,
    levelTwoEmployee: null,

    rawRow: row.rawRow ?? {},
    sourceSheetName: row.sourceSheetName,
    sourceRowNumber: row.sourceRowNumber
  };
}

function makeBiMatchKey(
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
} {
  const { draftRow, biMatch, biProvided, fieldSummaryMap } = params;

  if (!biProvided) {
    return {
      row: draftRow,
      biEnrichmentStatus: "BI Not Provided",
      biMatched: false,
      biFilledFields: []
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
      biFilledFields: []
    };
  }

  const filledFields: string[] = [];
  const enrichedRawRow = { ...draftRow.rawRow };
  for (const [key, val] of Object.entries(biMatch.row.rawRow ?? {})) {
    if (val !== null && val !== undefined && (enrichedRawRow[key] === null || enrichedRawRow[key] === undefined || enrichedRawRow[key] === "")) {
      enrichedRawRow[key] = val;
    }
  }
  const enrichedRow: PreparedDraftRow = {
    ...draftRow,
    rawRow: enrichedRawRow,
    levelOneEmployee: biMatch?.row?.levelOneEmployee ?? draftRow.levelOneEmployee ?? null,
    levelTwoEmployee: biMatch?.row?.levelTwoEmployee ?? draftRow.levelTwoEmployee ?? null,
  };

  const DATE_FIELDS: DraftFillableField[] = ["xrayEntryDate", "declarationDate"];

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
    biFilledFields: filledFields
  };
}

function groupCertScanByPort(
  entries: CertScanEntry[]
): Map<string, CertScanEntry[]> {
  const map = new Map<string, CertScanEntry[]>();

  for (const entry of entries) {
    const key = normalizeCertScanPortName(entry.portName);
    const currentEntries = map.get(key) ?? [];

    currentEntries.push(entry);
    map.set(key, currentEntries);
  }

  return map;
}

function matchCertScan(params: {
  xrayImageId: string;
  portName: string | null;
  certScanByPort: Map<string, CertScanEntry[]>;
}): CertScanMatchResult {
  const { xrayImageId, portName, certScanByPort } = params;

  const portKey = normalizeCertScanPortName(portName);
  const entries = certScanByPort.get(portKey) ?? [];

  if (entries.length === 0) {
    return {
      certScanStatus: "NonCertscan",
      certScanSnippet: null,
      originalCertScanSnippet: null
    };
  }

  const cleanedXrayId = normalizeCertScanXrayId(xrayImageId);

  const matchedSnippets: string[] = [];
  const matchedOriginalSerials: string[] = [];

  for (const entry of entries) {
    const entryMatchedSnippets = entry.snippets.filter((snippet) =>
      cleanedXrayId.includes(snippet)
    );

    if (entryMatchedSnippets.length > 0) {
      matchedSnippets.push(...entryMatchedSnippets);
      matchedOriginalSerials.push(entry.originalSystemSerialNumber);
    }
  }

  const uniqueMatchedSnippets = Array.from(new Set(matchedSnippets));
  const uniqueMatchedOriginalSerials = Array.from(
    new Set(matchedOriginalSerials)
  );

  if (uniqueMatchedSnippets.length === 0) {
    return {
      certScanStatus: "NonCertscan",
      certScanSnippet: null,
      originalCertScanSnippet: null
    };
  }

  return {
    certScanStatus: "Certscan",
    certScanSnippet: uniqueMatchedSnippets.join(" | "),
    originalCertScanSnippet: uniqueMatchedOriginalSerials.join(" | ")
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

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function processPopulation(
  input: PopulationProcessingInput,
  onProgress?: (stage: string, percent: number) => void
): Promise<PopulationProcessingResult> {
  const { riskWorkbookResult, biWorkbookResult, certScanPasteText } = input;

  onProgress?.("بدء معالجة المجتمع...", 0);
  await yieldToMain();

  const certScanEntries = parseCertScanPasteText(certScanPasteText);
  const certScanByPort = groupCertScanByPort(certScanEntries);

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
        invalidResultRows.push(
          createRemovedRow("Invalid level 1 or level 2 result", enrichment.row)
        );
        continue;
      }

      const certScanMatch = matchCertScan({
        xrayImageId: enrichment.row.xrayImageId,
        portName: enrichment.row.portName,
        certScanByPort
      });

      if (certScanMatch.certScanStatus === "Certscan") {
        certScanRows += 1;
      } else {
        nonCertScanRows += 1;
      }

      preparedRows.push({
        stage: enrichment.row.stage,
        xrayImageId: enrichment.row.xrayImageId,
        xrayEntryDate: enrichment.row.xrayEntryDate,

        portCode: enrichment.row.portCode,
        portType: enrichment.row.portType,
        portName: enrichment.row.portName,

        declarationNumber: enrichment.row.declarationNumber,
        declarationDate: enrichment.row.declarationDate,

        plateOrContainerNumber: enrichment.row.plateOrContainerNumber,
        chassisNumber: enrichment.row.chassisNumber,

        xrayLevelOneResult: levelOneResult,
        xrayLevelTwoResult: levelTwoResult,

        movementType: enrichment.row.movementType,
        reportNumber: enrichment.row.reportNumber,

        targetedByRiskEngine: enrichment.row.targetedByRiskEngine,
        riskMessage: enrichment.row.riskMessage,

        certScanStatus: certScanMatch.certScanStatus,
        certScanSnippet: certScanMatch.certScanSnippet,
        originalCertScanSnippet: certScanMatch.originalCertScanSnippet,

        levelOneEmployee: enrichment.row.levelOneEmployee,
        levelTwoEmployee: enrichment.row.levelTwoEmployee,

        biEnrichmentStatus: enrichment.biEnrichmentStatus,
        biMatched: enrichment.biMatched,
        biFilledFields: enrichment.biFilledFields,

        rawRow: enrichment.row.rawRow,
        sourceSheetName: enrichment.row.sourceSheetName,
        sourceRowNumber: enrichment.row.sourceRowNumber
      });
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