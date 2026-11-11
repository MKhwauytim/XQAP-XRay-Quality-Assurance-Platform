// Port business report — source adapter.
//
// Turns the two sheets of the report workbook into PortReportInput:
//   «نتائج الدراسة» — one row per studied image (row-level)
//   «المجتمع الكامل» — the full-population pivot (images per port, اشتباه / سليمة)
// Columns are located by header text, never by position, so a re-ordered
// export still parses. Takes plain header+rows arrays (what SheetJS
// `sheet_to_json(ws, { header: 1 })` returns) so it stays free of xlsx.

import type { PortPopulationRow, PortReportInput, PortStudyLevel, PortStudyRow } from "./portReportModel";

export const STUDY_SHEET = "نتائج الدراسة";
export const POPULATION_SHEET = "المجتمع الكامل";

type Cell = unknown;
type Rows = readonly (readonly Cell[])[];

const str = (v: Cell): string => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: Cell): number => {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : 0;
};

function headerIndex(header: readonly Cell[], names: readonly string[]): number {
  const h = header.map(str);
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function requireCols(header: readonly Cell[], spec: Record<string, readonly string[]>, sheet: string): Record<string, number> {
  const out: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, names] of Object.entries(spec)) {
    out[key] = headerIndex(header, names);
    if (out[key] < 0) missing.push(names[0]);
  }
  if (missing.length) throw new Error(`«${sheet}»: أعمدة مفقودة — ${missing.join("، ")}`);
  return out;
}

const STUDY_COLS = {
  inPeriod: ["ضمن فترة التقرير"],
  port: ["المنفذ الموحد"],
  group: ["المجموعة", "نوع المنفذ2", "نوع المنفذ"],
  year: ["سنة التقاط الصورة"],
  month: ["شهر الدخول"],
  imageStatus: ["حالة نتيجة الصورة"],
  imageMatch: ["توائم الصورة"],
  l1Code: ["كود موظف المستوى الأول"],
  l1Name: ["موظف المستوى الأول"],
  l1Status: ["حالة المستوى الأول"],
  l1Match: ["توائم المستوى الأول"],
  l2Code: ["كود موظف المستوى الثاني"],
  l2Name: ["موظف المستوى الثاني"],
  l2Status: ["حالة المستوى الثاني"],
  l2Match: ["توائم المستوى الثاني"],
} as const;

const NO_RESULT = "بدون نتيجة";

function level(row: readonly Cell[], code: number, name: number, status: number, match: number): PortStudyLevel | null {
  const s = str(row[status]);
  if (!s || s === NO_RESULT) return null;
  return { code: str(row[code]), name: str(row[name]), status: s, match: num(row[match]) === 1 };
}

/** «مصدر أكواد الموظفين»: where the study row's employee codes were copied from. */
export const CODE_SOURCE_COL = "مصدر أكواد الموظفين";
/**
 * The 2025 population sheets (2025-Q1 … 2025-Q4) hold the level-2 employee in the column headed level 1
 * and the reverse (owner confirmed 2026-11-10; the original study file and every 2026 sheet put the K/C
 * code family at level 1 and the A family at level 2). Study rows whose codes came from those sheets
 * have their level-1 and level-2 employees exchanged back; each level keeps its own result.
 */
export const SWAPPED_SOURCE = /2025-Q[1-4]/;

function levels(row: readonly Cell[], c: Record<keyof typeof STUDY_COLS, number>, swap: boolean): { l1: PortStudyLevel | null; l2: PortStudyLevel | null } {
  const l1 = level(row, swap ? c.l2Code : c.l1Code, swap ? c.l2Name : c.l1Name, c.l1Status, c.l1Match);
  const l2 = level(row, swap ? c.l1Code : c.l2Code, swap ? c.l1Name : c.l2Name, c.l2Status, c.l2Match);
  return { l1, l2 };
}

export const STUDY_ID_COLS = ["رقم صورة الاشعة", "رقم صورة الأشعة", "معرف الأشعة", "معرف الاشعة"];

/**
 * Rows outside the report period («ضمن فترة التقرير» ≠ نعم) are dropped, and the same image id in the same
 * entry month keeps its first row, so a study counted twice in the sheet counts once.
 */
export function parseStudyRows(rows: Rows, stats?: { duplicates: number }): PortStudyRow[] {
  if (rows.length === 0) return [];
  const c = requireCols(rows[0], STUDY_COLS, STUDY_SHEET);
  const iId = headerIndex(rows[0], STUDY_ID_COLS);
  const iSrc = headerIndex(rows[0], [CODE_SOURCE_COL]);
  const seen = new Set<string>();
  const out: PortStudyRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const port = str(r[c.port]);
    if (!port || str(r[c.inPeriod]) !== "نعم") continue;
    const id = iId >= 0 ? str(r[iId]) : "";
    if (id) {
      const k = id + "|" + str(r[c.month]);
      if (seen.has(k)) { if (stats) stats.duplicates++; continue; }
      seen.add(k);
    }
    const y = num(r[c.year]);
    out.push({
      ...(id ? { id } : {}),
      port,
      group: str(r[c.group]),
      year: y > 0 ? y : null,
      monthKey: str(r[c.month]),
      imageStatus: str(r[c.imageStatus]),
      imageMatch: num(r[c.imageMatch]) === 1,
      ...levels(r, c, iSrc >= 0 && SWAPPED_SOURCE.test(str(r[iSrc]))),
    });
  }
  return out;
}

/**
 * Reads the «المجتمع الكامل» pivot: a header row «المجموعة | المنفذ | اشتباه |
 * سليمة | Grand Total», the group name only on its first port row (blank
 * below it), and «… Total» subtotal rows, which are skipped.
 */
export function parsePopulationRows(rows: Rows): PortPopulationRow[] {
  // A workbook without the pivot (population supplied another way) has no rows here.
  if (rows.length === 0) return [];
  const h = rows.findIndex((r) => ["المجموعة", "نوع المنفذ"].includes(str(r[0])) && str(r[1]) === "المنفذ");
  if (h < 0) throw new Error(`«${POPULATION_SHEET}»: صف العناوين (المجموعة | المنفذ) غير موجود`);
  const header = rows[h].map(str);
  const iSusp = header.indexOf("اشتباه");
  const iTotal = header.indexOf("Grand Total");
  if (iSusp < 0 || iTotal < 0) throw new Error(`«${POPULATION_SHEET}»: أعمدة مفقودة - اشتباه، Grand Total`);
  const out: PortPopulationRow[] = [];
  let group = "";
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const g = str(r[0]);
    if (g.endsWith("Total")) continue;
    if (g) group = g;
    const port = str(r[1]);
    const total = num(r[iTotal]);
    if (!port || total <= 0) continue;
    out.push({ port, group, total, suspicion: num(r[iSusp]) });
  }
  return out;
}

export function portReportInputFromSheets(
  sheets: Record<string, Rows | undefined>,
  periodLabel: string,
): PortReportInput {
  return {
    studies: parseStudyRows(sheets[STUDY_SHEET] ?? []),
    population: parsePopulationRows(sheets[POPULATION_SHEET] ?? []),
    periodLabel,
  };
}
