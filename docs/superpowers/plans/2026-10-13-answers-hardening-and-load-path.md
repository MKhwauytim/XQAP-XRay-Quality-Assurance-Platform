# Answers save hardening + employee load-path speedups — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make answer saves land on a flaky SMB share without spawning new segment files or false "antivirus" verdicts, unblock the pending-answer replay that five unreadable segments have frozen, and cut the employee month load to the files that employee needs.

**Architecture:** Two PRs, no on-disk format change. PR 1 (Tasks 1–5) edits the generic append-only log's retry/rotate policy, the NotFound cause probe, and the directory scan's handling of persistently unopenable segments. PR 2 (Tasks 6–11) scopes the employee views' reads: month-scoped ad-hoc probe, own-user request scan, one-pass distribution listing, read-side cache persistence behind a flag, and a mirror fast path for the Results view. Plan 2 (layout v2 / migration / compaction, spec §4–7) follows after this lands.

**Tech Stack:** TypeScript strict, React 19, Vitest (`node` default env; `/* @vitest-environment jsdom */` for components), `createMemoryDirectory()` for disk tests.

**Spec:** `docs/superpowers/specs/2026-10-13-answers-compaction-and-load-path-design.md` (sections 8 and 9 are what this plan implements)

**Field context:** Workspace has three months (Sep, Oct, Jan). Sep/Oct load fine; Jan is the one with ~2,000 `answers.events/*.ndjson` segments and the slow load/save. The «المتابعة اليومية» tab was checked and ruled out (one small `month deadlines` file, in-memory otherwise).

## Global Constraints

- Node `>=22 <23`. Commands: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npx vitest run <file>`, `npm run build`.
- Every PR gets an edit-log entry via `npm run editlog -- --tier=2 --append --sync-package "<Category> (<scope>): …"` **after** the code is in; prose by hand, `Why:` + `What changed:` + Before/After snippets. Version bumps: PR 1 → `153.24.0`, PR 2 → `153.25.0`.
- `npm run build` before pushing any branch, every tier.
- UI strings are Arabic label keys in `src/data/labels/labelsStore.ts` — this plan adds none.
- Never hard-code workspace folder names; resolve through `workspacePaths.ts`.
- Deterministic-by-contract modules (sampling, distribution fold, report builders) are **not** touched. If a task finds it must, stop and re-plan.
- Fold order `(eventAt, authority, eventId)`, `AnswerEvent`, `ItemAnswer` unchanged.
- `A6a` ("a read never writes") stays the default; Task 9 adds an opt-in flag only.
- No bare `git stash`. Commit WIP instead.
- Repo hooks (GateGuard) ask for facts before the first Bash/Write of a session: answer them, then retry the same call.

## Review Focus

1. **A blocked replace that eventually succeeds on the same name (Task 1):** three `InvalidStateError`s at `close` then success must leave ONE segment, not two. Test in Task 1.
2. **A probe name that vanishes once but a sibling name survives (Task 2):** verdict must be `unknown`, never `extension-blocked`. Test in Task 2.
3. **Strict reads with other writers' dead segments present (Task 3):** `loadAllEmployeeFiles({strict:true})` — the pending replay's read — must succeed once the dead names are confirmed, and still throw before that. Test in Task 3.
4. **Employee with no ad-hoc assignment in the selected month but one in another month (Task 6):** the ad-hoc probe must receive the month. Test in Task 6.
5. **Employee whose own `{user}.requests.json` is absent but legacy `{user}.answers.json` exists (Task 7):** scoped read falls back to legacy exactly like the all-user scan. Test in Task 7.

---

## PR 1 — Save-path hardening

### Task 1: Extend the blocked-replace ladder and tag the rotation reason

**Files:**
- Modify: `src/data/storage/appendOnlyEventLog.ts:911` (`SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS`), `:1057-1075` (`logBlockedSegmentReplace`)
- Test: `src/data/storage/appendOnlyEventLog.blockedReplace.test.ts` (create)

**Interfaces:**
- Consumes: `appendEventSegment<TEvent>(parentDir, events, writer, config, options)` from `appendOnlyEventLog.ts`; `buildAnswerEventLogConfig(nowMs)` from `src/data/answers/answerEventStore.ts`; `createDeadline(ms, label)` from `src/data/storage/operationDeadline.ts`; `createMemoryDirectory(name, opts?)` from `src/data/storage/memoryDirectory.ts`.
- Produces: `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` becomes exported. Rotation log line ends with ` rotationReason=blocked-replace`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/storage/appendOnlyEventLog.blockedReplace.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { appendEventSegment, SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS } from "./appendOnlyEventLog";
import { buildAnswerEventLogConfig } from "../answers/answerEventStore";
import { createDeadline } from "./operationDeadline";

type Ev = { eventId: string; eventAt: string };
// Copy the exact SegmentWriterIdentity shape from appendOnlyEventLog.ts (deviceId, sessionId, stable).
const writer = { deviceId: "dev00001", sessionId: "sess0001", stable: true } as const;
const config = buildAnswerEventLogConfig(0);

/** Directory whose first `failures` close() calls throw InvalidStateError, then succeed. */
function withFlakyClose(dir: DirectoryHandleLike, failures: number): DirectoryHandleLike {
  let remaining = failures;
  const wrapDir = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(target, prop, recv) {
        if (prop === "getDirectoryHandle") {
          return async (name: string, opts?: { create?: boolean }) => wrapDir(await target.getDirectoryHandle(name, opts));
        }
        if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
        return async (name: string, opts?: { create?: boolean }) => {
          const handle = await target.getFileHandle(name, opts);
          if (!handle.createWritable) return handle;
          const origCw = handle.createWritable.bind(handle);
          const wrapped: FileHandleLike = {
            ...handle,
            getFile: handle.getFile.bind(handle),
            createWritable: async () => {
              const w = await origCw();
              return {
                write: w.write.bind(w),
                close: async () => {
                  if (remaining > 0) {
                    remaining -= 1;
                    const err = new Error("stale state");
                    err.name = "InvalidStateError";
                    throw err;
                  }
                  return w.close();
                },
              };
            },
          };
          return wrapped;
        };
      },
    });
  return wrapDir(dir);
}

async function segmentNames(dir: DirectoryHandleLike): Promise<string[]> {
  const events = await dir.getDirectoryHandle(config.eventsDirName, { create: false });
  const names: string[] = [];
  for await (const e of events.values!()) if (e.kind === "file" && e.name.endsWith(".ndjson")) names.push(e.name);
  return names.sort();
}

describe("blocked replace: retry the same segment before rotating", () => {
  it("ladder has >= 4 rungs totalling >= 4 s", () => {
    expect(SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(4);
    expect(SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4000);
  });

  it("three InvalidStateErrors at close then success → ONE segment, no rotation", async () => {
    const root = createMemoryDirectory("blocked") as unknown as DirectoryHandleLike;
    await appendEventSegment<Ev>(root, [{ eventId: "a", eventAt: "2026-10-13T00:00:00.000Z" }], writer, config, {});
    const flaky = withFlakyClose(root, 3);
    await appendEventSegment<Ev>(flaky, [{ eventId: "b", eventAt: "2026-10-13T00:00:01.000Z" }], writer, config, {
      deadline: createDeadline(30_000, "test"),
    });
    expect(await segmentNames(root)).toHaveLength(1);
  }, 20_000);
});
```
If `FileHandleLike`/`WritableLike` in `fileSystemAccess.ts` have more required members than shown, add them to the wrapper by delegating to the original handle.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/storage/appendOnlyEventLog.blockedReplace.test.ts`
Expected: FAIL — `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` not exported; second test sees 2 segments.

- [ ] **Step 3: Implement**

`appendOnlyEventLog.ts:911` →
```ts
export const SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS = [20, 200, 1000, 3000] as const;
```
Add to the doc comment above it (keep the existing production-evidence paragraph):
```
 * 2026-10-13: widened from [20]. Field logs from a workspace on an SMB share
 * showed ~70 rotations in two days, each after a single 20 ms retry, while the
 * same share accepted the replace a few hundred ms later. Rotation stays the
 * last resort (the one-rotation bound in appendEventSegment is unchanged); it
 * just no longer fires on the first hiccup. ~4.2 s worst case per append, well
 * inside INTERACTIVE_WRITE_DEADLINE_MS (30 s).
