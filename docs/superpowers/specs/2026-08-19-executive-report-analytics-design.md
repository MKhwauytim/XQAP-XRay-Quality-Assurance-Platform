# Executive Report — Section 3 Analytics Rework

**Date:** 2026-08-19
**Status:** design, awaiting owner review
**Scope:** `src/data/reporting/executive/deck2/section3/` plus the model and population-processing
changes those pages need. Sections 1, 2 and 4 are untouched; cover / TOC / glossary are untouched
(owner: "everything before مجتمع الفحص is acceptable").

---

## 1. Purpose

Three things drove this rework, in the owner's words: a **day-of-month accuracy trend**, **more
advanced analytics — more studies**, and a complaint that some existing pages restate each other.

Reading the code answered the third one and reframed the second. Most of the "more analytics"
material is already computed by `ReportModel` and rendered on **zero** pages — so the work is
mostly rendering, not new statistics. The trend chart is the one item that needs a genuinely new
data path, because no inspection date currently reaches the report model at all.

### What is already computed and never rendered in deck2

Established by grepping every non-test module under `deck2/` for each model field:

| Model field | Holds | Rendered? |
|---|---|---|
| `errorAnalysis.byPort` + `.totals` | the four outcome classes, including the **missed-suspicion count** | **nowhere** |
| `reviewerKpis` | SPC p-charts, control limits, throughput, turnaround, referral rate | **nowhere** |
| `employeeByPort` | inspector accuracy by port | nowhere (out of scope by standing decision) |
| `row.certScanStatus` | the trait the sampler stratifies on | carried, never compared |
| `row.targetedByRiskEngine` / `riskMessage` | risk-engine targeting | carried, never evaluated |
| `row.suspicionLevel` / `suspectedTypes` / `smuggleMethod` | reviewer's suspicion characterization | collected, never rendered |
| `kpis.missingImageReasons` | why images were unavailable | computed, unrendered |
| `row.hasReport` / `reportNumber` | seizure-report (محضر) linkage | carried, never used |

This spec consumes `errorAnalysis`, `targetedByRiskEngine`, and `hasReport`. The rest stays
documented for a later pass.

---

## 2. Decisions

Every one of these was an explicit owner decision during brainstorming. They are recorded here
because several look arbitrary until you know what was rejected.

| # | Decision | Rejected alternative and why |
|---|---|---|
| D1 | Trend x-axis is **`xrayEntryDate`** — the day the image was captured | `submittedAt` was cheaper (already ISO, already on the model) but charts when employees happened to work, so a quiet weekend reads as a quality gap |
| D2 | Two lines: **دقة السليمة** and **دقة الاشتباه**, using the deck's existing formulas verbatim | A single blended accuracy line hides that the two have wildly different denominators |
| D3 | Each line carries a **3-sigma control band** that widens on low-volume days | A bare line leaves "is this dip real?" to the reader, and the اشتباه line's ~16-case daily base moves ~6 points per case |
| D4 | New studies: **مصفوفة نتائج الفحص** and **توافق نتائج الفحص مع محرك المخاطر** | CertScan and risk-level accuracy cuts were offered and deferred |
| D5 | The risk-engine page is framed as a **disagreement set**, not a targeting cross-tab | A plain "did targeting predict suspicion" table is largely circular — see §3 |
| D6 | All new pages go in **القسم 3** | Promoting the outcome matrix into القسم 2 was recommended and declined |
| D7 | Date parser is its **own shared module**, called from **Phase 2 processing**, with the report falling back to it for months already on disk | Parsing only at processing time strands every already-processed month; parsing only at report time makes the value unavailable to other consumers |
| D8 | The risk engine gets its **own page**, not a 7th source in page 17's matrix | Adding it to `ALL_SOURCES` was nearly free but pushes that matrix from 15 to 21 cells on a 630px slide |
| D9 | Page 15 gets a **full rework with a real correlation view**, then ships **disabled by default** | De-duplicating it was recommended as the cheaper path for a page slated for removal |
| D10 | Pages 16, 17, 18 unchanged; page 18 explicitly kept | Merging 15/16/18 into one wide port table was offered and declined |

---

## 3. The circularity problem, and why the risk-engine page is framed as it is

The four `المستوى` levels are **already defined in terms of** risk-engine targeting and the other
teams' indicators ([`DEPARTMENT_GLOSSARY.md`](../../reference/DEPARTMENT_GLOSSARY.md)):

| المستوى | Definition |
|---|---|
| الأول | L1/L2 suspected it — no other team, **no risk-engine indicator** |
| الثاني | **risk-engine indicator present**, L1/L2 did **not** suspect |
| الثالث | another team suspected, L1/L2 did not |
| الرابع | L1/L2 missed it, it crossed the border, another authority filed a محضر ضبط |

