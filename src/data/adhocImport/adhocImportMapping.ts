import * as XLSX from "xlsx";

import { normalizeRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataNormalizer";
import type { NormalizedRiskRow, RiskSourceRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { worksheetToSourceRows } from "../workbook/worksheetRows";
import { DEFAULT_MAPPING_TEMPLATE, loadPopulationConfig } from "../population/populationConfig";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { AdhocImportRow, AdhocImportRowValidation } from "./adhocImportTypes";

/** The only two literal values `PreparedPopulationRow.xrayLevelOneResult` / `xrayLevelTwoResult` accept. */
const VALID_RESULT_VALUES = new Set(["سليمة", "اشتباه"]);

/**
 * Resolves the "active" column-mapping template exactly the way the real
 * Population tab does (`config.mappingTemplates[0] ?? DEFAULT_MAPPING_TEMPLATE`
 * — see `Population/components/columnMappingHints.ts`), so an admin who
 * customized column aliases for the regular pipeline gets the same aliases
 * here without any separate configuration screen.
 */
export async function loadActiveColumnMappings(
  directoryHandle: DirectoryHandleLike | null
): Promise<Record<string, string[]>> {
  const config = await loadPopulationConfig(directoryHandle);
  const template = config.mappingTemplates[0] ?? DEFAULT_MAPPING_TEMPLATE;
  return template.columnMappings;
}

function validateMappedRow(mapped: NormalizedRiskRow): AdhocImportRowValidation {
  if (!mapped.xrayImageId || mapped.xrayImageId.trim() === "") {
    return { valid: false, reason: "لا يوجد معرّف أشعة (xrayImageId) لهذا الصف." };
  }
  if (!mapped.xrayLevelOneResult || !VALID_RESULT_VALUES.has(mapped.xrayLevelOneResult)) {
    return { valid: false, reason: "نتيجة المستوى الأول مفقودة أو غير صالحة (يجب أن تكون \"سليمة\" أو \"اشتباه\")." };
  }
  if (!mapped.xrayLevelTwoResult || !VALID_RESULT_VALUES.has(mapped.xrayLevelTwoResult)) {
    return { valid: false, reason: "نتيجة المستوى الثاني مفقودة أو غير صالحة (يجب أن تكون \"سليمة\" أو \"اشتباه\")." };
  }
  return { valid: true };
}

/**
 * Parses every worksheet of an arbitrary Excel file and maps each row using
 * `normalizeRiskRow` (the same normalizer the real risk-data ingest uses) —
 * NOT the full `processRiskWorkbook` pipeline, which also does BI
 * correlation, sheet-name movement-type detection, and CertScan matching
 * that don't apply to a one-off ad-hoc file. Every worksheet is treated as
 * data (no sheet-name filtering) since an ad-hoc file has no fixed shape.
 *
 * Duplicate `xrayImageId` values (after the first occurrence) are excluded —
 * the distribution event log is keyed on a single xrayImageId per row, so a
 * duplicate would otherwise silently overwrite the row's mirror on assign.
 */
export async function parseAdhocImportFile(
  file: File,
  columnMappings: Record<string, string[]>
): Promise<AdhocImportRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    WTF: false,
  });

  const rows: AdhocImportRow[] = [];
  const seenIds = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const sourceRows = worksheetToSourceRows<RiskSourceRow>(XLSX.utils, worksheet);
    for (const { row, sourceRowNumber } of sourceRows) {
      const mapped = normalizeRiskRow({
        sourceRow: row,
        movementType: sheetName,
        sourceSheetName: sheetName,
        sourceRowNumber,
        columnMappings,
      });
      // rawRow is dropped before this leaves the mapping step — an ad-hoc
      // import persists its review state to disk (adhocImportStorage.ts),
      // and the raw source row would roughly double the file size for no
      // reader that needs it (mirrors populationTypes.ts's stripRawRow).
      delete mapped.rawRow;

      let validation = validateMappedRow(mapped);
      if (validation.valid && seenIds.has(mapped.xrayImageId as string)) {
        validation = { valid: false, reason: "معرّف أشعة مكرر ضمن نفس الملف — تم استبعاد التكرار." };
      } else if (validation.valid) {
        seenIds.add(mapped.xrayImageId as string);
      }

      rows.push({
        rowKey: `${sheetName}:${sourceRowNumber}`,
        mapped,
        validation,
        excludedByAdmin: false,
        assigned: false,
        assignedTo: null,
        assignedAt: null,
        namespacedXrayImageId: null,
      });
    }
  }

  return rows;
}
