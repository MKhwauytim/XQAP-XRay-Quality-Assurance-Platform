# Edit-log draft — population-workbook-oom plan (2026-08-24)

> Standalone draft, NOT inserted into `docs/edit logs/2026-08-24.md` and NOT
> synced to `package.json` by this session, per explicit shared-worktree
> coordination (5 concurrent agents editing this worktree; the coordinator is
> merging all drafts and bumping the version once every agent is done, to
> avoid write contention on the shared edit-log file and `package.json`).
>
> Per the plan (`docs/superpowers/plans/2026-08-24-population-workbook-oom-plan.md`,
> "Global Constraints" / "Why tier 3"): this is **tier 3**, and both entries
> below take a **decimal (minor) bump**, not major — the plan is explicit that
> `scripts/editlog.mjs --tier=3` defaults to a major bump and that must be
> overridden with `--bump=minor` when this is folded into the real log:
>
> ```bash
> npm run editlog -- --tier=3 --bump=minor --append --sync-package "Fix (population): stream the workbook worker's result in row batches instead of one out-of-memory postMessage"
> ```
>
> The plan's own expected version sequence (against the `package.json`
> baseline it was written against, `115.2.0`) was Task 1 → v115.3, Tasks 2+3 →
> v115.4. By the time this session actually landed its commits, concurrent
> sessions had already bumped `package.json` well past that (observed as high
> as `117.7.0` mid-session) — so **whoever folds this in should chain off
> whatever `package.json`/`docs/edit logs/2026-08-24.md`'s topmost heading
> actually is at merge time**, not off `115.2.0`/`v115.3`/`v115.4` literally.
> Two consecutive decimal bumps are still correct: one for the Task 1 module
> (additive, its own commit), one for the Task 2+3 fix (its own commit).

Two commits landed on `claude/adoring-brahmagupta-c855fa`:

- `4e3531f5` — Add (population): chunked worker result-transfer protocol module for the workbook import (Task 1)
- `6de510a5` — Fix (population): stream the workbook worker's result in row batches instead of one out-of-memory postMessage (Tasks 2+3, one commit per the plan's explicit requirement)

---

## Entry 1 — Add (population): chunked worker result-transfer protocol module for the workbook import