So a page that cross-tabs "targeted vs not" against "suspected vs not" would substantially
re-derive the stage classification and present it as a finding. That is not an analysis; it is a
restatement of a definition.

The non-circular question inside it: **المستوى الثاني *is* the disagreement set** — the engine
flagged it and our screening cleared it. Asking *what the reviewer found in those cases* measures
our screening against an independent signal. `المستوى الرابع` is the analogous set for محضر. The
page is built around that question, and states the definitional overlap in its own footnote so no
reader mistakes the structural part for a discovery.

---

## 4. Architecture

### 4.1 Date normalization — `parseEntryDate`

New module `src/data/population/entryDateParsing.ts`:

```ts
export type ParsedEntryDate = { iso: string; dayOfMonth: number };
export function parseEntryDate(raw: string | null | undefined): ParsedEntryDate | null;
```

**Accepts:** Excel serial numbers, ISO `yyyy-mm-dd`, `dd/mm/yyyy`, `dd-mm-yyyy`, and any of the
above written with Arabic-Indic digits (`٠١٢٣٤٥٦٧٨٩`), which the risk normalizer already has to
cope with elsewhere.

**Does not accept Hijri.** The risk schema carries Hijri in dedicated `*HijriDate` columns
(`declarationHijriDate`, `movementHijriDate`), so `xrayEntryDate` is Gregorian by construction.
Attempting a Hijri conversion here would silently mangle Gregorian dates that happen to parse.

**Returns `null`, never a guess.** No inference of `dd/mm` vs `mm/dd` from the value: a date that
is ambiguous under the configured order is returned as parsed under that order, and a date that
cannot be read at all is `null`. `null` is a first-class outcome that flows to the `غير مؤرخ`
bucket (§4.4).

Pure — no `Date.now()`, no locale dependence, no I/O. Same input, same output, on every machine.

### 4.2 Phase 2 wiring

`populationProcessor.ts` calls `parseEntryDate` while building each row and stamps:

```ts
xrayEntryDateIso?: string | null;   // new OPTIONAL field on PreparedPopulationRow
```

Optional, matching how `transitDeclarationNumber?`, `manifestNumber?` and friends were added — so
no existing fixture, test, or hand-built row literal anywhere in the repo needs to change.

`xrayEntryDate` (the raw string) is **kept unchanged** alongside it. The exports in
`populationExporter.ts` continue to emit the raw value; nothing that currently reads
`xrayEntryDate` changes behaviour.

### 4.3 Report-time fallback — why both

Months already processed on disk carry no `xrayEntryDateIso`. Reprocessing a real month is the
hours-long path with a documented OOM history, so requiring it would strand every historical
month's trend page.

`buildExecutiveReportRows` therefore resolves the day as:

```
row.xrayEntryDateIso  →  if absent, parseEntryDate(row.xrayEntryDate)  →  if null, undated
```

Same module, same rules, both paths. New months arrive pre-parsed; old months parse on read at no
storage cost. This is the whole content of decision D7.

### 4.4 Model changes

`ExecutiveReportRow` gains three fields, all sourced from `input.populationRows`, which
`buildExecutiveReportRows` already reads:

```ts
entryDay: number | null;          // 1..31, or null = غير مؤرخ
hasReport: boolean;               // a محضر number is present and non-blank
targetedByRiskEngine: string | null;   // RAW value, mapped downstream — see §4.6
```

`DecisionRecord` gains `entryDay` and `hasReport`, carried through unchanged from the row.

`Aggregates` gains:

```ts
byEntryDay: DayAccuracy[];        // one per observed day, ascending
undated: AccuracyMetrics;         // the غير مؤرخ bucket
```

built through the **existing** `aggregateDecisions` fold with a day key. No new accuracy math is
written anywhere in this spec — that is what guarantees the trend page can never disagree with the
port-accuracy page, which is exactly the class of bug the three-independent-folds incident
produced before.

`ReportModel` surfaces `dailyTrend: { days, undated, datedShare }`.

### 4.5 Control limits

`reviewerKpis.ts` already implements p-chart centre lines, 3-sigma limits, and low-n flagging
(`P_CHART_MIN_N`). Extract that math into a shared exported helper and call it from both places.
Do **not** reimplement it — two copies of control-limit math is the same failure mode as two copies
of accuracy math.

Each of the two series gets its own limits computed against **its own** denominator, so the
سليمة band is tight and the اشتباه band is wide, which is the honest picture.

### 4.6 Risk-engine flag mapping

