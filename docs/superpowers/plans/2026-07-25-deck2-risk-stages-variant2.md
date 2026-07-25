# Deck2 Risk-Stages Slide — Variant 2/4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, professional/easier-to-read design ("2 / 4" in the dev-preview variant switcher) for deck2's risk-stages population slide (`riskStagesSlide`, "مجتمع الصور بناءً على المخاطر"), without touching variant 0 ("1 / 4", the current design) or any other slide.

**Architecture:** `riskStagesSlide` (src/data/reporting/executive/deck2/slides.ts) already builds a `bodyVariants: [string, string, string, string]` tuple where only index 0 ever ships to production (`v2Slide`/`renderVariants` in slideKit.ts render only `bodyVariants[0]` when `variantPreview` is false). This plan adds two new private helper functions — `stageCompareBars` (horizontal per-level share bars) and `levelFiguresTable` (exact-figures table with a totals row) — composes them into a new `body2` string, and puts `body2` in `bodyVariants[1]`. New CSS is added to `theme.ts` scoped to the new markup's own classes, reusing existing design tokens (`--gold/--blue/--green/--coral/--slate/--navy`) and the deck's existing base `.deck-table` styling (defined in `../deck/deckTheme.ts`, shared by both deck editions — no need to redefine borders/collapse/zebra-striping).

