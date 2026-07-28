# deck2 three-system fan-out — remaining pages plan (Opus, 2026-07-25)

Status: design plan, approved for implementation per standing delegation ("ask always opus 5" — [[user_preferences]]). Author: Opus (dispatched via Agent tool, `model: "opus"`), consulted in place of the user per the user's explicit 2026-07-25 instruction. This is the implementation-ready plan for the remaining ~17 un-fanned-out deck2 pages, following the same 3-system contract (`docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md`) already proven on the port-population exemplar.

Batching/order (see full detail below): **P0 (shared primitives) → B1 (risk-stages, alone) → B2a/B2b (mechanical clones) → B3 (bespoke, one page per pass) → B4 (narrative pages)**. `slide-sep-1/2/3` and the dormant `slide-month-numbers` get no fan-out (reasoned below).

---

# deck2 three-system fan-out — page-by-page design plan

**Scope note on two spec lines that are already superseded (don't let implementers re-derive them):**
- Spec §2 says Briefing carries "at most one ranked-bar chart (≤6 categories)". That was superseded by the 2026-07-25 density-ladder ruling now shipped as `briefingRankPlan` (up to 14 named rows + one folded remainder). **`briefingRankPlan` is the operative contract.**
- The infra plan's Task-2 text says Briefing "DROPS the support strip at compact tier". Also superseded — the shipped `BRIEFING_RANK_BUDGET_PX = 264` already subtracts a *permanently present* 55px strip. **The strip is always rendered.**
- Confirmed: **`slide-sep-3` exists** (`section3/index.ts` calls `sectionSeparatorSlide({ sectionNo: 3 })`).

---

## 0. BUILD THIS FIRST — shared primitives (blocking, no page work in this pass)

Six extractions. Without them, six pages would each re-hand-roll the ranked-list column-split + remainder-scale logic that has already been through **two** peer-review bug rounds (v59.47's algebraic no-op, and the dropped-rows budget error). That is the single highest-risk duplication in this fan-out.

All in `src/data/reporting/executive/deck2/slideKit.ts` unless noted.

| # | Name | Signature | Used by |
|---|------|-----------|---------|
| P1 | `ledgerIdx` | `(i: number) => string` — returns `<span class="v2-lg-idx">${i+1}</span>` | every Ledger table |
| P2 | `ledgerPortCard` | `(opts: { title: string; theadCells: string; bodyRowsHtml: string; totalsRowHtml: string; span: number; rowCount: number; compact: boolean; extraClass?: string; emptyText?: string }) => string` | 8 pages |
| P3 | `briefingLede` | `(opts: { figure: string; tone: BriefingTone; label: string; basis: string; arc?: number \| null }) => string` | every Briefing page |
| P4 | `briefingSupport` | `(items: Array<{ iconName: string; value: string; label: string }>) => string` — `slice(0,3)` enforced, returns `""` on empty | every Briefing page |
| P5 | `briefingRankList` | see below | 15 pages |
| P6 | `gridPanel` | `(opts: { title: string; sub: string; variant?: string; chartHtml: string }) => string` → `.v2-gd-panel` markup | every Grid page |

**P2 detail:** thin wrapper over `ledgerTableCard` that assembles `cardClass: ["v2-lg-port-card", compact && "compact", extraClass].filter(Boolean).join(" ")`, and emits the `colspan` placeholder row when `bodyRowsHtml === ""`. Defaults `rowCount: 0` semantics through — **one exception**, see the stage×port pages below.

**P5 — the important one:**

```ts
export type BriefingTone = "gold" | "blue" | "green" | "coral";
export type BriefingRankItem = {
  label: string;
  /** Bar magnitude. null → row renders with no bar (listed but unmeasured). */
  value: number | null;
  /** Pre-formatted figure (fmtNum / fmtPct / signed delta). */
  valueText: string;
  secondaryText: string;
  /** Per-row tone override; defaults to the page tone. */
  tone?: BriefingTone;
  rest?: boolean;
};
export function briefingRankList(opts: {
  /** ALREADY in display order. This function NEVER re-sorts. */
  items: BriefingRankItem[];
  tone: BriefingTone;
  /** "auto" = max(named max, remainder value) — the reviewed exemplar rule.
   *  "fixed" (max: 100) for rate pages, where a max-normalized bar would lie. */
  scale: { kind: "auto" } | { kind: "fixed"; max: number };
  /** Builds the single trailing remainder row from the folded tail. */
  foldRemainder?: (folded: BriefingRankItem[]) => BriefingRankItem;
  /** false → no bar tracks; the label expands. Default true. */
  bars?: boolean;
}): string;
```

Body = today's `briefingPortRank` verbatim from `const plan = briefingRankPlan(...)` onward, including the peer-reviewed `scaleMax` fold-in and the "first (rightmost) column gets ranks 1…K" split. Two new capabilities beyond the exemplar: per-item `tone` (needed for risk-level identity and signed deltas) and `bars: false` (needed for definitional/provenance lists).

**P7 (analyticsCharts.ts, docs+test only, no code change):** a **reversed `domain: [hi, lo]` inverts a `diverging-green-coral` column's polarity.** Verified from source (`span`/`half` go negative, so `signed = (v-mid)/half` flips). Document it in `metricMatrix`'s doc comment and add a unit test — `slide-s3-level-accuracy`'s الفارق column depends on it, and it must be a stated contract, not an accident.

**Then:** reimplement the exemplar's `ledgerPortTable` / `briefingPortRank` / `gridPortMatrix` on P1–P6 with **byte-identity characterization tests pinning `slide-port-population-1` panels 1/2/3 to their current output first** — same discipline `levelFiguresTable`'s extraction used. Nothing else ships until that's green.

**Two standing rules that apply everywhere below, state once:**
1. **Empty states are shared across all 4 slots** (`emptyBody()`, `emptyState()`, the `insuff` placeholder rows). No per-system empty states.
2. **Mandatory prose carries verbatim into all 3 new slots** (`CAVEAT`, `SCOPE_NOTE`, `SCOPE_FOOTNOTE`, `LEVEL_FOOTNOTE`, `CAUSAL_CAVEAT`, the quality-impact caveat). Folding a caveat into a Briefing basis chip is allowed *in addition*, never *instead*.

**Page tone assignment (Briefing):**

| Page | Tone | Why |
|---|---|---|
| port-population (shipped) | gold | — |
| port-sample | blue | adjacent to port-population; tone change signals population→sample |
| risk-stages | gold | section-1 identity (rows override per-level) |
| stage-port-population / -sample | gold / blue | mirrors the pair above |
| quality-ports | coral | the lede is the low-quality share |
| quality-accuracy | green | accuracy |
| s3-workload | gold | volume |
| s3-level-accuracy | blue | inspection-level axis |
| s3-port-agreement | gold | agreement |
| s3-source-agreement | green | agreement-with-reviewer |
| s3-marking | gold | signed effect |
| s3-quality | coral | quality gradient |
| toc / glossary ×2 / closing | blue / gold / gold | narrative pages |

---

## 1. `slide-toc` — `tocSlide` (slides.ts:166)

Data: `TocItem[]` = `{title, goal, range, iconName, tone, figure, figureLabel}` + the deck `total`. `figure` values are heterogeneous strings — not comparable, so nothing cross-section is rankable except *page span*, derivable from `range`.

- **Ledger** — `ledgerTableCard`, `cardClass: "v2-lg-toc-card"`, `rowCount: 0`. Columns `<th></th><th>القسم</th><th>الهدف</th><th>المؤشر</th><th>الصفحات</th>`; ordinal via `ledgerIdx(i)`; المؤشر = `${figure} ${figureLabel}`; الصفحات = `range` with `dir="ltr"`. Real totals row: `<td>الإجمالي</td>…<td>${pad(total)} صفحة</td>`.
- **Briefing** — lede figure = `total`, tone blue, label «محتويات التقرير — {items.length} أقسام في {total} صفحة», basis = «{items.length} قسمًا مفهرسًا». Support (3): عدد الأقسام / أكبر قسم (max span, صفحة) / أصغر قسم (min span). Rank rows = **document order, not sorted**: bar = section page span (`scale: auto`), value = `${span} صفحة`, secondary = `${figure} ${figureLabel}`.
- **Grid** — **no matrix.** One metric + one indispensable non-metric field (goal sentence). Reuse slot-0 `.v2-toc-grid` body wrapped `v2-sys-grid v2-gd-toc`, CSS-only restyle (uniform equal cells, square corners, hairline gridlines, page-span as `--w` tint).

---

## 2. `slide-month-numbers` — **SKIP entirely.**

`SHOW_MONTH_NUMBERS_SLIDE = false` short-circuits the call site; slots 1–3 never render even in admin preview. Revisit only if the gate flips.

---

## 3a. `slide-glossary-levels` (slides.ts:519)

Data: 4 static `RISK_LEVELS` + one live `LEVEL_DRAW_WEIGHTS[i]`. Categorical, not ranked.

- **Ledger** — `ledgerTableCard`, `cardClass: "v2-lg-glossary-card"`, `rowCount: 0`. Columns: `#` | المستوى | التعريف | ما يقيسه | وزن العينة. **No totals row** — weights deliberately don't sum to 100. tfoot **footnote row** (colspan): «وزن المستوى الأول نسبة من مجتمعه (حصر شامل)؛ وبقية الأوزان حصص من حصة العدد الثابت — الأساسان مختلفان ولا يجمعان إلى 100%». Verify 4×~3-line rows fit 459px in preview.
- **Briefing** — lede = `4`, tone gold, label «أربعة مستويات مخاطر — تصنيفٌ للحالات لا ترتيبٌ لخطورتها», basis = «تعريفات ثابتة لا تتغير شهريًا». Support (3): وزن المستوى الأول (100%) / حصة العدد الثابت (`exactPool`) / عدد المستويات ذات الحصة الثابتة (3). Rank rows = 4, **level order**, `tone: STAGE_TONES[i]`, `scale: {kind:"fixed", max:100}` (different bases — no shared max), value = `fmtPct(weight,0)`, secondary = `measures`. Page-local CSS to widen `.v2-bf-rank-secondary`.
- **Grid** — **no matrix** (one metric over four entities). Reuse slot-0 `.v2-level-grid` wrapped `v2-sys-grid v2-gd-glossary-levels`, restyled uniform cells with the وزن figure as a tinted magnitude cell. Do **not** import `riskStagesSlide`'s live figures to manufacture columns.

## 3b. `slide-glossary-1` (slides.ts:535)

Data: 2 categories × {3,2} terms. Zero numbers.

- **Ledger** — two stacked `ledgerTableCard`s (one per category), columns المصطلح | التعريف, `totalsRowHtml: ""`, `rowCount: 0`. New `.v2-lg-split.stack` (vertical).
- **Briefing** — lede = term count (5), label «{N} مصطلحًا في فئتين», basis = the two category labels. **No support strip** (`briefingSupport([])` → `""`). Rank rows via **`bars: false`**, grouped by category order.
- **Grid** — zero metrics. Reuse slot-0 term bands wrapped `v2-sys-grid v2-gd-glossary-terms`, uniform cells, hairline separators, no tint. Explicit degenerate case — say so in the code comment.

---

## 4. `slide-sep-1` / `-2` / `-3` — `sectionSeparatorSlide` (slides.ts:567)

**No fan-out. Leave `[sepBody, sepBody, sepBody, sepBody]`. Zero code change.**

Reasoning: the owner explicitly stripped `keyStatValue`/`keyStatLabel`/`takeaway`/`extra` from these pages (doc comment records the decision: removed *so no call site can quietly pass data that never renders*). All three systems' differentiators need data this page deliberately has none of. A variant would either re-add stripped statistics (reversing a standing owner decision) or be a pure reskin of the slide shell, which spec §5 forbids. Considered a per-system accent via the sanctioned `:has()` exception and rejected it: 3 pages × 3 selectors × 2 themes of risk for a rule-weight change nobody will notice.

---

## 5. `slide-risk-stages` — `riskStagesSlide` (slides.ts:743) — RECONCILIATION

**Ruling: `stageCompareBars` is a chart, and it leaves Ledger.**

Spec §4 already decided the general question ("`stageCompareBars`/`.v2-cbar*`: do NOT extend to Ledger. Repoint the CSS skeleton to become Briefing's `.v2-bf-rank`"). It preserved only the *shipped output* of this page as a grandfather clause to avoid churning a page nobody was touching. We are now deliberately touching it, so the clause expires. A labelled bar with a proportional track is a chart by any reading.

- **Ledger slot 1 = `levelFiguresTable` alone**, `stageCompareBars` dropped. Add a **«ما يقيسه» column** from `RISK_LEVELS[i].measures` (page has ~190px of vertical slack once the bars go) plus the same two-basis footnote row as the glossary Ledger.
  - ⚠️ **This deliberately breaks `deck2.test.ts`'s "levelFiguresTable byte-identity characterization" / variant-1 pin.** Update the expectation in the same commit and name the supersession in the edit-log entry.
- **Briefing** — lede = `model.sample.coverage`, tone gold, **with `microArc`**, label «تغطية العيّنة {x}% — {sample} من {population} صورة», basis «أربعة مستويات · {periodId}». Support (3): إجمالي المجتمع / إجمالي العيّنة / أكبر مستوى حصةً. Rank rows = 4, **level order, never sorted by size**, per-row `tone: STAGE_TONES[i]`, `scale: auto`, bar = share of population, value = `fmtPct(share,0)`, secondary = «العيّنة {n} · تغطية {c}%».
  - *New call:* per-row tone override (spec fixes one tone per page). Reason: `STAGE_TONES` is a cross-page **identity** encoding (same colour = same level on glossary, stage×port cards, and here) — preserving that invariant matters more than the one-tone-per-page cohesion rule.
- **Grid** — one full-width `gridPanel` + `metricMatrix`. Rows = 4 stage labels. Columns: الصور `[0,max]` · العيّنة `[0,max]` · من المجتمع `[0,100]` · تغطية العيّنة `[0,100]`, all `sequential-gold`. Panel head sub carries totals.
  - **وزن العينة deliberately excluded** — a config figure with two different bases; `metricMatrix` has no annotation affordance to disclose that. Ledger (footnote) and Briefing (basis chip) can carry it honestly; Grid cannot.

---

## 6. `slide-port-sample-N` — `portSampleSlideBuilders` (slides.ts:1097)

**Near-clone of the exemplar. Batchable.**

- **Ledger** — `ledgerPortCard`, span 5, `extraClass: "sample-mode"`, ordinal + `frac(sample,pop)` cells + التغطية column. Keep `frac()` (numerator+denominator in one cell = maximally auditable). New theme.ts rule: `.v2-lg-port-card.sample-mode` (taller row padding).
- **Briefing** — lede = leading port **by `sampleTotal`**, tone blue, label «أعلى منفذ عيّنةً: {name} — {n} من {total} صورة», basis «{portCountPhrase(n)} · إجمالي عيّنة الصفحة {s} من {p}». Support (3): إجمالي العيّنة / عيّنة السليمة / تغطية الصفحة %. Rank rows sorted by `sampleTotal` desc, `scale: auto`, secondary «من {total} · تغطية {c}%»; `foldRemainder` sums `sampleTotal` and pools coverage from summed numerator/denominator (never averages rates).
- **Grid** — `gridPortMatrix` sibling, land/sea panels. Columns: العيّنة `[0,max]` · المجتمع `[0,max]` · التغطية `[0,100]` · اشتباه العيّنة `[0,max]`, all `sequential-gold`.

---

## 7. `slide-stage-port-population` + `slide-stage-port-sample` (slides.ts:1275, 1302)

4 stage cards × top-5 ports. Non-paginated. Totals pinned to `StageProfile` (frozen sample-draw snapshot) — pinning must survive into all three systems.

- **Ledger** — 4 `ledgerTableCard`s in the existing 2×2 grid, same columns as slot 0 + `ledgerIdx`. `title` discloses the basis: `${stageLabel} — أعلى 5 من ${portCountPhrase(n)}`.
  - ⚠️ **The one place Ledger must NOT use `rowCount: 0`.** `DECK_TABLE_FILL_SCRIPT` measures `.v2-stage-port-card`; pass `cardClass: "v2-lg-stage-card v2-stage-port-card ${tone}"` **and** `rowCount: top.length` so the measured totals-pinning keeps working.
- **Briefing** — lede = single largest (stage,port) cell: figure = that count, label «أعلى تركّز: {port} في {stageLabel} — {n} صورة», tone = that stage's `STAGE_TONES`. Support (3): إجمالي المجتمع / عدد المستويات (4) / أعلى منفذ إجماليًا. Rank rows = **4, one per stage**: numeral = stage number, `tone: STAGE_TONES[i]`, bar = stage population, value = stage population, secondary = «أعلى منفذ: {port} ({n})». Sample page: same shape with `sampleSize`/`sampleTotal`, secondary «تغطية {c}%».
- **Grid** — **best Grid page in the deck.** One matrix, **transposed**: rows = 4 stage labels; columns = top-5 ports by overall month population; values = that (stage,port) count. All five columns share `domain: [0, globalMax]` (expressed per-column, honest and visible since `metricMatrix` prints each domain). Sample page: values = `sampleTotal`.
  - ⚠️ 5 long Arabic port names as column headers will overflow. Add `truncLabel(s,n)` helper in slideKit, pre-truncate caller-side (full names stay in the sr-table) — do not modify the chart module.

---

## 8. `slide-quality-ports-N` — `qualityPortSlideBuilders` (slides.ts:1428)

- **Ledger** — `ledgerPortCard`, same 5 columns (عالي/متوسط/منخفض/التحديد + name), ordinal, `qualCell`/`threshCell` preserved (threshold tone+glyph is functional colour, Ledger-legal per spec §2). Card title discloses denominator: `المنافذ البرية — {N} منفذ · {evaluatedTotal} صورة مُقيَّمة`. Rejected a per-row base line in the name cell — adds row height, risks clipping at compact tier (10 rows, no filler-row safety net).
- **Briefing** — lede = pooled **low-quality share** for the slice, tone coral, label «جودة منخفضة {x}% — {lowN} من {evalN} صورة مُقيَّمة», basis «{portCountPhrase(n)} في هذه الصفحة». Support (3): عالي % / متوسط % / التحديد %, pooled. Rank rows sorted by low-quality rate **desc (worst first)**, ports with `evaluated>0` only, `scale: {kind:"fixed",max:100}`, secondary «من {evaluated} صورة». `evaluated===0` ports excluded, folded into a **bar-less remainder** (`value:null`) «منافذ بلا صور مُقيَّمة ({k})»; remainder pools `ΣlowQ/Σevaluated`, never averages rates.
- **Grid** — rows = ports, columns عالي/متوسط/منخفض/التحديد, **all `[0,100] sequential-gold`**, land/sea panels.
  - *New call:* rejected `diverging-green-coral` for منخفض — a diverging ramp needs a genuinely meaningful midpoint (only a signed delta has one in this deck); 50% has no meaning for a low-quality share. The 90% التحديد target can't be encoded in Grid (no threshold vocabulary) — put it in the panel head sub: «هدف التحديد 90%».

---

## 9. `slide-quality-accuracy-N` — `accuracyPortSlideBuilders` (slides.ts:1543)

- **Ledger** — `ledgerPortCard` + ordinal, `threshCell` preserved, **plus a new العيّنة column** = `fmtNum(p.evaluable)` (slot 0 has only 4 columns, budget exists, and a rate without its denominator is exactly what Ledger exists to fix). Span 5. Card title carries pooled base.
- **Briefing** — lede = pooled الدقة العامة for the slice, tone **green fixed** (tone is page identity, never pass/fail state), label «الدقة العامة {x}% — {correct} من {evaluable} قرار», basis «{portCountPhrase(n)} · هدف {ACCURACY_TARGET}% · الأقل دقة أولًا». Support (3): دقة الاشتباه % / دقة السليمة % / عدد المنافذ دون حد الكفاية. Rank rows sorted **ascending** by accuracy (worst first) among `rankable` ports, `scale: {kind:"fixed",max:100}`, secondary «العيّنة {evaluable}»; unrankable → bar-less remainder «منافذ دون حد الكفاية ({k})». Basis chip's «الأقل دقة أولًا» is load-bearing — without it rank #1 misreads as "best".
- **Grid** — rows = ports; columns الدقة العامة / دقة الاشتباه / دقة السليمة `[0,100]` + العيّنة `[0,max]`, all `sequential-gold`. Unrankable ports pass `null` for the three rate columns (renders "—") while still showing العيّنة. Panel head sub: «هدف الدقة 90%».

---

## 10. `slide-closing` — `closingSlide` (slides.ts:1578)

- **Ledger** — natural fit; a provenance record *is* a ledger. `ledgerTableCard`, columns الملف/المصدر | الوصف | المراجعة/العدد. Rows: the two source cards as two rows, then one row per `sourceRevisionEntries` item (`dir="ltr"` filename). No-revisions case keeps the existing graceful note as a `colspan` row. tfoot carries classification line spanning all columns. Org block + badge carry verbatim below.
- **Briefing** — lede = `src.riskRowCount`, tone gold, label «{n} صورة من بيانات وكالة المخاطر», basis «فترة الدراسة {periodId}». Support (3): بيانات ذكاء الأعمال / عدد ملفات المصدر المُسجَّلة / التصنيف. Then `briefingRankList` with **`bars:false`** listing source revisions. Org block verbatim.
- **Grid** — **no meaningful matrix** (zero entities × comparable metrics; provenance is key→value). **Grid reuses the Ledger body**, wrapped `v2-sys-grid v2-gd-closing`. Deliberate degenerate case — document it.

---

## 11. Section 3

### 11a. `slide-s3-workload` — `workloadAccuracySlideBuilders`
Columns: المنفذ | حجم الصور | الدقة | الاشتباه الفائت | العيّنة. `CAVEAT` strip mandatory; `emptyBody()` shared.
- **Ledger** — `ledgerPortCard` clone, same 5 columns + ordinal. Caveat strip verbatim below.
- **Briefing** — lede = busiest port's accuracy, tone gold, label «أعلى المنافذ حجمًا: {name} — دقة {x}% على {n} صورة», basis «{portCountPhrase(n)} · ارتباط وصفي لا سببي». Support (3): إجمالي حجم الصور / الدقة المجمّعة % / الاشتباه الفائت المجمّع %. Rank rows in the page's own workload-desc order, **bar=workload, secondary=«دقة {x}%»**. Caveat verbatim.
- **Grid** — rows=ports; columns حجم الصور `[0,max]` / الدقة `[0,100]` / الاشتباه الفائت `[0,100]` / العيّنة `[0,max]`, `sequential-gold`; unrankable→null rates. Land/sea panels. Caveat verbatim.

### 11b. `slide-s3-level-accuracy` — `levelAccuracySlideBuilders`
Columns: المنفذ | دقة الأول | دقة الثاني | الفارق | العيّنة. `emptyState()` shared.
- **Ledger** — `ledgerPortCard` clone, same 5 columns + ordinal; keep `deltaSpan` (a signed figure, not a chart) and the detection tooltip.
- **Briefing** — lede = pooled signed delta (from summed integer counts via `statsOf(sumCounts(...))`, never rounded rates), tone blue, label «فارق المستويين {±x} نقطة — الثاني {a}% مقابل الأول {b}%», basis «{portCountPhrase(n)} · {evaluable} قرار قابل للتقييم». Support (3): دقة المستوى الأول / دقة المستوى الثاني / العيّنة الإجمالية. Rank rows by **|الفارق| desc** among rankable ports, `scale: auto` on |delta|, **per-row tone: green if positive, coral if negative** (sign also printed, never colour alone), value = signed delta `dir="ltr"`, secondary «الأول {a}% · الثاني {b}%». Unrankable → bar-less remainder.
- **Grid** — rows=ports; columns دقة الأول / دقة الثاني `[0,100]` + **الفارق** + العيّنة `[0,max]`.
  - **الفارق is the one column with a genuine midpoint (zero)** → `diverging-green-coral` with **reversed symmetric domain `[+m,−m]`** (m=max|delta|) so positive (level 2 better) tints green, negative tints coral. Depends on **P7**; ship P7's doc+test first. Panel head sub states the reading.

### 11c. `slide-s3-port-agreement` — `portAgreementSlideBuilders`
6 columns; `SCOPE_NOTE` mandatory; two different bases (population vs studied sample) that must never read as one.
- **Ledger** — `ledgerPortCard`, all 6 columns + ordinal. Existing 6-column squeeze CSS mirrored for `.v2-lg-port-card` under `.v2-lg-agree` scope, not inherited. Scope note verbatim.
- **Briefing** — lede = pooled اتفاق المستويين, tone gold, label «اتفاق المستويين {x}% — {agree} من {comparable} صورة», basis «{portCountPhrase(n)} · أساس المجتمع». Support (3): مطابقة الأول / مطابقة الثاني للمراجع / العيّنة المراجَعة — their labels must read «على العيّنة» against the lede's «على المجتمع» (correctness requirement). Rank rows in page's own ascending (disagreement-first) order, `scale: {kind:"fixed",max:100}`, secondary «المجتمع {n}»; unrankable→bar-less remainder. Scope note verbatim.
- **Grid** — rows=ports; **4 columns**: اتفاق المستويين / مطابقة الأول / مطابقة الثاني `[0,100]` + العيّنة `[0,max]`. Drop المجتمع (it's column 1's denominator; 5 columns too tight in half-width panel) — disclose both denominators in panel head sub. `sequential-gold`. Scope note verbatim.

### 11d. `slide-s3-source-agreement` — `sourceAgreementSlide`
6×6 lower-triangle `percentHeatmap` + ن grid + 5-row reviewer table + 2 mandatory footnotes.
- **Ledger** — charts banned → heatmap becomes a **15-row pair table** (الزوج «المصدر أ — المصدر ب» | التوافق % | عدد الصور القابلة للمقارنة), beside the reviewer table in `.v2-lg-split`. ⚠️ Budget risk: 15 rows fits only at compact density (~25px rows ≈ 375px vs ~377px budget) — verify in `deck-preview.html`; if clipped, split into 8/7-row columns. Both footnotes verbatim. Drop the ن grid in Ledger only (redundant — counts are a column).
- **Briefing** — lede = overall reviewer agreement (`totalRate` from `reviewerCard`), tone green, label «التوافق العام مع المراجع {x}% — {agree} من {comparable} صورة», basis = scope disclosure «يشمل صور العيّنة المدروسة فقط». Support (3): أعلى زوج توافقًا / أدنى زوج توافقًا / عدد الأزواج المقارَنة. Rank the 15 pairs by agreement, `scale: {kind:"fixed",max:100}`, secondary «{comparable} صورة»; gate-suppressed pairs → bar-less remainder «أزواج دون حد الكفاية ({k})». Both footnotes verbatim.
- **Grid** — least work in the deck. Spec §4 already rules this page's Grid keeps `percentHeatmap` near-as-is. Promote to a full-width `gridPanel`, keep the ن grid beneath it, convert the reviewer table to a second `metricMatrix` (rows=5 sources; columns التوافق مع المراجع `[0,100]` / اشتباه لديه–سليمة للمراجع `[0,max]` / سليمة لديه–اشتباه للمراجع `[0,max]` / العيّنة `[0,max]`). Two panels side by side. Footnotes verbatim.

### 11e. `slide-s3-marking` — `markingImpactSlide`
2 arms × {n, accuracy, detection, 4-way outcome counts} + delta chip + caveat + totals band. `emptyState()` shared.
- **Ledger** — one table, rows=2 arms, columns: الفئة | العيّنة | الدقة | كشف الاشتباه | سليمة صحيحة | اشتباه صحيح | اشتباه فائت | اشتباه خاطئ. Totals row = combined arms, accuracy pooled from summed counts (never averaged). tfoot second row = «الفارق (يوجد − لا يوجد)», gated by `deltaChip`'s existing both-arms-rankable rule. Caveat verbatim.
- **Briefing** — lede = **الفارق itself**: signed points, tone gold, label «فارق الدقة {±x} نقطة — بتحديد {a}% مقابل بلا تحديد {b}%», basis «مقارنة وصفية بين مجموعتين غير متكافئتين». Not-comparable → «—» + `INSUFFICIENT_NOTE`, mirroring `deltaChip`'s gate. Support (3) = slot 0's totals band verbatim. Rank rows = 2 arms, `scale: {kind:"fixed",max:100}`, bar=accuracy, per-row tone green/coral (existing arm tones), secondary «العيّنة {n} · كشف {d}%». Caveat verbatim.
- **Grid** — rows=2 arms; columns الدقة/كشف الاشتباه/سليمة صحيحة/اشتباه صحيح/اشتباه فائت/اشتباه خاطئ, **all `[0,100] sequential-gold`**, values = each outcome class's share of that arm's n. 2×6, full width. Unrankable arm → all nulls. Caveat + totals band verbatim.

### 11f. `slide-s3-quality` — `qualityImpactSlide`
3 strata + trend panel + top-3 low-quality reasons + totals band + caveat. Three distinct denominators — none mixed inside one figure group.
- **Ledger** — two `ledgerTableCard`s in `.v2-lg-split`: (1) المستوى | العيّنة | الدقة | الاشتباه الفائت | أساس الاشتباه | كفاية البيانات (3 rows + pooled totals); (2) reasons table (السبب | العدد | النسبة), `title` = its existing subtitle (own base already printed there). Caveat verbatim.
- **Briefing** — lede = accuracy gradient (`accuracyGradient`), tone coral, label «تدرّج الدقة {±x} نقطة — عالي {a}% مقابل منخفض {b}%», basis «{evaluated} صورة بمستوى جودة محدّد»; null-gated → «—» + reason. Support (3) = existing totals band verbatim. Rank rows = 3 strata in **fixed عالي→متوسط→منخفض order, not sorted**, `scale: {kind:"fixed",max:100}`, bar=accuracy, per-row `tone: LEVEL_TONE`, secondary «العيّنة {n} · فائت {m}%». **Reasons card dropped from Briefing** — Briefing carries one recall payload, not completeness; mixing reason counts into a rate-scaled block would be a unit error. Caveat verbatim.
- **Grid** — one matrix: rows=3 strata; columns الدقة `[0,100]` / الاشتباه الفائت `[0,100]` / العيّنة `[0,max]` / أساس الاشتباه `[0,max]`, `sequential-gold`; unrankable stratum → nulls in rate columns, counts still shown. **Reasons card carries over beside it unchanged** — deliberate partial (dropping loses real content; dressing a 3×2 list as a "matrix" would be theatre).

---

## 12. Batching & ordering

**P0 — primitives (blocking, 1 pass).** P1–P7 + reimplement the exemplar on them + byte-identity pins on `slide-port-population-1` panels 1/2/3 + the reversed-domain `metricMatrix` test. Nothing ships before this is green.

**B1 — `slide-risk-stages` (1 pass, alone).** Immediately after P0: carries the `stageCompareBars` supersession and the deliberate test break, validates per-row tone and the `microArc` lede that later pages depend on, and is the page most likely to attract owner review.

**B2a — mechanical clones, section 1–2 (1 pass, 1 review).** `port-sample`, `quality-ports`, `quality-accuracy`. Same land/sea two-up shape as the exemplar; after P0 each is ~60 lines of column spec.

**B2b — mechanical clones, section 3 (1 pass, 1 review).** `s3-workload`, `s3-level-accuracy`, `s3-port-agreement`. Same shape, but three watch-items: reversed-domain الفارق column, 6-column CSS mirror for `.v2-lg-agree`, mandatory caveat/scope strips.

**B3 — bespoke, one page per pass with its own review:**
1. `stage-port-population` + `stage-port-sample` (one pass — mirror twins; `.v2-stage-port-card` measured-class exception and transposed Grid live here)
2. `s3-source-agreement` (Ledger's 15-row budget is the risk)
3. `s3-marking`
4. `s3-quality`
5. `slide-closing`

**B4 — low-stakes narrative (1 pass).** `slide-toc` + `slide-glossary-levels` + `slide-glossary-1`. Mostly Ledger tables plus three documented degenerate Grids; safe last, or parallel with B3 by a second implementer since it touches no shared primitive.

**No work:** `slide-sep-1/2/3` (3 pages, reasoned above), `slide-month-numbers` (dormant).

**Why this order:** primitives must land first or six pages each re-derive the ranked-list budget/scale logic that has already produced two shipped bugs. Risk-stages goes second because it is the only page whose fan-out *deliberately changes shipped output* — landing it early means the supersession is reviewed on its own rather than buried in a batch. The mechanical batches then carry almost no design risk, and every genuinely bespoke page gets its own review gate. Per-page visual verification stays as spec §7 requires: `deck-preview.html`, both themes, base **and** compact pagination tiers, checking for clipped rows and lost totals rows.
