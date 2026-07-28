# Deck2 Source-Agreement Levels-vs-Teams Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing 6×6 numeric-axis heatmap on deck2's `slide-s3-source-agreement` (default and Grid variants) with a self-explanatory 2×3 "levels vs. other teams" grid plus a standalone level1↔level2 stat, per the approved design spec.

**Architecture:** `src/data/reporting/executive/deck2/section3/sourceAgreement.ts` is a pure `(model) => string` HTML builder. This plan adds three small new pure functions (`buildLevelsTeamsMatrix`, `levelsTeamsCountsTable`, `levelPairStatHtml`) that replace two existing ones (`buildHeatMatrix`, `comparableGrid`) for exactly two of the page's four render paths (`matrixCard` for the default variant, the matrix half of `gridBody` for the Grid variant). The Ledger and Briefing variants, and the reviewer card in every variant, are untouched.

**Tech Stack:** TypeScript, Vitest, the deck2 `percentHeatmap` SVG primitive (`src/data/reporting/executive/ui/analyticsCharts.ts`), the shared `slideKit.ts` helpers (`pctCell`, `icon`, `gridPanel`).

## Global Constraints

- Every interpolated string must route through `esc()` (existing file convention, unchanged).
- No raw hex colour literals — theme tokens / `currentColor` / `color-mix()` only (`npm run check:hex-literals` is a CI gate).
- A rate is only ever shown when `isRankable(band(comparable))`; below that, render the muted "—" — never a fabricated percentage. `n` (the comparable count) is always printed, including at 0.
- Per `CLAUDE.md`: before finishing, record the change in `docs/edit logs/2026-07-28.md` (Version/Date/Category/What changed/Before/After/Lines, per that file's existing format) and keep `package.json`'s version in sync with the edit log's latest heading (`npm run check:release` must pass).
- Baseline whole-repo line count before this work started (captured via `npm run count-lines -- --quiet`): **242730**.

---

## Task 1: Add the `knownTeamsProfile` test fixture (no behavior change yet)

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts:127-146` (insert a new fixture function directly after `knownProfile`)

**Interfaces:**
- Produces: `knownTeamsProfile(count = 20): { rows: PreparedPopulationRow[]; reviews: Map<string, Result> }` — same shape as the existing `knownProfile`, but also populates `otherResults.manual/opposite/liveMeans` with real (non-null) values so later tasks can exercise the new levels×teams grid's real percentages instead of only its "—" empty state.

This task only adds a fixture — no production code changes, no new assertions yet — so there's nothing to "fail" first. Its own correctness is verified by Task 2's guard-the-fixture assertions.

- [ ] **Step 1: Insert the new fixture function**

Open `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts` and insert this new function immediately after the closing `}` of `knownProfile` (currently ending at line 146, right before the blank line preceding `function render(...)` at line 148):

```ts
/**
 * 20 images extending `knownProfile` with real manual/opposite/liveMeans
 * results (`knownProfile` leaves those three permanently null — "BI never
 * provided" — which is realistic for most months but can't exercise the new
 * levels×teams grid's real percentages). The L1/L2/reviewer patterns are
 * IDENTICAL to `knownProfile` (same seeds), so every existing assertion about
 * those three sources keeps holding; only the three BI-sourced fields are
 * newly populated:
 *   • manual    = سليمة on the first 16 images, اشتباه on the last 4
 *   • opposite  = سليمة on the first 10 images, اشتباه on the last 10
 *   • liveMeans = سليمة on the first 5 images,  اشتباه on the last 15
 * Exact resulting agreement rates are read off the built model in each test
 * (same "guard the fixture against drift" pattern `knownProfile`'s own tests
 * use), not hand-derived here.
 */