**Tech Stack:** TypeScript, Vitest, plain template-string HTML/CSS generation (no JSX/React in this reporting layer).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-deck2-risk-stages-variant2-design.md` (approved 2026-07-25).
- `bodyVariants[0]` for `riskStagesSlide` must remain byte-identical to its current value — production output (`buildExecutiveDeckV2` with no `opts`, or `variantPreview: false`) must not change at all.
- No new fields on `ReportModel`/`StageProfile`, no new aggregation logic — every number rendered must come from data `riskStagesSlide` already receives (`model.population.byStage`, `model.population.total`, `model.sample.total`, `model.sample.coverage`, the existing `LEVEL_DRAW_WEIGHTS` constant).
- New CSS must work in both the dark (default) and `body.theme-light` themes, per every other deck2 component.
- Per `CLAUDE.md`: before finishing, add an entry to `docs/edit logs/2026-07-25.md` (today's file already exists — append a new version section at the top, do not create a second file for the date). Run `npm run count-lines -- --quiet` before starting (baseline captured below) and again after, and record `git diff --stat` for the touched files.
- Baseline line count (captured 2026-07-25, before this plan's edits): **224889**.
- Current `package.json`/`package-lock.json` version going in: **59.34.0** → this plan bumps to **59.35.0** (decimal bump — matches this repo's observed convention of bumping the decimal even for sizable additions, e.g. v59.30's 6-page section-3 addition).

---

### Task 1: Compare-bars + exact-figures table for the risk-stages slide (variant 2/4)

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (insert two new functions between `stageProportionBar` and `riskStagesSlide`; modify `riskStagesSlide`'s body)
- Modify: `src/data/reporting/executive/deck2/theme.ts` (insert new CSS block)
- Modify: `src/data/reporting/executive/deck2/deck2.test.ts` (extend the `riskStagesSlide` import, add `fmtNum` import, add new `describe` block)
- Modify: `package.json`, `package-lock.json` (version bump)
- Modify: `docs/edit logs/2026-07-25.md` (new entry)

**Interfaces:**
- Consumes: `StageProfile` type (`stageKey, stageLabel, population, sampleSize, coverage, studied, completionRate` — already imported in slides.ts), `STAGE_TONES` (`["gold","blue","green","coral"] as const`, already imported), `LEVEL_DRAW_WEIGHTS: (number | null)[]` (module-local const already defined in slides.ts above `stageShortTag`), `esc`, `fmtNum`, `fmtPct(n: number | null, digits = 1): string` (already imported from `../primitives`; note `fmtPct(null)` already returns `"—"`).
- Produces: two new private functions `stageCompareBars(stages: StageProfile[], populationTotal: number): string` and `levelFiguresTable(stages: StageProfile[], populationTotal: number, totals: { population: number; sample: number; coverage: number }): string`, both defined in `slides.ts` and used only by `riskStagesSlide` in this same file (not exported — matches the existing convention for `stageProportionBar`/`microArc`/`stageShortTag`, which are also unexported and tested only indirectly through `riskStagesSlide`).

- [ ] **Step 1: Write the two failing tests**

Open `src/data/reporting/executive/deck2/deck2.test.ts`. Change the existing import line (currently `import { monthInNumbersSlide } from "./slides";`) to also pull in `riskStagesSlide`, and add an `fmtNum` import:

```ts
import { monthInNumbersSlide, riskStagesSlide } from "./slides";
import { fmtNum } from "../primitives";
```

Append this new `describe` block at the very end of the file (after the last `});` that closes the `"renders a deterministic seeded cover mesh SVG..."` test's surrounding `describe`):

```ts
describe("riskStagesSlide — variant 2/4: compare-bars + exact-figures table (2026-07-25)", () => {
  it("variant 0 (production / variantPreview=false) never renders the new compare-bars or table markup", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, false);
    expect(html).not.toContain("v2-cbar");
    expect(html).not.toContain("v2-level-table-card");
    // variant 0's own markup still renders untouched
    expect(html).toContain("v2-risk-tile-grid");
    expect(html).toContain("v2-prop-bar");
  });

  it("preview mode's slot 2 (data-variant-index=\"1\") renders the compare-bars + exact-figures table with the model's real per-level and total figures", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, true);

    const panels = [...html.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    expect(panels.length).toBe(4);

    // Isolate panel 1's HTML (between its own opening tag and the next panel's).
    const start = html.indexOf('data-variant-index="1"');
    const end = html.indexOf('data-variant-index="2"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel1 = html.slice(start, end);

    expect(panel1).toContain('<div class="v2-cbar">');
    expect(panel1).toContain('<div class="v2-level-table-card">');
    expect((panel1.match(/class="v2-cbar-row"/g) ?? []).length).toBe(model.population.byStage.length);

    // Every stage's real population/sample figures must appear in the table.
    model.population.byStage.forEach((stage) => {
      expect(panel1).toContain(fmtNum(stage.population));
      expect(panel1).toContain(fmtNum(stage.sampleSize));
    });

    // The totals row must use the exact same totals variant 0's bottom band renders.
    expect(panel1).toContain(fmtNum(model.population.total));
    expect(panel1).toContain(fmtNum(model.sample.total));

    // Variant 0's own panel (index 0) must be untouched — still has the tiles, not the table.
    const panel0Start = html.indexOf('data-variant-index="0"');
    const panel0 = html.slice(panel0Start, start);
    expect(panel0).toContain("v2-risk-tile-grid");
    expect(panel0).not.toContain("v2-level-table-card");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "variant 2/4"`
Expected: FAIL — both new tests fail. The first fails because `riskStagesSlide` doesn't reference `v2-cbar`/`v2-level-table-card` in either branch yet trivially passes (nothing to render means "not.toContain" already holds) — so only the **second** test is truly red at this point, failing on `expect(panel1).toContain('<div class="v2-cbar">')` because panel 1 currently equals panel 0's tile markup. Confirm that specific failure in the output.

- [ ] **Step 3: Add the two new helper functions to slides.ts**

Open `src/data/reporting/executive/deck2/slides.ts`. Find this exact block (immediately before `export function riskStagesSlide`):

```ts
  return `<div class="v2-prop">
    <div class="v2-prop-bar">${segs}</div>
    <div class="v2-prop-legend">${legend}</div>
  </div>`;
}

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
```

Replace it with (adds two new functions between the closing `}` of `stageProportionBar` and the `riskStagesSlide` declaration):

```ts
  return `<div class="v2-prop">
    <div class="v2-prop-bar">${segs}</div>
    <div class="v2-prop-legend">${legend}</div>
  </div>`;
}