`targetedByRiskEngine` is a `string | null` free-text column, not a سليمة/اشتباه verdict. The
mapping is table-driven in the risk-engine page's own module:

- recognized affirmative → treated as اشتباه (the engine raised a concern)
- recognized negative → treated as سليمة
- **blank, or an unrecognized value → `null`, excluded from every rate**

**A blank must never become سليمة.** A blank means "we do not know what the engine said", not "the
engine cleared it"; mapping blanks to a clean verdict would fabricate agreement across potentially
most of the month and inflate every figure on the page.

The real value vocabulary in production data is **not known at design time**. The page therefore
prints its own recognized / unrecognized / blank counts as a visible line, so the first real month
reveals the vocabulary instead of shipping a silent wrong number. Expanding the recognized lists is
then a one-line change with a test.

---

## 5. Chart primitive

New `timeSeriesBand()` in `ui/analyticsCharts.ts` — the module that already hosts the richer charts
and the `ReferenceLine` machinery, so band rendering is not built from scratch.

```ts
export type BandSeries = {
  label: string;
  tone: ColorRole;
  points: Array<{ x: number; y: number | null; n: number; lo: number | null; hi: number | null }>;
};
export function timeSeriesBand(series: BandSeries[], opts?: TimeSeriesBandOpts): string;
```

- x axis is day-of-month, **1..31 fixed**, not "days present" — a missing day must render as a gap,
  not silently close up and shift every later point left.
- `y: null` renders a gap, never a zero and never an interpolated segment across it.
- Bands render behind lines with reduced opacity; a point outside its band gets an explicit marker,
  because that is the entire reason the band exists.
- Pure SVG string returned at build time. **No runtime layout recomputation** — the deck's
  no-runtime-layout rule, and the reason `DECK_TABLE_FILL_SCRIPT` is the narrow exception it is.
- Legible in both themes and in print: no colour-only encoding, every series distinguishable by
  marker as well as tone.

---

## 6. Pages

Each is a new module in `deck2/section3/`, owning its own CSS, added to `section3/index.ts` as one
import plus one array entry — the contract that file documents. Section 3 goes from 7 to 10
modules, 9 of them rendered.

### 6.1 `dailyTrend.ts` — الاتجاه اليومي للدقة