```
In `logBlockedSegmentReplace`, extend `message` with `` ` rotationReason=blocked-replace` `` at the end of the template.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/storage/appendOnlyEventLog.blockedReplace.test.ts` → PASS (2).

- [ ] **Step 5: Regression run**

Run: `npx vitest run src/data/storage/appendOnlyEventLog src/data/answers/answerSaveRetryCost.test.ts src/data/answers/answerStorage.ladderDwell.test.ts`
Expected: PASS. If a test asserts rotation after exactly one 20 ms retry, update it to import the constant and expect rotation only after `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.length` failures; mention in the edit log.

- [ ] **Step 6: Commit**

```bash
git add src/data/storage/appendOnlyEventLog.ts src/data/storage/appendOnlyEventLog.blockedReplace.test.ts
git commit -m "Fix (storage): retry a refused segment replace ~4 s before rotating; tag rotation reason"
```

---

### Task 2: `extension-blocked` requires two distinct probe names to vanish

**Files:**
- Modify: `src/data/storage/transientFileErrors.ts:475-483`
- Test: `src/data/storage/transientFileErrors.extensionProbe.test.ts` (create)

**Interfaces:**
- Consumes: `classifyNotFound(dir, fileName?)` → `NotFoundCause`.
- Produces: same signature. `extension-blocked` only when probe names `.fs-extension-probe-a{ext}` AND `.fs-extension-probe-b{ext}` both fail `probeRoundTrip(..., PROBE_SURVIVAL_WAIT_MS)`. One failure → `"unknown"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/storage/transientFileErrors.extensionProbe.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { classifyNotFound } from "./transientFileErrors";

/** Files whose name satisfies `vanish` disappear right after close(). */
function withVanishing(dir: DirectoryHandleLike, vanish: (name: string) => boolean): DirectoryHandleLike {
  return new Proxy(dir, {
    get(target, prop, recv) {
      if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
      return async (name: string, opts?: { create?: boolean }) => {
        const handle = await target.getFileHandle(name, opts);
        if (!vanish(name) || !handle.createWritable) return handle;
        const origCw = handle.createWritable.bind(handle);
        return {
          ...handle,
          getFile: handle.getFile.bind(handle),
          createWritable: async () => {
            const w = await origCw();
            return {
              write: w.write.bind(w),
              close: async () => {
                await w.close();
                await target.removeEntry?.(name);
              },
            };
          },
        };
      };
    },
  });
}

describe("classifyNotFound: extension verdict needs two names", () => {
  it("one vanishing probe name, sibling survives → 'unknown'", async () => {
    const root = createMemoryDirectory("probe1") as unknown as DirectoryHandleLike;
    const dir = withVanishing(root, (n) => n === ".fs-extension-probe-a.ndjson");
    expect(await classifyNotFound(dir, "x-ans-dev-sess.ndjson")).toBe("unknown");
  }, 15_000);

  it("both probe names vanish → 'extension-blocked'", async () => {
    const root = createMemoryDirectory("probe2") as unknown as DirectoryHandleLike;
    const dir = withVanishing(root, (n) => n.startsWith(".fs-extension-probe") && n.endsWith(".ndjson"));
    expect(await classifyNotFound(dir, "x-ans-dev-sess.ndjson")).toBe("extension-blocked");
  }, 15_000);

  it("nothing vanishes → not extension-blocked", async () => {
    const root = createMemoryDirectory("probe3") as unknown as DirectoryHandleLike;
    expect(await classifyNotFound(root, "x-ans-dev-sess.ndjson")).not.toBe("extension-blocked");
  }, 15_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/storage/transientFileErrors.extensionProbe.test.ts`
Expected: test 1 FAILS (today a single `.fs-extension-probe.ndjson` is probed, so it returns `extension-blocked`).

- [ ] **Step 3: Implement**

