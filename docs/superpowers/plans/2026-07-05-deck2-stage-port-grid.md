# deck2 Stage×Port Grid Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new deck2 slides — population and sample, each cross-tabulating risk stage
(1–4) × port in a 2×2 grid of cards — alongside the existing land/sea port-split slides.

**Architecture:** One new pure collector function (`collectStagePortStats`) groups
`model.rows` by `(stage, portName)` instead of the existing land/sea split. Two new slide
builders reuse the existing `v2Slide()` shell, `STAGE_TONES` color mapping, and
`.v2-stage-card`/`.deck-table` CSS classes already in the file — only a small amount of new
CSS is needed for the 2×2 grid and the smaller per-card table.

**Tech Stack:** TypeScript, Vitest, plain template-literal HTML/CSS (no framework) — same as
the rest of `src/data/reporting/executive/deck2/`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-05-deck2-stage-port-grid-design.md` — every
  task below implements a section of it; read it first if anything here is unclear.
- These are ADDED slides — the existing land/sea slides (`portPopulationSlideBuilders`,
  `portSampleSlideBuilders`) are untouched.
- Each stage card shows the **top 5 ports by population**, plus an **الإجمالي** row summing
  *every* port in that stage (not just the 5 shown).
- No pagination for these two slides — top-N is fixed at 5, so row count never grows
  unboundedly the way the land/sea tables' row count does. Always exactly one slide per page.
- `npx tsc -b` must pass and `npm run test:run` must pass after every task.
- Any inline JS embedded in a `dir="rtl"` context that renders a `N / N`-style number pair
  needs `dir="ltr"` on its wrapper (bidi bug fixed in EDIT_LOG v40.7 — the "1 / 4" variant
  counter rendered as "4 / 1" without it). The new stage-card sample figure hits this same
  case.

---

### Task 1: `collectStagePortStats` collector + invariant test

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (add function after
  `portSampleSlideBuilders`, which currently ends at line 651, right before the
  `// ── Section 2, page A ...` comment)
- Test: `src/data/reporting/executive/deck2/stagePortStats.test.ts` (new file)

**Interfaces:**
- Consumes: `ReportModel` (from `../model/reportModel`), the existing `PortPopRow` type
  already defined in `slides.ts` at line 422 (`{ name, total, clean, suspicious, sampleTotal,
  sampleClean, sampleSuspicious }`).