/**
 * Horizontal compare-bars: one row per risk level, RTL (label on the right,
 * value on the left, bar fills right→left), tone-colored per STAGE_TONES,
 * value = share of population (%). Variant 2/4 for this slide
 * (docs/superpowers/specs/2026-07-25-deck2-risk-stages-variant2-design.md) —
 * a quick side-by-side read of relative size; levelFiguresTable() right below
 * carries the full numeric breakdown, so this view never needs its own axis
 * or legend.
 */
function stageCompareBars(stages: StageProfile[], populationTotal: number): string {
  const shares = stages.map((s) => (s.population / populationTotal) * 100);
  const max = Math.max(0, ...shares);
  const rows = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const pct = shares[i];
      const w = max > 0 ? Math.max(2, (pct / max) * 100) : 0;
      return `<div class="v2-cbar-row">
        <span class="v2-cbar-label">${esc(s.stageLabel)}</span>
        <span class="v2-cbar-track"><i class="v2-cbar-fill ${tone}" style="width:${w.toFixed(1)}%"></i></span>
        <span class="v2-cbar-value">${fmtPct(pct, 0)}</span>
      </div>`;
    })
    .join("");
  return `<div class="v2-cbar">${rows}</div>`;
}

/**
 * Exact-figures table for the 4 risk levels — one row per level plus a
 * totals row using the exact same population/sample/coverage totals variant
 * 0's bottom band renders, so the two variants never disagree. Variant 2/4
 * for this slide, see stageCompareBars() above.
 */
