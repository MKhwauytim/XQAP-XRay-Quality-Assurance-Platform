# §O Backup/Restore Concurrency Implementation Plan [DONE — shipped v59.179–v59.183]

> **STATUS: ✅ DONE.** Shipped v59.179–v59.183 (commits `772334e4`, `a9cf1388`, `4c57f03f`, `507f9b42`, `90dd4242`) — `mapWithConcurrency` adopted at all 3 call sites in `backupStorage.ts`, plus a final-review fix for partial-restore detection.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §O from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — bound the currently-fully-sequential backup/restore/archive-status walks with concurrency, add two cheap interruption-detection sentinel files, and do the read-only, zero-integrity-risk `loadArchiveStatus` piece first.

**Architecture:** One new shared primitive (`mapWithConcurrency`), adopted at 3 call sites in `backupStorage.ts` in increasing order of risk: `loadArchiveStatus` (read-only) → the backup-creation walk (already-tolerant of concurrent mutation, already materializes its listing first) → the restore walk (**must** be fixed to materialize its listing first, since it currently holds a live async iterator across what would become concurrent awaits — the one genuine new hazard this plan introduces care for). Sentinel files are additive, independent of the concurrency change, and land in the same task as the restore work since they touch the same function.

**Tech Stack:** No new dependencies.

## Global Constraints