function knownTeamsProfile(count = 20): {
  rows: PreparedPopulationRow[];
  reviews: Map<string, Result>;
} {
  const rows: PreparedPopulationRow[] = [];
  const reviews = new Map<string, Result>();
  for (let i = 0; i < count; i++) {
    const id = `XR-${i + 1}`;
    const manual: Result = i < 16 ? "سليمة" : "اشتباه";
    const opposite: Result = i < 10 ? "سليمة" : "اشتباه";
    const liveMeans: Result = i < 5 ? "سليمة" : "اشتباه";
    rows.push(
      popRow({
        xrayImageId: id,
        sourceRowNumber: i + 1,
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: i < 15 ? "سليمة" : "اشتباه",
        otherResults: {
          manual: { result: manual, code: null, employeeId: null },
          opposite: { result: opposite, code: null, employeeId: null },
          liveMeans: { result: liveMeans, code: null, employeeId: null },
        },
      }),
    );
    reviews.set(id, i < 18 ? "سليمة" : "اشتباه");
  }
  return { rows, reviews };
}
```

- [ ] **Step 2: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`
Expected: all existing tests still PASS (this step only added an unused-so-far function; TypeScript may warn on an unused function — that's fine, it will be used starting Task 2).

- [ ] **Step 3: Commit**

```bash
git add "src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts"
git commit -m "$(cat <<'EOF'
Add (deck2 tests): knownTeamsProfile fixture with real manual/opposite/liveMeans data

Prep for the source-agreement levels-vs-teams matrix rework — knownProfile
alone can't exercise real (non-null) team comparisons since it leaves BI
fields permanently null.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write failing tests for the new default-variant chart (2×3 grid + level1↔2 stat)

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts` (several existing `it` blocks in the `"sourceAgreementSlide — rates, gating and ن"`, `"— honest empty states"`, `"— the two facts the page must not misrepresent"`, and `"— structure & determinism"` describe blocks)

**Interfaces:**
- Consumes: `knownTeamsProfile` from Task 1, `sourceAgreementSlide`/`SOURCE_AGREEMENT_CSS` (existing exports, unchanged signatures), `render`/`input`/`countOf` (existing test helpers, unchanged).
- Produces nothing new for other tasks — this task only edits test expectations. Task 3 makes them pass.

This task **replaces** several existing `it` blocks whose assertions describe the OLD 6×6 heatmap behavior for pairs that move out of the chart in the new design (`levelOne↔levelTwo` moves to a standalone stat; `levelOne/levelTwo↔review` stay in the reviewer table only, dropped from the chart entirely).

- [ ] **Step 1: Replace the "prints the known pair agreement percentages" test**

In the `"sourceAgreementSlide — rates, gating and ن"` describe block, replace this entire `it` block (currently lines 253-275):

```ts
  it("prints the known pair agreement percentages in the matrix and the reviewer table", () => {
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));

    // Guard the fixture itself against drift in the aggregate layer.
    const pair = model.resultComparison.crossTeamMatrix.find(
      (c) => c.sourceA === "levelOne" && c.sourceB === "levelTwo",
    )!;
    expect(pair.comparable).toBe(20);
    expect(pair.agree).toBe(15);
    expect(pair.agreementRate).toBe(75);

    const html = sourceAgreementSlide(model, 12, 24, false);
    expect(html).toContain(">75%</text>"); // L1 × L2
    expect(html).toContain(">90%</text>"); // L1 × reviewer
    expect(html).toContain(">85%</text>"); // L2 × reviewer
    // The reviewer table renders the same figures at one decimal.
    expect(html).toContain("90.0%");
    expect(html).toContain("85.0%");
    // Below-target rows carry the alert glyph, so status is never colour-alone.
    expect(html).toContain('<td class="v2-bar-cell warn"');
    expect(html).toContain('class="v2-cell-flag"');
  });
```

with:

```ts
  it("prints the known level×team agreement percentages in the new grid, level1×level2 in the stat callout, and keeps level×reviewer in the reviewer table only", () => {
    const { rows, reviews } = knownTeamsProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));

    // Guard the fixture itself against drift in the aggregate layer.
    const find = (a: string, b: string) =>
      model.resultComparison.crossTeamMatrix.find(
        (c) => (c.sourceA === a && c.sourceB === b) || (c.sourceA === b && c.sourceB === a),
      )!;
    expect(find("levelOne", "manual").agreementRate).toBe(80);
    expect(find("levelOne", "opposite").agreementRate).toBe(50);
    expect(find("levelOne", "liveMeans").agreementRate).toBe(25);
    expect(find("levelTwo", "manual").agreementRate).toBe(95);
    expect(find("levelTwo", "opposite").agreementRate).toBe(75);
    expect(find("levelTwo", "liveMeans").agreementRate).toBe(50);
    expect(find("levelOne", "levelTwo").agreementRate).toBe(75);

    const html = sourceAgreementSlide(model, 12, 24, false);

    // The level×team cells render as real heatmap percentages.
    for (const pct of [80, 50, 25, 95, 75]) {
      expect(html).toContain(`>${pct}%</text>`);
    }

    // level1↔level2 is the standalone stat callout, NOT a grid cell.
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    expect(html.slice(statStart, statStart + 300)).toContain("75.0%");

    // level×reviewer numbers stay in the reviewer table only — never
    // re-added to the new grid (the reviewer card next to it already
    // covers them).
    expect(html).toContain("90.0%");
    expect(html).toContain("85.0%");
    expect(html).not.toContain(">90%</text>");
    expect(html).not.toContain(">85%</text>");
    // Below-target rows carry the alert glyph, so status is never colour-alone.
    expect(html).toContain('<td class="v2-bar-cell warn"');
    expect(html).toContain('class="v2-cell-flag"');
  });
```

- [ ] **Step 2: Replace the sufficiency-gate suppression/rankable tests**

In the same describe block, replace these two `it` blocks (currently lines 277-294):

```ts
  it("suppresses a pair below the sufficiency cut but still shows its ن", () => {
    // 5 comparable images → band "insufficient" → not rankable.
    const { rows } = knownProfile(5);
    const html = render(input(rows));
    expect(html).not.toContain(">100%</text>");
    expect(html).not.toContain("<td>100%</td>");
    expect(html).toContain(">—</text>");
    // ن is still disclosed for that suppressed pair.
    expect(html).toContain("<td>5</td>");
  });

  it("shows the rate again once the pair reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownProfile(10);
    const html = render(input(rows));
    expect(html).toContain(">100%</text>");
    expect(html).toContain("<td>10</td>");
  });
```

with:

```ts
  it("suppresses the level1↔level2 stat below the sufficiency cut but still shows its count", () => {
    // 5 comparable images → band "insufficient" → not rankable.
    const { rows } = knownProfile(5);
    const html = render(input(rows));
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    const statHtml = html.slice(statStart, statStart + 300);
    expect(statHtml).toContain('class="insuff"');
    expect(statHtml).not.toContain("100.0%");
    expect(statHtml).toContain("5 صورة");
  });

  it("shows the level1↔level2 stat rate again once the pair reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownProfile(10);
    const html = render(input(rows));
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    const statHtml = html.slice(statStart, statStart + 300);
    expect(statHtml).toContain("100.0%");
    expect(statHtml).toContain("10 صورة");
  });

  it("suppresses a level×team grid cell below the sufficiency cut but still shows its ن", () => {
    // 5 comparable images → band "insufficient" → not rankable, for every pair.
    const { rows } = knownTeamsProfile(5);
    const html = render(input(rows));
    expect(html).not.toContain("<td>100%</td>");
    expect(html).toContain(">—</text>");
    // ن is still disclosed for the suppressed level×team cells.
    const countsStart = html.indexOf("عدد الصور القابلة للمقارنة");
    expect(countsStart).toBeGreaterThan(-1);
    expect(html.slice(countsStart, countsStart + 500)).toContain("<td>5</td>");
  });

  it("shows a level×team grid cell's rate again once it reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownTeamsProfile(10);
    const html = render(input(rows));
    expect(html).toContain(">100%</text>");
    const countsStart = html.indexOf("عدد الصور القابلة للمقارنة");
    expect(html.slice(countsStart, countsStart + 500)).toContain("<td>10</td>");
  });
```

- [ ] **Step 3: Fix the "nothing studied" empty-state test**

In the `"sourceAgreementSlide — honest empty states"` describe block, replace this `it` block (currently lines 232-249):

```ts
  it("nothing studied: the whole reviewer row and column are suppressed", () => {
    // No employeeFiles and no sample → no reviewer verdicts at all.
    const { rows } = knownProfile();
    const model = buildReportModel(input(rows));
    expect(model.sample.studied).toBe(0);
    for (const row of model.resultComparison.reviewerAgreement) {
      expect(row.comparable).toBe(0);
      expect(row.agreementRate).toBeNull();
    }

    const html = sourceAgreementSlide(model, 12, 24, false);
    // All five reviewer rows muted…
    expect(countOf(html, MUTED_RATE_CELL)).toBe(5);
    // …and the totals row too (pctCell's muted form).
    expect(html).toContain('<td><span class="insuff">—</span></td>');
    // The one pair that does NOT involve the reviewer still reports (20 images).
    expect(html).toContain(">75%</text>");
  });
```

with:

```ts
  it("nothing studied: the whole reviewer row and column are suppressed", () => {
    // No employeeFiles and no sample → no reviewer verdicts at all.
    const { rows } = knownProfile();
    const model = buildReportModel(input(rows));
    expect(model.sample.studied).toBe(0);
    for (const row of model.resultComparison.reviewerAgreement) {
      expect(row.comparable).toBe(0);
      expect(row.agreementRate).toBeNull();
    }

    const html = sourceAgreementSlide(model, 12, 24, false);
    // All five reviewer rows muted…
    expect(countOf(html, MUTED_RATE_CELL)).toBe(5);
    // …and the totals row too (pctCell's muted form).
    expect(html).toContain('<td><span class="insuff">—</span></td>');
    // The one pair that does NOT involve the reviewer (level1↔level2) is the
    // standalone stat callout, not the grid — it still reports (20 images).
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    expect(html.slice(statStart, statStart + 300)).toContain("75.0%");
  });
```

- [ ] **Step 4: Fix the "uses the confirmed Arabic source labels" test**

In the `"sourceAgreementSlide — the two facts the page must not misrepresent"` describe block, replace this `it` block (currently lines 200-213):

```ts
  it("uses the confirmed Arabic source labels", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    for (const label of [
      "المستوى الأول",
      "المستوى الثاني",
      "التفتيش اليدوي",
      "التفتيش المعاكس",
      "الوسائل الحية",
      "المراجع (المعيار)",
    ]) {
      expect(html).toContain(label);
    }
  });
```

with:

```ts
  it("uses the confirmed Arabic source labels", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    for (const label of [
      "المستوى الأول",
      "المستوى الثاني",
      "التفتيش اليدوي",
      "التفتيش المعاكس",
      "الوسائل الحية",
    ]) {
      expect(html).toContain(label);
    }
    // "المراجع (المعيار)" is no longer shown on the default view (2026-07-28
    // rework: the reviewer card compares both levels against the reviewer
    // without ever spelling out this specific compound label as a row header
    // of its own) — it still appears in the Ledger/Briefing variants, which
    // still walk all 15 source pairs including reviewer pairs.
    const preview = sourceAgreementSlide(
      buildReportModel(input(rows, { sample: true, reviews })),
      12,
      24,
      true,
    );
    expect(preview).toContain("المراجع (المعيار)");
  });
```

- [ ] **Step 5: Add the CSS assertion for the new stat callout class**

In the `"sourceAgreementSlide — structure & determinism"` describe block, replace this `it` block (currently lines 326-331):

```ts
  it("exports page-local CSS with no raw hex colour literals", () => {
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-split");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-ngrid");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-foot");
    expect(SOURCE_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
```

with:

```ts
  it("exports page-local CSS with no raw hex colour literals", () => {
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-split");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-ngrid");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-foot");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-lvl-stat");
    expect(SOURCE_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
```

- [ ] **Step 6: Run the test file and confirm the edited tests now FAIL against the old implementation**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`
Expected: FAIL — the tests edited in Steps 1-5 fail (no `s3sa-lvl-stat` class exists yet, the old heatmap still renders `levelOne`↔`levelTwo`/`review` pairs, `المراجع (المعيار)` still appears in `render()`'s panel-0 output). Tests untouched by this task still PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts"
git commit -m "$(cat <<'EOF'
Test (deck2): failing tests for source-agreement levels-vs-teams matrix

Red step for the redesign: asserts the new 2x3 levels-vs-teams grid, the
standalone level1<->level2 stat, and the dropped review column/pair-with-
levels — all currently unimplemented.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement the new chart in `matrixCard` (default variant) to turn Task 2's tests green

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.ts`

**Interfaces:**
- Consumes: `CrossTeamMatrixCell`, `ResultSource`, `HeatMatrix`, `percentHeatmap`, `esc`, `fmtNum`, `icon`, `pctCell`, `indexPairs`, `pairAt`, `gatedRate`, `SOURCE_LABELS` — all already defined/imported in this file.
- Produces (new, used by Task 5 too): `LEVEL_SOURCES: readonly ResultSource[]`, `TEAM_SOURCES: readonly ResultSource[]`, `MATRIX_TITLE: string`, `MATRIX_SUB: string`, `buildLevelsTeamsMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix`, `levelsTeamsCountsTable(cells: CrossTeamMatrixCell[]): string`, `levelPairStatHtml(cells: CrossTeamMatrixCell[]): string`.
- **Correction (found during implementation, 2026-07-28):** `buildHeatMatrix`/`comparableGrid` are NOT removed by this task. `gridBody` (Task 5's scope, not yet touched at this point) still calls both — deleting them here breaks typecheck and every Grid-variant test before Task 5 runs. This task ADDS the three new functions alongside the two old ones and rewires ONLY `matrixCard` to use the new functions. `buildHeatMatrix`/`comparableGrid` become dead code once Task 5 rewires `gridBody` too — Task 5 is the one that deletes them (see its own Step 1).

- [ ] **Step 1: Add the new source-group constants**

In `src/data/reporting/executive/deck2/section3/sourceAgreement.ts`, find this existing block (currently lines 104-127):

```ts
/**
 * The six comparison sources, in the SAME order `aggregates.ts` builds the
 * matrix in. Order is load-bearing twice over: it fixes the matrix axes (so
 * output is deterministic) and it defines the 1..6 numbering the axis labels
 * and the ن grid share.
 */
const SOURCE_ORDER: readonly ResultSource[] = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
  "review",
] as const;

/** Confirmed by the report owner as the source workbook's own column names. */
const SOURCE_LABELS: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "التفتيش اليدوي",
  opposite: "التفتيش المعاكس",
  liveMeans: "الوسائل الحية",
  review: "المراجع (المعيار)",
};
```

Insert this immediately after it (still before the `// ── Shared gating ──` comment):

```ts
/**
 * The two rows of the default/Grid variants' levels×teams matrix — the
 * report's own primary inspection methods. `SOURCE_ORDER` above is still
 * used, unchanged, by the Ledger/Briefing variants (they still walk all 15
 * pairs); these two new groups exist only for the narrower chart.
 */
const LEVEL_SOURCES: readonly ResultSource[] = ["levelOne", "levelTwo"] as const;

/**
 * The three columns of the same chart — the OTHER inspection teams. `review`
 * is deliberately excluded: the reviewer card sitting next to this chart
 * already shows both levels vs. the reviewer, so repeating those two numbers
 * here would just duplicate information one glance away (design spec §5).
 * level-vs-level itself is also excluded — it isn't a "level vs team"
 * comparison, so it gets its own standalone stat (`levelPairStatHtml`)
 * instead of a grid cell.
 */
const TEAM_SOURCES: readonly ResultSource[] = ["manual", "opposite", "liveMeans"] as const;
```

- [ ] **Step 2: Insert the three new functions and rewrite `matrixCard` — leave `buildHeatMatrix`/`comparableGrid` in place for now**

**Correction (found during implementation, 2026-07-28):** the original version of this step told you to
delete `buildHeatMatrix`/`comparableGrid` here. Don't — `gridBody` (Task 5's scope) still calls both, and
this task does not touch `gridBody`. Deleting them now breaks `npm run typecheck` and every Grid-variant
test. Instead: leave `buildHeatMatrix` and `comparableGrid` exactly as they are (still lines ~161-224,
still used by `gridBody`), and replace ONLY the `matrixCard` function — currently:

```ts
function matrixCard(cells: CrossTeamMatrixCell[]): string {
  const heat = percentHeatmap(buildHeatMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 140,
    caption: "مصفوفة التوافق بين المصادر",
    rowHeader: "المصدر",
    // Polarity: stronger tint = higher agreement.
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  return `<div class="v2-port-col summary s3sa-col">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${icon("scan", 18)}</span>
      <div><b>${esc("مصفوفة التوافق بين المصادر")}</b><span>${esc(
        `${fmtNum(cells.length)} زوجًا · المصفوفة متماثلة، يُعرض النصف السفلي فقط`,
      )}</span></div>
    </div>
    <div class="s3sa-body">
      <div class="s3sa-chart">${heat}</div>
      ${comparableGrid(cells)}
    </div>
  </div>`;
}
```

with the three new functions PLUS the new `matrixCard` — i.e. this whole block replaces just the old
`matrixCard` function above (its own opening `function matrixCard` through its closing `}`), inserted at
that same location, directly after the existing `comparableGrid` function which stays put above it:

```ts
// ── matrixCard's new levels × teams chart ────────────────────────────────────
//
// 2026-07-28 rework (owner feedback on the previously-shipped 6×6 heatmap:
// "the graph ... 123456 mean nothing and current page is hard to read"). See
// `docs/superpowers/specs/2026-07-28-deck2-source-agreement-levels-vs-teams-
// design.md` for the full rationale. The chart now answers the page's own
// stated question narrowly — how do the two X-ray levels compare against the
// other teams — instead of every one of the 15 possible source pairs. This is
// a genuine 2×3 RECTANGLE (rows ≠ columns), not a symmetric matrix, so there
// is no lower-triangle indexing, no mirrored half, and no numeric-axis
// tradeoff to document: 3 real Arabic column headers fit comfortably where 6
// didn't.
//
// NOTE (temporary, resolved by Task 5): `buildHeatMatrix`/`comparableGrid`
// above this block still exist — `gridBody` still uses them until Task 5
// rewires it and deletes them, along with the now-stale "Left card — the 6×6
// agreement matrix" header comment above `buildHeatMatrix`. Task 3 alone
// leaves two adjacent "Left card"-ish section comments in the file; that's
// expected and temporary, not a mistake to fix here.

const MATRIX_TITLE = "توافق المستويين مع الفرق الأخرى";
const MATRIX_SUB = "مقارنة كل مستوى بالتفتيش اليدوي والمعاكس والوسائل الحية";

/**
 * The 2×3 chart data: rows are the two X-ray inspection levels, columns are
 * the other three inspection teams (`review` and level-vs-level are
 * deliberately excluded — see the `TEAM_SOURCES`/`LEVEL_SOURCES` doc comments
 * above). Each cell is read directly off `crossTeamMatrix`, gated by the same
 * sufficiency rule every other rate on this page uses.
 */
function buildLevelsTeamsMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: LEVEL_SOURCES.map((s) => SOURCE_LABELS[s]),
    cols: TEAM_SOURCES.map((s) => SOURCE_LABELS[s]),
    values: LEVEL_SOURCES.map((level) =>
      TEAM_SOURCES.map((team) => {
        const cell = pairAt(index, level, team);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}

/**
 * The ن companion to `buildLevelsTeamsMatrix`: the same 2×3 shape, carrying
 * `comparable` for every cell, including cells the sufficiency gate
 * suppressed. `percentHeatmap`'s cell text is percentage-only by contract (it
 * has no per-cell annotation hook, and that module is owned/edited
 * elsewhere), so counts still need this separate table — simplified from the
 * previous triangular design since every (level, team) slot is a real,
 * non-mirrored comparison (no void cells needed except the blank top-left
 * corner).
 */
function levelsTeamsCountsTable(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const head = `<tr><th class="s3sa-void" scope="col"></th>${TEAM_SOURCES.map(
    (team) => `<th scope="col">${esc(SOURCE_LABELS[team])}</th>`,
  ).join("")}</tr>`;

  const bodyRows = LEVEL_SOURCES.map((level) => {
    const tds = TEAM_SOURCES.map((team) => {
      const cell = pairAt(index, level, team);
      return `<td>${fmtNum(cell ? cell.comparable : 0)}</td>`;
    }).join("");
    return `<tr><th scope="row">${esc(SOURCE_LABELS[level])}</th>${tds}</tr>`;
  }).join("");

  return `<table class="s3sa-ngrid">
    <caption>${esc("عدد الصور القابلة للمقارنة (العيّنة) لكل خلية")}</caption>
    <thead>${head}</thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

/**
 * The level1↔level2 agreement stat — a standalone callout, not a grid cell,
 * since it's a different comparison kind (level vs. level, not level vs.
 * team). Sits above the levels×teams grid on both the default and Grid
 * variants. Gated and counted with the exact same discipline as every other
 * rate on this page: "—" (not a fabricated number) below the sufficiency
 * cut, the comparable count always shown.
 */
function levelPairStatHtml(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const cell = pairAt(index, "levelOne", "levelTwo");
  const rate = cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
  const n = cell ? cell.comparable : 0;
  return `<div class="s3sa-lvl-stat">
    <span class="s3sa-lvl-stat-icon" aria-hidden="true">${icon("check", 14)}</span>
    <span>${esc("توافق المستوى الأول مع الثاني")} — <b>${pctCell(rate)}</b> · ${esc(`${fmtNum(n)} صورة`)}</span>
  </div>`;
}

function matrixCard(cells: CrossTeamMatrixCell[]): string {
  const heat = percentHeatmap(buildLevelsTeamsMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 110,
    caption: MATRIX_TITLE,
    rowHeader: "المستوى",
    // Polarity: stronger tint = higher agreement.
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  return `<div class="v2-port-col summary s3sa-col">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${icon("scan", 18)}</span>
      <div><b>${esc(MATRIX_TITLE)}</b><span>${esc(MATRIX_SUB)}</span></div>
    </div>
    <div class="s3sa-body">
      ${levelPairStatHtml(cells)}
      <div class="s3sa-chart">${heat}</div>
      ${levelsTeamsCountsTable(cells)}
    </div>
  </div>`;
}
```

- [ ] **Step 3: Add the `.s3sa-lvl-stat` CSS**

In the same file's `SOURCE_AGREEMENT_CSS` template literal, find this line:

```css
.s3sa-chart figure{height:100%;}
```

and insert immediately after it:

```css

/* ── Level1↔Level2 stat callout — sits above the levels×teams grid, both the
   default and Grid variants (2026-07-28 rework, see the doc comment above
   `buildLevelsTeamsMatrix`). ─────────────────────────────────────────────── */
.s3sa-lvl-stat{
  display:flex;align-items:center;gap:6px;flex-shrink:0;
  padding:5px 9px;border-radius:8px;font-size:0.62rem;font-weight:700;
  border:1px solid color-mix(in srgb,var(--gold) 30%,transparent);
  background:color-mix(in srgb,var(--gold) 8%,transparent);
}
.s3sa-lvl-stat-icon{color:var(--gold);display:inline-flex;flex-shrink:0;}
.s3sa-lvl-stat b{font-weight:800;}
```

- [ ] **Step 4: Run typecheck and the section3 test file**

Run: `npm run typecheck`
Expected: PASS — no unused-symbol or type errors (`buildHeatMatrix`/`comparableGrid` are fully removed, not left dangling; `LEVEL_SOURCES`/`TEAM_SOURCES` are used).

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`
Expected: every test edited in Task 2 now PASSES. Grid-variant tests (Task 4/5's concern) may still be unaffected either way since `gridBody` hasn't changed yet — confirm they still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add "src/data/reporting/executive/deck2/section3/sourceAgreement.ts"
git commit -m "$(cat <<'EOF'
Fix (executive-deck): source-agreement default view — 2x3 levels-vs-teams grid replaces the confusing 6x6 numeric-axis heatmap

Owner feedback on the shipped chart: "the graph ... 123456 mean nothing and
current page is hard to read." Replaces the 6x6 lower-triangle matrix with a
2x3 rectangle (levels x other teams, real Arabic column names) plus a
standalone level1<->level2 stat callout. review and level-vs-level are
dropped from the grid since they're already shown elsewhere on the same
slide (the reviewer card, and the new stat, respectively).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write failing tests for the Grid variant's matching chart

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts` (the `"sourceAgreementSlide — Grid (panel 3)"` describe block)

**Interfaces:**
- Consumes: `panelSlice`, `renderPreview`, `knownTeamsProfile` (Task 1) — all already defined in the test file by this point.

- [ ] **Step 1: Add a new test for the Grid variant's levels×teams panel**

In the `"sourceAgreementSlide — Grid (panel 3)"` describe block, insert this new `it` block immediately after the existing `"keeps the ن grid beneath the heatmap — unlike Ledger, Grid does NOT drop it"` test (currently ending at line 611, right before the `"the reviewer matrix has the right shape"` test):

```ts
  it("renders the same levels×teams matrix as the default view: 2×3 grid with real names, no numeric axis, plus the level1↔2 stat", () => {
    const { rows, reviews } = knownTeamsProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 3);
    const matrixStart = panel.indexOf('class="v2-gd-panel matrix"');
    expect(matrixStart).toBeGreaterThan(-1);
    const reviewerStart = panel.indexOf('class="v2-gd-panel reviewer"');
    expect(reviewerStart).toBeGreaterThan(matrixStart);
    const matrixHtml = panel.slice(matrixStart, reviewerStart);

    for (const label of [
      "المستوى الأول",
      "المستوى الثاني",
      "التفتيش اليدوي",
      "التفتيش المعاكس",
      "الوسائل الحية",
    ]) {
      expect(matrixHtml).toContain(label);
    }
    // No bare numeric column headers left over from the old 6×6 design.
    expect(matrixHtml).not.toMatch(/>[1-6]<\/text>/);
    expect(matrixHtml).toContain('class="s3sa-lvl-stat"');
    // The reviewer is not a column here — already covered by the reviewer panel.
    expect(matrixHtml).not.toContain("المراجع (المعيار)");
  });
```

- [ ] **Step 2: Run the test file and confirm the new test FAILS**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts -t "renders the same levels×teams matrix as the default view"`
Expected: FAIL — `gridBody` still renders the old 6×6 heatmap (no `s3sa-lvl-stat` in the Grid panel yet, numeric `1..6` headers still present).

- [ ] **Step 3: Commit**

```bash
git add "src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts"
git commit -m "$(cat <<'EOF'
Test (deck2): failing test for Grid variant's levels-vs-teams matrix

Red step — Grid still renders the old 6x6 heatmap at this point.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement the same chart in `gridBody` (Grid variant) to turn Task 4's test green

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.ts`

**Interfaces:**
- Consumes: `buildLevelsTeamsMatrix`, `levelsTeamsCountsTable`, `levelPairStatHtml`, `MATRIX_TITLE`, `MATRIX_SUB` (all produced by Task 3).

- [ ] **Step 1: Replace the matrix half of `gridBody`**

Find the `gridBody` function (originally lines 693-730, now shifted slightly by Task 3's edits — locate it by its `function gridBody(model: ReportModel): string {` signature):

```ts
function gridBody(model: ReportModel): string {
  const cells = model.resultComparison.crossTeamMatrix;
  const rows = model.resultComparison.reviewerAgreement;
  const totals = reviewerTotals(rows);

  const heat = percentHeatmap(buildHeatMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 140,
    caption: "مصفوفة التوافق بين المصادر",
    rowHeader: "المصدر",
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  const matrixPanel = gridPanel({
    title: "مصفوفة التوافق بين المصادر",
    sub: `${fmtNum(cells.length)} زوجًا · المصفوفة متماثلة، يُعرض النصف السفلي فقط`,
    variant: "matrix",
    chartHtml: `<div class="s3sa-gd-heat-wrap"><div class="s3sa-chart">${heat}</div>${comparableGrid(cells)}</div>`,
  });

  const reviewerPanel = gridPanel({
    title: "المقارنة بنتيجة المراجع",
    sub: `التوافق العام ${fmtPct(totals.totalRate)} · العيّنة ${fmtNum(totals.totalComparable)}`,
    variant: "reviewer",
    chartHtml: gridReviewerMatrix(rows),
  });

  return `<div class="v2-sys-grid s3sa-gd">
    <div class="v2-gd-split">${matrixPanel}${reviewerPanel}</div>
    ${scopeNotes()}
  </div>`;
}
```

with:

```ts
function gridBody(model: ReportModel): string {
  const cells = model.resultComparison.crossTeamMatrix;
  const rows = model.resultComparison.reviewerAgreement;
  const totals = reviewerTotals(rows);

  const heat = percentHeatmap(buildLevelsTeamsMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 110,
    caption: MATRIX_TITLE,
    rowHeader: "المستوى",
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  const matrixPanel = gridPanel({
    title: MATRIX_TITLE,
    sub: MATRIX_SUB,
    variant: "matrix",
    chartHtml: `<div class="s3sa-gd-heat-wrap">${levelPairStatHtml(cells)}<div class="s3sa-chart">${heat}</div>${levelsTeamsCountsTable(cells)}</div>`,
  });

  const reviewerPanel = gridPanel({
    title: "المقارنة بنتيجة المراجع",
    sub: `التوافق العام ${fmtPct(totals.totalRate)} · العيّنة ${fmtNum(totals.totalComparable)}`,
    variant: "reviewer",
    chartHtml: gridReviewerMatrix(rows),
  });

  return `<div class="v2-sys-grid s3sa-gd">
    <div class="v2-gd-split">${matrixPanel}${reviewerPanel}</div>
    ${scopeNotes()}
  </div>`;
}
```

- [ ] **Step 2: Delete `buildHeatMatrix`/`comparableGrid` and their now-stale header comment — they are fully dead now that Step 1 rewired their only two call sites**

Task 3 deliberately left these two functions in place (see Task 3's Interfaces "Correction" note) because
`gridBody` still called them at that point. After Step 1 above, nothing calls them anymore. Find and delete
this entire block — from the `// ── Left card — the 6×6 agreement matrix` comment through the end of
`comparableGrid`'s closing `}` (it sits directly above `matrixCard`, which Task 3 already replaced and is
untouched by this deletion):

```ts
// ── Left card — the 6×6 agreement matrix ────────────────────────────────────

/**
 * 6×6 matrix, LOWER TRIANGLE ONLY: cell (row ri, col ci) is populated when
 * `ci < ri`, so each of the 15 pairs appears exactly once and the diagonal
 * (a source against itself, always trivially 100%) is blank. The upper
 * triangle and diagonal pass `null`, which `percentHeatmap` renders as its
 * dashed "—" placeholder.
 *
 * Column labels are the source NUMBER (1..6); the full Arabic name lives on
 * the row header carrying the same number. Six full Arabic labels across the
 * top would collide at this card width, and a correlation-style numeric axis
 * keyed to the named rows is both readable and unambiguous.
 */
function buildHeatMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: SOURCE_ORDER.map((source, i) => `${SOURCE_LABELS[source]} (${i + 1})`),
    cols: SOURCE_ORDER.map((_, i) => String(i + 1)),
    values: SOURCE_ORDER.map((rowSource, ri) =>
      SOURCE_ORDER.map((colSource, ci) => {
        if (ci >= ri) return null; // diagonal + mirrored upper half
        const cell = pairAt(index, colSource, rowSource);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}

/**
 * The ن companion to the matrix: the same lower triangle, same 1..6 numbering,
 * carrying `comparable` for every pair — including the pairs whose rate the
 * sufficiency gate suppressed. Structurally-empty lines (row 1 and column 6
 * hold no pairs) are omitted rather than rendered as blank filler.
 */
function comparableGrid(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const colSources = SOURCE_ORDER.slice(0, -1); // 1..5
  const rowSources = SOURCE_ORDER.slice(1); // 2..6

  const head = `<tr><th class="s3sa-void" scope="col"></th>${colSources
    .map((_, ci) => `<th scope="col">${ci + 1}</th>`)
    .join("")}</tr>`;

  const bodyRows = rowSources
    .map((rowSource, k) => {
      const ri = k + 1;
      const tds = colSources
        .map((colSource, ci) => {
          if (ci >= ri) return `<td class="s3sa-void"></td>`;
          const cell = pairAt(index, colSource, rowSource);
          return `<td>${fmtNum(cell ? cell.comparable : 0)}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${ri + 1}</th>${tds}</tr>`;
    })
    .join("");

  return `<table class="s3sa-ngrid">
    <caption>${esc("عدد الصور القابلة للمقارنة (العيّنة) لكل زوج — بترقيم المصادر نفسه أعلاه")}</caption>
    <thead>${head}</thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}
```

Delete it entirely — nothing replaces it. `matrixCard` (Task 3) and `gridBody` (Step 1 above) both now use
`buildLevelsTeamsMatrix`/`levelsTeamsCountsTable` instead. Also delete the now-redundant temporary NOTE
comment that Task 3's Step 2 added above `MATRIX_TITLE` ("NOTE (temporary, resolved by Task 5): ..." —
5 lines starting with `// NOTE (temporary, resolved by Task 5):` through `// expected and temporary, not a
mistake to fix here.`) — that note exists solely to explain the two-functions-temporarily-coexist state
this step just resolved.

- [ ] **Step 3: Run typecheck and the full section3 test file**

Run: `npm run typecheck`
Expected: PASS — confirms `buildHeatMatrix`/`comparableGrid` had no other callers (if typecheck fails with
an unresolved-name error, something outside this page still referenced them — stop and report rather than
restoring them speculatively; that would mean this plan's "these two call sites only" assumption was wrong).

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`
Expected: ALL tests in this file PASS, including every test from Tasks 2 and 4, and every pre-existing Ledger/Briefing test (untouched, must still pass unmodified).

- [ ] **Step 4: Commit**

```bash
git add "src/data/reporting/executive/deck2/section3/sourceAgreement.ts"
git commit -m "$(cat <<'EOF'
Fix (executive-deck): source-agreement Grid view — same 2x3 levels-vs-teams grid as the default view

Grid rendered the identical percentHeatmap chart with the identical data as
the default view, so it had the identical readability problem; same fix.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Whole-repo verification (typecheck, lint, full test suite, complexity/hex-literal gates)

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS, no regressions outside `sourceAgreement.test.ts` (nothing else imports `buildHeatMatrix`/`comparableGrid`/the old matrix copy strings — confirmed during design research — but this step is the final confirmation).

- [ ] **Step 2: Run lint, typecheck, and the CI-gate scripts touching this file's conventions**

Run: `npm run lint`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run check:hex-literals`
Expected: PASS (no raw hex literals were introduced — the new CSS uses `var(--gold)`/`color-mix()` only, matching the file's existing convention).

Run: `npm run check:complexity`
Expected: PASS (this change is a net simplification — two triangle-indexed functions replaced by three simpler direct-lookup functions).

- [ ] **Step 3: If anything fails, fix and re-run this task's steps until all pass. Do not proceed to Task 7 until green.**

---

## Task 7: Visual verification in the dev preview

**Files:** none (manual/browser verification; CSS tuning only if genuinely needed).

- [ ] **Step 1: Start the dev server and open the deck preview**

Use the `preview_start` tool with `{name: "dev"}` (or whatever the project's `.claude/launch.json` dev-server entry is named — check that file first if unsure), then navigate to the executive report / deck2 preview route and select the `slide-s3-source-agreement` slide, default variant (panel "1/4").

- [ ] **Step 2: Confirm the default variant reads correctly**

Check, via `read_page`/`get_page_text` and a screenshot:
- The stat callout ("توافق المستوى الأول مع الثاني — NN% · N صورة") is visible and legible above the chart.
- The heatmap shows 2 rows (المستوى الأول / الثاني) and 3 real-name columns (التفتيش اليدوي / المعاكس / الوسائل الحية) — no bare digits anywhere on the chart.
- The small counts table beneath the chart is legible and correctly aligned under/near its matching column.
- The right-hand reviewer card is visually unchanged from before this work.

If the left card looks visually imbalanced against the right card now that its content is smaller (e.g. excess empty space, or the chart looks stretched), adjust `.s3sa-split`'s `grid-template-columns` in `SOURCE_AGREEMENT_CSS` — currently `1.15fr .85fr` — to `1fr 1fr` as a reasonable first alternative, and re-check. Only make this change if the live-rendered page actually looks wrong; do not change it speculatively.

- [ ] **Step 3: Confirm the Grid variant (panel "4/4") reads correctly**

Same checks as Step 2, applied to the Grid variant's matrix panel (left) beside the reviewer `metricMatrix` panel (right, unchanged).

- [ ] **Step 4: Confirm the Ledger (panel "2/4") and Briefing (panel "3/4") variants are visually unchanged**

Quick screenshot check only — these variants were not touched by this plan, so this step is a regression sanity check, not new design review.

- [ ] **Step 5: If any CSS adjustment was made in Step 2, re-run the affected test**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`
Expected: still PASS (a `grid-template-columns` value change doesn't affect any string assertion in the test file, but confirm anyway).

- [ ] **Step 6: Stop the dev server preview** (via `preview_stop`) once verification is complete.

---

## Task 8: Edit log, version bump, and final commit

**Files:**
- Modify: `docs/edit logs/2026-07-28.md` (append a new `## v59.70 — 2026-07-28 — Fix (executive-deck): …` entry, per `CLAUDE.md`'s required format)
- Modify: `package.json:4` (version `59.69.0` → `59.70.0`)

- [ ] **Step 1: Capture the post-edit line count and the diff stat**

Run: `npm run count-lines -- --quiet`
Record the printed number (call it `AFTER`). The baseline captured before this plan started was **242730**.

Run: `git diff --stat 05a1d57e -- "src/data/reporting/executive/deck2/section3/sourceAgreement.ts" "src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts"`
(`05a1d57e` is the commit that landed the approved design spec, i.e. the point right before this plan's Task 1 started — substitute the actual first commit hash of Task 1 if it differs.)
Record the files-changed / insertions / deletions line.

- [ ] **Step 2: Append the edit log entry**

Open `docs/edit logs/2026-07-28.md` and append a new entry at the end, following the exact format of the existing `## v59.69 …` entry above it:

```markdown
## v59.70 — 2026-07-28 — Fix (executive-deck): source-agreement chart — 2×3 levels-vs-teams grid replaces the unreadable 6×6 numeric-axis heatmap

Owner feedback after reviewing the rendered `slide-s3-source-agreement` page
(default variant, "1/4"): "the graph on top right is suppose to be level 1
and 2 on y axis and other temas on x axis on top. 123456 mean nothing and
current page is hard to read." The shipped chart was a 6×6 lower-triangle
heatmap of all `C(6,2)=15` source pairs, with column headers reduced to bare
numbers `1..6` because 6 full Arabic source names collided across the
chart's top edge — and with typical monthly data, only 3 of the 15 cells
were ever populated, so the chart mostly read as empty dashes behind a
meaningless numeric axis.

Full design spec (brainstormed and approved with the owner before
implementation): `docs/superpowers/specs/
2026-07-28-deck2-source-agreement-levels-vs-teams-design.md`.

**Fix:** the chart on both the default and Grid variants now answers the
page's own stated question narrowly — how do the two X-ray inspection levels
compare against the other inspection teams — instead of every one of the 15
possible source pairs:
- 2 rows (المستوى الأول / الثاني), 3 real-name columns (التفتيش اليدوي /
  المعاكس / الوسائل الحية) — a genuine rectangle, no lower-triangle indexing,
  no numeric axis needed at only 3 columns.
- `review` is dropped from the chart (the reviewer card next to it already
  shows both levels vs. the reviewer — repeating those numbers would
  duplicate information one glance away).
- level1↔level2 agreement (previously the single highest-value cell) gets
  its own standalone stat callout above the grid, since it isn't a "level vs
  team" comparison.
- The sample-count (ن) companion table shrinks from a 6×6 triangle to a
  plain 2×3 table.

The Ledger variant's existing 15-row pair table and the Briefing variant's
rank list are unchanged (per the owner's explicit choice during design — the
confusing chart was the readability complaint, not those two table/list
variants). The reviewer card is unchanged in every variant.

**File:** `src/data/reporting/executive/deck2/section3/sourceAgreement.ts`

**Before:**
\`\`\`ts
function buildHeatMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: SOURCE_ORDER.map((source, i) => `${SOURCE_LABELS[source]} (${i + 1})`),
    cols: SOURCE_ORDER.map((_, i) => String(i + 1)),
    values: SOURCE_ORDER.map((rowSource, ri) =>
      SOURCE_ORDER.map((colSource, ci) => {
        if (ci >= ri) return null;
        const cell = pairAt(index, colSource, rowSource);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}
\`\`\`

**After:**
\`\`\`ts
function buildLevelsTeamsMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: LEVEL_SOURCES.map((s) => SOURCE_LABELS[s]),
    cols: TEAM_SOURCES.map((s) => SOURCE_LABELS[s]),
    values: LEVEL_SOURCES.map((level) =>
      TEAM_SOURCES.map((team) => {
        const cell = pairAt(index, level, team);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}
\`\`\`

**File:** `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`

**Before:** (excerpt — the pair-percentages assertion)
\`\`\`ts
    const html = sourceAgreementSlide(model, 12, 24, false);
    expect(html).toContain(">75%</text>"); // L1 × L2
    expect(html).toContain(">90%</text>"); // L1 × reviewer
    expect(html).toContain(">85%</text>"); // L2 × reviewer
\`\`\`

**After:** (excerpt)
\`\`\`ts
    const html = sourceAgreementSlide(model, 12, 24, false);
    for (const pct of [80, 50, 25, 95, 75]) {
      expect(html).toContain(`>${pct}%</text>`);
    }
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(html.slice(statStart, statStart + 300)).toContain("75.0%");
\`\`\`

**Lines:** 242730 → {AFTER from Step 1} (net {+/-N}) · {files from Step 1} files, +{added} / -{removed}
```

Fill in the three `{...}` placeholders in the `**Lines:**` line using the real numbers captured in Step 1 before saving — this file itself must not contain any placeholder text once saved (`CLAUDE.md`'s own edit-log requirement, and this plan's own "no placeholders" rule).

- [ ] **Step 3: Bump `package.json`'s version**

In `package.json`, change:

```json
  "version": "59.69.0",
```

to:

```json
  "version": "59.70.0",
```

- [ ] **Step 4: Verify release consistency**

Run: `npm run check:release`
Expected: PASS (`Release metadata is consistent at v59.70.0.`).

- [ ] **Step 5: Final full verification pass**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "docs/edit logs/2026-07-28.md" "package.json"
git commit -m "$(cat <<'EOF'
Chore (release): v59.70 — source-agreement levels-vs-teams matrix edit log + version bump

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (for the plan author, kept for traceability)

- **Spec coverage:** §1-2 (data shape) → Task 3 Step 2 (`buildLevelsTeamsMatrix`, `levelPairStatHtml`). §3 (component shape/ن table) → Task 3 Step 2 (`levelsTeamsCountsTable`). §4 (per-variant scope) → Task 3 (default) + Task 5 (Grid) implement; Ledger/Briefing explicitly left untouched (no task touches `ledgerBody`/`briefingBody`/`pairsLedgerCard`/`orderedPairs`). §5 (no review column) → enforced by `TEAM_SOURCES` excluding `review`, verified by Task 2 Step 1's `not.toContain(">90%</text>")` and Task 4's `not.toContain("المراجع (المعيار)")`. §6 (complexity) → Task 6 Step 2's `check:complexity` gate. §7 (testing) → Tasks 2 and 4. §8 (out of scope) → Task 7's visual check explicitly does not touch Ledger/Briefing or general font sizing.
- **Placeholder scan:** the only `{...}` placeholders are in Task 8's edit-log template, explicitly called out as required real numbers before saving (matches this plan's own "no placeholders" rule interpreted for a step whose exact output depends on that step's own live command results — the number literally cannot exist before Step 1 of that task runs).
- **Type consistency:** `buildLevelsTeamsMatrix`/`levelsTeamsCountsTable`/`levelPairStatHtml` all take `CrossTeamMatrixCell[]` and are defined once (Task 3) and consumed identically in Task 5 (Grid) — same names, same signatures, both call sites shown verbatim.