Replace `transientFileErrors.ts:475-483` with:
```ts
  const extension = fileName ? extensionOf(fileName) : "";
  if (extension && extension !== ".tmp") {
    // Two DISTINCT names, in sequence. A remover that targets the extension
    // takes both; a stale listing or a momentary NotReadable on one name does
    // not repeat on a different name. One flake used to produce a permanent
    // XQ-IO-033 ("antivirus is removing .ndjson") on a share that creates and
    // keeps .ndjson files fine — confirmed by hand on 2026-10-13.
    const firstSurvived = await probeRoundTrip(dir, `.fs-extension-probe-a${extension}`, PROBE_SURVIVAL_WAIT_MS);
    if (!firstSurvived) {
      const secondSurvived = await probeRoundTrip(dir, `.fs-extension-probe-b${extension}`, PROBE_SURVIVAL_WAIT_MS);
      return secondSurvived ? "unknown" : "extension-blocked";
    }
  }
```

- [ ] **Step 4: Run** → PASS (3).

- [ ] **Step 5: Suite** `npx vitest run src/data/storage/transientFileErrors` → PASS; fix any test naming the old probe file.

- [ ] **Step 6: Commit**

```bash
git add src/data/storage/transientFileErrors.ts src/data/storage/transientFileErrors.extensionProbe.test.ts
git commit -m "Fix (storage): extension-blocked verdict needs two distinct probe names to vanish"
```

---

### Task 3: Dead-segment registry — stop re-probing and stop blocking strict reads

**Files:**
- Create: `src/data/storage/deadSegmentRegistry.ts`
- Modify: `src/data/storage/directoryScan.ts` — `readSegmentTails` (opens entries via `readListedEntry`; skip log at `:452-460`)
- Modify: `src/data/storage/appendOnlyEventLog.ts:1623-1642` (`readEventSegmentDelta`)
- Modify: `src/data/workspace/workspaceSync.ts` — the `manual: true` purge branch
- Test: `src/data/storage/deadSegmentRegistry.test.ts`, `src/data/answers/answerStorage.deadSegments.test.ts` (both create)

**Interfaces:**
- Produces (`deadSegmentRegistry.ts`):
  ```ts
  export const DEAD_SEGMENT_MIN_SCANS = 3;
  export const DEAD_SEGMENT_MIN_AGE_MS = 5 * 60_000;
  export function recordUnopenableSegment(scopeKey: string, name: string, nowMs?: number): void;
  export function recordOpenableSegment(scopeKey: string, name: string): void;
  export function isConfirmedDead(scopeKey: string, name: string, nowMs?: number): boolean;
  export function confirmedDeadNames(scopeKey: string, nowMs?: number): Set<string>;
  export function markDeadLoggedOnce(scopeKey: string, name: string): boolean;
  export function clearDeadSegmentRegistry(scopeKey?: string): void;
  ```
  `scopeKey` = the `scopeKey` option `readSegmentTails` already receives (`directoryResourceKey(parentDir, eventsDirName)`).
- `readSegmentTails` return type gains `deadNames: Set<string>`; `SegmentEventsDelta` gains `unreadableNames: string[]`.

- [ ] **Step 1: Write the failing registry test**

```ts
// src/data/storage/deadSegmentRegistry.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEAD_SEGMENT_MIN_AGE_MS, DEAD_SEGMENT_MIN_SCANS, clearDeadSegmentRegistry, confirmedDeadNames,
  isConfirmedDead, markDeadLoggedOnce, recordOpenableSegment, recordUnopenableSegment,
} from "./deadSegmentRegistry";

describe("deadSegmentRegistry", () => {
  beforeEach(() => clearDeadSegmentRegistry());

  it("one failed open is not dead", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    expect(isConfirmedDead("k", "a.ndjson", 0)).toBe(false);
  });

  it("MIN_SCANS failures inside MIN_AGE are still not dead", () => {
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) recordUnopenableSegment("k", "a.ndjson", i * 1000);
    expect(isConfirmedDead("k", "a.ndjson", DEAD_SEGMENT_MIN_SCANS * 1000)).toBe(false);
  });

  it("MIN_SCANS failures spanning >= MIN_AGE → dead; logged once", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS / 2);
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS);
    expect(isConfirmedDead("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS)).toBe(true);
    expect(confirmedDeadNames("k", DEAD_SEGMENT_MIN_AGE_MS)).toEqual(new Set(["a.ndjson"]));
    expect(markDeadLoggedOnce("k", "a.ndjson")).toBe(true);
    expect(markDeadLoggedOnce("k", "a.ndjson")).toBe(false);
  });

  it("a successful open resets; scopes independent; clear resets", () => {
    for (let i = 0; i < 3; i += 1) recordUnopenableSegment("k1", "a.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    expect(isConfirmedDead("k2", "a.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
    recordOpenableSegment("k1", "a.ndjson");
    expect(isConfirmedDead("k1", "a.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
    for (let i = 0; i < 3; i += 1) recordUnopenableSegment("k1", "b.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    clearDeadSegmentRegistry("k1");
    expect(isConfirmedDead("k1", "b.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement the registry**

```ts
// src/data/storage/deadSegmentRegistry.ts
/**
 * Session memory of segment files that are LISTED by the directory but cannot be
 * OPENED, scan after scan. Field evidence (2026-10-11/12): five segments from two
 * other devices stayed unopenable for >24 h; every reader re-probed them on every
 * scan (~30 s), and every STRICT reader — the pending-answer replay above all —
 * threw on them, so that user's queued answers never landed.
 *
 * "Dead" is deliberately slow to declare: `DEAD_SEGMENT_MIN_SCANS` failed opens
 * spanning at least `DEAD_SEGMENT_MIN_AGE_MS`. A share that has not caught up with
 * a colleague's new file clears in seconds, never minutes.
 *
 * A successful open resets the entry. A manual refresh clears everything so a
 * user can force a re-check. Nothing here touches disk.
 */
export const DEAD_SEGMENT_MIN_SCANS = 3;
export const DEAD_SEGMENT_MIN_AGE_MS = 5 * 60_000;

type Entry = { failures: number; firstFailedAtMs: number; lastFailedAtMs: number; logged: boolean };
const registry = new Map<string, Map<string, Entry>>();

function bucket(scopeKey: string): Map<string, Entry> {
  let m = registry.get(scopeKey);
  if (!m) {
    m = new Map();
    registry.set(scopeKey, m);
  }
  return m;
}