- Produces: `export function collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]>`
  — keyed by `stageLabel` (e.g. `"المستوى الأول"`), each value sorted by `total` descending.
  Tasks 2–3 consume this directly.

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/deck2/stagePortStats.test.ts`:

```ts
// src/data/reporting/executive/deck2/stagePortStats.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import { collectStagePortStats } from "./slides";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("collectStagePortStats", () => {
  it("groups rows by (stage, port) and sorts each stage's ports by population descending", () => {
    const model = buildReportModel(
      input([
        popRow({ xrayImageId: "1", stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "2", stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
        popRow({ xrayImageId: "3", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "4", stage: "المستوى الثاني", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
      ]),
    );

    const byStage = collectStagePortStats(model);
    const stage1 = byStage.get("المستوى الأول") ?? [];
    expect(stage1.map((p) => p.name)).toEqual(["ميناء أ", "ميناء ب"]);
    expect(stage1[0]).toMatchObject({ total: 2, clean: 1, suspicious: 1 });
    expect(stage1[1]).toMatchObject({ total: 1, clean: 1, suspicious: 0 });

    const stage2 = byStage.get("المستوى الثاني") ?? [];
    expect(stage2).toHaveLength(1);
    expect(stage2[0]).toMatchObject({ name: "ميناء أ", total: 1 });
  });

  it("sums to the same totals as model.population.byStage (the invariant the design spec requires)", () => {
    const rows: PreparedPopulationRow[] = [];
    const stages = ["المستوى الأول", "المستوى الثاني", "المستوى الثالث", "المستوى الرابع"];
    const ports = ["ميناء أ", "ميناء ب", "ميناء ج"];
    let id = 0;
    for (const stage of stages) {
      for (const port of ports) {
        for (let i = 0; i < 3; i++) {
          id += 1;
          rows.push(
            popRow({
              xrayImageId: String(id),
              stage,
              portName: port,
              xrayLevelOneResult: i === 0 ? "اشتباه" : "سليمة",
              xrayLevelTwoResult: i === 0 ? "اشتباه" : "سليمة",
            }),
          );
        }
      }
    }
    const model = buildReportModel(input(rows));
    const byStage = collectStagePortStats(model);

    for (const stageProfile of model.population.byStage) {
      const ports = byStage.get(stageProfile.stageLabel) ?? [];
      const summedTotal = ports.reduce((sum, p) => sum + p.total, 0);
      const summedSample = ports.reduce((sum, p) => sum + p.sampleTotal, 0);
      expect(summedTotal).toBe(stageProfile.population);
      expect(summedSample).toBe(stageProfile.sampleSize);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/stagePortStats.test.ts`
Expected: FAIL — `collectStagePortStats` is not exported (module has no export of that name).

- [ ] **Step 3: Write the implementation**

In `src/data/reporting/executive/deck2/slides.ts`, insert this immediately after the closing
brace of `portSampleSlideBuilders` (the function ending at line 651) and before the
`// ── Section 2, page A — نتائج جودة الصور في المنافذ ─────────────────────────` comment:

```ts
/**
 * Same tallying logic as collectPortStats (line 432), keyed by risk stage
 * instead of land/sea. Returns ports sorted by population descending within
 * each stage — the same sort key collectPortStats uses — so "top port" means
 * the same thing on the land/sea pages and these stage/port pages.
 *
 * Invariant (asserted in stagePortStats.test.ts): for every entry in
 * `model.population.byStage`, summing `total`/`sampleTotal` across all ports
 * returned for that stageLabel must equal that stage's `population`/
 * `sampleSize`. Both come from the same `model.rows`, so this holds by
 * construction — the test exists to catch a future refactor that breaks it.
 */
export function collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]> {
  const byStage = new Map<string, Map<string, PortPopRow>>();
  for (const r of model.rows) {
    const stageKey = r.stage ?? "غير محدد";
    const portName = r.portName ?? "غير محدد";
    let portMap = byStage.get(stageKey);
    if (!portMap) {
      portMap = new Map<string, PortPopRow>();
      byStage.set(stageKey, portMap);
    }
    let cur = portMap.get(portName);
    if (!cur) {
      cur = { name: portName, total: 0, clean: 0, suspicious: 0, sampleTotal: 0, sampleClean: 0, sampleSuspicious: 0 };
      portMap.set(portName, cur);
    }
    cur.total += 1;
    if (r.imageResult === "اشتباه") cur.suspicious += 1;
    else cur.clean += 1;
    if (r.selectedInSample) {
      cur.sampleTotal += 1;
      if (r.imageResult === "اشتباه") cur.sampleSuspicious += 1;
      else cur.sampleClean += 1;
    }
  }
  const result = new Map<string, PortPopRow[]>();
  for (const [stageKey, portMap] of byStage) {
    result.set(stageKey, [...portMap.values()].sort((a, b) => b.total - a.total));
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/stagePortStats.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/slides.ts src/data/reporting/executive/deck2/stagePortStats.test.ts
git commit -m "feat(deck2): add collectStagePortStats collector for stage×port grid slides"
```

---

### Task 2: CSS for the 2×2 stage-port grid and compact per-card table

**Files:**
- Modify: `src/data/reporting/executive/deck2/theme.ts`

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: CSS classes `.v2-stage-port-grid`, `.v2-stage-port-card`,
  `.v2-stage-port-figure` — consumed by Task 3's slide-builder markup. Also produces the
  sizing constants `STAGE_CARD_TOP_N` and `STAGE_CARD_TABLE_BUDGET_PX`, added to
  `slides.ts` in this task (co-located with the CSS they size, tuned together in Task 4).

- [ ] **Step 1: Add the CSS**

In `src/data/reporting/executive/deck2/theme.ts`, insert immediately after this existing
block (currently ending at line 235):

```css
.v2-totals-item small{display:block;font-size:0.7rem;color:var(--slate);margin-top:2px;}
```

insert:

```css

/* ── Stage×port grid (2 cards per row, one per risk stage 1–4) ────────────── */
/* Reuses .v2-stage-card's border/background/tone classes (gold/blue/green/coral,
   already defined above) as the outer card — only the internal content differs
   (a compact table instead of the stat-row list riskStagesSlide uses). No
   manual RTL reordering needed: in this RTL document, a plain 2-column grid
   with cards in DOM order stage1→stage4 places stage1 top-right, stage2
   top-left, stage3 bottom-right, stage4 bottom-left — the exact arrangement
   in the reference mockups (2026-07-05 stage-port-grid design spec §3). */
.v2-stage-port-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0;}
.v2-stage-port-card{padding:12px 12px 10px;}
.v2-stage-port-card .v2-stage-head{margin-bottom:8px;}
.v2-stage-port-card .deck-table{width:100%;}
.v2-stage-port-card .deck-table th,.v2-stage-port-card .deck-table td{padding:5px 8px;font-size:0.66rem;}
/* The sample page's "{sampleSize} / {population}" figure in the card header —
   dir="ltr" on this span (set in slides.ts) prevents the same bidi-reversal
   bug the variant-switcher counter had (EDIT_LOG v40.7: "1 / 4" rendered as
   "4 / 1" without it). */
.v2-stage-port-figure{margin-inline-start:auto;font-size:0.85rem;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums;}
.v2-stage-port-card.blue .v2-stage-port-figure{color:var(--blue);}
.v2-stage-port-card.green .v2-stage-port-figure{color:var(--green);}
.v2-stage-port-card.coral .v2-stage-port-figure{color:var(--coral);}
```

- [ ] **Step 2: Add the sizing constants**

In `src/data/reporting/executive/deck2/slides.ts`, immediately after the `STAGE_SHORT_TAG`
constant (currently ending at line 378, right before `export function riskStagesSlide`),
add:

```ts
/** How many ports each stage-×-port card shows individually before folding the
 *  rest into its الإجمالي row (design spec §2.3 — "curated top-N, never the
 *  full table", same convention as portTable/qualityTable/accuracyTable). */
const STAGE_CARD_TOP_N = 5;

/** Vertical budget (px) for one stage-×-port card's thead+rows+tfoot, at
 *  METRICS_COMPACT row heights. STARTING ESTIMATE ONLY — Task 4 measures the
 *  actual rendered space live in the dev preview and corrects this constant
 *  (same process TABLE_BUDGET_PX below went through — see its own comment,
 *  "measured live in the browser... v39.9/v39.10, retuned v39.16"). */
let STAGE_CARD_TABLE_BUDGET_PX = 150;
```

(`let`, not `const` — Task 4 will change this single number after live measurement; keeping
it a `let` makes that a one-line diff instead of a re-read-the-whole-file diff.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors (constants aren't used yet, but nothing references them incorrectly
either — an unused top-level `const`/`let` is not a TS error, only unused *locals* are
flagged, and these are module-level)

- [ ] **Step 4: Commit**

```bash
git add src/data/reporting/executive/deck2/theme.ts src/data/reporting/executive/deck2/slides.ts
git commit -m "style(deck2): CSS + sizing constants for the stage×port card grid"
```

---

### Task 3: The two slide builders + wiring into the deck

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (add two card-renderer functions +
  two slide-builder functions, right after `collectStagePortStats` from Task 1)
- Modify: `src/data/reporting/executive/deck2/index.ts` (wire both into
  `buildDeckV2Slides`, in the `sectionOne` array, currently at lines 930–945)
- Modify: `src/data/reporting/executive/deck2/deck2.test.ts` (add coverage for the two new
  slides through the existing full-pipeline test style)

**Interfaces:**
- Consumes: `collectStagePortStats` (Task 1), `STAGE_TONES`/`STAGE_CARD_TOP_N`/
  `STAGE_CARD_TABLE_BUDGET_PX`/`METRICS_COMPACT` (Task 2 + existing), `v2Slide()` (existing,
  line 146), `PortPopRow` type (existing, line 422).
- Produces: `export function stagePortPopulationSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string`
  and `export function stagePortSampleSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string`
  — both are single-page (never paginated) `SlideBuilder`-compatible functions, consumed by
  `buildDeckV2Slides` in `index.ts`.

- [ ] **Step 1: Add the `StageProfile` import**

`slides.ts` currently only imports `ReportModel` as a type (line 13:
`import type { ReportModel } from "../model/reportModel";`) — it never needed `StageProfile`
directly before now because `riskStagesSlide` gets it via inference
(`model.population.byStage.map((s, i) => ...)`, no explicit annotation). The new card
renderers below DO annotate `stage: StageProfile` explicitly, so add the import or `tsc -b`
will fail with "Cannot find name 'StageProfile'". Change line 13 from:

```ts
import type { ReportModel } from "../model/reportModel";
```

to:

```ts
import type { ReportModel } from "../model/reportModel";
import type { StageProfile } from "../../executiveReportTypes";
```

- [ ] **Step 2: Write the card renderers and slide builders**

Insert this immediately after `collectStagePortStats` (the function added in Task 1):

```ts
/** One stage's card on the population page: المنفذ | سليمة | اشتباه | الإجمالي,
 *  top STAGE_CARD_TOP_N ports by population, with a stage-wide totals row. */
function stagePortPopulationCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  const dataRowCount = top.length > 0 ? top.length : 1;
  const trs =
    top.length > 0
      ? top
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td><td>${fmtNum(p.total)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4"><span class="insuff">—</span></td></tr>`;

  const usedPx = METRICS_COMPACT.theadH + METRICS_COMPACT.tfootH + dataRowCount * METRICS_COMPACT.rowH;
  const fillerPx = Math.max(0, STAGE_CARD_TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="4">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td><td>${fmtNum(sum((p) => p.total))}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** One stage's card on the sample page: المنفذ | مجتمع المرحلة | العيّنة المستهدفة |
 *  نسبة التغطية, as plain numbers (not the land/sea page's stacked "N من M"
 *  frac cell — the reference design uses two separate plain columns here). */
function stagePortSampleCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  const dataRowCount = top.length > 0 ? top.length : 1;
  const trs =
    top.length > 0
      ? top
          .map((p) => {
            const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
            return `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}</td><td>${fmtNum(p.sampleTotal)}</td><td>${fmtPct(coverage)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="4"><span class="insuff">—</span></td></tr>`;

  const usedPx = METRICS_COMPACT.theadH + METRICS_COMPACT.tfootH + dataRowCount * METRICS_COMPACT.rowH;
  const fillerPx = Math.max(0, STAGE_CARD_TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="4">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
  const totalPop = sum((p) => p.total);
  const totalSample = sum((p) => p.sampleTotal);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(totalPop)}</td><td>${fmtNum(totalSample)}</td><td>${fmtPct(totalPop > 0 ? (totalSample / totalPop) * 100 : 0)}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
      <span class="v2-stage-port-figure" dir="ltr">${fmtNum(stage.sampleSize)} / ${fmtNum(stage.population)}</span>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العيّنة المستهدفة</th><th>نسبة التغطية</th></tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Population page: مجتمع حالات الفحص حسب المستوى والمنفذ. Never paginated —
 *  top-N is fixed, so row count doesn't grow with the port list the way the
 *  land/sea tables' does. */
export function stagePortPopulationSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortPopulationCard(s, i, byStage.get(s.stageLabel) ?? []))
    .join("");
  const totalsBand = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 18)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("check", 18)}</span><span><b>${fmtNum(model.population.clean)}</b><small>إجمالي سليمة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("alert", 18)}</span><span><b>${fmtNum(model.population.suspicious)}</b><small>إجمالي اشتباه</small></span></div>
  </div>`;
  const body = `${totalsBand}<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-population",
    title: "مجتمع حالات الفحص حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `مجتمع حالات الفحص حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، مع إجمالي شامل لجميع المنافذ.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

/** Sample page: عيّنة الفحص المسحوبة حسب المستوى والمنفذ. Same non-paginated shape. */
export function stagePortSampleSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortSampleCard(s, i, byStage.get(s.stageLabel) ?? []))
    .join("");
  const totalsBand = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 18)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 18)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 18)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>نسبة التغطية</small></span></div>
  </div>`;
  const body = `${totalsBand}<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-sample",
    title: "عيّنة الفحص المسحوبة حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `عيّنة الفحص المسحوبة حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، بأرقام العيّنة ونسبة التغطية، مع إجمالي شامل.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}
```

- [ ] **Step 3: Wire both slides into the deck**

In `src/data/reporting/executive/deck2/index.ts`, change:

```ts
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        1,
        "section1",
        "layers",
        "مجتمع الفحص",
        "التعريف بمجتمع الحالات لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية — الأساس الذي سُحبت منه العيّنة.",
        num,
        total,
        variantPreview,
      ),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
  ];
```

to:

```ts
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        1,
        "section1",
        "layers",
        "مجتمع الفحص",
        "التعريف بمجتمع الحالات لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية — الأساس الذي سُحبت منه العيّنة.",
        num,
        total,
        variantPreview,
      ),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
    (num, total) => stagePortPopulationSlide(model, num, total, variantPreview),
    (num, total) => stagePortSampleSlide(model, num, total, variantPreview),
  ];
