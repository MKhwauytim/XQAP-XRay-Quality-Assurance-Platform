// T8 round 3, step 1: stream the raw source workbook once and produce
//   out/stage/pop-<n>.xml   processed population rows (sheetData only), split at Excel's row limit
//   out/stage/sample.xml    processed study rows (sheetData only)
//   out/stage/stage.json    step tables, counts, column layouts, pivot axis values
//
// The rules are the source's own (read only):
//   population: scripts/lib/workloadSheets.mjs readWorkload (header detection, duplicate ids,
//               rows without port or date, suspicion and coded flags, X-RAY codes), then
//               poc/port-pptx/buildModel.mjs (canonical port names, --last-month cutoff, group).
//   study:      src/data/reporting/portReport/portReportSource.ts parseStudyRows (column map,
//               in-period filter, derived year / match / levels), canonical names as above.
// Processed rows are the raw cells cloned (same value, same style index, same shared-string
// index; formulas dropped, cached value kept) plus derived columns at the end.
//
//   node stage.mjs <sourceRoot> <raw.xlsx> <workloadCache.json> --last-month=YYYY-MM

import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out", "stage");
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const [srcRoot, rawPath, cachePath] = args.filter((a) => !a.startsWith("--"));
const lastMonth = flag("last-month");
const MAX_ROWS = 1048576;
const t0 = Date.now();

