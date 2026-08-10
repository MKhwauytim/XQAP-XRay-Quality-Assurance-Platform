# Rework — Phase 3: Specification and Implementation Plan

**Date:** 2026-08-07
**Inputs:** `REWORK_PHASE1_STUDY_2026-08-07.md` (verified issues, priorities),
`REWORK_PHASE2_RESEARCH_2026-08-07.md` (decisions D-1…D-15),
`APP_WALKTHROUGH_FEEDBACK_2026-08-07.md` (owner's observed defects W1–W42, requirements R1–R5,
proposals D0–D3).
**Status:** Phase 3 of 4. Phase 4 = agent roster + workflow.

---

## 0. Governing rules

These constrain every workstream below and are not restated per task.

1. **Rewrite is licensed; correctness guarantees are not.** The owner's directive: prefer enhancing,
   but rewrite whenever preserving would produce heavier or slower code. **Exception:** the
   collision-free multi-writer property and the double-assign prevention are load-bearing. Make them
   cheap; never remove them.
2. **Deterministic code is golden-mastered before it is touched.** Sampling, folding, and report
   builders feed audit trails. No exceptions, no "small change" carve-outs.
3. **Every edit follows the tiered edit-log protocol** (`npm run editlog -- --tier=N`). Most of this
   work is tier 2 or 3.
4. **Nothing ships that breaks the single-file build** or exceeds the bundle budget.
5. **Workspace files stay human-inspectable.** No opaque binary formats.

---

## 1. Workstream sequence

```
W0  Safety net ─────────────────┬──────────────────────────────┐
                                │                              │
W1  Quick fixes (parallel) ─────┤                              │
                                ▼                              ▼
W2  Accuracy fold unification   W3  Distribution I/O rewrite    W5  Shared data layer
                    │                        │                        │
                    │                        ▼                        │
                    │           W4  Disk amplification ◄──────────────┤
                    │                        │                        │
                    │                        ▼                        │
                    │           W6  Aggregates + lock + W35a ◄────────┘
                    ▼                        │
W7  Reports rework ◄─────────────────────────┘
                    │
                    ▼
W8  Hygiene + deferred
```

**Critical path:** W0 → W3 → W4 → W6 → W7.
**Fully parallel from the start:** W1, W5.
**Shared prerequisite blocking W4 and W6:** the field-set enumeration (§2).

---

## 2. Shared prerequisite — the field-set enumeration

**Do this once, before W4 and W6.** Two separate workstreams need the same answer, and both fail
silently if it is wrong.

**The problem.** Two guarantees depend on knowing exactly which fields a UI surface renders:
- **W4's employee mirror stub** — mirrors currently inline full rows so an employee can load their
  own work *without* reading the 500k-row population. If the stub omits a field the UI shows,
  reference resolution kicks in and the population load returns.
- **W6's W35a aggregate** — a finished month must render the Population tab with *zero* row access.
  If one displayed figure is missing from the aggregate, the tab falls back to reading rows.

**Deliverable.** Two explicit field manifests, derived from the actual JSX, not from types:
- `EMPLOYEE_MIRROR_STUB_FIELDS` — every field rendered by employee-facing sample views.
- `MONTH_AGGREGATE_FIELDS` — every figure displayed by the Population tab for a processed month.

**Acceptance.** A test that fails if any employee-facing component reads a row property absent from
the stub manifest. Static enumeration is not enough — the guarantee must be enforced mechanically or
it will erode on the next feature.

---

## 3. W0 — Safety net (blocks W2, W3, W4, W7)

**Goal.** Make it impossible to change deterministic output without the test suite noticing.

| # | Task | Acceptance |
|---|---|---|
| W0.1 | Golden masters at three grains: `drawSample()`/apportionment output, event-fold result, and the report **model** (not rendered HTML) | Fixtures committed; each regenerable by a documented command |
| W0.2 | Curated edge-case fixtures: empty port, tied largest-remainder, max-capacity spillover, single-stage, zero-CertScan | Each produces stable output twice in a row |
| W0.3 | Add `fast-check` (devDependency only) | Confirmed absent from the built bundle |
| W0.4 | Properties for `apportionment.ts`: allocations sum **exactly** to the requested total; each within quota bounds; ties break alphabetically and stably | Properties pass against **current** code before any change |
| W0.5 | Properties for `rng.ts`/draw: same seed → identical sequence; Fisher-Yates yields a true permutation; spillover conserves totals | As above |
| W0.6 | ~30-line differential harness: run old vs new against fixtures + generated inputs, deep-diff, fail loudly | Demonstrated to catch a deliberately injected divergence |
| W0.7 | Determinism audit: every `.sort()` comparator checked for totality; every `Map`/object feeding `JSON.stringify` or a content hash reviewed; every deterministic path checked for `Date.now()` | Written findings; fixes logged separately |