```

And add `stagePortPopulationSlide, stagePortSampleSlide` to the existing import of
`slides.ts` names at the top of `index.ts` (find the line importing `buildDeckV2Slides` and
sibling slide functions — add these two to that same import statement's named list).

- [ ] **Step 4: Extend `deck2.test.ts` to cover the new slides**

Add this `describe` block to the end of `src/data/reporting/executive/deck2/deck2.test.ts`
(reuses the file's existing `popRow`/`input` helpers, already defined at the top of that
file):

```ts
describe("stage×port grid slides", () => {
  it("renders both new slide titles and the الإجمالي totals row in production output", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ stage: "المستوى الأول", portName: "ميناء أ" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
      ]),
    );
    expect(html).toContain("مجتمع حالات الفحص حسب المستوى والمنفذ");
    expect(html).toContain("عيّنة الفحص المسحوبة حسب المستوى والمنفذ");
    expect(html).toContain('id="slide-stage-port-population"');
    expect(html).toContain('id="slide-stage-port-sample"');
  });

  it("each stage card's totals row equals the sum of the ports shown when there are ≤5 ports", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
      ]),
    );
    // Both test rows are stage 1, one clean one suspicious — the الإجمالي row
    // for stage 1's population card must show 1/1/2 (clean/suspicious/total).
    const stage1Card = html.split('id="slide-stage-port-population"')[1].split("</section>")[0];
    expect(stage1Card).toContain("<td>الإجمالي</td><td>1</td><td>1</td><td>2</td>");
  });
});
```

- [ ] **Step 5: Run all deck2 tests**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Expected: PASS, all files (deck2.test.ts, stagePortStats.test.ts, deckStyleChoices.test.ts if
present)

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/executive/deck2/slides.ts src/data/reporting/executive/deck2/index.ts src/data/reporting/executive/deck2/deck2.test.ts
git commit -m "feat(deck2): add stage×port grid population and sample slides"
```

