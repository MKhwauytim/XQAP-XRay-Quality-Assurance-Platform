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

/**
 * An employee whose cases in a port-month are below this share of that month's average is
 * «far below the average»: those employees are pooled (see pooledMean).
 */
export const POOL_SHARE = 0.1;

/**
 * Average cases per employee with the far-below employees pooled. The average over everyone
 * is taken first; employees under POOL_SHARE of it are set aside; the rest give the real
 * average, and the set-aside cases count as (their cases ÷ that average) equivalent employees.
 * Example: 50 employees with 400 cases each and 100 with 2 each → the plain average is 135, the
 * pooled one 400 (the 200 small cases are half an employee).
 */
export function pooledMean(counts: readonly number[]): { mean: number | null; core: number; equivalent: number } {
  const v = counts.filter((n) => n > 0);
  if (!v.length) return { mean: null, core: 0, equivalent: 0 };
  const plain = v.reduce((a, b) => a + b, 0) / v.length;
  const core = v.filter((n) => n >= plain * POOL_SHARE);
  const coreMean = core.reduce((a, b) => a + b, 0) / core.length;
  const small = v.filter((n) => n < plain * POOL_SHARE).reduce((a, b) => a + b, 0);
  return { mean: coreMean, core: core.length, equivalent: core.length + small / coreMean };
}

/**
 * The workload is measured on this year only. 2024 carries no employee codes,
 * and the 2026 population sheets are incomplete: from January a port receives a
 * fraction of its 2025 images, and from March most rows carry no code. Dividing
 * those months by their staff would understate the load.
 */
export const LOAD_YEAR = "2025";

/** A month counts toward per-employee figures only when this share of its images carries a code. */
export const RELIABLE_CODE_SHARE = 0.5;

/** Examinations and equivalent employees summed over the counted months (cases per employee = n / eq). */
export type PoolTotals = { n: number; eq: number };

export type EmployeeLoad = {
  /** Sums behind the per-employee figures, so groups of ports combine as Σn / Σeq. */
  pool?: { all: PoolTotals; l1: PoolTotals; l2: PoolTotals };
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
  /** The year the staff and workload are measured on (LOAD_YEAR, or the report's own year when it covers one year). */
  loadYear?: string;
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
  // Staff (owner's rule, 2026-11-08): every employee who examined at least one of the port's
  // images in the month counts in its headcount. The cases per employee are pooledMean(): the
  // employees far below the month's average (a handful of cases) are combined into equivalent
  // employees instead of each counting as one, which would drag the average down.
  const perMonth = ok.map((m) => {
    const all = new Map<string, number>();
    for (const rec of [m.l1, m.l2]) for (const [c, n] of Object.entries(rec)) all.set(c, (all.get(c) ?? 0) + n);
    const v = [...all.values()], v1 = Object.values(m.l1), v2 = Object.values(m.l2);
    const p = pooledMean(v);
    const p1 = pooledMean(v1);
    const p2 = pooledMean(v2);
    const tot = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const days = Math.max(1, m.days.length);
    return {
      fte: all.size,
      fte1: Object.keys(m.l1).length,
      fte2: Object.keys(m.l2).length,
      perEmp: p.mean,
      l1Month: p1.mean,
      l2Month: p2.mean,
      l1Day: p1.mean === null ? null : p1.mean / days,
      l2Day: p2.mean === null ? null : p2.mean / days,
      days,
      n: tot(v), eq: p.mean === null ? 0 : p.equivalent,
      n1: tot(v1), eq1: p1.mean === null ? 0 : p1.equivalent,
      n2: tot(v2), eq2: p2.mean === null ? 0 : p2.equivalent,
    };
  });
  // Cases per employee over the period = all examinations ÷ all equivalent employees (owner's
  // check, 2026-11-09): averaging each month's mean and then weighting levels differently let the
  // overall figure fall below both levels. As a ratio of sums the overall always sits with its levels.
  const sumOf = (g: (x: (typeof perMonth)[number]) => number) => perMonth.reduce((a, x) => a + g(x), 0);
  const pool = { all: { n: sumOf((x) => x.n), eq: sumOf((x) => x.eq) }, l1: { n: sumOf((x) => x.n1), eq: sumOf((x) => x.eq1) }, l2: { n: sumOf((x) => x.n2), eq: sumOf((x) => x.eq2) } };
  const ratio = (t: PoolTotals) => (t.eq > 0 ? t.n / t.eq : null);
  // Everyone who examined at least one of the port's images in these months.
  const people = new Set<string>();
  for (const m of ok) for (const rec of [m.l1, m.l2]) Object.keys(rec).forEach((c) => people.add(c));
  return {
    pool,
    peopleCodes: [...people],
    examined: ok.reduce((a, m) => a + m.coded, 0),
    /** Distinct people who examined at least one image here (they may also work elsewhere). */
    employees: people.size,
    employeesPerMonth: mean(perMonth.map((x) => x.fte)),
    perEmployeeMonth: ratio(pool.all),
    perEmployeeDay: mean(perMonth.map((x) => (x.perEmp === null ? null : x.perEmp / x.days))),
    l1Employees: mean(perMonth.map((x) => x.fte1)),
    l2Employees: mean(perMonth.map((x) => x.fte2)),
    l1PerDay: mean(perMonth.map((x) => x.l1Day)),
    l2PerDay: mean(perMonth.map((x) => x.l2Day)),
    l1PerMonth: ratio(pool.l1),
    l2PerMonth: ratio(pool.l2),
  };
}