function levelFiguresTable(
  stages: StageProfile[],
  populationTotal: number,
  totals: { population: number; sample: number; coverage: number },
): string {
  const rows = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const share = (s.population / populationTotal) * 100;
      const weight = LEVEL_DRAW_WEIGHTS[i] ?? null;
      return `<tr>
        <td><span class="v2-level-row-num ${tone}">${i + 1}</span></td>
        <td>${esc(s.stageLabel)}</td>
        <td>${fmtPct(weight, 0)}</td>
        <td>${fmtPct(share, 0)}</td>
        <td>${fmtNum(s.population)}</td>
        <td>${fmtNum(s.sampleSize)}</td>
        <td>${fmtPct(s.coverage)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="v2-level-table-card">
    <table class="deck-table">
      <thead><tr>
        <th></th><th>المستوى</th><th>وزن العينة</th><th>من المجتمع</th>
        <th>صورة</th><th>العيّنة</th><th>تغطية العيّنة</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td></td><td>الإجمالي</td><td>—</td><td>100%</td>
        <td>${fmtNum(totals.population)}</td><td>${fmtNum(totals.sample)}</td><td>${fmtPct(totals.coverage)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
```

- [ ] **Step 4: Wire `body2` into `riskStagesSlide` and update `bodyVariants`**

In the same file, find this exact block (the tail of `riskStagesSlide`):

```ts
  const body = `<div class="v2-risk-layout">
    ${stageProportionBar(stages)}
    <div class="v2-risk-tile-grid">${tiles}</div>
    ${totals}
  </div>`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الصور بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الصور بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}
```

Replace it with:

```ts
  const body = `<div class="v2-risk-layout">
    ${stageProportionBar(stages)}
    <div class="v2-risk-tile-grid">${tiles}</div>
    ${totals}
  </div>`;
  const body2 = `<div class="v2-risk-layout">
    ${stageCompareBars(stages, populationTotal)}
    ${levelFiguresTable(stages, populationTotal, {
      population: model.population.total,
      sample: model.sample.total,
      coverage: model.sample.coverage,
    })}
  </div>`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الصور بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الصور بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body2, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}
```

- [ ] **Step 5: Add the new CSS**

Open `src/data/reporting/executive/deck2/theme.ts`. Find this exact block:

```ts
body.theme-light .v2-risk-tile-foot{background:rgba(10,45,74,.035);border-color:#e4e9ee;}
@media screen and (max-width:820px){
  .v2-risk-tile-grid{grid-template-columns:1fr;grid-template-rows:repeat(4,auto);}
}

/* ── Ports overview strip (bottom half of the merged summary page) — reuses
```

Replace it with (inserts the new block between the media query's closing `}` and the ports-overview-strip comment):

```ts
body.theme-light .v2-risk-tile-foot{background:rgba(10,45,74,.035);border-color:#e4e9ee;}
@media screen and (max-width:820px){
  .v2-risk-tile-grid{grid-template-columns:1fr;grid-template-rows:repeat(4,auto);}
}

/* ── Compare-bars + exact-figures table — risk-stages slide, variant 2/4
   (docs/superpowers/specs/2026-07-25-deck2-risk-stages-variant2-design.md).
   Variant 0's tiles/proportion-bar above are untouched; this is an alternate
   body for the same slide, selected only via the dev-preview variant
   switcher — never shipped in production. */
.v2-cbar{display:flex;flex-direction:column;gap:10px;}
.v2-cbar-row{display:flex;align-items:center;gap:12px;}
.v2-cbar-label{flex:0 0 auto;min-width:110px;font-size:.78rem;font-weight:700;color:#fff;text-align:right;}
.v2-cbar-track{flex:1 1 auto;height:22px;border-radius:7px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);overflow:hidden;position:relative;}
.v2-cbar-fill{position:absolute;inset-inline-end:0;top:0;height:100%;border-radius:7px;}
.v2-cbar-fill.gold{background:var(--gold);}
.v2-cbar-fill.blue{background:var(--blue);}
.v2-cbar-fill.green{background:var(--green);}
.v2-cbar-fill.coral{background:var(--coral);}
.v2-cbar-value{flex:0 0 auto;min-width:40px;text-align:left;font-size:.82rem;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;}
.v2-level-table-card{margin-top:14px;}
.v2-level-table-card .deck-table th,.v2-level-table-card .deck-table td{padding:9px 10px;font-size:.76rem;text-align:center;}
.v2-level-table-card .deck-table th:nth-child(2),.v2-level-table-card .deck-table td:nth-child(2){text-align:right;}
.v2-level-row-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:.68rem;font-weight:900;color:var(--navy);background:var(--gold);}
.v2-level-row-num.blue{background:var(--blue);}
.v2-level-row-num.green{background:var(--green);}
.v2-level-row-num.coral{background:var(--coral);}
.v2-level-table-card .deck-table tfoot td{font-weight:900;}
body.theme-light .v2-cbar-label,body.theme-light .v2-cbar-value{color:#0a2d4a;}
body.theme-light .v2-cbar-track{background:#eef2f6;border-color:#dde4ea;}
body.theme-light .v2-level-row-num{color:#fff;}

/* ── Ports overview strip (bottom half of the merged summary page) — reuses
```

- [ ] **Step 6: Run the two tests again and verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "variant 2/4"`
Expected: PASS (2 passed).

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npm run test:run`
Expected: all test files pass (1098+ tests — 2 more than the pre-plan baseline of 1098, since this task adds exactly 2 new tests). Pay attention to any other `deck2.test.ts` test that counts total `v2-variant-panel`/`v2-variant-stack` occurrences globally (there is one, in the "preview mode" describe block) — it counts panels per slide generically (`stackOpens.length * 4`), so it is unaffected by variant 1's content changing, only by panel *count*, which stays 4.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors (the new functions/CSS follow existing patterns — no new dependencies, no new `any` types).

- [ ] **Step 9: Manual verification in the live dev-preview**

If a dev server is already running (`npm run dev`), reload the executive report's dev-preview view with `variantPreview: true` wired on (however this repo's dev entry currently exposes it — check `src/dev/` or the Report Designer's preview toggle), cycle the risk-stages slide ("مجتمع الصور بناءً على المخاطر") to "2 / 4", and confirm: the compare-bars show 4 (or however many stages the current workspace's data has) tone-colored rows with readable share percentages; the table below shows one row per level plus a correct totals row; nothing is clipped; both light and dark theme render legibly. This slide never paginates (4 data rows + 1 totals row is far under `BASE_ROWS_PER_PAGE = 7`), so no overflow/compact-mode check is needed.

- [ ] **Step 10: Bump the version and add the edit-log entry**

Run: `npm run count-lines -- --quiet` (record the new total — compare against the 224889 baseline captured before this plan started).

Run: `git diff --stat` (with all of this task's changes staged) to get the exact +added/-removed breakdown per file.

In `package.json`, change:
```json
  "version": "59.34.0",
```
to:
```json
  "version": "59.35.0",
```

In `package-lock.json`, change both occurrences:
```json
  "name": "x-ray-quality-app",
  "version": "59.34.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "x-ray-quality-app",
      "version": "59.34.0",
```
to:
```json
  "name": "x-ray-quality-app",
  "version": "59.35.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "x-ray-quality-app",
      "version": "59.35.0",
```

Open `docs/edit logs/2026-07-25.md` and insert a new version section at the top of the entry list (immediately after the file's `---` separator that follows the intro line, i.e. as the new first entry, above whatever is currently the most recent entry there). Use this template, filled in with the real `git diff --stat` numbers and the real before/after count-lines totals from this step:

```markdown
## v59.35 — 2026-07-25 — Add (executive-deck/deck2): compare-bars + exact-figures table variant (2/4) for the risk-stages slide

Owner-approved dev-preview variant per
docs/superpowers/specs/2026-07-25-deck2-risk-stages-variant2-design.md — a
more professional/readable alternate for مجتمع الصور بناءً على المخاطر,
filling slot 2/4 of the existing 4-variant switcher. Variant 1/4 (today's
tiles + proportion bar) is untouched and still what production ships.

**File:** `src/data/reporting/executive/deck2/slides.ts`

**Before:**
```ts
  const body = `<div class="v2-risk-layout">
    ${stageProportionBar(stages)}
    <div class="v2-risk-tile-grid">${tiles}</div>
    ${totals}
  </div>`;
  return v2Slide({
    ...
    bodyVariants: [body, body, body, body],
    ...
  });
```

**After:**
```ts
  const body = `<div class="v2-risk-layout">...</div>`;
  const body2 = `<div class="v2-risk-layout">
    ${stageCompareBars(stages, populationTotal)}
    ${levelFiguresTable(stages, populationTotal, { population: model.population.total, sample: model.sample.total, coverage: model.sample.coverage })}
  </div>`;
  return v2Slide({
    ...
    bodyVariants: [body, body2, body, body],
    ...
  });
```

**File:** `src/data/reporting/executive/deck2/theme.ts`

**Before:** (no `.v2-cbar`/`.v2-level-table-card` rules existed)

**After:** (new scoped CSS block — compare-bars + level-figures-table styling, dark + light theme)

**File:** `src/data/reporting/executive/deck2/deck2.test.ts`

**Before:** `riskStagesSlide` had no dedicated test coverage beyond the production-path assertions in the rest of the suite.

**After:** new `describe("riskStagesSlide — variant 2/4: ...")` block — 2 tests (variant-0 unchanged; variant-1 renders the real per-level and total figures).

**Lines:** 224889 → {actual total from this step} (net {+/-N}) · 5 files, +{added} / -{removed}
```

- [ ] **Step 11: Commit**

```bash
git add src/data/reporting/executive/deck2/slides.ts src/data/reporting/executive/deck2/theme.ts src/data/reporting/executive/deck2/deck2.test.ts package.json package-lock.json "docs/edit logs/2026-07-25.md"
git commit -m "$(cat <<'EOF'
Add (executive-deck/deck2): compare-bars + exact-figures table variant (2/4) for the risk-stages slide

Fills slot 2/4 of the existing dev-preview variant switcher for
مجتمع الصور بناءً على المخاطر per the owner-approved
2026-07-25-deck2-risk-stages-variant2-design.md spec. Variant 1/4 is
byte-identical to before; production output is unaffected.
EOF
)"
```
