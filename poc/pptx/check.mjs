// PoC: machine checks for P2 (zip side), P3, P4, P6, P8 on out/poc.pptx.
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import JSZip from "jszip";
import { model, EMU_PER_PX } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const zip = await JSZip.loadAsync(readFileSync(join(here, "out", "poc.pptx")));
const names = Object.keys(zip.files);
const slide = await zip.file("ppt/slides/slide1.xml").async("string");
const chartName = names.find((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
const chart = await zip.file(chartName).async("string");
const count = (s, re) => (s.match(re) || []).length;

const r = {};
r.P2 = {
  embeddedXlsx: names.filter((n) => /^ppt\/embeddings\/.*\.xlsx$/.test(n)),
  externalData: chart.includes("<c:externalData"),
  catAxOrientation: (chart.match(/<c:catAx>.*?<c:orientation val="(\w+)"/s) || [])[1],
};
r.P3 = {
  rtl1: count(slide, /rtl="1"/g),
  rtl0: count(slide, /rtl="0"/g),
  langArSA: count(slide, /lang="ar-SA"/g),
  csSomar: count(slide, /<a:cs typeface="Somar"/g),
  charsetLeft: count(slide, /charset=/g),
  latinDigitRuns: count(slide, /<a:t>[0-9.,%]+<\/a:t>/g),
  arabicIndicDigits: count(slide, /[٠-٩۰-۹]/g),
};
const table = model.boxes.find((b) => b.kind === "table");
const gridCols = [...slide.matchAll(/<a:gridCol w="(\d+)"/g)].map((m) => +m[1]);
const expected = [...table.colW].reverse().map((px) => px * EMU_PER_PX);
const rowHs = [...slide.matchAll(/<a:tr h="(\d+)"/g)].map((m) => +m[1]);
r.P4 = {
  realTable: slide.includes("<a:tbl>"),
  gridCols, expected,
  maxColDeltaEmu: Math.max(...gridCols.map((w, i) => Math.abs(w - expected[i]))),
  rowHs: [...new Set(rowHs)], expectedRowH: table.rowH * EMU_PER_PX,
};
r.P8 = {
  lnSpc: count(slide, /<a:lnSpc>/g),
  spcPts: count(slide, /<a:spcPts /g),
  spcPct: count(slide, /<a:spcPct /g),
};
const dist = join(here, "..", "..", "node_modules", "pptxgenjs", "dist");
r.P6 = {};
for (const f of ["pptxgen.bundle.js", "pptxgen.min.js", "pptxgen.es.js"]) {
  const buf = readFileSync(join(dist, f));
  r.P6[f] = { rawKB: +(statSync(join(dist, f)).size / 1024).toFixed(1), gzipKB: +(zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(1) };
}
console.log(JSON.stringify(r, null, 1));
