// Per-port, per-month workload counts from the row-level population sheets of
// the raw workbook (one sheet per year / quarter): images received, images
// carrying an employee code, days with images, and the level-1 / level-2
// employee codes with their image counts.
//
// The reading itself is done elsewhere (scripts/lib/workloadSheets.mjs streams
// the unzipped XML in Node; the port report tool streams it in the browser).
// Both hand every row here as a column-letter → value map, so the column rules
// below exist once.
//
// Sheet layouts (verified 2026-11-04 against the results sheet's own codes):
//   2024        : no employee columns.
//   2025-Q1..Q4 : «موظف المستوى الاول» / «موظف المستوى الثاني» hold the employee
//                 CODES (the headers say employee, the cells are codes).
//   2026-Q1..Q4 : a summary row first; the real header is the row holding
//                 «رقم صورة الاشعة». «كود موظف المستوى الأول/الثاني» are codes.
//   Q4B         : «كود موظف المستوى الأول/الثاني» codes.
// An image id seen in an earlier sheet is skipped, so each image counts once.

import type { WorkloadMonthInput } from "./portWorkloadModel";

export type WorkloadSheetReport = { name: string; rows: number; coded: number; duplicates: number };
/** A month's workload plus the images either level flagged «اشتباه». */
export type WorkloadMonth = WorkloadMonthInput & { suspicion: number };
export type WorkloadRead = { months: WorkloadMonth[]; sheets: WorkloadSheetReport[] };

const ID = ["معرف الأشعة", "معرف الاشعة", "رقم صورة الاشعة"];
const DATE = ["تاريخ دخول الأشعة", "تاريخ دخول الاشعة", "تاريخ دخول للاشعة", "تاريخ الاشعة"];
const RES1 = ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الاول", "المستوى الأول"];
const RES2 = ["نتيجة المستوى الثاني", "المستوى الثاني"];
const CODE1 = ["كود موظف المستوى الأول"];
const CODE2 = ["كود موظف المستوى الثاني"];
const CODE1_2025 = ["موظف المستوى الاول", "موظف المستوى الأول"];
const CODE2_2025 = ["موظف المستوى الثاني"];
/** Result codes that are a system, not a person. */
const NON_EMPLOYEE = new Set(["X-RAY", "XRAY"]);

/** The population sheets: «2024», «2025-Q1», «Q4B». */
export const isWorkloadSheet = (name: string): boolean => /^(\d{4}(-Q\d)?|Q\dB)$/.test(name);

/** Oldest first and Q4B last, so a duplicate keeps the row from its own period sheet. */
export function orderWorkloadSheets<T>(sheets: readonly T[], nameOf: (s: T) => string): T[] {
  return [...sheets].sort((a, b) => (nameOf(a).startsWith("Q") ? 1 : 0) - (nameOf(b).startsWith("Q") ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));
}

const clean = (v: unknown): string => {
  const s = v == null ? "" : String(v).trim();
  return s === "#N/A" ? "" : s;
};

/** An Excel serial day or an ISO date string as «YYYY-MM-DD»; "" when it is neither. */
export function dayOf(v: unknown): string {
  const n = Number(v);
  if (n > 0) return new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

type Acc = { port: string; type: string; month: string; images: number; suspicion: number; coded: number; days: Set<string>; l1: Map<string, number>; l2: Map<string, number> };
type Cols = { id?: string; date?: string; port?: string; type?: string; c1?: string; c2?: string; r1?: string; r2?: string };

/** Feed each sheet's rows in order; `result()` returns the months and a per-sheet report. */
export function createWorkloadAggregator() {
  const seen = new Set<string>();
  const acc = new Map<string, Acc>();
  const report: WorkloadSheetReport[] = [];
  let sheet: WorkloadSheetReport | null = null;
  let col: Cols | null = null;
  let is2025 = false;

  return {
    startSheet(name: string): void {
      sheet = { name, rows: 0, coded: 0, duplicates: 0 };
      report.push(sheet);
      col = null;
      is2025 = /^2025/.test(name);
    },
    row(cells: Readonly<Record<string, unknown>>): void {
      if (!sheet) return;
      if (!col) {
        // The header is the first row holding the image id column.
        if (!Object.values(cells).some((v) => ID.includes(String(v).trim()))) return;
        const f = (hs: string[]) => Object.keys(cells).find((k) => hs.includes(String(cells[k]).trim()));
        col = { id: f(ID), date: f(DATE), port: f(["اسم المنفذ"]), type: f(["نوع المنفذ"]), c1: f(is2025 ? CODE1_2025 : CODE1), c2: f(is2025 ? CODE2_2025 : CODE2), r1: f(RES1), r2: f(RES2) };
        return;
      }
      const at = (k?: string) => (k ? cells[k] : undefined);
      const id = clean(at(col.id));
      if (id) {
        if (seen.has(id)) { sheet.duplicates++; return; }
        seen.add(id);
      }
      const port = clean(at(col.port));
      const day = dayOf(at(col.date));
      if (!port || !day) return;
      sheet.rows++;
      const key = `${port}|${day.slice(0, 7)}`;
      let a = acc.get(key);
      if (!a) {
        a = { port, type: clean(at(col.type)), month: day.slice(0, 7), images: 0, suspicion: 0, coded: 0, days: new Set(), l1: new Map(), l2: new Map() };
        acc.set(key, a);
      }
      a.images++;
      // An image is «اشتباه» when either level flagged it.
      if (clean(at(col.r1)) === "اشتباه" || clean(at(col.r2)) === "اشتباه") a.suspicion++;
      a.days.add(day);
      const c1 = clean(at(col.c1));
      const c2 = clean(at(col.c2));
      const ok1 = c1 !== "" && !NON_EMPLOYEE.has(c1.toUpperCase());
      const ok2 = c2 !== "" && !NON_EMPLOYEE.has(c2.toUpperCase());
      if (ok1 || ok2) { a.coded++; sheet.coded++; }
      // Per-employee image counts, so an employee working several ports can be
      // apportioned by their share of each port's work.
      if (ok1) a.l1.set(c1, (a.l1.get(c1) ?? 0) + 1);
      if (ok2) a.l2.set(c2, (a.l2.get(c2) ?? 0) + 1);
    },
    result(): WorkloadRead {
      const months = [...acc.values()].map((a): WorkloadMonth => ({ ...a, days: [...a.days], l1: Object.fromEntries(a.l1), l2: Object.fromEntries(a.l2) }));
      return { months, sheets: report };
    },
  };
}