- **This is explicitly the highest-risk item in the source spec's own sequencing table** ("§O backup/restore concurrency + sentinels | highest — write path"). Every task in this plan must land with real test coverage proving the specific safety property it claims (index-addressed ordering surviving out-of-order completion; no dropped/duplicated files; sentinel files actually appearing/disappearing at the right times) — do not accept "it compiles and the existing tests still pass" as sufficient, since (per research) the existing test suite has **zero** order-sensitive assertions today and would not catch a reordering regression.
- **The new `mapWithConcurrency` primitive is additive — do not refactor the two existing hand-rolled worker-pool implementations onto it.** Research found `src/data/storage/directoryScan.ts`'s `readNamedJsonFiles` and `src/data/distribution/distributionStorage.ts`'s `writeImmutableEventBatch` already implement a very similar pattern independently. Touching either is out of scope for this plan (unrelated call sites, unrelated risk surface) — leave both exactly as they are.
- **Cross-file backup consistency remains explicitly out of scope** (per the source spec's own "Out of scope" section): an interrupted restore leaving `month.manifest.json`'s row count out of sync with `population.final.json` is a pre-existing condition this plan's sentinel files make *detectable*, not *prevented*. Do not attempt to add cross-file transactional guarantees.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 1: `mapWithConcurrency` shared primitive

**Files:**
- Create: `src/data/storage/concurrency.ts`
- Test: `src/data/storage/concurrency.test.ts`

**Interfaces:**
- Produces: `export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>` — results in the SAME order as `items` regardless of completion order; on the first rejection, stops starting new work, awaits everything already in flight, then throws the first error encountered (fail-fast-then-drain, not fail-immediately-abandoning-in-flight-work).

**Context:** This mirrors the worker-pool shape already proven in this codebase (`directoryScan.ts`'s `readNamedJsonFiles`, `distributionStorage.ts`'s `writeImmutableEventBatch`) — a shared `nextIndex` counter, `limit` concurrent "worker" loops each pulling the next index and writing into a pre-sized results array, never `Promise.all(items.map(...))` unbounded.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 10, 20, 5, 25]; // deliberately out of order
    const result = await mapWithConcurrency(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs more than `limit` callbacks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("fail-fast-then-drain: stops starting new work on first error, but awaits in-flight work before throwing", async () => {
    const started: number[] = [];
    const completed: number[] = [];
    await expect(
      mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 2, async (i) => {
        started.push(i);
        if (i === 2) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 10));
        completed.push(i);
        return i;
      })
    ).rejects.toThrow("boom");
    // With limit=2, items 0-1 start immediately; item 2 (which throws) starts
    // once one of 0/1 finishes. No item past what was already in flight when
    // the error occurred should ever start.
    expect(started.length).toBeLessThan(10);
    expect(completed.length).toBeLessThan(started.length + 1);
  });

  it("clamps limit to item count and to a minimum of 1", async () => {
    const result = await mapWithConcurrency([1, 2], 100, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
    const empty = await mapWithConcurrency([], 4, async () => 1);
    expect(empty).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/storage/concurrency.test.ts`
Expected: FAIL — `concurrency.ts` doesn't exist yet.

- [ ] **Step 3: Implement `mapWithConcurrency`**

Model this directly on `src/data/storage/directoryScan.ts`'s `readNamedJsonFiles` worker-pool shape (read that function first for the exact pattern this codebase already uses and trusts):

```ts
/**
 * Bounded-concurrency map with index-addressed, input-ordered results and
 * fail-fast-then-drain error handling: on the first rejection, no new work
 * starts, but everything already in flight is awaited before the first
 * error is thrown. Never `Promise.all(items.map(fn))` unbounded -- that
 * pattern is what this exists to replace at call sites that need a budget.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  let nextIndex = 0;
  let firstError: unknown;
  let stopped = false;

  async function worker(): Promise<void> {
    while (true) {
      if (stopped) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
        stopped = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError !== undefined) throw firstError;
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/concurrency.test.ts`
Expected: all PASS.

Then typecheck and lint:
Run: `npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/data/storage/concurrency.ts src/data/storage/concurrency.test.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Add (storage): mapWithConcurrency shared bounded-concurrency primitive"
```

---

### Task 2: `loadArchiveStatus` concurrency (read-only, do first)

**Files:**
- Modify: `src/data/backup/backupStorage.ts:1027-1093` (`loadArchiveStatus`)
- Test: `src/data/backup/backupStorage.test.ts` (extend)

**Interfaces:**
- Consumes: `mapWithConcurrency` from Task 1.

**Context:** `loadArchiveStatus` currently does a single `for (const month of months)` loop, each iteration awaiting up to 6-7 reads in series — ~84 sequential round-trips for 12 months. This is read-only with zero integrity risk (the spec's own framing: "best payoff ratio, do first"). Convert the outer loop to `mapWithConcurrency(months, 4, async (month) => {...})`, keeping the existing inner `Promise.all` over the per-month reads that don't depend on each other.

- [ ] **Step 1: Write the failing test**

Read `backupStorage.ts:1027-1093` and `backupStorage.test.ts`'s existing `loadArchiveStatus` tests first, to match the file's established fixture/mock conventions. Add a test proving order survives out-of-order completion (mirroring the concurrency primitive's own test approach, but through the real function): build a fixture with several months whose underlying reads are artificially delayed in a DELIBERATELY REVERSED order (e.g. via a controllable mock on the read function this loop calls, delaying month 1's read longer than month 3's), and assert the returned `MonthArchiveStatus[]` comes back in the same order as the input `months` array, not completion order.

- [ ] **Step 2: Run the test to verify it fails or passes vacuously**

Run: `npx vitest run src/data/backup/backupStorage.test.ts -t "order"` (or whatever name you gave the new test)
This may pass even pre-fix if the current sequential loop happens to preserve order trivially (it does, today, since it's sequential) — the point of this test is REGRESSION PROTECTION once concurrency is introduced, not proof of a current bug. Note this explicitly in your report, same as this session's established pattern for this kind of test.

- [ ] **Step 3: Convert the loop**

Replace the current `for (const month of months) { ...; statuses.push(...); }` shape with `mapWithConcurrency(months, 4, async (month) => { ... return theStatusObjectForThisMonth; })`, assigning its return value (already in input order) directly as the function's result — no manual `.push()` needed since `mapWithConcurrency` already returns an ordered array.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/backupStorage.test.ts`
Expected: all PASS, including every pre-existing `loadArchiveStatus` test unchanged.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/data/backup/backupStorage.ts src/data/backup/backupStorage.test.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (backup): parallelize loadArchiveStatus with mapWithConcurrency"
```

---

### Task 3: Backup-creation walk concurrency

**Files:**
- Modify: `src/data/backup/backupStorage.ts` (`copyAllJsonFiles:414-440`, `copyJsonTree:380-412`)
- Test: `src/data/backup/backupStorage.test.ts` (extend)

**Interfaces:**
- Consumes: `mapWithConcurrency` (Task 1).

**Context:** `copyAllJsonFiles`/`copyJsonTree` already materialize the directory listing via `collectEntries` before walking (`collectEntries:352-366`, already tolerant of `NotFoundError` mid-enumeration) — so this walk does NOT have the live-async-iterator hazard Task 4's restore walk has. It currently writes to the result arrays (`jsonFilesBackedUp`, and transitively `datasets`) via `.push()` in program order, which research confirmed is the one thing that must change: switch to index-addressed results via `mapWithConcurrency` so manifest order stays deterministic once file copies run concurrently. Budget: 8 (no locks involved, per the spec).

- [ ] **Step 1: Write the failing test**

Add a test to `backupStorage.test.ts` building a backup from a fixture with several JSON files whose copy order (via a controllable mock/delay on the underlying read or write) is deliberately reversed, asserting `jsonFilesBackedUp` in the returned manifest comes back in the same order the files were listed in, not completion order. Follow the same "may pass vacuously pre-fix, real value is regression protection" framing as Task 2 Step 2.

- [ ] **Step 2: Convert `copyJsonTree`/`copyAllJsonFiles` to build index-addressed results**

Read both functions in full first. Replace the `.push()`-based accumulation with `mapWithConcurrency(entries, 8, async (entry, index) => { ...copy this one file...; return theFileNameOrRecordForThisEntry; })`, then flatten/assign the ordered result array into `jsonFilesBackedUp` (and whatever `copyJsonTree`'s recursive-directory shape needs — if the walk recurses into subdirectories, decide whether `mapWithConcurrency` applies at each directory level independently, or whether the whole tree is flattened into one file list first and then processed with a single top-level `mapWithConcurrency` call — the spec explicitly warns against "one semaphore per directory" multiplying handle counts, so prefer flattening to one list first if the current recursive structure makes that reasonably achievable; if not, budget each recursive call's own `mapWithConcurrency` at a LOWER limit so the product across nesting depth doesn't exceed 8, and document your choice in the commit message).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/backupStorage.test.ts`
Expected: all PASS, zero manifest-shape regressions in any pre-existing test.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 4: Edit log + commit**

```bash
git add src/data/backup/backupStorage.ts src/data/backup/backupStorage.test.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (backup): parallelize the backup-creation file walk with mapWithConcurrency"
```

---

### Task 4: Restore walk concurrency + the two sentinel files

**Files:**
- Modify: `src/data/backup/backupStorage.ts` (`restoreJsonTree:442-470`, `restoreBackupSnapshot:919-951`, `createBackup:768-850` for the `backup.complete.json` marker)
- Test: `src/data/backup/backupStorage.test.ts` (extend)

**Interfaces:**
- Consumes: `mapWithConcurrency` (Task 1).
- Produces: two new files written via the existing `safeWriteJson`/text-write helpers already used elsewhere in this file — `restore.inprogress.json` (written before the restore walk starts, removed after it completes) and `backup.complete.json` (written last inside `createBackup`, after everything else).

**Context — the one genuine new hazard this plan introduces care for:** unlike the backup-creation walk (Task 3), `restoreJsonTree` currently iterates a **live async iterator** (`for await (const entry of iterable)` directly over `getDirectoryEntries(params.sourceDir)`) rather than a materialized array. Holding a live async iterator across concurrent awaits is unsafe — it must be materialized into an array FIRST (the same `collectEntries`-style pattern the backup-copy side already uses), THEN fanned out with `mapWithConcurrency`. This is a prerequisite fix, not optional. Budget: 4 (each write takes a Web Lock via `safeWriteJsonText`, keyed per `${targetDir.name}/${fileName}` — restoring distinct filenames into distinct directories means these locks essentially never contend with each other; the budget of 4 caps concurrent Web Lock acquisitions/handles, it's not there to prevent lock contention).

**Sentinel-file precedent note:** no "write-before, remove-after" sentinel idiom exists elsewhere in this codebase yet — this is a genuinely new pattern here, not a reuse of an established one (do not claim otherwise in comments/commit messages). `backup.manifest.json` is already, informally, written last today and already treated as "this backup doesn't count if missing/unreadable" by `loadBackupHistory`/`pruneAutoBackups` — `backup.complete.json` is an explicit, additional, purpose-built signal alongside that existing informal one, not a replacement for it.

- [ ] **Step 1: Write the failing tests**

Add to `backupStorage.test.ts`:
1. An order-preservation test for restore, mirroring Task 3 Step 1's approach but for `restoreBackupSnapshot`/`restoreJsonTree`.
2. A sentinel test: mock/spy the write function restore uses; assert `restore.inprogress.json` is written before any of the actual data files are restored, and removed after the restore completes successfully.
3. A sentinel test: assert that if the restore function is made to throw partway through (inject a failure into one of the mocked writes), `restore.inprogress.json` is left behind (NOT removed) — proving the detectability property the spec wants (an interrupted restore is now detectable via the sentinel's continued presence).
4. A `backup.complete.json` test: assert `createBackup` writes it, and that it's the LAST write in the sequence (check via a call-order assertion on your mocks, or by asserting its written timestamp/dependency on the rest of the manifest already being written).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/backup/backupStorage.test.ts -t "restore"` and `-t "sentinel"` / `-t "complete"` (adjust to your actual test names)
Expected: FAIL — none of this exists yet.

- [ ] **Step 3: Materialize the restore walk's listing, then convert to `mapWithConcurrency`**

In `restoreJsonTree`, replace the live `for await (const entry of iterable)` with: first collect all entries into an array (mirror `collectEntries`'s exact tolerance for `NotFoundError` mid-enumeration — read that function again and match its error-handling behavior, don't drop it), THEN call `mapWithConcurrency(entries, 4, async (entry, index) => { ...restore this one file via safeWriteJsonText...; return theRestoredFileName; })`, assigning the ordered result into `params.restored` in place of the current `.push()` accumulation.

- [ ] **Step 4: Add the `restore.inprogress.json` sentinel**

In `restoreBackupSnapshot` (`919-951`), before the restore walk begins: write `restore.inprogress.json` (pick a sensible location — likely the same directory the restore is targeting, or a workspace-root `5-system/` location if that's this codebase's convention for operational state files; check `workspaceDefaults.ts`/`workspacePaths.ts` for where similar operational markers belong) using the existing write helper this file already uses elsewhere (`safeWriteJson` or `writeTextFile`, whichever fits the sentinel's content shape — a minimal `{ startedAt, startedBy }`-style payload is sufficient, doesn't need a full `JsonEnvelope` wrap unless the existing write helper requires one). After the restore walk completes successfully, remove it. If the restore walk throws, do NOT remove it in a `finally` — the whole point is that it survives an interrupted restore so a later check can detect the interruption; only remove it on the success path.

- [ ] **Step 5: Add the `backup.complete.json` marker**

In `createBackup` (`768-850`), after every other write in the function (the JSON copy walk, the optional xlsx export, and `backup.manifest.json` itself) has completed successfully, write `backup.complete.json` as the final write of the function — same directory as `backup.manifest.json`, same write helper convention.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/backupStorage.test.ts`
Expected: all PASS.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 7: Edit log + commit**

```bash
git add src/data/backup/backupStorage.ts src/data/backup/backupStorage.test.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (backup): parallelize restore walk + add restore/backup completion sentinel files"
```

---

## Task Order

Task 1 must land first (everything else consumes `mapWithConcurrency`). Tasks 2, 3, and 4 all modify the same file (`backupStorage.ts`), in different functions but the same shared file — **run Tasks 2, 3, and 4 strictly sequentially, in that order, never in parallel**, to avoid a repeat of this session's earlier demonstrated git-index-collision risk when two implementers edit the same file concurrently. This is the highest-risk plan in this batch (write path) — sequential, one-at-a-time execution with a task review after each is the right tradeoff here even though it's slower than parallel dispatch.