export function recordUnopenableSegment(scopeKey: string, name: string, nowMs: number = Date.now()): void {
  const m = bucket(scopeKey);
  const e = m.get(name);
  if (!e) {
    m.set(name, { failures: 1, firstFailedAtMs: nowMs, lastFailedAtMs: nowMs, logged: false });
    return;
  }
  e.failures += 1;
  e.lastFailedAtMs = nowMs;
}

export function recordOpenableSegment(scopeKey: string, name: string): void {
  registry.get(scopeKey)?.delete(name);
}

export function isConfirmedDead(scopeKey: string, name: string, nowMs: number = Date.now()): boolean {
  const e = registry.get(scopeKey)?.get(name);
  if (!e) return false;
  return e.failures >= DEAD_SEGMENT_MIN_SCANS && nowMs - e.firstFailedAtMs >= DEAD_SEGMENT_MIN_AGE_MS;
}

export function confirmedDeadNames(scopeKey: string, nowMs: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const [name] of registry.get(scopeKey) ?? []) if (isConfirmedDead(scopeKey, name, nowMs)) out.add(name);
  return out;
}

/** True exactly once per (scope, name): the caller logs on true. */
export function markDeadLoggedOnce(scopeKey: string, name: string): boolean {
  const e = registry.get(scopeKey)?.get(name);
  if (!e || e.logged) return false;
  e.logged = true;
  return true;
}

export function clearDeadSegmentRegistry(scopeKey?: string): void {
  if (scopeKey === undefined) registry.clear();
  else registry.delete(scopeKey);
}
```

- [ ] **Step 4: Run** → PASS (4).

- [ ] **Step 5: Wire into `readSegmentTails` (`directoryScan.ts`)**

Read the whole `readSegmentTails` function first. Then:
1. Import `confirmedDeadNames, markDeadLoggedOnce, recordOpenableSegment, recordUnopenableSegment` from `./deadSegmentRegistry`.
2. After `listMatchingFileEntries`, compute `const dead = options.scopeKey ? confirmedDeadNames(options.scopeKey) : new Set<string>();`. Entries whose `name` is in `dead` are **not opened** (no `readListedEntry`, no vanish-budget use), are not added to `sizeByName`/`tailTextByName`, and stay in `matchedNames`.
3. For every other entry: after `readListedEntry` → `null` and `options.scopeKey` set → `recordUnopenableSegment(options.scopeKey, name)`; success → `recordOpenableSegment(options.scopeKey, name)`.
4. In `logSkippedEntries` (`:452-460`): when `scopeKey` is set, partition `fresh` into `justConfirmed = fresh.filter((n) => markDeadLoggedOnce(scopeKey, n))` and `rest`. Log `justConfirmed` once with: `` `${n} listed entr(y|ies) in "${dir.name}" could not be opened on ${DEAD_SEGMENT_MIN_SCANS}+ scans over ${DEAD_SEGMENT_MIN_AGE_MS/60000} min — treated as unreadable for this session (a manual refresh re-checks): ${names}` ``. Log `rest` with today's message and today's de-dupe.
5. Return `deadNames: dead` alongside the existing fields; update the return type.

- [ ] **Step 6: Exclude confirmed-dead names from the strict check**

`appendOnlyEventLog.ts`: at `:1623` destructure `deadNames` too. Replace `:1632-1642` with:
```ts
  if (strict) {
    // A name the registry has confirmed dead (DEAD_SEGMENT_MIN_SCANS failed opens
    // over DEAD_SEGMENT_MIN_AGE_MS) is excluded on purpose. Strict mode exists so a
    // caller never checkpoints "read, found nothing" over a segment it could not
    // open — and that protection is intact: the dead name gets NO offset below, so
    // a later successful open reads it from byte 0. What strict mode must not do
    // is fail every read of the month forever because one colleague's file is
    // quarantined; that froze the pending-answer replay for a day (2026-10-12).
    const skipped = matchedNames.filter((name) => !sizeByName.has(name) && !deadNames.has(name));
    if (skipped.length > 0) throw new EventSegmentUnreadableError(skipped);
  }
```
Add `unreadableNames: [...deadNames]` to the returned delta and to the `SegmentEventsDelta` type (`:1540-1562`). Confirm the offsets loop below never writes an offset for a name absent from `sizeByName`.

- [ ] **Step 7: Clear on manual refresh**

`workspaceSync.ts`: in `runSync`'s `manual` branch, next to the existing full cache purge (grep `clearAnswerEventsCache`), add:
```ts
    // A user-initiated refresh is the one way to re-check segments the registry gave up on.
    clearDeadSegmentRegistry();
```

- [ ] **Step 8: Write the strict-read regression test**

```ts
// src/data/answers/answerStorage.deadSegments.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, loadAllEmployeeFiles } from "./answerStorage";
import { DEAD_SEGMENT_MIN_AGE_MS, DEAD_SEGMENT_MIN_SCANS, clearDeadSegmentRegistry } from "../storage/deadSegmentRegistry";

const MONTH = "5-May-2026";
const DEAD = "zzz-ans-dev2-s1.ndjson";

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const h: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!(); await w.write(content); await w.close();
}
const line = (id: string, who: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: who, authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: who })}\n`;

function notFound(): Error { const e = new Error("gone"); e.name = "NotFoundError"; return e; }

/** `DEAD` stays in listings but every open of it throws NotFoundError. */
function withDeadFile(dir: DirectoryHandleLike): DirectoryHandleLike {
  const wrap = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(t, p, r) {
        if (p === "getDirectoryHandle") return async (n: string, o?: { create?: boolean }) => wrap(await t.getDirectoryHandle(n, o));
        if (p === "getFileHandle") return async (n: string, o?: { create?: boolean }) => { if (n === DEAD) throw notFound(); return t.getFileHandle(n, o); };
        if (p === "values" && typeof t.values === "function") {
          return () => (async function* () {
            for await (const e of t.values!()) {
              if (e.kind === "file" && e.name === DEAD) yield { ...e, getFile: async () => { throw notFound(); } };
              else yield e;
            }
          })();
        }
        return Reflect.get(t, p, r);
      },
    });
  return wrap(dir);
}

describe("strict reads vs a persistently unopenable colleague segment", () => {
  let now = 1_000_000;
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    clearDeadSegmentRegistry();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("throws until the segment is confirmed dead, then reads everything else", async () => {
    const root = createMemoryDirectory("dead") as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRaw(events, "aaa-ans-dev1-s1.ndjson", line("e1", "emp1"));
    await writeRaw(events, DEAD, line("e2", "emp2"));
    const dir = withDeadFile(root);

    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) {
      __clearAnswerEventsCacheForTests();
      await expect(loadAllEmployeeFiles(dir, MONTH, { strict: true })).rejects.toThrow();
      now += Math.ceil(DEAD_SEGMENT_MIN_AGE_MS / (DEAD_SEGMENT_MIN_SCANS - 1));
    }
    __clearAnswerEventsCacheForTests();
    const files = await loadAllEmployeeFiles(dir, MONTH, { strict: true });
    expect(files.map((f) => f.username)).toEqual(["emp1"]);
  }, 30_000);
});
```
If `memoryDirectory` entries do not expose `getFile` on enumeration records (check `asFileHandle` in `directoryScan.ts`), drop the `values` branch — the `getFileHandle` override alone makes the by-name reopen fail, which is the path `readListedEntry` takes on retry.

