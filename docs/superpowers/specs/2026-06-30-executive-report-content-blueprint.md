# Executive Report — Content Blueprint

**Date:** 2026-06-30
**Companion to:** [`2026-06-30-executive-report-rework-design.md`](./2026-06-30-executive-report-rework-design.md) (the *engineering* design).
**This document:** organizes the *content* — the narrative spine, analytical methods, and
the page-by-page (document) / slide-by-slide (deck) structure.

---

## 0. The spine (what every page serves)

> **We are judging the accuracy of our Level 1 and Level 2 X-ray decisions.**
> The **study reviewer (QA)** is the gold standard we measure them against. The **other
> teams** (manual / opposite / live-means) are **corroborating evidence** — they help
> confirm whether an L1/L2 call was right, but they are not themselves on trial.

Executive lens: **security-risk first.** The headline question is *"are we catching what
matters?"* — so **Missed Suspicion** (a threat called clean) is framed as the primary risk,
ahead of overall accuracy and ahead of False Suspicion (a clean case flagged).

**Narrative arc** (both deliverables follow it):

```text
1 Scope      what we examined            (population)
2 Method     how we examined & judged    (full-population sample · QA gold standard · other teams as support)
3 Verdict    how accurate were L1 & L2   (accuracy + detection, security-risk lens)
4 Corroborate do others agree our calls  (cross-team comparison vs reviewer)
5 Drivers    what moves accuracy         (image quality · marking · port · stage)
6 Accountability who is accurate          (L1/L2 inspectors by port)
7 Action     what leadership must decide (risks · priorities · decisions)
```

**Layered-visual rule (every analytical page/slide):** a *headline* a non-analyst reads in
5 seconds (one number, one simple chart) on top; *advanced depth* (quadrant, heatmap,
agreement matrix, scatter) below for those who want it. Simple front, advanced underneath.

---

## 1. Method catalog (the analytical toolkit, defined once)

### 1.1 Outcome classification (per evaluable L1/L2 decision)

| Employee decision | Study reviewer | Outcome | Risk meaning |
|---|---|---|---|
| سليمة | سليمة | **Correct Clean** | — |
| اشتباه | اشتباه | **Correct Suspicion** | — |
| سليمة | اشتباه | **Missed Suspicion** | 🔴 threat let through (primary risk) |
| اشتباه | سليمة | **False Suspicion** | 🟠 clean case flagged (cost/friction) |

> The 🔴/🟠 are *severity weights in prose/legend only*, never printed as emoji glyphs in
> the report — rendered as colored icon chips (per design spec §4.2).

### 1.2 Core metrics & formulas (master §9)

| Metric (AR / EN) | Formula | Answers |
|---|---|---|
| دقة الفحص / Inspection Accuracy | (Correct Clean + Correct Suspicion) ÷ Evaluable | overall correctness |
| معدل اكتشاف الاشتباه / Detection Rate | Correct Suspicion ÷ (Correct + Missed Suspicion) | of real threats, how many caught |
| اشتباه فائت / Missed Suspicion Rate | Missed ÷ (Correct + Missed Suspicion) | **headline risk** |
| دقة قرار الاشتباه / Suspicion Decision Accuracy | Correct Suspicion ÷ (Correct + False Suspicion) | when flagged, how often right |
| اشتباه خاطئ / False Suspicion Rate | False ÷ (Correct Clean + False Suspicion) | over-flagging cost |
| دقة المستوى ١ / ٢ / Level Accuracy | Correct level-n ÷ Evaluable level-n | per-level quality |
| تصحيح/تراجع المستوى الثاني | L2 fixed L1-wrong ÷ L1-wrong · L2 broke L1-right ÷ L1-right | does L2 review help |

Combined employee accuracy = all-correct ÷ all-evaluable (naturally volume-weighted).

### 1.3 Cross-team agreement (corroboration)

For each image, compare every source's result. Two views (design spec §3.1):
- **Reviewer-focused:** each team's agreement with QA (agree / disagree / N-A). Lets us say
  *"on the images L1 called clean but QA called suspicious, the opposite-inspection team
  also flagged N of them"* — corroboration that the miss was real.
- **Full N×N matrix:** every team vs every team (incl. L1 vs L2) as a heatmap.
- Agreement counted **only where both compared sources have a result**; otherwise `—`.

### 1.4 Data-sufficiency bands (master §10)

| Evaluable decisions | Band | Rule |
|---|---|---|
| 0 | none | show `—`, never `0%`; never ranked |
| 1–9 | insufficient | never top/bottom ranked; flagged |
| 10–19 | limited | shown with caveat |
| 20+ | sufficient | ranked normally |

