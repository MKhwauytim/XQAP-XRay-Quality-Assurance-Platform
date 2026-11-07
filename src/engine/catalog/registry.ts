import type { EngineIssue } from "../errors";
import type { CatalogDesign } from "./types";

/**
 * Lock rule (numbers.lock.ts): the lock is edited only to add an entry. Changing a slot of a published
 * number means retiring that number and adding a new one. Every design in CATALOG must have a lock entry
 * with the same nameAr and the same slot ids.
 */
export const CATALOG: readonly CatalogDesign[] = [];

export type GetDesignResult = { ok: true; design: CatalogDesign } | { ok: false; issue: EngineIssue };

export function getDesign(n: number, catalog: readonly CatalogDesign[] = CATALOG): GetDesignResult {
  const design = catalog.find((d) => d.number === n);
  if (!design) return { ok: false, issue: { rule: "catalogUnknownNumber", detail: String(n) } };
  if (design.status === "planned") return { ok: false, issue: { rule: "catalogPlanned", detail: `${n} ${design.nameAr}` } };
  if (design.status === "retired") {
    const why = design.retiredReasonAr ? `: ${design.retiredReasonAr}` : "";
    return { ok: false, issue: { rule: "catalogRetired", detail: `${n} ${design.nameAr}${why}` } };
  }
  return { ok: true, design };
}

export function activeDesigns(catalog: readonly CatalogDesign[] = CATALOG): CatalogDesign[] {
  return catalog.filter((d) => d.status === "active").sort((a, b) => a.number - b.number);
}