- [ ] **Step 9: Run** `npx vitest run src/data/answers/answerStorage.deadSegments.test.ts` → PASS.

- [ ] **Step 10: Suites** `npx vitest run src/data/storage src/data/answers src/data/distribution` → PASS; `answerSaveReadCost.test.ts` counts unchanged.

- [ ] **Step 11: Commit**

```bash
git add src/data/storage/deadSegmentRegistry.ts src/data/storage/deadSegmentRegistry.test.ts src/data/storage/directoryScan.ts src/data/storage/appendOnlyEventLog.ts src/data/workspace/workspaceSync.ts src/data/answers/answerStorage.deadSegments.test.ts
git commit -m "Fix (answers): confirmed-dead segments no longer block strict reads or re-probe every scan"
```

---

### Task 4: Raise segment rotation thresholds

**Files:**
- Modify: `src/data/storage/appendOnlyEventLog.ts:189-211`
- Test: every test referencing `MAX_OPEN_SEGMENT_BYTES` / `MAX_OPEN_SEGMENT_LINES` or building 2,000 lines / 131,072 bytes to force rotation (grep `MAX_OPEN_SEGMENT|131_072|131072|2_000` under `src/**/*.test.ts`).

- [ ] **Step 1: Change**
```ts
export const MAX_OPEN_SEGMENT_BYTES = 1_048_576;
export const MAX_OPEN_SEGMENT_LINES = 10_000;
```
Update the comment above: `1 MB ≈ 3,000–5,000 answer events. On an SMB share one 1 MB read is far cheaper than eight 128 KB opens — each open is a round trip, bytes stream. Field evidence 2026-10-12: ~2,000 segments in one month folder.`

- [ ] **Step 2: Fix tests** — run `npx vitest run src/data/storage src/data/answers src/data/distribution`; any test that forced a rotation with the old numbers now fails. Change it to import the constants and use `MAX_OPEN_SEGMENT_LINES + 1` / `MAX_OPEN_SEGMENT_BYTES + 1`. Never lower the constants to pass a test.

- [ ] **Step 3: Commit**
```bash
git add -A src/data/storage src/data/answers src/data/distribution
git commit -m "Change (storage): segment rotation at 1 MB / 10k lines instead of 128 KB / 2k"
```

---

### Task 5: PR 1 gates, edit log, PR

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm run test:run && npm run build` → all green. Quote any failing line; do not proceed on red.

- [ ] **Step 2:** `npm run editlog -- --tier=2 --append --sync-package "Fix (answers): stop the save-failure spiral on flaky shares — retry refused replace before rotating, two-name extension probe, dead-segment registry, 1 MB segments"` — fill `Why:` (70 rotations/2 days; false XQ-IO-033 disproved by hand; replay frozen by 5 dead files) and `What changed:` with Before/After for the ladder constant, the probe branch, the strict check. Version `153.24.0`.

- [ ] **Step 3:**
```bash
git add "docs/edit logs" package.json
git commit -m "Docs (edit log): v153.24.0 answers save-path hardening"
git push -u origin claude/app-load-save-performance-cd416b
gh pr create --title "Fix (answers): save-path hardening for flaky SMB shares (v153.24.0)" --body "Implements spec §8 (docs/superpowers/specs/2026-10-13-answers-compaction-and-load-path-design.md). Refused replace retries ~4 s before one bounded rotation; extension-blocked needs two probe names; segments unopenable for 3 scans over 5 min are skipped, logged once, and no longer fail strict reads (unblocks PendingAnswerReplayRunner); rotation threshold 1 MB. Gates green locally: lint, typecheck, test:run, build."
```

---

## PR 2 — Employee load-path speedups

Branch `claude/employee-load-path` from the PR 1 branch.

### Task 6: Scope the ad-hoc probe to the selected month

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/adhocReads.ts` (move `beginAdhocReads` from `XrayReferrals.tsx:304-319`)
- Modify: `XrayReferrals.tsx:1311-1312`, `XrayInspectionResults.tsx:357`
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/adhocReads.test.ts` (create)

**Interfaces:**
- Produces: `beginAdhocReads(directoryHandle, username, canSeeAll, monthFolderName): { entries: Promise<AdhocDistributionEntry[]>; answers: Promise<ItemAnswer[]> }`.
- Consumes: `loadAdhocEntriesForEmployeeView(dir, user, canSeeAll, monthFolderName?)`, `loadAdhocAnswerItems(dir, entries)` from `src/data/adhocImport/adhocImportEmployeeView.ts`; `logError`.

- [ ] **Step 1: Failing test**
```ts
// adhocReads.test.ts
import { describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ args: [] as unknown[][] }));
vi.mock("../../../../../data/adhocImport/adhocImportEmployeeView", () => ({
  loadAdhocEntriesForEmployeeView: async (...args: unknown[]) => { calls.args.push(args); return []; },
  loadAdhocAnswerItems: async () => [],
}));
import { beginAdhocReads } from "./adhocReads";

