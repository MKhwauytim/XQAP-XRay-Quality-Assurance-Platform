# Rework — Phase 1 Study: Verified Issues, Priorities, Technology Inventory

**Date:** 2026-08-07
**Method:** six parallel read-only agents, each deriving from source code. Existing docs, plans, and
prior audit reports were explicitly excluded as ground truth — where a doc and the code disagreed,
the code won and the disagreement is recorded.
**Inputs:** the owner's end-to-end walkthrough (`APP_WALKTHROUGH_FEEDBACK_2026-08-07.md`, items
W1–W42, R1–R5, D0–D3) and the code-grounded system map (`DATA_SYSTEM_FULL_MAP.md`).
**Status:** Phase 1 of 4. Phase 2 = research, Phase 3 = spec + implementation plan, Phase 4 = agent
roster + workflow.

---

## 1. Executive summary

**The single most important outcome of Phase 1 is that it refuted two of the three defects I had
ranked most critical.** Both were plausible, both were wrong, and acting on either would have meant
"fixing" correct code and shipping a regression.

| Hypothesis | Verdict |
|---|---|
| CertScan % applied additively → 7,000 became 9,000 | **REFUTED.** Quota is `Math.min`-capped at three independent layers; Hamilton allocations always sum exactly to the request |
| Stage aliases overlap L1/L2 result columns in source | **REFUTED in source.** `stage: ["STAGE", "المستوى"]` is disjoint everywhere in the codebase |
| Risk/BI comparison compares un-normalized values | **REFUTED.** `DataAccuracyReport.tsx` already canonicalizes `1`↔`سليمة` on both sides |

That is the value of verifying before designing, and it is why Phase 2 (research) comes before
Phase 3 (spec) rather than after.

**What Phase 1 found instead is more actionable**, because the real causes are simpler and the fixes
are more certain:

1. **One input bug plausibly caused a second "bug".** The alias editor makes typing a comma
   impossible — and the same defect affects the **stage-mapping** editor. That is the most likely
   origin of the corrupted `المستوى` alias list the owner observed, which exists in their workspace
   config but nowhere in source. **W17 and W20 are probably one defect and its consequence.**
2. **A report correctness bug is already shipping.** Two per-port accuracy folds are live
   simultaneously; deck2 was patched to avoid one, the executive document and workbook still use it.
   The same port can show two different accuracy numbers in one generation run.
3. **The 3–6 hour save is ~90,000 filesystem operations**, and the same mechanism makes every
   subsequent read slow — so it is one defect producing both the write and read symptoms.
4. **The 11× disk amplification is fully explained** and is multiplicative, not incidental.
5. **The reports the owner wants are largely absent**, not merely mis-shaped — `تقرير الإدارة`
   reports accuracy, not assignment progress.

---

## 2. Corrections to earlier claims

Recorded explicitly rather than quietly dropped.

| Earlier claim | Phase 1 verdict |
|---|---|
| "Four CAS reimplementations, already drifted" | **Partially reconciled.** Every site does use the single `casLoop.ts`; what is duplicated is the surrounding read-modify-write *boilerplate*, not the CAS primitive. The behavioural drift (notifications dropping vs audit archiving) is real and remains a finding |
| "Two Hamilton rounding copies" | **Same pattern.** Every call site uses the single `hamiltonApportionment`; the surrounding rounding/weighting logic is what is duplicated |
| "The Report Designer query engine is entirely dead" | **Mostly.** `runQuery`, `buildDataModel`, `filters` are dead. **`aggregations.ts`'s `aggregate()` is live** — used by `KpiRenderer.tsx`. Do not delete it with the rest |
| "`تقرير المعالجة` may be the only surface for dropped-row counts" | **The aggregate count is shown elsewhere unconditionally**, but this button is the only route to *which* rows were dropped and why. Remove the button, relocate the drill-down |
| "`موظف المستوى الأول/الثاني` may be dropped at ingest" | **They are ingested and present on every processed row** (`populationProcessor.ts:829`). Only missing from the default export config |
| CLAUDE.md: "945 tests / 141 files" | **Stale.** Live run: **193 files / 1,619 tests**, all passing in ~31s |

---

## 3. Verified issue inventory

### 3.1 Correctness (produces wrong output or blocks work)

