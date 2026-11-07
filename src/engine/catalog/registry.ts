import type { EngineIssue } from "../errors";
import { d01Section } from "./designs/d01-section";
import { d02Kpi } from "./designs/d02-kpi";
import { d03Bars } from "./designs/d03-bars";
import { d04Table } from "./designs/d04-table";
import { d05KpiBars } from "./designs/d05-kpi-bars";
import { d06BarsNote } from "./designs/d06-bars-note";
import { d07TopRanked } from "./designs/d07-top-ranked";
import { d08KpiTable } from "./designs/d08-kpi-table";
import { d09Glossary } from "./designs/d09-glossary";
import { PLANNED } from "./designs/planned";
import type { CatalogDesign } from "./types";

/**
 * Lock rule (numbers.lock.ts): the lock is edited only to add an entry, or to add slotIds to a planned
 * entry when it becomes active. Number and nameAr are frozen for every entry; slot ids are frozen only once
 * the design is active or retired (a planned design's slots are provisional). Changing a slot of an active
 * number means retiring that number and adding a new one. Every design in CATALOG must have a lock entry
 * with the same nameAr, and an active or retired one the same slot ids.
 */
export const CATALOG: readonly CatalogDesign[] = [
  d01Section, d02Kpi, d03Bars, d04Table, d05KpiBars, d06BarsNote, d07TopRanked, d08KpiTable, d09Glossary, ...PLANNED,
];

export type GetDesignResult = { ok: true; design: CatalogDesign } | { ok: false; issue: EngineIssue };

export function getDesign(n: number, catalog: readonly CatalogDesign[] = CATALOG): GetDesignResult {
  const design = catalog.find((d) => d.number === n);
  if (!design) return { ok: false, issue: { rule: "catalog.unknownNumber", detail: String(n) } };
  if (design.status === "planned") return { ok: false, issue: { rule: "catalog.planned", detail: `${n} ${design.nameAr}` } };
  if (design.status === "retired") {
    const why = design.retiredReasonAr ? `: ${design.retiredReasonAr}` : "";
    return { ok: false, issue: { rule: "catalog.retired", detail: `${n} ${design.nameAr}${why}` } };
  }
  return { ok: true, design };
}

export function activeDesigns(catalog: readonly CatalogDesign[] = CATALOG): CatalogDesign[] {
  return catalog.filter((d) => d.status === "active").sort((a, b) => a.number - b.number);
}
