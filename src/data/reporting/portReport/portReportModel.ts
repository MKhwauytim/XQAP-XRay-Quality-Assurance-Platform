// Port business report — model.
//
// A side report: the same visual language as the executive deck (deck2), but
// every figure is scoped to ONE selected port and compared against the rest.
// Pure functions only: the input is already-parsed rows (see
// portReportSource.ts), the output is a plain model the HTML builder renders.
// Not wired into the app yet — it is exported for a later Reports-tab hook and
// rendered today by scripts/export-port-report-static.mjs.

/** One studied image (one row of «نتائج الدراسة»). */
export type PortStudyRow = {
  /** رقم صورة الاشعة (empty when the sheet has no id column). */
  id?: string;
  /** المنفذ الموحد */
  port: string;
  /** المجموعة (منفذ جدة / المنافذ البرية / المنافذ البحرية) */
  group: string;
  /** سنة التقاط الصورة */
  year: number | null;
  /** شهر الدخول, "YYYY-MM" */
  monthKey: string;
  /** توائم الصورة — the final result agreed with the quality expert. */
  imageMatch: boolean;
  /** حالة نتيجة الصورة */
  imageStatus: string;
  l1: PortStudyLevel | null;
  l2: PortStudyLevel | null;
};

export type PortStudyLevel = {
  code: string;
  name: string;
  /** حالة المستوى: اشتباه صحيح / اشتباه خاطئ / اشتباه فائت / سليمة صحيحة */
  status: string;
  match: boolean;
};

/** Population totals per port (from the «المجتمع الكامل» pivot). */
export type PortPopulationRow = {
  port: string;
  group: string;
  total: number;
  suspicion: number;
  /** Entry year, when the row comes from the row-level population sheets. */
  year?: number;
};

export type PortReportInput = {
  studies: readonly PortStudyRow[];
  population: readonly PortPopulationRow[];
  /** Label for the period the source covers, shown on the cover. */
  periodLabel: string;
};

export const STATUS_TRUE_SUSPICION = "اشتباه صحيح";
export const STATUS_FALSE_SUSPICION = "اشتباه خاطئ";
export const STATUS_MISSED = "اشتباه فائت";
export const STATUS_TRUE_CLEAR = "سليمة صحيحة";

/** Result codes that are a system, not a person (e.g. «X-RAY» auto results) — never listed as employees. */
export const NON_EMPLOYEE_CODES: ReadonlySet<string> = new Set(["X-RAY", "XRAY"]);

/** Employees with fewer studied images than this are listed but not tiered. */
export const MIN_TIER_SAMPLE = 30;
/** Sub-bins per tier in the distribution chart (3 tiers × 3 = 9 bars). */
export const SUB_BINS_PER_TIER = 3;

export type OutcomeStats = {
  studied: number;
  trueSuspicion: number;
  falseSuspicion: number;
  missed: number;
  trueClear: number;
  matched: number;
  /** matched / studied, 0–1, null when nothing was studied. */
  accuracy: number | null;
};

export type ScopeSummary = {
  label: string;
  /** Port type («المجموعة») — set on per-port summaries only. */
  group?: string;
  population: number;
  populationSuspicion: number;
  image: OutcomeStats;
  l1: OutcomeStats;
  l2: OutcomeStats;
};

export type YearRow = {
  year: number;
  studied: number;
  suspicion: number;
  image: OutcomeStats;
  /** Images entering the port that year; null when the source has no yearly population. */
  population: number | null;
  populationSuspicion: number | null;
};

export type EmployeeRow = {
  code: string;
  name: string;
  l1Studied: number;
  l1Matched: number;
  l2Studied: number;
  l2Matched: number;
  studied: number;
  matched: number;
  /** Level results the expert judged اشتباه فائت / اشتباه خاطئ, across both levels. */
  missed: number;
  falseSuspicion: number;
  accuracy: number | null;
};

export type AccuracyTier = {
  key: "low" | "mid" | "high";
  label: string;
  from: number;
  to: number;
  count: number;
  studied: number;
  meanAccuracy: number | null;
  meanStudied: number | null;
};

export type HistogramBin = { from: number; to: number; count: number; tier: AccuracyTier["key"] };

export type AccuracyDistribution = {
  tiers: AccuracyTier[];
  bins: HistogramBin[];
  tiered: number;
  untiered: number;
  mean: number | null;
  median: number | null;
  /** Sample skewness; > 0 means a longer right tail. */
  skewness: number | null;
  shape: "right" | "left" | "symmetric" | null;
};

