# Population workbook import — out-of-memory on the worker→window `postMessage` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `[population:workbook-parse [XQ-POP-003]] Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': Data cannot be cloned, out of memory` on large Excel imports, by splitting `src/workers/workbookWorker.ts`'s single monolithic result `postMessage` into row batches. This is a **wire-protocol change internal to the worker boundary** — what `setRiskWorkbookResult` and `applyBiFileResults` receive on the main thread is byte-for-byte the same object graph as today.

**Architecture:** One new pure module (`src/workers/workbookResultStream.ts`) holding both halves of the new protocol — the worker-side chunk emitter and the main-thread-side accumulator — plus the discriminated-union change in `workbookWorkerTypes.ts` and the two call sites that consume it. No disk format changes, no schema changes, no algorithm changes, no new dependency.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Vitest with the `node` default environment (this plan's new test file needs no jsdom and deliberately imports **no** `xlsx`), React 19 for the one consuming call site.

---

## 0. Scoping confirmation — this is NOT blocked Phase C/D work

This plan was gated on confirming that the ingest-phase OOM is not one of the owner-approval-blocked items in `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`. **Confirmed, on four independent grounds — this work may proceed.**

**(a) It is a different worker from the one Phase B shipped.** There are exactly two workers in `src/workers/`:

| Worker | Input | When it runs | Phase |
|---|---|---|---|
| `src/workers/populationQueryWorker.ts` | `rawJsonText` — the already-saved `population.final.json` envelope (`populationQueryWorker.test.ts:23-43`) | Population **Browse**, after processing has written to disk | **Phase B — shipped 2026-08-04** |
| `src/workers/workbookWorker.ts` | `riskFile: File` / `biFiles: File[]` — raw `.xlsx`/`.csv` bytes (`workbookWorkerTypes.ts:4-17`) | Population **Phase 1 import**, before anything reaches disk | *not covered by A or B* |

Phase B's acceptance criterion (proposal `:144`) — "No complete population array crosses `postMessage()` into the window" — was written about the Browse query worker, and `populationQueryWorker.ts` satisfies it by returning `result.pageRows`. `workbookWorker.ts` was never in Phase B's scope and still posts everything at once (`workbookWorker.ts:67`).

**(b) The gating clause is scoped to a specific, enumerable finding list that does not include this.** `CLAUDE.md:70` says the phase order "gates any finding marked **proposal-covered** in `docs/audit/APP_DATA_MANAGEMENT_AUDIT_2026-07-22.md`". That audit declares its own scope as "monthly data isolation, employee authorization and read paths, replacement candidates, and all-month selection semantics" (`:4-5`) and carries exactly four findings (`:26-29`): employee landing/loader (Phase A), `XrayReferrals`' read path (Phase A), replacement-candidate discovery (Phases A/C/D), and all-month aggregate reads. **The workbook ingest `postMessage` is not among them, and the audit never mentions `workbookWorker`, `postMessage`, or structured cloning at all.**

**(c) The fix does not implement, satisfy, or pre-empt Phase D.** Phase D's "Before" list does name workbook parsing (proposal `:277`, "Workbook parsing returns complete normalized arrays to the main thread") — but Phase D's *answer* to it is a categorically different design: "The processing worker emits processed rows in batches **directly to staged part writers** and returns progress/summary metadata, **not the full prepared population**" (`:282`), which explicitly depends on Phase C's partitioned format (`:296`). Phase D's acceptance criterion is "Import processing does not retain or post a complete prepared population in React/window memory" (`:303`). **This plan does not meet that criterion and does not try to** — React still ends up holding the full `RiskWorkbookResult`, exactly as it does today. It only stops the *transfer itself* from requiring one contiguous serialization of the whole dataset. Phase D, if and when approved, deletes this code path rather than building on it. Nothing here creates a format, an index, or an abstraction that Phase C/D would have to migrate.

**(d) There is direct in-repo precedent for shipping a bounded ingest-memory fix independently.** `src/data/population/populationTypes.ts:168-172` and `:188-208` document "**B7 (OOM fix, 2026-08-12)**" — the lazy `rawRow` accessor, a memory fix on this same ingest/processing path, landed three weeks *after* the proposal was written and outside its phase order. `populationProcessor.test.ts:239-243` pins it. The present fix is the same shape of work: a crash fix with no schema impact.

**Conclusion:** proceed with the plan below as a bounded, independent fix. Do **not** expand it toward partitioned storage, an index, a repository contract, or streaming into disk writers — all of that is Phase C/D and remains owner-gated.

---

## 1. Root cause, verified against the current code

`src/workers/workbookWorker.ts:67`:

```ts
    send({ type: "done", riskResult, biResults, warning });
```

`riskResult.rows` is `NormalizedRiskRow[]` (`riskDataTypes.ts:83-90`) and each `biResults[i].result.rows` is `NormalizedBiRow[]` (`biDataTypes.ts:103-121`). Every row carries ~25–35 normalized string fields **plus `rawRow`** — the complete original spreadsheet row, attached as a plain enumerable data property:

- `riskDataNormalizer.ts:261` → `rawRow: sourceRow,`
- `biDataNormalizer.ts:281` → `rawRow: sourceRow,`

`rawRow` is roughly the size of everything else on the row combined (`populationTypes.ts:148-149` says as much for the prepared row), and structured clone copies it in full. A month with 130k risk rows and 247k BI rows across up to ten BI files (`workbookWorkerTypes.ts:12`, `MAX_BI_UPLOADS = 10`) therefore asks `postMessage` to serialize the entire ingest output in **one** call. At that instant three full-size copies coexist: the worker's live graph, the serialization buffer, and the window's deserialized graph. `DataCloneError: … out of memory` is that middle allocation failing.

### 1.1 Is anything genuinely unclonable? — No. Verified, not assumed.

The task brief required ruling out a specific unclonable field before committing to a pure chunking fix. Traced end to end:

- `riskDataWorkbook.ts:88-95` reads with `cellDates: false`, `cellNF: false`, `cellStyles: false`, `cellHTML: false` — so no `Date`, no formatting objects, no HTML nodes reach the row objects.
- `worksheetRows.ts:152-157` extracts with `raw: true, defval: null`, and `worksheetRows.ts:190-201` builds each source row with `Object.fromEntries` — a plain object whose values are `RawCell` (`worksheetRows.ts:22`: `string | number | boolean | Date | null | undefined`). Every one of those is structured-cloneable, `Date` included.
- `preprocessLargeNumbers` (`worksheetRows.ts:79-101`) rewrites long numeric IDs to **strings** before extraction, so nothing exotic survives.
- The normalized fields themselves are all `string | null` / `boolean` / `number` (`riskDataTypes.ts:1-47`, `biDataTypes.ts:1-54`). No functions, no class instances, no `Proxy`, no getters. (Contrast `PreparedPopulationRow`, where `rawRow` **is** a non-enumerable lazy accessor — `populationTypes.ts:223-246` — but that is built later, in `populationProcessor.ts`, on the main thread, and never crosses this boundary.)

The failure is **total payload size**, not a poisoned field. Chunking is the correct fix and the conditional "strip/serialize an unclonable field instead" branch the brief allowed for is **not needed**; do not add one.

### 1.2 Considered and rejected: `Transferable` / columnar re-encoding

Rejected as over-engineering for this scope, and recorded here so it is not re-litigated mid-implementation. The only zero-copy transfer JavaScript offers is `ArrayBuffer` (and views). Getting these rows into one would mean encoding ~35 heterogeneous string columns plus an open-ended `rawRow` bag into a binary or `TextEncoder`-packed layout and decoding it back on the window — a new serialization format to design, version, and test, whose decode step re-materializes exactly the same object graph and therefore saves nothing on the *receiving* side, which is where the population ultimately has to live anyway. Batched `postMessage` removes the failing allocation with ~120 lines and no new format. If a future measurement shows the remaining steady-state cost is the problem, that is Phase D's brief, not this plan's.

### 1.3 What the fix actually buys

Peak transfer-time memory drops from roughly `3 × dataset` to `≈ 1 × dataset + one 5,000-row chunk`, because the plan does two things together:

1. **Batch** the transfer, so the serialization buffer is per-chunk instead of whole-dataset (this alone is what stops the `DataCloneError`); and
2. **Release** each batch inside the worker immediately after posting it, and stream the risk rows *before* BI parsing begins — so the worker's retained set shrinks as the window's grows, instead of both being fully resident at the same moment.

Step 2 is why the emitter deliberately mutates its input array (see `streamRowsInChunks`'s contract in Task 1) and why the worker streams risk rows at the top of the handler rather than at the end.

### 1.4 Ordering and aliasing — why no `requestId` is added

`postMessage` from a `DedicatedWorker` to its parent is delivered in order on a single implicit port, so chunk N-1 cannot arrive after chunk N. `workbookWorker.ts` also handles exactly one job at a time and has no request correlation today — a deliberate difference from `populationQueryWorker.ts`, documented at `populationQueryWorkerTypes.ts:8-9` ("`requestId` (absent from `workbookWorkerTypes.ts`) lets a caller correlate an in-flight worker reply back to the request that produced it — `workbookWorker.ts` needs no such field"). **Do not add `requestId` in this plan.** The accumulator is instead scoped to a single parse run (it is constructed inside the per-run `new Promise` executor in `index.tsx`, alongside `onMessage`), so a superseded run's listener is removed by `cleanup()` and its accumulator becomes garbage — a stale chunk has nowhere to land.

Isolation *within* a run is handled by keying BI chunks on `fileIndex` rather than on arrival order, which Task 1 Step 1 pins with a test.

---

## Global Constraints

- **Tier 3** — justified below. Every edit needs an entry in `docs/edit logs/2026-08-24.md`, generated with `npm run editlog`, inserted at the TOP of the day's file (newest-first; `npm run check:release` reads only the topmost heading).
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- **Tasks 2 and 3 must land in ONE commit.** The response union is a discriminated type shared by the worker and the window; shipping either half alone is a broken build and a broken import path. Task 1 is additive and unused, so it commits on its own.
- Nothing in this plan touches `drawSample`, `deriveCurrentDistribution`, `mergeBiWorkbookResults`, `processRiskWorkbook`, `processBiWorkbook`, `normalizeRiskRow`, `normalizeBiRow`, or any report/export builder. `SAMPLING_ALGORITHM_VERSION` is **not** bumped — no sampling semantics change.
- `applyBiFileResults`'s signature (`usePhaseOneUploads.ts:92`, `:385-388`) and the exported `BiFileResult` type (`workbookWorkerTypes.ts:27-31`) **do not change**. `multiFileBiImport.test.tsx:26` imports `BiFileResult` and must keep compiling untouched.
- Never `push(...chunk)` when accumulating rows. Use a `for…of` loop — `biDataWorkbook.ts:354-356` already documents why ("a single BI population already exceeds V8's ~65k argument limit"), and `riskDataWorkbook.ts:143` / `:160` follow the same idiom.

### Why tier 3 rather than the default tier 2

Three of the tier-3 triggers apply, and one tier-3-only gate is load-bearing here:

1. **Data format.** The worker↔window response union *is* a format, even though it is ephemeral and never persisted. It is the contract two independently-editable files agree on.
2. **`npm run build` is the only gate that can catch this class of failure.** `workbookWorker.ts` is consumed through `?worker&inline` (`index.tsx:51`) and inlined by `vite-plugin-singlefile`. `CLAUDE.md:30` warns explicitly that "a bad `?worker&inline` import … passes a fully green suite and dies at build". A new module imported *by* the worker is exactly that risk.
3. **`check:bundle-size` and `check:complexity` are both genuinely in play** — the worker bundle is inlined into `dist/index.html` (budget 3.6 MB raw / 1.3 MB gzip, currently ~3.34/1.11), and `index.tsx`'s message handler grows inside an already-large function (`check:complexity` runs `max-lines-per-function: [error, 1450]`).

Tier 3 selects the **gate list**, not the version bump. This is a bugfix, so both entries take a decimal bump (`CLAUDE.md:34`), which means Task 3's `editlog` invocation must pass `--bump=minor` explicitly — `scripts/editlog.mjs:136` defaults `--tier=3` to a *major* bump, which would incorrectly announce v116.0.

Expected versions from `package.json` `115.2.0`: **Task 1 → v115.3** (`115.3.0`), **Tasks 2+3 → v115.4** (`115.4.0`).

---

### Task 1: The shared chunk protocol module + its round-trip tests

Additive only. Nothing imports this module yet at the end of this task, so it is independently committable and independently revertable.

**Files:**
- Create: `src/workers/workbookResultStream.ts`
- Create: `src/workers/workbookResultStream.test.ts`

**Interfaces:**
- Consumes: `NormalizedRiskRow`, `RiskWorkbookResult` (`src/components/Sidebar/Tabs/Population/riskData/riskDataTypes.ts`), `NormalizedBiRow`, `BiWorkbookResult` (`.../biData/biDataTypes.ts`), `BiFileResult` (`./workbookWorkerTypes`), `yieldToMain` (`../data/storage/yieldToMain`) — all type-only except `yieldToMain`, all unchanged.
- Produces:
  - `WORKBOOK_ROW_CHUNK_SIZE: 5000`
  - `type RiskWorkbookShell = Omit<RiskWorkbookResult, "rows">`
  - `type BiWorkbookShell = Omit<BiWorkbookResult, "rows">`
  - `type BiFileShell = { fileName: string; result: BiWorkbookShell | null; error?: string }`
  - `streamRowsInChunks<TRow>(rows, emit, chunkSize?): Promise<void>` — worker side
  - `createWorkbookResultAccumulator(): WorkbookResultAccumulator` — window side

**Why 5,000 and not 10,000:** `riskDataWorkbook.ts:131` already normalizes in 5,000-row chunks and `biDataWorkbook.ts:235` in 10,000. Post-normalization rows are the wider of the two representations (normalized fields *plus* the retained `rawRow`), so the plan takes the more conservative of the two existing in-repo constants. At ~1.5–3 KB serialized per row that is roughly a 7–15 MB message — an allocation size that is unremarkable, versus the ~1–2 GB single allocation the current code attempts on a 400k-row month.

- [ ] **Step 1: Write the failing tests**

Create `src/workers/workbookResultStream.test.ts`. Note the environment: **no** `/* @vitest-environment jsdom */` line — this is a pure-data module and runs under the `node` default (`CLAUDE.md:244`). Import `describe`/`it`/`expect` explicitly (`globals: false`).

```ts
import { describe, expect, it } from "vitest";
import {
  WORKBOOK_ROW_CHUNK_SIZE,
  createWorkbookResultAccumulator,
  streamRowsInChunks,
  type BiFileShell,
  type RiskWorkbookShell
} from "./workbookResultStream";
import type { BiWorkbookResult } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedBiRow } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";

// Minimal but REAL row shapes -- `rawRow` is deliberately populated on every
// fixture row, because it is the field that dominates the payload size this
// module exists to bound (riskDataNormalizer.ts:261, biDataNormalizer.ts:281).
function riskRow(index: number): NormalizedRiskRow {
  return {
    movementType: "بحري",
    portCode: "JED", portName: "ميناء جدة الإسلامي", portType: null,
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: null, transitDeclarationNumber: null,
    declarationDate: null, declarationHijriDate: null,
    manifestNumber: null, manifestType: null, manifestDate: null,
    plateOrContainerNumber: null, finalDestination: null,
    entryDate: null, exitDate: null,
    chassisNumber: null, reportNumber: null, hasReport: false,
    xrayLevelOneResult: null, xrayLevelTwoResult: null, inspectorResult: null,
    oppositeInspectorResult: null, liveMeansResult: null,
    xrayImageId: `XR-${index}`, xrayEntryDate: null,
    targetedByRiskEngine: null, riskMessage: null, stage: null,
    rawRow: { "رقم الأشعة": `XR-${index}`, "عمود إضافي": `v${index}` },
    sourceSheetName: "بحري وارد",
    sourceRowNumber: index + 2
  };
}

function biRow(index: number): NormalizedBiRow {
  return {
    source: "بحري وارد",
    xrayImageId: `XR-${index}`, xrayEntryDate: null,
    portType: null, portCode: null, portName: null,
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: null, preliminaryDeclarationNumber: null,
    declarationDate: null, declarationHijriDate: null,
    inboundOutboundType: null, declarationType: null, declarationStatus: null,
    plateOrContainerNumber: null, chassisNumber: null, governance: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    levelOneResultCode: null, levelTwoResultCode: null,
    levelOneResult: null, levelTwoResult: null,
    manualInspectionResultCode: null, manualInspectionResult: null,
    oppositeInspectionEmployee: null, oppositeInspectionResultCode: null,
    oppositeInspectionResult: null,
    liveMeansEmployee: null, liveMeansResultCode: null, liveMeansResult: null,
    notes: null,
    rawRow: { "رقم الأشعة": `XR-${index}` },
    sourceSheetName: "بحري وارد",
    sourceRowNumber: index + 2
  };
}

function riskResult(rowCount: number): RiskWorkbookResult {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => riskRow(i)),
    sheetSummaries: [{
      sheetName: "بحري وارد", movementType: "بحري",
      originalRowCount: rowCount, normalizedRowCount: rowCount,
      excludedMissingXrayIdCount: 0
    }],
    unknownSheetNames: [],
    totalOriginalRows: rowCount,
    totalNormalizedRows: rowCount,
    totalExcludedMissingXrayIdCount: 0
  };
}

function biResult(rowCount: number): BiWorkbookResult {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => biRow(i)),
    sheetSummaries: [{
      sheetName: "بحري وارد", source: "بحري وارد",
      originalRowCount: rowCount, normalizedRowCount: rowCount,
      excludedMissingXrayIdCount: 0
    }],
    unknownSheetNames: [],
    unmatchedSheetNames: [],
    totalOriginalRows: rowCount,
    totalNormalizedRows: rowCount,
    totalExcludedMissingXrayIdCount: 0
  };
}

describe("streamRowsInChunks", () => {
  it("splits into ceil(n / chunkSize) contiguous, in-order chunks", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    const chunks: number[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk), 5);

    expect(chunks.map((c) => c.length)).toEqual([5, 5, 2]);
    expect(chunks.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("emits exactly one chunk when the row count equals the chunk size", async () => {
    const chunks: number[][] = [];
    await streamRowsInChunks([1, 2, 3], (chunk) => chunks.push(chunk), 3);
    expect(chunks).toEqual([[1, 2, 3]]);
  });

  it("emits nothing at all for an empty row array", async () => {
    const chunks: number[][] = [];
    await streamRowsInChunks([], (chunk) => chunks.push(chunk), 5);
    expect(chunks).toEqual([]);
  });

  it("passes the SAME row object references through -- never a per-row copy", async () => {
    const rows = [riskRow(0), riskRow(1)];
    const original0 = rows[0];
    const chunks: NormalizedRiskRow[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk), 5);
    expect(chunks[0][0]).toBe(original0);
  });

  it("RELEASES each emitted slice from the source array as it goes (the memory contract)", async () => {
    // This is the half of the fix that keeps the worker from holding the full
    // dataset while the window builds its own copy. Without it, batching alone
    // still leaves both sides fully resident at the same moment.
    const rows = Array.from({ length: 6 }, (_, i) => i);
    const sourceLengthsSeen: Array<Array<number | undefined>> = [];
    await streamRowsInChunks(
      rows,
      () => { sourceLengthsSeen.push([...rows]); },
      2
    );

    // After the LAST emit, every slot the emitter has already handed off is
    // cleared. (The final chunk's own slots are cleared after its emit
    // returns, so the post-call state is the strongest assertion.)
    expect(rows).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    // ...and the release is incremental, not a single wipe at the end: by the
    // time the 2nd chunk is emitted, the 1st chunk's slots are already gone.
    expect(sourceLengthsSeen[1].slice(0, 2)).toEqual([undefined, undefined]);
  });

  it("defaults to WORKBOOK_ROW_CHUNK_SIZE when no size is given", async () => {
    const rows = Array.from({ length: WORKBOOK_ROW_CHUNK_SIZE + 1 }, (_, i) => i);
    const chunks: number[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk));
    expect(chunks.map((c) => c.length)).toEqual([WORKBOOK_ROW_CHUNK_SIZE, 1]);
  });

  it("keeps the default chunk size bounded -- a regression guard on the whole fix", () => {
    // If a future edit sets this to Infinity/0/NaN the protocol silently
    // reverts to one monolithic message and the OOM comes straight back,
    // with no other test in the repo noticing.
    expect(Number.isInteger(WORKBOOK_ROW_CHUNK_SIZE)).toBe(true);
    expect(WORKBOOK_ROW_CHUNK_SIZE).toBeGreaterThan(0);
    expect(WORKBOOK_ROW_CHUNK_SIZE).toBeLessThanOrEqual(10_000);
  });
});

describe("createWorkbookResultAccumulator", () => {
  it("round-trips a risk result + several BI results back to an IDENTICAL object graph", async () => {
    const risk = riskResult(12);
    const bi0 = biResult(7);
    const bi1 = biResult(0);
    // Snapshot BEFORE streaming -- the emitter deliberately releases (mutates)
    // its source arrays, so the expectation has to be captured up front.
    const expectedRisk = structuredClone(risk);
    const expectedBi0 = structuredClone(bi0);
    const expectedBi1 = structuredClone(bi1);

    const accumulator = createWorkbookResultAccumulator();

    const { rows: riskRows, ...riskShell } = risk;
    await streamRowsInChunks(riskRows, (chunk) => accumulator.acceptRiskRows(chunk), 5);

    const { rows: bi0Rows, ...bi0Shell } = bi0;
    await streamRowsInChunks(bi0Rows, (chunk) => accumulator.acceptBiRows(0, chunk), 5);

    const { rows: bi1Rows, ...bi1Shell } = bi1;
    await streamRowsInChunks(bi1Rows, (chunk) => accumulator.acceptBiRows(1, chunk), 5);

    const biShells: BiFileShell[] = [
      { fileName: "bi-a.xlsx", result: bi0Shell },
      { fileName: "bi-b.csv", result: bi1Shell }
    ];

    const finalized = accumulator.finalize({
      riskResult: riskShell as RiskWorkbookShell,
      biResults: biShells
    });

    expect(finalized.riskResult).toEqual(expectedRisk);
    expect(finalized.biResults).toEqual([
      { fileName: "bi-a.xlsx", result: expectedBi0 },
      { fileName: "bi-b.csv", result: expectedBi1 }
    ]);
  });

  it("carries a SOFT per-file BI failure through untouched (result: null + error)", async () => {
    // biFiles are optional: workbookWorker.ts:51-59 turns a per-file throw into
    // `{ result: null, error }` rather than failing the import. That shape must
    // survive the new protocol byte for byte, since applyBiFileResults keys the
    // red error row off it (usePhaseOneUploads.ts:400-411).
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "broken.xlsx", result: null, error: "ملف تالف" }]
    });

    expect(finalized.biResults).toEqual([
      { fileName: "broken.xlsx", result: null, error: "ملف تالف" }
    ]);
    expect(finalized.biResults[0].result).toBeNull();
  });

  it("does not invent an `error` key on a file that succeeded", async () => {
    const accumulator = createWorkbookResultAccumulator();
    const { rows, ...shell } = biResult(2);
    await streamRowsInChunks(rows, (chunk) => accumulator.acceptBiRows(0, chunk), 5);
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "ok.xlsx", result: shell }]
    });
    expect(Object.prototype.hasOwnProperty.call(finalized.biResults[0], "error")).toBe(false);
  });

  it("keys BI rows by fileIndex, so interleaved chunks never cross-contaminate", async () => {
    // postMessage ordering makes real interleaving impossible today, but keying
    // on fileIndex rather than arrival order is what makes that a property of
    // the code instead of a property of the transport.
    const accumulator = createWorkbookResultAccumulator();
    accumulator.acceptBiRows(1, [biRow(100)]);
    accumulator.acceptBiRows(0, [biRow(0)]);
    accumulator.acceptBiRows(1, [biRow(101)]);
    accumulator.acceptBiRows(0, [biRow(1)]);

    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [
        { fileName: "a.xlsx", result: { ...biResult(0) } },
        { fileName: "b.xlsx", result: { ...biResult(0) } }
      ]
    });

    expect(finalized.biResults[0].result?.rows.map((r) => r.xrayImageId)).toEqual(["XR-0", "XR-1"]);
    expect(finalized.biResults[1].result?.rows.map((r) => r.xrayImageId)).toEqual(["XR-100", "XR-101"]);
  });

  it("gives a BI file that sent no chunks an empty rows array, not undefined", async () => {
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "empty.xlsx", result: { ...biResult(0) } }]
    });
    expect(finalized.biResults[0].result?.rows).toEqual([]);
  });

  it("gives an empty risk stream an empty rows array, not undefined", () => {
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: []
    });
    expect(finalized.riskResult.rows).toEqual([]);
  });
});
```

Note on the fixtures: `{ ...riskResult(0) }` / `{ ...biResult(0) }` are used as shells in the narrower tests. They still carry a `rows: []` key, which `finalize`'s spread then overwrites — harmless, and it keeps those fixtures readable. The round-trip test uses a real `const { rows, ...shell }` destructure, which is what the production code does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/workers/workbookResultStream.test.ts`
Expected: FAIL — `src/workers/workbookResultStream.ts` does not exist yet (same precedent as the 2026-08-03 plan's `visitedTabs.ts` step).

- [ ] **Step 3: Create the module**

Create `src/workers/workbookResultStream.ts`:

```ts
/**
 * The chunked worker→window transfer protocol for a Population Phase-1 import.
 *
 * Why this exists: `workbookWorker.ts` used to post the ENTIRE parsed result --
 * `RiskWorkbookResult.rows` plus every BI file's rows, each row carrying its
 * full `rawRow` (riskDataNormalizer.ts:261, biDataNormalizer.ts:281) -- in one
 * `postMessage`. Structured clone has to serialize that whole graph into a
 * single contiguous allocation, so a large month failed with
 * `DataCloneError: Data cannot be cloned, out of memory` (XQ-POP-003) before a
 * single row reached the UI.
 *
 * Nothing about the DATA changes here: `createWorkbookResultAccumulator`
 * reassembles exactly the object graph the window used to receive in one
 * message, so `setRiskWorkbookResult` / `applyBiFileResults` are untouched.
 * This is purely how the bytes get across the boundary.
 *
 * NOT a step toward Phase C/D of LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22:
 * the window still ends up holding the complete population. Phase D's answer is
 * to stop returning it at all (proposal §7); if that is ever approved, this
 * module is deleted rather than extended.
 */
import type {
  BiWorkbookResult,
  NormalizedBiRow
} from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type {
  NormalizedRiskRow,
  RiskWorkbookResult
} from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { yieldToMain } from "../data/storage/yieldToMain";
import type { BiFileResult } from "./workbookWorkerTypes";

/**
 * Rows per `postMessage`. Deliberately the SMALLER of the two chunk sizes the
 * ingest pipeline already uses (riskDataWorkbook.ts:131 = 5000,
 * biDataWorkbook.ts:235 = 10000), because a normalized row is wider than a
 * source row: it carries ~30 mapped fields AND the retained `rawRow`.
 *
 * Raising this trades peak allocation for message count. Do not set it to
 * Infinity or 0 -- workbookResultStream.test.ts guards the bound, because
 * losing it silently restores the original OOM.
 */
export const WORKBOOK_ROW_CHUNK_SIZE = 5000;

/** A `RiskWorkbookResult` with the bulk rows removed -- small enough to post whole. */
export type RiskWorkbookShell = Omit<RiskWorkbookResult, "rows">;
/** A `BiWorkbookResult` with the bulk rows removed. */
export type BiWorkbookShell = Omit<BiWorkbookResult, "rows">;
/** `BiFileResult` with its result's bulk rows removed. Keeps the soft-failure shape. */
export type BiFileShell = {
  fileName: string;
  result: BiWorkbookShell | null;
  error?: string;
};

/**
 * Emit `rows` in batches, RELEASING each batch from `rows` as soon as it has
 * been handed to `emit`.
 *
 * The mutation is the point, not a side effect: batching alone still leaves the
 * worker holding the complete dataset while the window builds its own copy. By
 * clearing each emitted span, the worker's retained set shrinks as the window's
 * grows, so peak combined memory stays near one dataset instead of two or three.
 * Callers must therefore treat `rows` as CONSUMED. Every caller in this repo
 * destructures it off a result it is about to discard.
 *
 * Yields between batches so the worker's event loop can drain and GC can
 * reclaim the released rows rather than holding every batch until the end.
 */
export async function streamRowsInChunks<TRow>(
  rows: TRow[],
  emit: (chunk: TRow[]) => void,
  chunkSize: number = WORKBOOK_ROW_CHUNK_SIZE
): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, rows.length);
    emit(rows.slice(start, end));
    // `emit` is a synchronous postMessage: by the time it returns, the clone
    // exists on the transfer queue and the worker's own references are dead
    // weight. Clearing the span (rather than splicing) keeps this O(n) overall.
    rows.fill(undefined as unknown as TRow, start, end);
    await yieldToMain();
  }
}

export type WorkbookResultAccumulator = {
  acceptRiskRows(rows: NormalizedRiskRow[]): void;
  /** `fileIndex` is index-aligned with `WorkbookWorkerRequest.biFiles`. */
  acceptBiRows(fileIndex: number, rows: NormalizedBiRow[]): void;
  finalize(done: {
    riskResult: RiskWorkbookShell;
    biResults: BiFileShell[];
  }): { riskResult: RiskWorkbookResult; biResults: BiFileResult[] };
};

/**
 * Window side. Collects streamed row batches, then stitches them back into the
 * shells carried by the terminal `done` message.
 *
 * `done` is the single commit point: nothing is applied to React state until it
 * arrives, so a worker that dies mid-stream leaves this accumulator to be
 * garbage-collected with the parse run's closure and never half-applies a
 * population.
 *
 * BI batches are keyed by `fileIndex`, not by arrival order, so per-file
 * isolation is a property of this code rather than of `postMessage` ordering.
 */
export function createWorkbookResultAccumulator(): WorkbookResultAccumulator {
  const riskRows: NormalizedRiskRow[] = [];
  const biRowsByFileIndex = new Map<number, NormalizedBiRow[]>();

  return {
    acceptRiskRows(rows) {
      // A loop, never push(...rows): one BI/risk population already exceeds
      // V8's ~65k argument limit -- same reason as biDataWorkbook.ts:354-356.
      for (const row of rows) riskRows.push(row);
    },
    acceptBiRows(fileIndex, rows) {
      let target = biRowsByFileIndex.get(fileIndex);
      if (!target) {
        target = [];
        biRowsByFileIndex.set(fileIndex, target);
      }
      for (const row of rows) target.push(row);
    },
    finalize(done) {
      return {
        riskResult: { ...done.riskResult, rows: riskRows },
        // Spreading `shell` (rather than rebuilding it field by field)
        // preserves `error`'s PRESENCE as well as its value, so a successful
        // file never acquires a stray `error: undefined` key.
        biResults: done.biResults.map((shell, index) => ({
          ...shell,
          result:
            shell.result === null
              ? null
              : { ...shell.result, rows: biRowsByFileIndex.get(index) ?? [] }
        }))
      };
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/workers/workbookResultStream.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run lint + typecheck + the full suite**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. Nothing imports the new module yet, so no existing test can be affected; this step exists to catch a lint/strict-mode problem in the new file before it is wired into the worker.

- [ ] **Step 6: Generate today's edit-log entry, then commit**

```bash
npm run editlog -- --tier=2 --append --sync-package "Add (population): chunked worker result-transfer protocol module for the workbook import"
```

Write the `Why:` / `What changed:` prose plus the required Before/After snippets (Before: "no such module — `workbookWorker.ts:67` posts the entire result in one `postMessage`"; After: the `streamRowsInChunks` / `createWorkbookResultAccumulator` signatures). Expected version: **v115.3** / `package.json` `115.3.0`.

```bash
git add src/workers/workbookResultStream.ts src/workers/workbookResultStream.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (population): chunked worker result-transfer protocol module for the workbook import" -- src/workers/workbookResultStream.ts src/workers/workbookResultStream.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 2: Change the response union and make the worker stream

**Do not commit at the end of this task.** Task 3 changes the only consumer of this union; the two land as one commit. The repo will not typecheck between Task 2 and Task 3, and that is intended — the compile error *is* the mechanism that guarantees both sides move together.

**Files:**
- Modify: `src/workers/workbookWorkerTypes.ts:33-36` (the `WorkbookWorkerResponse` union)
- Modify: `src/workers/workbookWorker.ts:1-71`

**Interfaces:**
- Consumes: `streamRowsInChunks`, `RiskWorkbookShell`, `BiFileShell` from Task 1's module.
- Produces: `WorkbookWorkerResponse` gains two variants (`risk-rows`, `bi-rows`) and `done` loses its bulk payload. `WorkbookWorkerRequest` is **unchanged**. `BiFileResult` stays exported and unchanged (`multiFileBiImport.test.tsx:26` and `usePhaseOneUploads.ts:13` both depend on it).

- [ ] **Step 1: Widen the response union**

In `src/workers/workbookWorkerTypes.ts`, add the import at the top of the file, next to the two existing type-only imports:

```ts
import type { BiWorkbookResult } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
```

becomes:

```ts
import type { BiWorkbookResult, NormalizedBiRow } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type { BiFileShell, RiskWorkbookShell } from "./workbookResultStream";
```

(`BiWorkbookResult` stays imported — `BiFileResult` at `:27-31` still uses it.)

Then replace the response union (`:33-36`):

```ts
export type WorkbookWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "done"; riskResult: RiskWorkbookResult; biResults: BiFileResult[]; warning?: string }
  | { type: "error"; error: string };
```

with:

```ts
/**
 * The result is streamed, not posted whole.
 *
 * Posting `riskResult` + every `biResults[i].result` in ONE message asked
 * structured clone for a single contiguous allocation of the entire ingest
 * output -- rows plus their full `rawRow`s -- and a large month failed it with
 * `DataCloneError: Data cannot be cloned, out of memory` (XQ-POP-003).
 *
 * The sequence is now: `progress`* → `risk-rows`* → (`bi-rows`* per file)
 * → `done`. `done` is the single commit point and carries only the small
 * metadata shells; the window stitches the streamed rows back into them
 * (`createWorkbookResultAccumulator`), producing exactly the object graph a
 * single `done` used to carry. Nothing downstream of `applyBiFileResults` /
 * `setRiskWorkbookResult` can tell the difference.
 *
 * There is no `requestId` here, unlike `populationQueryWorkerTypes.ts` -- this
 * worker runs one job at a time and its listener is torn down per run, so a
 * stale chunk has no accumulator to land in.
 */
export type WorkbookWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "risk-rows"; rows: NormalizedRiskRow[] }
  /** `fileIndex` is index-aligned with `WorkbookWorkerRequest.biFiles`. */
  | { type: "bi-rows"; fileIndex: number; rows: NormalizedBiRow[] }
  | { type: "done"; riskResult: RiskWorkbookShell; biResults: BiFileShell[]; warning?: string }
  | { type: "error"; error: string };
```

- [ ] **Step 2: Make the worker stream and release**

In `src/workers/workbookWorker.ts`, change the imports (`:1-3`):

```ts
import { processBiWorkbook } from "../components/Sidebar/Tabs/Population/biData/biDataWorkbook";
import { processRiskWorkbook } from "../components/Sidebar/Tabs/Population/riskData/riskDataWorkbook";
import type { BiFileResult, WorkbookWorkerRequest, WorkbookWorkerResponse } from "./workbookWorkerTypes";
```

to:

```ts
import { processBiWorkbook } from "../components/Sidebar/Tabs/Population/biData/biDataWorkbook";
import { processRiskWorkbook } from "../components/Sidebar/Tabs/Population/riskData/riskDataWorkbook";
import { streamRowsInChunks, type BiFileShell } from "./workbookResultStream";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "./workbookWorkerTypes";
```

Then, inside `ctx.onmessage`'s `try` block, replace lines 18-30:

```ts
    const riskResult = await processRiskWorkbook(
      riskFile,
      (stage, percent) => send({ type: "progress", message: `${stage} (${percent}%)` }),
      riskSheetPatterns,
      columnMappings
    );

    // Every BI file is processed with the SAME sheet patterns and column
    // mappings — they are different populations of one BI dataset, not
    // differently-shaped sources. The main thread appends the results.
    const biResults: BiFileResult[] = [];
    const failedFileNames: string[] = [];
```

with:

```ts
    const riskResult = await processRiskWorkbook(
      riskFile,
      (stage, percent) => send({ type: "progress", message: `${stage} (${percent}%)` }),
      riskSheetPatterns,
      columnMappings
    );

    // Stream and RELEASE the risk rows here, before BI parsing allocates
    // anything, rather than holding them until the end. Two reasons: the
    // one-shot `postMessage` of the whole result is what threw
    // `DataCloneError: … out of memory` (XQ-POP-003), and streaming early means
    // the worker never holds a full risk population and a full BI population at
    // the same moment. `riskRows` is CONSUMED by streamRowsInChunks; nothing
    // below reads it, only the small `riskShell`.
    const { rows: riskRows, ...riskShell } = riskResult;
    await streamRowsInChunks(riskRows, (chunk) => send({ type: "risk-rows", rows: chunk }));

    // Every BI file is processed with the SAME sheet patterns and column
    // mappings — they are different populations of one BI dataset, not
    // differently-shaped sources. The main thread appends the results.
    const biResults: BiFileShell[] = [];
    const failedFileNames: string[] = [];
```

Next, replace the success branch of the per-file loop (`:44-50`):

```ts
        const result = await processBiWorkbook(
          biFile,
          onProgress,
          biSheetPatterns,
          biColumnMappings ?? columnMappings
        );
        biResults.push({ fileName: biFile.name, result });
```

with:

```ts
        const result = await processBiWorkbook(
          biFile,
          onProgress,
          biSheetPatterns,
          biColumnMappings ?? columnMappings
        );
        // Same as the risk side: stream this file's rows out and drop them
        // before the NEXT file is parsed, so ten attached BI files never
        // accumulate ten full row arrays in the worker.
        const { rows: biRows, ...biShell } = result;
        await streamRowsInChunks(biRows, (chunk) =>
          send({ type: "bi-rows", fileIndex: i, rows: chunk })
        );
        biResults.push({ fileName: biFile.name, result: biShell });
```

The soft-failure branch (`:51-59`) is **unchanged** — `{ fileName, result: null, error: message }` is already a valid `BiFileShell`.

Finally, replace the terminal send (`:67`):

```ts
    send({ type: "done", riskResult, biResults, warning });
```

with:

```ts
    // `done` now carries only metadata shells — the rows already went out as
    // `risk-rows`/`bi-rows`. It stays the single commit point: the window
    // applies nothing to React state until this message arrives.
    send({ type: "done", riskResult: riskShell, biResults, warning });
```

- [ ] **Step 3: Confirm the intended compile break**

Run: `npm run typecheck`
Expected: **FAIL**, and specifically in `src/components/Sidebar/Tabs/Population/index.tsx` around lines 822-823 — `msg.riskResult` is now a `RiskWorkbookShell` (no `rows`) and is not assignable to `setRiskWorkbookResult`'s `RiskWorkbookResult | null`, and `msg.biResults` (`BiFileShell[]`) is not assignable to `applyBiFileResults`' `BiFileResult[]`.

This is the "verify it fails" step for a type-level change, following the same precedent as the 2026-08-03 plan's Task 4 Step 2. If `typecheck` reports errors anywhere *other* than `index.tsx`'s `onMessage`, stop and investigate — nothing else should consume `WorkbookWorkerResponse` (verified: `index.tsx:52` is the only importer).

---

### Task 3: Accumulate the streamed chunks on the main thread

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (the import block at `:51-52`, and `onMessage` at `:816-842`)

**Interfaces:**
- Consumes: `createWorkbookResultAccumulator` from Task 1's module; the widened `WorkbookWorkerResponse` from Task 2.
- Produces: nothing new. `setRiskWorkbookResult(...)` and `applyBiFileResults(biEntries, ...)` are called with exactly the same values they receive today; `hasUnsavedSessionWorkRef`, `cleanup()`, the watchdog, and the phase logic are unchanged.

- [ ] **Step 1: Add the import**

At `src/components/Sidebar/Tabs/Population/index.tsx:51-52`:

```ts
import WorkbookWorker from "../../../../workers/workbookWorker?worker&inline";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "../../../../workers/workbookWorkerTypes";
```

becomes:

```ts
import WorkbookWorker from "../../../../workers/workbookWorker?worker&inline";
import { createWorkbookResultAccumulator } from "../../../../workers/workbookResultStream";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "../../../../workers/workbookWorkerTypes";
```

Note this is a **value** import (not `import type`) into the main-thread bundle. `workbookResultStream.ts` imports only types plus `yieldToMain`, so it pulls no `xlsx` and nothing worker-specific into the window chunk.

- [ ] **Step 2: Rewrite `onMessage` (`:816-842`)**

Replace:

```tsx
      const onMessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkbookWorkerResponse;
        if (msg.type === "progress") {
          armWatchdog();
          setProcessingMessage(msg.message);
        } else if (msg.type === "done") {
          setRiskWorkbookResult(msg.riskResult);
          applyBiFileResults(biEntries, msg.biResults);
          hasUnsavedSessionWorkRef.current = true;
          if (msg.warning) setProcessingMessage(msg.warning);
          // No longer advances the phase here — see this function's header
          // comment. Stays on Phase 1 so the raw-file summary renders.
          cleanup();
        } else {
```

with:

```tsx
      // Scoped to THIS parse run, alongside onMessage: a superseded run's
      // listener is removed by cleanup(), so its accumulator (and the rows it
      // holds) becomes garbage and a late chunk has nowhere to land. This is
      // why the protocol needs no requestId — see workbookWorkerTypes.ts.
      const accumulator = createWorkbookResultAccumulator();

      const onMessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkbookWorkerResponse;
        if (msg.type === "progress") {
          armWatchdog();
          setProcessingMessage(msg.message);
        } else if (msg.type === "risk-rows") {
          // A chunk is proof of life just as much as a progress message is, so
          // it re-arms the 180 s silence watchdog. Streaming a 400k-row month
          // can otherwise run for a while with no `progress` in between.
          armWatchdog();
          accumulator.acceptRiskRows(msg.rows);
        } else if (msg.type === "bi-rows") {
          armWatchdog();
          accumulator.acceptBiRows(msg.fileIndex, msg.rows);
        } else if (msg.type === "done") {
          // `done` carries only metadata shells now; finalize() stitches the
          // streamed rows back in and yields the SAME object graph a single
          // monolithic `done` used to carry (see workbookResultStream.ts).
          // Nothing below this line changed.
          const { riskResult, biResults } = accumulator.finalize(msg);
          setRiskWorkbookResult(riskResult);
          applyBiFileResults(biEntries, biResults);
          hasUnsavedSessionWorkRef.current = true;
          if (msg.warning) setProcessingMessage(msg.warning);
          // No longer advances the phase here — see this function's header
          // comment. Stays on Phase 1 so the raw-file summary renders.
          cleanup();
        } else {
```

The trailing `else` block (`:829-841`) is **unchanged**. With `risk-rows`/`bi-rows` handled explicitly above it, TypeScript still narrows `msg` to `{ type: "error"; error: string }` there, so `msg.error` keeps typechecking and the `XQ-POP-003` logging path is untouched.

- [ ] **Step 3: Typecheck, lint, and run the full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all green. Specifically:
- Task 2 Step 3's deliberate compile error is now resolved.
- The eight Population test files that mock `../../../../workers/workbookWorker?worker&inline` (`Population.wizard.test.tsx:17`, `Population.adhocSubTab.test.tsx:20`, `Population.browseMountPreservation.test.tsx:17`, `Population.foreignSubTabGuard.test.tsx:21`, `Population.landingSubTab.test.tsx:23`, `Population.processMountPreservation.test.tsx:19`, `Population.uploadGate.test.tsx:14`, `populationDemandGating.test.tsx:16`, `populationLoadRace.test.tsx:45`) all stub the worker class with an inert `postMessage(){}` and never construct a response message, so none of them observes the protocol at all.
- `multiFileBiImport.test.tsx` bypasses the thread boundary entirely (its own header, `:9-10`: "Only the thread boundary is skipped") and uses the unchanged `BiFileResult` type against the unchanged `applyBiFileResults`.

- [ ] **Step 4: Run the tier-3 gate sweep**

Run, in order:

```bash
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
```

Expected: all green. Watch two of them specifically:
- **`check:complexity`** runs `eslint src --max-warnings 0 --rule "complexity: [error, 60]" --rule "max-lines-per-function: [error, 1450]"`. `onMessage` grew by ~10 lines inside an already-large enclosing function in `index.tsx`. If `max-lines-per-function` trips, the fix is **not** to raise the budget — extract the four-branch dispatch into a small named helper in the same file (the accumulator itself already lives outside the component, which is what keeps this addition small).
- **`npm run build`** is the gate that matters most here: the worker is inlined via `?worker&inline` + `vite-plugin-singlefile`, and a new module imported by the worker is exactly the failure class `CLAUDE.md:30` warns a green `test:run` cannot catch.

- [ ] **Step 5: Verify in a real browser — do not skip this**

`CLAUDE.md:262` is explicit that reading the code is not evidence in this repo, and no Vitest environment can run a real `DedicatedWorker` (`populationQueryWorker.test.ts:7-11`, `Population.wizard.test.tsx:5-11`). The worker boundary this plan changes is therefore covered by **zero** automated tests by construction.

1. `npm run dev`, open in Chrome or Edge (File System Access API is required — `CLAUDE.md:73`).
2. Sign in, connect a workspace, open **Population → معالجة**, attach the real risk workbook plus at least two BI files, and press "قراءة الملفات".
3. Confirm, on the largest workbook available (the owner has ~500k-row months):
   - **no** `XQ-POP-003` in the console and no red error banner;
   - the accepted-rows count on each BI row, and the risk-file summary, match what the same files produced before this change (compare against a pre-change run or a previously saved `processing.summary.json` for the same month);
   - a BI file that legitimately fails still shows its own red row with its own message, and the other files still import — the soft-failure path (`workbookWorker.ts:51-59`) is unchanged but crosses new code;
   - Phase 2 processing and save still produce the same totals.
4. In DevTools → Console, confirm the streamed message count is sane: `performance.memory` and the Network/Performance panels are optional, but a quick `Array.from(...)`-free sanity check is that the parse completes and the wizard advances rather than hanging (a hang would mean a `done` never arrived).

Record what was actually run in the edit-log entry. If step 3 cannot be performed on genuinely large data, say so in the entry rather than implying it was.

- [ ] **Step 6: Generate the edit-log entry, then commit Tasks 2 and 3 together**

```bash
npm run editlog -- --tier=3 --bump=minor --append --sync-package "Fix (population): stream the workbook worker's result in row batches instead of one out-of-memory postMessage"
```

`--bump=minor` is required: `scripts/editlog.mjs:136` defaults tier 3 to a major bump, but this is a fix and takes a decimal per `CLAUDE.md:34`. Expected version: **v115.4** / `package.json` `115.4.0`.

The entry needs, per the tier-3 requirements:
- **Why:** the `DataCloneError` on large months, with the `workbookWorker.ts:67` monolithic `postMessage` named as the cause and the `rawRow` size contribution noted.
- **What changed:** the protocol sequence, the 5,000-row batch size and where it came from, and the release-as-you-go behavior.
- **Before/After** snippets for each of the three touched files.
- **Migration / rollback:** *no migration exists or is possible* — the protocol is ephemeral and nothing is persisted, so there is no on-disk artifact in either format and no version to detect. Rollback is a straight revert of this single commit (both sides move together by construction); Task 1's module can be left in place harmlessly or reverted with it. **Note explicitly that this does not implement Phase C or Phase D** of `LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` and that both remain owner-gated.
- **Lines:** generated, plus the whole-repo total (tier 3).

```bash
git add src/workers/workbookWorker.ts src/workers/workbookWorkerTypes.ts src/components/Sidebar/Tabs/Population/index.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Fix (population): stream the workbook worker's result in row batches instead of one out-of-memory postMessage" -- src/workers/workbookWorker.ts src/workers/workbookWorkerTypes.ts src/components/Sidebar/Tabs/Population/index.tsx "docs/edit logs/2026-08-24.md" package.json
```

Do **not** commit `dist/index.html` unless a release is being cut; `npm run build` regenerating it locally is a gate, not a deliverable of this plan.

---

## Testing summary

| Gate | When | Notes |
|---|---|---|
| `npx vitest run src/workers/workbookResultStream.test.ts` | Task 1 Steps 2 & 4 | The TDD red/green pair |
| `npm run lint` | end of every task | |
| `npm run typecheck` | Task 2 Step 3 (expected FAIL), Task 3 Step 3 (expected PASS) | The compile error is the mechanism binding the two halves together |
| `npm run test:run` | Task 1 Step 5, Task 3 Step 3 | 1970+ tests; none exercise the worker boundary |
| `check:complexity`, `check:hex-literals`, `check:vendor`, `build`, `check:bundle-size` | Task 3 Step 4 | Tier 3 sweep; `build` is the one that can actually catch a `?worker&inline` regression |
| `check:release` | after Task 3 Step 6 | Confirms `package.json` `115.4.0` ↔ the topmost `v115.4` heading |
| Real-browser large-workbook import | Task 3 Step 5 | The **only** coverage the changed boundary has |

**Known coverage gap, stated plainly:** the actual `postMessage` round trip cannot be tested in this repo's test environment. Task 1's round-trip test proves the emitter and accumulator are inverses over a real `RiskWorkbookResult`/`BiWorkbookResult` shape, and `typecheck` proves both sides speak the same union — but that the *worker* calls the emitter correctly and the *window* calls the accumulator correctly is verified only by Task 3 Step 5. Given this repo's documented history of effect-timing and state-machine bugs surviving self-review (`CLAUDE.md:233`, `:262`), get this change reviewed by someone other than its author before it is considered done.

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/workers/workbookResultStream.ts` (new), `src/workers/workbookResultStream.test.ts` (new) |
| 2 | `src/workers/workbookWorkerTypes.ts`, `src/workers/workbookWorker.ts` |
| 3 | `src/components/Sidebar/Tabs/Population/index.tsx` |

## Explicitly out of scope

- Phase C (port-partitioned storage) and Phase D (streaming whole-population consumers) of `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` — both still `Status: proposed`, both owner-gated, Phase C additionally blocked on backup coordination.
- Any change to what the window ultimately holds in memory. React still ends up with the complete `RiskWorkbookResult` and merged `BiWorkbookResult`. That is Phase D's problem, not this plan's.
- `Transferable` / columnar row encoding — see §1.2.
- Stripping or lazily computing `rawRow` on the ingest rows. `columnMappingHints.ts:37-42` (via `index.tsx:688`), `populationProcessor.ts:531`, and `populationExporter.ts:110`/`:238`/`:293`/`:319`/`:361` all read it, so dropping it would silently lose the unmapped extra columns from every export. The lazy-accessor treatment already exists one stage later (`populationTypes.ts:188-246`, B7) and is not extended here.
- Adding a `requestId` to this worker's protocol — see §1.4.
- `SAMPLING_ALGORITHM_VERSION`, `deriveCurrentDistribution`, and every report/export builder: untouched, so `CLAUDE.md:245`'s snapshot-before-changing rule adds no work to this plan.
