// Renders the port business report (src/data/reporting/portReport/) for one
// selected port from the report workbook, as one self-contained HTML file.
// Same Vite-SSR loading approach as export-exec-report-static.mjs.
//
//   node scripts/export-port-report-static.mjs <workbook.xlsx> [--port=<المنفذ الموحد>] [--period=<label>] [--name=<display name>] [outPath]
//
// Without --port it prints the ports found in the workbook and exits.

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as XLSX from "xlsx";
import { readPopulationByYear } from "./lib/populationSheets.mjs";
import { readWorkload } from "./lib/workloadSheets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith("--"));
const workbookPath = positional[0];
if (!workbookPath) {
  console.error("usage: node scripts/export-port-report-static.mjs <workbook.xlsx> [--port=...] [--period=...] [outPath]");
  process.exit(1);
}
const port = flag("port");
const period = flag("period") ?? "فترة التقرير";
const displayName = flag("name");
const outPath = resolve(root, positional[1] ?? "dist-preview/port-report.html");

/**
 * The figures behind every report table, one sheet per table, so the report
 * can be checked or re-used in Excel. Percentages are stored as fractions with
 * a % number format.
 */
async function writeReportWorkbook(m, path, workload, extra = {}) {
  const pct = (v) => (v === null || v === undefined ? null : v);
  const outcome = (label, o) => [label, o.studied, pct(o.accuracy), o.trueSuspicion, o.trueClear, o.missed, o.falseSuspicion];
  const outcomeHead = ["البند", "المدروسة", "نسبة التوائم", "اشتباه صحيح", "سليمة صحيحة", "الاشتباه الفائت", "الاشتباه الخاطئ"];
  const employee = (e) => [e.code, e.name, e.l1Studied, e.l1Matched, e.l2Studied, e.l2Matched, e.studied, e.matched, e.missed, e.falseSuspicion, pct(e.accuracy)];
  const employeeHead = ["الكود", "الموظف", "مدروسة - المستوى الأول", "متوافقة - المستوى الأول", "مدروسة - المستوى الثاني", "متوافقة - المستوى الثاني", "إجمالي المدروسة", "إجمالي المتوافقة", "الاشتباه الفائت", "الاشتباه الخاطئ", "نسبة التوائم"];
  // Workload mode: the four main slides' tables first; the population sheet drops the
  // suspicion columns because that source has no reliable suspicion split.
  const round = (v) => (v === null || v === undefined ? null : Math.round(v));
  const wlSheets = workload
    ? (() => {
        const tierOf = (p) => workload.tiers.find((t) => t.ports.some((x) => x.port === p.port))?.label ?? "";
        const allPorts = workload.tiers.flatMap((t) => t.ports);
        const outcomeRow = (label, o) => [label, o.image.studied, pct(o.image.accuracy), pct(o.l1.accuracy), pct(o.l2.accuracy), pct(o.image.studied ? o.image.missed / o.image.studied : null), pct(o.image.studied ? o.image.falseSuspicion / o.image.studied : null)];
        return [
          ["العبء التشغيلي للمنافذ", ["مستوى العبء", "المنفذ", "نوع المنفذ", "الصور الواردة", "صور/شهر", "نسبة الصور عليها كود", "الموظفون (أشخاص)", "الموظفون المكافئون/شهر", "صور/شهر للموظف", "صور/يوم للموظف", "موظفو الأول (مكافئ/شهر)", "صور/يوم - الأول", "موظفو الثاني (مكافئ/شهر)", "صور/يوم - الثاني"],
            [...allPorts, ...(workload.unrated ?? [])].map((p) => [tierOf(p) || "بلا بيانات", p.port, p.type, p.images, round(p.imagesPerMonth), pct(p.codedShare), p.employees, round(p.employeesPerMonth), round(p.perEmployeeMonth), round(p.perEmployeeDay), p.l1Employees, round(p.l1PerDay), p.l2Employees, round(p.l2PerDay)])],
          ["حدود مستويات العبء", ["المستوى", "من (صور للموظف في الشهر)", "إلى (صور للموظف في الشهر)", "عدد المنافذ"], workload.tiers.map((t) => [t.label, round(t.from), round(t.to), t.ports.length])],
          ["العبء حسب السنة", ["المنفذ", "السنة", "الصور الواردة", "متوسط الصور في الشهر", "نسبة الصور عليها كود", "الموظفون", "متوسط الموظفين في الشهر", "صور/شهر للموظف", "صور/يوم للموظف"],
            allPorts.flatMap((p) => p.years.map((y) => [p.port, y.year, y.images, round(y.images / Math.max(1, y.months)), pct(y.codedShare), y.employees, round(y.employeesPerMonth), round(y.perEmployeeMonth), round(y.perEmployeeDay)]))],
          ["الأداء حسب مستوى العبء", ["النطاق", "المدروسة", "نسبة التوائم", "توائم الأول", "توائم الثاني", "الاشتباه الفائت", "الاشتباه الخاطئ"],
            [...workload.tiers.map((t) => outcomeRow(`المستوى ${t.label} (دون ${workload.displayName})`, workload.outcomes[t.key])), outcomeRow(workload.displayName, workload.outcomes.selected)]],
        ];
      })()
    : [];
  const sheets = [
    ...wlSheets,
    workload
      ? ["مجتمع الحالات الواردة", ["نوع المنفذ", "المنفذ", "إجمالي الصور"], m.ports.filter((p) => p.population > 0).map((p) => [p.group, p.label, p.population])]
      : ["مجتمع الحالات الواردة", ["نوع المنفذ", "المنفذ", "إجمالي الصور", "اشتباه", "نسبة الاشتباه"],
          m.ports.filter((p) => p.population > 0).map((p) => [p.group, p.label, p.population, p.populationSuspicion, pct(p.population ? p.populationSuspicion / p.population : null)])],
    ["الحالات المدروسة حسب السنة", ["السنة", "المجتمع", "نسبة العينة", ...outcomeHead.slice(1)], [...m.years.map((y) => [y.year, y.population, y.population ? y.studied / y.population : null, ...outcome(y.year, y.image).slice(1)]), ["الإجمالي", m.selected.population, m.selected.population ? m.selected.image.studied / m.selected.population : null, ...outcome("", m.selected.image).slice(1)]]],
    ["نتائج الدراسة حسب نوع المنفذ", ["نوع المنفذ", ...outcomeHead.slice(1)], [...m.groups.map((g) => outcome(g.label, g.image)), outcome("جميع المنافذ", m.allPorts.image)]],
    ["نسبة التوائم حسب المنفذ", ["المنفذ", "نوع المنفذ", "المدروسة", "نسبة التوائم"], m.ports.filter((p) => p.image.studied > 0).map((p) => [p.label, p.group, p.image.studied, pct(p.image.accuracy)])],
    ["المستوى الأول والثاني", ["النطاق", "المستوى", ...outcomeHead.slice(1)],
      [[m.displayName, m.selected], ["جميع المنافذ", m.allPorts]].flatMap(([n, sc]) => [[n, ...outcome("المستوى الأول", sc.l1)], [n, ...outcome("المستوى الثاني", sc.l2)]])],
    ["مستويات دقة الموظفين", ["الفئة", "تبدأ من", "تنتهي عند", "عدد الموظفين", "متوسط الدقة", "متوسط الحالات لكل موظف"],
      m.distribution.tiers.map((t) => [t.label, t.from, t.to, t.count, pct(t.meanAccuracy), t.meanStudied === null ? null : Math.round(t.meanStudied)])],
    ["منسوبي المنفذ (30 فأكثر)", employeeHead, m.employees.filter((e) => e.studied >= 30).map(employee)],
    ["ملحق - أقل من 30 حالة", employeeHead, m.employees.filter((e) => e.studied < 30).map(employee)],
  ];
  // Sheets added with the observations, the 2025/2026 comparison and the chart review (2026-11-07):
  // every figure on the main slides, the observations and the charts has a row here.
  if (workload) {
    const share = (n, o) => (o.studied ? n / o.studied : null);
    const sc = (label, o) => [label, o.studied, o.trueSuspicion, o.trueClear, o.missed, o.falseSuspicion, o.matched, pct(o.accuracy), share(o.trueSuspicion, o), share(o.trueClear, o), share(o.missed, o), share(o.falseSuspicion, o)];
    const scHead = ["المدروسة", "اشتباه صحيح", "سليمة صحيحة", "الاشتباه الفائت", "الاشتباه الخاطئ", "المتوافقة", "نسبة التوائم", "نسبة اشتباه صحيح", "نسبة سليمة صحيحة", "نسبة الاشتباه الفائت", "نسبة الاشتباه الخاطئ"];
    const tierLabel = (t) => `المستوى ${t.label} (دون ${workload.displayName})`;
    const scopes = [...workload.tiers.map((t) => [tierLabel(t), workload.outcomes[t.key]]), [workload.displayName, workload.outcomes.selected]];
    const totals = extra.tierTotals ?? [];
    const types = Object.keys(workload.tiers[0]?.averages ?? {});
    sheets.unshift(
      ["الملاحظات والتوصيات", ["#", "الأولوية", "الملاحظة الرئيسية", "الشواهد الجوهرية", "التوصية", "مصدر الأرقام (صفحة التقرير / ورقة)"], (extra.obs ?? []).map((o, i) => [i + 1, o.priority, o.title, o.evidence.join("\n"), o.recommendations.map((r, j) => `${j + 1}. ${r}`).join("\n"), o.source])],
      ["شواهد الملاحظات", ["#", "الملاحظة الرئيسية", "الشاهد"], (extra.obs ?? []).flatMap((o, i) => o.evidence.map((e) => [i + 1, o.title, e]))],
    );
    sheets.splice(2 + wlSheets.length, 0,
      ["إجماليات مستويات العبء", ["المستوى", "إجمالي الصور", "متوسط الصور في الشهر", "إجمالي الموظفين المخصصين", "متوسط الموظفين في الشهر"], totals.map((t) => [t.label, t.images, round(t.imagesPerMonth), t.people, round(t.staffPerMonth)])],
      ["القوى العاملة حسب المستوى", ["النطاق", "متوسط الصور في الشهر", "متوسط الموظفين في الشهر", "متوسط الحالات المفحوصة في الشهر للموظف", "متوسط إنجاز الموظف في اليوم"], (extra.workforce ?? []).map((r) => [r.label, round(r.imagesPerMonth), round(r.staffPerMonth), round(r.perEmployeeMonth), round(r.perEmployeeDay)])],
      ["متوسط العبء حسب نوع المنفذ", ["نوع المنفذ", "متوسط الحالات المفحوصة في الشهر للموظف", "المنخفض أقل من", "العالي أكثر من"], types.map((ty) => [ty, round(workload.tiers[0].averages[ty]), round(workload.tiers[0].ranges[ty][1]), round(workload.tiers[2]?.ranges[ty][0])])],
      ["المستويان حسب مستوى العبء", ["النطاق", "المستوى", ...scHead], scopes.flatMap(([n, o]) => [[n, ...sc("المستوى الأول", o.l1)], [n, ...sc("المستوى الثاني", o.l2)]])],
      ["الأداء حسب السنة", ["السنة", "النطاق", "المستوى", ...scHead],
        workload.yearly.flatMap((y) => [[workload.displayName, y.selected], ...workload.tiers.map((t) => [tierLabel(t), y.tiers[t.key]])].filter(([, o]) => o && o.image.studied > 0)
          .flatMap(([n, o]) => [["العامة", o.image], ["المستوى الأول", o.l1], ["المستوى الثاني", o.l2]].map(([lv, x]) => [y.year, n, ...sc(lv, x)])))],
    );
    sheets.push(
      ["الخط الزمني الشهري", ["الشهر", `نسبة التوائم - ${m.displayName}`, `المدروسة - ${m.displayName}`, "نسبة التوائم - جميع المنافذ", ...m.groups.filter((g) => g.label !== m.group).map((g) => `نسبة التوائم - ${g.label}`)],
        m.monthly.filter((x) => x.selected !== null || x.all !== null).map((x) => [x.monthKey, pct(x.selected), x.selectedStudied, pct(x.all), ...m.groups.filter((g) => g.label !== m.group).map((g) => pct(x.byGroup[g.label] ?? null))])],
      ["المستويان حسب نوع المنفذ", ["نوع المنفذ", "إجابات المستوى الأول", "نسبة التوائم - الأول", "إجابات المستوى الثاني", "نسبة التوائم - الثاني"], m.groups.map((g) => [g.label, g.l1.studied, pct(g.l1.accuracy), g.l2.studied, pct(g.l2.accuracy)])],
      ["ملخص دقة الموظفين", ["البند", "القيمة"], [["متوسط نسبة التوائم للموظفين", m.distribution.mean], ["الوسيط", m.distribution.median], ["الموظفون المدروسة حالاتهم", m.employees.length], ["المصنفون (30 حالة فأكثر)", m.distribution.tiered], ["المستبعدون (أقل من 30 حالة)", m.distribution.untiered]]],
      ["توزيع دقة الموظفين", ["الفئة", "تبدأ من", "تنتهي عند", "عدد الموظفين"], m.distribution.bins.map((b) => [m.distribution.tiers.find((t) => t.key === b.tier)?.label ?? b.tier, b.from, b.to, b.count])],
    );
  }
  // Index first: every sheet, linked.
  sheets.unshift(["الفهرس", ["#", "الورقة", "الصفوف"], sheets.map(([name, , rows], i) => [i + 1, name.slice(0, 31), rows.length])]);
  const wb = XLSX.utils.book_new();
  for (const [name, head, rows] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    // Percent format on the columns whose header names a rate.
    head.forEach((h, c) => {
      if (!/نسبة|الدقة|تبدأ|تنتهي/.test(h)) return;
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "0.0%";
      }
    });
    ws["!cols"] = head.map((h) => ({ wch: Math.max(12, h.length + 4) }));
    if (name === "ملخص دقة الموظفين") for (let r = 1; r <= 2; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (c) c.z = "0.0%"; }
    if (name === "الفهرس") for (let r = 1; r <= rows.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (c) c.l = { Target: `#'${c.v}'!A1` }; }
    if (/الملاحظات|أرقام الملاحظات/.test(name)) ws["!cols"] = head.map((h, c) => ({ wch: c === 0 ? 5 : /الملاحظة|التوصية|القيمة|الرقم/.test(h) ? 70 : 24 }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  wb.Workbook = { Views: [{ RTL: true }] };
  // The ESM build has no fs binding, so write the buffer ourselves.
  // Somar for every cell (the report's font): the default font in styles.xml, written by SheetJS as Calibri.
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const styles = (await zip.file("xl/styles.xml").async("string")).replace(/<name val="[^"]*"\/>/g, '<name val="Somar"/>').replace(/<family val="[^"]*"\/>/g, "").replace(/<scheme val="[^"]*"\/>/g, "");
  zip.file("xl/styles.xml", styles);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});

try {
  const src = await server.ssrLoadModule("/src/data/reporting/portReport/portReportSource.ts");
  const model = await server.ssrLoadModule("/src/data/reporting/portReport/portReportModel.ts");
  const html = await server.ssrLoadModule("/src/data/reporting/portReport/portReportHtml.ts");

  // Workload mode (--workload=<workbook with year/quarter population sheets>): the
  // positional workbook only needs «نتائج الدراسة»; population comes from the
  // workload sheets. Otherwise the original layout (study sheet + population pivot).
  const workloadPath = flag("workload");
  const wb = XLSX.read(readFileSync(resolve(workbookPath)), { type: "buffer", dense: true, sheets: workloadPath ? [src.STUDY_SHEET] : undefined });
  const sheets = {};
  for (const name of [src.STUDY_SHEET, src.POPULATION_SHEET]) {
    const ws = wb.Sheets[name];
    if (!ws) {
      if (workloadPath && name === src.POPULATION_SHEET) continue;
      throw new Error(`sheet not found: ${name}`);
    }
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }
  const input = src.portReportInputFromSheets(sheets, period);
  let workload;
  if (workloadPath) {
    // --workload-cache=<file.json> keeps the (minutes-long) workbook pass between layout iterations.
    const cachePath = flag("workload-cache");
    const wl = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : await readWorkload(resolve(workloadPath));
    if (cachePath && wl && !existsSync(cachePath)) writeFileSync(cachePath, JSON.stringify(wl));
    if (!wl) throw new Error(`no year/quarter population sheets in ${workloadPath}`);
    for (const s of wl.sheets) console.log(`  ${s.name}: ${s.rows} images, ${s.coded} with employee codes, ${s.duplicates} repeated ids skipped`);
    // One spelling per port across the workload and the study rows.
    const canon = await server.ssrLoadModule("/src/data/reporting/portNameCanonical.ts");
    const aliases = { "الرياض - الميناء الجاف": "ميناء الرياض الجاف" };
    const nameMap = canon.buildPortNameMap([...wl.months.map((x) => aliases[x.port] ?? x.port), ...input.studies.map((r) => aliases[r.port] ?? r.port)]);
    const canonOf = (p) => nameMap.get(aliases[p] ?? p) ?? aliases[p] ?? p;
    for (const r of input.studies) r.port = canonOf(r.port);
    // --last-month=YYYY-MM drops rows dated after the report period.
    const lastMonth = flag("last-month");
    // --exclude-years=2024[,…] leaves whole years out of the report (population, workload and study rows).
    const excludeYears = new Set((flag("exclude-years") ?? "").split(",").map((y) => y.trim()).filter(Boolean));
    if (excludeYears.size) input.studies = input.studies.filter((r) => r.year === null || !excludeYears.has(String(r.year)));
    const months = wl.months.filter((x) => (!lastMonth || x.month <= lastMonth) && !excludeYears.has(x.month.slice(0, 4))).map((x) => ({ ...x, port: canonOf(x.port) }));
    const wlm = await server.ssrLoadModule("/src/data/reporting/portReport/portWorkloadModel.ts");
    const portWorkloads = wlm.buildPortWorkloads(months);
    const tiers = wlm.buildWorkloadTiers(portWorkloads);
    const selPort = canonOf(port ?? "");
    const outcomes = { selected: wlm.outcomesFor(input.studies, new Set([selPort])) };
    for (const t of tiers) outcomes[t.key] = wlm.outcomesFor(input.studies, new Set(t.ports.map((p) => p.port).filter((p) => p !== selPort)));
    workload = { displayName: displayName ?? selPort, port: selPort, tiers, outcomes, yearly: wlm.outcomesByYear(input.studies, selPort, tiers), loadYear: wlm.LOAD_YEAR, periodLabel: period, unrated: wlm.unratedPorts(portWorkloads) };
    // Yearly population for the appendix (images only; the source has no reliable suspicion split).
    const groupOf = new Map(input.studies.map((r) => [r.port, r.group]));
    const popRows = new Map();
    for (const x of months) {
      const k = `${x.port}|${x.month.slice(0, 4)}`;
      const v = popRows.get(k) ?? { port: x.port, group: groupOf.get(x.port) ?? x.type, year: Number(x.month.slice(0, 4)), total: 0, suspicion: 0 };
      v.total += x.images;
      popRows.set(k, v);
    }
    input.population = [...popRows.values()];
    console.log(`  tiers: ${tiers.map((t) => `${t.label} ${t.ports.length} (${t.ports.map((p) => p.port).slice(0, 3).join("، ")}…)`).join(" | ")}`);
  } else {
    // Row-level population (with entry year) replaces the pivot totals when the
    // workbook carries it; see scripts/lib/populationSheets.mjs.
    const byYear = await readPopulationByYear(resolve(workbookPath));
    if (byYear) {
      input.population = byYear.rows;
      for (const [sheet, u] of Object.entries(byYear.undated)) {
        if (u.rows) console.log(`  ${sheet}: ${u.rows} rows without an entry date counted in ${u.year}`);
      }
    }
  }
  const ports = model.listReportPorts(input);
  if (!port) {
    console.log("ports:\n  " + ports.join("\n  "));
  } else {
    const selected = workload ? workload.port : port;
    if (!ports.includes(selected)) throw new Error(`port not in workbook: ${selected}`);
    const m = model.buildPortReportModel(input, selected, displayName ? { displayName } : {});
    const out = html.buildPortReportHtml(m, workload);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, out, "utf8");
    console.log(
      `port report written: ${outPath}\n` +
        `  ${m.displayName} · studied ${m.selected.image.studied} · accuracy ${(m.selected.image.accuracy * 100).toFixed(2)}% · ` +
        `tiers ${m.distribution.tiers.map((t) => `${t.label} ${t.count}`).join(" / ")} · skew ${m.distribution.skewness?.toFixed(3)}`,
    );
    const xlsxPath = flag("xlsx");
    if (xlsxPath) {
      const extra = {};
      if (workload) {
        const obsMod = await server.ssrLoadModule("/src/data/reporting/portReport/portObservations.ts");
        const sl = await server.ssrLoadModule("/src/data/reporting/portReport/portWorkloadSlides.ts");
        extra.obs = obsMod.buildPortObservations(m, workload);
        extra.workforce = sl.workforceFigures(workload);
        extra.tierTotals = workload.tiers.map((t) => ({ label: `المستوى ${t.label}`, ...sl.groupTotals(t.ports) }));
      }
      await writeReportWorkbook(m, resolve(xlsxPath), workload, extra);
      console.log(`report data written: ${resolve(xlsxPath)}`);
    }
  }
} finally {
  await server.close();
}