| ID | Issue | Verified mechanism | Effort |
|---|---|---|---|
| **C1** | **Comma cannot be typed into alias fields — BLOCKING** | Controlled input whose value is derived from a parsed array. `parseMappingAliases` does `.split(",").filter(Boolean)`, so a trailing comma yields an empty token that is filtered out; the next render rebuilds via `.join(", ")` and the comma is gone. **Also affects sheet-pattern and stage-mapping inputs** | Small |
| **C2** | Corrupted stage aliases in the owner's workspace config | Not present in source. Almost certainly produced by C1's defect in the stage-mapping editor. Needs config repair **plus** alias-overlap validation so it cannot recur | Small–Medium |
| **C3** | **Two live per-port accuracy folds disagree** | `executiveKpiProfiles.buildPortProfiles` (image-level) feeds the executive **document + workbook**; `aggregates.foldBy` (decision-level) feeds **deck2 + management**. `deck2/section3/workloadAccuracy.ts:38-41` documents the divergence and patches around it — the other editions were never patched | Medium |
| **C4** | Sample total silently exceeds the requested figure | `DEFAULT_SAMPLING_RULES` defaults `minRequiredCount` **equal to** `value` for stages 2–4, so lowering a stage's value is silently overridden by `Math.max(target, minRequiredCount)`. `PhaseThreeSampling.tsx` shows **no running total before the draw** — the sum first appears in `SampleResultReport`, after the fact | Small |
| **C5** | CertScan matches ~30 where ~30,000 expected | Port grouping is **exact-match with no fuzzy fallback**. Code is symmetric on both sides, so the divergence is data/naming convention. Needs normalization + a **pre-commit match-count preview** | Medium |
| **C6** | No CertScan↔NonCertScan backfill exists | Confirmed absent. A stratum short on CertScan simply under-fills | Medium |
| **C7** | Oversight users cannot bulk-reassign | `XrayReferrals.tsx:312-315` explicitly gives oversight/`canSeeAll` users **zero selection UI**. The `"filtered"` bulk-source type exists in code but is never constructed — dead. **Capability gap, not performance** | Medium |

### 3.2 Performance