// --- source rules, copied verbatim from workloadSheets.mjs ---
const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const clean = (v) => { const s = v == null ? "" : String(v).trim(); return s === "#N/A" ? "" : s; };
const ID = ["معرف الأشعة", "معرف الاشعة", "رقم صورة الاشعة"];
const DATE = ["تاريخ دخول الأشعة", "تاريخ دخول الاشعة", "تاريخ دخول للاشعة", "تاريخ الاشعة"];
const RES1 = ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الاول", "المستوى الأول"];
const RES2 = ["نتيجة المستوى الثاني", "المستوى الثاني"];
const CODE1 = ["كود موظف المستوى الأول"];
const CODE2 = ["كود موظف المستوى الثاني"];
const CODE1_2025 = ["موظف المستوى الاول", "موظف المستوى الأول"];
const CODE2_2025 = ["موظف المستوى الثاني"];
const NON_EMPLOYEE = new Set(["X-RAY", "XRAY"]);
const dayOf = (v) => {
  const n = Number(v);
  if (n > 0) return new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

// --- unpack (same approach as the source: Windows bsdtar on an ASCII-named copy) ---
const tmp = mkdtempSync(join(tmpdir(), "t8-stage-"));
const pkg = JSON.parse(readFileSync(resolve(srcRoot, "package.json"), "utf8"));
const server = await createServer({ root: resolve(srcRoot), configFile: false, logLevel: "warn", appType: "custom", cacheDir: join(here, "out", ".vite"), server: { middlewareMode: true, hmr: false }, define: { __APP_VERSION__: JSON.stringify(pkg.version) } });
try {
  const srcMod = await server.ssrLoadModule("/src/data/reporting/portReport/portReportSource.ts");
  const canon = await server.ssrLoadModule("/src/data/reporting/portNameCanonical.ts");
  const copy = join(tmp, "source.xlsx");
  copyFileSync(rawPath, copy);
  const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(existsSync(winTar) ? winTar : "tar", ["-xf", copy, "-C", tmp, "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets"]);
  rmSync(copy);
  const wbXml = readFileSync(join(tmp, "xl/workbook.xml"), "utf8");
  const rels = readFileSync(join(tmp, "xl/_rels/workbook.xml.rels"), "utf8");
  const target = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2].replace(/^\/?xl\//, "");
  const sheetList = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: decode(m[1]), file: join(tmp, "xl", target[m[2]]), part: target[m[2]] }));
  const strings = [];
  for (const m of readFileSync(join(tmp, "xl/sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) strings.push(decode(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
  console.log(`unpacked, ${strings.length} shared strings, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // row streamer that keeps each cell's raw XML
  const scan = (file, onRow) => new Promise((res, rej) => {
    let buf = "";
    const st = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 22 });
    st.on("error", rej);
    st.on("data", (chunk) => {
      buf += chunk;
      let end;
      while ((end = buf.indexOf("</row>")) >= 0) {
        const rowXml = buf.slice(buf.indexOf("<row "), end);
        buf = buf.slice(end + 6);
        const rnum = Number(rowXml.match(/^<row r="(\d+)"/)?.[1]);
        const cells = {};
        for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[2], inner = c[3] ?? "";
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const is = inner.match(/<is>([\s\S]*?)<\/is>/)?.[1];
          const val = / t="s"/.test(attrs) ? strings[+v] : is !== undefined ? decode(is) : v !== undefined ? decode(v) : undefined;
          cells[c[1]] = { attrs: attrs.replace(/ r="[^"]*"/, ""), inner: inner.replace(/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/g, ""), val, num: / t="/.test(attrs) ? undefined : v };
        }
        onRow(rnum, cells);
      }
    });
    st.on("end", res);
  });
  const valOf = (cells, k) => (k && cells[k] ? cells[k].val : undefined);

  // ---------------- study sheet ----------------
  const studyName = srcMod.STUDY_SHEET;
  const study = sheetList.find((s) => s.name === studyName);
  const studyRows = []; // [rnum, cells]
  await scan(study.file, (r, cells) => studyRows.push([r, cells]));
  const sHeadCells = studyRows[0][1];
  const sCols = Object.keys(sHeadCells).sort((a, b) => XLSX.utils.decode_col(a) - XLSX.utils.decode_col(b));
  const sHeaders = sCols.map((k) => clean(sHeadCells[k].val));
  // faithful check: the source parser on the same values
  const aoa = studyRows.map(([, cells]) => { const row = []; for (const k of sCols) { const c = cells[k]; row[XLSX.utils.decode_col(k)] = c ? (c.num !== undefined ? Number(c.num) : c.val ?? null) : null; } return row; });
  const parsed = srcMod.parseStudyRows(aoa);
  const STUDY_COLS = { inPeriod: ["ضمن فترة التقرير"], port: ["المنفذ الموحد"], group: ["المجموعة", "نوع المنفذ2", "نوع المنفذ"], year: ["سنة التقاط الصورة"], month: ["شهر الدخول"], imageStatus: ["حالة نتيجة الصورة"], imageMatch: ["توائم الصورة"], l1Code: ["كود موظف المستوى الأول"], l1Name: ["موظف المستوى الأول"], l1Status: ["حالة المستوى الأول"], l1Match: ["توائم المستوى الأول"], l2Code: ["كود موظف المستوى الثاني"], l2Name: ["موظف المستوى الثاني"], l2Status: ["حالة المستوى الثاني"], l2Match: ["توائم المستوى الثاني"] };
  const sMap = Object.fromEntries(Object.entries(STUDY_COLS).map(([k, names]) => { const i = names.map((n) => sHeaders.indexOf(n)).find((x) => x >= 0); return [k, sCols[i]]; }));
  const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const numv = (c) => { if (!c) return 0; const n = c.num !== undefined ? Number(c.num) : Number(str(c.val)); return Number.isFinite(n) ? n : 0; };
  const studyKept = [], studyDropped = [];
  for (const [r, cells] of studyRows.slice(1)) {
    const port = str(valOf(cells, sMap.port));
    const inP = str(valOf(cells, sMap.inPeriod));
    if (!port || inP !== "نعم") studyDropped.push({ r, reason: !port ? "بلا منفذ" : `ضمن فترة التقرير = «${inP || "فارغ"}»`, cells });
    else studyKept.push([r, cells]);
  }
  if (studyKept.length !== parsed.length) throw new Error(`study filter mismatch ${studyKept.length} vs ${parsed.length}`);
  console.log(`study: ${studyRows.length - 1} rows, kept ${studyKept.length}, dropped ${studyDropped.length}`);

  // ---------------- canonical names (same inputs as buildModel.mjs) ----------------
  const wl = JSON.parse(readFileSync(cachePath, "utf8"));
  const aliases = { "الرياض - الميناء الجاف": "ميناء الرياض الجاف" };
  const nameMap = canon.buildPortNameMap([...wl.months.map((x) => aliases[x.port] ?? x.port), ...parsed.map((r) => aliases[r.port] ?? r.port)]);
  const canonOf = (p) => nameMap.get(aliases[p] ?? p) ?? aliases[p] ?? p;
  const groupOf = new Map(parsed.map((r) => [canonOf(r.port), r.group]));

  // ---------------- population sheets ----------------
  const popSheets = sheetList.filter((s) => /^(\d{4}(-Q\d)?|Q\dB)$/.test(s.name));
  const order = [...popSheets].sort((a, b) => (a.name.startsWith("Q") ? 1 : 0) - (b.name.startsWith("Q") ? 1 : 0) || a.name.localeCompare(b.name));
  // pass 0: headers of every sheet, for the union of columns (original names, first-seen order in workbook order)
  const headerInfo = {};
  for (const s of popSheets) {
    let pre = 0;
    await new Promise((res, rej) => {
      let buf = "";
      const st = createReadStream(s.file, { encoding: "utf8", highWaterMark: 1 << 20 });
      st.on("data", (chunk) => {
        buf += chunk;
        let end;
        while ((end = buf.indexOf("</row>")) >= 0) {
          const rowXml = buf.slice(buf.indexOf("<row "), end); buf = buf.slice(end + 6);
          const cells = {};
          for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1]; const is = c[3]?.match(/<is>([\s\S]*?)<\/is>/)?.[1]; cells[c[1]] = / t="s"/.test(c[2]) ? strings[+v] : is !== undefined ? decode(is) : v; }
          if (Object.values(cells).some((v) => ID.includes(String(v).trim()))) { headerInfo[s.name] = { pre, headerRow: Number(rowXml.match(/^<row r="(\d+)"/)[1]), cells }; st.destroy(); res(); return; }
          pre++;
        }
      });
      st.on("close", res); st.on("error", rej);
    });
  }
  // Excel compares table column names ignoring the hamza on alef (and case): «الأشعة» and «الاشعة»
  // are the same column to it, and a table with both will not open. Such headers share one column.
  const xlKey = (h) => h.replace(/[أإآ]/g, "ا").toLowerCase();
  const union = [], unionKeys = [], headerMap = [];
  for (const s of popSheets) for (const k of Object.keys(headerInfo[s.name].cells).sort((a, b) => XLSX.utils.decode_col(a) - XLSX.utils.decode_col(b))) {
    const h = clean(headerInfo[s.name].cells[k]);
    if (h && !unionKeys.includes(xlKey(h))) { union.push(h); unionKeys.push(xlKey(h)); }
    if (h) headerMap.push([s.name, k, h, union[unionKeys.indexOf(xlKey(h))]]);
  }
  const popDerived = ["الورقة المصدر", "الصف المصدر", "المنفذ (موحد)", "المجموعة (مشتقة)", "الشهر (مشتق)", "اشتباه (مشتق)", "مكود (مشتق)"];
  const popCols = [...union, ...popDerived];

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const istr = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${esc(s)}</t></is></c>`;
  const inum = (ref, n) => `<c r="${ref}"><v>${n}</v></c>`;
  const col = (i) => XLSX.utils.encode_col(i);
  const OFFSET = 10; // processed table header sits on row 11 (rows 1-10 are the designed header block)
  const perSheet = MAX_ROWS - OFFSET - 1; // data rows per processed sheet
  let part = 0, inPart = 0, out = null;
  const popParts = [];
  const openPart = () => {
    part++; inPart = 0;
    out = createWriteStream(join(outDir, `pop-${part}.xml`));
    out.write(`<row r="${OFFSET + 1}">${popCols.map((h, i) => istr(`${col(i + 1)}${OFFSET + 1}`, h)).join("")}</row>`);
    popParts.push({ part, rows: 0 });
  };
  const closePart = () => new Promise((r) => out.end(r));

  const seen = new Map(); // id -> first sheet
  const steps = { header: [], dup: [], noPortDate: [], cutoff: new Map(), codes: new Map(), agg: new Map(), perSheet: [] };
  openPart();
  for (const s of order) {
    const hi = headerInfo[s.name];
    const hc = hi.cells;
    const f = (hs) => Object.keys(hc).find((k) => hs.includes(String(hc[k]).trim()));
    const is2025 = /^2025/.test(s.name);
    const c = { id: f(ID), date: f(DATE), port: f(["اسم المنفذ"]), type: f(["نوع المنفذ"]), c1: f(is2025 ? CODE1_2025 : CODE1), c2: f(is2025 ? CODE2_2025 : CODE2), r1: f(RES1), r2: f(RES2) };
    const colMap = {};
    for (const k of Object.keys(hc)) colMap[k] = clean(hc[k]) ? unionKeys.indexOf(xlKey(clean(hc[k]))) : -1;
    steps.header.push({ sheet: s.name, pre: hi.pre, headerRow: hi.headerRow, mapped: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ? `${clean(hc[v])} (${v})` : ""])) });
    const st = { sheet: s.name, rows: 0, pre: hi.pre, header: 1, dup: 0, noPortDate: 0, cutoff: 0, kept: 0 };
    await scan(s.file, (rnum, cells) => {
      st.rows++;
      if (rnum <= hi.headerRow) return; // summary rows and the header row
      const id = clean(valOf(cells, c.id));
      if (id) {
        if (seen.has(id)) { st.dup++; steps.dup.push([s.name, rnum, id, seen.get(id)]); return; }
        seen.set(id, s.name);
      }
      const port = clean(valOf(cells, c.port));
      const dv = cells[c.date]; const day = dayOf(dv ? (dv.num ?? dv.val) : undefined);
      if (!port || !day) { st.noPortDate++; steps.noPortDate.push([s.name, rnum, id, port, day ? day : "", !port ? "بلا منفذ" : "بلا تاريخ"]); return; }
      const month = day.slice(0, 7);
      if (lastMonth && month > lastMonth) { st.cutoff++; const k = `${s.name}|${month}`; steps.cutoff.set(k, (steps.cutoff.get(k) ?? 0) + 1); return; }
      const cport = canonOf(port);
      const group = groupOf.get(cport) ?? clean(valOf(cells, c.type));
      const susp = clean(valOf(cells, c.r1)) === "اشتباه" || clean(valOf(cells, c.r2)) === "اشتباه" ? 1 : 0;
      const c1 = c.c1 ? clean(valOf(cells, c.c1)) : "", c2 = c.c2 ? clean(valOf(cells, c.c2)) : "";
      for (const code of [c1, c2]) if (code && NON_EMPLOYEE.has(code.toUpperCase())) { const k = `${s.name}|${code}`; steps.codes.set(k, (steps.codes.get(k) ?? 0) + 1); }
      const coded = (c1 && !NON_EMPLOYEE.has(c1.toUpperCase())) || (c2 && !NON_EMPLOYEE.has(c2.toUpperCase())) ? 1 : 0;
      const ak = `${cport}|${month}`;
      const a = steps.agg.get(ak) ?? { port: cport, type: clean(valOf(cells, c.type)), group, year: Number(month.slice(0, 4)), month, images: 0, suspicion: 0, coded: 0 };
      a.images++; a.suspicion += susp; a.coded += coded; steps.agg.set(ak, a);
      st.kept++;
      if (inPart === perSheet) { out.end(); openPart(); }
      inPart++;
      const rr = OFFSET + 1 + inPart;
      let xml = `<row r="${rr}">`;
      const ordered = Object.keys(cells).map((k) => [colMap[k], cells[k]]).filter(([i]) => i >= 0).sort((x, y) => x[0] - y[0]);
      for (const [i, cell] of ordered) xml += `<c r="${col(i + 1)}${rr}"${cell.attrs}>${cell.inner}</c>`;
      const b = union.length + 1;
      xml += istr(`${col(b)}${rr}`, s.name) + inum(`${col(b + 1)}${rr}`, rnum) + istr(`${col(b + 2)}${rr}`, cport) + istr(`${col(b + 3)}${rr}`, group) + istr(`${col(b + 4)}${rr}`, month) + inum(`${col(b + 5)}${rr}`, susp) + inum(`${col(b + 6)}${rr}`, coded);
      out.write(xml + "</row>");
      popParts[popParts.length - 1].rows = inPart;
    });
    // part rollover happens between rows: handled below by splitting on write
    steps.perSheet.push(st);
    console.log(`${s.name}: ${st.rows} rows, kept ${st.kept}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await closePart();

  // ---------------- processed study rows ----------------
  const sDerived = ["المنفذ (موحد)", "السنة (مشتقة)", "التوائم (مشتق)", "المستوى الأول معتمد (مشتق)", "المستوى الثاني معتمد (مشتق)", "كود الأول موظف (مشتق)", "كود الثاني موظف (مشتق)", "الصف المصدر"];
  const sampleCols = [...sHeaders, ...sDerived];
  const so = createWriteStream(join(outDir, "sample.xml"));
  const shift = (k) => col(XLSX.utils.decode_col(k) + 1);
  so.write(`<row r="${OFFSET + 1}">${sCols.map((k) => `<c r="${shift(k)}${OFFSET + 1}"${sHeadCells[k].attrs}>${sHeadCells[k].inner}</c>`).join("")}${sDerived.map((h, i) => istr(`${col(sCols.length + 1 + i)}${OFFSET + 1}`, h)).join("")}</row>`);
  const axis = [];
  const dist = { match: new Map(), l1: new Map(), l2: new Map(), year: new Map(), codes: new Map() };
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const NO_RESULT = "بدون نتيجة";
  studyKept.forEach(([rnum, cells], i) => {
    const rr = OFFSET + 2 + i;
    const port = canonOf(str(valOf(cells, sMap.port)));
    const y = numv(cells[sMap.year]);
    const match = numv(cells[sMap.imageMatch]) === 1 ? 1 : 0;
    const l1s = str(valOf(cells, sMap.l1Status)), l2s = str(valOf(cells, sMap.l2Status));
    const l1 = l1s && l1s !== NO_RESULT ? 1 : 0, l2 = l2s && l2s !== NO_RESULT ? 1 : 0;
    const c1 = str(valOf(cells, sMap.l1Code)), c2 = str(valOf(cells, sMap.l2Code));
    const e1 = l1 && c1 && !NON_EMPLOYEE.has(c1.toUpperCase()) ? 1 : 0, e2 = l2 && c2 && !NON_EMPLOYEE.has(c2.toUpperCase()) ? 1 : 0;
    bump(dist.match, `${str(valOf(cells, sMap.imageMatch)) || "فارغ"}|${match}`);
    bump(dist.l1, `${l1s || "فارغ"}|${l1}`); bump(dist.l2, `${l2s || "فارغ"}|${l2}`);
    bump(dist.year, `${str(valOf(cells, sMap.year)) || "فارغ"}|${y > 0 ? y : ""}`);
    for (const [cc, lv] of [[c1, "الأول"], [c2, "الثاني"]]) if (cc && NON_EMPLOYEE.has(cc.toUpperCase())) bump(dist.codes, `${lv}|${cc}`);
    let xml = `<row r="${rr}">`;
    for (const k of sCols) if (cells[k]) xml += `<c r="${shift(k)}${rr}"${cells[k].attrs}>${cells[k].inner}</c>`;
    const b = sCols.length + 1;
    xml += istr(`${col(b)}${rr}`, port) + (y > 0 ? inum(`${col(b + 1)}${rr}`, y) : "") + inum(`${col(b + 2)}${rr}`, match) + inum(`${col(b + 3)}${rr}`, l1) + inum(`${col(b + 4)}${rr}`, l2) + inum(`${col(b + 5)}${rr}`, e1) + inum(`${col(b + 6)}${rr}`, e2) + inum(`${col(b + 7)}${rr}`, rnum);
    so.write(xml + "</row>");
    axis.push([port, str(valOf(cells, sMap.group)), y > 0 ? y : "", str(valOf(cells, sMap.imageStatus)), match]);
  });
  await new Promise((r) => so.end(r));

  // ---------------- name map table ----------------
  const nameRows = new Map();
  for (const x of wl.months) { const k = `المجتمع|${x.port}`; nameRows.set(k, (nameRows.get(k) ?? 0) + x.images); }
  for (const r of parsed) { const k = `العينة|${r.port}`; nameRows.set(k, (nameRows.get(k) ?? 0) + 1); }
  const names = [...nameRows].map(([k, n]) => { const [set, raw] = k.split("|"); return [set, raw, canonOf(raw), canonOf(raw) === raw ? "بدون تغيير" : "تغير", n]; }).sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]));
  const groups = [...new Set([...steps.agg.values()].map((a) => a.port))].sort().map((p) => [p, groupOf.get(p) ?? "", groupOf.has(p) ? "من نتائج الدراسة" : "من نوع المنفذ في المجتمع", [...steps.agg.values()].find((a) => a.port === p).group]);

  // reconciliation against the cache the T2 model used
  const wlImages = wl.months.filter((x) => !lastMonth || x.month <= lastMonth).reduce((s, x) => s + x.images, 0);
  const keptPop = steps.perSheet.reduce((s, x) => s + x.kept, 0);
  const sorted = [...steps.agg.values()].sort((a, b) => a.month.localeCompare(b.month) || a.port.localeCompare(b.port));
  const stage = {
    rawSheets: [...popSheets.map((s) => s.name), studyName], skippedRawSheets: sheetList.filter((s) => !popSheets.includes(s) && s !== study).map((s) => s.name),
    popCols, popParts, sampleCols, headerMap, perSheet: steps.perSheet, header: steps.header,
    dup: steps.dup, noPortDate: steps.noPortDate,
    cutoff: [...steps.cutoff].map(([k, n]) => [...k.split("|"), n]),
    popCodes: [...steps.codes].map(([k, n]) => [...k.split("|"), n]),
    agg: sorted.map((a) => [a.port, a.type, a.group, a.year, a.month, a.images, a.suspicion, a.coded]),
    names, groups,
    study: { rawRows: studyRows.length, dataRows: studyRows.length - 1, kept: studyKept.length, mapping: Object.entries(STUDY_COLS).map(([k, n]) => [k, n.join(" / "), sMap[k] ? `${sHeaders[sCols.indexOf(sMap[k])]} (${sMap[k]})` : ""]),
      dropped: studyDropped.map((d) => [d.r, d.reason, ...sCols.map((k) => d.cells[k]?.val ?? "")]), headers: sHeaders,
      dist: Object.fromEntries(Object.entries(dist).map(([k, m]) => [k, [...m].map(([kk, n]) => [...kk.split("|"), n])])) },
    axis,
    check: { keptPop, wlImages, keptStudy: studyKept.length, parsedStudy: parsed.length },
  };
  writeFileSync(join(outDir, "stage.json"), JSON.stringify(stage));
  console.log(`done: population kept ${keptPop} (cache ${wlImages}), ${popParts.length} parts, study kept ${studyKept.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

} finally {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}