> **W0.4/W0.5 must pass against current code first.** A property that fails on today's code is either
> a real bug or a wrong property — both must be resolved before it can serve as a rewrite oracle.

**Determinism traps to assert against** (from Phase 2): sort-comparator non-totality; numeric-looking
string keys reordering; float rounding order-sensitivity (**fold order must be pinned, not left to
`reduce()` or worker-chunk arrival**); `JSON.stringify` dropping `undefined` and flattening
`Map`/`Set`; `postMessage` structured-clone losing `Map`/`Set`/class instances.

---

## 4. W1 — Quick fixes (parallel, no dependencies)

Highest value-per-effort in the project. Each is independently shippable.

| # | Item | Change | Acceptance |
|---|---|---|---|
| W1.1 | **Comma bug (C1) — BLOCKING** | `useDelimitedListInput()`: raw text in local state as the input's `value`; parse to array on blur/commit only. Apply to alias, sheet-pattern, **and stage-mapping** inputs | A user can type `a, b, c` and it persists. Test covers the trailing-comma intermediate state |
| W1.2 | **Alias overlap validation (C2)** | Detect and warn when one field's alias appears in another field's list. Repair guidance for existing configs | Overlapping config produces a visible warning naming both fields |
| W1.3 | **Modal portal (U1)** | Portal modals to `document.body` **or** drop `transform` from the `view-enter` keyframes. Portal is preferred — it fixes the class, not one instance | Backdrop covers the full viewport in every modal in the app |
| W1.4 | **Customizer opens instantly (P4)** | Render the dialog first; build data on confirm. Remove the `buildExecutiveDeckV2` call from mount | Dialog opens in <200ms with no month data loaded |
| W1.5 | **Save progress (P3)** | Progress callback through `safeWriteJson`; surface write phases in the UI | Progress reflects the write, not just the parse. No silent post-100% period |
| W1.6 | **Sampling running total (C4)** | Live sum across stage cards, shown **before** the draw. Explicit warning when `minRequiredCount` overrides an entered value | Entering values that floor up shows the effective total and why |
| W1.7 | **`minRequiredCount` default** | Stop defaulting it equal to `value` for stages 2–4 | New configs don't silently floor |
| W1.8 | **Session persistence (A6)** | `authSession.ts` `sessionStore()`: `sessionStorage` → `localStorage`. Keep the 7-day TTL | Sign-in survives browser restart. `SECURITY_MODEL.md` updated to record the accepted risk |
| W1.9 | **KPI tile shared load (P5)** | Hoist `useExecutiveRows()` into a context keyed on `(directoryHandle, monthFolder)`; pass the resolved template | N tiles perform 1 load. **Also fixes the `template: null` bug** — tiles resolve label-based fields correctly |
| W1.10 | **`نوع الحركة` hint (U4)** | Special-case sheet-derived fields out of the "no match" report | No structurally-impossible match is reported as a user problem |

> **W1.9 fixes two defects at once.** The KPI renderer hardcodes `template: null`, so tiles silently
> cannot resolve label-based fields (image quality, marking, suspicion level, suspected types,
> smuggling method) that the executive report resolves correctly. Same tile, same month, different
> answer. Fix the load and the template together or the correctness half will be forgotten.

---

## 5. W2 — Accuracy fold unification (blocks W7)

**This is already shipping wrong numbers.** `deck2/section3/workloadAccuracy.ts:38-41` documents the
divergence and patches around it; the executive **document and workbook** were never patched. The
same port can report two different accuracy figures in one generation run.

