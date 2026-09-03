/**
 * صور الأشعة المحالة (X-ray Referrals) — «معلقة» (on-hold / pending) export +
 * re-import support.
 *
 * "معلقة" is not a stored status: it is a UI-derived label
 * (`isNoImageSubmission` in `../answers/noImageAnswer.ts`) computed from a
 * SUBMITTED answer whose "هل يوجد صورة" field is "لا". The template makes
 * every other answer field optional the moment that happens, so there is
 * nothing wrong with the ANSWER for these items — the reviewer correctly
 * reported "no image" and stopped. What is plausibly wrong/missing is the
 * underlying POPULATION row's identifying/logistics data (port, dates,
 * declaration/chassis numbers, movement type...) that the reviewer needed to
 * actually locate the physical x-ray. That is why this module's export/import
 * targets `PreparedPopulationRow` fields, not answer fields — see
 * `populationCorrections.ts` for the write side and the edit-log entry for the
 * full design-decision writeup.
 *
 * `CORRECTABLE_POPULATION_FIELDS` deliberately excludes every PIPELINE-COMPUTED
 * field a mirror row also carries (`xrayLevelOneResult`, `xrayLevelTwoResult`,
 * `certScanStatus`, `biEnrichmentStatus`, `targetedByRiskEngine`, `riskMessage`,
 * `stage`) — those are derived by processing/risk-engine logic, not manually
 * data-entered, and silently overwriting them from a re-imported spreadsheet
 * would distort audit results rather than fix a data-entry mistake. Every field
 * in the list IS one of `EMPLOYEE_MIRROR_STUB_FIELDS`
 * (`../population/populationTypes.ts`), so a correction applied to it is
 * guaranteed to be visible in the exact same views that showed the row wrong.
 */

import * as XLSX from "xlsx";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { ItemAnswer } from "../answers/answerTypes";
import { isNoImageSubmission } from "../answers/noImageAnswer";
import type { TemplateSchema } from "../templates/templateTypes";
import { resolveTemplateForAnswer } from "../templates/templateAnswerResolution";
import type { EmployeeMirrorRowStub } from "./populationTypes";
import type { Labels } from "../labels/useLabels";

export const CORRECTABLE_POPULATION_FIELDS = [
  "portName",
  "portCode",
  "portType",
  "xrayEntryDate",
  "declarationNumber",
  "declarationDate",
  "plateOrContainerNumber",
  "chassisNumber",
  "movementType",
  "reportNumber",
] as const satisfies readonly (keyof EmployeeMirrorRowStub)[];

export type CorrectablePopulationField = (typeof CORRECTABLE_POPULATION_FIELDS)[number];

/** Label key for each correctable field's column header — reused for both the
 *  export sheet and the import summary, so the two always agree on wording. */
export const CORRECTABLE_FIELD_LABEL_KEYS: Record<CorrectablePopulationField, keyof Labels> = {
  portName: "col_port_name",
  portCode: "col_port_code",
  portType: "col_port_type",
  xrayEntryDate: "col_xray_entry_date",
  declarationNumber: "col_declaration_number",
  declarationDate: "col_declaration_date",
  plateOrContainerNumber: "col_plate_or_container_number",
  chassisNumber: "col_chassis_number",
  movementType: "col_movement_type",
  reportNumber: "col_report_number",
};

/** The `xrayImageId` column header — first, locked, deliberately not editable. */
export const XRAY_IMAGE_ID_HEADER = "رقم الأشعة (لا تعدّل)";

/**
 * A submitted "لا يوجد صورة" answer, and not (yet) a supervisor-finalized
 * completion. Mirrors `isOnHoldEntry` in
 * `EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` exactly (kept as a
 * separate, data-layer copy rather than importing a `.tsx` file into `src/data/`)
 * — `entry.status === "completed"` always wins over the answer content.
 */
export function isPendingReferralEntry(
  entry: DistributionEntry,
  answersMap: ReadonlyMap<string, ItemAnswer>,
  template: TemplateSchema | null,
  /** Optional: every template actually referenced by a loaded answer (see
   *  `templateAnswerResolution.ts`). Without it, an answer submitted under a
   *  since-swapped template is read against the WRONG (fallback) template's
   *  field ids and never recognized as معلقة. */
  templatesById?: ReadonlyMap<string, TemplateSchema>
): boolean {
  if (entry.status === "completed") return false;
  const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
  const rowTemplate = templatesById ? resolveTemplateForAnswer(answer, templatesById, template) : template;
  return isNoImageSubmission(answer, rowTemplate);
}

export type PendingExportRow = { xrayImageId: string } & Record<CorrectablePopulationField, string>;

/** Every currently-معلقة row's `xrayImageId` plus its correctable fields, in
 *  export-column order. Pure — the caller decides what to do with the rows
 *  (write to XLSX, render a preview, …). */
export function buildPendingExportRows(
  entries: readonly DistributionEntry[],
  answersMap: ReadonlyMap<string, ItemAnswer>,
  template: TemplateSchema | null,
  templatesById?: ReadonlyMap<string, TemplateSchema>
): PendingExportRow[] {
  return entries
    .filter((entry) => isPendingReferralEntry(entry, answersMap, template, templatesById))
    .map((entry) => {
      const row = { xrayImageId: entry.xrayImageId } as PendingExportRow;
      for (const field of CORRECTABLE_POPULATION_FIELDS) {
        row[field] = entry.row[field] ?? "";
      }
      return row;
    });
}

/**
 * Write `rows` to a downloaded `.xlsx` file — same `aoa_to_sheet` +
 * `XLSX.writeFile` pattern as `DataTable/index.tsx`'s `handleExport` and
 * `answers/employeeXlsx.ts`. `xrayImageId` is always the first column, and its
 * header spells out that it must not be edited (it is the merge key —
 * `applyPopulationFieldCorrections` in `populationCorrections.ts` ignores any
 * change to it and matches purely by the id itself).
 */
export function exportPendingCorrectionsXlsx(
  rows: readonly PendingExportRow[],
  labels: Labels,
  monthFolderName: string
): void {
  const header = [
    XRAY_IMAGE_ID_HEADER,
    ...CORRECTABLE_POPULATION_FIELDS.map((field) => labels[CORRECTABLE_FIELD_LABEL_KEYS[field]]),
  ];
  const body = rows.map((row) => [
    row.xrayImageId,
    ...CORRECTABLE_POPULATION_FIELDS.map((field) => row[field]),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "معلقة".slice(0, 31));
  XLSX.writeFile(wb, `pending-corrections-${monthFolderName}.xlsx`);
}
