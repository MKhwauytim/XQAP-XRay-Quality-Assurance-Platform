# Rework — Phase 2 Research: Decisions, Evidence, and Rejected Options

**Date:** 2026-08-07
**Method:** five parallel research agents with web access, each given the app's hard constraints as
a filter (no backend; single-file ~3MB/~1MB-gzip bundle; multi-machine shared folder; Chromium-only;
human-inspectable workspace files).
**Status:** Phase 2 of 4. Phase 1 = `REWORK_PHASE1_STUDY_2026-08-07.md`. Phase 3 = spec + plan.

---

## 1. Decisions

Every decision below is made. Rationale and rejected alternatives follow in §2–§7.

| # | Area | Decision | Cost |
|---|---|---|---|
| **D-1** | Event persistence | Replace one-file-per-event with **per-writer append-only segment files** (`{deviceId}-{sessionId}.ndjson`) | 0 KB |
| **D-2** | Write protocol | **Drop the read-back-and-parse verify**; keep a cheap existence/size check | 0 KB |
| **D-3** | Fold cost | **Persisted checkpoint (snapshot + delta)**, with mandatory discard-and-refold on late events | 0 KB |
| **D-4** | Change detection | **Segment byte-size diff** + `revision` confirmation. Never mtime alone | 0 KB |
| **D-5** | Disk amplification | **Reference, don't copy** (+ display stub) and **drop `rawRow`** | 0 KB |
| **D-6** | Shared data layer | **TanStack Query v5** | ~13.6 KB gz |
| **D-7** | Large tables | **TanStack Virtual** (vertical only) | ~17 KB gz |
| **D-8** | Comma bug | Hand-rolled **`useDelimitedListInput()`** hook, no form library | 0 KB |
| **D-9** | Aggregates | **Hand-rolled nested record**, no pivot library | 0 KB |
| **D-10** | Report structure | **Decompose into pure per-section builders**; no templating engine | 0 KB |
| **D-11** | Charts | **Keep hand-rolled inline SVG** | 0 KB |
| **D-12** | Accuracy folds | **Single fact table + explicit grain parameter**; delete the divergent paths | 0 KB |
| **D-13** | Rewrite safety | Golden masters at 3 grains + **`fast-check`** + a hand-rolled differential harness | dev-only |
| **D-14** | Scheduling | **`scheduler.postTask()`** replaces `setTimeout(0)` chunking | 0 KB |
| **D-15** | Memoization | **Enable the React Compiler** | 0 KB runtime |

**Total new shipped weight: ~30.6 KB gzip on a ~1,170 KB budget — about 2.6%.** Everything else is
achieved with patterns already in the codebase.

---

## 2. The distribution I/O rewrite (D-1, D-2)