### 1.5 Honesty rules (master §16, §11)

- `—` missing/unavailable · `0` true zero · `N/A` not applicable · `بيانات غير كافية` low volume.
- **Association, not causation** language for quality/marking vs accuracy.
- Small ports described, never ranked.
- BI-unavailable → `—`, not `0`.

### 1.6 Visual vocabulary (idea → chart)

| Analytical idea | Headline visual | Depth visual |
|---|---|---|
| Distribution / share | KPI cards + donut | ranked horizontal bars |
| Accuracy headline | gauge (accuracy, detection) | confusion-matrix quad |
| Port comparison | ranked bar | sortable table + status chips |
| L1 vs L2 | paired bars | correction/regression flow |
| Cross-team | reviewer-agreement bars | N×N heatmap |
| Quality vs accuracy | grouped bars (with/without marking) | scatter / association note |
| Employee performance | ranked table | accuracy×detection quadrant |
| Error concentration | stacked bar | heatmap (port × error type) |

### 1.7 Executive close (every analytical page — master §21)

Three lines, fixed pattern:
**ما تظهره البيانات** (what the data shows) · **لماذا يهم** (why it matters) ·
**الإجراء المطلوب** (required action).

---

## 2. The Document (full, ~36 pages, A4 portrait)

Front matter → 5 parts → appendix. Each analytical page = headline visual (top) + depth
(below) + 3-line executive close. `KPIs` = the card strip; `Lead` = 5-second visual;
`Depth` = advanced visual/table.

### Front matter
| # | Page | Content |
|---|---|---|
| 1 | Cover | authority hierarchy, title, report period (June 2026), population studied (May 2026), internal-executive labels, four-level strip. No tables. |
| 2 | Table of Contents | the 5 parts as a balanced grid, gold page numbers. |
| 3 | Glossary & How to Read | Level 1–4 cards · metric definitions (1.2) · outcome legend (1.1) · color & icon legend · data-sufficiency note. |

### Part 1 — Scope & Method
| # | Page | KPIs | Lead | Depth | Close |
|---|---|---|---|---|---|
| 4 | Part 1 divider | — | section motif | mini-TOC | — |
| 5 | Population at a glance | total · land · sea · #ports | land/sea donut | movement-type bars | ✓ |
| 6 | Population by port | top port · concentration | ranked port bars | port table (clean/susp/share) | ✓ |
| 7 | Population by stage × port | L1–L4 counts | stage share | 2×2 stage panels (port × clean/susp) | ✓ |
| 8 | Sample & completion | population · sample · coverage 100% · studied | coverage gauge | sample-by-stage/port table; **"full population studied"** message | ✓ |
| 9 | Data quality & exclusions | raw 400 · processed 386 · excluded 14 | exclusion waterfall | exclusion reasons · BI status · null-field table (honesty) | ✓ |

### Part 2 — Inspection Quality (the L1/L2 verdict)
| # | Page | KPIs | Lead | Depth | Close |
|---|---|---|---|---|---|
| 10 | Part 2 divider | — | motif | mini-TOC | — |
| 11 | Accuracy & detection headline | inspection accuracy · detection rate · **missed-suspicion** · false-suspicion | two gauges (accuracy + detection) | confusion-matrix quad (Correct Clean/Correct Susp/Missed/False) | ✓ |
| 12 | Accuracy by port | best · weakest · #insufficient | ranked accuracy bars | port table (cases · susp · detection · accuracy · gap · status) | ✓ |
| 13 | L1 vs L2 (does review help) | L1 acc · L2 acc · correction · regression | paired L1/L2 bars | correction↔regression flow + disagreement rate | ✓ |
| 14 | Image quality & marking impact | high-q% · marking% · acc with/without marking | with/without-marking bars | quality×marking grid; association (not causation) note | ✓ |

### Part 3 — Corroboration (cross-team)
| # | Page | KPIs | Lead | Depth | Close |
|---|---|---|---|---|---|
| 15 | Each team vs reviewer | teams reporting · highest-agreement team · L1/L2 vs QA | reviewer-agreement bars per team | "where L1/L2 diverged from QA, did other teams corroborate" table | ✓ |
| 16 | Full agreement matrix | strongest/weakest pair | N×N agreement heatmap | divergence call-outs (where our calls stand alone) | ✓ |

