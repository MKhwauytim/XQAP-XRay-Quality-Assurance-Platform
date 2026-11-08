// Port workload model for the redesigned port business report.
//
// Input: per-port, per-month population counts (images received, images that
// carry an employee code, days with images, distinct level-1 / level-2 codes),
// produced from the row-level population sheets.
//
// Definitions (agreed with the owner, 2026-11-04):
//   • Employees are shared: one reviewer examines images from many ports. A
//     head count per port (anyone who touched one image) made small ports look
//     staffed by hundreds and their per-employee load collapse to ~1 image. So
//     each employee is APPORTIONED: in a month, an employee who did 90% of their
//     examinations at port A counts as 0.9 of an employee there. The port's
//     «equivalent employees» (FTE) = Σ employee share of that month's work.
//   • Images per employee per month — the port's examinations (each image is
//     examined at level 1 and level 2) ÷ its equivalent employees, per month,
//     averaged over the port's months with reliable codes. This is the workload
//     measure the tiers are built on (see buildWorkloadTiers).
//   • Images per employee per day — the same, ÷ days the port received images.
//   • Months whose coded share is under RELIABLE_CODE_SHARE are left out of the
//     per-employee figures: dividing all images by the few coded employees there
//     would inflate them. Each year carries its coded share so the gap is visible.

import type { OutcomeStats, PortStudyRow } from "./portReportModel";

export type WorkloadMonthInput = {
  port: string;
  type: string;
  month: string; // YYYY-MM
  images: number;
  coded: number;
  days: readonly string[];
  /** Level-1 / level-2 employee code → images they examined at this port that month. */
  l1: Readonly<Record<string, number>>;
  l2: Readonly<Record<string, number>>;
};

/** Each employee's examinations per month across ALL ports: month → code → count. */
type EmployeeTotals = Map<string, Map<string, number>>;

function employeeTotals(months: readonly WorkloadMonthInput[]): EmployeeTotals {
  const t: EmployeeTotals = new Map();
  for (const m of months) {
    const mt = t.get(m.month) ?? new Map<string, number>();
    for (const rec of [m.l1, m.l2]) for (const [c, n] of Object.entries(rec)) mt.set(c, (mt.get(c) ?? 0) + n);
    t.set(m.month, mt);
  }
  return t;
}

/** Employees with fewer examinations than this over the whole period are left out of every workload figure. */
export const MIN_EMPLOYEE_EXAMS = 30;

/** An employee is part of a port's staff in a month only with at least this many of its images that month. */
export const MIN_MONTHLY_EXAMS = 30;

/**
 * The workload is measured on this year only. 2024 carries no employee codes,
 * and the 2026 population sheets are incomplete: from January a port receives a
 * fraction of its 2025 images, and from March most rows carry no code. Dividing
 * those months by their staff would understate the load.
 */
export const LOAD_YEAR = "2025";

/** A month counts toward per-employee figures only when this share of its images carries a code. */
export const RELIABLE_CODE_SHARE = 0.5;

export type EmployeeLoad = {
  /** Codes of the people counted (for tier-level distinct totals). */
  peopleCodes?: string[];
  /** Images that received a level result from an automated-means specialist, in the counted months. */
  examined?: number;
  employees: number | null;
  employeesPerMonth: number | null;
  perEmployeeMonth: number | null;
  perEmployeeDay: number | null;
  l1Employees: number | null;
  l2Employees: number | null;
  l1PerDay: number | null;
  l2PerDay: number | null;
  /** Mean cases per assigned level-1 / level-2 employee per month (same staff rule as perEmployeeMonth). */
  l1PerMonth: number | null;
  l2PerMonth: number | null;
};

export type PortWorkloadYear = EmployeeLoad & { year: number; images: number; coded: number; codedShare: number | null; months: number };

export type PortWorkload = EmployeeLoad & {
  port: string;
  type: string;
  images: number;
  months: number;
  imagesPerMonth: number;
  codedShare: number | null;
  years: PortWorkloadYear[];
};

export type WorkloadTierKey = "low" | "mid" | "high";

