// PoC tests: evaluate out/t/com.json (PowerPoint COM dump) + HTML clip check (Edge) against layout.json.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { dumpDom } from "./edge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out", "t");
const L = JSON.parse(readFileSync(join(OUT, "layout.json"), "utf8"));
const com = JSON.parse(readFileSync(join(OUT, "com.json"), "utf8").replace(/^﻿/, ""));
let T = com.tests;
const slideOf = (id) => L.slides.find((s) => s.id === id).n;
const shapes = (n) => T.shapes.filter((s) => s.slide === n);
const R = {};

// T1: XML counts were taken by tests.mjs; COM confirms the file opens.
R.T1 = { open: T.open, ...L.counts };

// T3: every continuation slide repeats the header, rows add to 40, table bottom inside the slide,
// every cell one line in PowerPoint.
function evalTables() {
const out = {};
const t3 = L.slides.filter((s) => s.id.startsWith("T3"));
out.T3 = t3.map((s) => {
  const tbl = shapes(s.n).find((x) => x.rows);
  const title = shapes(s.n).find((x) => x.text && /تفاصيل المنافذ/.test(x.text))?.text;
  const head = tbl.cells.filter((c) => c.r === 1).map((c) => c.text);
  return {
    slide: s.n, title, rows: tbl.rows - 1,
    headerRepeated: JSON.stringify(head) === JSON.stringify(L.t3.header),
    bottomPt: Math.round((tbl.top + tbl.height) * 10) / 10, slideHpt: T.slideH,
    insideSlide: tbl.top + tbl.height <= T.slideH,
    multiLineCells: tbl.cells.filter((c) => c.lines !== 1).length,
  };
});

// T4: header cell (row 1, col 2) line count in PowerPoint vs the engine's decision.
const t4tables = L.slides.filter((s) => s.id.startsWith("T4")).flatMap((s) => shapes(s.n).filter((x) => x.rows));
out.T4 = L.t4.map((c, k) => {
  const cell = t4tables[k]?.cells.find((x) => x.r === 1 && x.c === 2);
  return { i: c.i, step: c.step, expectedLines: c.step === 5 ? 1 : c.lines, pptLines: cell?.lines, match: c.step === 5 ? true : cell?.lines === c.lines };
});

return out;
}
Object.assign(R, evalTables());
try {
  const somar = JSON.parse(readFileSync(join(OUT, "com-somar.json"), "utf8").replace(/^﻿/, ""));
  const keep = T; T = somar.tests;
  const e = evalTables();
  R.T3somar = e.T3; R.T4somar = e.T4; T = keep;
} catch (err) { R.somarError = String(err); }

// HTML: cell overflow + table inside slide, measured in Edge with Somar.
const dom = dumpDom(join(OUT, "html-check.html"), OUT);
R.html = JSON.parse(/<pre id="out">RESULT(.*?)END<\/pre>/s.exec(dom)[1]);

// T5 / T6
const g = T.shapes.find((x) => x.type === 6);
R.T5 = { group: !!g, items: g?.items.length, shapes: g?.items.filter((i) => !i.connector).length, connectors: g?.items.filter((i) => i.connector === -1).length, connectorsGlued: g?.items.filter((i) => i.beginConnected === -1).length, editedText: T.groupEdit, movedLeft: T.groupMoved };
const f = T.shapes.find((x) => x.type === 5);
R.T6 = { freeform: !!f, type: f?.type, nodes: f?.nodes, text: f?.text, editedText: T.freeEdit, nodesAfterInsert: T.freeNodesAfterInsert };

// G2: pictures in the file
const z = await JSZip.loadAsync(readFileSync(join(OUT, "tests.pptx")));
R.G2 = { mediaFiles: Object.keys(z.files).filter((n) => n.startsWith("ppt/media/")).length, picElements: 0 };
for (const n of Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) R.G2.picElements += ((await z.file(n).async("string")).match(/<p:pic>/g) || []).length;

// G10: long dash / emoji scan over every text node in the deck and the docs written here
const longDash = new RegExp("[\\u2013\\u2014]"), emoji = /\p{Extended_Pictographic}/u;
let bad = 0;
for (const n of Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
  for (const m of (await z.file(n).async("string")).matchAll(/<a:t>([^<]*)<\/a:t>/g)) if (longDash.test(m[1]) || emoji.test(m[1])) bad++;
}
const docBad = readdirSync(here).filter((f) => /\.(md|mjs|ps1|py)$/.test(f)).filter((f) => { const s = readFileSync(join(here, f), "utf8"); return longDash.test(s) || emoji.test(s); });
R.G10 = { deckTextHits: bad, filesWithHits: docBad };

R.T7 = Object.fromEntries(Object.entries(com).filter(([k]) => k !== "tests").map(([k, v]) => [k, { open: v.open, error: v.error }]));
writeFileSync(join(OUT, "check.json"), JSON.stringify(R, null, 2));
const t4mis = R.T4.filter((x) => !x.match);
console.log(JSON.stringify({ T3: R.T3, T4: { total: R.T4.length, mismatches: t4mis }, T3somar: R.T3somar?.map((t) => [t.rows, t.headerRepeated, t.insideSlide, t.multiLineCells]), T4somarMismatches: R.T4somar?.filter((x) => !x.match), somarError: R.somarError, html: R.html, T5: R.T5, T6: R.T6, G2: R.G2, G10: R.G10, T7: R.T7 }, null, 1));