describe("beginAdhocReads", () => {
  it("passes the selected month to the ad-hoc probe", async () => {
    const dir = {} as never;
    const { entries, answers } = beginAdhocReads(dir, "emp1", false, "5-May-2026");
    expect(await entries).toEqual([]);
    expect(await answers).toEqual([]);
    expect(calls.args[0]).toEqual([dir, "emp1", false, "5-May-2026"]);
  });
});
```
Fix the mock path depth to match `views/` → `src/data/`.

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement** — new file holds the old function body + doc comment, with `monthFolderName` as 4th parameter forwarded to `loadAdhocEntriesForEmployeeView`. Remove from `XrayReferrals.tsx`, import it, pass `selMonth` at `:1311`. In `XrayInspectionResults.tsx:357` add `selectedMonth` as the 4th argument.

- [ ] **Step 4: Run** `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/adhocReads.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/adhocReads.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx
git commit -m "Fix (employee-workspace): scope the ad-hoc import probe to the selected month"
```

---

### Task 7: Employee-scoped request-log read

**Files:**
- Modify: `src/data/answers/answerStorage.ts` (below `loadAllEmployeeRequestFiles`, `:1968`)
- Modify: `src/data/referral/referralStorage.ts:73-90` and the `loadReferralLog` / `loadReplacementLog` / `loadReopenLog` wrappers
- Modify: `XrayReferrals.tsx:1323-1324`, `XrayInspectionResults.tsx:351-352`
- Test: `src/data/referral/referralStorage.scoped.test.ts` (create)

**Interfaces:**
- Produces: `loadEmployeeRequestQueues(dir, month, username): Promise<EmployeeRequestQueues | null>` (answerStorage); `loadRequestLogs(dir, month, options?: { scopeToUser?: string })` and the three wrappers accept the same `options` (referralStorage). Dedupe key suffix `|user:${scopeToUser ?? "*"}`.
- Decisions remain all-supervisor (any supervisor may decide this user's request).

- [ ] **Step 1: Failing test**
```ts
// referralStorage.scoped.test.ts
import { describe, expect, it } from "vitest";
import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getAnswersDir } from "../workspace/workspacePaths";
import { loadRequestLogs } from "./referralStorage";

const MONTH = "5-May-2026";
// Use the real EmployeeRequestsFile / EmployeeAnswerFile shapes from ../answers/answerTypes.ts;
// the fields below are the minimum the reader consumes — add required ones the type demands.
const reqFile = (username: string) => ({
  username, monthFolderName: MONTH, revision: 1,
  referralRequests: [{ requestId: `r-${username}`, xrayImageId: `X-${username}`, fromEmployee: username, status: "pending", requestedAt: "2026-05-02T00:00:00.000Z" }],
  replacementRequests: [], reopenRequests: [],
});

describe("loadRequestLogs scoped to one user", () => {
  it("opens only that user's requests file", async () => {
    const root = createMemoryDirectory("scoped", { trackReads: true }) as unknown as DirectoryHandleLike;
    const dir = await getAnswersDir(root, MONTH);
    for (const u of ["emp1", "emp2", "emp3"]) await safeWriteJson(dir, `${u}.requests.json`, reqFile(u));
    clearReadLog(root);
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "emp2" });
    expect(scoped.referrals.requests.map((r) => r.requestId)).toEqual(["r-emp2"]);
    const opened = getReadLog(root).filter((p) => p.endsWith(".requests.json"));
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((p) => p.endsWith("emp2.requests.json"))).toBe(true);
  });

  it("falls back to legacy {user}.answers.json when no requests file exists", async () => {
    const root = createMemoryDirectory("scoped-legacy") as unknown as DirectoryHandleLike;
    const dir = await getAnswersDir(root, MONTH);
    await safeWriteJson(dir, "emp9.answers.json", {
      username: "emp9", monthFolderName: MONTH, revision: 1, items: [],
      referralRequests: [{ requestId: "r-legacy", xrayImageId: "X", fromEmployee: "emp9", status: "pending", requestedAt: "2026-05-02T00:00:00.000Z" }],
      replacementRequests: [], reopenRequests: [],
    });
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "emp9" });
    expect(scoped.referrals.requests.map((r) => r.requestId)).toEqual(["r-legacy"]);
  });
});
```

- [ ] **Step 2: Run** → test 1 FAILS (all three files opened).

- [ ] **Step 3: Implement `loadEmployeeRequestQueues`** in `answerStorage.ts` right after `loadAllEmployeeRequestFiles`:
```ts
/**
 * One employee's request queues — the `scopeToUser` fast path for
 * `loadRequestLogs`. Same source order as the all-user scan: `{user}.requests.json`
 * first, else the frozen legacy `{user}.answers.json` arrays (memoised per session,
 * found files only, sharing `legacyRequestQueuesMemo` with the scan so the two can
 * never disagree). `null` when neither file exists.
 */