Two lines over day-of-month, each with its control band, plus a headline stating the **dated share**
(how many of the month's evaluable decisions carried a readable date) and the `غير مؤرخ` count.

That headline is not a footnote. If real `xrayEntryDate` coverage is poor, the chart describes a
fraction of the month and the page must say so where it cannot be missed. The dated share is
computed, displayed, and — below a threshold — accompanied by an explicit caution line.

Days with no evaluable decisions render as gaps. Days below `P_CHART_MIN_N` render their point
hollow and are excluded from any superlative claim, consistent with how every other section-3 page
gates thin bases through `isRankable(band(n))`.

### 6.2 `outcomeMatrix.ts` — مصفوفة نتائج الفحص

The four outcome classes from `errorAnalysis`, which nothing renders today:

|  | المراجع: اشتباه | المراجع: سليمة |
|---|---|---|
| **الفحص: اشتباه** | صحيح — اشتباه مؤكَّد | اشتباه زائد |
| **الفحص: سليمة** | **اشتباه فائت** | صحيح — سليمة مؤكَّدة |

Counts and rates, month-wide, then a per-port table below. The **اشتباه فائت** cell is stated as an
absolute count, not only as a rate — it is the single number an audit of this kind exists to
produce, and no page in the current deck states it.

Every denominator visible; every rate `null`-safe to `—`.

### 6.3 `riskEngineAgreement.ts` — توافق نتائج الفحص مع محرك المخاطر

Three blocks:

1. **Agreement** — engine vs المستوى الأول, vs المستوى الثاني, vs المراجع, each with its `ن`.
   The engine-vs-المراجع row is the independent one and is presented as the headline.
2. **المستوى الثاني disagreement set** — the engine flagged it, our screening cleared it: what did
   the reviewer find? Split by outcome, with counts.
3. **محضر** — cases carrying a report number, and what L1/L2 and the reviewer concluded on them.

Footnotes, both mandatory: the flag→verdict mapping and its unrecognized/blank counts (§4.6), and
the definitional overlap between engine targeting and `المستوى` (§3).

### 6.4 `workloadAccuracy.ts` — reworked, then disabled

Currently restates page 13's accuracy figure from the same source (`model.portAccuracy`), adding
only حجم الصور and الاشتباه الفائت.

Reworked to actually show the relationship its title claims: ports ordered by volume with accuracy
expressed as **deviation from the month's mean**, so the shape is visible rather than inferred by
scanning a column.

**Built from the deck's existing shared primitives and matching the deck's visual system.** The
2026-07-25 removal of this page's bubble scatter was for *inconsistency* — the owner's words were
"why table is different design and different from other tables" — not for being a graph. A new
one-off visual idiom here would repeat that mistake exactly.

Then gated off by default:

```ts
const SHOW_WORKLOAD_ACCURACY_SLIDE = false;
```

Same pattern and same intent as `SHOW_MONTH_NUMBERS_SLIDE` at `slides.ts:3576`, whose comment
already records the rule: dormant, not dead — do not delete the module while the flag is false.
`section3/index.ts` omits its entry when false; TOC ranges, page numbers, and the deck total
recompute automatically, as they already do for an empty section.

---

## 7. Testing

| Area | Tests |
|---|---|
| `parseEntryDate` | table-driven over the full format zoo, including Arabic-Indic digits, Excel serials, and every malformed shape that must return `null` rather than a guess. This is where the bugs will be. |
| Phase 2 stamping | `xrayEntryDateIso` populated on parse; `null` on failure; raw `xrayEntryDate` unchanged |
| Report fallback | a row with `xrayEntryDateIso` uses it; a row with only the raw string parses; a row with neither lands in `غير مؤرخ` |
| `byEntryDay` | day bucketing, ascending order, gap days absent, undated bucket totals reconcile with the month total |
| Control limits | shared helper returns identical values to the reviewer p-chart for identical input |
| `timeSeriesBand` | snapshot; `null` gap rendering; fixed 1..31 axis with sparse data |
| Flag mapping | affirmative / negative / blank / unrecognized, and the counter |
| Each page | snapshot, plus an empty-state case |
| Deck | `deck2.test.ts` snapshot regenerated **deliberately**, diff read page by page |

Reconciliation invariant, asserted in tests: **dated + undated evaluable decisions equal the
month's total evaluable decisions.** That is the guard against the trend page quietly describing a
subset.

Snapshot discipline: snapshot *before* changing a builder, then diff. Never regenerate first.

---

## 8. Gates

Tier 3 — new pages, a new chart primitive, a new field on a persisted row shape:

`lint` · `typecheck` · `test:run` · `check:complexity` · `check:hex-literals` · `check:release` ·
`check:vendor` · `build` · `check:bundle-size`

`check:bundle-size` matters here specifically: three new pages plus a chart primitive move the
single-file bundle, and headroom is finite (~3.34 MB of a 3.6 MB budget at v72).

**Known worktree caveat:** running the suite from a git worktree whose `node_modules` resolves
outside the worktree root fails 8 files / 21 tests with
`Denied ID .../@fontsource/...woff2?inline` — Vite's `server.fs.allow` refusing the inlined font
asset. Reproduces identically at HEAD and is unrelated to any report code. Do not read it as a
regression from this work.

---

## 9. Rollback

Every piece is independently revertible:

- Page flags off → pages vanish, numbering recomputes, nothing else changes
- `xrayEntryDateIso` is additive and optional → removing the Phase 2 call leaves rows valid, and
  the report falls back to parsing the raw string
- `timeSeriesBand` is a new export → unused if no page calls it
- No existing page's output changes except `workloadAccuracy`, which ships disabled

No data migration. No file-format change. `population.final.json` gains one optional field that
older readers ignore.

---

## 10. Out of scope

Named so they are not silently reintroduced:

- **Reviewer/inspector accuracy by name** — computed (`reviewerKpis`, `employeeByPort`) and
  deliberately unrendered; the deck's scope is population-level L1/L2 outcomes
- **Row-level enumeration** — belongs to the document edition and the XLSX
- **Severity language for the four المستوى** — categorical scenarios, never a ranked ladder
- **Cross-month trend** — the model is built from one month's input; a multi-month series needs a
  new data path
- **CertScan and risk-level accuracy cuts (#2, #5)** — offered, deferred
- **توصيف الاشتباه, أسباب عدم توفر الصورة (#4, #6)** — offered, deferred
- **Sections 1, 2, 4 and the front matter** — the owner called everything before مجتمع الفحص
  acceptable, and pages 16/17/18 were explicitly kept as they are

---

## 11. Open questions

1. **What is the real `targetedByRiskEngine` vocabulary?** Unknowable from the code. The
   unrecognized-value counter (§4.6) is the mechanism for finding out; expect one follow-up commit
   after the first real month.
2. **What is real `xrayEntryDate` coverage?** If the dated share is low, the trend page is honest
   but thin, and D1 may deserve revisiting against `submittedAt`.
3. **Which date order does the data use** — `dd/mm` or `mm/dd`? The parser must be configured, not
   guess. Determine from a real file before implementation.