export type WorkloadTier = {
  key: WorkloadTierKey;
  label: string;
  from: number;
  to: number;
  ports: PortWorkload[];
  /** Per port type: this tier's [from, to] range of the workload measure. */
  ranges: Record<string, [number, number]>;
  /** Per port type: the average workload the bands are built around. */
  averages: Record<string, number>;
  /** Mean of the tier's ports for each figure. */
  avg: { images: number; imagesPerMonth: number } & EmployeeLoad;
};

const TIER_LABELS: Record<WorkloadTierKey, string> = { low: "منخفض", mid: "متوسط", high: "عالي" };

const mean = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function employeeLoad(months: readonly WorkloadMonthInput[], totals: EmployeeTotals, year?: string): EmployeeLoad {
  const ok = months.filter((m) => (!year || m.month.startsWith(year)) && m.images > 0 && m.coded / m.images >= RELIABLE_CODE_SHARE);
  if (!ok.length) {
    return { employees: null, employeesPerMonth: null, perEmployeeMonth: null, perEmployeeDay: null, l1Employees: null, l2Employees: null, l1PerDay: null, l2PerDay: null, l1PerMonth: null, l2PerMonth: null };
  }
  void totals;
  // Assigned staff (owner's rule, 2026-11-04): in a month, an employee belongs to a port only
  // when they examined at least MIN_MONTHLY_EXAMS of its images that month — the people who
  // work the port, not someone who passed through for a handful of images.
  const assigned = (m: WorkloadMonthInput) => {
    const all = new Map<string, number>();
    for (const rec of [m.l1, m.l2]) for (const [c, n] of Object.entries(rec)) all.set(c, (all.get(c) ?? 0) + n);
    return new Set([...all].filter(([, n]) => n >= MIN_MONTHLY_EXAMS).map(([c]) => c));
  };
  const perMonth = ok.map((m) => {
    const staff = assigned(m);
    const examsOf = (rec: Readonly<Record<string, number>>) => Object.entries(rec).filter(([c]) => staff.has(c)).reduce((a, [, n]) => a + n, 0);
    const levelStaff = (rec: Readonly<Record<string, number>>) => Object.keys(rec).filter((c) => staff.has(c)).length;
    const e1 = examsOf(m.l1), e2 = examsOf(m.l2);
    const s1 = levelStaff(m.l1), s2 = levelStaff(m.l2);
    const days = Math.max(1, m.days.length);
    return {
      staff,
      fte: staff.size,
      fte1: s1,
      fte2: s2,
      perEmp: staff.size > 0 ? (e1 + e2) / staff.size : null,
      l1Month: s1 > 0 ? e1 / s1 : null,
      l2Month: s2 > 0 ? e2 / s2 : null,
      l1Day: s1 > 0 ? e1 / s1 / days : null,
      l2Day: s2 > 0 ? e2 / s2 / days : null,
      days,
    };
  });
  // Everyone who examined at least one of the port's images in these months.
  const people = new Set<string>();
  for (const m of ok) for (const rec of [m.l1, m.l2]) Object.keys(rec).forEach((c) => people.add(c));
  return {
    peopleCodes: [...people],
    examined: ok.reduce((a, m) => a + m.coded, 0),
    /** Distinct people who examined at least one image here (they may also work elsewhere). */
    employees: people.size,
    employeesPerMonth: mean(perMonth.map((x) => x.fte)),
    perEmployeeMonth: mean(perMonth.map((x) => x.perEmp)),
    perEmployeeDay: mean(perMonth.map((x) => (x.perEmp === null ? null : x.perEmp / x.days))),
    l1Employees: mean(perMonth.map((x) => x.fte1)),
    l2Employees: mean(perMonth.map((x) => x.fte2)),
    l1PerDay: mean(perMonth.map((x) => x.l1Day)),
    l2PerDay: mean(perMonth.map((x) => x.l2Day)),
    l1PerMonth: mean(perMonth.map((x) => x.l1Month)),
    l2PerMonth: mean(perMonth.map((x) => x.l2Month)),
  };
}