**Version:** next minor decimal after whatever `package.json` is at merge time (plan's own baseline: v115.3)
**Date:** 2026-08-24
**Category:** Add (population)

**Why:** `workbookWorker.ts` posts the entire Population Phase-1 import result — every risk row plus every BI file's rows, each carrying its full `rawRow` (the complete original spreadsheet row) — in a single `postMessage`. Structured clone has to serialize that whole object graph into one contiguous allocation, and on a large month (the owner has ~500k-row months) this throws `DataCloneError: Data cannot be cloned, out of memory` (`XQ-POP-003`) before a single row ever reaches the UI. This module is the shared chunk protocol both sides of the worker boundary use to fix that; it is additive and unused until Task 2/3 wire it in, so it is independently committable and independently revertable.

**What changed:** New `src/workers/workbookResultStream.ts`, exporting:
- `WORKBOOK_ROW_CHUNK_SIZE = 5000` — the smaller of the two chunk sizes the ingest pipeline already uses (`riskDataWorkbook.ts` normalizes in 5000-row chunks, `biDataWorkbook.ts` in 10000), chosen conservatively because a normalized row is wider than a source row (mapped fields *plus* the retained `rawRow`).
- `RiskWorkbookShell` / `BiWorkbookShell` / `BiFileShell` — the existing result types with `rows` removed, small enough to post whole.
- `streamRowsInChunks<TRow>(rows, emit, chunkSize?)` — worker-side: emits `rows` in batches via `emit`, then **releases** (`Array.prototype.fill(undefined, ...)`) each emitted span from the source array immediately, and yields to the event loop between batches (`yieldToMain()`) so GC can reclaim released rows. The release is deliberate, not incidental: batching alone still leaves the worker holding the full dataset while the window builds its own copy; releasing as it streams keeps peak combined memory near one dataset instead of two or three.
- `createWorkbookResultAccumulator()` — window-side: `acceptRiskRows`, `acceptBiRows(fileIndex, rows)` (keyed by `fileIndex`, not arrival order, so per-file isolation is a property of the code rather than of `postMessage` ordering), and `finalize(done)`, which stitches the accumulated rows back into the shells carried by the terminal `done` message, reproducing byte-for-byte the object graph a single monolithic `done` used to carry.

New `src/workers/workbookResultStream.test.ts` — round-trip tests using real `NormalizedRiskRow`/`NormalizedBiRow`/`RiskWorkbookResult`/`BiWorkbookResult` fixtures (with `rawRow` populated, since that's the field that dominates payload size): chunk-boundary correctness, same-reference passthrough (never a per-row copy), the release contract (incremental, not a single wipe at the end), the `WORKBOOK_ROW_CHUNK_SIZE` default and its sanity bound, full round-trip identity against `structuredClone`'d fixtures, soft per-file BI failure passthrough (`result: null` + `error`), no stray `error` key invented on success, `fileIndex` keying under interleaved arrival, and empty-stream edge cases.

**Before:** no such module — `workbookWorker.ts:67` posted the entire result (`riskResult` with full `rows`, `biResults[i].result` with full `rows`) in one `send({ type: "done", riskResult, biResults, warning })`.

**After:**
```ts
export const WORKBOOK_ROW_CHUNK_SIZE = 5000;
export type RiskWorkbookShell = Omit<RiskWorkbookResult, "rows">;
export type BiWorkbookShell = Omit<BiWorkbookResult, "rows">;
export type BiFileShell = { fileName: string; result: BiWorkbookShell | null; error?: string };

export async function streamRowsInChunks<TRow>(
  rows: TRow[],
  emit: (chunk: TRow[]) => void,
  chunkSize: number = WORKBOOK_ROW_CHUNK_SIZE
): Promise<void> { /* emits + releases + yields per chunk */ }

export function createWorkbookResultAccumulator(): WorkbookResultAccumulator {
  /* acceptRiskRows / acceptBiRows(fileIndex, rows) / finalize(done) */
}
```

**File:** `src/workers/workbookResultStream.ts`
**File:** `src/workers/workbookResultStream.test.ts`
**Lines:** +408 (generated by `git diff --stat` at commit `4e3531f5`; whole-repo total not computed by this session — see note on gates below)

---

## Entry 2 — Fix (population): stream the workbook worker's result in row batches instead of one out-of-memory postMessage

**Version:** next minor decimal after Entry 1 (plan's own baseline: v115.4)
**Date:** 2026-08-24
**Category:** Fix (population)

**Why:** Same root cause as Entry 1 — the one-shot `postMessage` of the entire Phase-1 import result OOMs structured clone on large months (`XQ-POP-003`). Entry 1 built the chunk protocol; this entry wires it into the worker and the window so the crash actually stops.

**What changed:**
- `src/workers/workbookWorkerTypes.ts` — `WorkbookWorkerResponse` gains two streaming variants: `{ type: "risk-rows"; rows: NormalizedRiskRow[] }` and `{ type: "bi-rows"; fileIndex: number; rows: NormalizedBiRow[] }` (`fileIndex` index-aligned with `WorkbookWorkerRequest.biFiles`). `done` now carries `riskResult: RiskWorkbookShell` and `biResults: BiFileShell[]` instead of the full types. `WorkbookWorkerRequest` and the exported `BiFileResult` type are unchanged (both are depended on elsewhere — `multiFileBiImport.test.tsx` and `usePhaseOneUploads.ts` — and the plan required they stay untouched). No `requestId` was added: this worker handles one job at a time and its listener is torn down per run (`cleanup()` in `index.tsx`), so a stale/superseded chunk has no accumulator left to land in — ordering is also guaranteed by `postMessage`'s single-port in-order delivery.
- `src/workers/workbookWorker.ts` — streams and releases the risk rows via `streamRowsInChunks` immediately after risk parsing, *before* BI parsing starts (so the worker never holds a full risk population and a full BI population at the same moment); streams and releases each BI file's rows immediately after that file parses (so ten attached BI files never accumulate ten full row arrays at once); the terminal `send` now posts `riskResult: riskShell` instead of the full result. The soft-failure branch for a BI file that throws (`{ fileName, result: null, error }`) is unchanged — it's already a valid `BiFileShell`.
- `src/components/Sidebar/Tabs/Population/index.tsx` — imports `createWorkbookResultAccumulator`; a fresh accumulator is created per parse run (scoped inside the same closure as `onMessage`, so it's garbage-collected with a superseded run). `onMessage` gains `risk-rows`/`bi-rows` branches that feed the accumulator and re-arm the 180s silence watchdog (a chunk is proof of life just like a `progress` message — a 400k-row month can stream for a while between `progress` messages otherwise). The `done` branch now calls `accumulator.finalize(msg)` to reconstruct the full `riskResult`/`biResults` before calling `setRiskWorkbookResult` / `applyBiFileResults` — the values passed to those two functions are identical to what they received before this change.

**Before** (`workbookWorker.ts:67`):
```ts
send({ type: "done", riskResult, biResults, warning });
```
where `riskResult.rows` and every `biResults[i].result.rows` were fully populated.

**After:**
```ts
const { rows: riskRows, ...riskShell } = riskResult;
await streamRowsInChunks(riskRows, (chunk) => send({ type: "risk-rows", rows: chunk }));
// ...per BI file...
const { rows: biRows, ...biShell } = result;
await streamRowsInChunks(biRows, (chunk) => send({ type: "bi-rows", fileIndex: i, rows: chunk }));
biResults.push({ fileName: biFile.name, result: biShell });
// ...
send({ type: "done", riskResult: riskShell, biResults, warning });
```

**Before** (`index.tsx` `onMessage`, `done` branch only):
```ts
} else if (msg.type === "done") {
  setRiskWorkbookResult(msg.riskResult);
  applyBiFileResults(biEntries, msg.biResults);
  ...
```
**After:**
```ts
const accumulator = createWorkbookResultAccumulator();
// ...
} else if (msg.type === "risk-rows") {
  armWatchdog();
  accumulator.acceptRiskRows(msg.rows);
} else if (msg.type === "bi-rows") {
  armWatchdog();
  accumulator.acceptBiRows(msg.fileIndex, msg.rows);
} else if (msg.type === "done") {
  const { riskResult, biResults } = accumulator.finalize(msg);
  setRiskWorkbookResult(riskResult);
  applyBiFileResults(biEntries, biResults);
  ...
```

**Deviation from the plan's literal snippet:** the plan's Task 2 Step 1 snippet imports both `NormalizedRiskRow` *and* `RiskWorkbookResult` into `workbookWorkerTypes.ts`. Once `done`'s `riskResult` field switched to `RiskWorkbookShell`, `RiskWorkbookResult` became genuinely unused in that file (`tsc` `TS6133`), so it was dropped from the import. This is the only code deviation from the plan; everything else (chunk size, streaming order, accumulator shape, watchdog re-arming, no `requestId`) matches the plan exactly.

**Migration/rollback:** no migration exists or is possible — this is a worker↔window wire protocol internal to one browser tab's lifetime; nothing persisted to disk changes format, and no on-disk artifact carries a version to detect. Rollback is a straight revert of commit `6de510a5` (and, if desired, `4e3531f5`); both sides of the union move together by construction since they landed in one commit per the plan's explicit requirement. This does **not** implement Phase C (port-partitioned storage) or Phase D (streaming whole-population consumers) of `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` — React still ends up holding the complete `RiskWorkbookResult`/merged `BiWorkbookResult` in memory after this fix; only the *transfer itself* no longer requires one contiguous serialization. Both phases remain `Status: proposed` and owner-gated, exactly as scoped out in the plan's §0 and "Explicitly out of scope."

**File:** `src/workers/workbookWorkerTypes.ts`
**File:** `src/workers/workbookWorker.ts`
**File:** `src/components/Sidebar/Tabs/Population/index.tsx`
**Lines:** +74 / −9 (generated by `git diff --stat` at commit `6de510a5`; whole-repo total not computed by this session — see note below)

---

## Gates actually run, and why they're scoped

This worktree had **4-5 other agents editing concurrently** for the duration of this session (confirmed via `git log`, which shows `package.json` advancing from `115.2.0` to `117.7.0`+ purely from other sessions' commits while this plan was being implemented, and via untracked files/plan docs for at least five other in-flight plans: adhoc-import-styling-consistency, datatable-sort-filter-consistency, error-log-subsystem, feedback-per-thread-redesign, xray-referrals-refresh-and-resize). A whole-repo `npm run test:run` / `npm run typecheck` / `npm run lint` run during this session showed failures, but **none in a file this plan touches or added** — they were all in files owned by those other in-flight sessions (`Reports/index.test.tsx`, `data/reporting/*`, `data/errorLog/*`, `data/feedback/*`, `XrayReferrals.saveBroadcast.test.tsx`, `QueueSplitResizer.test.tsx`, `Settings/ErrorLogSection.tsx`) or an infra-level Vitest/font-loading resource error unrelated to any source change. Per explicit instruction from the session coordinator, gates were run **scoped to this plan's files** instead of chasing the whole-repo sweep other agents' in-progress work was still turning red:

- `npx vitest run src/workers/workbookResultStream.test.ts "src/components/Sidebar/Tabs/Population"` → **54 test files / 440 tests, all green.** This includes the 9 Population test files that mock `../../../../workers/workbookWorker?worker&inline` with an inert `postMessage(){}` (per the plan's own prediction, none of them observe the new protocol) plus `multiFileBiImport.test.tsx` (bypasses the thread boundary, unaffected by the response-union change).
- `npx eslint src/workers/workbookWorker.ts src/workers/workbookWorkerTypes.ts src/workers/workbookResultStream.ts src/workers/workbookResultStream.test.ts src/components/Sidebar/Tabs/Population/index.tsx --max-warnings 0` → **clean.**
- `npm run typecheck` (`tsc -b`, whole-repo — no way to scope this one) → zero errors in any of the 5 files this plan touches or added; the errors present were all in the other sessions' in-flight files listed above.
- `npm run build`, `check:complexity`, `check:hex-literals`, `check:vendor`, `check:bundle-size`, `check:release` — **not run** by this session. `build` runs the same whole-repo `tsc -b` as `typecheck` and would show the same unrelated failures until the other sessions finish; the tier-3 checks depend on a clean build. Whoever folds this draft in should run the full tier-3 sweep once the worktree is quiet (all concurrent sessions landed/merged), per the plan's own Task 3 Step 4.

**Known coverage gap** (same as the plan states): the actual `postMessage` round trip across a real `DedicatedWorker` cannot be exercised by Vitest in this repo. `workbookResultStream.test.ts` proves the emitter/accumulator are inverses over real row shapes; `tsc` proves both sides of the union agree. That the *worker* calls the emitter correctly and the *window* calls the accumulator correctly in a real browser is unverified by automated tests by construction.

## Real-browser verification — partial, honestly reported

Per the plan's Task 3 Step 5, this needed real-browser verification with a large (~500k-row) workbook import. What was actually done:

- Started the app via the project's dev-server preview tooling (`.claude/launch.json`'s `x-ray-app` config, `npm run dev`, auto-assigned port since 5173 was already taken by another concurrent session's dev server).
- Confirmed the app **built and served successfully** with this change in place — the login/workspace-picker screen (`اختر مساحة العمل`) rendered correctly, in Arabic/RTL as expected.
- Checked browser console and dev-server logs: **zero errors**, including none related to the worker (`?worker&inline` import resolved fine, no module-eval-time failure — the specific failure class `CLAUDE.md` warns a green `test:run` can miss).

**What was NOT done, and why:** the app requires connecting a real workspace folder via `showDirectoryPicker()` — a native OS file-chooser dialog outside the page's DOM, which this session's browser-automation tools cannot drive (this is a standard File System Access API automation limitation, not specific to this environment). Even past that, exercising the actual OOM fix needs a genuinely large risk/BI workbook (the owner's ~500k-row months); this session has no such dataset and generating a synthetic one large enough to have reproduced the original crash was judged not worth the extra time/resource load on an already very active shared worktree (this session was rate-limited once already during the run). So: **the specific claim "no XQ-POP-003 on a large real import" is NOT verified by this session.** The plan's own text anticipates exactly this outcome ("If you cannot access a browser in your environment, say so explicitly... If step 3 cannot be performed on genuinely large data, say so in the entry rather than implying it was") — browser access existed, but the large-data step specifically did not happen. This should be treated as the plan's Task 3 Step 5 still outstanding, and per the plan's own "Testing summary" table, this is the *only* coverage the changed worker boundary has — get someone with real large data (or CDP-level file-chooser automation) to run it before this is considered fully done.
