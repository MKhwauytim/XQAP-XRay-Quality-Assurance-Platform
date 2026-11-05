// G7b layout parity + per-slide pixel diff.
//   1. Line count of every text box and table cell: PowerPoint (out/com.json, from
//      TextFrame2.TextRange.Lines().Count) vs HTML (out/geometry.json, Edge range client rects).
//   2. Top-left of every text box and table within 2px of the HTML box it came from.
//   3. HTML PNG per slide (Edge headless, one slide shown at 0,0) vs PowerPoint PNG
//      (out/pptx-NN.png), percent of pixels differing by more than 32 on any channel.
// Names are masked in the report: Arabic words in employee tables become "***".
// Writes out/layout.json; prints mismatches.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const geo = JSON.parse(readFileSync(join(outDir, "geometry.json"), "utf8"));
const com = JSON.parse(readFileSync(join(outDir, "com.json"), "utf8").replace(/^\uFEFF/, ""));
const PX_PER_PT = 2; // pt = px x 0.5

// Employee pages (and the appendix pages) carry names: mask every Arabic word there.
const nameSlides = new Set(geo.map((g, i) => (g.tables.some((t) => t.rows[0]?.cells[0] && /الموظف/.test(t.rows[0].cells[0].text)) ? i + 1 : 0)).filter(Boolean));
const mask = (slide, s) => (nameSlides.has(slide) ? s.replace(/[\u0600-\u06FF]+/g, "***") : s).replace(/\s+/g, " ").slice(0, 70);

const mism = [];
let boxes = 0, cells = 0;
for (const e of com.layout) {
  const g = geo[e.slide - 1];
  if (e.kind === "text") {
    const t = g.texts[e.idx];
    boxes++;
    const multi = t.lines > 1;
    const hx = multi ? t.rect.x + t.rect.w - Math.min(t.content.w, t.rect.w * 1.04) : t.rect.x;
    const dx = e.left * PX_PER_PT - hx, dy = e.top * PX_PER_PT - t.rect.y;
    const posOk = Math.abs(dx) <= 2 && Math.abs(dy) <= 2;
    if (t.lines !== e.lines || !posOk) mism.push({ slide: e.slide, kind: "text", text: mask(e.slide, t.text), html: t.lines, pptx: e.lines, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
  } else {
    const t = g.tables[e.idx];
    const dx = e.left * PX_PER_PT - t.x, dy = e.top * PX_PER_PT - t.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mism.push({ slide: e.slide, kind: "table", text: "(table position)", dx, dy });
    const got = new Map(e.cells.map(([r, c, n]) => [`${r},${c}`, n]));
    t.rows.forEach((row, ri) => {
      let col = 1;
      for (const c of row.cells) {
        cells++;
        const n = got.get(`${ri + 1},${col}`);
        if (n !== undefined && n !== c.lines) mism.push({ slide: e.slide, kind: "cell", text: mask(e.slide, c.text), html: c.lines, pptx: n });
        col += c.colspan;
      }
    });
  }
}

// ---- HTML PNGs and pixel diff ----
function decode(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  let pal = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    if (type === "IHDR") { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; }
    if (type === "PLTE") pal = buf.subarray(p + 8, p + 8 + len);
    if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 3 ? 1 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) px[(y * w + x) * 3 + k] = ct === 3 ? pal[line[x] * 3 + k] : line[x * bpp + k];
    prev = line;
  }
  return { w, h, px };
}
const html = readFileSync(join(outDir, "report.html"), "utf8");
const prof = join(outDir, ".edge-profile");
mkdirSync(prof, { recursive: true });
const diffs = [];
for (let i = 1; i <= geo.length; i++) {
  const page = join(outDir, `html-${String(i).padStart(2, "0")}.html`);
  const png = join(outDir, `html-${String(i).padStart(2, "0")}.png`);
  const css = `<style>html,body{margin:0!important;padding:0!important;overflow:hidden!important}body *{visibility:hidden!important}.slide.v3{display:none!important}#v3-slide-${i}{display:flex!important;position:fixed!important;left:0!important;top:0!important;width:1920px!important;height:1080px!important;transform:none!important;margin:0!important;z-index:99999}#v3-slide-${i},#v3-slide-${i} *{visibility:visible!important}#v3-slide-${i} .slide-controls{display:none!important}</style>`;
  writeFileSync(page, html.replace("</head>", `${css}</head>`));
  execFileSync(EDGE, ["--headless", "--disable-gpu", "--log-level=3", "--no-first-run", `--user-data-dir=${prof}`, "--allow-file-access-from-files", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1920,1080", "--virtual-time-budget=8000", `--screenshot=${png}`, pathToFileURL(page).href], { stdio: "ignore" });
  const pp = join(outDir, `pptx-${String(i).padStart(2, "0")}.png`);
  if (!existsSync(pp)) { diffs.push({ slide: i, pct: null }); continue; }
  const A = decode(readFileSync(png)), B = decode(readFileSync(pp));
  let d = 0;
  const n = Math.min(A.w * A.h, B.w * B.h);
  for (let q = 0; q < n; q++) if (Math.abs(A.px[q * 3] - B.px[q * 3]) > 32 || Math.abs(A.px[q * 3 + 1] - B.px[q * 3 + 1]) > 32 || Math.abs(A.px[q * 3 + 2] - B.px[q * 3 + 2]) > 32) d++;
  diffs.push({ slide: i, pct: Math.round((d / n) * 10000) / 100 });
}
writeFileSync(join(outDir, "layout.json"), JSON.stringify({ boxes, cells, mismatches: mism, diffs }, null, 1));
console.log(`G7b text boxes ${boxes} table cells ${cells} mismatches ${mism.length}`);
for (const m of mism) console.log(`  s${m.slide} ${m.kind} html ${m.html ?? "-"} pptx ${m.pptx ?? "-"} dx ${m.dx ?? "-"} dy ${m.dy ?? "-"} | ${m.text}`);
console.log("pixel diff %:", diffs.map((d) => `${d.slide}:${d.pct}`).join(" "));