| # | Task |
|---|---|
| W2.1 | Golden-master current output of **all** editions (W0 prerequisite) — including the divergence, so the change is visible |
| W2.2 | Make `decisionFactTable.ts` the single aggregation entry point: `aggregate(factTable, { grain, groupBy })` with `grain: "image" \| "decision-combined" \| "decision-per-level"` |
| W2.3 | Migrate every consumer to it. **Delete** `buildPortProfiles`' independent fold and `collectLevelAccuracyRows` — do not keep two implementations in sync |
| W2.4 | Rename output fields so grains are not interchangeable (`accuracyByImage` vs `accuracyByDecision`), so a future mismatch is a type error rather than a silent one |

**Acceptance.** Every per-port accuracy figure in every edition traces to one call. A test asserts
the document, workbook and deck report identical figures for the same port and month.

**Expected diff.** Some numbers **will change** — that is the point. W2.1's golden masters make the
change reviewable rather than invisible.

---

## 6. W3 — Distribution I/O rewrite (critical path)

**The single largest win available.** Fixes the 3–6 hour save *and* most app-wide read slowness,
because they are the same defect.

### 6.1 Segment files (D-1)

| # | Task |
|---|---|
| W3.1 | New layout: `distribution.events/{deviceId}-{sessionId}.ndjson`, append-only. Stable `deviceId` per machine, fresh `sessionId` per session |
| W3.2 | Writer: append newline-delimited events to the current session's segment. **One write per batch, not per event** |
| W3.3 | Reader: read all segments, parse NDJSON, merge by existing ordering rules (`eventAt`, then `eventId`) |
| W3.4 | **Legacy compatibility:** read existing per-event files and merge with segments. Never rewrite or delete them — old clients may still be reading |
| W3.5 | Compaction: seal and fold a segment only once its writer session has closed. Never compact a live segment |

**Collision-free guarantee preserved:** uniqueness moves from per-event to per-writer-session. Two
machines still never target the same file.

### 6.2 Write protocol (D-2)

| # | Task |
|---|---|
| W3.6 | Remove the read-back-and-parse verification; keep a cheap existence/size check |
| W3.7 | Re-measure the concurrency ceiling **after** W3.1–W3.5. Tuning it against the current design is worthless — the bottleneck is browser serialization, not disk |

### 6.3 Checkpoint (D-3)

| # | Task |
|---|---|
| W3.8 | Persist `{perSegmentOffsets, accumulatorState, deriveVersion}` beside the derived state |
| W3.9 | On load: compare recorded offsets against current segment sizes; fold only new tails |
| W3.10 | **Discard-and-refold path** when an event predating the checkpoint appears. **Never patch in place** |
| W3.11 | Golden-fixture tests for the late-event case specifically |

> **Non-negotiable.** This fold is **not commutative** — it enforces legal terminal transitions
> (assigned → completed → replaced). Out-of-order application silently produces a wrong terminal
> state. On a shared folder with several machines, late events are routine. W3.10 is not an edge case.

### 6.4 Change detection (D-4)

| # | Task |
|---|---|
| W3.12 | Detect change by **segment byte size** vs recorded offset. Monotonic and clock-skew-immune |
| W3.13 | Confirm via the app's own `revision` counter. **Never gate a skip-refold on `lastModified` alone** — it is wall-clock and unsynchronized across machines |
| W3.14 | Wire into the existing 3-minute tick (`AuthGate.tsx:336`), replacing the blind broadcast with a checked one |

**Acceptance.** 9,000-assignment distribution save completes in **minutes, not hours**. Cold load of
an existing month folds only new events. Re-derive after a single action is O(new), not O(all).
A late event triggers a full refold and produces output identical to folding from scratch.

---

## 7. W4 — Disk amplification (needs §2)

**Target: ~312MB → ~31MB (~10×), zero new dependencies.**

| # | Task |
|---|---|
| W4.1 | Verify nothing reads `rawRow` **after** processing. It is read during BI enrichment (processing-time); post-processing reads must be confirmed absent, not assumed |
| W4.2 | Drop `rawRow` from `PreparedPopulationRow`. Raw data remains in `1-raw/` for audit and reprocessing |
| W4.3 | Replace inlined rows with `xrayImageId` references **plus** the `EMPLOYEE_MIRROR_STUB_FIELDS` stub in: `sample.master.json`, `distribution.current.json`, `main.samples.json`, `{username}.samples.json` |
| W4.4 | Graceful degradation when a referenced row is missing/stale/unsynced — display the stub, never crash |
| W4.5 | Migration: readers accept both shapes; new writes use the new shape. Backup/restore covers both |