| ID | Issue | Verified mechanism | Effort |
|---|---|---|---|
| **P1** | **Distribution save 3–6 hours; every later read slow** | ~**10 File System Access operations per ~300-byte event file** (existence check ≈3 failed lookups + `safeWriteJson`'s 6 + post-write verify), at a hard concurrency ceiling of **4**. ≈**90,000 FS calls** for 9,000 assignments. Then the CAS loop re-reads and re-merges the entire event history. On read, any single append invalidates the derived cache, forcing a full O(n) re-fold; `readAppendOnlyDirectory`'s cache **does not survive a page reload**, so the first load of every session re-reads all ~9,000 files | Large |
| **P2** | 11× disk amplification (28.4MB → 312MB) | `rawRow` embeds the entire original Excel row inside every processed row (~2×), and that inflated row is **inlined, not referenced**, in five files: `population.final.json`, `sample.master.json`, `distribution.current.json`, `main.samples.json`, `{username}.samples.json`. 5 × 2 ≈ 10× | Large |
| **P3** | Progress hits 100%, save continues 10–15 min | `safeWriteJson` has **no progress callback at all**; the bar tracks `processPopulation`'s in-memory work only. For >512KB files the write does up to 5 full-file passes | Small |
| **P4** | Report customizer takes ~30 min to open | `handleOpenCustomizer` awaits `loadExecInput()` — full population + sample + distribution — and only then sets the dialog open. `DeckDesignCustomizer` additionally runs the **entire** `buildExecutiveDeckV2` on mount. **Opening the dialog generates a full deck before you pick an option** | Small |
| **P5** | KPI tiles each reload everything | `KpiRenderer.tsx:79-121` is per-element, uncached, and bypasses the app's own deduped helpers. N tiles = N full loads | Small |
| **P6** | `buildReportModel` never yields | Fully synchronous: row build, decision-fact-table explosion, O(rows × 15) cross-team matrix, reviewer KPIs | Medium |
| **P7** | Phase-2 processing on the main thread | CPU-bound, chunked with `setTimeout(0)`. Real but **secondary** to P1–P2, which are I/O-bound | Medium |

### 3.3 Architecture (what the owner's proposals require)

| ID | Proposal | What exists | What's new |
|---|---|---|---|
| **A1** | D1 — warm at sign-in + 3-min cheap sync | The 3-min tick **already exists** (`AuthGate.tsx:336`) with a `document.hidden` skip. Change-check primitives all present: name-only directory listing, `revision`/`contentHash` per file, `File.lastModified` without reading content | The tick is a **blind broadcast** — no revision pre-check anywhere. "Warm at sign-in" doesn't exist; the boot splash only tracks whichever tab mounts first |
| **A2** | D2 — persisted per-port/per-level aggregates | Nothing. `ProcessingSummary` is flat, whole-population-only | Entirely new. **Must live on workspace disk** (shared), with IndexedDB only as a local cache keyed by `(month, revision)` |
| **A3** | D3 — no duplicate loading | Only two React contexts exist app-wide (workspace handle, selected month). `dedupeInFlight` coalesces **simultaneous** reads only | A shared business-data layer is entirely new |
| **A4** | W35a — finished month never re-reads rows | Raw-file skip already ships (Phase A) | Needs A2's aggregate to be complete enough to render with zero row access |
| **A5** | W36 — auto-lock after distribution | **Nearly done.** `closeMonth`/`reopenMonth`/`ensureMonthWritable` built, CAS-protected, wired into Archive | Only an automatic trigger + a "system-closed vs person-closed" distinction |
| **A6** | W34 — session persists across restarts | — | **One-line swap**: `authSession.ts`'s `sessionStore()` from `sessionStorage` to `localStorage`. Confirmed orthogonal to file permissions — Chromium already reconnects silently when it remembers the grant |

> **Note on A4.** An agent judged W35a "partially infeasible" by reading it as *immediately after
> Phase 2 processing*, which collides with Phase 3's draw needing full rows. That reading is wrong.
> The owner tied the rule to the **end of the month's work** — *"once i finish uploading and
> distubing sample… it get locked."* The draw precedes the lock, so there is no conflict. Browse and
> row-level document reports remain **deliberate user actions**, not implicit loads, and are equally
> unaffected. **W35a stands as written.**

### 3.4 UI/UX

| ID | Issue | Mechanism | Effort |
|---|---|---|---|
| **U1** | Modal backdrop covers half the viewport — **all modals** | No modal uses `createPortal`; all render inline in their tab. `App.css:75-77` animates `transform` on the tab wrapper, which per spec makes it a containing block for descendant `position: fixed` | Small |
| **U2** | Approvals page inconsistencies | Sort order silently flips between tabs with no indicator (`RequestList.tsx:47-49`); two one-off hex colors bypass design tokens; `float:left` close button in RTL; two ad-hoc modal structures on one page. **Loading/empty/error states are well handled — better than several siblings** | Small |
| **U3** | Export column list incomplete | `declarationDate` and **all** CertScan fields absent from the 15-field default, though present on the row. `levelOneEmployee`/`levelTwoEmployee` likewise present but unexported | Small |
| **U4** | `نوع الحركة` reported as unmatched | `movementType` is 100% sheet-name-derived (`detectMovementType`) and **never consults its column-alias mapping**. The "no match" hint is structurally guaranteed and should be special-cased out | Trivial |
| **U5** | Placement: CertScan + RNG seed outside `إعدادات المعالجة` | Confirmed. State already prop-threaded from the parent, so relocation is cheap | Small |
| **U6** | Three unwanted buttons; unwanted final-population preview | `معاينة المجتمع النهائي` reads already-in-memory data (`.slice(0,10)`) — free to remove. Auto-running Phase 2 is a real behaviour change, not just relocation | Small–Medium |

### 3.5 Reports (gap vs R1–R5)

| Req | Status | Gap |
|---|---|---|
| **R1** sample report | **Partial** | Raw/processed/removed counts and per-port counts exist. Missing: the page-1-separate / page-2-merged split (reports never load raw files), and **per-risk-level** sample counts (current "stages" page groups by draw-stage, not risk level). `ProcessingSummary`'s granularity exists in data but **zero reporting files reference it** |
| **R2** distribution report | **Absent** | One flat employee table, one flat row table. No per-port or per-level grouping exists |
| **R3** management report | **Absent** | All three management editions reuse the **executive** model verbatim — they report accuracy/QA, not assignment progress. Completion % is already computed in `distributionReport.ts` but never reused. **Replacement reasons are captured** in `DistributionEvent.notes` but **dropped during folding** (`DistributionEntry` has no reason field) |
| **R4** executive composite | **Absent, and unsafe to build naively** | Would propagate C3's accuracy discrepancy |
| **R5** document row detail | **Partial** | Sample doc caps at a 60-row preview with no employee; distribution doc has rows but no answers/level; the executive `factTable` has the richest data but isn't rendered as a flat per-employee listing |

**Structural verdict:** `buildReportModel` is *accuracy/QA-shaped*, not *lineage/distribution-shaped*.
No raw-vs-processed counts, no per-port draw quotas, no replacement reasons, no reassignment counts.
**Meeting R1–R5 requires restructuring, not additive fields** — which under the owner's
rewrite-vs-patch directive means rewrite.

### 3.6 Codebase health

- **495 TS/TSX files, 113,538 lines** in `src/` (`data/` 269 files / 65,404 lines; `components/` 177
  files / 41,409; `auth/` 4,141; `workers/` 631). Tests: **193 files / 38,750 lines** — 34% of the
  tree.
- **58 files exceed 500 lines; 14 exceed 1,000.** Largest: `deck2/slides.ts` (3,759),
  `theme.ts` (2,081).
- **`check:complexity` passes but with thin headroom.** Worst function — `PopulationTab` in
  `Population/index.tsx` — is at **1,169 of a 1,450-line budget (81%)**. Also mixing data-loading,
  business logic and JSX in one function: `ReportsContent` (1,099), `XrayReferrals` (902),
  `BrowseDataView` (776), `DataTable` (757), `AuthGate` (701).
- **One boundary violation:** `data/population/populationQuery.ts:11` imports `paginationUtils` from
  `components/Pagination`. No cycle-detection tooling installed, so cycles are unverified rather
  than ruled out.
- **Dead code confirmed (7 symbols, zero non-test callers):** `runQuery`, `buildDataModel`,
  `filters`, `migrateWorkspaceSchema`, `approveSampleMaster`, `verifyDecisionChain`,
  `loadSamplingPlan`, `readWorkspaceActionArchive`.
- **Tests:** 193 files / 1,619 tests, all passing (~31s). Sampling, distribution, and report builders
  are well covered — deck2 alone has a 1,623-line characterization suite. **The safety net for a
  rewrite already exists.**

---

## 4. Technology inventory (input to Phase 2)

### Current stack — all current, nothing unmaintained
React **19.2.7** · Vite **8.0.16** · TypeScript **6.0.3** · Vitest **4.1.8** · ESLint **10.4.1** ·
vendored `xlsx@0.20.3` (SheetJS tarball; cannot auto-update).

**Lockfile drift:** `package-lock.json` root version **59.198.0** vs `package.json` **59.202.0`.

### Browser APIs
File System Access (**no fallback — Chromium only, by design**), IndexedDB (**directory handle
only**), Web Locks (has a fallback), Web Workers (**exactly two in the whole app**), Web Crypto.

### Notable absences — confirmed
No state-management library. No data-fetching/caching library. No virtualization for large tables.
No charting library (KPI p-charts are hand-rolled inline SVG). No templating engine (reports are
hand-built HTML template literals). No cycle-detection tooling.

### Hand-rolled implementations (candidates for Phase 2 evaluation — **not** recommendations)
Mulberry32 RNG · **two independent djb2 implementations** (RNG seed vs content hash) · Hamilton
apportionment · Fisher-Yates · CSV serialization · a concurrency limiter (three parallel copies) ·
an LRU tab-mount cache · multi-format date parsing · a streaming JSON writer.

### The singlefile constraint — important for planning
`vite.config.ts` sets `assetsInlineLimit: 100_000_000`, `cssCodeSplit: false`,
`manualChunks: undefined`, and both workers use `?worker&inline` to blob-embed into the single HTML
output.

**This rules out** real code-splitting, lazy fetching, and separate worker bundles at the build
level. **It does not block** in-source component decomposition — so fixing the oversized-function
problem is unconstrained.

---

## 5. Recommended priority order

Ranked by (correctness first) × (impact ÷ effort). Rationale given where the ordering is not obvious.

### P0 — Do first: blocking, cheap, or already-shipping wrong output

| # | Item | Why here |
|---|---|---|
| 1 | **C1** comma bug | Blocking a feature outright, small fix, and **plausibly the cause of C2** |
| 2 | **C2** alias validation + config repair | Follows C1 directly; prevents recurrence |
| 3 | **C3** unify the accuracy folds | **Already shipping wrong numbers**, and a hard prerequisite for R4 |
| 4 | **C4** running total + floor-override warning | Silent wrong sample size. Fixes the failure *class* regardless of which exact mechanism bit |
| 5 | **P4** customizer opens instantly | 30 min → instant. Among the smallest fixes in the codebase |
| 6 | **P3** save progress reporting | Removes the "app has hung" experience for near-zero effort |
| 7 | **U1** modal portal | One fix repairs **every** modal in the app |
| 8 | **A6** session persistence | One-line swap; owner already accepted the tradeoff |

### P1 — The performance rework (the actual wall-clock problem)

| # | Item | Note |
|---|---|---|
| 9 | **P1** distribution write + fold | The 3–6 hour save **and** most app-wide read slowness are this one defect. Highest impact in the project |
| 10 | **P5** shared load for KPI tiles | Small, and a natural first slice of A3 |
| 11 | **P2** stop inlining rows five times | 11× → ~2–3×. Touches five file formats: needs migration care |
| 12 | **P6** yield inside `buildReportModel` | Or move it to a worker — decide in Phase 3 |
| 13 | **P7** Phase-2 processing to a worker | Secondary: CPU-bound, and I/O dominates |

### P2 — Architecture (makes P1 durable rather than a one-off)

| # | Item |
|---|---|
| 14 | **A3** shared data layer — D1 is pointless without it |
| 15 | **A1** revision pre-check on the existing 3-min tick + warm-at-sign-in |
| 16 | **A2** persisted aggregates on disk, IndexedDB as local cache |
| 17 | **A4** W35a enforcement, once A2 is complete enough |
| 18 | **A5** month auto-lock — small, and it makes A2's caching safe |

### P3 — Correctness follow-ups needing data or product decisions

| # | Item | Blocker |
|---|---|---|
| 19 | **C5** CertScan matching | Needs the owner's CertScan paste + port names to confirm the divergence |
| 20 | **C6** backfill policy | **Product decision:** backfill from NonCertScan, or under-fill and report? Changes the sample's statistical properties |
| 21 | **C7** oversight bulk reassign | Feature work |

### P4 — Reports rework (R1–R5)

Sequenced after C3 (folds must agree first) and ideally after A2 (aggregates available).
`buildReportModel` needs restructuring rather than extension.

### P5 — Hygiene (cheap, do alongside)

Dead-code removal (7 symbols — **keep `aggregate()`**) · consolidate the duplicated read/write
boilerplate and bounded-log implementations · fix the `data/` → `components/` boundary violation ·
correct CLAUDE.md's stale test count · resolve the lockfile drift · document the folder-numbering
convention · move `feedback/` under `5-system/` · U2–U6.

### Deferred by owner

**W37** — the ad-hoc Excel upload + formula/spreadsheet subsystem. Owner: *"this is advanced stuff
leave it for last thing."* It is a genuine new subsystem needing its own spec.

---

## 6. Questions for Phase 2 research

1. **Bulk small-file writes over File System Access** — is ~10 ops per file avoidable? Batching
   strategies, OPFS as a staging area, or a fundamentally different event-persistence layout that
   keeps collision-free multi-writer semantics without one file per event.
2. **Client-side columnar / compact storage** — what do browser-only apps use instead of inlining
   full row objects five times? Arrow, Parquet-in-browser, DuckDB-WASM, structural sharing.
3. **Incremental fold / materialized-view patterns** for event-sourced state in the browser.
4. **Change detection over a filesystem without a watcher** — established patterns for cheap
   revision checks.
5. **Aggregate/pivot precomputation** — libraries and formats for storing and querying precomputed
   cross-tabs.
6. **Virtualization for large tables** in React 19, given the singlefile constraint.
7. **Text-input + parsed-array patterns** that don't destroy in-progress input (the C1 class of bug).
8. **Deterministic-rewrite safety** — how others characterize and preserve deterministic algorithm
   output across a rewrite.