/** Group monthly rows into one PortWorkload per (already canonical) port name. */
export function buildPortWorkloads(input: readonly WorkloadMonthInput[], loadYear: string = LOAD_YEAR): PortWorkload[] {
  // Every employee counts, even with one case (owner's rule, 2026-11-08); low-volume
  // employees are handled by pooledMean in each month instead of being dropped.
  const months = input;
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
    return { port, type, images, months: monthKeys.size, imagesPerMonth: images / Math.max(1, monthKeys.size), codedShare: images ? coded / images : null, years, loadYear, ...employeeLoad(ms, totals, ms.some((m) => m.month.startsWith(loadYear)) ? loadYear : undefined) };
  });
}

/** A port needs at least this many employees a month (on average) to be tiered. */
export const MIN_STAFF_PER_MONTH = 1;

/**
 * A port is tiered only when it received at least this many images a day on average in the
 * load year (×30 a month). Below it a port sees a handful of images, spread over reviewers who
 * mostly work elsewhere, and its cases per employee mean nothing; it is listed as unrated.
 */
export const MIN_PORT_IMAGES_PER_DAY = 10;

/** Images a month in the load year (the year the staff and workload are measured on). */
export const loadImagesPerMonth = (p: PortWorkload): number | null => {
  const y = p.years.find((x) => String(x.year) === (p.loadYear ?? LOAD_YEAR));
  return y ? y.images / Math.max(1, y.months) : null;
};

/** The workload measure (cases per employee per month), or null for a port left out of the tiers. */
export const workloadMeasure = (p: PortWorkload): number | null =>
  p.employeesPerMonth !== null && p.employeesPerMonth >= MIN_STAFF_PER_MONTH && (loadImagesPerMonth(p) ?? 0) >= MIN_PORT_IMAGES_PER_DAY * 30 ? p.perEmployeeMonth : null;

export function unratedPorts(ports: readonly PortWorkload[]): PortWorkload[] {
  return ports.filter((p) => workloadMeasure(p) === null);
}

/** Key of the single band set in WorkloadTier.ranges / averages: the tiers no longer split land and sea ports. */
export const ALL_PORTS_KEY = "جميع المنافذ";

/**
 * Three tiers of equal size (owner's rule, 2026-11-08): the ports, land and sea together, are
 * ranked by the measure and cut into thirds, so a «منخفض» port is never above a «متوسط» one.
 * `measure` defaults to the workload per employee; the images-per-month tiering passes its own.
 */
export function buildWorkloadTiers(all: readonly PortWorkload[], measureOf: (p: PortWorkload) => number | null = workloadMeasure): WorkloadTier[] {
  const ports = all.filter((p) => measureOf(p) !== null);
  if (!ports.length) return [];
  const measure = (p: PortWorkload) => measureOf(p) as number;
  const sorted = [...ports].sort((a, b) => measure(a) - measure(b) || a.port.localeCompare(b.port));
  const n = sorted.length;
  const cuts = [0, Math.round(n / 3), Math.round((2 * n) / 3), n];
  const avgAll = sorted.reduce((a, p) => a + measure(p), 0) / n;
  const keys: WorkloadTierKey[] = ["low", "mid", "high"];
  return keys.map((key, i) => {
    const tp = sorted.slice(cuts[i], cuts[i + 1]).sort((a, b) => measure(b) - measure(a));
    const lo = tp.length ? measure(tp[tp.length - 1]) : 0;
    const hi = tp.length ? measure(tp[0]) : 0;
    const f = (g: (p: PortWorkload) => number | null) => mean(tp.map(g));
    return {
      key,
      label: TIER_LABELS[key],
      from: lo,
      to: hi,
      ports: tp,
      ranges: { [ALL_PORTS_KEY]: [lo, hi] } as Record<string, [number, number]>,
      averages: { [ALL_PORTS_KEY]: avgAll } as Record<string, number>,
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