**Acceptance.** Workspace size drops ~10× on the same input. **An employee loads their own sample
without any population read** — asserted by test, not inspection.

---

## 8. W5 — Shared data layer (parallel from the start)

| # | Task |
|---|---|
| W5.1 | TanStack Query v5. Disable `refetchOnWindowFocus`/`refetchOnReconnect` |
| W5.2 | Query keys per dataset: `['population', month]`, `['distribution', month]`, `['answers', month, username]`… |
| W5.3 | `invalidateQueries` after every `safeWriteJson`/`casLoop` write |
| W5.4 | Bridge cross-tab invalidation via the existing custom-DOM-event pattern |
| W5.5 | **One invalidation authority:** W3.12's revision check detects change and *tells* Query to invalidate. Query's own staleness must not independently decide to refetch |
| W5.6 | TanStack Virtual for vertical row virtualization in large tables |
| W5.7 | Enable the React Compiler; replace `setTimeout(0)` chunking with `scheduler.postTask()` |

**Acceptance.** Navigating between pages needing the same dataset performs one load. Bundle stays
within budget (~30.6 KB gzip added).

> **Scope boundary:** Query's cache is per-tab and in-memory — it does **not** survive reload. Cold
> start is W3.8's checkpoint. Do not expect W5 to fix first-load time.

---

## 9. W6 — Aggregates, month lock, W35a (needs §2, W3)

| # | Task |
|---|---|
| W6.1 | Compute `MONTH_AGGREGATE_FIELDS` at processing time: counts by port × level × CertScan status, plus before/after processing counts |
| W6.2 | Persist to **workspace disk** (extending `processing.summary.json` or a new index file). **Not IndexedDB** — that is per-machine, so every user would recompute independently |
| W6.3 | Optional IndexedDB mirror keyed `(month, revision)` purely to skip re-parsing |
| W6.4 | Auto-lock the month on distribution completion; admin unlock; distinguish system-closed from person-closed |
| W6.5 | Enforce W35a: a locked month's Population tab reads only the aggregate. **Zero** reads of `population.final.json`, `risk.raw.json`, `bi.raw.json` |
| W6.6 | Recovery path when the aggregate is missing/corrupt: detect, inform, offer **explicit** reprocessing. Never silently fall back to reading rows — that reintroduces the slowness invisibly |

> **W35a boundary, for the record.** The rule governs the tab *opening*. Browse, the sample draw, and
> row-level document reports are **deliberate user actions** and may read rows. An earlier analysis
> called W35a infeasible by reading it as "immediately after Phase 2" — the owner tied it to the end
> of the month's work ("once i finish uploading and distubing sample… it get locked"), and the draw
> precedes the lock. **No conflict exists.**

**Acceptance.** Signing in and opening the Population tab for a finished month performs zero row
reads, asserted by test.

---

## 10. W7 — Reports rework (needs W2, ideally W6)

`buildReportModel` is accuracy/QA-shaped. R1–R5 need lineage, per-port draw quotas, replacement
reasons and reassignment counts. **Per the owner's directive, this is a restructure, not additive
fields.**

| # | Task |
|---|---|
| W7.1 | Extend the report model: raw-vs-processed counts (from W6.1), per-port draw quotas, replacement **reasons**, reassignment counts, completion % |
| W7.2 | **Preserve replacement reasons through the fold.** They exist in `DistributionEvent.notes` but are dropped because `DistributionEntry` has no reason field. The data is already written — only the fold discards it |
| W7.3 | **R1** — sample report: page 1 risk/BI separate, page 2 merged, then per-port, then **per-risk-level** (currently groups by draw-stage, not risk level) |
| W7.4 | **R2** — distribution report: section 1 per stage, section 2 per port, each listing employees and counts |
| W7.5 | **R3** — management report: completion %, replacement counts with reasons, reassignment counts. Section 1 per stage, section 2 per port. Reuse the completion % already computed in `distributionReport.ts` |
| W7.6 | **R4** — executive composite of R1+R2+R3. Only after W2, or it propagates the divergence |
| W7.7 | **R5** — document editions list actual rows per employee (port, level, answers, date). Paged/streamed; a deliberate action, so row access is permitted |
| W7.8 | Decompose `deck2/slides.ts` (3,759 lines) into pure per-section builders, each golden-mastered |
| W7.9 | Yield inside `buildReportModel`, or move it to a worker — **as a separate commit from any algorithmic change** |

