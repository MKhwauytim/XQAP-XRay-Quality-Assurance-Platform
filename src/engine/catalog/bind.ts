import type { DatasetDef, FilterSpec } from "../data/types";
import type { EngineIssue } from "../errors";
import { SLOT_PLACEHOLDER } from "../text";
import type { IssueParams, PageSpec, ReportSpec, VisualSpec, WellItem, WellRole } from "../spec/types";
import { validateSpec } from "../spec/validate";
import { CATALOG, getDesign } from "./registry";
import type { CatalogDesign, CatalogVisual, SlotDecl } from "./types";

export type SlotBinding = { field: string } | { measure: string } | { text: string };

export interface PickBinding {
  number: number;
  title: string;
  slots: Record<string, SlotBinding>;
  filters?: FilterSpec[];
}

export interface PicksBase {
  reportId: string;
  title: string;
  datasets: DatasetDef[];
  model: ReportSpec["model"];
  params: ReportSpec["params"];
  filters?: FilterSpec[];
}

export type BindResult = { ok: true; spec: ReportSpec } | { ok: false; issues: EngineIssue[] };

const where = (d: CatalogDesign, s?: SlotDecl): string => `${d.number} ${d.nameAr}${s ? ` | ${s.nameAr}` : ""}`;

/** Which binding shapes a slot kind accepts. A text slot may also take a measure, shown as its figure placeholder. */
function accepts(slot: SlotDecl, b: SlotBinding): boolean {
  if (slot.kind === "dimension") return "field" in b;
  if (slot.kind === "measure") return "measure" in b;
  return "text" in b || "measure" in b;
}

function textFor(b: SlotBinding): string {
  if ("text" in b) return b.text;
  if ("measure" in b) return `{{measure:${b.measure}}}`;
  return "";
}

function bindVisual(v: CatalogVisual, bound: Map<string, SlotBinding>, design: CatalogDesign, flagged: Set<string>, issues: EngineIssue[]): VisualSpec | undefined {
  const flag = (slotId: string): void => {
    if (flagged.has(slotId)) return;
    flagged.add(slotId);
    issues.push({ rule: "bind.wrongKind", detail: where(design, design.slots.find((s) => s.id === slotId)) });
  };
  const wells: VisualSpec["wells"] = {};
  let hollow = false;
  for (const [role, refs] of Object.entries(v.wells) as [WellRole, { slot: string }[]][]) {
    const items: WellItem[] = [];
    for (const ref of refs) {
      if (design.slots.find((s) => s.id === ref.slot)?.kind === "text") {
        flag(ref.slot);
        continue;
      }
      const b = bound.get(ref.slot);
      if (b === undefined) continue; // unbound required slots are reported once per design
      if ("field" in b) items.push({ field: b.field });
      else if ("measure" in b) items.push({ measure: b.measure });
      else flag(ref.slot);
    }
    if (refs.length > 0 && items.length === 0) hollow = true;
    wells[role] = items;
  }
  // A well emptied by unbound optional slots would render nothing, so the whole visual is dropped.
  if (hollow) return undefined;
  const out: VisualSpec = { ...v, wells };
  if (v.text !== undefined) {
    let substituted = false;
    out.text = v.text.replace(SLOT_PLACEHOLDER, (_m, id: string) => {
      substituted = true;
      const b = bound.get(id);
      return b === undefined ? "" : textFor(b);
    });
    if (substituted) out.text = out.text.replace(/[^\S\n]{2,}/g, " ").trim();
  }
  return out;
}

function bindPick(design: CatalogDesign, pick: PickBinding, index: number, issues: EngineIssue[]): PageSpec {
  const bound = new Map<string, SlotBinding>();
  const flagged = new Set<string>();
  for (const slot of design.slots) {
    const b = pick.slots[slot.id];
    if (b === undefined) {
      if (slot.required) issues.push({ rule: "bind.missingSlot", detail: where(design, slot) });
    } else if (!accepts(slot, b)) {
      flagged.add(slot.id);
      issues.push({ rule: "bind.wrongKind", detail: where(design, slot) });
    } else bound.set(slot.id, b);
  }
  const waived = design.overrules?.some((o) => o.rule === "R8") ?? false;
  if (!waived && !pick.title.includes("{{measure:")) {
    issues.push({ rule: "bind.titleNoFigure", detail: where(design) });
  }
  const page: PageSpec = {
    pageId: `p${index + 1}-d${design.number}`,
    title: pick.title,
    size: "16:9",
    grid: design.page.grid,
    visuals: design.page.visuals
      .map((v) => bindVisual(v, bound, design, flagged, issues))
      .filter((v): v is VisualSpec => v !== undefined),
  };
  if (pick.filters !== undefined) page.filters = pick.filters;
  return page;
}

/** Placeholder values so validateSpec checks structure only; real values arrive at issue time. */
function probeParams(params: ReportSpec["params"]): IssueParams {
  const values: IssueParams["values"] = {};
  for (const p of params) values[p.id] = p.type === "number" ? 0 : p.type === "month" ? "2000-01" : "x";
  return { issuedAt: "2000-01-01T00:00:00Z", values };
}

/** Collects every issue across all picks, then runs validateSpec on the finished spec. */
export function buildSpecFromPicks(
  numbers: number[],
  bindings: PickBinding[],
  base: PicksBase,
  catalog: readonly CatalogDesign[] = CATALOG,
): BindResult {
  const issues: EngineIssue[] = [];
  const pages: PageSpec[] = [];
  const pageDesigns: CatalogDesign[] = [];
  numbers.forEach((n, i) => {
    const d = getDesign(n, catalog);
    if (!d.ok) {
      issues.push(d.issue);
      return;
    }
    const pick = bindings.find((b) => b.number === n);
    if (pick === undefined) {
      issues.push({ rule: "bind.missingPick", detail: where(d.design) });
      return;
    }
    pages.push(bindPick(d.design, pick, i, issues));
    pageDesigns.push(d.design);
  });
  if (issues.length > 0) return { ok: false, issues };
  const spec: ReportSpec = {
    schemaVersion: 1,
    reportId: base.reportId,
    title: base.title,
    theme: "deck3",
    datasets: base.datasets,
    model: base.model,
    params: base.params,
    pages,
  };
  if (base.filters !== undefined) spec.filters = base.filters;
  const problems = validateSpec(spec, undefined, probeParams(base.params));
  if (problems.length === 0) return { ok: true, spec };
  // Names, not ids: tie each page-scoped problem back to the design it came from.
  const named = problems.map((p): EngineIssue => {
    const m = /^pages\[(\d+)\]/.exec(p.path ?? "");
    const design = m ? pageDesigns[Number(m[1])] : undefined;
    if (design === undefined) return p;
    return { ...p, detail: p.detail === undefined ? where(design) : `${where(design)} | ${p.detail}` };
  });
  return { ok: false, issues: named };
}
