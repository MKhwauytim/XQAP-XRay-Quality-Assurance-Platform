// T2 step 4 (zip side): G2, G3, G4, G9 figure parity, G10 on out/port-report.pptx.
// HTML side of G9 = out/geometry.json allText (every visible text node per slide,
// svg axis tick labels excluded because PowerPoint draws its own axis ticks, which are not in any cache).
// PPTX side of G9 = every <a:t> on the slide + every chart on it: category labels (first
// series only, since each series repeats them) and the values of series whose data
// labels are shown, formatted with the chart's data-label format code.
// Writes out/check.json and prints a summary.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const geo = JSON.parse(readFileSync(join(outDir, "geometry.json"), "utf8"));
const zip = await JSZip.loadAsync(readFileSync(join(outDir, "port-report.pptx")));
const read = (n) => zip.file(n).async("string");
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const NUMS = /\d[\d,]*(?:\.\d+)?%?/g;
const nums = (s) => (s.replace(/‎/g, "").match(NUMS) ?? []).map((x) => x.replace(/,/g, ""));
const fmt = (code, v) => {
  const x = Number(v);
  if (/0\.0"%"/.test(code)) return `${x.toFixed(1)}%`;
  if (/^0"%"$/.test(code)) return `${x.toFixed(0)}%`;
  if (/#,##0/.test(code)) return String(Math.round(x));
  return String(v);
};
const multisetDiff = (a, b) => {
  const c = new Map();
  for (const x of a) c.set(x, (c.get(x) ?? 0) + 1);
  for (const x of b) c.set(x, (c.get(x) ?? 0) - 1);
  const onlyA = [], onlyB = [];
  for (const [k, n] of c) { for (let i = 0; i < n; i++) onlyA.push(k); for (let i = 0; i < -n; i++) onlyB.push(k); }
  return { onlyA, onlyB };
};

const res = { slides: geo.length, perSlide: [], g2: { pics: 0, media: [] }, g4: { paragraphs: 0, rtlR: 0, bad: 0 }, g10: { dashes: 0, emoji: 0, where: [] }, totals: { html: 0, pptx: 0, mismatches: 0 } };
res.g2.media = Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/"));
const EMOJI = /\p{Extended_Pictographic}/u;
const DASH = new RegExp("[\u2013\u2014]");
for (let i = 1; i <= geo.length; i++) {
  const xml = await read(`ppt/slides/slide${i}.xml`);
  const rels = await read(`ppt/slides/_rels/slide${i}.xml.rels`);
  const pics = (xml.match(/<p:pic>/g) ?? []).length;
  res.g2.pics += pics;
  const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unxml(m[1]));
  const pptxNums = texts.flatMap(nums);
  const charts = [...rels.matchAll(/Target="[^"]*\/charts\/(chart\d+\.xml)"/g)].map((m) => m[1]);
  let chartOnlyHidden = 0;
  for (const c of charts) {
    const cx = await read(`ppt/charts/${c}`);
    const sers = [...cx.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]);
    sers.forEach((ser, k) => {
      if (k === 0) {
        const cat = ser.match(/<c:cat>([\s\S]*?)<\/c:cat>/)?.[1] ?? "";
        for (const v of cat.matchAll(/<c:v>([^<]*)<\/c:v>/g)) pptxNums.push(...nums(unxml(v[1])));
      }
      const code = ser.match(/<c:dLbls>[\s\S]*?<c:numFmt formatCode="([^"]*)"/)?.[1] ?? cx.match(/<c:dLbls>[\s\S]*?<c:numFmt formatCode="([^"]*)"/)?.[1] ?? "General";
      const shown = !/<c:showVal val="0"\/>/.test(ser.match(/<c:dLbls>[\s\S]*?<\/c:dLbls>/)?.[0] ?? "");
      const vals = [...(ser.match(/<c:val>([\s\S]*?)<\/c:val>/)?.[1] ?? "").matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => fmt(unxml(code), m[1]));
      if (shown) pptxNums.push(...vals.map((v) => v.replace(/,/g, "")));
      else chartOnlyHidden += vals.length;
    });
  }
  for (const t of texts) if (DASH.test(t) || EMOJI.test(t)) { if (DASH.test(t)) res.g10.dashes++; if (EMOJI.test(t)) res.g10.emoji++; res.g10.where.push(i); }
  const paras = xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
  for (const p of paras) { res.g4.paragraphs++; if (/<a:pPr[^>]*rtl="1"[^>]*algn="r"/.test(p)) res.g4.rtlR++; else res.g4.bad++; }
  const htmlNums = geo[i - 1].allText.filter((t) => !t.svgAxis).flatMap((t) => nums(t.text));
  const d = multisetDiff(htmlNums, pptxNums);
  res.totals.html += htmlNums.length;
  res.totals.pptx += pptxNums.length;
  res.totals.mismatches += d.onlyA.length + d.onlyB.length;
  res.perSlide.push({ slide: i, html: htmlNums.length, pptx: pptxNums.length, onlyHtml: d.onlyA, onlyPptx: d.onlyB, charts: charts.length, hiddenChartValues: chartOnlyHidden });
}
for (const c of Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) {
  const cx = await read(c);
  const paras = cx.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
  for (const p of paras) { res.g4.paragraphs++; if (/<a:pPr[^>]*rtl="1"[^>]*algn="r"/.test(p)) res.g4.rtlR++; else res.g4.bad++; }
  for (const v of cx.matchAll(/<c:v>([^<]*)<\/c:v>/g)) if (DASH.test(v[1]) || EMOJI.test(v[1])) { res.g10.dashes++; res.g10.where.push(c); }
}
writeFileSync(join(outDir, "check.json"), JSON.stringify(res, null, 1));
console.log(`slides ${res.slides} | G2 pics ${res.g2.pics} media ${res.g2.media.join(",")} | G4 paragraphs ${res.g4.paragraphs} rtl+r ${res.g4.rtlR} bad ${res.g4.bad} | G10 dashes ${res.g10.dashes} emoji ${res.g10.emoji}`);
console.log(`G9 numbers html ${res.totals.html} pptx ${res.totals.pptx} mismatched tokens ${res.totals.mismatches}`);
for (const s of res.perSlide) if (s.onlyHtml.length || s.onlyPptx.length) console.log(`  slide ${s.slide}: onlyHtml [${s.onlyHtml.join(" ")}] onlyPptx [${s.onlyPptx.join(" ")}]`);
console.log("hidden chart values (series without labels, as in the HTML):", res.perSlide.filter((s) => s.hiddenChartValues).map((s) => `${s.slide}:${s.hiddenChartValues}`).join(" "));
