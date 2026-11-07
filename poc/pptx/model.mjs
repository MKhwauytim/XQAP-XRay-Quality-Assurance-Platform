// PoC (spike): ONE layout model of absolute px boxes for a 1920x1080 slide.
// Both toPptx.mjs and toHtml.mjs render from this file, so every number is shared.
// Colours are copied from src/data/reporting/executive/deck3/theme.ts (--v3-* tokens);
// the spike does not import the TS module to stay out of src/.

export const SLIDE = { w: 1920, h: 1080 };
export const EMU_PER_PX = 6350; // 12,192,000 / 1920
export const PX_PER_IN = 144; // 1920px / 13.333in
export const pxToIn = (px) => px / PX_PER_IN;
// 1 inch = 144 slide px here, so 1pt = 2px. The research doc's "pt = px x 0.75" assumes 96 px/in
// and renders every text 1.5x too large on this 1920px = 13.333in slide (measured in this PoC).
export const pxToPt = (px) => px * (72 / PX_PER_IN);

// deck3 theme tokens (theme.ts lines 25-31)
export const C = {
  bg: "f9f8f5",
  navy: "10304f",
  text: "22303e",
  muted: "5d6b7a",
  hair: "e3e0d8",
  gold: "b48a3c",
  blue: "3f6fa8",
};

export const FONT = "Somar";

// ── Fixture ────────────────────────────────────────────────────────────────
export const fixture = {
  title: "نتائج مطابقة الفحص بالأشعة حسب المنفذ",
  kpis: [
    { label: "إجمالي المجتمع", value: "48,250" },
    { label: "حجم العينة", value: "1,200" },
    { label: "الحالات المطابقة", value: "1,026" },
    { label: "نسبة المطابقة", value: "85.5%" },
  ],
  ports: [
    { name: "ميناء جدة", studied: 320, matched: 282 },
    { name: "ميناء الدمام", studied: 260, matched: 216 },
    { name: "منفذ البطحاء", studied: 210, matched: 187 },
    { name: "منفذ الحديثة", studied: 170, matched: 139 },
    { name: "مطار الرياض", studied: 140, matched: 122 },
    { name: "منفذ الوديعة", studied: 100, matched: 80 },
  ],
};
fixture.ports.forEach((p) => (p.rate = Math.round((p.matched / p.studied) * 1000) / 10));

// ── Layout (px; x measured from the slide's LEFT edge, RTL mirrored by hand) ─
const PAD_X = 100;
const CONTENT_W = SLIDE.w - 2 * PAD_X; // 1720

const boxes = [];

// Title
boxes.push({
  kind: "text", id: "title", text: fixture.title,
  x: PAD_X, y: 84, w: CONTENT_W, h: 80,
  size: 56, weight: 700, color: C.navy, align: "right", lineHeight: 80,
});

// KPI band: top rule 2px navy, bottom rule 1px hair, 4 cells, vertical hairlines.
const BAND = { x: PAD_X, y: 200, w: CONTENT_W, h: 190 };
boxes.push({ kind: "rect", id: "band-top", x: BAND.x, y: BAND.y, w: BAND.w, h: 2, fill: C.navy });
boxes.push({ kind: "rect", id: "band-bottom", x: BAND.x, y: BAND.y + BAND.h - 1, w: BAND.w, h: 1, fill: C.hair });
const CELL_W = BAND.w / 4; // 430
fixture.kpis.forEach((k, i) => {
  // RTL: cell 0 is rightmost
  const cx = BAND.x + (3 - i) * CELL_W;
  const inset = 40;
  boxes.push({
    kind: "text", id: `kpi-label-${i}`, text: k.label,
    x: cx + inset, y: BAND.y + 26, w: CELL_W - 2 * inset, h: 40,
    size: 28, weight: 400, color: C.muted, align: "right", lineHeight: 40,
  });
  boxes.push({
    kind: "text", id: `kpi-value-${i}`, text: k.value,
    x: cx + inset, y: BAND.y + 78, w: CELL_W - 2 * inset, h: 88,
    size: 80, weight: 700, color: C.navy, align: "right", lineHeight: 88,
  });
  if (i < 3) boxes.push({ kind: "rect", id: `kpi-sep-${i}`, x: cx, y: BAND.y + 26, w: 1, h: BAND.h - 52, fill: C.hair });
});

// Table (right half — RTL reading start). 4 columns, 1 header + 5 rows.
const TABLE = { x: 980, y: 450, w: 840, rowH: 64 };
const colW = [270, 190, 190, 190]; // logical order: port, studied, matched, rate (sum 840)
const header = ["المنفذ", "المدروسة", "المطابقة", "النسبة %"];
const rows = fixture.ports.slice(0, 5).map((p) => [p.name, String(p.studied), String(p.matched), p.rate.toFixed(1) + "%"]);
boxes.push({
  kind: "table", id: "table",
  x: TABLE.x, y: TABLE.y, w: TABLE.w, h: TABLE.rowH * 6,
  colW, rowH: TABLE.rowH, header, rows,
  headerStyle: { size: 25, weight: 400, color: C.muted, topRule: { px: 2, color: C.navy }, bottomRule: { px: 1, color: C.hair } },
  cellStyle: { size: 25, weight: 400, color: C.text, bottomRule: { px: 1, color: C.hair } },
  padStart: 0, padEnd: 14, // CSS .v3-table: padding-left 14px (end side in RTL)
});

// Native bar chart (left half). Shared axis: 0..100 step 20.
boxes.push({
  kind: "chart", id: "chart",
  x: PAD_X, y: 450, w: 820, h: 520,
  categories: fixture.ports.map((p) => p.name),
  values: fixture.ports.map((p) => p.rate),
  seriesName: "نسبة المطابقة %",
  axis: { min: 0, max: 100, step: 20 },
  barColor: C.blue, gridColor: C.hair, labelColor: C.muted, valueColor: C.navy,
  catSize: 20, valSize: 18, dataLabelSize: 20,
  // plot-area insets inside the chart box (HTML must replicate PowerPoint's own placement)
  plot: { left: 20, right: 70, top: 40, bottom: 70 },
});

export const model = { slide: SLIDE, bg: C.bg, font: FONT, boxes };