> **Ordering decision made on the owner's behalf:** their revision ("section 1 per stage and 2 per
> port") applies to **both** R2 and R3. Consistency across sibling reports beats preserving an order
> stated before the revision. Trivially reversible if wrong.

---

## 11. W8 — Hygiene and deferred

| # | Item |
|---|---|
| W8.1 | Delete dead code: `runQuery`, `buildDataModel`, `filters`, `migrateWorkspaceSchema`, `approveSampleMaster`, `verifyDecisionChain`, `loadSamplingPlan`, `readWorkspaceActionArchive`. **Keep `aggregate()` — it is live** |
| W8.2 | Move `feedback/` under `5-system/`; document the folder-numbering convention (numbered = ordered pipeline stage; unnumbered = unordered collection). **Do not rename existing roots** — migration is unwired |
| W8.3 | Consolidate duplicated read/write boilerplate and the three bounded-log implementations; give notifications archive-before-trim parity with the audit log |
| W8.4 | Fix the `data/` → `components/` boundary violation (`populationQuery.ts:11`) |
| W8.5 | Export column completeness: add `declarationDate`, CertScan fields, `levelOneEmployee`/`levelTwoEmployee` |
| W8.6 | Placement: CertScan input and RNG seed into `إعدادات المعالجة`; remove the three unwanted buttons **but relocate the dropped-row drill-down**; remove `معاينة المجتمع النهائي`; auto-run Phase 2 |
| W8.7 | Approvals page: consistent sort order with an indicator; replace the two one-off hex colors; fix `float:left` in RTL; unify the two modal structures |
| W8.8 | Bulk reassign for oversight roles (**capability gap** — `XrayReferrals.tsx:312-315` gives oversight users no selection UI; the `"filtered"` bulk-source type is dead code) |
| W8.9 | Correct CLAUDE.md's stale test count (945/141 → 1,619/193); resolve the lockfile drift |
| W8.10 | Decompose the oversized components (1,169 / 1,099 / 902 / 776 / 757 lines), de-risked by the React Compiler |

### Needs owner input (not blocking)
- **C5 CertScan matching** — needs the owner's CertScan paste + port names to confirm where
  normalization diverges. Interim: add a **pre-commit match-count preview** so a 30-vs-30,000
  mismatch is visible *before* processing commits.
- **C6 backfill policy** — a product decision: backfill CertScan shortfall from NonCertScan, or
  under-fill and report? Changes the sample's statistical properties. **Recommendation: under-fill
  and report**, since silent substitution would misrepresent stratum composition.

### Deferred by owner
**W37** — the ad-hoc Excel upload + formula/spreadsheet subsystem. Owner: *"this is advanced stuff
leave it for last thing."* A genuine new subsystem needing its own spec.

---

## 12. Migration and rollback

| Workstream | Migration | Rollback |
|---|---|---|
| W3 | Readers accept per-event files **and** segments. New writes use segments. Old files never deleted | Code rollback; both formats remain readable |
| W4 | Readers accept inlined **and** referenced shapes. New writes use references | Code rollback; both shapes remain readable |
| W6 | Aggregate is additive; absence triggers the explicit-reprocess path | Remove enforcement; readers fall back to rows |
| W2, W7 | No disk format change | Code rollback |

**No workstream deletes or rewrites existing workspace data in place.** Every format change is
additive with a dual-read period — consistent with the app's existing "never silently move or
delete" stance on legacy layouts.

---

## 13. Definition of done

1. Distribution save for ~9,000 assignments completes in **minutes**.
2. Workspace size is **~1:1 with source Excel**, not 11×.
3. Opening the Population tab for a finished month performs **zero row reads**.
4. An employee loads their sample **without** a population read.
5. Report export and the customization dialog open **immediately**.
6. Every per-port accuracy figure across every edition **agrees**.
7. A user can **type a comma**.
8. Sample totals **match what was requested**, or explain visibly why not.
9. All golden masters pass, or every diff is reviewed and intentional.
10. Bundle within budget; single-file build intact.
