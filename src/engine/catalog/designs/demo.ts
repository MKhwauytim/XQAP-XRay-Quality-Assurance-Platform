import type { DatasetDef, RawFile } from "../../data/types";
import type { IssueEnv } from "../../issue/issueReport";
import { layoutOnly } from "../../issue/issueReport";
import type { LayoutDoc } from "../../layout/types";
import { formatIssue } from "../../messages";
import type { IssueParams, MeasureSpec } from "../../spec/types";
import { buildSpecFromPicks } from "../bind";
import type { PickBinding, PicksBase, SlotBinding } from "../bind";
import type { CatalogDesign } from "../types";
import { NOTE_SLOT } from "./shared";

/**
 * Illustrative demo data for catalog lookbooks and the catalog entry gate. Ports and months are made up;
 * no figure here is a real result, and every demo slide says so in a text box reading DEMO_NOTE.
 */
export const DEMO_NOTE = "بيانات توضيحية";


const FILE = "demo.xlsx";
const SHEET = "بيانات توضيحية";
const PORTS = [
  "منفذ الشمال", "منفذ الشرق", "منفذ الغرب", "منفذ الجنوب",
  "منفذ الوسط", "منفذ الساحل", "منفذ الجبل", "منفذ الوادي",
  "منفذ الصحراء", "منفذ الميناء", "منفذ الجسر", "منفذ البوابة",
];
const MONTHS = ["يناير", "فبراير", "مارس"];

export const DEMO_PARAMS: IssueParams = { issuedAt: "2026-11-07T09:00:00Z", values: {} };

/** 4 ports x 3 months = 12 rows (رقم الشهر orders the months); `repeat` (1 to 3) widens to 4 x repeat ports, for pagination checks. */
function demoFiles(repeat: number): RawFile[] {
  const rows: (string | number)[][] = [];
  PORTS.slice(0, 4 * repeat).forEach((port, p) => {
    MONTHS.forEach((month, m) => {
      const i = p * MONTHS.length + m;
      const count = 120 + ((i * 37) % 90);
      rows.push([port, month, m + 1, count, count - ((i * 7) % 19) - 3]);
    });
  });
  return [{
    fileName: FILE,
    bytesSha256: "d".repeat(64),
    sheets: [{ sheetName: SHEET, headers: ["المنفذ", "الشهر", "رقم الشهر", "العدد", "المطابق"], rows }],
  }];
}

const col = (id: string, label: string, type: "text" | "number") => ({
  source: { file: FILE, sheet: SHEET, header: label },
  id, label, type,
  role: type === "number" ? ("measure" as const) : ("dimension" as const),
  level: type === "number" ? ("quantitative" as const) : ("nominal" as const),
});

const DATASET: DatasetDef = {
  id: "demo",
  label: "بيانات توضيحية",
  files: [FILE],
  columns: [col("port", "المنفذ", "text"), col("month", "الشهر", "text"), col("monthNo", "رقم الشهر", "number"), col("count", "العدد", "number"), col("matched", "المطابق", "number")],
  steps: [],
};

const int = { kind: "int" as const, digits: 0 };
const MEASURES: MeasureSpec[] = [
  { id: "studied", label: "الحاويات المدروسة", datasetId: "demo", formula: "sum([العدد])", format: int },
  { id: "matched", label: "الحاويات المطابقة", datasetId: "demo", formula: "sum([المطابق])", format: int },
  { id: "matchRate", label: "نسبة المطابقة", datasetId: "demo", formula: "@matched / @studied", format: { kind: "pct", digits: 1 } },
  { id: "ports", label: "المنافذ", datasetId: "demo", formula: "distinctCount([المنفذ])", format: int },
  { id: "monthOrder", label: "ترتيب الشهر", datasetId: "demo", formula: "min([رقم الشهر])", format: int },
];

/** Per design: the pick title and slot bindings. The note slot is added for every design. */
const PICKS: Record<number, { title: string; slots: Record<string, SlotBinding> }> = {
  1: {
    title: "قراءة نتائج المطابقة",
    slots: { heading: { text: "نتائج المطابقة في المنافذ" }, description: { text: "قراءة لنسب المطابقة حسب المنفذ والشهر" } },
  },
  2: {
    title: "بلغت نسبة المطابقة {{measure:matchRate}} في الربع",
    slots: { kpi1: { measure: "studied" }, kpi2: { measure: "matched" }, kpi3: { measure: "ports" } },
  },
  3: {
    title: "نسبة المطابقة {{measure:matchRate}} عبر المنافذ",
    slots: { category: { field: "port" }, value: { measure: "matchRate" } },
  },
  4: {
    title: "{{measure:studied}} حاوية مدروسة حسب المنفذ والشهر",
    slots: { row1: { field: "month" }, row2: { field: "port" }, rowOrder: { measure: "monthOrder" }, value1: { measure: "studied" }, value2: { measure: "matched" }, value3: { measure: "matchRate" } },
  },
  5: {
    title: "نسبة المطابقة {{measure:matchRate}} في المنافذ الأربعة",
    slots: { kpi1: { measure: "studied" }, kpi2: { measure: "matched" }, kpi3: { measure: "ports" }, category: { field: "port" }, value: { measure: "studied" } },
  },
};

export function demoInputs(design: CatalogDesign, opts: { repeat?: number } = {}): { base: PicksBase; binding: PickBinding; files: RawFile[] } {
  const pick = PICKS[design.number];
  if (pick === undefined) throw new Error(`no demo pick for design ${design.number}`);
  const base: PicksBase = {
    reportId: `catalogDemo${design.number}`,
    title: `${design.nameAr}: ${DEMO_NOTE}`,
    datasets: [structuredClone(DATASET)],
    model: { measures: structuredClone(MEASURES) },
    params: [],
  };
  const binding: PickBinding = { number: design.number, title: pick.title, slots: { ...pick.slots, [NOTE_SLOT.id]: { text: DEMO_NOTE } } };
  return { base, binding, files: demoFiles(Math.min(3, Math.max(1, opts.repeat ?? 1))) };
}

/** The design's demo layout, as the gate test and the lookbook see it. Throws with the Arabic message on refusal. */
export function renderDesignDemo(design: CatalogDesign, env: IssueEnv, opts: { repeat?: number } = {}): LayoutDoc {
  const { base, binding, files } = demoInputs(design, opts);
  const built = buildSpecFromPicks([design.number], [binding], base, [design]);
  if (!built.ok) throw new Error(built.issues.map((i) => formatIssue(i)).join("\n"));
  const r = layoutOnly(built.spec, files, DEMO_PARAMS, env);
  if (!r.ok) throw new Error(r.issues.map((i) => formatIssue(i)).join("\n"));
  return r.doc;
}