export type PortReportModel = {
  port: string;
  group: string;
  displayName: string;
  periodLabel: string;
  selected: ScopeSummary;
  allPorts: ScopeSummary;
  groups: ScopeSummary[];
  /** Every port, for the accuracy ranking. */
  ports: ScopeSummary[];
  years: YearRow[];
  /** نسبة التوائم per «شهر الدخول» (YYYY-MM): the selected port, every port, and each port type. */
  monthly: Array<{ monthKey: string; selected: number | null; selectedStudied: number; all: number | null; byGroup: Record<string, number | null> }>;
  employees: EmployeeRow[];
  distribution: AccuracyDistribution;
  /** Per port type: employees with ≥ MIN_TIER_SAMPLE studied answers there, and their نسبة التوائم spread. */
  staffByGroup: StaffSummary[];
};

export type StaffSummary = {
  label: string;
  employees: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  l1: number | null;
  l2: number | null;
};

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function emptyOutcome(): OutcomeStats {
  return { studied: 0, trueSuspicion: 0, falseSuspicion: 0, missed: 0, trueClear: 0, matched: 0, accuracy: null };
}

function addOutcome(o: OutcomeStats, status: string, match: boolean): void {
  o.studied += 1;
  if (match) o.matched += 1;
  if (status === STATUS_TRUE_SUSPICION) o.trueSuspicion += 1;
  else if (status === STATUS_FALSE_SUSPICION) o.falseSuspicion += 1;
  else if (status === STATUS_MISSED) o.missed += 1;
  else if (status === STATUS_TRUE_CLEAR) o.trueClear += 1;
}

function finish(o: OutcomeStats): OutcomeStats {
  o.accuracy = o.studied > 0 ? o.matched / o.studied : null;
  return o;
}

function summarize(label: string, studies: readonly PortStudyRow[], population: readonly PortPopulationRow[]): ScopeSummary {
  const image = emptyOutcome();
  const l1 = emptyOutcome();
  const l2 = emptyOutcome();
  for (const r of studies) {
    addOutcome(image, r.imageStatus, r.imageMatch);
    if (r.l1) addOutcome(l1, r.l1.status, r.l1.match);
    if (r.l2) addOutcome(l2, r.l2.status, r.l2.match);
  }
  return {
    label,
    population: population.reduce((s, p) => s + p.total, 0),
    populationSuspicion: population.reduce((s, p) => s + p.suspicion, 0),
    image: finish(image),
    l1: finish(l1),
    l2: finish(l2),
  };
}

/** Every port present in the input, for a port picker. */
export function listReportPorts(input: PortReportInput): string[] {
  const set = new Set<string>();
  for (const r of input.studies) set.add(r.port);
  for (const p of input.population) set.add(p.port);
  return [...set].sort((a, b) => a.localeCompare(b, "ar"));
}

function countError(e: EmployeeRow, status: string): void {
  if (status === STATUS_MISSED) e.missed += 1;
  else if (status === STATUS_FALSE_SUSPICION) e.falseSuspicion += 1;
}

export function buildEmployeeRows(studies: readonly PortStudyRow[]): EmployeeRow[] {
  const byCode = new Map<string, EmployeeRow>();
  const get = (lvl: PortStudyLevel): EmployeeRow => {
    let e = byCode.get(lvl.code);
    if (!e) {
      e = { code: lvl.code, name: lvl.name, l1Studied: 0, l1Matched: 0, l2Studied: 0, l2Matched: 0, studied: 0, matched: 0, missed: 0, falseSuspicion: 0, accuracy: null };
      byCode.set(lvl.code, e);
    }
    if (!e.name && lvl.name) e.name = lvl.name;
    return e;
  };
  for (const r of studies) {
    if (r.l1 && r.l1.code && !NON_EMPLOYEE_CODES.has(r.l1.code.toUpperCase())) {
      const e = get(r.l1);
      e.l1Studied += 1;
      if (r.l1.match) e.l1Matched += 1;
      countError(e, r.l1.status);
    }
    if (r.l2 && r.l2.code && !NON_EMPLOYEE_CODES.has(r.l2.code.toUpperCase())) {
      const e = get(r.l2);
      e.l2Studied += 1;
      if (r.l2.match) e.l2Matched += 1;
      countError(e, r.l2.status);
    }
  }
  const rows = [...byCode.values()];
  for (const e of rows) {
    e.studied = e.l1Studied + e.l2Studied;
    e.matched = e.l1Matched + e.l2Matched;
    e.accuracy = e.studied > 0 ? e.matched / e.studied : null;
  }
  // Highest نسبة التوائم first; ties by volume.
  return rows.sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.studied - a.studied || a.code.localeCompare(b.code));
}