/** Group monthly rows into one PortWorkload per (already canonical) port name. */
export function buildPortWorkloads(input: readonly WorkloadMonthInput[]): PortWorkload[] {
  // Drop employees with fewer than MIN_EMPLOYEE_EXAMS examinations in the whole period.
  const grand = new Map<string, number>();
  for (const m of input) for (const rec of [m.l1, m.l2]) for (const [c, n] of Object.entries(rec)) grand.set(c, (grand.get(c) ?? 0) + n);
  const keep = (rec: Readonly<Record<string, number>>) => Object.fromEntries(Object.entries(rec).filter(([c]) => (grand.get(c) ?? 0) >= MIN_EMPLOYEE_EXAMS));
  const months = input.map((m) => ({ ...m, l1: keep(m.l1), l2: keep(m.l2) }));
  const totals = employeeTotals(months);
  const byPort = new Map<string, WorkloadMonthInput[]>();
  for (const m of months) {
    const list = byPort.get(m.port) ?? [];
    list.push(m);
    byPort.set(m.port, list);
  }
  return [...byPort.entries()].map(([port, ms]) => {
    const images = ms.reduce((s, m) => s + m.images, 0);
    const coded = ms.reduce((s, m) => s + m.coded, 0);
    const monthKeys = new Set(ms.map((m) => m.month));
    const byYear = new Map<number, WorkloadMonthInput[]>();
    for (const m of ms) {
      const y = Number(m.month.slice(0, 4));
      const list = byYear.get(y) ?? [];
      list.push(m);
      byYear.set(y, list);
    }
    const years: PortWorkloadYear[] = [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, ys]) => {
        const yi = ys.reduce((s, m) => s + m.images, 0);
        const yc = ys.reduce((s, m) => s + m.coded, 0);
        return { year, images: yi, coded: yc, codedShare: yi ? yc / yi : null, months: new Set(ys.map((m) => m.month)).size, ...employeeLoad(ys, totals) };
      });
    // The port's type: the value carried by most of its images.
    const typeCount = new Map<string, number>();
    for (const m of ms) if (m.type) typeCount.set(m.type, (typeCount.get(m.type) ?? 0) + m.images);
    const type = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return { port, type, images, months: monthKeys.size, imagesPerMonth: images / Math.max(1, monthKeys.size), codedShare: images ? coded / images : null, years, ...employeeLoad(ms, totals, ms.some((m) => m.month.startsWith(LOAD_YEAR)) ? LOAD_YEAR : undefined) };
  });
}

/**
 * How far from the all-ports average a port may sit and still be «متوسط»:
 * 0.5 → from half the average to one and a half times it.
 */
export const AVERAGE_BAND = 0.5;

/**
 * Three tiers around the average workload per employee (owner's rule,
 * 2026-11-04): about the average = medium, below it = low, above it = high.
 * «About» is ± AVERAGE_BAND of the average. The workload measure is images per
 * employee per month, which combines the port's images, its employees and
 * their monthly output; ports with no employee data are left out (see
 * unratedPorts).
 */
/** A port needs at least this many employees a month (on average) to be tiered: below it, a few images over a fraction of one employee give a meaningless load. */
export const MIN_STAFF_PER_MONTH = 1;

export const workloadMeasure = (p: PortWorkload): number | null =>
  p.employeesPerMonth !== null && p.employeesPerMonth >= MIN_STAFF_PER_MONTH ? p.perEmployeeMonth : null;

export function unratedPorts(ports: readonly PortWorkload[]): PortWorkload[] {
  return ports.filter((p) => workloadMeasure(p) === null);
}