### Part 4 — Accountability (L1/L2 inspectors)
| # | Page | KPIs | Lead | Depth | Close |
|---|---|---|---|---|---|
| 17 | Part 4 divider + roadmap | — | 4 analytics themes | — | — |
| 18 | Employee overview | #evaluated · total decisions · avg acc · best · most variable | ranked accuracy bars | inspector table (decisions · L1 · L2 · accuracy · detection · ports · band) | ✓ |
| 19 | Accuracy by decision type | overall · detection · missed · false | accuracy×detection **quadrant** | clean-acc vs detection table | ✓ |
| 20…20+N | One page per port | unique cases · decisions · #inspectors · L1/L2 acc · port acc · detection · missed | port accuracy headline | grouped inspector table (L1 block gold / L2 block blue / combined) + decision-quality table; **insufficient-data** ports labeled, not ranked | ✓ |
| (after ports) | Port comparison summary | strongest · weakest · largest L1–L2 gap · highest missed | ranked port bars | full port comparison table | ✓ |

### Part 5 — Risk, Priorities & Actions
| # | Page | KPIs | Lead | Depth | Close |
|---|---|---|---|---|---|
| — | Part 5 divider | — | motif | — | — |
| — | Error-type analysis | correct-clean · correct-susp · missed · false | error mix bar | heatmap: error type × (port/stage/quality/marking) | ✓ |
| — | Performance stability & workload | stable · unstable · workload spread | workload-vs-accuracy scatter | per-inspector variability table | ✓ |
| — | Priority inspectors & actions | #immediate · #training · #monitor · #high-performer | priority bands | table: inspector · main issue · evidence · proposed action · priority | ✓ |
| — | Executive findings | — | six findings cards (population · accuracy · port risk · image quality · employee · operational risk) | — | — |
| — | Recommendations | — | grouped: immediate · short · medium · structural | — | — |
| — | Decisions required | — | leadership decision list (thresholds · training · dual review · taxonomies · BI remediation · next period) | — | — |
| — | Management action tracker | — | table: recommendation · owner · priority · target date · status | — | — |
| Appendix | Methodology & data | — | formulas (1.2) · data-quality detail · raw tables · taxonomy version · audit notes | — | — |

> Per-port pages are **dynamic**: one page per port (land first, by volume). Very-low-volume
> ports still get a page but display **بيانات غير كافية** and are not ranked (master §10–12).

---

## 3. The Deck (tight, ~14–18 slides, 16:9 landscape)

Same spine, curated. Each slide: **one message · one hero visual · the decision it supports.**
Pulls top-N (e.g. top-5 inspectors by volume), never full tables. Layered rule still applies
(hero number big; one supporting visual).

| # | Slide | One message | Hero visual | Supports decision |
|---|---|---|---|---|
| 1 | Title | what / period / classification | level strip | — |
| 2 | Executive summary | the verdict in one line + 4–5 headline KPIs | KPI band | sets the agenda |
| 3 | What we examined | scope & 100% coverage | population + coverage visual | trust the basis |
| 4 | The verdict: L1/L2 accuracy | accuracy & detection, missed-suspicion framed as risk | gauge + confusion quad | is quality acceptable |
| 5 | Where we're strong / weak | ports ranked (sufficient only) | ranked port bars | where to focus |
| 6 | Does L2 review help | correction vs regression | paired L1/L2 bars | keep/adjust dual review |
| 7 | Do others agree our calls | reviewer + team corroboration | reviewer-agreement bars | confidence in findings |
| 8 | What drives quality | marking/quality association | with/without-marking bars | operational fixes |
| 9 | Top inspectors | best performers (top-5, band-aware) | ranked mini-table | recognize / model |
| 10 | Inspectors needing support | priority cases + evidence | priority cards | targeted training |
| 11 | The biggest risk | missed-suspicion concentration (where/who) | heatmap or focused bar | risk ownership |
| 12 | Priority actions | the immediate few | action cards | approve actions |
| 13 | Decisions required | 3–5 explicit asks | decision list | leadership sign-off |
| 14 | Next period | follow-up plan & thresholds to approve | timeline | commit cadence |

(Slides 5–11 flex ±; if a topic has insufficient data this period, its slide states that
plainly rather than showing a weak chart.)

---

## 4. How this maps to the build

- Every page/slide above reads from the single `ReportModel` (design spec §3.6) — no page
  recomputes a metric.
- Headline vs depth visuals both come from `charts.ts` (design spec §4.3).
- The 3-line executive close is a shared primitive fed by `generateNarrativeFindings`
  (extended) so wording is consistent and data-driven, not hand-written per page.
- Cross-team pages/sheets depend on Phase 0 (pipeline) landing the other-team results.
- Anything lacking data this period (BI mapping, multi-reviewer, taxonomy) renders its
  honest empty-state, never a fabricated chart.
```