const TIER_LABELS: Record<AccuracyTier["key"], string> = { low: "منخفضة", mid: "متوسطة", high: "عالية" };

/**
 * Equal-width tiers between the lowest and highest accuracy of employees with
 * at least MIN_TIER_SAMPLE studied images: width = (max − min) / 3. Each tier
 * is then cut into SUB_BINS_PER_TIER equal sub-bins for the histogram, so the
 * chart shows the shape (left/right tail) the three tiers summarize.
 */
export function buildAccuracyDistribution(employees: readonly EmployeeRow[]): AccuracyDistribution {
  const eligible = employees.filter((e) => e.studied >= MIN_TIER_SAMPLE && e.accuracy !== null);
  const values = eligible.map((e) => e.accuracy as number);
  const untiered = employees.length - eligible.length;
  if (values.length === 0) {
    return { tiers: [], bins: [], tiered: 0, untiered, mean: null, median: null, skewness: null, shape: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / 3;
  const tierIndex = (v: number): number => (width === 0 ? 0 : Math.min(2, Math.floor((v - min) / width)));
  const keys: AccuracyTier["key"][] = ["low", "mid", "high"];
  const tiers: AccuracyTier[] = keys.map((key, i) => ({
    key,
    label: TIER_LABELS[key],
    from: min + width * i,
    to: i === 2 ? max : min + width * (i + 1),
    count: 0,
    studied: 0,
    meanAccuracy: null,
    meanStudied: null,
  }));
  const accSum = [0, 0, 0];
  for (const e of eligible) {
    const i = tierIndex(e.accuracy as number);
    tiers[i].count += 1;
    tiers[i].studied += e.studied;
    accSum[i] += e.accuracy as number;
  }
  tiers.forEach((t, i) => {
    t.meanAccuracy = t.count > 0 ? accSum[i] / t.count : null;
    t.meanStudied = t.count > 0 ? t.studied / t.count : null;
  });

  const nBins = 3 * SUB_BINS_PER_TIER;
  const binWidth = (max - min) / nBins;
  const bins: HistogramBin[] = Array.from({ length: nBins }, (_, i) => ({
    from: min + binWidth * i,
    to: i === nBins - 1 ? max : min + binWidth * (i + 1),
    count: 0,
    tier: keys[Math.floor(i / SUB_BINS_PER_TIER)],
  }));
  for (const v of values) {
    const i = binWidth === 0 ? 0 : Math.min(nBins - 1, Math.floor((v - min) / binWidth));
    bins[i].count += 1;
  }

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  let skewness: number | null = null;
  let shape: AccuracyDistribution["shape"] = null;
  if (n >= 3) {
    const m2 = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const m3 = values.reduce((s, v) => s + (v - mean) ** 3, 0) / n;
    skewness = m2 === 0 ? 0 : m3 / Math.pow(m2, 1.5);
    // |g1| < 0.5 is the conventional "approximately symmetric" band.
    shape = Math.abs(skewness) < 0.5 ? "symmetric" : skewness > 0 ? "right" : "left";
  }
  return { tiers, bins, tiered: n, untiered, mean, median, skewness, shape };
}

/** Build the report for `port` (an «المنفذ الموحد» value). */
export function buildPortReportModel(input: PortReportInput, port: string, opts: { displayName?: string } = {}): PortReportModel {
  const studies = input.studies.filter((r) => r.port === port);
  const pop = input.population.filter((p) => p.port === port);
  const group = studies[0]?.group ?? pop[0]?.group ?? "";
  // A group that holds only this port (e.g. «منفذ جدة») reads better than the
  // raw port name; otherwise the port name itself is the title.
  const groupPorts = new Set(
    [...input.studies, ...input.population].filter((r) => r.group === group).map((r) => r.port),
  );
  const displayName = opts.displayName ?? (group && groupPorts.size === 1 ? group : port);
  // A single-port group is shown under the port's own display name everywhere.
  const lab = (g: string): string => (g === group && groupPorts.size === 1 ? displayName : g);

  const groupNames = [...new Set([...input.studies.map((r) => r.group), ...input.population.map((p) => p.group)])].filter(Boolean);
  const groups = groupNames.map((g) =>
    summarize(
      lab(g),
      input.studies.filter((r) => r.group === g),
      input.population.filter((p) => p.group === g),
    ),
  );

  const ports = listReportPorts(input).map((p) => {
    const st = input.studies.filter((r) => r.port === p);
    const po = input.population.filter((x) => x.port === p);
    return { ...summarize(p, st, po), group: lab(po[0]?.group ?? st[0]?.group ?? "") };
  });

  const yearMap = new Map<number, PortStudyRow[]>();
  for (const r of studies) {
    if (r.year === null) continue;
    const list = yearMap.get(r.year) ?? [];
    list.push(r);
    yearMap.set(r.year, list);
  }
  // Population per year, when the source carries row-level population (rows with a year).
  const popYear = new Map<number, { total: number; suspicion: number }>();
  for (const p of pop) {
    if (p.year === undefined) continue;
    const v = popYear.get(p.year) ?? { total: 0, suspicion: 0 };
    v.total += p.total;
    v.suspicion += p.suspicion;
    popYear.set(p.year, v);
    if (!yearMap.has(p.year)) yearMap.set(p.year, []);
  }
  const hasPopYears = popYear.size > 0;
  const years: YearRow[] = [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, rows]) => {
      const image = summarize("", rows, []).image;
      const py = popYear.get(year);
      return {
        year,
        studied: rows.length,
        suspicion: image.trueSuspicion + image.falseSuspicion,
        image,
        population: hasPopYears ? (py?.total ?? 0) : null,
        populationSuspicion: hasPopYears ? (py?.suspicion ?? 0) : null,
      };
    });

  const monthAcc = new Map<string, { s: [number, number]; a: [number, number]; g: Map<string, [number, number]> }>();
  for (const r of input.studies) {
    if (!r.monthKey) continue;
    const m = monthAcc.get(r.monthKey) ?? { s: [0, 0], a: [0, 0], g: new Map() };
    m.a[0] += 1;
    if (r.imageMatch) m.a[1] += 1;
    if (r.port === port) {
      m.s[0] += 1;
      if (r.imageMatch) m.s[1] += 1;
    }
    const gk = lab(r.group);
    const gv = m.g.get(gk) ?? [0, 0];
    gv[0] += 1;
    if (r.imageMatch) gv[1] += 1;
    m.g.set(gk, gv);
    monthAcc.set(r.monthKey, m);
  }
  const monthly = [...monthAcc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    // A month with fewer than MIN_TIER_SAMPLE studied images is left as a gap:
    // one or two images swing the rate to 0% or 100% and read as a real trend.
    .map(([monthKey, m]) => ({
      monthKey,
      selected: m.s[0] >= MIN_TIER_SAMPLE ? m.s[1] / m.s[0] : null,
      selectedStudied: m.s[0],
      all: m.a[0] >= MIN_TIER_SAMPLE ? m.a[1] / m.a[0] : null,
      byGroup: Object.fromEntries([...m.g].map(([k, [n, ok]]) => [k, n >= MIN_TIER_SAMPLE ? ok / n : null])),
    }));

  const employees = buildEmployeeRows(studies);
  const staffByGroup = groupNames.map((g) => {
    const rows = buildEmployeeRows(input.studies.filter((r) => r.group === g)).filter((e) => e.studied >= MIN_TIER_SAMPLE && e.accuracy !== null);
    const acc = rows.map((e) => e.accuracy as number).sort((x, y) => x - y);
    const n = acc.length;
    const sum = (f: (e: EmployeeRow) => number) => rows.reduce((t, e) => t + f(e), 0);
    return {
      label: lab(g),
      employees: n,
      mean: n ? acc.reduce((t, v) => t + v, 0) / n : null,
      median: n ? (n % 2 ? acc[(n - 1) / 2] : (acc[n / 2 - 1] + acc[n / 2]) / 2) : null,
      min: n ? acc[0] : null,
      max: n ? acc[n - 1] : null,
      l1: rate(sum((e) => e.l1Matched), sum((e) => e.l1Studied)),
      l2: rate(sum((e) => e.l2Matched), sum((e) => e.l2Studied)),
    };
  });
  return {
    port,
    group: lab(group),
    staffByGroup,
    displayName,
    periodLabel: input.periodLabel,
    selected: summarize(displayName, studies, pop),
    allPorts: summarize("جميع المنافذ", input.studies, input.population),
    groups,
    ports,
    years,
    monthly,
    employees,
    distribution: buildAccuracyDistribution(employees),
  };
}
