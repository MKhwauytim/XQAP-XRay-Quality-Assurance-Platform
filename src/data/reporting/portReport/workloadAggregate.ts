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
// A row repeating an image id in the same month is skipped, so each image counts once.
// Transit: the 2026 sheets carry «البيان» («ترانزيت» for transit declarations).
// Every month is counted twice in the same pass, with and without transit
// images, and the transit image ids are kept so the study rows can drop them too.

import type { WorkloadMonthInput } from "./portWorkloadModel";

export type WorkloadSheetReport = { name: string; rows: number; coded: number; duplicates: number; transit: number };
/** A month's workload plus the images either level flagged «اشتباه». */
export type WorkloadMonth = WorkloadMonthInput & { suspicion: number };
export type WorkloadRead = {
  months: WorkloadMonth[];
  /** The same months with transit images left out (equal to `months` when no sheet carries «البيان»). */
  monthsNoTransit?: WorkloadMonth[];
  /** Image ids of transit declarations. */
  transitIds?: string[];
  sheets: WorkloadSheetReport[];
  /** Employee codes / names the population holds for the studied image ids (only ids passed in `codesFor`). */
  studyCodes?: Record<string, StudyCodes>;
};
/** An image's level-1 / level-2 employee code and name as the population records them. */
export type StudyCodes = { c1?: string; n1?: string; c2?: string; n2?: string };

/** «البيان» = ترانزيت marks a transit declaration. */
export const isTransitDeclaration = (v: unknown): boolean => String(v ?? "").includes("ترانزيت");

const ID = ["معرف الأشعة", "معرف الاشعة", "رقم صورة الاشعة"];
const DATE = ["تاريخ دخول الأشعة", "تاريخ الدخول", "تاريخ دخول الاشعة", "تاريخ دخول للاشعة", "تاريخ الاشعة"];
const RES1 = ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الاول", "المستوى الأول"];
const RES2 = ["نتيجة المستوى الثاني", "المستوى الثاني"];
const CODE1 = ["كود موظف المستوى الأول"];
const CODE2 = ["كود موظف المستوى الثاني"];
const CODE1_2025 = ["موظف المستوى الاول", "موظف المستوى الأول"];
const CODE2_2025 = ["موظف المستوى الثاني"];
/** «اشتباه», «إشتباة», «اشتباه-فحص يدوي», «نتيجة اشتباه -مبدئي». */
const SUSPICION = /[اإ]شتبا[هة]/;
/** Result codes that are a system, not a person. */
const NON_EMPLOYEE = new Set(["X-RAY", "XRAY"]);

/** The population sheets the report reads: «2025», «2025-Q1», «Q4B», and a quarter split by month («Q3M7»). Sheets before 2025 («2024») are skipped: 2024 is not part of the report. */
export const isWorkloadSheet = (name: string): boolean => /^(\d{4}(-Q\d)?|Q\dB|Q\dM\d{1,2})$/.test(name) && !(/^\d{4}/.test(name) && name.slice(0, 4) < "2025");

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
type Cols = { id?: string; date?: string; port?: string; type?: string; c1?: string; c2?: string; n1?: string; n2?: string; r1?: string; r2?: string; decl?: string };

/** Feed each sheet's rows in order; `result()` returns the months and a per-sheet report. */
export function createWorkloadAggregator(opts: { codesFor?: ReadonlySet<string> } = {}) {
  const studyCodes: Record<string, StudyCodes> = {};
  const seen = new Set<string>();
  const acc = new Map<string, Acc>();
  const accNoTransit = new Map<string, Acc>();
  const transitIds: string[] = [];
  const report: WorkloadSheetReport[] = [];
  let sheet: WorkloadSheetReport | null = null;
  let col: Cols | null = null;
  let is2025 = false;

  return {
    startSheet(name: string): void {
      sheet = { name, rows: 0, coded: 0, duplicates: 0, transit: 0 };
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
        col = { id: f(ID), date: f(DATE), port: f(["اسم المنفذ"]), type: f(["نوع المنفذ"]), c1: f(is2025 ? CODE1_2025 : CODE1), c2: f(is2025 ? CODE2_2025 : CODE2), n1: is2025 ? undefined : f(CODE1_2025), n2: is2025 ? undefined : f(CODE2_2025), r1: f(RES1), r2: f(RES2), decl: f(["البيان"]) };
        return;
      }
      const at = (k?: string) => (k ? cells[k] : undefined);
      const id = clean(at(col.id));
      const port = clean(at(col.port));
      const day = dayOf(at(col.date));
      if (!port || !day) return;
      // All sheets are read as one table: a duplicate is the same image id in the same month
      // (owner's rule, 2026-11-09). Each row then counts in the month of its own date, whichever sheet holds it.
      if (id) {
        const k = id + '|' + day.slice(0, 7);
        if (seen.has(k)) { sheet.duplicates++; return; }
        seen.add(k);
      }
      sheet.rows++;
      const transit = isTransitDeclaration(at(col.decl));
      if (transit) { sheet.transit++; if (id) transitIds.push(id); }
      const c1 = clean(at(col.c1));
      const c2 = clean(at(col.c2));
      const ok1 = c1 !== "" && !NON_EMPLOYEE.has(c1.toUpperCase());
      const ok2 = c2 !== "" && !NON_EMPLOYEE.has(c2.toUpperCase());
      if (ok1 || ok2) sheet.coded++;
      // Keep the population's employees for the studied images, so a study row without codes can be completed.
      // Only the 2026-layout sheets, whose «كود موظف المستوى الأول/الثاني» headers are explicit: in the 2025
      // sheets the level-1 and level-2 code columns hold the opposite code families (pending owner check).
      if (id && !is2025 && (ok1 || ok2) && opts.codesFor?.has(id)) {
        const e = studyCodes[id] ?? (studyCodes[id] = {});
        if (ok1 && !e.c1) { e.c1 = c1; e.n1 = clean(at(col.n1)) || undefined; }
        if (ok2 && !e.c2) { e.c2 = c2; e.n2 = clean(at(col.n2)) || undefined; }
      }
      // An image is «اشتباه» when either level flagged it (2026 writes «نتيجة اشتباه -مبدئي»).
      const suspicious = SUSPICION.test(clean(at(col.r1))) || SUSPICION.test(clean(at(col.r2)));
      const key = `${port}|${day.slice(0, 7)}`;
      for (const m of transit ? [acc] : [acc, accNoTransit]) {
        let a = m.get(key);
        if (!a) {
          a = { port, type: clean(at(col.type)), month: day.slice(0, 7), images: 0, suspicion: 0, coded: 0, days: new Set(), l1: new Map(), l2: new Map() };
          m.set(key, a);
        }
        a.images++;
        if (suspicious) a.suspicion++;
        a.days.add(day);
        if (ok1 || ok2) a.coded++;
        // Per-employee image counts, so an employee working several ports can be
        // apportioned by their share of each port's work.
        if (ok1) a.l1.set(c1, (a.l1.get(c1) ?? 0) + 1);
        if (ok2) a.l2.set(c2, (a.l2.get(c2) ?? 0) + 1);
      }
    },
    result(): WorkloadRead {
      const out = (m: Map<string, Acc>) => [...m.values()].map((a): WorkloadMonth => ({ ...a, days: [...a.days], l1: Object.fromEntries(a.l1), l2: Object.fromEntries(a.l2) }));
      return { months: out(acc), monthsNoTransit: out(accNoTransit), transitIds, sheets: report, studyCodes };
    },
  };
}