### The finding that settles it
**The per-file cost is a platform tax that cannot be optimized away.** Chromium bug 40899722
confirms `createWritable()` routes each write through a swap-file plus verification pipeline before
the file is durably visible; 1,000 files can take ~1 minute, and the delay varies with unrelated
factors like DevTools being open — i.e. **internal browser-process serialization, not disk I/O**.
The "in-place write" mode that would bypass it is unimplemented and blocked indefinitely. The WICG
spec has no batching or transaction API (issue #378 proposes batched *lookup* only).

**Therefore the only available lever is reducing file count.** Tuning the write protocol, raising
concurrency, or waiting for the platform are all dead ends.

### D-1 — per-writer append-only segments
Each machine/session appends to its own segment file instead of creating one file per event.
**~9,000 files → dozens.**

**The collision-free guarantee survives.** Uniqueness moves from per-event to per-writer-session —
coarser, but two machines still never target the same file. This is what local-first systems
actually do: Automerge and Yjs persist batched per-client change logs, not one file per change.

Segments need periodic compaction (LSM-style), sealing a segment only once its writer has closed it.

**Cost:** a genuine data-model migration touching fold and replay, plus a read path for existing
per-event files. Medium-high complexity, best improvement-to-risk ratio available.

### D-2 — drop the read-back verify
Chrome's `close()` already performs its own finalization. The app's additional read-and-parse is
likely duplicate insurance. A cheap existence/size check still catches silent truncation on flaky
network shares. Removes 1–2 of ~10 ops per file and stacks with D-1.

---

## 3. Incremental computation (D-3, D-4)

### D-3 — persisted checkpoint
Store `{absorbed high-water-mark, accumulator state}` alongside the derived state. On load, fold
only what the checkpoint hasn't absorbed. **O(9,000) → O(new events)** — 100–1000× in steady state,
and unlike the current in-memory cache it **survives page reload**.

> **Mandatory correctness rule.** A snapshot is only an optimization. If an event surfaces that
> predates what the checkpoint absorbed, the checkpoint must be **discarded and refolded from
> scratch** — never patched in place. This fold is **not commutative**: it enforces legal terminal
> transitions (assigned → completed → replaced), so out-of-order application silently produces a
> wrong terminal state. On a shared network folder with several machines, late events are routine,
> not hypothetical. This path needs golden-fixture tests before any fold code is touched.

### D-4 — change detection, and the cross-agent correction

Two research findings did **not** compose as delivered, and the resolution matters:

- Research recommended **name-only directory listing** diffs — cheap and clock-skew-immune.
- But under D-1, events append to *existing* segment files. **The name listing is unchanged when a
  segment grows, so a name diff misses new events entirely.**

**Resolution: use `File.size`.** It is obtainable from a handle without reading content (exactly
like `lastModified`), and for append-only segments it is **monotonic and clock-skew-immune**, which
mtime is not. The checkpoint stores per-segment byte offsets; change detection becomes "has any
segment grown past my recorded offset," and only the new tail is read.

**Hard rule:** `lastModified` is wall-clock and unsynchronized across machines on a network share.
**Never gate a skip-refold decision on mtime alone** — always confirm against the app's own
`revision` counter, which is immune to clock skew.

### Platform options confirmed unavailable
- **File System Observer API** — Chrome 129+ origin trial, not stable. Polling it is.
- **SharedArrayBuffer** — requires COOP/COEP response headers, which a `file://` or plain-static
  distribution cannot set. Use Transferable objects, which need no headers.

---

## 4. Disk amplification (D-5)

**Fix the data shape, not the encoding.** Zero dependencies, ~10× reduction: **312MB → ~31MB**,
near 1:1 with the 28.4MB source Excel.

1. **Reference, don't copy.** The four derived files reference rows by `xrayImageId` — already the
   join key `orphanScan.ts` uses — instead of inlining full copies.
2. **Drop `rawRow`.** The raw data already lives in `1-raw/`; duplicating it inside every processed
   row buys nothing.

> **Constraint the research under-weighted, and it changes the implementation.** The per-employee
> mirrors inline full rows *for a reason*: they let an employee load their own work without touching
> the 500k-row population file. That is the Phase A win and the precondition for W35a. Pure
> references would force employees to load the population to resolve them — a direct regression on
> the problem being fixed.
>
> **Therefore the display stub must contain every field the employee UI renders.** This is
> structurally identical to W35a's aggregate problem: *enumerate the exact field set, or the
> guarantee silently breaks.* Phase 3 treats these as **one shared prerequisite task**, not two.

> **Verify before dropping `rawRow`:** it is read during BI enrichment (fields merged key-by-key
> when the risk value is blank). That is a processing-time read. Whether anything reads it *after*
> processing must be confirmed, not assumed.

### Rejected, with numbers
| Option | Verdict |
|---|---|
| **DuckDB-WASM** | 1.8–9.6 MB gzip — meets or exceeds the app's entire 1.17 MB budget alone. Dead |
| **SQLite-WASM** (sql.js / wa-sqlite) | 566 KB–1 MB, solves a query problem this app doesn't have, produces opaque binaries. Dead |
| **Arrow IPC / Parquet-wasm** | 456 KB–1.2 MB, opaque, wrong problem. Dead |
| **Gzipping live workspace files** | Real 60–80% saving, zero bundle cost — but kills diffability, partial reads, and human inspection. **Cold backups only** |

### Deferred (revisit only after D-5 is measured)
**NDJSON** for the population file (zero cost, stays readable, enables streaming) · **columnar
JSON** (~25–35% more, breaks row-level updates) · **OPFS as a read cache** for the checkpoint.

---

## 5. React and data flow (D-6 … D-8, D-14, D-15)

### D-6 — TanStack Query v5 (~13.6 KB gzip)
`queryFn` is just `() => Promise<T>` — nothing requires HTTP, so it wraps a File System Access read
directly. Query keys give the cross-page sharing the app entirely lacks. `invalidateQueries` slots
in after existing `safeWriteJson`/`casLoop` calls. React 19 support confirmed.

**Three boundaries:**
- Disable `refetchOnWindowFocus` / `refetchOnReconnect` — meaningless with no network.
- Cross-tab invalidation still uses the app's existing custom-DOM-event pattern; Query has no
  filesystem-watch integration.
- **Query's cache is per-tab and in-memory — it does not survive reload.** It solves duplicate
  loading (D3), *not* cold start. D-3's on-disk checkpoint is what solves cold start. Conflating
  these two would produce surprise that the first load is still slow.

> **Conflict to prevent in Phase 3:** the D-4 revision check and Query's own staleness model must
> not both decide when to refetch. **One invalidation authority:** the revision check detects change
> and *tells* Query to invalidate.

### D-7 — TanStack Virtual (~17 KB), vertical only
**RTL eliminated the obvious choice.** react-window's RTL support is documented-broken across
several long-standing issues, and **v2 drops RTL from `List` entirely**. TanStack Virtual's RTL gap
is horizontal-only, irrelevant for vertical row virtualization. react-virtuoso (15.7 KB) is the
fallback if wide horizontal column virtualization is ever needed. `virtua` (~3 KB) claims RTL
support but has little issue history to verify against — a spike, not a default.

### D-8 — `useDelimitedListInput()`, no form library
Keep raw text in local state as the input's actual `value`; parse to the canonical array only on
blur/commit; never round-trip parse→join through the render path being typed into. One shared hook
applied at every affected call site — which fixes the alias, sheet-pattern, and stage-mapping inputs
together. react-hook-form (~8.6–10 KB) buys machinery this app doesn't need.

### D-14, D-15 — two free wins
`scheduler.postTask()` and `isInputPending()` are legitimate here (Chromium-only already) and
strictly better than `setTimeout(0)` chunking. The **React Compiler is stable with zero runtime
bundle cost** and materially de-risks decomposing the 1,169/1,099/902-line components — no parallel
manual-memoization audit needed.

---

## 6. Reporting (D-9 … D-12)

- **D-10 — no templating engine.** The 3,759-line slide file is a *decomposition* problem, not a
  templating-technology problem. Split into small pure per-section builders
  (`buildPortAccuracySection(model): string`) hung off a typed report model, each independently
  golden-mastered. Keeps full TypeScript checking on interpolated data.
- **D-11 — keep hand-rolled SVG.** Chart.js tree-shaken ~14 KB and Visx ~15 KB add weight for
  interactivity and animation that a static, screen-reader-paired, export-friendly report doesn't
  need. Plotly (~3.6 MB) is disqualified outright.
- **D-12 — one fact table, explicit grain.** Make `decisionFactTable.ts` the mandatory single
  aggregation entry point: `aggregate(factTable, { grain, groupBy })`. **Delete** the divergent
  second path rather than keeping two implementations in sync. This directly fixes the live bug
  where the executive document and deck2 can report different accuracy for the same port.
- **D-9 — hand-rolled aggregates.** Commercial pivot components are UI-grid-centric and far too
  heavy. A nested `Record<port, Record<level, Record<certScanStatus, {count, sum}>>>` written once
  at processing/lock time fits the existing JSON-envelope convention. Counts and sums are monoids,
  so partial aggregates merge trivially if per-port computation is ever needed.

---

## 7. Rewrite safety protocol (D-13)

This is non-negotiable given that sampling, folding, and report builders are deterministic by design
and feed audit trails.

### Before touching any code
1. **Freeze golden masters at three grains:** raw algorithm output (`drawSample()`, apportionment),
   event-fold result, and the report **model** — *not* rendered HTML, which is far too brittle a
   diff target. Include curated edge cases: empty port, tied largest-remainder, max-capacity
   spillover.
2. **Add `fast-check`** (dev-only, never ships). Properties for apportionment (allocations sum
   exactly to the total, quota-bounded, stable alphabetical tie-breaks) and for RNG/draw (same seed
   → identical sequence, Fisher-Yates yields a true permutation, spillover conserves totals).
   **Run them against current code first** to validate the properties themselves.
3. **Audit** every `.sort()` comparator for totality, and every `Map`/object choice that feeds
   `JSON.stringify` or a content hash.

### During
A hand-rolled ~30-line differential harness (a Scientist-style old-vs-new diff; the JS Scientist
ports assume live traffic to shadow, which doesn't exist here). Run both implementations against
golden fixtures plus `fast-check`-generated inputs, deep-diff, fail loudly. **Keep the old
implementation as the oracle until cutover is verified.**

### After
Re-run with legacy present, then delete legacy and re-run to catch stale dependencies. One manual
end-to-end report diff as a human check. Bump `SAMPLING_ALGORITHM_VERSION` **only** for intentional
behaviour changes.

### JS determinism traps beyond `localeCompare`
The app already correctly avoids `localeCompare` for Arabic port names. Others of the same class:
- **Sort comparator non-totality** can still diverge across engines despite spec-guaranteed stability.
- **Numeric-looking string object keys** sort numerically regardless of insertion order — a real
  trap if any ID looks numeric.
- **Floating-point rounding is order-sensitive** — fold order must be *pinned*, not left to
  `reduce()` or worker-chunk arrival order.
- **`JSON.stringify` silently drops `undefined` and flattens `Map`/`Set` to `{}`** — dangerous if a
  rewrite swaps object types before hashing.
- **`postMessage` structured-clone loses `Map`/`Set`/class instances** — directly relevant to moving
  the fold into a worker.
- **Unpinned `Date.now()`** anywhere in a deterministic path.

> **Sequencing rule:** keep a worker migration and any algorithmic change as **separate, separately
> golden-mastered commits**. The risk isn't the worker — it's incidental iteration-order changes
> made during the same refactor.

---

## 8. What Phase 2 changed about the plan

1. **The distribution fix is now specified, not just identified.** Segment files + checkpoint +
   size-based change detection is a concrete design with the collision-free guarantee preserved.
2. **The 11× fix needs no dependencies at all** — it's a data-shape change, and the heavyweight
   storage options are all disqualified on bundle size.
3. **Two new shipped dependencies, ~30 KB total.** Everything else uses existing patterns.
4. **The employee-mirror stub and the W35a aggregate are the same prerequisite** — enumerate the
   exact field set the UI needs, once.
5. **The accuracy-fold fix is a deletion, not a reconciliation** — one fact table, one grain
   parameter.
