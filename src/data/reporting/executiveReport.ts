import type { ExecutiveReportInput } from "./executiveReportTypes";
import { buildExecutiveWorkbook } from "./executive/workbook/workbook";

// ─── Main builder (re-exported from the new dark-navy viewer module) ──────────
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";

/**
 * Build & download the executive workbook (`.xlsx`). Re-pointed to the new
 * `executive/workbook` builder (design §7 — full raw → processed → analytical
 * chain). The signature is unchanged so the Reports tab keeps working; pass an
 * optional username→display-name map for reviewer columns when available.
 */
export function buildExecutiveXlsx(
  input: ExecutiveReportInput,
  employeeDisplayNames?: Record<string, string>
): void {
  buildExecutiveWorkbook(input, employeeDisplayNames);
}
