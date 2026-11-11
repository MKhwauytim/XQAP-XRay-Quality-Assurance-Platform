/**
 * What leaves the app for a case: the operator's own image id, and whether the
 * case is an exceptional one («حالة استثنائية») or part of the indicator's
 * sample («مستهدف المؤشر»).
 *
 * An exceptional case is stored under a namespaced id (`ADHOC-{importId}-…`,
 * see `namespacedXrayImageId`). That prefix is a storage key, and it was
 * leaking into exported files, where it reads as a different id from the one
 * in the owner's source file. Every export goes through `exportedXrayImageId`
 * and carries the origin in its own column instead.
 *
 * The prefix is the single test for the origin: every exceptional case has it,
 * including one merged into a real month, and a case moved back to the index
 * sample gets its original id again.
 */
import { getLabels } from "../labels/labelsStore";
import { originalXrayImageIdAnyImport } from "./adhocImportModel";

export type CaseOrigin = "index" | "exceptional";

/** The id as the owner's source file has it. A real-population id is returned unchanged. */
export function exportedXrayImageId(xrayImageId: string): string {
  return originalXrayImageIdAnyImport(xrayImageId);
}

/** Null-tolerant form for optional id cells (e.g. a replacement id). */
export function exportedXrayImageIdOrNull(xrayImageId: string | null | undefined): string | null {
  return xrayImageId == null ? null : originalXrayImageIdAnyImport(xrayImageId);
}

export function caseOriginOf(xrayImageId: string): CaseOrigin {
  return originalXrayImageIdAnyImport(xrayImageId) === xrayImageId ? "index" : "exceptional";
}

/** The Arabic cell value for the «نوع الحالة» column. */
export function caseOriginLabel(xrayImageId: string): string {
  const labels = getLabels();
  return caseOriginOf(xrayImageId) === "exceptional" ? labels.case_origin_exceptional : labels.case_origin_index;
}