export function buildWorkloadTiers(all: readonly PortWorkload[]): WorkloadTier[] {
  const ports = all.filter((p) => workloadMeasure(p) !== null);
  if (!ports.length) return [];
  const measure = (p: PortWorkload) => workloadMeasure(p) as number;
  // Each port type (land / sea) is tiered against its own average, then the tiers are merged.
  const types = [...new Set(ports.map((p) => p.type))];
  const bandOf = new Map<string, { lo: number; hi: number; avg: number }>();
  for (const t of types) {
    const v = ports.filter((p) => p.type === t).map(measure);
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    bandOf.set(t, { avg, lo: avg * (1 - AVERAGE_BAND), hi: avg * (1 + AVERAGE_BAND) });
  }
  const keys: WorkloadTierKey[] = ["low", "mid", "high"];
  const tierIdx = (p: PortWorkload) => { const b = bandOf.get(p.type)!; const v = measure(p); return v < b.lo ? 0 : v > b.hi ? 2 : 1; };
  const idx = (_v: number) => 0;
  void idx;
  const bounds: Array<[number, number]> = [[0, 0], [0, 0], [0, 0]];
  return keys.map((key, i) => {
    const tp = ports.filter((p) => tierIdx(p) === i).sort((a, b) => a.type.localeCompare(b.type) || measure(b) - measure(a));
    const ranges = Object.fromEntries(types.map((t) => { const b = bandOf.get(t)!; return [t, i === 0 ? [0, b.lo] : i === 1 ? [b.lo, b.hi] : [b.hi, Infinity]]; })) as Record<string, [number, number]>;
    const f = (g: (p: PortWorkload) => number | null) => mean(tp.map(g));
    return {
      key,
      label: TIER_LABELS[key],
      from: bounds[i][0],
      to: bounds[i][1],
      ports: tp,
      ranges,
      averages: Object.fromEntries(types.map((t) => [t, bandOf.get(t)!.avg])) as Record<string, number>,
      avg: {
        images: f((p) => p.images) ?? 0,
        imagesPerMonth: f((p) => p.imagesPerMonth) ?? 0,
        employees: f((p) => p.employees),
        employeesPerMonth: f((p) => p.employeesPerMonth),
        perEmployeeMonth: f((p) => p.perEmployeeMonth),
        perEmployeeDay: f((p) => p.perEmployeeDay),
        l1Employees: f((p) => p.l1Employees),
        l2Employees: f((p) => p.l2Employees),
        l1PerDay: f((p) => p.l1PerDay),
        l2PerDay: f((p) => p.l2PerDay),
        l1PerMonth: f((p) => p.l1PerMonth),
        l2PerMonth: f((p) => p.l2PerMonth),
      },
    };
  });
}

export function tierOf(tiers: readonly WorkloadTier[], port: string): WorkloadTier | undefined {
  return tiers.find((t) => t.ports.some((p) => p.port === port));
}

/** Study outcomes for a set of ports (slide 4: performance by workload tier). */
export function outcomesFor(studies: readonly PortStudyRow[], ports: ReadonlySet<string>): { image: OutcomeStats; l1: OutcomeStats; l2: OutcomeStats } {
  const empty = (): OutcomeStats => ({ studied: 0, trueSuspicion: 0, falseSuspicion: 0, missed: 0, trueClear: 0, matched: 0, accuracy: null });
  const image = empty(), l1 = empty(), l2 = empty();
  const add = (o: OutcomeStats, status: string, match: boolean) => {
    o.studied++;
    if (match) o.matched++;
    if (status === "اشتباه صحيح") o.trueSuspicion++;
    else if (status === "اشتباه خاطئ") o.falseSuspicion++;
    else if (status === "اشتباه فائت") o.missed++;
    else if (status === "سليمة صحيحة") o.trueClear++;
  };
  for (const r of studies) {
    if (!ports.has(r.port)) continue;
    add(image, r.imageStatus, r.imageMatch);
    if (r.l1) add(l1, r.l1.status, r.l1.match);
    if (r.l2) add(l2, r.l2.status, r.l2.match);
  }
  for (const o of [image, l1, l2]) o.accuracy = o.studied ? o.matched / o.studied : null;
  return { image, l1, l2 };
}

export type LevelOutcomes = { image: OutcomeStats; l1: OutcomeStats; l2: OutcomeStats };

/** Per study year: the selected port's outcomes and each workload tier's (selected port excluded). */
export function outcomesByYear(studies: readonly PortStudyRow[], selected: string, tiers: readonly WorkloadTier[]): Array<{ year: number; selected: LevelOutcomes; tiers: Partial<Record<WorkloadTierKey, LevelOutcomes>> }> {
  const years = [...new Set(studies.map((r) => r.year).filter((y): y is number => y !== null))].sort((a, b) => a - b);
  return years.map((year) => {
    const rows = studies.filter((r) => r.year === year);
    const byTier: Partial<Record<WorkloadTierKey, LevelOutcomes>> = {};
    for (const t of tiers) byTier[t.key] = outcomesFor(rows, new Set(t.ports.map((p) => p.port).filter((p) => p !== selected)));
    return { year, selected: outcomesFor(rows, new Set([selected])), tiers: byTier };
  });
}