export async function loadEmployeeRequestQueues(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeRequestQueues | null> {
  const requests = await loadEmployeeRequestsFile(directoryHandle, monthFolderName, username);
  if (requests) {
    return { username, monthFolderName, referralRequests: requests.referralRequests, replacementRequests: requests.replacementRequests, reopenRequests: requests.reopenRequests };
  }
  const legacyKey = `${requestQueuesKey(directoryHandle, monthFolderName)}|${username}`;
  let legacyQueues = legacyRequestQueuesMemo.get(legacyKey);
  if (!legacyQueues) {
    const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
    if (legacy === null) return null;
    legacyQueues = { username, monthFolderName, revision: 0, referralRequests: legacy.referralRequests, replacementRequests: legacy.replacementRequests, reopenRequests: legacy.reopenRequests };
    legacyRequestQueuesMemo.set(legacyKey, legacyQueues);
  }
  return { username, monthFolderName, referralRequests: legacyQueues.referralRequests, replacementRequests: legacyQueues.replacementRequests, reopenRequests: legacyQueues.reopenRequests };
}
```
Check `loadEmployeeRequestsFile` (`:719`): if it throws on a missing file rather than returning `null`/empty, wrap it: catch `isNotFoundError` → treat as absent, rethrow anything else. Then refactor `loadAllEmployeeRequestFiles`'s callback to call this helper, keeping its "stem listed but file absent ⇒ throw" guard: `if (!queues) throw new Error(\`Legacy answers file for ${username} listed but not found.\`)`.

- [ ] **Step 4: Implement `scopeToUser`** in `referralStorage.ts:73-90`:
```ts
export async function loadRequestLogs(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  options?: { scopeToUser?: string }
): Promise<{ referrals: ReferralLog; replacements: ReplacementLog; reopens: ReopenLog }> {
  const scope = options?.scopeToUser;
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|request-logs|user:${scope ?? "*"}`;
  return dedupeInFlight(key, async () => {
    const [empFiles, allDecisions] = await Promise.all([
      scope === undefined
        ? loadAllEmployeeRequestFiles(directoryHandle, monthFolderName)
        : loadEmployeeRequestQueues(directoryHandle, monthFolderName, scope).then((q) => (q ? [q] : [])),
      loadAllSupervisorDecisions(directoryHandle, monthFolderName),
    ]);
    return {
      referrals: buildLog(monthFolderName, empFiles, allDecisions, "referral", (f) => f.referralRequests ?? []),
      replacements: buildLog(monthFolderName, empFiles, allDecisions, "replacement", (f) => f.replacementRequests ?? []),
      reopens: buildLog(monthFolderName, empFiles, allDecisions, "reopen", (f) => f.reopenRequests ?? []),
    };
  });
}
```
Add `options?: { scopeToUser?: string }` as 3rd parameter to `loadReferralLog`, `loadReplacementLog`, `loadReopenLog`, forwarded.

- [ ] **Step 5: Call sites** — `XrayReferrals.tsx:1323-1324` and `XrayInspectionResults.tsx:351-352`: pass `{ scopeToUser: canSeeAll ? undefined : username }`. Confirm `getPendingReferralIds(referralLog, username)` / `getPendingReplacementIds` only ever select `fromEmployee === username` rows (so a scoped log yields identical ids).

- [ ] **Step 6: Run** `npx vitest run src/data/referral src/data/answers src/components/Sidebar/Tabs/EmployeeWorkspace` → PASS.

- [ ] **Step 7: Commit**
```bash
git add src/data/answers/answerStorage.ts src/data/referral/referralStorage.ts src/data/referral/referralStorage.scoped.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx
git commit -m "Change (referrals): employee views read only their own request queue"
```

---

### Task 8: One listing pass in `eventStoreMatchesScan`

**Files:**
- Modify: `src/data/distribution/distributionStorage.ts:682-687`; possibly `src/data/storage/directoryScan.ts:540` (`listDirectoryEntriesWithSize`)
- Test: `src/data/distribution/distributionStorage.eventStoreMatchesScan.test.ts` (create unless an existing test file already covers the function — grep first and extend that one)

**Interfaces:** `eventStoreMatchesScan(dir, month, identity)` unchanged. `listDirectoryEntriesWithSize(dir, suffix?)` — `suffix` becomes optional; when omitted every file is returned, size populated for all.

- [ ] **Step 1: Failing test** — count directory enumerations of `distribution.events/`. Read `memoryDirectory.ts` `trackReads` to learn whether enumerations are logged; if not, wrap the events directory in a Proxy that counts `values()` calls (pattern from Task 3) and assert `=== 1` after one `eventStoreMatchesScan` call on a directory holding one `.ndjson` and one legacy `.json`. Build the identity with the module's exported `legacyFilesDigest(["legacy-1.json"])` and `segmentOffsets: { "a-dist-x.ndjson": <its byte length> }`; assert the function returns `true`.

- [ ] **Step 2: Run** → FAIL (2 enumerations).

- [ ] **Step 3: Implement**
```ts
      if (eventsDir) {
        const entries = await listDirectoryEntriesWithSize(eventsDir);
        segments = entries.filter((e) => e.name.endsWith(DISTRIBUTION_EVENT_SEGMENT_SUFFIX));
        legacyNames = entries.filter((e) => e.name.endsWith(".json")).map((e) => e.name);
      }
```
In `listDirectoryEntriesWithSize`, make `suffix` optional: no suffix → every `kind === "file"` entry. Keep concurrency 8 and the existing vanish handling.

- [ ] **Step 4: Run** `npx vitest run src/data/distribution src/data/samples src/data/storage/directoryScan` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/data/distribution/distributionStorage.ts src/data/storage/directoryScan.ts src/data/distribution/distributionStorage.eventStoreMatchesScan.test.ts
git commit -m "Change (distribution): one directory pass for the mirror trust check"
```

---

### Task 9: Persist the derived cache after a read-side fold (opt-in)

**Files:**
- Modify: `src/data/distribution/distributionStorage.ts` — `loadOrDeriveDistributionCurrentOutcome` (`:2113-2320`, add `source`), `loadOrDeriveDistributionCurrentOutcomeForRead` (`:2477`), `loadOrDeriveDistributionCurrentStrictForRead` (`:2534`), A6a doc comment (`:2464-2467`)
- Modify: `XrayReferrals.tsx:1425`, `XrayInspectionResults.tsx:367`
- Test: `src/data/distribution/distributionStorage.persistAfterReadFold.test.ts` (create)

**Interfaces:**
- `DistributionCurrentOutcome` ok-variant gains `source: "cache" | "checkpoint" | "fold"`: `cache` when `distribution.current.json` was served as-is, `checkpoint` when `tryResumeFromCheckpoint` produced it, `fold` after `loadDistributionLogDetailed`.
- Both `...ForRead` functions accept `options.persistAfterReadFold?: boolean` (default `false`). When true and `source === "fold"` and the outcome is ok, call the same persist routine the write path uses behind `persistCache: true` (`:1817`), **awaited**, inside `try/catch` with `logError("distribution:persist-after-read-fold", error)`. The derivation itself keeps `persistCache: false`. Dedupe key gains `|persist` when the flag is set.

- [ ] **Step 1: Failing test** — copy the minimal synthetic-month setup from an existing `distributionStorage*.test.ts` in the folder (sample rows + one assign event via `appendDistributionEvents`). Two cases: (a) default → after `loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows)`, `loadDistributionCurrent(root, MONTH)` is `null`; (b) `{ persistAfterReadFold: true }` → `loadDistributionCurrent` returns entries equal in length to the read.

- [ ] **Step 2: Run** → (b) FAILS.

- [ ] **Step 3: Implement** per Interfaces; update the A6a comment to name the opt-in and its two callers.

- [ ] **Step 4: Run** `npx vitest run src/data/distribution` → PASS.

- [ ] **Step 5: Call sites** — add `{ persistAfterReadFold: true }` at `XrayReferrals.tsx:1425` and `XrayInspectionResults.tsx:367`. `powerbiExport`, `orphanScanLoader`, `populationOverwriteGuard`, `sampleMirrorStorage` unchanged.

- [ ] **Step 6: Commit**
```bash
git add src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.persistAfterReadFold.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx
git commit -m "Change (distribution): employee views persist distribution.current.json after a read-side fold"
```

---

### Task 10: Mirror fast path in `XrayInspectionResults`

**Files:**
- Modify: `XrayInspectionResults.tsx:348-391`; if `check:complexity` trips, create `views/resultsLoad.ts` with a `loadResultsPhase1(...)` helper.
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.mirrorFastPath.test.tsx` (create; `/* @vitest-environment jsdom */`; copy the mock scaffold from an existing `XrayInspectionResults.*.test.tsx`)

**Behaviour:** personal scope only. Phase 1 loads `loadEmployeeSampleMirror` + `readDistributionLogStamp` instead of `loadSampleMaster`. If `isMirrorTrustedForEvents(...)` → entries come from `personalMirror.entries`; `loadSampleMaster` and `loadOrDeriveDistributionCurrentStrictForRead` are skipped. `loadDistributionLogForRead` (movement) stays. `canSeeAll` path unchanged.

- [ ] **Step 1: Failing test** — mock `loadEmployeeSampleMirror` (returns a mirror with 2 entries for the user), `readDistributionLogStamp` (`{ revision: 5 }`), `isMirrorTrustedForEvents` (`true`), and spy on `loadSampleMaster` / `loadOrDeriveDistributionCurrentStrictForRead`. Mount with `canSeeAll=false`, `initialTab="results"`. Assert the two spies were **not** called and both mirror rows render. Second case: `isMirrorTrustedForEvents` → `false` → both spies called once.

- [ ] **Step 2: Run** → case 1 FAILS.

- [ ] **Step 3: Implement**
```ts
      const [selection, referralLog, replacementLog, adhocEntries, personalMirror, logStamp] = await Promise.all([
        loadInspectionTemplateSelection(directoryHandle),
        loadReferralLog(directoryHandle, selectedMonth, { scopeToUser: canSeeAll ? undefined : username }),
        loadReplacementLog(directoryHandle, selectedMonth, { scopeToUser: canSeeAll ? undefined : username }),
        loadAdhocEntriesForEmployeeView(directoryHandle, username, canSeeAll, selectedMonth).catch((err) => {
          logError("xrayInspectionResults:loadAdhocEntries", err);
          return [];
        }),
        canSeeAll ? null : loadEmployeeSampleMirror(directoryHandle, selectedMonth, username),
        canSeeAll
          ? null
          : readDistributionLogStamp(directoryHandle, selectedMonth).catch((err) => {
              logError("xrayInspectionResults:readDistributionLogStamp", err);
              return null;
            }),
      ]);
      const mirrorTrusted =
        !canSeeAll && !!personalMirror && !!logStamp &&
        (await isMirrorTrustedForEvents(directoryHandle, selectedMonth, personalMirror, logStamp.revision));
      let distributionEntries: DistributionEntry[];
      if (mirrorTrusted) {
        distributionEntries = personalMirror!.entries;
      } else {
        const sampleMaster = await loadSampleMaster(directoryHandle, selectedMonth);
        const distribution = await loadOrDeriveDistributionCurrentStrictForRead(
          directoryHandle, selectedMonth, sampleMaster?.rows ?? [], { persistAfterReadFold: true }
        );
        distributionEntries = distribution?.entries ?? [];
      }
      const log = await loadDistributionLogForRead(directoryHandle, selectedMonth);
```
Then `entries = [...distributionEntries, ...adhocEntries].map(...)` as today. Before deleting the old `sampleMaster` binding, grep the rest of `loadData` for `sampleMaster` / `distribution.quotas` uses (e.g. `assignedAtByUser` at `:227` reads quotas) — for the mirror path, derive those from `personalMirror.quota` if present, else leave the existing state untouched. Imports: `loadEmployeeSampleMirror`, `isMirrorTrustedForEvents` from `src/data/samples/sampleMirrorStorage.ts`; `readDistributionLogStamp` from `src/data/distribution/distributionStorage.ts`.

- [ ] **Step 4: Run** `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace && npm run check:complexity` → PASS. Extract the Phase-1 block to `views/resultsLoad.ts` if the budget trips.

- [ ] **Step 5: Commit**
```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/
git commit -m "Change (employee-workspace): Results view serves a trusted sample mirror instead of a full sample+distribution read"
```

---

### Task 11: PR 2 gates, edit log, real-browser check, PR

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run build` → all green.

- [ ] **Step 2: Real-browser check** — `npm run dev`, Chrome, demo workspace; sign in as an employee; open Employee Workspace and the Results sub-tab; no console errors, rows render. Record observed load times (before/after on the same demo workspace, by eye) in the edit log labelled "observed on demo workspace, not a benchmark".

- [ ] **Step 3:** `npm run editlog -- --tier=2 --append --sync-package "Change (employee-workspace): month load reads only the employee's own files — scoped ad-hoc probe, own request queue, one-pass mirror trust check, read-fold cache persist, Results mirror fast path"` — version `153.25.0`.

- [ ] **Step 4:** commit, push, `gh pr create --title "Change (employee-workspace): employee load-path speedups (v153.25.0)" --body "Implements spec §9. See edit log v153.25.0. Gates green locally: lint, typecheck, test:run, check:complexity, build."`

---

## Hand-off to Plan 2

When PR 1 and PR 2 are merged, the supervisor writes `docs/superpowers/plans/2026-10-13-answers-layout-v2.md` from spec §4–7 with the writing-plans skill, same task shape. Task 1 there must be the `workspacePaths.ts` helpers + `_layout.json` detector; Task 2 the v2 reader with the snapshot-parity property test — before any migration or compaction code.