---

### Task 4: Live-measure and tune the per-card table budget

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (only the
  `STAGE_CARD_TABLE_BUDGET_PX` value from Task 2, and `STAGE_CARD_TOP_N` if 5 turns out not
  to fit)

**Interfaces:**
- Consumes: the running dev preview (`deck-preview.html`) started via the project's preview
  tooling.
- Produces: a corrected `STAGE_CARD_TABLE_BUDGET_PX` constant — no interface change, this
  task only tunes a number so the existing blank-row-filler math (Task 3) keeps every card's
  tfoot flush to the card's bottom edge without overflow, matching how `TABLE_BUDGET_PX`
  (line 486) was originally tuned for the land/sea cards.

- [ ] **Step 1: Start the dev server and open the preview**

Start the project's dev server (`npm run dev` or the project's preview tool), then navigate
to `/deck-preview.html`. Confirm the "النسخة الجديدة (v2)" toggle is active (it is by
default) and scroll to (or click through) the two new slides — search the page for
`id="slide-stage-port-population"` and `id="slide-stage-port-sample"`.

- [ ] **Step 2: Measure whether the current budget overflows or under-fills**

In the browser console (or via the project's JS-eval preview tool), run:

```js
(function () {
  const results = [];
  document.querySelectorAll(".v2-stage-port-card").forEach((card) => {
    const table = card.querySelector("table");
    const cardRect = card.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    results.push({
      stage: card.querySelector(".v2-stage-head b").textContent,
      cardHeight: cardRect.height,
      tableHeight: tableRect.height,
      tableBottom: tableRect.bottom,
      cardBottom: cardRect.bottom,
      overflow: tableRect.bottom > cardRect.bottom + 0.5, // 0.5px tolerance for sub-pixel rounding
    });
  });
  return results;
})();
```

Expected shape: 8 entries (4 cards × 2 slides). `overflow` must be `false` for every entry —
`.v2-port-col{overflow:hidden}`-style clipping on `.v2-stage-card` (inherited from the base
`.v2-stage-card` rule) means an overflowing table silently loses its bottom rows, exactly the
failure mode `TABLE_BUDGET_PX`'s own comment (line 481) warns about for the land/sea cards.

- [ ] **Step 3: Adjust the constant and re-measure**

If any `overflow` is `true`: decrease `STAGE_CARD_TABLE_BUDGET_PX` in `slides.ts` (or, if the
gap is large, drop `STAGE_CARD_TOP_N` from 5 to 4) and reload. If every `tableHeight` is
comfortably smaller than `cardHeight` (more than ~10px of slack, i.e. the card CSS
`padding-bottom` plus a visible empty gap), increase `STAGE_CARD_TABLE_BUDGET_PX` — the
`v2-blank` filler row exists specifically so this constant can be tuned to hit the card's
exact available height without guessing on every reload (same technique as `TABLE_BUDGET_PX`,
line 481–486).

Repeat Steps 2–3 until every card's `overflow` is `false` and slack is under ~10px.

- [ ] **Step 4: Visual screenshot check**

Take a screenshot of both new slides (population and sample) at both the default dark theme
and after toggling the light/dark switch (this deck's toolbar toggle — see EDIT_LOG v40.9).
Confirm: no card's table visibly clips its الإجمالي row, all 4 cards in each slide read at a
consistent size, and text contrast is fine in both themes (the light-theme CSS added in
EDIT_LOG v40.9 already covers `.deck-table th/td` generically, so no new light-theme rule
should be needed here — verify this holds rather than assuming it).

- [ ] **Step 5: Run the full test suite once more (tuning only touches a constant, but confirm nothing regressed)**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/slides.ts
git commit -m "fix(deck2): tune stage-card table budget against live-measured render"
```

---

### Task 5: Update the EDIT_LOG

**Files:**
- Modify: `docs/EDIT_LOG.md`

Per this repo's CLAUDE.md rule, every code edit must be logged. Add one entry (version
number = next in sequence after whatever is current at implementation time) summarizing
Tasks 1–4: what changed (new collector + two new slides + CSS + tuned constant), and
before/after snippets for the `slides.ts` collector export and the `index.ts`
`sectionOne` wiring (the two most structurally significant diffs). Follow the exact format
already used by every other entry in that file (version/date/what changed/before/after,
one `**File:**` block per file touched).

- [ ] **Step 1: Write the EDIT_LOG entry, then commit it alone**

```bash
git add docs/EDIT_LOG.md
git commit -m "docs(edit-log): log the deck2 stage×port grid slides addition"
```

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** §2.1–2.3 (data mapping, collector, top-N) → Task 1. §2.4 (population
  page) and §2.5 (sample page) → Task 3. §3 (layout, RTL grid ordering, card budget) → Tasks
  2 and 4. §4 (explicit deviations — no "متفرقة" bucket, no CertScan tile, reused totals-band,
  different column order) — all already baked into Task 3's code, not deferred. §5 (testing)
  → Tasks 1 and 3's test steps.
- **No placeholders:** the one open number (`STAGE_CARD_TABLE_BUDGET_PX`) is explicitly
  flagged as a starting estimate with a dedicated measurement task (Task 4) that gives exact
  JS to run and exact pass/fail criteria — not a vague "tune as needed."
- **Type consistency:** `PortPopRow` (existing type, reused unchanged — not redefined) is the
  return element type for `collectStagePortStats`, and the same type flows into both
  `stagePortPopulationCard`/`stagePortSampleCard`. `StageProfile` (existing type, imported
  already in `slides.ts` implicitly via `model.population.byStage`) is the type for the `s`/
  `stage` parameter in both card renderers — confirmed against `reportModel.ts`'s
  `population.byStage: StageProfile[]`.
