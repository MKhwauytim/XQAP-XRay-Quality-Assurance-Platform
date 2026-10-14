# Answers layout v2 (per-assignee folders, admin migration, automatic compaction) — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each month's `answers.events/` from one flat folder of ~2,000 segments to one folder per assignee holding a `snapshot.json` plus fewer than ~20 live segments, with a one-time admin-confirmed migration and automatic per-employee compaction, so an employee's load opens a bounded number of files and no file is ever hard-deleted.

**Architecture:** New path helpers and a layout detector (`_layout.json` = commit marker) in `workspacePaths.ts`. A pure `snapshot + delta` fold (`v2/answerSnapshot.ts`) with a seeded parity property test, a CAS snapshot store, and a per-assignee disk reader that falls back to a full rebuild from `archive/` + live whenever the snapshot cannot be trusted. Writers route every append to the ASSIGNEE's folder once a month is v2; brand-new months start v2; v1 months keep today's flat reader untouched. A one-shot migration module, an admin-only prompt, a compaction module run from the employee's own browser, fan-out readers + in-tab cache keyed `{assignee}/{segment}`, and a v2-aware sync probe and restore path complete it.

**Tech Stack:** TypeScript strict (`erasableSyntaxOnly`), React 19, Vitest (`node` default; `/* @vitest-environment jsdom */` for components), `@testing-library/react`, `createMemoryDirectory()` for disk tests, `createRng(seed)` (Mulberry32) for the property test.

**Spec:** `docs/superpowers/specs/2026-10-13-answers-compaction-and-load-path-design.md` (sections 4, 5, 6, 7, 10, 11 PR 3, 12 are what this plan implements). Plan 1 (`docs/superpowers/plans/2026-10-13-answers-hardening-and-load-path.md`, spec §8/§9) has landed on this branch.

## Global Constraints

- Node `>=22 <23`. Commands: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npx vitest run <file>`, `npm run build`, `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run check:bundle-size`.
- Tier 3 (data-format change + migration). ONE edit-log entry for the whole PR, written AFTER the code is in (Task 12): `npm run editlog -- --tier=3 --append --sync-package --version=154.0 "Change (answers): …"`. Version `154.0.0` in `package.json`, `v154.0` in the edit log.
- All tier-3 gates before claiming done: `lint`, `typecheck`, `test:run`, `check:complexity` (complexity ≤ 60, ≤ 1450 lines per function), `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`. `npm run build` before pushing, always.
- Layout v2 exactly as spec §4: `answers.events/_layout.json` (commit marker), `answers.events/_archive-v1/`, `answers.events/{assignee}/snapshot.json`, `answers.events/{assignee}/{writerBase}[-{seq}].ndjson`, `answers.events/{assignee}/archive/`. Every path through new helpers in `src/data/workspace/workspacePaths.ts`. No caller hard-codes `"answers.events"`, `"_layout.json"`, `"_archive-v1"`, `"archive"`, `"snapshot.json"`.
- `{assignee}` = `answerAssigneeFolderName(answeredBy)` = `safeWorkspaceFilePart(trim(lowercase(username)))`. Every append (self-save AND on-behalf) lands in the ASSIGNEE's folder.
- v1 months (no `_layout.json`) keep today's flat reader and writer byte-for-byte, except that a v1 read also reads `_archive-v1/` while a migration is incomplete (that is what makes spec §6's "crash leaves the month v1 and re-runnable" true).
- `AnswerEvent`, `ItemAnswer`, the fold `foldAnswerEvents`, and the fold order `(eventAt, authority, eventId)` are unchanged. Segment line format is byte-identical.
- Post-launch migration policy (CLAUDE.md): the flat→per-assignee migration is offered to an ADMIN on sign-in, never runs silently, never for a non-admin, lives in its own tested module `src/data/answers/migration/flatToPerAssignee.ts`, and ARCHIVES (moves) every original — never deletes.
- Nothing is ever hard-deleted. The only removal is `safeRemoveJson` of a segment AFTER a byte-verified copy exists in an archive folder (spec §6 step 4 / §7 step 3), and of `_migration.lock.json` at commit.
- Compaction: employee's own browser, own folder only; `COMPACTION_SEGMENT_THRESHOLD = 20`; `COMPACTION_MAX_AGE_MS = 7 days`; `COMPACTION_QUIET_MS = 10 min`; never moves the highest seq of any writer base present; CAS on snapshot revision; at most once per hour per (month, assignee) per tab.
- Migration lock: `_migration.lock.json` `{ by, deviceId, startedAt, token, revision }` via `casLoop`; a lock younger than 30 min held by another (actor, device) aborts with "in progress elsewhere".
- UI strings are Arabic label keys in `src/data/labels/labelsStore.ts` (`DEFAULT_LABELS`), read with `getLabels()`/`useLabels()`. No raw hex colors (`check:hex-literals`).
- Deterministic-by-contract modules (sampling, distribution fold, report/export builders) are not touched. Report builders consume `loadAllEmployeeFiles`, whose per-employee output is identical (Task 4/10 tests prove it).
- `withResourceLock` is not reentrant: a CAS lock key gets a `:cas` suffix so it never equals `safeWriteJson`'s own `directoryResourceKey(dir, fileName)` lock.
- No bare `git stash`. Commit WIP instead.
- Repo hooks (GateGuard) may ask to "present facts" before the first Bash/Write of a session: answer in one message, then retry the identical call.

## Review Focus

1. **A `snapshot.json` that `safeReadJson` recovered from `.bak` (or that is corrupt):** the `.bak` is an OLDER snapshot written before segments were moved to `archive/`; serving it would silently drop those segments' answers. The reader must rebuild from `archive/` + live instead. Test in Task 4 (`snapshot recovered from .bak is never served`).
2. **A compaction that commits between a reader's snapshot read and its segment listing:** the reader holds the old snapshot while the folded segments have already moved to `archive/`. The reader must notice (snapshot stat changed) and retry, never return the shorter state. Test in Task 4 (`compaction committing mid-read`).
3. **One supervisor answering on behalf of two assignees in one session:** the stable writer chain has the same base name in both folders; the per-writer seq memo must be scoped per assignee folder or the second folder's first append takes the ~11 s patient ladder and starts at a non-existent seq. Test in Task 5 (`on-behalf for two assignees`).
4. **A migration that crashed after moving some segments into `_archive-v1/`:** the month is still v1; every v1 reader must still see those segments' answers, and writers must defer to the pending queue until an admin re-runs it. Test in Task 7 (`crash at every phase`).
5. **Mixed-case or path-unsafe usernames (`Emp1` saving, `emp1` answered on behalf):** both must land in ONE folder `emp1/` and fold together. Test in Task 5 (`mixed-case assignee`).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/data/workspace/workspacePaths.ts` | modify | `ANSWER_EVENTS_FOLDERS`, `answerAssigneeFolderName`, `isAnswerAssigneeFolderName`, `getAnswerEventsDir`, `getAssigneeAnswerEventsDir`, `getAssigneeArchiveDir`, `getAnswerArchiveV1Dir`, `getAnswerQuarantineDir`, `getAnswerEventsLayout`, `noteAnswerEventsLayoutV2`, `invalidateAnswerEventsLayout` |
| `src/data/answers/answerEventStore.ts` | modify | `ANSWER_EVENTS_DIR` re-exported from `ANSWER_EVENTS_FOLDERS.root` (one definition) |
| `src/data/answers/v2/answerSnapshot.ts` | create | `AnswerSnapshot` type, `snapshotDraftFromFold`, `snapshotAsResume`, `foldSnapshotPlusDelta`, `v1OffsetKey` (pure) |
| `src/data/answers/v2/answerSnapshotStore.ts` | create | `statAnswerSnapshot`, `readAnswerSnapshot`, `writeAnswerSnapshotCas` |
| `src/data/answers/v2/assigneeEventReader.ts` | create | `readAssigneeState`, `rebuildAssigneeState`, `readAllAssigneeEvents`, `listAssigneeFolders`, `assigneeSegmentConfig` |
| `src/data/answers/v2/rebuildAssigneeSnapshot.ts` | create | `rebuildAndPersistAssigneeSnapshot` (migration, compaction-late, restore) |
| `src/data/answers/v2/answerEventsLayout.ts` | create | `_layout.json` marker read/write, `ensureAnswerEventsLayoutForWrite` |
| `src/data/answers/v2/v2TestFixtures.ts` | create | test-only fixtures (never imported by production code) |
| `src/data/storage/moveFileVerified.ts` | create | move-or-copy-verify-remove |
| `src/data/storage/fileSystemAccess.ts` | modify | optional `move?` on `FileHandleLike` |
| `src/data/answers/answerStorage.ts` | modify | v2 read/write branches, cache keying, `loadLegacyAnswerSeed`, exported `foldEmployeeEvents`, v1-migrating read of `_archive-v1` |
| `src/data/answers/migration/flatToPerAssignee.ts` | create | the one-time admin migration |
| `src/data/answers/migration/answerLayoutMigrationProbe.ts` | create | which months need migrating |
| `src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.tsx` | create | admin prompt |
| `src/App.tsx` | modify | mount the prompt |
| `src/data/labels/labelsStore.ts` | modify | Arabic label keys |
| `src/data/answers/compaction/compactAssignee.ts` | create | compaction + scheduling gate |
| `src/data/history/actionHistoryReaders.ts` | modify | v2 event source |
| `src/data/workspace/workspaceSync.ts` | modify | v2 signature + owners |
| `src/data/answers/v2/answerRestoreSupport.ts` | create | restore classification + affected assignees |
| `src/data/backup/backupStorage.ts` | modify | v2 restore actions + snapshot rebuild |
| `docs/architecture/data-system-report.md`, `CLAUDE.md`, `docs/edit logs/2026-10-13.md`, `package.json` | modify | docs + release |

---

### Task 1: Path helpers and the `_layout.json` layout detector

**Files:**
- Modify: `src/data/workspace/workspacePaths.ts` (constants after `SAMPLE_SUBFOLDERS` at `:21-25`; helpers after `getSampleApprovalsDir` at `:512-518`; manual-refresh subscription at `:286-290`)
- Modify: `src/data/answers/answerEventStore.ts:133-134`
- Test: `src/data/workspace/workspacePaths.answerLayout.test.ts` (create)

**Interfaces:**
- Consumes: `getChildDir(root, parentPath, resolveParent, childName, create, month)` (private, `workspacePaths.ts:396`), `getSampleMainDir(dir, month, create = true)` (`:496`), `safeWorkspaceFilePart(value)` (`:709`), `isNotFoundError` (already imported, `:3`).
- Produces:
  - `ANSWER_EVENTS_FOLDERS = { root: "answers.events", layoutMarker: "_layout.json", migrationLock: "_migration.lock.json", archiveV1: "_archive-v1", quarantine: "_quarantine", assigneeArchive: "archive", assigneeSnapshot: "snapshot.json" } as const`
  - `answerAssigneeFolderName(assignee: string): string` (throws on empty/reserved)
  - `isAnswerAssigneeFolderName(name: string): boolean`
  - `getAnswerEventsDir(dir, month, create = false): Promise<DirectoryHandleLike>`
  - `getAssigneeAnswerEventsDir(dir, month, assignee, create = false)`, `getAssigneeArchiveDir(dir, month, assignee, create = false)`, `getAnswerArchiveV1Dir(dir, month, create = false)`, `getAnswerQuarantineDir(dir, month, create = false)`
  - `type AnswerEventsLayout = "absent" | "v1" | "v1-migrating" | "v2"`
  - `getAnswerEventsLayout(dir, month): Promise<AnswerEventsLayout>` — v2 cached per (root, month) and monotone; `"v1"`/`"v1-migrating"`/`"absent"` are NEVER cached (re-probed each call: `_layout.json`, `_migration.lock.json`, `_archive-v1/` in parallel, one RTT).
  - `noteAnswerEventsLayoutV2(dir, month): void`, `invalidateAnswerEventsLayout(dir?, month?): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/workspace/workspacePaths.answerLayout.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  ANSWER_EVENTS_FOLDERS,
  __clearWorkspaceDirCacheForTests,
  answerAssigneeFolderName,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  getAssigneeArchiveDir,
  invalidateAnswerEventsLayout,
  isAnswerAssigneeFolderName,
} from "./workspacePaths";

const MONTH = "5-may-2026";

async function touch(dir: DirectoryHandleLike, name: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{}");
  await writable.close();
}

describe("answer events layout v2 — paths and detector", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });

  it("maps a username to one lowercase, path-safe folder and refuses reserved names", () => {
    expect(answerAssigneeFolderName("  Emp1 ")).toBe("emp1");
    expect(answerAssigneeFolderName("a/b:c")).toBe("a_b_c");
    expect(() => answerAssigneeFolderName("_archive-v1")).toThrow();
    expect(() => answerAssigneeFolderName("_QUARANTINE")).toThrow();
    expect(() => answerAssigneeFolderName("   ")).toThrow();
    expect(isAnswerAssigneeFolderName("_quarantine")).toBe(false);
    expect(isAnswerAssigneeFolderName("emp1")).toBe(true);
  });

  it("resolves {assignee}/archive under 2-samples/{month}/1-main/answers.events", async () => {
    const root = createMemoryDirectory("paths");
    const archive = await getAssigneeArchiveDir(root, MONTH, "Emp1", true);
    expect(archive.name).toBe(ANSWER_EVENTS_FOLDERS.assigneeArchive);
    const main = await (await (await root.getDirectoryHandle("2-samples")).getDirectoryHandle(MONTH)).getDirectoryHandle("1-main");
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.root);
    await expect(events.getDirectoryHandle("emp1")).resolves.toBeTruthy();
  });

  it("detects absent / v1 / v1-migrating (lock) / v1-migrating (archive) / v2", async () => {
    const root = createMemoryDirectory("layout");
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("absent");
    const events = await getAnswerEventsDir(root, MONTH, true);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
    await touch(events, ANSWER_EVENTS_FOLDERS.migrationLock);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
    await events.removeEntry!(ANSWER_EVENTS_FOLDERS.migrationLock);
    await events.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: true });
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
    await touch(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
  });

  it("v2 is monotone within a tab; v1 is never served from cache", async () => {
    const root = createMemoryDirectory("mono");
    const events = await getAnswerEventsDir(root, MONTH, true);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
    await touch(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    await events.removeEntry!(ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    invalidateAnswerEventsLayout(root, MONTH);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
  });

  it("a non-NotFound probe failure propagates instead of reading as v1", async () => {
    const root = createMemoryDirectory("fault");
    await getAnswerEventsDir(root, MONTH, true);
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: ANSWER_EVENTS_FOLDERS.layoutMarker, errorName: "NotReadableError", times: 1 },
    ]);
    await expect(getAnswerEventsLayout(root, MONTH)).rejects.toMatchObject({ name: "NotReadableError" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/workspace/workspacePaths.answerLayout.test.ts`
Expected: FAIL — `ANSWER_EVENTS_FOLDERS` / `getAnswerEventsLayout` are not exported.

- [ ] **Step 3: Add the constants and name helpers**

In `workspacePaths.ts`, directly after `SAMPLE_SUBFOLDERS` (`:21-25`):

```ts
/**
 * `2-samples/{month}/1-main/answers.events/` and its layout-v2 children
 * (spec 2026-10-13 §4). THE one definition — `answerEventStore.ts` re-exports
 * `ANSWER_EVENTS_DIR` from `root`.
 *
 * - `layoutMarker`: present = the month is v2 (per-assignee). Written LAST by
 *   the migration; its presence is the commit point.
 * - `migrationLock`: an admin migration is running (or crashed) — writers defer.
 * - `archiveV1`: flat v1 segments, moved untouched by the migration.
 * - `quarantine`: v1 lines the migration could not attribute or parse.
 * - `assigneeArchive` / `assigneeSnapshot`: per-assignee children.
 */
export const ANSWER_EVENTS_FOLDERS = {
  root: "answers.events",
  layoutMarker: "_layout.json",
  migrationLock: "_migration.lock.json",
  archiveV1: "_archive-v1",
  quarantine: "_quarantine",
  assigneeArchive: "archive",
  assigneeSnapshot: "snapshot.json",
} as const;

const RESERVED_ANSWER_EVENTS_CHILDREN: ReadonlySet<string> = new Set<string>([
  ANSWER_EVENTS_FOLDERS.archiveV1,
  ANSWER_EVENTS_FOLDERS.quarantine,
]);

/**
 * The `{assignee}` folder for a username. Lowercased because every answers
 * comparison is case-insensitive (`sameUser`), so `Emp1` saving and `emp1`
 * answered on behalf must land in ONE folder.
 */
export function answerAssigneeFolderName(assignee: string): string {
  const name = safeWorkspaceFilePart(assignee.trim().toLowerCase());
  if (name === "" || name === "." || RESERVED_ANSWER_EVENTS_CHILDREN.has(name)) {
    throw new Error(`Invalid answer assignee "${assignee}": not usable as a folder name`);
  }
  return name;
}

/** True for a listed `answers.events/` child directory that is an assignee folder. */
export function isAnswerAssigneeFolderName(name: string): boolean {
  return name !== "" && !name.startsWith(".") && !RESERVED_ANSWER_EVENTS_CHILDREN.has(name);
}
```

- [ ] **Step 4: Add the directory helpers**

After `getSampleApprovalsDir` (`:512-518`):

```ts
function sampleMainPath(monthFolderName: string): string {
  return `${WORKSPACE_ROOTS.samples}/${monthFolderName}/${SAMPLE_SUBFOLDERS.main}`;
}

function answerEventsPath(monthFolderName: string): string {
  return `${sampleMainPath(monthFolderName)}/${ANSWER_EVENTS_FOLDERS.root}`;
}

/** `2-samples/{month}/1-main/answers.events/`. */
export async function getAnswerEventsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    sampleMainPath(monthFolderName),
    () => getSampleMainDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.root,
    create,
    monthFolderName
  );
}

/** `answers.events/{assignee}/` — live segments + `snapshot.json`. */
export async function getAssigneeAnswerEventsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    answerAssigneeFolderName(assignee),
    create,
    monthFolderName
  );
}

/** `answers.events/{assignee}/archive/` — segments folded into the snapshot. */
export async function getAssigneeArchiveDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${answerEventsPath(monthFolderName)}/${answerAssigneeFolderName(assignee)}`,
    () => getAssigneeAnswerEventsDir(directoryHandle, monthFolderName, assignee, create),
    ANSWER_EVENTS_FOLDERS.assigneeArchive,
    create,
    monthFolderName
  );
}

/** `answers.events/_archive-v1/` — flat v1 segments, moved untouched. */
export async function getAnswerArchiveV1Dir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.archiveV1,
    create,
    monthFolderName
  );
}

/** `answers.events/_quarantine/` — v1 lines the migration could not attribute or parse. */
export async function getAnswerQuarantineDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.quarantine,
    create,
    monthFolderName
  );
}
```

- [ ] **Step 5: Add the layout detector**

Below the helpers:

```ts
export type AnswerEventsLayout = "absent" | "v1" | "v1-migrating" | "v2";

/**
 * Months this tab has SEEN as v2, per workspace root. Monotone on purpose: the
 * layout only moves forward (rollback is a manual, reload-requiring operation —
 * see data-system-report.md), so one transient NotFound on `_layout.json` from a
 * lagging SMB listing can never flip a v2 month back to the flat reader, which
 * would show an employee an empty month. Every OTHER verdict is re-probed on
 * every call (three handle opens in parallel, one round trip): a stale "v1"
 * would send a save into the flat folder after the admin committed v2.
 */
let answerLayoutV2ByRoot = new WeakMap<DirectoryHandleLike, Set<string>>();

export function noteAnswerEventsLayoutV2(directoryHandle: DirectoryHandleLike, monthFolderName: string): void {
  let months = answerLayoutV2ByRoot.get(directoryHandle);
  if (!months) {
    months = new Set();
    answerLayoutV2ByRoot.set(directoryHandle, months);
  }
  months.add(monthFolderName);
}

export function invalidateAnswerEventsLayout(directoryHandle?: DirectoryHandleLike, monthFolderName?: string): void {
  if (!directoryHandle) {
    answerLayoutV2ByRoot = new WeakMap();
    return;
  }
  if (monthFolderName === undefined) answerLayoutV2ByRoot.delete(directoryHandle);
  else answerLayoutV2ByRoot.get(directoryHandle)?.delete(monthFolderName);
}

async function entryExists(open: () => Promise<unknown>): Promise<boolean> {
  try {
    await open();
    return true;
  } catch (error) {
    // "I could not look" is not "it is not there" — same rule as getRoot.
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function getAnswerEventsLayout(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<AnswerEventsLayout> {
  if (answerLayoutV2ByRoot.get(directoryHandle)?.has(monthFolderName)) return "v2";
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(directoryHandle, monthFolderName, false);
  } catch (error) {
    if (isNotFoundError(error)) return "absent";
    throw error;
  }
  const [marker, lock, archive] = await Promise.all([
    entryExists(() => eventsDir.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker, { create: false })),
    entryExists(() => eventsDir.getFileHandle(ANSWER_EVENTS_FOLDERS.migrationLock, { create: false })),
    entryExists(() => eventsDir.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: false })),
  ]);
  if (marker) {
    noteAnswerEventsLayoutV2(directoryHandle, monthFolderName);
    return "v2";
  }
  return lock || archive ? "v1-migrating" : "v1";
}
```

Extend the manual-refresh subscription at `:286-290`:

```ts
if (typeof window !== "undefined") {
  subscribeToDataRefresh((source) => {
    if (source === "manual") {
      invalidateWorkspaceDirCache();
      invalidateAnswerEventsLayout();
    }
  });
}
```

- [ ] **Step 6: Make `ANSWER_EVENTS_DIR` derive from the one definition**

`answerEventStore.ts:133-134` →

```ts
/** Child of `2-samples/{month}/1-main/` that holds the answer segments — defined once in workspacePaths. */
export const ANSWER_EVENTS_DIR = ANSWER_EVENTS_FOLDERS.root;
```

and add `import { ANSWER_EVENTS_FOLDERS } from "../workspace/workspacePaths";` to the imports. (`workspacePaths.ts` imports nothing from `answers/`, so no cycle.)

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/data/workspace/workspacePaths.answerLayout.test.ts src/data/workspace src/data/answers/answerEventStore.test.ts`
Expected: PASS. Then `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.answerLayout.test.ts src/data/answers/answerEventStore.ts
git commit -m "Add (answers): layout-v2 path helpers and _layout.json detector"
```

---

### Task 2: Snapshot type and the pure `snapshot + delta` fold, with the parity property test

**Files:**
- Create: `src/data/answers/v2/answerSnapshot.ts`
- Test: `src/data/answers/v2/answerSnapshot.parity.test.ts` (create)

**Interfaces:**
- Consumes (all from `src/data/answers/answerEventStore.ts`): `foldAnswerEvents(events, options: FoldAnswerEventsOptions): AnswerFoldResult` (`:736`), `compareAnswerEventsForFold(left, right): number` (`:274`), `sortAnswerEventsForFold` (`:279`), `answerEventSetIdFromIds(ids)` (`:291`), `ANSWER_DERIVE_VERSION` (`:305`), types `AnswerEvent`, `AnswerFoldMarker`, `AnswerFoldResult`, `AnswerLegacySeed`, `FoldAnswerEventsOptions`. `ANSWER_EVENTS_FOLDERS` (Task 1). `createRng(seed): () => number` from `src/data/sampling/rng.ts`.
- Produces:
  - `ANSWER_SNAPSHOT_SCHEMA_VERSION = 1`
  - `type AnswerSnapshot = { schemaVersion: 1; assignee; monthFolderName; items: ItemAnswer[]; legacySeed: AnswerLegacySeed; foldedOffsets: Record<string, number>; foldedEventCount: number; revision: number; compactedAt: string; compactedBy: string; seeded: boolean; markers: Record<string, AnswerFoldMarker>; foldedEventIds: string[]; _writeToken?: string }`
  - `type AnswerSnapshotDraft = Omit<AnswerSnapshot, "revision" | "_writeToken">`
  - `type SnapshotProvenance = { assignee; monthFolderName; legacySeed: AnswerLegacySeed; foldedOffsets: Record<string, number>; compactedAt: string; compactedBy: string }`
  - `snapshotDraftFromFold(fold: AnswerFoldResult, provenance: SnapshotProvenance): AnswerSnapshotDraft`
  - `snapshotAsResume(snapshot: AnswerSnapshotDraft): AnswerFoldResult`
  - `type FoldFn = (events: readonly AnswerEvent[], options: FoldAnswerEventsOptions) => AnswerFoldResult`
  - `type SnapshotDeltaFold = { kind: "resumed"; result: AnswerFoldResult } | { kind: "late"; lateEventId: string }`
  - `foldSnapshotPlusDelta(snapshot: AnswerSnapshotDraft | null, delta: readonly AnswerEvent[], options: { legacySeed: AnswerLegacySeed; username: string; monthFolderName: string; foldFn?: FoldFn }): SnapshotDeltaFold`
  - `v1OffsetKey(segmentName: string): string` → `"_archive-v1/{name}"`; `isV1OffsetKey(key): boolean`

Design note for the implementer: the fold is NOT commutative and a save moves its item to the END of `items`, so resuming is only equal to a full fold when every new event sorts after EVERY event already folded (not just after its own item's). `foldSnapshotPlusDelta` therefore checks every fresh delta event against the snapshot's GLOBAL last folded key (the max over `markers`) and returns `late` otherwise; the caller then rebuilds from scratch (Task 4). Compaction (Task 9) only folds lines older than the quiet window, so `late` is rare (clock skew > 10 min). Keys in `foldedOffsets` for v1 flat segments are `_archive-v1/{name}`, never the bare name: a stable chain keeps its base name across the migration, so a bare v1 key would make the reader skip the first N bytes of the same writer's new v2 segment.

- [ ] **Step 1: Write the failing property test**

```ts
// src/data/answers/v2/answerSnapshot.parity.test.ts
import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../../sampling/rng";
import {
  foldAnswerEvents,
  sortAnswerEventsForFold,
  type AnswerEvent,
  type AnswerFoldResult,
  type AnswerLegacySeed,
} from "../answerEventStore";
import type { ItemAnswer } from "../answerTypes";
import { foldSnapshotPlusDelta, snapshotDraftFromFold, v1OffsetKey } from "./answerSnapshot";

const MONTH = "5-may-2026";
const USER = "emp1";
const LEGACY_ITEM: ItemAnswer = {
  xrayImageId: "X0",
  templateId: "t",
  templateVersion: 1,
  answers: [{ fieldId: "f", value: "legacy" }],
  lastSavedAt: "2026-05-01T00:00:00.000Z",
  submittedAt: "2026-05-01T00:00:00.000Z",
  answeredBy: USER,
  status: "submitted",
};
const LEGACY: AnswerLegacySeed = { contentHash: "h-legacy", items: [LEGACY_ITEM] };
const OPTS = { legacySeed: LEGACY, username: USER, monthFolderName: MONTH };

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function randomEvents(rng: Rng, count: number): AnswerEvent[] {
  const events: AnswerEvent[] = [
    { eventId: "seed", eventType: "migration-seed", eventAt: "2026-05-01T00:00:00.000Z", eventBy: USER, authority: "self", answeredBy: USER, legacyContentHash: LEGACY.contentHash },
  ];
  for (let i = 0; i < count; i += 1) {
    const eventAt = new Date(Date.UTC(2026, 4, 2, 8, 0) + Math.floor(rng() * 600) * 60_000).toISOString();
    const type = pick(rng, ["item-saved", "item-saved", "item-reopened", "quality-note-set"] as const);
    const supervisor = rng() < 0.3;
    const base = { eventId: `e${i}`, eventType: type, eventAt, eventBy: supervisor ? "sup1" : USER, authority: supervisor ? "supervisor" : "self", xrayImageId: pick(rng, ["X0", "X1", "X2", "X3"]), answeredBy: USER } as const;
    if (type === "item-saved") {
      events.push({ ...base, answers: [{ fieldId: "f", value: `v${i}` }], status: rng() < 0.5 ? "submitted" : "draft", ...(supervisor ? { answeredOnBehalfBy: "sup1", reason: "r" } : {}) });
    } else if (type === "quality-note-set") {
      events.push({ ...base, qualityNote: `n${i}` });
    } else {
      events.push({ ...base, reason: "r" });
    }
  }
  // A retried append after an ambiguous failure: same id, same content.
  if (events.length > 3) events.push({ ...events[2]! });
  return events;
}

function comparable(result: AnswerFoldResult) {
  return { items: result.file.items, markers: result.markers, seeded: result.seeded, foldedEventIds: result.foldedEventIds, eventSetId: result.eventSetId };
}

function snapshotOf(prefix: readonly AnswerEvent[]) {
  return snapshotDraftFromFold(foldAnswerEvents(prefix, OPTS), {
    assignee: USER, monthFolderName: MONTH, legacySeed: LEGACY, foldedOffsets: {}, compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: USER,
  });
}

describe("read(snapshot + live delta) == full fold (spec §5, §10)", () => {
  it("time-ordered compaction cut: always resumes and always equals the full fold (300 seeds)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = createRng(seed);
      const events = randomEvents(rng, 3 + Math.floor(rng() * 40));
      const full = foldAnswerEvents(events, OPTS);
      const ordered = sortAnswerEventsForFold([...events]);
      const cut = Math.floor(rng() * (ordered.length + 1));
      const delta = ordered.slice(cut).reverse(); // arrival order must not matter
      const merged = foldSnapshotPlusDelta(snapshotOf(ordered.slice(0, cut)), delta, OPTS);
      expect(merged.kind, `seed ${seed}`).toBe("resumed");
      if (merged.kind === "resumed") expect(comparable(merged.result), `seed ${seed}`).toEqual(comparable(full));
    }
  });

  it("random-subset cut: a late delta is reported, never silently merged (300 seeds)", () => {
    let late = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = createRng(10_000 + seed);
      const events = randomEvents(rng, 5 + Math.floor(rng() * 30));
      const full = foldAnswerEvents(events, OPTS);
      const prefix = events.filter((event) => event.eventType === "migration-seed" || rng() < 0.5);
      const prefixIds = new Set(prefix.map((event) => event.eventId));
      const delta = events.filter((event) => !prefixIds.has(event.eventId));
      const merged = foldSnapshotPlusDelta(snapshotOf(prefix), delta, OPTS);
      if (merged.kind === "late") late += 1;
      else expect(comparable(merged.result), `seed ${seed}`).toEqual(comparable(full));
    }
    expect(late).toBeGreaterThan(0);
  });

  it("no snapshot → a plain fold of the delta", () => {
    const events = randomEvents(createRng(7), 10);
    const merged = foldSnapshotPlusDelta(null, events, OPTS);
    expect(merged.kind).toBe("resumed");
    if (merged.kind === "resumed") expect(comparable(merged.result)).toEqual(comparable(foldAnswerEvents(events, OPTS)));
  });

  it("v1 offset keys never collide with a bare live segment name", () => {
    expect(v1OffsetKey("abc-ans-dev-ch.ndjson")).toBe("_archive-v1/abc-ans-dev-ch.ndjson");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/v2/answerSnapshot.parity.test.ts`
Expected: FAIL — module `./answerSnapshot` not found.

- [ ] **Step 3: Implement `answerSnapshot.ts`**

```ts
// src/data/answers/v2/answerSnapshot.ts
//
// Layout v2 (spec 2026-10-13 §4/§5): the per-assignee snapshot and the PURE
// fold that resumes it with the live delta. No I/O here.
import {
  ANSWER_DERIVE_VERSION,
  answerEventSetIdFromIds,
  compareAnswerEventsForFold,
  foldAnswerEvents,
  type AnswerEvent,
  type AnswerFoldMarker,
  type AnswerFoldResult,
  type AnswerLegacySeed,
  type FoldAnswerEventsOptions,
} from "../answerEventStore";
import type { ItemAnswer } from "../answerTypes";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";

export const ANSWER_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * `{assignee}/snapshot.json`'s payload (wrapped in a JsonEnvelope on disk).
 *
 * Spec §4's fields, plus three it implies but does not name, without which the
 * snapshot is not RESUMABLE by `foldAnswerEvents`: `seeded` (§8's migration
 * marker state), `markers` (late-event guard), `foldedEventIds` (dedup of a
 * retried append whose copy lands in a later segment).
 */
export type AnswerSnapshot = {
  schemaVersion: typeof ANSWER_SNAPSHOT_SCHEMA_VERSION;
  assignee: string;
  monthFolderName: string;
  items: ItemAnswer[];
  legacySeed: AnswerLegacySeed;
  /** Bytes already inside `items`, per segment. Bare key = a segment in `{assignee}/` or `{assignee}/archive/`; `_archive-v1/{name}` = a v1 flat segment. */
  foldedOffsets: Record<string, number>;
  foldedEventCount: number;
  revision: number;
  compactedAt: string;
  compactedBy: string;
  seeded: boolean;
  markers: Record<string, AnswerFoldMarker>;
  foldedEventIds: string[];
  _writeToken?: string;
};

export type AnswerSnapshotDraft = Omit<AnswerSnapshot, "revision" | "_writeToken">;

export type SnapshotProvenance = {
  assignee: string;
  monthFolderName: string;
  legacySeed: AnswerLegacySeed;
  foldedOffsets: Record<string, number>;
  compactedAt: string;
  compactedBy: string;
};

export type FoldFn = (events: readonly AnswerEvent[], options: FoldAnswerEventsOptions) => AnswerFoldResult;

export function v1OffsetKey(segmentName: string): string {
  return `${ANSWER_EVENTS_FOLDERS.archiveV1}/${segmentName}`;
}

export function isV1OffsetKey(key: string): boolean {
  return key.startsWith(`${ANSWER_EVENTS_FOLDERS.archiveV1}/`);
}

export function snapshotDraftFromFold(fold: AnswerFoldResult, provenance: SnapshotProvenance): AnswerSnapshotDraft {
  return {
    schemaVersion: ANSWER_SNAPSHOT_SCHEMA_VERSION,
    assignee: provenance.assignee,
    monthFolderName: provenance.monthFolderName,
    items: fold.file.items,
    legacySeed: { contentHash: provenance.legacySeed.contentHash, items: [...provenance.legacySeed.items] },
    foldedOffsets: { ...provenance.foldedOffsets },
    foldedEventCount: fold.foldedEventIds.length,
    compactedAt: provenance.compactedAt,
    compactedBy: provenance.compactedBy,
    seeded: fold.seeded,
    markers: { ...fold.markers },
    foldedEventIds: [...fold.foldedEventIds],
  };
}

export function snapshotAsResume(snapshot: AnswerSnapshotDraft): AnswerFoldResult {
  return {
    file: {
      username: snapshot.assignee,
      monthFolderName: snapshot.monthFolderName,
      items: snapshot.items.map((item) => ({ ...item })),
    },
    markers: { ...snapshot.markers },
    seeded: snapshot.seeded,
    foldedEventIds: [...snapshot.foldedEventIds],
    eventSetId: answerEventSetIdFromIds(snapshot.foldedEventIds),
    deriveVersion: ANSWER_DERIVE_VERSION,
    refusals: [],
    dropped: [],
  };
}

/** The greatest fold key already folded, as a probe event; "unknown" for a marker missing its order fields. */
function lastFoldedProbe(markers: Readonly<Record<string, AnswerFoldMarker>>): AnswerEvent | null | "unknown" {
  let last: AnswerEvent | null = null;
  for (const [xrayImageId, marker] of Object.entries(markers)) {
    if (!marker.lastEventId || !marker.lastAuthority) return "unknown";
    const probe: AnswerEvent = {
      eventId: marker.lastEventId,
      eventType: "item-saved",
      eventAt: marker.lastEventAt,
      eventBy: "",
      authority: marker.lastAuthority,
      xrayImageId,
    };
    if (last === null || compareAnswerEventsForFold(probe, last) > 0) last = probe;
  }
  return last;
}

export type SnapshotDeltaFold =
  | { kind: "resumed"; result: AnswerFoldResult }
  | { kind: "late"; lateEventId: string };

export function foldSnapshotPlusDelta(
  snapshot: AnswerSnapshotDraft | null,
  delta: readonly AnswerEvent[],
  options: { legacySeed: AnswerLegacySeed; username: string; monthFolderName: string; foldFn?: FoldFn }
): SnapshotDeltaFold {
  const fold = options.foldFn ?? foldAnswerEvents;
  const base = {
    legacySeed: snapshot?.legacySeed ?? options.legacySeed,
    username: options.username,
    monthFolderName: options.monthFolderName,
  };
  if (!snapshot || snapshot.foldedEventIds.length === 0) return { kind: "resumed", result: fold(delta, base) };
  const known = new Set(snapshot.foldedEventIds);
  const last = lastFoldedProbe(snapshot.markers);
  for (const event of delta) {
    if (known.has(event.eventId)) continue;
    if (event.eventType === "migration-seed") {
      // Applied as the BASELINE by a full fold; only harmless when it seeds nothing or the chain is already seeded.
      if (!snapshot.seeded && (event.legacyContentHash ?? "") !== "") return { kind: "late", lateEventId: event.eventId };
      continue;
    }
    if (last === "unknown" || (last !== null && compareAnswerEventsForFold(event, last) < 0)) {
      return { kind: "late", lateEventId: event.eventId };
    }
  }
  return { kind: "resumed", result: fold(delta, { ...base, resume: snapshotAsResume(snapshot) }) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/answers/v2/answerSnapshot.parity.test.ts`
Expected: PASS (4). If the time-ordered test reports a seed, print `ordered.map(e => e.eventId)` for that seed and fix the implementation — never the test.

- [ ] **Step 5: Commit**

```bash
git add src/data/answers/v2/answerSnapshot.ts src/data/answers/v2/answerSnapshot.parity.test.ts
git commit -m "Add (answers): pure snapshot+delta fold with seeded parity property test"
```

---

### Task 3: Snapshot store — stat, read (with `.bak` detection), CAS write

**Files:**
- Create: `src/data/answers/v2/answerSnapshotStore.ts`
- Test: `src/data/answers/v2/answerSnapshotStore.test.ts` (create)

**Interfaces:**
- Consumes: `safeReadJson<T>(dir, fileName): Promise<SafeReadResult<T>>` where `SafeReadResult<T> = { ok: true; value: T; recoveredFromBak: boolean; rawText: string } | { ok: false; reason: "missing" | "corrupt" }` (`safeWrite.ts:88-90`, `:2706`); `safeWriteJson(dir, fileName, value, options?)` (`:2015`); `casLoop<T>(fn: (writeToken) => Promise<CasAttemptResult<T>>, options?): Promise<T | { ok: false; error: string }>` (`casLoop.ts:178-242`); `readBackOwnWrite(written, read, isMine, context?): Promise<"mine" | "not-mine" | "unconfirmed">` (`casLoop.ts:122-127`); `wrap(data, previousRevision)`, `unwrap<T>(value)`, `JsonEnvelope<T>` (`jsonEnvelope.ts:141`, `:165`); `withResourceLock`, `directoryResourceKey(dir, entryName)` (`webLocks.ts:33`, `:79`); `ANSWER_EVENTS_FOLDERS` (Task 1); `AnswerSnapshot`, `AnswerSnapshotDraft`, `ANSWER_SNAPSHOT_SCHEMA_VERSION` (Task 2).
- Produces:
  - `type SnapshotStat = { size: number; lastModified: number }`; `sameSnapshotStat(a, b): boolean`
  - `statAnswerSnapshot(assigneeDir): Promise<SnapshotStat | null>`
  - `type SnapshotRead = { kind: "absent" } | { kind: "ok"; snapshot: AnswerSnapshot } | { kind: "recovered-from-bak"; snapshot: AnswerSnapshot }`
  - `class AnswerSnapshotCorruptError extends Error`
  - `readAnswerSnapshot(assigneeDir): Promise<SnapshotRead>` (throws `AnswerSnapshotCorruptError` on corrupt/invalid)
  - `type SnapshotWriteResult = { ok: true; status: "written"; snapshot: AnswerSnapshot } | { ok: true; status: "conflict"; currentRevision: number }`
  - `writeAnswerSnapshotCas(assigneeDir, expectedRevision: number, draft: AnswerSnapshotDraft, context: string): Promise<SnapshotWriteResult | { ok: false; error: string }>` — `expectedRevision` 0 = "absent or corrupt".

- [ ] **Step 1: Write the failing test**

```ts
// src/data/answers/v2/answerSnapshotStore.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";
import { ANSWER_SNAPSHOT_SCHEMA_VERSION, type AnswerSnapshotDraft } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, statAnswerSnapshot, writeAnswerSnapshotCas } from "./answerSnapshotStore";

function draft(note: string): AnswerSnapshotDraft {
  return {
    schemaVersion: ANSWER_SNAPSHOT_SCHEMA_VERSION, assignee: "emp1", monthFolderName: "5-may-2026", items: [],
    legacySeed: { contentHash: "", items: [] }, foldedOffsets: { [note]: 1 }, foldedEventCount: 0,
    compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: "emp1", seeded: true, markers: {}, foldedEventIds: [],
  };
}

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await writable.write(text);
  await writable.close();
}

describe("answer snapshot store", () => {
  it("absent → kind absent, stat null; first CAS write gets revision 1", async () => {
    const dir = createMemoryDirectory("snap");
    expect(await readAnswerSnapshot(dir)).toEqual({ kind: "absent" });
    expect(await statAnswerSnapshot(dir)).toBeNull();
    const written = await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    expect(written).toMatchObject({ ok: true, status: "written", snapshot: { revision: 1 } });
    const read = await readAnswerSnapshot(dir);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") expect(read.snapshot.foldedOffsets).toEqual({ a: 1 });
    expect(await statAnswerSnapshot(dir)).not.toBeNull();
  });

  it("a stale expected revision is a conflict and writes nothing", async () => {
    const dir = createMemoryDirectory("cas");
    await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    await writeAnswerSnapshotCas(dir, 1, draft("b"), "test");
    const lost = await writeAnswerSnapshotCas(dir, 1, draft("c"), "test");
    expect(lost).toEqual({ ok: true, status: "conflict", currentRevision: 2 });
    const read = await readAnswerSnapshot(dir);
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(read.snapshot.foldedOffsets).toEqual({ b: 1 });
  });

  it("a corrupt live file recovered from .bak is reported as recovered-from-bak (never as ok)", async () => {
    const dir = createMemoryDirectory("bak");
    await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    await writeAnswerSnapshotCas(dir, 1, draft("b"), "test");
    await writeRaw(dir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, "{ torn");
    const read = await readAnswerSnapshot(dir);
    expect(read.kind).toBe("recovered-from-bak");
  });

  it("a structurally wrong payload throws AnswerSnapshotCorruptError", async () => {
    const dir = createMemoryDirectory("bad");
    await writeRaw(dir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, JSON.stringify({ hello: "world" }));
    await expect(readAnswerSnapshot(dir)).rejects.toBeInstanceOf(AnswerSnapshotCorruptError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/v2/answerSnapshotStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `answerSnapshotStore.ts`**

```ts
// src/data/answers/v2/answerSnapshotStore.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { casLoop, readBackOwnWrite } from "../../storage/casLoop";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { directoryResourceKey, withResourceLock } from "../../storage/webLocks";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";
import { ANSWER_SNAPSHOT_SCHEMA_VERSION, type AnswerSnapshot, type AnswerSnapshotDraft } from "./answerSnapshot";

const SNAPSHOT = ANSWER_EVENTS_FOLDERS.assigneeSnapshot;

export type SnapshotStat = { size: number; lastModified: number };

export function sameSnapshotStat(a: SnapshotStat | null, b: SnapshotStat | null): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && a.lastModified === b.lastModified;
}

/** Metadata only (one getFile, no content) — the reader's "did a compaction commit under me?" check. */
export async function statAnswerSnapshot(assigneeDir: DirectoryHandleLike): Promise<SnapshotStat | null> {
  try {
    const file = await (await assigneeDir.getFileHandle(SNAPSHOT, { create: false })).getFile();
    return { size: file.size, lastModified: file.lastModified };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export class AnswerSnapshotCorruptError extends Error {
  constructor(folder: string) {
    super(`Answer snapshot in ${folder} is unreadable or not a snapshot`);
    this.name = "AnswerSnapshotCorruptError";
  }
}

export type SnapshotRead =
  | { kind: "absent" }
  | { kind: "ok"; snapshot: AnswerSnapshot }
  | { kind: "recovered-from-bak"; snapshot: AnswerSnapshot };

function isAnswerSnapshot(value: unknown): value is AnswerSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AnswerSnapshot>;
  return (
    v.schemaVersion === ANSWER_SNAPSHOT_SCHEMA_VERSION &&
    Array.isArray(v.items) &&
    Array.isArray(v.foldedEventIds) &&
    typeof v.revision === "number" &&
    typeof v.foldedOffsets === "object" && v.foldedOffsets !== null &&
    typeof v.markers === "object" && v.markers !== null &&
    typeof v.legacySeed === "object" && v.legacySeed !== null
  );
}

/**
 * A `.bak` recovery is REPORTED, not served: the backup is the PREVIOUS
 * snapshot, written before the segments the current one folded were moved to
 * `archive/`. The reader (Task 4) rebuilds from archive + live in that case.
 */
export async function readAnswerSnapshot(assigneeDir: DirectoryHandleLike): Promise<SnapshotRead> {
  const read = await safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT);
  if (!read.ok) {
    if (read.reason === "missing") return { kind: "absent" };
    throw new AnswerSnapshotCorruptError(assigneeDir.name);
  }
  const snapshot = unwrap<AnswerSnapshot>(read.value);
  if (!isAnswerSnapshot(snapshot)) throw new AnswerSnapshotCorruptError(assigneeDir.name);
  return read.recoveredFromBak ? { kind: "recovered-from-bak", snapshot } : { kind: "ok", snapshot };
}

function revisionOf(value: unknown): number {
  const snapshot = unwrap<Partial<AnswerSnapshot> | null>(value);
  return snapshot && typeof snapshot.revision === "number" ? snapshot.revision : 0;
}

export type SnapshotWriteResult =
  | { ok: true; status: "written"; snapshot: AnswerSnapshot }
  | { ok: true; status: "conflict"; currentRevision: number };

/**
 * Compare-and-swap on `revision` (spec §7 step 2). A conflict is a RESULT, not
 * a retry: the caller (compaction) aborts, another tab already compacted.
 * `readBackOwnWrite` + `_writeToken` catch the cross-machine lost-update case
 * the revision alone cannot (same pattern as feedbackStorage's threads index).
 */
export async function writeAnswerSnapshotCas(
  assigneeDir: DirectoryHandleLike,
  expectedRevision: number,
  draft: AnswerSnapshotDraft,
  context: string
): Promise<SnapshotWriteResult | { ok: false; error: string }> {
  return withResourceLock(`${directoryResourceKey(assigneeDir, SNAPSHOT)}:cas`, () =>
    casLoop<SnapshotWriteResult>(
      async (writeToken) => {
        const current = await safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT);
        const currentRevision = current.ok ? revisionOf(current.value) : 0;
        if (currentRevision !== expectedRevision) {
          return { done: true, result: { ok: true, status: "conflict", currentRevision } };
        }
        const next: AnswerSnapshot = { ...draft, revision: expectedRevision + 1, _writeToken: writeToken };
        const written = await safeWriteJson(assigneeDir, SNAPSHOT, wrap(next, expectedRevision));
        const verdict = await readBackOwnWrite(
          written,
          () => safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT),
          (verify) =>
            verify.ok &&
            revisionOf(verify.value) === next.revision &&
            unwrap<AnswerSnapshot>(verify.value)._writeToken === writeToken,
          context
        );
        return verdict === "not-mine"
          ? { done: false }
          : { done: true, result: { ok: true, status: "written", snapshot: next } };
      },
      { context, maxRetries: 3, baseDelayMs: 100 }
    )
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/answers/v2/answerSnapshotStore.test.ts`
Expected: PASS (4). If the `.bak` test reports `ok`, confirm `safeWriteJson` keeps a `.bak` of the previous commit in `memoryDirectory` (it does for every second write) and that the torn text was written to the live name.

- [ ] **Step 5: Commit**

```bash
git add src/data/answers/v2/answerSnapshotStore.ts src/data/answers/v2/answerSnapshotStore.test.ts
git commit -m "Add (answers): snapshot store with .bak detection and CAS write"
```

---

### Task 4: Per-assignee disk reader, full rebuild, and the v2 `loadEmployeeItemState`

**Files:**
- Create: `src/data/answers/v2/assigneeEventReader.ts`, `src/data/answers/v2/rebuildAssigneeSnapshot.ts`, `src/data/answers/v2/v2TestFixtures.ts`
- Modify: `src/data/answers/answerStorage.ts` — export `foldEmployeeEvents` (`:564`); add `loadLegacyAnswerSeed` after `legacyContentHashOf` (`:643-645`); branch `loadEmployeeItemState` (`:662-693`)
- Test: `src/data/answers/v2/assigneeEventReader.test.ts` (create)

**Interfaces:**
- Consumes: `readAnswerEventDelta(parentDir, knownOffsets, config, options?: { strict?; tolerateConfirmedDead?; sealedConfirmed? }): Promise<SegmentEventsDelta<AnswerEvent>>` (`answerEventStore.ts:223`), where `SegmentEventsDelta = { events; offsets; segmentNames; sealedConfirmedNames; unreadableNames }` (`appendOnlyEventLog.ts:1555-1576`) and the reader opens `parentDir.getDirectoryHandle(config.eventsDirName)` (NotFound → empty delta, `:1636-1644`). `ANSWER_EVENT_LOG` (`answerEventStore.ts:198`). `listDirectoryEntries(dir): Promise<{name, kind}[]>` (`directoryScan.ts:74`). Tasks 1–3.
- Produces:
  - `assigneeSegmentConfig(assignee): AppendOnlyEventLogConfig` (`eventsDirName` = folder name; parent = `answers.events/`)
  - `assigneeArchiveConfig(): AppendOnlyEventLogConfig` (`eventsDirName = "archive"`; parent = `{assignee}/`)
  - `type AssigneeReadOptions = { loadLegacySeed: () => Promise<AnswerLegacySeed>; foldFn?: FoldFn; strict?: boolean; tolerateConfirmedDead?: boolean; knownOffsets?: Record<string, number>; cachedDelta?: readonly AnswerEvent[]; cachedSnapshot?: { stat: SnapshotStat; snapshot: AnswerSnapshot } | null }`
  - `type AssigneeReadResult = { result: AnswerFoldResult; snapshot: AnswerSnapshot | null; snapshotStat: SnapshotStat | null; legacySeed: AnswerLegacySeed; deltaEvents: AnswerEvent[]; liveOffsets: Record<string, number>; liveSegmentNames: string[]; unreadableNames: string[]; rebuilt: boolean; archiveOffsets: Record<string, number> }`
  - `readAssigneeState(root, month, assignee, options): Promise<AssigneeReadResult>`
  - `rebuildAssigneeState(root, month, assignee, options): Promise<AssigneeReadResult>` (`rebuilt: true`)
  - `readAllAssigneeEvents(root, month, assignee, options?: { strict?; tolerateConfirmedDead? }): Promise<{ events: AnswerEvent[]; liveOffsets; liveSegmentNames; archiveOffsets; unreadableNames }>`
  - `listAssigneeFolders(root, month): Promise<string[]>`
  - `__setAfterSnapshotReadHookForTests(hook: (() => Promise<void>) | null): void`
  - `rebuildAndPersistAssigneeSnapshot(root, month, assignee, deps: { actor: string; loadLegacySeed; foldFn?: FoldFn; extraOffsets?: Record<string, number>; nowMs?: number }): Promise<{ status: "written"; revision: number } | { status: "no-events" }>`
  - From `answerStorage.ts`: `export function foldEmployeeEvents(...)` (now exported), `export async function loadLegacyAnswerSeed(dir, month, username): Promise<AnswerLegacySeed>`

- [ ] **Step 1: Create the test fixtures module**

```ts
// src/data/answers/v2/v2TestFixtures.ts
// TEST-ONLY helpers for layout-v2 tests. Never imported by production code.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { encodeEventLine } from "../../storage/appendOnlyEventLog";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getAssigneeAnswerEventsDir } from "../../workspace/workspacePaths";
import type { AnswerEvent } from "../answerEventStore";

export const V2_MONTH = "5-may-2026";

/** An `item-saved` for `assignee`, `minute` minutes after 2026-05-02T08:00Z. */
export function savedEvent(id: string, minute: number, overrides: Partial<AnswerEvent> = {}, assignee = "emp1"): AnswerEvent {
  return {
    eventId: id,
    eventType: "item-saved",
    eventAt: new Date(Date.UTC(2026, 4, 2, 8, 0) + minute * 60_000).toISOString(),
    eventBy: assignee,
    authority: "self",
    xrayImageId: `X-${id}`,
    answers: [{ fieldId: "f", value: id }],
    status: "draft",
    answeredBy: assignee,
    ...overrides,
  };
}

/** The empty-legacy migration seed every chain starts with. */
export function seedEvent(assignee = "emp1"): AnswerEvent {
  return { eventId: `seed-${assignee}`, eventType: "migration-seed", eventAt: "2026-05-01T00:00:00.000Z", eventBy: assignee, authority: "self", answeredBy: assignee, legacyContentHash: "" };
}

export async function writeText(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await writable.write(text);
  await writable.close();
}

export async function readText(dir: DirectoryHandleLike, name: string): Promise<string> {
  return (await (await dir.getFileHandle(name, { create: false })).getFile()).text();
}

/** Write a raw segment `{name}` with `events` into `answers.events/{assignee}/`. */
export async function writeAssigneeSegment(root: DirectoryHandleLike, assignee: string, name: string, events: readonly AnswerEvent[], month = V2_MONTH): Promise<DirectoryHandleLike> {
  const dir = await getAssigneeAnswerEventsDir(root, month, assignee, true);
  await writeText(dir, name, events.map(encodeEventLine).join(""));
  return dir;
}

/** Append raw lines to an existing segment, exactly as appendEventSegment's rewrite leaves it (prefix preserved). */
export async function appendToSegment(dir: DirectoryHandleLike, name: string, events: readonly AnswerEvent[]): Promise<void> {
  const before = await readText(dir, name);
  await writeText(dir, name, before + events.map(encodeEventLine).join(""));
}

/** Stamp a month v2 (marker only — what a new month gets). */
export async function makeV2Month(root: DirectoryHandleLike, month = V2_MONTH): Promise<void> {
  const events = await getAnswerEventsDir(root, month, true);
  await writeText(events, ANSWER_EVENTS_FOLDERS.layoutMarker, JSON.stringify({ layout: "per-assignee", schemaVersion: 1, migratedAt: "2026-05-01T00:00:00.000Z", migratedBy: "test", flatSegmentsArchived: 0, assignees: 0, unmovable: [], origin: "new-month" }));
}

/** Keep a fresh month on the v1 flat layout (an existing `answers.events/` with no marker). */
export async function makeV1Month(root: DirectoryHandleLike, month = V2_MONTH): Promise<void> {
  await getAnswerEventsDir(root, month, true);
}

export async function fileNames(dir: DirectoryHandleLike, suffix = ".ndjson"): Promise<string[]> {
  return (await listDirectoryEntries(dir)).filter((e) => e.kind === "file" && e.name.endsWith(suffix)).map((e) => e.name).sort();
}
```

- [ ] **Step 2: Write the failing reader test**

```ts
// src/data/answers/v2/assigneeEventReader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { copyFileBytesVerified } from "../../storage/safeWrite";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAssigneeAnswerEventsDir, getAssigneeArchiveDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { foldAnswerEvents, type AnswerEvent, type AnswerFoldResult } from "../answerEventStore";
import { snapshotDraftFromFold } from "./answerSnapshot";
import { writeAnswerSnapshotCas } from "./answerSnapshotStore";
import { __setAfterSnapshotReadHookForTests, readAssigneeState } from "./assigneeEventReader";
import { makeV2Month, savedEvent, seedEvent, writeAssigneeSegment, writeText, V2_MONTH } from "./v2TestFixtures";

const LEGACY = { contentHash: "", items: [] };
const loadLegacySeed = async () => LEGACY;

function items(result: AnswerFoldResult) {
  return result.file.items;
}

async function snapshotCovering(root: ReturnType<typeof createMemoryDirectory>, events: AnswerEvent[], offsets: Record<string, number>, expectedRevision = 0) {
  const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1", true);
  const fold = foldAnswerEvents(events, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH });
  const written = await writeAnswerSnapshotCas(dir, expectedRevision, snapshotDraftFromFold(fold, { assignee: "emp1", monthFolderName: V2_MONTH, legacySeed: LEGACY, foldedOffsets: offsets, compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: "emp1" }), "test");
  if (!written.ok || written.status !== "written") throw new Error("snapshot write failed");
}

async function sizeOf(root: ReturnType<typeof createMemoryDirectory>, name: string): Promise<number> {
  const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1", false);
  return (await (await dir.getFileHandle(name)).getFile()).size;
}

describe("readAssigneeState (spec §5)", () => {
  beforeEach(async () => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });
  afterEach(() => __setAfterSnapshotReadHookForTests(null));

  it("snapshot + live past foldedOffsets == full fold, and archived segments are never listed", async () => {
    const root = createMemoryDirectory("r1");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1), savedEvent("a2", 2)];
    const b = [savedEvent("b1", 30), savedEvent("a1", 31, { answers: [{ fieldId: "f", value: "edited" }], xrayImageId: "X-a1", eventId: "a1-edit" })];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await writeAssigneeSegment(root, "emp1", "w-ans-devb-sesb.ndjson", b);
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") });
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(false);
    expect(items(read.result)).toEqual(items(foldAnswerEvents([...a, ...b], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH })));
    expect(read.deltaEvents.map((e) => e.eventId).sort()).toEqual(["a1-edit", "b1"]);
  });

  it("snapshot recovered from .bak is never served (Review Focus 1)", async () => {
    const root = createMemoryDirectory("r2");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1)];
    const assigneeDir = await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await snapshotCovering(root, [], {}, 0); // rev 1: covers nothing
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") }, 1); // rev 2
    const archive = await getAssigneeArchiveDir(root, V2_MONTH, "emp1", true);
    await copyFileBytesVerified(assigneeDir, "w-ans-deva-sesa.ndjson", archive, "w-ans-deva-sesa.ndjson");
    await assigneeDir.removeEntry!("w-ans-deva-sesa.ndjson");
    await writeText(assigneeDir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, "{ torn"); // live corrupt → .bak (rev 1) would be served
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(true);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-a1"]);
  });

  it("compaction committing mid-read is detected and retried (Review Focus 2)", async () => {
    const root = createMemoryDirectory("r3");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1)];
    const assigneeDir = await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    let fired = false;
    __setAfterSnapshotReadHookForTests(async () => {
      if (fired) return;
      fired = true; // a compaction: fold A into a new snapshot, then move A to archive/
      await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") }, 0);
      const archive = await getAssigneeArchiveDir(root, V2_MONTH, "emp1", true);
      await copyFileBytesVerified(assigneeDir, "w-ans-deva-sesa.ndjson", archive, "w-ans-deva-sesa.ndjson");
      await assigneeDir.removeEntry!("w-ans-deva-sesa.ndjson");
    });
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(fired).toBe(true);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-a1"]);
  });

  it("a delta event older than the snapshot's last folded event forces a rebuild", async () => {
    const root = createMemoryDirectory("r4");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 100)];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") });
    const late = [savedEvent("b1", 5)];
    await writeAssigneeSegment(root, "emp1", "w-ans-devb-sesb.ndjson", late);
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(true);
    expect(items(read.result)).toEqual(items(foldAnswerEvents([...a, ...late], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH })));
  });

  it("no folder at all → the legacy items pass through, unseeded (same as v1's no-events read)", async () => {
    const root = createMemoryDirectory("r5");
    await makeV2Month(root);
    const legacyItem = { ...savedEvent("L", 0), xrayImageId: "X-L" };
    const read = await readAssigneeState(root, V2_MONTH, "emp1", {
      loadLegacySeed: async () => ({ contentHash: "h", items: [{ xrayImageId: "X-L", templateId: "t", templateVersion: 1, answers: [], lastSavedAt: legacyItem.eventAt, submittedAt: null, answeredBy: "emp1", status: "draft" }] }),
    });
    expect(read.result.seeded).toBe(false);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-L"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/answers/v2/assigneeEventReader.test.ts`
Expected: FAIL — `./assigneeEventReader` not found.

- [ ] **Step 4: Implement `assigneeEventReader.ts`**

```ts
// src/data/answers/v2/assigneeEventReader.ts
//
// Layout v2 read model (spec 2026-10-13 §5): snapshot.json + live segments
// past `foldedOffsets`. Anything that makes the snapshot untrustworthy (a .bak
// recovery, corruption, a late event, a snapshot that keeps changing under the
// read) falls back to a FULL rebuild from `{assignee}/archive/` + live — never
// to "empty" (P0-1).
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import type { AppendOnlyEventLogConfig } from "../../storage/appendOnlyEventLog";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import {
  ANSWER_EVENTS_FOLDERS,
  answerAssigneeFolderName,
  getAnswerEventsDir,
  getAssigneeAnswerEventsDir,
  isAnswerAssigneeFolderName,
} from "../../workspace/workspacePaths";
import {
  ANSWER_DERIVE_VERSION,
  ANSWER_EVENT_LOG,
  answerEventSetIdFromIds,
  foldAnswerEvents,
  readAnswerEventDelta,
  type AnswerEvent,
  type AnswerFoldResult,
  type AnswerLegacySeed,
} from "../answerEventStore";
import { foldSnapshotPlusDelta, type AnswerSnapshot, type FoldFn } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, sameSnapshotStat, statAnswerSnapshot, type SnapshotStat } from "./answerSnapshotStore";

export function assigneeSegmentConfig(assignee: string): AppendOnlyEventLogConfig {
  return { ...ANSWER_EVENT_LOG, eventsDirName: answerAssigneeFolderName(assignee) };
}

export function assigneeArchiveConfig(): AppendOnlyEventLogConfig {
  return { ...ANSWER_EVENT_LOG, eventsDirName: ANSWER_EVENTS_FOLDERS.assigneeArchive };
}

export type AssigneeReadOptions = {
  loadLegacySeed: () => Promise<AnswerLegacySeed>;
  foldFn?: FoldFn;
  strict?: boolean;
  tolerateConfirmedDead?: boolean;
  /** Bytes this tab already consumed past the snapshot, per BARE live name (Task 10 cache). */
  knownOffsets?: Record<string, number>;
  /** Events read from those bytes (Task 10 cache). */
  cachedDelta?: readonly AnswerEvent[];
  /** A snapshot this tab already parsed — reused while its stat is unchanged (Task 10 cache). */
  cachedSnapshot?: { stat: SnapshotStat; snapshot: AnswerSnapshot } | null;
};

export type AssigneeReadResult = {
  result: AnswerFoldResult;
  snapshot: AnswerSnapshot | null;
  snapshotStat: SnapshotStat | null;
  legacySeed: AnswerLegacySeed;
  /** Events past the snapshot (all events when `rebuilt`). */
  deltaEvents: AnswerEvent[];
  liveOffsets: Record<string, number>;
  liveSegmentNames: string[];
  unreadableNames: string[];
  rebuilt: boolean;
  archiveOffsets: Record<string, number>;
};

const MAX_SNAPSHOT_RACE_ATTEMPTS = 3;
let afterSnapshotReadHook: (() => Promise<void>) | null = null;

/** Test seam: runs between the snapshot read and the segment listing. */
export function __setAfterSnapshotReadHookForTests(hook: (() => Promise<void>) | null): void {
  afterSnapshotReadHook = hook;
}

function dedupeById(events: Iterable<AnswerEvent>): AnswerEvent[] {
  const byId = new Map<string, AnswerEvent>();
  for (const event of events) byId.set(event.eventId, event);
  return [...byId.values()];
}

/** v1's `ownEvents.length === 0` read: the legacy file's items, unfolded and unseeded. */
function passthrough(legacySeed: AnswerLegacySeed, assignee: string, month: string): AnswerFoldResult {
  return {
    file: { username: assignee, monthFolderName: month, items: legacySeed.items.map((item) => ({ ...item })) },
    markers: {}, seeded: false, foldedEventIds: [], eventSetId: answerEventSetIdFromIds([]),
    deriveVersion: ANSWER_DERIVE_VERSION, refusals: [], dropped: [],
  };
}

function bareOffsets(snapshot: AnswerSnapshot | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot?.foldedOffsets ?? {})) if (!key.includes("/")) out[key] = value;
  return out;
}

function maxOffsets(a: Record<string, number>, b: Record<string, number> | undefined): Record<string, number> {
  const out = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) out[key] = Math.max(out[key] ?? 0, value);
  return out;
}

function onlyListed(offsets: Record<string, number>, names: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) if (offsets[name] !== undefined) out[name] = offsets[name]!;
  return out;
}

async function openAssigneeDir(root: DirectoryHandleLike, month: string, assignee: string): Promise<DirectoryHandleLike | null> {
  try {
    return await getAssigneeAnswerEventsDir(root, month, assignee, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Every event of one assignee: `{assignee}/archive/` + live, from byte 0, deduped by id. */
export async function readAllAssigneeEvents(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: { strict?: boolean; tolerateConfirmedDead?: boolean } = {}
): Promise<{ events: AnswerEvent[]; liveOffsets: Record<string, number>; liveSegmentNames: string[]; archiveOffsets: Record<string, number>; unreadableNames: string[] }> {
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  if (!assigneeDir) return { events: [], liveOffsets: {}, liveSegmentNames: [], archiveOffsets: {}, unreadableNames: [] };
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const [archive, live] = await Promise.all([
    readAnswerEventDelta(assigneeDir, {}, assigneeArchiveConfig(), options),
    readAnswerEventDelta(eventsDir, {}, assigneeSegmentConfig(assignee), options),
  ]);
  return {
    events: dedupeById([...archive.events, ...live.events]),
    liveOffsets: onlyListed(live.offsets, live.segmentNames),
    liveSegmentNames: live.segmentNames,
    archiveOffsets: onlyListed(archive.offsets, archive.segmentNames),
    unreadableNames: [...archive.unreadableNames, ...live.unreadableNames],
  };
}

export async function rebuildAssigneeState(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: AssigneeReadOptions
): Promise<AssigneeReadResult> {
  const foldFn = options.foldFn ?? foldAnswerEvents;
  const all = await readAllAssigneeEvents(root, month, assignee, options);
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  const snapshotStat = assigneeDir ? await statAnswerSnapshot(assigneeDir) : null;
  const legacySeed = await options.loadLegacySeed();
  const result = all.events.length === 0
    ? passthrough(legacySeed, assignee, month)
    : foldFn(all.events, { legacySeed, username: assignee, monthFolderName: month });
  return {
    result, snapshot: null, snapshotStat, legacySeed, deltaEvents: all.events,
    liveOffsets: all.liveOffsets, liveSegmentNames: all.liveSegmentNames, unreadableNames: all.unreadableNames,
    rebuilt: true, archiveOffsets: all.archiveOffsets,
  };
}

type SnapshotPick = { kind: "use"; snapshot: AnswerSnapshot | null } | { kind: "rebuild" };

async function pickSnapshot(assigneeDir: DirectoryHandleLike, statBefore: SnapshotStat | null, options: AssigneeReadOptions): Promise<SnapshotPick> {
  if (options.cachedSnapshot && sameSnapshotStat(options.cachedSnapshot.stat, statBefore)) {
    return { kind: "use", snapshot: options.cachedSnapshot.snapshot };
  }
  try {
    const read = await readAnswerSnapshot(assigneeDir);
    if (read.kind === "recovered-from-bak") return { kind: "rebuild" };
    return { kind: "use", snapshot: read.kind === "ok" ? read.snapshot : null };
  } catch (error) {
    if (!(error instanceof AnswerSnapshotCorruptError)) throw error;
    logError("answers:v2:snapshot-corrupt", error);
    return { kind: "rebuild" };
  }
}

export async function readAssigneeState(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: AssigneeReadOptions
): Promise<AssigneeReadResult> {
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  if (!assigneeDir) {
    const legacySeed = await options.loadLegacySeed();
    return {
      result: passthrough(legacySeed, assignee, month), snapshot: null, snapshotStat: null, legacySeed,
      deltaEvents: [], liveOffsets: {}, liveSegmentNames: [], unreadableNames: [], rebuilt: false, archiveOffsets: {},
    };
  }
  const eventsDir = await getAnswerEventsDir(root, month, false);
  for (let attempt = 0; attempt < MAX_SNAPSHOT_RACE_ATTEMPTS; attempt += 1) {
    const statBefore = await statAnswerSnapshot(assigneeDir);
    const picked = await pickSnapshot(assigneeDir, statBefore, options);
    if (picked.kind === "rebuild") return rebuildAssigneeState(root, month, assignee, options);
    const snapshot = picked.snapshot;
    if (afterSnapshotReadHook) await afterSnapshotReadHook();
    const delta = await readAnswerEventDelta(eventsDir, maxOffsets(bareOffsets(snapshot), options.knownOffsets), assigneeSegmentConfig(assignee), {
      strict: options.strict,
      tolerateConfirmedDead: options.tolerateConfirmedDead,
    });
    const statAfter = await statAnswerSnapshot(assigneeDir);
    if (!sameSnapshotStat(statBefore, statAfter)) continue; // a compaction committed under us
    const legacySeed = snapshot?.legacySeed ?? (await options.loadLegacySeed());
    const deltaEvents = dedupeById([...(options.cachedDelta ?? []), ...delta.events]);
    const common = {
      snapshot, snapshotStat: statAfter, legacySeed, deltaEvents,
      liveOffsets: onlyListed(delta.offsets, delta.segmentNames), liveSegmentNames: delta.segmentNames,
      unreadableNames: delta.unreadableNames, archiveOffsets: {},
    };
    if (!snapshot && deltaEvents.length === 0) return { ...common, result: passthrough(legacySeed, assignee, month), rebuilt: false };
    const folded = foldSnapshotPlusDelta(snapshot, deltaEvents, { legacySeed, username: assignee, monthFolderName: month, foldFn: options.foldFn });
    if (folded.kind === "late") return rebuildAssigneeState(root, month, assignee, options);
    return { ...common, result: folded.result, rebuilt: false };
  }
  return rebuildAssigneeState(root, month, assignee, options);
}

/** Assignee folders of a v2 month (`_archive-v1`, `_quarantine`, files skipped). */
export async function listAssigneeFolders(root: DirectoryHandleLike, month: string): Promise<string[]> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(root, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "directory" && isAnswerAssigneeFolderName(entry.name))
    .map((entry) => entry.name)
    .sort();
}
```

- [ ] **Step 5: Implement `rebuildAssigneeSnapshot.ts`**

```ts
// src/data/answers/v2/rebuildAssigneeSnapshot.ts
//
// Fold EVERYTHING one assignee has (archive + live + frozen legacy seed) and
// write it as the snapshot, CAS against whatever revision is there. Used by the
// migration (with the v1 offset keys), by a restore that merged segments, and
// by compaction when a late event forces a full refold.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { getAssigneeAnswerEventsDir } from "../../workspace/workspacePaths";
import type { AnswerLegacySeed } from "../answerEventStore";
import { isV1OffsetKey, snapshotDraftFromFold, type FoldFn } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, writeAnswerSnapshotCas } from "./answerSnapshotStore";
import { rebuildAssigneeState } from "./assigneeEventReader";

async function currentRevisionAndV1Keys(dir: DirectoryHandleLike): Promise<{ revision: number; v1Offsets: Record<string, number> }> {
  try {
    const read = await readAnswerSnapshot(dir);
    if (read.kind === "absent") return { revision: 0, v1Offsets: {} };
    const v1Offsets = Object.fromEntries(Object.entries(read.snapshot.foldedOffsets).filter(([key]) => isV1OffsetKey(key)));
    return { revision: read.snapshot.revision, v1Offsets };
  } catch (error) {
    if (error instanceof AnswerSnapshotCorruptError) return { revision: 0, v1Offsets: {} };
    throw error;
  }
}

export async function rebuildAndPersistAssigneeSnapshot(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  deps: { actor: string; loadLegacySeed: () => Promise<AnswerLegacySeed>; foldFn?: FoldFn; extraOffsets?: Record<string, number>; nowMs?: number }
): Promise<{ status: "written"; revision: number } | { status: "no-events" }> {
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, assignee, true);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await currentRevisionAndV1Keys(assigneeDir);
    const rebuilt = await rebuildAssigneeState(root, month, assignee, { loadLegacySeed: deps.loadLegacySeed, foldFn: deps.foldFn });
    if (rebuilt.deltaEvents.length === 0) return { status: "no-events" };
    const draft = snapshotDraftFromFold(rebuilt.result, {
      assignee,
      monthFolderName: month,
      legacySeed: rebuilt.legacySeed,
      foldedOffsets: { ...current.v1Offsets, ...(deps.extraOffsets ?? {}), ...rebuilt.archiveOffsets, ...rebuilt.liveOffsets },
      compactedAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
      compactedBy: deps.actor,
    });
    const write = await writeAnswerSnapshotCas(assigneeDir, current.revision, draft, "answers:snapshot-rebuild");
    if (!write.ok) throw new Error(write.error);
    if (write.status === "written") return { status: "written", revision: write.snapshot.revision };
  }
  throw new Error(`Snapshot for ${assignee} in ${month} kept changing during a rebuild`);
}
```

- [ ] **Step 6: Wire `loadEmployeeItemState` to the v2 reader**

In `answerStorage.ts`: add `export` to `function foldEmployeeEvents(` (`:564`). After `legacyContentHashOf` (`:643-645`) add:

```ts
/** The frozen legacy seed (hash + items) for one employee — P0-1: throws on an unreadable file. */
export async function loadLegacyAnswerSeed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<AnswerLegacySeed> {
  const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
  return { contentHash: legacyContentHashOf(legacy), items: legacy?.items ?? [] };
}

/** `readAssigneeState` options every answerStorage v2 caller shares. */
function v2ReadOptions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  extra: { strict?: boolean; tolerateConfirmedDead?: boolean } = {}
): AssigneeReadOptions {
  return {
    foldFn: foldEmployeeEvents,
    loadLegacySeed: () => loadLegacyAnswerSeed(directoryHandle, monthFolderName, username),
    ...extra,
  };
}

/** v1's compatibility overlay (see loadEmployeeItemState), from the snapshot's frozen legacy items. */
function withLegacyOnlyItems(folded: readonly ItemAnswer[], legacyItems: readonly ItemAnswer[]): ItemAnswer[] {
  const foldedIds = new Set(folded.map((item) => item.xrayImageId));
  const legacyOnly = legacyItems.filter((item) => !foldedIds.has(item.xrayImageId));
  return legacyOnly.length > 0 ? [...folded, ...legacyOnly] : [...folded];
}

async function loadEmployeeItemStateV2(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  extra: { strict?: boolean; tolerateConfirmedDead?: boolean } = {}
): Promise<EmployeeItemState> {
  const read = await readAssigneeState(directoryHandle, monthFolderName, username, v2ReadOptions(directoryHandle, monthFolderName, username, extra));
  const items = read.snapshot || read.deltaEvents.length > 0
    ? withLegacyOnlyItems(read.result.file.items, read.legacySeed.items)
    : read.result.file.items;
  return { items, seeded: read.result.seeded };
}
```

At the top of `loadEmployeeItemState` (`:668`, before `const events = …`):

```ts
  if (!allEvents && (await getAnswerEventsLayout(directoryHandle, monthFolderName)) === "v2") {
    return loadEmployeeItemStateV2(directoryHandle, monthFolderName, username);
  }
```

Imports to add: `getAnswerEventsLayout` from `../workspace/workspacePaths`; `readAssigneeState, type AssigneeReadOptions` from `./v2/assigneeEventReader`.

- [ ] **Step 7: Add the employee-level parity test and run everything**

Append to `assigneeEventReader.test.ts`:

```ts
import { loadEmployeeAnswers } from "../answerStorage";

describe("loadEmployeeAnswers on a v2 month", () => {
  it("returns the same items as a full fold of the assignee's segments", async () => {
    const root = createMemoryDirectory("r6");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1), savedEvent("a2", 2, { status: "submitted" })];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    const file = await loadEmployeeAnswers(root, V2_MONTH, "emp1");
    expect(file.items).toEqual(foldAnswerEvents(a, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }).file.items);
  });
});
```

Run: `npx vitest run src/data/answers/v2 src/data/answers/answerStorage.test.ts src/data/answers/answerStorageStage2.test.ts`
Expected: PASS. `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/data/answers/v2 src/data/answers/answerStorage.ts
git commit -m "Add (answers): per-assignee v2 reader with snapshot-race and .bak rebuild fallbacks"
```

---

### Task 5: Writer routing — every append to the assignee's folder; new months start v2; saves defer during a migration

**Files:**
- Create: `src/data/answers/v2/answerEventsLayout.ts`
- Modify: `src/data/answers/answerStorage.ts` — `answerWriterIdentity` (`:886-901`), `resolveSeed` (`:923-966`), `performAnswerWrite` (`:1108-1273`), `performOnBehalfWrite` (`:1501-1619`)
- Modify: `src/data/labels/labelsStore.ts` (after `app_auto_backup_done` at `:851`)
- Test: `src/data/answers/answerV2Routing.test.ts` (create)
- Modify (fixtures only, Step 7): tests listed there

**Interfaces:**
- Consumes: Task 1 (`getAnswerEventsLayout`, `getAnswerEventsDir`, `answerAssigneeFolderName`, `noteAnswerEventsLayoutV2`, `ANSWER_EVENTS_FOLDERS`), Task 4 (`readAssigneeState`, `assigneeSegmentConfig`, `v2ReadOptions`), `appendAnswerEventSegment(parentDir, events, writer, config, options)` (`answerEventStore.ts:210`), `markAnswerPendingLocally(month, username, item)` (`answerLocalMirror.ts:227`), `safeWriteJson`, `safeReadJson`, `wrap`/`unwrap`, `listDirectoryEntries`, `getLabels()`.
- Produces:
  - `type AnswerEventsLayoutMarker = { layout: "per-assignee"; schemaVersion: 1; migratedAt: string; migratedBy: string; flatSegmentsArchived: number; assignees: number; unmovable: string[]; origin: "migration" | "new-month" }`
  - `readAnswerEventsLayoutMarker(root, month): Promise<AnswerEventsLayoutMarker | null>`
  - `writeAnswerEventsLayoutMarker(eventsDir, marker): Promise<void>`
  - `ensureAnswerEventsLayoutForWrite(root, month, actor): Promise<"v1" | "v1-migrating" | "v2">`
  - `answerWriterIdentity(dir, month, actor, assigneeFolder?: string)` — `scopeId` gains `|{assigneeFolder}` in v2
  - `resolveSeed(dir, month, username, alreadySeeded: boolean, eventId, eventAt)` (was `ownEvents`)
  - Labels: `answers_migration_save_deferred`, `answers_migration_action_blocked`

- [ ] **Step 1: Write the failing routing test**

```ts
// src/data/answers/answerV2Routing.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getAssigneeAnswerEventsDir, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer, upsertItemAnswerOnBehalf } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { fileNames, makeV1Month, writeText } from "./v2/v2TestFixtures";

const pending = vi.hoisted(() => ({ calls: [] as Array<[string, string, string]> }));
vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return {
    ...actual,
    mirrorAnswerLocally: async () => undefined,
    markAnswerPendingLocally: async (month: string, username: string, item: ItemAnswer) => {
      pending.calls.push([month, username, item.xrayImageId]);
    },
  };
});

const MONTH = "5-may-2026";

function item(id: string, answeredBy = "emp1", status: ItemAnswer["status"] = "draft"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status };
}

describe("layout v2 writer routing (spec §4, §10)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __clearAnswerEventsCacheForTests();
    __resetAppendOnlyEventLogMemosForTests();
    pending.calls = [];
  });

  it("a brand-new month is stamped v2 and a self-save lands under answers.events/emp1/", async () => {
    const root = createMemoryDirectory("new");
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).resolves.toBeTruthy();
    expect(await fileNames(events)).toEqual([]);
    expect((await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"))).length).toBe(1);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId)).toEqual(["A"]);
  });

  it("an on-behalf save lands in the ASSIGNEE's folder, not the supervisor's", async () => {
    const root = createMemoryDirectory("onbehalf");
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("B"), "sup1", "reason")).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getDirectoryHandle("sup1")).rejects.toMatchObject({ name: "NotFoundError" });
    const saved = (await loadEmployeeAnswers(root, MONTH, "emp1")).items.find((i) => i.xrayImageId === "B");
    expect(saved?.answeredOnBehalfBy).toBe("sup1");
  });

  it("on-behalf for two assignees in one session: each folder gets its own seq-0 segment, fast (Review Focus 3)", async () => {
    const root = createMemoryDirectory("two");
    const started = Date.now();
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("C1"), "sup1", "r")).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp2", item("C2", "emp2"), "sup1", "r")).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("C3"), "sup1", "r")).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    const emp1 = await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"));
    const emp2 = await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp2"));
    expect(emp1).toHaveLength(1);
    expect(emp2).toHaveLength(1);
    expect(emp1[0]).not.toMatch(/-[1-9][0-9]*\.ndjson$/);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId).sort()).toEqual(["C1", "C3"]);
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.map((i) => i.xrayImageId)).toEqual(["C2"]);
  }, 20_000);

  it("mixed-case assignee: Emp1 self-save and emp1 on-behalf share one folder (Review Focus 5)", async () => {
    const root = createMemoryDirectory("case");
    expect((await upsertItemAnswer(root, MONTH, "Emp1", item("D1", "Emp1"))).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("D2"), "sup1", "r")).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    const dirs = [];
    for await (const entry of (events as unknown as { values(): AsyncIterable<{ kind: string; name: string }> }).values()) if (entry.kind === "directory") dirs.push(entry.name);
    expect(dirs).toEqual(["emp1"]);
    expect((await loadEmployeeAnswers(root, MONTH, "EMP1")).items.map((i) => i.xrayImageId).sort()).toEqual(["D1", "D2"]);
  });

  it("an existing v1 month keeps appending to the flat folder, unstamped", async () => {
    const root = createMemoryDirectory("v1");
    await makeV1Month(root, MONTH);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("E"))).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).rejects.toMatchObject({ name: "NotFoundError" });
    expect(await fileNames(events)).toHaveLength(1);
  });

  it("while a migration lock exists, a save is deferred to the pending queue and nothing is appended", async () => {
    const root = createMemoryDirectory("lock");
    await makeV1Month(root, MONTH);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, ANSWER_EVENTS_FOLDERS.migrationLock, "{}");
    const result = await upsertItemAnswer(root, MONTH, "emp1", item("F"));
    expect(result.ok).toBe(false);
    expect(pending.calls).toEqual([[MONTH, "emp1", "F"]]);
    expect(await fileNames(events)).toEqual([]);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("G"), "sup1", "r")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/answerV2Routing.test.ts`
Expected: FAIL — test 1 sees a flat segment and no `_layout.json`; the lock test sees an append.

- [ ] **Step 3: Add the layout marker module and labels**

```ts
// src/data/answers/v2/answerEventsLayout.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { isNotFoundError } from "../../storage/transientFileErrors";
import {
  ANSWER_EVENTS_FOLDERS,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  noteAnswerEventsLayoutV2,
} from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX } from "../answerEventStore";

/** `answers.events/_layout.json` (spec §4). `origin` is beyond the spec: it tells a stamped new month from a migrated one. */
export type AnswerEventsLayoutMarker = {
  layout: "per-assignee";
  schemaVersion: 1;
  migratedAt: string;
  migratedBy: string;
  flatSegmentsArchived: number;
  assignees: number;
  unmovable: string[];
  origin: "migration" | "new-month";
};

export async function readAnswerEventsLayoutMarker(root: DirectoryHandleLike, month: string): Promise<AnswerEventsLayoutMarker | null> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(root, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const read = await safeReadJson<JsonEnvelope<AnswerEventsLayoutMarker>>(eventsDir, ANSWER_EVENTS_FOLDERS.layoutMarker);
  return read.ok ? unwrap<AnswerEventsLayoutMarker>(read.value) : null;
}

export async function writeAnswerEventsLayoutMarker(eventsDir: DirectoryHandleLike, marker: AnswerEventsLayoutMarker): Promise<void> {
  await safeWriteJson(eventsDir, ANSWER_EVENTS_FOLDERS.layoutMarker, wrap(marker));
}

/**
 * The layout a WRITE must use, probed fresh (v2 is cached monotone in
 * workspacePaths). A month with no `answers.events/` yet has no v1 data to
 * migrate, so it is stamped v2 before its first append — unless a flat segment
 * appeared between the probe and the create (a racing writer), in which case
 * it stays v1 and the admin prompt offers the migration.
 */
export async function ensureAnswerEventsLayoutForWrite(
  root: DirectoryHandleLike,
  month: string,
  actor: string
): Promise<"v1" | "v1-migrating" | "v2"> {
  const layout = await getAnswerEventsLayout(root, month);
  if (layout !== "absent") return layout;
  const eventsDir = await getAnswerEventsDir(root, month, true);
  const flat = (await listDirectoryEntries(eventsDir)).some(
    (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX)
  );
  if (flat) return "v1";
  await writeAnswerEventsLayoutMarker(eventsDir, {
    layout: "per-assignee",
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    migratedBy: actor,
    flatSegmentsArchived: 0,
    assignees: 0,
    unmovable: [],
    origin: "new-month",
  });
  noteAnswerEventsLayoutV2(root, month);
  return "v2";
}
```

In `labelsStore.ts`, after `app_auto_backup_done` (`:851`):

```ts
  // Answers layout v2 (spec 2026-10-13 §6) — saves during an admin migration.
  answers_migration_save_deferred:  "يجري الآن ترحيل ملفات الإجابات لهذا الشهر. حُفظت إجابتك على هذا الجهاز وستُرفع تلقائيًا بعد انتهاء الترحيل.",
  answers_migration_action_blocked: "يجري الآن ترحيل ملفات الإجابات لهذا الشهر. أعد المحاولة بعد انتهاء الترحيل.",
```

- [ ] **Step 4: Scope the writer identity per assignee and make `resolveSeed` take a boolean**

`answerWriterIdentity` (`:886-901`) →

```ts
function answerWriterIdentity(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  actor: string,
  assigneeFolder?: string
): { writer: SegmentWriterIdentity; config: AppendOnlyEventLogConfig } {
  const chain = stableAnswerChain(monthFolderName, actor);
  const scope = `${workspaceScopeId(directoryHandle)}|${monthFolderName}`;
  return {
    writer: {
      deviceId: getDistributionDeviceId(),
      sessionId: chain.chainId,
      // v2: the SAME chain base appears in every assignee folder this actor
      // writes into (on-behalf). The module-level seq/written memos are keyed on
      // scopeId, so without the folder in it the second folder would resume at
      // the first folder's seq and take the ~11 s patient ladder (Review Focus 3).
      scopeId: assigneeFolder ? `${scope}|${assigneeFolder}` : scope,
      stable: true,
    },
    config: assigneeFolder ? { ...chain.config, eventsDirName: assigneeFolder } : chain.config,
  };
}
```

`resolveSeed` (`:923-931`): change the 4th parameter from `ownEvents: readonly AnswerEvent[]` to `alreadySeeded: boolean` and delete the line computing it. Update the two v1 callers: `performAnswerWrite` passes `ownEvents.some((event) => event.eventType === "migration-seed")`; `performOnBehalfWrite` passes `ownBefore.some((event) => event.eventType === "migration-seed")`.

- [ ] **Step 5: Split `performAnswerWrite`'s decision into v1/v2 and add the deferral**

Add above `performAnswerWrite`:

```ts
/** Everything the append needs, whichever layout decided it. */
type DecidedWrite = {
  parentDir: DirectoryHandleLike;
  appendConfig: AppendOnlyEventLogConfig;
  writer: SegmentWriterIdentity;
  listedNames: readonly string[] | undefined;
  seedEvent: AnswerEvent | null;
  blind: boolean;
  previous: ItemAnswer | undefined;
  decision: AnswerWriteDecision;
};

type WriteBuild = (ctx: { previous: ItemAnswer | undefined }) => AnswerWriteDecision;

async function assigneeAppendTarget(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  actor: string
): Promise<Pick<DecidedWrite, "parentDir" | "appendConfig" | "writer">> {
  const parentDir = await getAnswerEventsDir(directoryHandle, monthFolderName, true);
  const { writer, config } = answerWriterIdentity(directoryHandle, monthFolderName, actor, answerAssigneeFolderName(assignee));
  return { parentDir, appendConfig: config, writer };
}

async function decideV1Write(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  eventId: string,
  eventAt: string,
  build: WriteBuild,
  blindAppendWhenSeeded: boolean
): Promise<DecidedWrite> {
  const parentDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
  const { writer, config } = answerWriterIdentity(directoryHandle, monthFolderName, username);
  if (blindAppendWhenSeeded) {
    const cachedDecision = await decideFromSeededCache(directoryHandle, monthFolderName, username, xrayImageId, build);
    if (cachedDecision) {
      return { parentDir, appendConfig: config, writer, listedNames: listedAnswerSegmentNames(directoryHandle, monthFolderName), seedEvent: null, blind: true, ...cachedDecision };
    }
  }
  const allEvents = await readAllAnswerEventsForMonth(directoryHandle, monthFolderName);
  const ownEvents = eventsForEmployee(allEvents, username);
  const { seedEvent, legacySeed } = await resolveSeed(
    directoryHandle, monthFolderName, username, ownEvents.some((event) => event.eventType === "migration-seed"), eventId, eventAt
  );
  const foldedNow = foldEmployeeEvents(seedEvent ? [...ownEvents, seedEvent] : ownEvents, { legacySeed, username, monthFolderName });
  const previous = foldedNow.file.items.find((item) => item.xrayImageId === xrayImageId);
  return { parentDir, appendConfig: config, writer, listedNames: listedAnswerSegmentNames(directoryHandle, monthFolderName), seedEvent, blind: false, previous, decision: build({ previous }) };
}

async function decideV2Write(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  actor: string,
  xrayImageId: string,
  eventId: string,
  eventAt: string,
  build: WriteBuild
): Promise<DecidedWrite> {
  const target = await assigneeAppendTarget(directoryHandle, monthFolderName, assignee, actor);
  const state = await readAssigneeState(directoryHandle, monthFolderName, assignee, v2ReadOptions(directoryHandle, monthFolderName, assignee));
  // The snapshot carries the frozen legacy seed: memoize it so resolveSeed does not re-read the file.
  if (state.result.seeded) setLegacySeedMemo(directoryHandle, monthFolderName, assignee, state.legacySeed);
  const { seedEvent } = await resolveSeed(directoryHandle, monthFolderName, assignee, state.result.seeded, eventId, eventAt);
  const previous = state.result.file.items.find((item) => item.xrayImageId === xrayImageId);
  return { ...target, listedNames: state.liveSegmentNames, seedEvent, blind: false, previous, decision: build({ previous }) };
}

async function deferredByMigration(
  monthFolderName: string,
  username: string,
  candidate: ItemAnswer | null
): Promise<{ ok: false; error: string }> {
  if (candidate) {
    await markAnswerPendingLocally(monthFolderName, username, candidate);
    return { ok: false, error: getLabels().answers_migration_save_deferred };
  }
  return { ok: false, error: getLabels().answers_migration_action_blocked };
}
```

Inside `performAnswerWrite`:
1. Delete `const { writer, config: segmentConfig } = answerWriterIdentity(...)` (`:1120`).
2. Immediately after the `candidateFor` definition (`:1169-1182`) insert:

```ts
  const layout = await ensureAnswerEventsLayoutForWrite(directoryHandle, monthFolderName, username);
  if (layout === "v1-migrating") {
    const fallback = build({ previous: undefined });
    const candidate =
      !("skip" in fallback) && fallback.event.eventType === "item-saved"
        ? candidateFor({ ...fallback.event, eventId, eventAt, answeredBy: username }, undefined)
        : null;
    return deferredByMigration(monthFolderName, username, candidate);
  }
```

3. Replace the body of `attempt` (`:1183-1230`) with:

```ts
  const attempt = async (): Promise<{ ok: true }> => {
    const decided = await retryDecisionRead(deadline, () =>
      layout === "v2"
        ? decideV2Write(directoryHandle, monthFolderName, username, username, xrayImageId, eventId, eventAt, build)
        : decideV1Write(directoryHandle, monthFolderName, username, xrayImageId, eventId, eventAt, build, options.blindAppendWhenSeeded ?? false)
    );
    if ("skip" in decided.decision) return { ok: true as const };
    const event: AnswerEvent = { ...decided.decision.event, eventId, eventAt, answeredBy: username };
    const batch = decided.seedEvent ? [decided.seedEvent, event] : [event];
    mirrorCandidate = candidateFor(event, decided.previous);
    pendingEligible = event.eventType === "item-saved";
    await appendAnswerEventSegment(decided.parentDir, batch, decided.writer, decided.appendConfig, {
      deadline,
      listedSegmentNames: decided.listedNames,
      // A blind append has no fresh listing: probe for a head another tab rotated to.
      probeAheadForHead: decided.blind,
    });
    if (layout !== "v2") reflectLocalAppendInAnswerEventsCache(directoryHandle, monthFolderName, batch);
    return { ok: true as const };
  };
```

Imports to add: `ensureAnswerEventsLayoutForWrite` from `./v2/answerEventsLayout`; `getAnswerEventsDir`, `answerAssigneeFolderName` from `../workspace/workspacePaths`; `getLabels` from `../labels/labelsStore`.

- [ ] **Step 6: Route `performOnBehalfWrite` the same way**

At the top of `performOnBehalfWrite`, after `ensureMonthWritable` (`:1509`), add:

```ts
  const layout = await ensureAnswerEventsLayoutForWrite(directoryHandle, monthFolderName, author);
  if (layout === "v1-migrating") return deferredByMigration(monthFolderName, assigneeUsername, null);
```

Delete `const { writer, config: segmentConfig } = answerWriterIdentity(...)` (`:1512`). Extract the event literal (`:1536-1552`) into:

```ts
function buildOnBehalfEvent(
  eventId: string, eventAt: string, author: string, assigneeUsername: string, item: ItemAnswer, reason: string
): AnswerEvent {
  return {
    eventId, eventType: "item-saved", eventAt, eventBy: author, authority: "supervisor",
    xrayImageId: item.xrayImageId, answers: item.answers, status: item.status, submittedAt: item.submittedAt,
    templateId: item.templateId, templateVersion: item.templateVersion, lastSavedAt: item.lastSavedAt,
    answeredBy: assigneeUsername, answeredOnBehalfBy: author, reason,
  };
}
```

Add two helpers returning whether THIS event was refused, and make the casLoop attempt call one of them:

```ts
async function appendOnBehalfV2(
  directoryHandle: DirectoryHandleLike, monthFolderName: string, assigneeUsername: string, author: string,
  event: AnswerEvent, deadline: OperationDeadline
): Promise<{ refused: boolean }> {
  const target = await assigneeAppendTarget(directoryHandle, monthFolderName, assigneeUsername, author);
  const before = await readAssigneeState(directoryHandle, monthFolderName, assigneeUsername, v2ReadOptions(directoryHandle, monthFolderName, assigneeUsername));
  const { seedEvent } = await resolveSeed(directoryHandle, monthFolderName, assigneeUsername, before.result.seeded, event.eventId, event.eventAt);
  await appendAnswerEventSegment(target.parentDir, seedEvent ? [seedEvent, event] : [event], target.writer, target.appendConfig, {
    deadline,
    listedSegmentNames: before.liveSegmentNames,
  });
  // CONFIRM (§5): a fresh event is never folded into the snapshot inside the
  // compaction quiet window, so a refusal of it is in this read's refusals.
  const after = await readAssigneeState(directoryHandle, monthFolderName, assigneeUsername, v2ReadOptions(directoryHandle, monthFolderName, assigneeUsername));
  return { refused: after.result.refusals.some((refusal) => refusal.eventId === event.eventId) };
}

async function appendOnBehalfV1(
  directoryHandle: DirectoryHandleLike, monthFolderName: string, assigneeUsername: string, author: string,
  event: AnswerEvent, deadline: OperationDeadline
): Promise<{ refused: boolean }> {
  const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
  const { writer, config } = answerWriterIdentity(directoryHandle, monthFolderName, author);
  const ownBefore = eventsForEmployee(await readAllAnswerEventsForMonth(directoryHandle, monthFolderName), assigneeUsername);
  const { seedEvent } = await resolveSeed(directoryHandle, monthFolderName, assigneeUsername, ownBefore.some((e) => e.eventType === "migration-seed"), event.eventId, event.eventAt);
  const batch = seedEvent ? [seedEvent, event] : [event];
  await appendAnswerEventSegment(mainDir, batch, writer, config, { deadline, listedSegmentNames: listedAnswerSegmentNames(directoryHandle, monthFolderName) });
  reflectLocalAppendInAnswerEventsCache(directoryHandle, monthFolderName, batch);
  const ownAfter = eventsForEmployee(await readAllAnswerEventsForMonth(directoryHandle, monthFolderName), assigneeUsername);
  const scopedToItem = ownAfter.filter((c) => c.eventType === "migration-seed" || c.xrayImageId === event.xrayImageId);
  const legacyForConfirm = await loadLegacyAnswersFile(directoryHandle, monthFolderName, assigneeUsername);
  const confirmed = foldEmployeeEvents(scopedToItem, {
    legacySeed: { contentHash: legacyContentHashOf(legacyForConfirm), items: (legacyForConfirm?.items ?? []).filter((i) => i.xrayImageId === event.xrayImageId) },
    username: assigneeUsername,
    monthFolderName,
    requireMigrationSeed: false,
  });
  return { refused: confirmed.refusals.some((refusal) => refusal.eventId === event.eventId) };
}
```

The casLoop attempt body (`:1520-1597`) becomes:

```ts
    async () => {
      const event = buildOnBehalfEvent(eventId, eventAt, author, assigneeUsername, item, reason);
      const { refused } = layout === "v2"
        ? await appendOnBehalfV2(directoryHandle, monthFolderName, assigneeUsername, author, event, deadline)
        : await appendOnBehalfV1(directoryHandle, monthFolderName, assigneeUsername, author, event, deadline);
      if (refused) {
        return {
          done: true,
          result: {
            ok: false as const,
            error:
              "لا يمكن الإجابة نيابةً عن الموظف: تم تقديم إجابة لهذه العينة بالفعل. أعد فتح الإجابة أولاً إذا لزم تصحيحها.",
          },
        };
      }
      return { done: true, result: { ok: true as const } };
    },
```

(Keep the existing comment block about CONFIRM in `appendOnBehalfV1`. The Arabic literal is unchanged from today; moving it to a label is out of scope.)

- [ ] **Step 7: Run the routing test, then keep v1-assuming fixtures on v1**

Run: `npx vitest run src/data/answers/answerV2Routing.test.ts` → PASS (6).

New months now start v2, so tests that build a fresh month and then inspect the FLAT `answers.events/` folder must opt into v1. Run:
`npx vitest run src/data/answers src/data/backup src/data/population/populationOverwriteGuard.test.ts src/data/storage/directoryScan.sealedSegments.test.ts src/data/storage/directoryScan.segmentTailsConcurrency.test.ts src/data/workspace/workspaceSync.test.tsx src/data/history`

For each failure in a file that asserts on flat segments (expected set: `answerEventsCache.test.ts`, `answerFullWorkflow.integration.test.ts`, `answerSaveBlindAppend.test.ts`, `answerSaveInvalidStateRotation.test.ts`, `answerSaveRetryCost.test.ts`, `answerSealedSegments.perName.test.ts`, `answerSegmentChain.test.ts`, `answerStorage.deadSegments.test.ts`, `answerStorage.sealedSegments.test.ts`, `answerStorageStage2.test.ts`, `backup/backupAnswersSegments.test.ts`, `backup/selectiveRestoreAnswersCaches.test.ts`, `backup/selectiveRestoreEngine.test.ts`, `backup/selectiveRestorePreview.test.ts`, `population/populationOverwriteGuard.test.ts`, `workspace/workspaceSync.test.tsx`), add right after the fixture's `createMemoryDirectory(...)`:

```ts
import { makeV1Month } from "<relative path>/answers/v2/v2TestFixtures";
// …
await makeV1Month(root, MONTH); // this test pins the v1 flat layout
```

Do NOT change any assertion to make a test pass; if a failure is not explained by the flat-layout assumption, stop and investigate (`superpowers:systematic-debugging`). List every touched test file in the edit log.

- [ ] **Step 8: Gates and commit**

Run: `npm run typecheck && npm run lint && npx vitest run src/data`
Expected: PASS.

```bash
git add src/data/answers src/data/labels/labelsStore.ts src/data/backup src/data/population src/data/storage src/data/workspace src/data/history
git commit -m "Change (answers): route every append to the assignee's folder; new months start v2; defer saves during migration"
```

---

### Task 6: `moveFileVerified` — move, or copy → verify → remove

**Files:**
- Modify: `src/data/storage/fileSystemAccess.ts:45-57` (optional `move?` on `FileHandleLike`)
- Create: `src/data/storage/moveFileVerified.ts`
- Test: `src/data/storage/moveFileVerified.test.ts` (create)

**Interfaces:**
- Consumes: `copyFileBytesVerified(sourceDir, sourceName, targetDir, targetName, options?): Promise<VerifiedCopyOutcome>` where `VerifiedCopyOutcome = { status: "copied"; bytes } | { status: "source_missing" } | { status: "verify_failed"; detail }` (`safeWrite.ts:1540-1592`); `safeRemoveJson(dir, fileName): Promise<{ ok: boolean; remaining: string[] }>` (`safeWrite.ts:840-890`, removes `.tmp`, `.bak`, then the name; NotFound = success); `isNotFoundError`.
- Produces:
  - `type MoveOutcome = { status: "moved"; via: "move" | "copy" } | { status: "kept"; reason: "changed" | "copy-failed" | "remove-failed" | "source-missing"; detail?: string }`
  - `moveFileVerified(sourceDir, name, targetDir, expectedBytes: number): Promise<MoveOutcome>`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/storage/moveFileVerified.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { moveFileVerified } from "./moveFileVerified";

async function write(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await w.write(text);
  await w.close();
}
async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

describe("moveFileVerified", () => {
  it("copy fallback: target byte-identical, source removed", async () => {
    const root = createMemoryDirectory("mv1");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\nline2\n");
    expect(await moveFileVerified(src, "a.ndjson", dst, 12)).toEqual({ status: "moved", via: "copy" });
    expect(await exists(src, "a.ndjson")).toBe(false);
    expect(await (await (await dst.getFileHandle("a.ndjson")).getFile()).text()).toBe("line1\nline2\n");
  });

  it("a file that grew since it was read is kept (never moved with unread bytes)", async () => {
    const root = createMemoryDirectory("mv2");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\nline2\nline3\n");
    expect(await moveFileVerified(src, "a.ndjson", dst, 12)).toMatchObject({ status: "kept", reason: "changed" });
    expect(await exists(dst, "a.ndjson")).toBe(false);
  });

  it("a remove the share refuses leaves the original live and the copy archived", async () => {
    const root = createMemoryDirectory("mv3");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "x\n");
    setSimulatedFaults(root, [{ operation: "removeEntry", name: "a.ndjson", errorName: "NoModificationAllowedError", times: 1_000 }]);
    expect(await moveFileVerified(src, "a.ndjson", dst, 2)).toMatchObject({ status: "kept", reason: "remove-failed" });
    expect(await exists(src, "a.ndjson")).toBe(true);
    expect(await exists(dst, "a.ndjson")).toBe(true);
  }, 30_000);

  it("uses handle.move when the platform provides it", async () => {
    const root = createMemoryDirectory("mv4");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "x\n");
    const withMove: DirectoryHandleLike = new Proxy(src, {
      get(target, prop, recv) {
        if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
        return async (name: string, opts?: { create?: boolean }) => {
          const handle = await target.getFileHandle(name, opts);
          const moved: FileHandleLike = {
            ...handle,
            getFile: handle.getFile.bind(handle),
            createWritable: handle.createWritable?.bind(handle),
            move: async (destination: DirectoryHandleLike) => {
              await write(destination, name, await (await handle.getFile()).text());
              await target.removeEntry!(name);
            },
          };
          return moved;
        };
      },
    });
    expect(await moveFileVerified(withMove, "a.ndjson", dst, 2)).toEqual({ status: "moved", via: "move" });
    expect(await exists(src, "a.ndjson")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/storage/moveFileVerified.test.ts`
Expected: FAIL — module not found; `move` not on `FileHandleLike`.

- [ ] **Step 3: Implement**

`fileSystemAccess.ts` — add to `FileHandleLike` after `createWritable?` (`:49`):

```ts
  /**
   * `FileSystemHandle.move(destination, newName?)` — not available on every
   * Chromium build / file system. Feature-detect, and verify the result:
   * `moveFileVerified` falls back to copy → verify → remove.
   */
  move?: (destination: DirectoryHandleLike, newName?: string) => Promise<void>;
```

```ts
// src/data/storage/moveFileVerified.ts
//
// Spec 2026-10-13 §6 step 4 / §7 step 3: move a file into an archive folder.
// `move()` where the handle supports it; otherwise copy → verify bytes →
// remove the original ONLY after verification. Never deletes data: the only
// removal is of a source whose verified copy already exists.
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { copyFileBytesVerified, safeRemoveJson } from "./safeWrite";
import { isNotFoundError } from "./transientFileErrors";

export type MoveOutcome =
  | { status: "moved"; via: "move" | "copy" }
  | { status: "kept"; reason: "changed" | "copy-failed" | "remove-failed" | "source-missing"; detail?: string };

async function sizeOrNull(dir: DirectoryHandleLike, name: string): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(name, { create: false })).getFile()).size;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function tryNativeMove(sourceDir: DirectoryHandleLike, name: string, targetDir: DirectoryHandleLike, expectedBytes: number): Promise<boolean> {
  const handle = await sourceDir.getFileHandle(name, { create: false });
  if (typeof handle.move !== "function") return false;
  try {
    await handle.move(targetDir);
  } catch {
    return false; // fall back to copy while the source is still in place
  }
  return (await sizeOrNull(targetDir, name)) === expectedBytes && (await sizeOrNull(sourceDir, name)) === null;
}

export async function moveFileVerified(
  sourceDir: DirectoryHandleLike,
  name: string,
  targetDir: DirectoryHandleLike,
  expectedBytes: number
): Promise<MoveOutcome> {
  const before = await sizeOrNull(sourceDir, name);
  if (before === null) return { status: "kept", reason: "source-missing" };
  // Bytes appended since the caller read the file are not in its snapshot yet.
  if (before !== expectedBytes) return { status: "kept", reason: "changed" };
  if (await tryNativeMove(sourceDir, name, targetDir, expectedBytes)) return { status: "moved", via: "move" };
  const copied = await copyFileBytesVerified(sourceDir, name, targetDir, name);
  if (copied.status === "source_missing") return { status: "kept", reason: "source-missing" };
  if (copied.status !== "copied") return { status: "kept", reason: "copy-failed", detail: copied.detail };
  if (copied.bytes !== expectedBytes || (await sizeOrNull(sourceDir, name)) !== expectedBytes) {
    return { status: "kept", reason: "changed" };
  }
  const removed = await safeRemoveJson(sourceDir, name);
  return removed.ok ? { status: "moved", via: "copy" } : { status: "kept", reason: "remove-failed", detail: removed.remaining.join(", ") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/storage/moveFileVerified.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/data/storage/fileSystemAccess.ts src/data/storage/moveFileVerified.ts src/data/storage/moveFileVerified.test.ts
git commit -m "Add (storage): moveFileVerified — move or copy-verify-remove, never with unread bytes"
```

---

### Task 7: The admin migration module (`flatToPerAssignee.ts`) and v1 reads of `_archive-v1/`

**Files:**
- Create: `src/data/answers/migration/flatToPerAssignee.ts`
- Modify: `src/data/answers/answerStorage.ts` — `readAllAnswerEventsForMonth` (`:492-535`)
- Test: `src/data/answers/migration/flatToPerAssignee.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1–6; `appendEventSegment<T>(parentDir, events, writer, config, options?)` (`appendOnlyEventLog.ts:1202`), `chunkEventsForSegmentAppends<T>(events): T[][]` (`:532`), `utf8Length(text)` (`:461`), `encodeEventLine`; `readFileTextWithRetry(dir, name): Promise<string | null>` (`safeWrite.ts:562`, null = missing, throws after retries); `mapWithConcurrency(items, limit, fn)` (`concurrency.ts:14`); `DIRECTORY_READ_CONCURRENCY = 8` (`directoryScan.ts:30`); `workspaceScopeId`, `bumpWorkspaceEpoch` (`inFlightReads.ts:34`, `:56`); `getDistributionDeviceId()`; `clearAnswerEventsCache()`, `loadLegacyAnswerSeed`, `foldEmployeeEvents` (answerStorage).
- Produces:
  - `MIGRATION_LOCK_STALE_MS = 30 * 60 * 1000`, `MIGRATION_MS_PER_SEGMENT_ESTIMATE = 150`
  - `type MigrationPhase = "lock" | "read" | "archive" | "snapshot" | "move" | "stragglers" | "commit"`; `type MigrationProgress = { phase; done: number; total: number }`
  - `type MigrateMonthOptions = { actor: string; nowMs?: () => number; onProgress?: (p: MigrationProgress) => void | Promise<void> }`
  - `type MigrateMonthResult = { status: "migrated"; marker: AnswerEventsLayoutMarker; quarantinedLines: number } | { status: "nothing-to-do" } | { status: "locked-elsewhere"; by: string; startedAt: string }`
  - `migrateMonthToPerAssignee(root, month, options): Promise<MigrateMonthResult>`
  - `groupFlatSegmentLines(segments: readonly { name: string; bytes: number; text: string }[]): { groups: Map<string, { assignee: string; events: AnswerEvent[]; segments: Map<string, number> }>; quarantined: QuarantinedLine[] }` (pure)
  - `type QuarantinedLine = { segment: string; line: number; raw: string; reason: "unparseable" | "no-assignee" }`

Order (spec §6): 1 lock (CAS) → 2 read every flat segment once (concurrency 8), group by `answeredBy` (fallback `eventBy`), quarantine the rest → 3 per assignee: append its v1 lines to `{assignee}/archive/` (a "merged v1" archive, so a later full rebuild and the history view read ONE folder instead of `_archive-v1/`'s 2,000 files), then `rebuildAndPersistAssigneeSnapshot` with every contributing v1 segment's full length under `_archive-v1/{name}` → 4 move each flat segment into `_archive-v1/` with `moveFileVerified` (grown → kept) → 5 re-list; new or grown names go through 2–4 again (≤ 3 passes), same-size leftovers and unopenable files become `unmovable` → 6 write `_layout.json`, remove the lock. A crash before 6 leaves `_migration.lock.json` and/or `_archive-v1/` → `getAnswerEventsLayout` = `v1-migrating` → v1 readers read flat + `_archive-v1/` (Step 5) and writers defer (Task 5). A re-run by the same admin on the same device takes its own lock over; every write it repeats is idempotent (snapshot = full refold; a crash between an archive append and the snapshot write duplicates that assignee's merged lines, which the fold drops as `duplicate-event-id`).

- [ ] **Step 1: Write the failing test**

```ts
// src/data/answers/migration/flatToPerAssignee.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { unwrap } from "../../storage/jsonEnvelope";
import {
  __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerArchiveV1Dir, getAnswerEventsDir,
  getAnswerEventsLayout, getAssigneeAnswerEventsDir, invalidateAnswerEventsLayout,
} from "../../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer, upsertItemAnswerOnBehalf } from "../answerStorage";
import type { ItemAnswer } from "../answerTypes";
import { fileNames, makeV1Month, readText, savedEvent, writeText } from "../v2/v2TestFixtures";
import { groupFlatSegmentLines, migrateMonthToPerAssignee, type MigrationPhase } from "./flatToPerAssignee";

const MONTH = "5-may-2026";

function item(id: string, answeredBy = "emp1", status: ItemAnswer["status"] = "draft"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status };
}

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

/** A real v1 month: three writer chains, two assignees, one bad line, one orphan line (no answeredBy). */
async function v1Fixture(name: string): Promise<{ root: DirectoryHandleLike; flatTexts: Map<string, string> }> {
  const root = createMemoryDirectory(name);
  await makeV1Month(root, MONTH);
  expect((await upsertItemAnswer(root, MONTH, "emp1", item("A1"))).ok).toBe(true);
  expect((await upsertItemAnswer(root, MONTH, "emp2", item("B1", "emp2"))).ok).toBe(true);
  expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("A2"), "sup1", "r")).ok).toBe(true);
  const events = await getAnswerEventsDir(root, MONTH, false);
  const orphan = { ...savedEvent("orphan", 5, { eventBy: "emp2", xrayImageId: "X9" }, "emp2") };
  delete (orphan as { answeredBy?: string }).answeredBy;
  await writeText(events, "zz-ans-devz-sesz.ndjson", `${encodeEventLine(orphan)}{not json\n`);
  const flatTexts = new Map<string, string>();
  for (const n of await fileNames(events)) flatTexts.set(n, await readText(events, n));
  resetCaches();
  return { root, flatTexts };
}

async function snapshotOfAll(root: DirectoryHandleLike) {
  resetCaches();
  return {
    emp1: (await loadEmployeeAnswers(root, MONTH, "emp1")).items,
    emp2: (await loadEmployeeAnswers(root, MONTH, "emp2")).items.filter((i) => i.xrayImageId !== "X9"),
  };
}

describe("groupFlatSegmentLines", () => {
  it("groups by answeredBy, falls back to eventBy, quarantines the rest", () => {
    const ok = encodeEventLine(savedEvent("a", 1));
    const noAssignee = JSON.stringify({ eventId: "n", eventType: "item-saved", eventAt: "x" });
    const { groups, quarantined } = groupFlatSegmentLines([{ name: "s.ndjson", bytes: 1, text: `${ok}{bad\n${noAssignee}\nnull\n` }]);
    expect([...groups.keys()]).toEqual(["emp1"]);
    expect(quarantined.map((q) => q.reason)).toEqual(["unparseable", "no-assignee", "unparseable"]);
  });
});

describe("migrateMonthToPerAssignee (spec §6)", () => {
  beforeEach(resetCaches);

  it("migrates: marker last, originals archived byte-identical, answers unchanged, bad line quarantined", async () => {
    const { root, flatTexts } = await v1Fixture("m1");
    const before = await snapshotOfAll(root);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result).toMatchObject({ status: "migrated", quarantinedLines: 1 });
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    const events = await getAnswerEventsDir(root, MONTH, false);
    expect(await fileNames(events)).toEqual([]);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.migrationLock)).rejects.toMatchObject({ name: "NotFoundError" });
    const archive = await getAnswerArchiveV1Dir(root, MONTH, false);
    for (const [n, text] of flatTexts) expect(await readText(archive, n)).toBe(text);
    expect(await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"))).toEqual([]); // no live segments created
    const after = await snapshotOfAll(root);
    expect(after).toEqual(before);
    // spec §6 step 2: an event with no answeredBy is attributed to its eventBy
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.some((i) => i.xrayImageId === "X9")).toBe(true);
  });

  const phases: MigrationPhase[] = ["read", "archive", "snapshot", "move", "commit"];
  for (const phase of phases) {
    it(`crash at "${phase}": still v1, still readable, re-run completes (Review Focus 4)`, async () => {
      const { root } = await v1Fixture(`crash-${phase}`);
      const before = await snapshotOfAll(root);
      let thrown = false;
      await expect(
        migrateMonthToPerAssignee(root, MONTH, {
          actor: "admin",
          onProgress: (p) => {
            if (!thrown && p.phase === phase && (phase === "commit" || p.done >= 1)) {
              thrown = true;
              throw new Error(`simulated crash at ${phase}`);
            }
          },
        })
      ).rejects.toThrow(/simulated crash/);
      resetCaches();
      const events = await getAnswerEventsDir(root, MONTH, false);
      await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).rejects.toMatchObject({ name: "NotFoundError" });
      expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
      expect(await snapshotOfAll(root)).toEqual(before);
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("deferred"))).ok).toBe(false);
      expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
      expect(await snapshotOfAll(root)).toEqual(before);
    }, 30_000);
  }

  it("a segment written during the migration is picked up by the straggler pass", async () => {
    const { root } = await v1Fixture("straggler");
    let injected = false;
    const result = await migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: async (p) => {
        if (injected || p.phase !== "move") return;
        injected = true;
        const events = await getAnswerEventsDir(root, MONTH, false);
        await writeText(events, "late-ans-devl-sesl.ndjson", encodeEventLine(savedEvent("late", 900, { xrayImageId: "X-late" })));
      },
    });
    expect(result.status).toBe("migrated");
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.some((i) => i.xrayImageId === "X-late")).toBe(true);
    await expect((await getAnswerArchiveV1Dir(root, MONTH)).getFileHandle("late-ans-devl-sesl.ndjson")).resolves.toBeTruthy();
  }, 30_000);

  it("a fresh lock held by another admin aborts without touching anything", async () => {
    const { root, flatTexts } = await v1Fixture("busy");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, ANSWER_EVENTS_FOLDERS.migrationLock, JSON.stringify({ metadata: { schemaVersion: 1, revision: 1, contentHash: "x", writtenAt: "x" }, data: { by: "admin2", deviceId: "other", startedAt: new Date().toISOString(), token: "t", revision: 1 } }));
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result).toMatchObject({ status: "locked-elsewhere", by: "admin2" });
    expect(await fileNames(events)).toEqual([...flatTexts.keys()].sort());
  });

  it("a lock older than 30 minutes is taken over", async () => {
    const { root } = await v1Fixture("stale");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, ANSWER_EVENTS_FOLDERS.migrationLock, JSON.stringify({ metadata: { schemaVersion: 1, revision: 1, contentHash: "x", writtenAt: "x" }, data: { by: "admin2", deviceId: "other", startedAt: new Date(Date.now() - 31 * 60_000).toISOString(), token: "t", revision: 1 } }));
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
  });

  it("an unopenable segment stays flat, is listed as unmovable, and the migration still commits", async () => {
    const { root } = await v1Fixture("dead");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, "dead-ans-devd-sesd.ndjson", encodeEventLine(savedEvent("dead", 1)));
    setSimulatedFaults(root, [{ operation: "getFile", name: "dead-ans-devd-sesd.ndjson", errorName: "NotReadableError", times: 10_000 }]);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result.status).toBe("migrated");
    if (result.status === "migrated") expect(result.marker.unmovable).toContain("dead-ans-devd-sesd.ndjson");
    const markerText = await readText(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(unwrap<{ unmovable: string[] }>(JSON.parse(markerText)).unmovable).toContain("dead-ans-devd-sesd.ndjson");
  }, 60_000);

  it("a v2 month with flat stragglers (e.g. a v1 backup restored into it) migrates just those", async () => {
    const { root } = await v1Fixture("v2stragglers");
    await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    resetCaches();
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, "restored-ans-devr-sesr.ndjson", encodeEventLine(savedEvent("restored", 950, { xrayImageId: "X-restored" })));
    const second = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(second.status).toBe("migrated");
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.some((i) => i.xrayImageId === "X-restored")).toBe(true);
    expect(await fileNames(events)).toEqual([]);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/migration/flatToPerAssignee.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure grouping, lock, and reads**

```ts
// src/data/answers/migration/flatToPerAssignee.ts
//
// ONE-TIME, ADMIN-CONFIRMED migration of a month's flat `answers.events/` (v1)
// into per-assignee folders (v2) — spec 2026-10-13 §6 and CLAUDE.md's
// post-launch migration policy: offered on admin sign-in, never automatic,
// archives every original (moves to `_archive-v1/`), never deletes.
//
// Crash-safe by construction: `_layout.json` (the commit point) is written
// LAST. Before it exists the month is v1 (`v1-migrating` while the lock or
// `_archive-v1/` exists): v1 readers read flat + `_archive-v1/`, writers defer.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import {
  appendEventSegment,
  chunkEventsForSegmentAppends,
  utf8Length,
  type AppendOnlyEventLogConfig,
  type SegmentWriterIdentity,
} from "../../storage/appendOnlyEventLog";
import { casLoop, readBackOwnWrite } from "../../storage/casLoop";
import { mapWithConcurrency } from "../../storage/concurrency";
import { DIRECTORY_READ_CONCURRENCY, listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../../storage/inFlightReads";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { moveFileVerified } from "../../storage/moveFileVerified";
import { readFileTextWithRetry, safeReadJson, safeRemoveJson, safeWriteJson } from "../../storage/safeWrite";
import { getDistributionDeviceId } from "../../distribution/distributionEventStore";
import {
  ANSWER_EVENTS_FOLDERS,
  answerAssigneeFolderName,
  getAnswerArchiveV1Dir,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  getAssigneeAnswerEventsDir,
  noteAnswerEventsLayoutV2,
} from "../../workspace/workspacePaths";
import { ANSWER_EVENT_LOG, ANSWER_EVENT_SEGMENT_SUFFIX, sortAnswerEventsForFold, type AnswerEvent } from "../answerEventStore";
import { clearAnswerEventsCache, foldEmployeeEvents, loadLegacyAnswerSeed } from "../answerStorage";
import { v1OffsetKey } from "../v2/answerSnapshot";
import { readAnswerEventsLayoutMarker, writeAnswerEventsLayoutMarker, type AnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { listAssigneeFolders } from "../v2/assigneeEventReader";
import { rebuildAndPersistAssigneeSnapshot } from "../v2/rebuildAssigneeSnapshot";

export const MIGRATION_LOCK_STALE_MS = 30 * 60 * 1000;
export const MIGRATION_MS_PER_SEGMENT_ESTIMATE = 150;
const MAX_STRAGGLER_PASSES = 3;

export type MigrationPhase = "lock" | "read" | "archive" | "snapshot" | "move" | "stragglers" | "commit";
export type MigrationProgress = { phase: MigrationPhase; done: number; total: number };
export type MigrateMonthOptions = {
  actor: string;
  nowMs?: () => number;
  onProgress?: (progress: MigrationProgress) => void | Promise<void>;
};
export type MigrateMonthResult =
  | { status: "migrated"; marker: AnswerEventsLayoutMarker; quarantinedLines: number }
  | { status: "nothing-to-do" }
  | { status: "locked-elsewhere"; by: string; startedAt: string };

export type QuarantinedLine = { segment: string; line: number; raw: string; reason: "unparseable" | "no-assignee" };
type AssigneeGroup = { assignee: string; events: AnswerEvent[]; segments: Map<string, number> };

type MigrationLock = { by: string; deviceId: string; startedAt: string; token: string; revision: number; _writeToken?: string };

/** Pure: spec §6 step 2's grouping. Exported for its own test. */
export function groupFlatSegmentLines(
  segments: readonly { name: string; bytes: number; text: string }[]
): { groups: Map<string, AssigneeGroup>; quarantined: QuarantinedLine[] } {
  const groups = new Map<string, AssigneeGroup>();
  const quarantined: QuarantinedLine[] = [];
  for (const segment of segments) {
    segment.text.split("\n").forEach((raw, line) => {
      if (raw.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      const event = parsed as AnswerEvent;
      const owner = (event.answeredBy ?? "").trim() || (event.eventBy ?? "").trim();
      let folder: string;
      try {
        folder = answerAssigneeFolderName(owner);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "no-assignee" });
        return;
      }
      const group = groups.get(folder) ?? { assignee: owner, events: [], segments: new Map<string, number>() };
      group.events.push(event.answeredBy ? event : { ...event, answeredBy: owner });
      group.segments.set(segment.name, segment.bytes);
      groups.set(folder, group);
    });
  }
  return { groups, quarantined };
}

async function acquireMigrationLock(
  eventsDir: DirectoryHandleLike,
  actor: string,
  nowMs: number
): Promise<{ ok: true } | { ok: false; by: string; startedAt: string }> {
  const name = ANSWER_EVENTS_FOLDERS.migrationLock;
  const deviceId = getDistributionDeviceId();
  const outcome = await casLoop<{ ok: true } | { ok: false; by: string; startedAt: string }>(
    async (writeToken) => {
      const existing = await safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name);
      const held = existing.ok ? unwrap<MigrationLock>(existing.value) : null;
      const fresh = held !== null && nowMs - Date.parse(held.startedAt) < MIGRATION_LOCK_STALE_MS;
      if (held && fresh && !(held.by === actor && held.deviceId === deviceId)) {
        return { done: true, result: { ok: false, by: held.by, startedAt: held.startedAt } };
      }
      const previousRevision = held?.revision ?? 0;
      const next: MigrationLock = { by: actor, deviceId, startedAt: new Date(nowMs).toISOString(), token: writeToken, revision: previousRevision + 1, _writeToken: writeToken };
      const written = await safeWriteJson(eventsDir, name, wrap(next, previousRevision));
      const verdict = await readBackOwnWrite(
        written,
        () => safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name),
        (verify) => verify.ok && unwrap<MigrationLock>(verify.value)._writeToken === writeToken,
        "answers:migration-lock"
      );
      return verdict === "not-mine" ? { done: false } : { done: true, result: { ok: true } };
    },
    { context: "answers:migration-lock", maxRetries: 3, baseDelayMs: 150 }
  );
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome;
}

async function listFlatSegmentNames(eventsDir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

type FlatRead =
  | { status: "ok"; name: string; bytes: number; text: string }
  | { status: "missing"; name: string }
  | { status: "unopenable"; name: string };

async function readFlatSegments(eventsDir: DirectoryHandleLike, names: readonly string[], options: MigrateMonthOptions): Promise<FlatRead[]> {
  let done = 0;
  const reads = await mapWithConcurrency(names, DIRECTORY_READ_CONCURRENCY, async (name): Promise<FlatRead> => {
    try {
      const text = await readFileTextWithRetry(eventsDir, name);
      return text === null ? { status: "missing", name } : { status: "ok", name, bytes: utf8Length(text), text };
    } catch (error) {
      logError("answers:migration:unopenable", error, { action: name });
      return { status: "unopenable", name };
    }
  });
  for (const _ of reads) {
    done += 1;
    await options.onProgress?.({ phase: "read", done, total: reads.length });
  }
  return reads;
}
```

- [ ] **Step 4: Implement the archive, quarantine, snapshot, move, and the main loop**

Append to `flatToPerAssignee.ts`:

```ts
function migrationWriter(root: DirectoryHandleLike, month: string, folder: string, kind: "v1merge" | "quarant"): { writer: SegmentWriterIdentity; config: AppendOnlyEventLogConfig } {
  return {
    // Scoped per folder: the module-level seq memos are keyed on scopeId.
    writer: { deviceId: kind, sessionId: "migrat", scopeId: `${workspaceScopeId(root)}|${month}|${folder}|${kind}`, stable: false },
    config: {
      ...ANSWER_EVENT_LOG,
      consumerNamespace: "ansmig",
      eventsDirName: kind === "v1merge" ? ANSWER_EVENTS_FOLDERS.assigneeArchive : ANSWER_EVENTS_FOLDERS.quarantine,
      baseNamePrefix: kind === "v1merge" ? "v1" : "unparsed-v1",
    },
  };
}

async function appendToAssigneeArchive(root: DirectoryHandleLike, month: string, folder: string, group: AssigneeGroup): Promise<void> {
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, group.assignee, true);
  const { writer, config } = migrationWriter(root, month, folder, "v1merge");
  for (const chunk of chunkEventsForSegmentAppends(sortAnswerEventsForFold([...group.events]))) {
    await appendEventSegment<AnswerEvent>(assigneeDir, chunk, writer, config);
  }
}

/** Quarantined lines are wrapped as JSON records (the raw text is kept verbatim in `raw`; the original segment itself is archived untouched in `_archive-v1/`). */
async function writeQuarantine(root: DirectoryHandleLike, month: string, eventsDir: DirectoryHandleLike, lines: readonly QuarantinedLine[], nowIso: string): Promise<void> {
  const { writer, config } = migrationWriter(root, month, ANSWER_EVENTS_FOLDERS.quarantine, "quarant");
  const records = lines.map((line) => ({ quarantinedFrom: line.segment, line: line.line, reason: line.reason, raw: line.raw, quarantinedAt: nowIso }));
  for (const chunk of chunkEventsForSegmentAppends(records)) await appendEventSegment(eventsDir, chunk, writer, config);
}

type MigrationState = { processed: Map<string, number>; unmovable: Set<string>; moved: number; quarantinedLines: number };

async function migratePass(
  root: DirectoryHandleLike,
  month: string,
  eventsDir: DirectoryHandleLike,
  archiveV1Dir: DirectoryHandleLike,
  names: readonly string[],
  state: MigrationState,
  options: MigrateMonthOptions,
  now: () => number
): Promise<void> {
  const reads = await readFlatSegments(eventsDir, names, options);
  const fresh: { name: string; bytes: number; text: string }[] = [];
  for (const read of reads) {
    if (read.status === "missing") continue;
    if (read.status === "unopenable") state.unmovable.add(read.name);
    else if (state.processed.get(read.name) === read.bytes) state.unmovable.add(read.name); // folded, but its move keeps failing
    else fresh.push(read);
  }
  const { groups, quarantined } = groupFlatSegmentLines(fresh);
  if (quarantined.length > 0) {
    await writeQuarantine(root, month, eventsDir, quarantined, new Date(now()).toISOString());
    state.quarantinedLines += quarantined.length;
  }
  let done = 0;
  for (const [folder, group] of groups) {
    await appendToAssigneeArchive(root, month, folder, group);
    done += 1;
    await options.onProgress?.({ phase: "archive", done, total: groups.size });
  }
  done = 0;
  for (const group of groups.values()) {
    const extraOffsets = Object.fromEntries([...group.segments].map(([name, bytes]) => [v1OffsetKey(name), bytes]));
    await rebuildAndPersistAssigneeSnapshot(root, month, group.assignee, {
      actor: options.actor,
      loadLegacySeed: () => loadLegacyAnswerSeed(root, month, group.assignee),
      foldFn: foldEmployeeEvents,
      extraOffsets,
      nowMs: now(),
    });
    done += 1;
    await options.onProgress?.({ phase: "snapshot", done, total: groups.size });
  }
  for (const segment of fresh) state.processed.set(segment.name, segment.bytes);
  done = 0;
  for (const segment of fresh) {
    const outcome = await moveFileVerified(eventsDir, segment.name, archiveV1Dir, segment.bytes);
    if (outcome.status === "moved") state.moved += 1;
    done += 1;
    await options.onProgress?.({ phase: "move", done, total: fresh.length });
  }
}

export async function migrateMonthToPerAssignee(
  root: DirectoryHandleLike,
  month: string,
  options: MigrateMonthOptions
): Promise<MigrateMonthResult> {
  const now = options.nowMs ?? Date.now;
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return { status: "nothing-to-do" };
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const prior = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  const state: MigrationState = { processed: new Map(), unmovable: new Set(prior?.unmovable ?? []), moved: 0, quarantinedLines: 0 };
  let names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  if (layout === "v2" && names.length === 0) return { status: "nothing-to-do" };

  await options.onProgress?.({ phase: "lock", done: 0, total: 1 });
  const lock = await acquireMigrationLock(eventsDir, options.actor, now());
  if (!lock.ok) return { status: "locked-elsewhere", by: lock.by, startedAt: lock.startedAt };
  const archiveV1Dir = await getAnswerArchiveV1Dir(root, month, true);

  for (let pass = 0; pass < MAX_STRAGGLER_PASSES && names.length > 0; pass += 1) {
    if (pass > 0) await options.onProgress?.({ phase: "stragglers", done: pass, total: MAX_STRAGGLER_PASSES - 1 });
    await migratePass(root, month, eventsDir, archiveV1Dir, names, state, options, now);
    names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  }
  for (const name of names) state.unmovable.add(name);

  await options.onProgress?.({ phase: "commit", done: 0, total: 1 });
  const marker: AnswerEventsLayoutMarker = {
    layout: "per-assignee",
    schemaVersion: 1,
    migratedAt: new Date(now()).toISOString(),
    migratedBy: options.actor,
    flatSegmentsArchived: (prior?.flatSegmentsArchived ?? 0) + state.moved,
    assignees: (await listAssigneeFolders(root, month)).length,
    unmovable: [...state.unmovable].sort(),
    origin: prior?.origin ?? "migration",
  };
  await writeAnswerEventsLayoutMarker(eventsDir, marker);
  await safeRemoveJson(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock);
  noteAnswerEventsLayoutV2(root, month);
  bumpWorkspaceEpoch(root, month);
  clearAnswerEventsCache();
  return { status: "migrated", marker, quarantinedLines: state.quarantinedLines };
}
```

(`readFlatSegments` emits its `read` progress after the concurrent reads finish, so a crash injected at `read` happens after every read but before any write — the intended "crash at step 2".)

- [ ] **Step 5: Make v1 reads include `_archive-v1/` while a migration is incomplete**

In `readAllAnswerEventsForMonth` (`answerStorage.ts:492-535`), split the cached offsets by key prefix and read the archive alongside the flat folder. Replace the body's `readAnswerEventDelta(...)` call through `return [...events.values()];` with:

```ts
    const flatKnown: Record<string, number> = {};
    const archiveKnown: Record<string, number> = {};
    for (const [key, value] of Object.entries(cached?.offsets ?? {})) {
      if (isV1OffsetKey(key)) archiveKnown[key.slice(ANSWER_EVENTS_FOLDERS.archiveV1.length + 1)] = value;
      else flatKnown[key] = value;
    }
    const delta = await readAnswerEventDelta(mainDir, flatKnown, undefined, {
      ...options,
      sealedConfirmed: sealedFresh ? stillSealedNames(cached.sealedConfirmed!, cached.sealedNamesGen ?? 0) : undefined,
    });
    // A migration that crashed after moving segments into `_archive-v1/` leaves
    // the month v1 (`v1-migrating`): those segments' answers must stay visible.
    const archived = (await getAnswerEventsLayout(directoryHandle, monthFolderName)) === "v1-migrating"
      ? await readAnswerEventDelta(
          await getAnswerEventsDir(directoryHandle, monthFolderName, false),
          archiveKnown,
          { ...ANSWER_EVENT_LOG, eventsDirName: ANSWER_EVENTS_FOLDERS.archiveV1 },
          options
        )
      : null;
    const events = cached ? new Map(cached.events) : new Map<string, AnswerEvent>();
    for (const event of delta.events) events.set(event.eventId, event);
    for (const event of archived?.events ?? []) events.set(event.eventId, event);
    const offsets: Record<string, number> = { ...delta.offsets };
    for (const [name, value] of Object.entries(archived?.offsets ?? {})) offsets[v1OffsetKey(name)] = value;
    setAnswerEventsCacheEntry(directoryHandle, monthFolderName, {
      events,
      offsets,
      sealedConfirmed: delta.sealedConfirmedNames,
      sealedEpoch: epoch,
      sealedNamesGen: namesGen,
      sealedAtMs: sealedFresh ? cached.sealedAtMs : nowMs,
      listedSegmentNames: delta.segmentNames,
    });
    return [...events.values()];
```

Imports to add: `ANSWER_EVENT_LOG` from `./answerEventStore`; `ANSWER_EVENTS_FOLDERS` from `../workspace/workspacePaths`; `isV1OffsetKey, v1OffsetKey` from `./v2/answerSnapshot`. Add `/** v1 and v1-migrating months only. A v2 month reads per assignee (Task 4/10). */` to its doc comment.

- [ ] **Step 6: Run the migration tests**

Run: `npx vitest run src/data/answers/migration/flatToPerAssignee.test.ts`
Expected: PASS (11). If the crash-at-`commit` test fails on `snapshotOfAll(root)` before the re-run, Step 5 is not reading `_archive-v1/`.

- [ ] **Step 7: Regression + gates**

Run: `npx vitest run src/data/answers && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data/answers/migration src/data/answers/answerStorage.ts
git commit -m "Add (answers): admin flat-to-per-assignee migration, crash-resumable, archive-never-delete"
```

---

### Task 8: Admin-only migration prompt after sign-in

**Files:**
- Create: `src/data/answers/migration/answerLayoutMigrationProbe.ts`
- Create: `src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.tsx`
- Modify: `src/App.tsx` (render, after the `IntegrityReportDialog` block at `:400-405`)
- Modify: `src/data/labels/labelsStore.ts` (same block as Task 5)
- Test: `src/data/answers/migration/answerLayoutMigrationProbe.test.ts`, `src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1, Task 5 (`readAnswerEventsLayoutMarker`), Task 7 (`migrateMonthToPerAssignee`, `MIGRATION_MS_PER_SEGMENT_ESTIMATE`); `getSampleEmployeeDir(dir, month, create)` (`workspacePaths.ts:504`); `ANSWERS_SUFFIX`, `REQUESTS_SUFFIX` (`answerStorage.ts:110-112`); `useBootProgress(): { entries; allLoaded; resetGeneration }` (`bootProgress.ts`); `monthFoldersQueryOptions(dir)` (`data/query/monthFoldersQuery.ts:41`) → `MonthFolderInfo[]` (`{ month; year; folderName }`); `ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, hideConfirm, onConfirm, onCancel })`; `broadcastDataRefresh("manual")`; `AuthSession = { role; username; loginAt; mode? }`.
- Produces:
  - `type MonthMigrationNeed = { monthFolderName: string; kind: "flat" | "incomplete" | "stragglers"; flatSegments: number; assignees: number; estimateMs: number }`
  - `probeAnswerLayoutMigrations(root, monthFolderNames: readonly string[]): Promise<MonthMigrationNeed[]>`
  - `AnswersLayoutMigrationPrompt({ session, directoryHandle, workspaceReady })`

This deliberately does NOT touch `bootProgress.ts` or `BootSplashOverlay.tsx` (CLAUDE.md: that area regressed five times on effect timing). It is a sibling that waits for `allLoaded`, probes once per `username:loginAt:workspace`, and has no cancellation flag (a cancelled-then-latched effect would never show the prompt under StrictMode's double-invoke).

- [ ] **Step 1: Write the failing probe test**

```ts
// src/data/answers/migration/answerLayoutMigrationProbe.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { encodeEventLine } from "../../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getSampleEmployeeDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { makeV2Month, savedEvent, writeText } from "../v2/v2TestFixtures";
import { probeAnswerLayoutMigrations } from "./answerLayoutMigrationProbe";

describe("probeAnswerLayoutMigrations", () => {
  beforeEach(() => { __clearWorkspaceDirCacheForTests(); invalidateAnswerEventsLayout(); });

  it("reports flat v1 months with counts and estimate; skips absent and clean v2 months", async () => {
    const root = createMemoryDirectory("probe");
    const flat = await getAnswerEventsDir(root, "1-jan-2026", true);
    await writeText(flat, "a.ndjson", encodeEventLine(savedEvent("a", 1)));
    await writeText(flat, "b.ndjson", encodeEventLine(savedEvent("b", 1)));
    const employees = await getSampleEmployeeDir(root, "1-jan-2026", true);
    await writeText(employees, "emp1.answers.json", "{}");
    await writeText(employees, "emp1.requests.json", "{}");
    await writeText(employees, "emp2.requests.json", "{}");
    await makeV2Month(root, "2-feb-2026");
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026", "3-mar-2026"]);
    expect(needs).toEqual([{ monthFolderName: "1-jan-2026", kind: "flat", flatSegments: 2, assignees: 2, estimateMs: 300 }]);
  });

  it("reports an incomplete migration and v2 stragglers (minus unmovable)", async () => {
    const root = createMemoryDirectory("probe2");
    const crashed = await getAnswerEventsDir(root, "1-jan-2026", true);
    await crashed.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: true });
    await makeV2Month(root, "2-feb-2026");
    await writeText(await getAnswerEventsDir(root, "2-feb-2026"), "late.ndjson", encodeEventLine(savedEvent("l", 1)));
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026"]);
    expect(needs.map((n) => [n.monthFolderName, n.kind])).toEqual([["1-jan-2026", "incomplete"], ["2-feb-2026", "stragglers"]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement the probe**

Run: `npx vitest run src/data/answers/migration/answerLayoutMigrationProbe.test.ts` → FAIL (module missing).

```ts
// src/data/answers/migration/answerLayoutMigrationProbe.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { mapWithConcurrency } from "../../storage/concurrency";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { getAnswerEventsDir, getAnswerEventsLayout, getSampleEmployeeDir } from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX } from "../answerEventStore";
import { ANSWERS_SUFFIX, REQUESTS_SUFFIX } from "../answerStorage";
import { readAnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { MIGRATION_MS_PER_SEGMENT_ESTIMATE } from "./flatToPerAssignee";

export type MonthMigrationNeed = {
  monthFolderName: string;
  kind: "flat" | "incomplete" | "stragglers";
  flatSegments: number;
  assignees: number;
  estimateMs: number;
};

async function countAssigneeStems(root: DirectoryHandleLike, month: string): Promise<number> {
  try {
    const stems = new Set<string>();
    for (const entry of await listDirectoryEntries(await getSampleEmployeeDir(root, month, false))) {
      if (entry.kind !== "file") continue;
      for (const suffix of [ANSWERS_SUFFIX, REQUESTS_SUFFIX]) {
        if (entry.name.endsWith(suffix)) stems.add(entry.name.slice(0, -suffix.length).toLowerCase());
      }
    }
    return stems.size;
  } catch (error) {
    if (isNotFoundError(error)) return 0;
    throw error;
  }
}

async function probeMonth(root: DirectoryHandleLike, month: string): Promise<MonthMigrationNeed | null> {
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return null;
  const marker = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  const unmovable = new Set(marker?.unmovable ?? []);
  const flatSegments = (await listDirectoryEntries(await getAnswerEventsDir(root, month, false))).filter(
    (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX) && !unmovable.has(entry.name)
  ).length;
  const kind: MonthMigrationNeed["kind"] | null =
    layout === "v1-migrating" ? "incomplete" : flatSegments === 0 ? null : layout === "v2" ? "stragglers" : "flat";
  if (!kind) return null;
  return { monthFolderName: month, kind, flatSegments, assignees: await countAssigneeStems(root, month), estimateMs: flatSegments * MIGRATION_MS_PER_SEGMENT_ESTIMATE };
}

/** Which months an admin should be offered the migration for. One listing per month; never writes. */
export async function probeAnswerLayoutMigrations(root: DirectoryHandleLike, monthFolderNames: readonly string[]): Promise<MonthMigrationNeed[]> {
  const needs = await mapWithConcurrency(monthFolderNames, 4, async (month) => {
    try {
      return await probeMonth(root, month);
    } catch (error) {
      logError("answers:migration-probe", error, { action: month });
      return null;
    }
  });
  return needs.filter((need): need is MonthMigrationNeed => need !== null);
}
```

Run again → PASS (2).

- [ ] **Step 3: Add the prompt labels**

In `labelsStore.ts`, below the Task 5 keys:

```ts
  answers_layout_migration_title:      "ترحيل ملفات الإجابات إلى التخطيط الجديد",
  answers_layout_migration_body:       "يحتوي {monthCount} من الأشهر على ملفات إجابات بالتخطيط القديم. سيُنقل كل منها إلى مجلد خاص بكل موظف لتسريع التحميل. لن يُحذف أي ملف؛ تُنقل الملفات القديمة إلى أرشيف داخل المجلد نفسه.",
  answers_layout_migration_month_row:  "{month}: {segments} ملفًا، {assignees} موظفًا، المدة التقديرية {minutes} دقيقة",
  answers_layout_migration_incomplete: "ترحيل غير مكتمل",
  answers_layout_migration_confirm:    "بدء الترحيل",
  answers_layout_migration_later:      "لاحقًا",
  answers_layout_migration_close:      "إغلاق",
  answers_layout_migration_running:    "جارٍ ترحيل {month} ({done} من {total})…",
  answers_layout_migration_done:       "اكتمل ترحيل ملفات الإجابات.",
  answers_layout_migration_busy:       "ترحيل {month} قيد التنفيذ من جهاز آخر. أعد المحاولة لاحقًا.",
  answers_layout_migration_failed:     "تعذّر إكمال ترحيل {month}. يمكن إعادة المحاولة بأمان.",
```

- [ ] **Step 4: Write the failing component test**

```tsx
/* @vitest-environment jsdom */
// src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createMemoryDirectory } from "../../data/storage/memoryDirectory";
import { getLabels } from "../../data/labels/labelsStore";
import type { AuthSession } from "../../auth/authTypes";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), migrate: vi.fn() }));
vi.mock("../../data/answers/migration/answerLayoutMigrationProbe", () => ({ probeAnswerLayoutMigrations: mocks.probe }));
vi.mock("../../data/answers/migration/flatToPerAssignee", () => ({ migrateMonthToPerAssignee: mocks.migrate }));
vi.mock("../../data/query/monthFoldersQuery", () => ({
  monthFoldersQueryOptions: () => ({ queryKey: ["months-test"], queryFn: async () => [{ month: 5, year: 2026, folderName: "5-may-2026" }] }),
}));

import { AnswersLayoutMigrationPrompt } from "./AnswersLayoutMigrationPrompt";

function renderWith(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
const admin: AuthSession = { role: "admin", username: "admin", loginAt: "2026-10-13T08:00:00.000Z" };

describe("AnswersLayoutMigrationPrompt", () => {
  beforeEach(() => {
    mocks.probe.mockReset().mockResolvedValue([{ monthFolderName: "5-may-2026", kind: "flat", flatSegments: 2000, assignees: 12, estimateMs: 300_000 }]);
    mocks.migrate.mockReset().mockResolvedValue({ status: "migrated", marker: {}, quarantinedLines: 0 });
  });

  it("offers the migration to an admin with segment and assignee counts, and runs it on confirm", async () => {
    const dir = createMemoryDirectory("ui");
    renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={dir} workspaceReady />);
    await screen.findByText(/2000/);
    fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
    await waitFor(() => expect(mocks.migrate).toHaveBeenCalledWith(dir, "5-may-2026", { actor: "admin" }));
    await screen.findByText(getLabels().answers_layout_migration_done);
  });

  it("never probes or prompts for a non-admin", async () => {
    renderWith(<AnswersLayoutMigrationPrompt session={{ ...admin, role: "employee", username: "emp1" }} directoryHandle={createMemoryDirectory("ui2")} workspaceReady />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Later closes without migrating", async () => {
    renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory("ui3")} workspaceReady />);
    await screen.findByText(/2000/);
    fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_later }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/components/AnswersLayoutMigrationPrompt` → FAIL (component missing).

- [ ] **Step 5: Implement the component**

```tsx
// src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.tsx
//
// Spec 2026-10-13 §6: after an ADMIN signs in and the boot checklist has
// settled, offer the flat→per-assignee answers migration for every month that
// needs it. Never automatic, never for another role (CLAUDE.md migration policy).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { useBootProgress } from "../../data/workspace/bootProgress";
import { useLabels } from "../../data/labels/useLabels";
import { monthFoldersQueryOptions } from "../../data/query/monthFoldersQuery";
import { probeAnswerLayoutMigrations, type MonthMigrationNeed } from "../../data/answers/migration/answerLayoutMigrationProbe";
import { migrateMonthToPerAssignee } from "../../data/answers/migration/flatToPerAssignee";
import { broadcastDataRefresh } from "../../data/workspace/dataRefreshSignal";
import { logError } from "../../data/storage/errorLogger";

type Props = { session: AuthSession; directoryHandle: DirectoryHandleLike | null; workspaceReady: boolean };
type Phase = { kind: "idle" } | { kind: "prompt" } | { kind: "running"; text: string } | { kind: "done"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

export function AnswersLayoutMigrationPrompt({ session, directoryHandle, workspaceReady }: Props) {
  const labels = useLabels();
  const queryClient = useQueryClient();
  const { allLoaded } = useBootProgress();
  const [needs, setNeeds] = useState<MonthMigrationNeed[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const probedFor = useRef<string | null>(null);
  const eligible = session.role === "admin" && session.mode !== "demo" && directoryHandle !== null && workspaceReady;
  const sessionKey = `${session.username}:${session.loginAt}:${directoryHandle?.name ?? ""}`;

  useEffect(() => {
    if (!eligible || !allLoaded || !directoryHandle || probedFor.current === sessionKey) return;
    probedFor.current = sessionKey;
    void (async () => {
      try {
        const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
        const found = await probeAnswerLayoutMigrations(directoryHandle, months.map((month) => month.folderName));
        if (found.length > 0) {
          setNeeds(found);
          setPhase({ kind: "prompt" });
        }
      } catch (error) {
        logError("answersMigrationPrompt:probe", error);
      }
    })();
  }, [eligible, allLoaded, directoryHandle, sessionKey, queryClient]);

  async function runMigration(): Promise<void> {
    if (!directoryHandle) return;
    const problems: string[] = [];
    for (const [index, need] of needs.entries()) {
      setPhase({ kind: "running", text: fill(labels.answers_layout_migration_running, { month: need.monthFolderName, done: index + 1, total: needs.length }) });
      try {
        const result = await migrateMonthToPerAssignee(directoryHandle, need.monthFolderName, { actor: session.username });
        if (result.status === "locked-elsewhere") problems.push(fill(labels.answers_layout_migration_busy, { month: need.monthFolderName }));
      } catch (error) {
        logError("answersMigrationPrompt:migrate", error, { action: need.monthFolderName });
        problems.push(fill(labels.answers_layout_migration_failed, { month: need.monthFolderName }));
      }
    }
    broadcastDataRefresh("manual");
    setPhase({ kind: "done", text: problems.length === 0 ? labels.answers_layout_migration_done : problems.join(" ") });
  }

  if (phase.kind === "idle") return null;
  const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
  const message: ReactNode =
    phase.kind === "prompt" ? (
      <div dir="rtl">
        <p>{fill(labels.answers_layout_migration_body, { monthCount: needs.length })}</p>
        <ul>
          {needs.map((need) => (
            <li key={need.monthFolderName}>
              {fill(labels.answers_layout_migration_month_row, { month: need.monthFolderName, segments: need.flatSegments, assignees: need.assignees, minutes: minutes(need.estimateMs) })}
              {need.kind !== "flat" ? ` — ${labels.answers_layout_migration_incomplete}` : null}
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p role="status" dir="rtl">{phase.text}</p>
    );
  return (
    <ConfirmDialog
      open
      title={labels.answers_layout_migration_title}
      message={message}
      confirmLabel={labels.answers_layout_migration_confirm}
      cancelLabel={phase.kind === "prompt" ? labels.answers_layout_migration_later : labels.answers_layout_migration_close}
      hideConfirm={phase.kind !== "prompt"}
      onConfirm={() => void runMigration()}
      onCancel={() => {
        if (phase.kind !== "running") setPhase({ kind: "idle" });
      }}
    />
  );
}
```

- [ ] **Step 6: Mount it in `App.tsx`**

Import `{ AnswersLayoutMigrationPrompt } from "./components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt"` and render directly after the `IntegrityReportDialog` block (`:400-405`):

```tsx
      <AnswersLayoutMigrationPrompt
        session={session}
        directoryHandle={directoryHandle}
        workspaceReady={workspaceStatus === "ready"}
      />
```

- [ ] **Step 7: Run tests and gates**

Run: `npx vitest run src/components/AnswersLayoutMigrationPrompt src/data/answers/migration && npm run typecheck && npm run lint && npm run check:hex-literals`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data/answers/migration src/components/AnswersLayoutMigrationPrompt src/App.tsx src/data/labels/labelsStore.ts
git commit -m "Add (answers): admin-only prompt offering the per-assignee migration after sign-in"
```

---

### Task 9: Automatic per-assignee compaction

**Files:**
- Create: `src/data/answers/compaction/compactAssignee.ts`
- Modify: `src/data/answers/answerStorage.ts` — `loadEmployeeItemStateV2` (Task 4) schedules compaction after a successful read
- Test: `src/data/answers/compaction/compactAssignee.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1–6; `listDirectoryEntriesWithSize(dir, suffix): Promise<SizedDirectoryEntry[]>` with `SizedDirectoryEntry = { name; size; lastModified }` (`directoryScan.ts:505-515`, `:582`); `parseSegmentName(name, suffix): { base; seq } | null` (`directoryScan.ts:825`); `readFileTextWithRetry`; `utf8Length`; `isMonthClosed(dir, month): Promise<boolean>` (`monthLock.ts:133`); `readRealSession(): AuthSession | null` (`auth/authSession.ts:106`); `workspaceScopeId`.
- Produces:
  - `COMPACTION_SEGMENT_THRESHOLD = 20`, `COMPACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000`, `COMPACTION_QUIET_MS = 10 * 60 * 1000`, `COMPACTION_MIN_INTERVAL_MS = 60 * 60 * 1000`
  - `shouldCompact(input: { liveSegmentCount: number; snapshot: AnswerSnapshot | null; rebuilt: boolean; nowMs: number }): boolean`
  - `foldablePrefix(tail: string, cutoffMs: number): { events: AnswerEvent[]; prefixBytes: number }` (pure)
  - `selectCompactionCandidates(listing: readonly SizedDirectoryEntry[], foldedOffsets: Record<string, number>, cutoffMs: number): SizedDirectoryEntry[]` (pure)
  - `type CompactionDeps = { actor: string; loadLegacySeed: () => Promise<AnswerLegacySeed>; foldFn?: FoldFn; nowMs?: number; onPhase?: (phase: "folded" | "committed" | "moved") => void | Promise<void> }`
  - `type CompactionOutcome = { status: "compacted"; revision: number; archived: string[]; keptLive: string[] } | { status: "conflict" } | { status: "failed"; error: string }`
  - `compactAssignee(root, month, assignee, deps): Promise<CompactionOutcome>`
  - `maybeScheduleCompaction(root, month, assignee, read: Pick<AssigneeReadResult, "snapshot" | "liveSegmentNames" | "rebuilt">, deps: Omit<CompactionDeps, "actor"> & { session?: () => AuthSession | null }): Promise<CompactionOutcome | null> | null` (null = gated out; the promise never rejects)
  - `__resetCompactionRateLimitForTests(): void`

What gets folded: from EVERY live segment (heads included), the longest prefix of complete lines whose `eventAt` is older than `nowMs - COMPACTION_QUIET_MS`. Candidates moved to `archive/`: non-head segments (not the highest seq of their writer base), `lastModified` older than the quiet window, and fully folded (`foldedOffsets[name] === size`). So a fresh event (an on-behalf save being confirmed, a supervisor's in-flight append) is never folded within 10 minutes, and the snapshot's last folded key stays older than any new event — which is what keeps `foldSnapshotPlusDelta` out of the `late` path.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/answers/compaction/compactAssignee.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __clearWorkspaceDirCacheForTests, getAssigneeAnswerEventsDir, getAssigneeArchiveDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { foldAnswerEvents, type AnswerEvent } from "../answerEventStore";
import { snapshotDraftFromFold } from "../v2/answerSnapshot";
import { writeAnswerSnapshotCas } from "../v2/answerSnapshotStore";
import { readAssigneeState } from "../v2/assigneeEventReader";
import { appendToSegment, fileNames, makeV2Month, savedEvent, seedEvent, writeAssigneeSegment, V2_MONTH } from "../v2/v2TestFixtures";
import { __resetCompactionRateLimitForTests, compactAssignee, foldablePrefix, maybeScheduleCompaction, selectCompactionCandidates } from "./compactAssignee";

const LEGACY = { contentHash: "", items: [] };
const loadLegacySeed = async () => LEGACY;
const LATER = Date.UTC(2026, 4, 3, 0, 0); // a day after every fixture event
const A = "abcde-ans-deva0000-sesa00";
const B = "abcde-ans-devb0000-sesb00";

/** Writer A: sealed seq 0..2 + head seq 3; writer B: head seq 0. Every event is old. */
async function fixture(name: string): Promise<{ root: DirectoryHandleLike; all: AnswerEvent[] }> {
  const root = createMemoryDirectory(name);
  await makeV2Month(root);
  const all: AnswerEvent[] = [seedEvent()];
  await writeAssigneeSegment(root, "emp1", `${A}.ndjson`, [seedEvent(), savedEvent("a0", 1)]);
  all.push(savedEvent("a0", 1));
  for (let seq = 1; seq <= 3; seq += 1) {
    const event = savedEvent(`a${seq}`, seq * 10);
    await writeAssigneeSegment(root, "emp1", `${A}-${seq}.ndjson`, [event]);
    all.push(event);
  }
  const b0 = savedEvent("b0", 50, { authority: "supervisor", eventBy: "sup1", answeredOnBehalfBy: "sup1", reason: "r" });
  await writeAssigneeSegment(root, "emp1", `${B}.ndjson`, [b0]);
  all.push(b0);
  return { root, all };
}

async function state(root: DirectoryHandleLike) {
  __clearWorkspaceDirCacheForTests();
  return readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
}
const fullFold = (events: AnswerEvent[]) => foldAnswerEvents(events, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }).file.items;

describe("pure helpers", () => {
  it("foldablePrefix stops at the first recent or torn line", () => {
    const old = JSON.stringify(savedEvent("o", 1));
    const fresh = JSON.stringify(savedEvent("f", 10_000));
    const { events, prefixBytes } = foldablePrefix(`${old}\n${fresh}\n${old}`, LATER);
    expect(events.map((e) => e.eventId)).toEqual(["o"]);
    expect(prefixBytes).toBe(new TextEncoder().encode(`${old}\n`).length);
  });

  it("never selects a writer's head", () => {
    const listing = [`${A}.ndjson`, `${A}-1.ndjson`, `${A}-2.ndjson`, `${B}.ndjson`].map((name) => ({ name, size: 10, lastModified: 0 }));
    const offsets = Object.fromEntries(listing.map((e) => [e.name, 10]));
    expect(selectCompactionCandidates(listing, offsets, 1).map((e) => e.name)).toEqual([`${A}.ndjson`, `${A}-1.ndjson`]);
  });
});

describe("compactAssignee (spec §7)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __resetCompactionRateLimitForTests();
  });

  it("archives sealed segments, never a head, and the read still equals the full fold", async () => {
    const { root, all } = await fixture("c1");
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: LATER + 11 * 60_000 });
    expect(outcome).toMatchObject({ status: "compacted", revision: 1 });
    if (outcome.status === "compacted") expect(outcome.archived.sort()).toEqual([`${A}-1.ndjson`, `${A}-2.ndjson`, `${A}.ndjson`]);
    expect(await fileNames(await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1"))).toEqual([`${A}-3.ndjson`, `${B}.ndjson`]);
    expect((await fileNames(await getAssigneeArchiveDir(root, V2_MONTH, "emp1"))).length).toBe(3);
    const read = await state(root);
    expect(read.rebuilt).toBe(false);
    expect(read.result.file.items).toEqual(fullFold(all));
  });

  it("a lost CAS aborts cleanly: nothing moved", async () => {
    const { root } = await fixture("c2");
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", {
      actor: "emp1", loadLegacySeed, nowMs: LATER + 11 * 60_000,
      onPhase: async (phase) => {
        if (phase !== "folded") return;
        const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
        await writeAnswerSnapshotCas(dir, 0, snapshotDraftFromFold(foldAnswerEvents([seedEvent()], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }), { assignee: "emp1", monthFolderName: V2_MONTH, legacySeed: LEGACY, foldedOffsets: {}, compactedAt: "x", compactedBy: "other-tab" }), "test");
      },
    });
    expect(outcome).toEqual({ status: "conflict" });
    expect((await fileNames(await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1"))).length).toBe(5);
  });

  it("a move the share refuses leaves the segment live and the read correct", async () => {
    const { root, all } = await fixture("c3");
    setSimulatedFaults(root, [{ operation: "removeEntry", name: `${A}.ndjson`, errorName: "NoModificationAllowedError", times: 10_000 }]);
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: LATER + 11 * 60_000 });
    if (outcome.status !== "compacted") throw new Error(outcome.status);
    expect(outcome.keptLive).toEqual([`${A}.ndjson`]);
    expect((await state(root)).result.file.items).toEqual(fullFold(all));
  }, 60_000);

  for (const phase of ["folded", "committed", "moved"] as const) {
    it(`invariant: an append landing at "${phase}" is never lost`, async () => {
      const { root, all } = await fixture(`inv-${phase}`);
      const nowMs = LATER + 11 * 60_000;
      const outcome = await compactAssignee(root, V2_MONTH, "emp1", {
        actor: "emp1", loadLegacySeed, nowMs,
        onPhase: async (at) => {
          if (at !== phase) return;
          const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
          const toB = savedEvent("b-late", 24 * 60 + 5); // on writer B's head
          const toA = savedEvent("a-new", 24 * 60 + 6); // writer A rotates to a new head
          await appendToSegment(dir, `${B}.ndjson`, [toB]);
          await writeAssigneeSegment(root, "emp1", `${A}-4.ndjson`, [toA]);
          all.push(toB, toA);
        },
      });
      expect(outcome.status).toBe("compacted");
      expect((await state(root)).result.file.items).toEqual(fullFold(all));
    });
  }

  it("events inside the quiet window are not folded", async () => {
    const { root } = await fixture("quiet");
    const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
    const fresh = savedEvent("fresh", 24 * 60); // == LATER
    await appendToSegment(dir, `${B}.ndjson`, [fresh]);
    await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: LATER + 5 * 60_000 });
    const read = await state(root);
    expect(read.snapshot?.foldedEventIds).not.toContain("fresh");
    expect(read.deltaEvents.map((e) => e.eventId)).toEqual(["fresh"]);
  });

  it("scheduling: owner only, at most once per hour per (month, assignee)", async () => {
    const { root } = await fixture("rate");
    const read = { snapshot: null, liveSegmentNames: Array.from({ length: 21 }, (_, i) => `s${i}`), rebuilt: false };
    const session = () => ({ role: "employee" as const, username: "emp1", loginAt: "x" });
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 11 * 60_000, session: () => ({ ...session(), username: "sup1" }) })).toBeNull();
    const first = maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 11 * 60_000, session });
    expect(first).not.toBeNull();
    await first;
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 30 * 60_000, session })).toBeNull();
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 72 * 60_000, session })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/compaction/compactAssignee.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers and `shouldCompact`**

```ts
// src/data/answers/compaction/compactAssignee.ts
//
// Spec 2026-10-13 §7: automatic compaction of ONE assignee folder, run in that
// employee's own browser after a successful load. Folds old lines into
// snapshot.json (CAS on revision), then moves fully-folded, quiet, non-head
// segments into archive/. Never deletes; a failed move only leaves a segment
// live, whose bytes the snapshot's offset already covers.
import type { AuthSession } from "../../../auth/authTypes";
import { readRealSession } from "../../../auth/authSession";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { utf8Length } from "../../storage/appendOnlyEventLog";
import { mapWithConcurrency } from "../../storage/concurrency";
import { DIRECTORY_READ_CONCURRENCY, listDirectoryEntriesWithSize, parseSegmentName, type SizedDirectoryEntry } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { workspaceScopeId } from "../../storage/inFlightReads";
import { moveFileVerified } from "../../storage/moveFileVerified";
import { readFileTextWithRetry } from "../../storage/safeWrite";
import { isMonthClosed } from "../../population/monthLock";
import { answerAssigneeFolderName, getAssigneeAnswerEventsDir, getAssigneeArchiveDir } from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX, type AnswerEvent, type AnswerLegacySeed } from "../answerEventStore";
import { foldSnapshotPlusDelta, isV1OffsetKey, snapshotDraftFromFold, type AnswerSnapshot, type FoldFn } from "../v2/answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, writeAnswerSnapshotCas } from "../v2/answerSnapshotStore";
import { rebuildAssigneeState, type AssigneeReadResult } from "../v2/assigneeEventReader";

export const COMPACTION_SEGMENT_THRESHOLD = 20;
export const COMPACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPACTION_QUIET_MS = 10 * 60 * 1000;
export const COMPACTION_MIN_INTERVAL_MS = 60 * 60 * 1000;

export function shouldCompact(input: { liveSegmentCount: number; snapshot: AnswerSnapshot | null; rebuilt: boolean; nowMs: number }): boolean {
  if (input.rebuilt) return true;
  if (input.liveSegmentCount > COMPACTION_SEGMENT_THRESHOLD) return true;
  if (input.liveSegmentCount < 1) return false;
  const last = input.snapshot ? Date.parse(input.snapshot.compactedAt) : Number.NEGATIVE_INFINITY;
  return !(input.nowMs - last < COMPACTION_MAX_AGE_MS);
}

/** Longest prefix of COMPLETE lines whose eventAt is older than the cutoff. A torn last line is never folded. */
export function foldablePrefix(tail: string, cutoffMs: number): { events: AnswerEvent[]; prefixBytes: number } {
  const events: AnswerEvent[] = [];
  let prefixBytes = 0;
  let start = 0;
  while (start < tail.length) {
    const end = tail.indexOf("\n", start);
    if (end === -1) break;
    const line = tail.slice(start, end);
    if (line.length > 0) {
      const event = JSON.parse(line) as AnswerEvent; // a corrupt line throws, exactly like the reader
      if (!(Date.parse(event.eventAt) < cutoffMs)) break;
      events.push(event);
    }
    prefixBytes += utf8Length(tail.slice(start, end + 1));
    start = end + 1;
  }
  return { events, prefixBytes };
}

/** Non-head, quiet, fully folded. A writer's head (highest seq of its base) is never a candidate. */
export function selectCompactionCandidates(
  listing: readonly SizedDirectoryEntry[],
  foldedOffsets: Record<string, number>,
  cutoffMs: number
): SizedDirectoryEntry[] {
  const headSeq = new Map<string, number>();
  for (const entry of listing) {
    const parsed = parseSegmentName(entry.name, ANSWER_EVENT_SEGMENT_SUFFIX);
    if (parsed) headSeq.set(parsed.base, Math.max(headSeq.get(parsed.base) ?? -1, parsed.seq));
  }
  return listing.filter((entry) => {
    const parsed = parseSegmentName(entry.name, ANSWER_EVENT_SEGMENT_SUFFIX);
    if (!parsed || parsed.seq >= (headSeq.get(parsed.base) ?? 0)) return false;
    return entry.lastModified < cutoffMs && foldedOffsets[entry.name] === entry.size;
  });
}
```

- [ ] **Step 4: Implement `compactAssignee` and the scheduling gate**

Append:

```ts
export type CompactionDeps = {
  actor: string;
  loadLegacySeed: () => Promise<AnswerLegacySeed>;
  foldFn?: FoldFn;
  nowMs?: number;
  /** Observability / test seam, awaited at each phase boundary. */
  onPhase?: (phase: "folded" | "committed" | "moved") => void | Promise<void>;
};

export type CompactionOutcome =
  | { status: "compacted"; revision: number; archived: string[]; keptLive: string[] }
  | { status: "conflict" }
  | { status: "failed"; error: string };

type FoldableTail = { name: string; foldedThrough: number; events: AnswerEvent[] };

async function readFoldableTail(dir: DirectoryHandleLike, entry: SizedDirectoryEntry, fromOffset: number, cutoffMs: number): Promise<FoldableTail> {
  if (fromOffset >= entry.size) return { name: entry.name, foldedThrough: fromOffset, events: [] };
  const text = await readFileTextWithRetry(dir, entry.name);
  if (text === null) return { name: entry.name, foldedThrough: fromOffset, events: [] };
  const tail = new TextDecoder().decode(new TextEncoder().encode(text).subarray(fromOffset));
  const { events, prefixBytes } = foldablePrefix(tail, cutoffMs);
  return { name: entry.name, foldedThrough: fromOffset + prefixBytes, events };
}

async function readSnapshotForCompaction(dir: DirectoryHandleLike): Promise<{ snapshot: AnswerSnapshot | null; trusted: boolean; revision: number }> {
  try {
    const read = await readAnswerSnapshot(dir);
    if (read.kind === "absent") return { snapshot: null, trusted: true, revision: 0 };
    return { snapshot: read.snapshot, trusted: read.kind === "ok", revision: read.snapshot.revision };
  } catch (error) {
    if (error instanceof AnswerSnapshotCorruptError) return { snapshot: null, trusted: false, revision: 0 };
    throw error;
  }
}

function v1Keys(snapshot: AnswerSnapshot | null): Record<string, number> {
  return Object.fromEntries(Object.entries(snapshot?.foldedOffsets ?? {}).filter(([key]) => isV1OffsetKey(key)));
}

export async function compactAssignee(root: DirectoryHandleLike, month: string, assignee: string, deps: CompactionDeps): Promise<CompactionOutcome> {
  const nowMs = deps.nowMs ?? Date.now();
  const cutoffMs = nowMs - COMPACTION_QUIET_MS;
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, assignee, false);
  const current = await readSnapshotForCompaction(assigneeDir);
  const listing = await listDirectoryEntriesWithSize(assigneeDir, ANSWER_EVENT_SEGMENT_SUFFIX);
  const prior = current.trusted ? current.snapshot : null;
  const tails = await mapWithConcurrency(listing, DIRECTORY_READ_CONCURRENCY, (entry) =>
    readFoldableTail(assigneeDir, entry, prior?.foldedOffsets[entry.name] ?? 0, cutoffMs)
  );
  const legacySeed = prior?.legacySeed ?? (await deps.loadLegacySeed());
  const merged = current.trusted
    ? foldSnapshotPlusDelta(prior, tails.flatMap((tail) => tail.events), { legacySeed, username: assignee, monthFolderName: month, foldFn: deps.foldFn })
    : ({ kind: "late", lateEventId: "" } as const);
  let result;
  let offsets: Record<string, number>;
  if (merged.kind === "resumed") {
    result = merged.result;
    offsets = { ...(prior?.foldedOffsets ?? {}) };
    for (const tail of tails) offsets[tail.name] = tail.foldedThrough;
  } else {
    // Late event or untrusted snapshot: refold everything (archive + live).
    const rebuilt = await rebuildAssigneeState(root, month, assignee, { loadLegacySeed: deps.loadLegacySeed, foldFn: deps.foldFn });
    result = rebuilt.result;
    offsets = { ...v1Keys(current.snapshot), ...rebuilt.archiveOffsets, ...rebuilt.liveOffsets };
  }
  await deps.onPhase?.("folded");
  const draft = snapshotDraftFromFold(result, { assignee, monthFolderName: month, legacySeed, foldedOffsets: offsets, compactedAt: new Date(nowMs).toISOString(), compactedBy: deps.actor });
  const write = await writeAnswerSnapshotCas(assigneeDir, current.revision, draft, "answers:compaction");
  if (!write.ok) return { status: "failed", error: write.error };
  if (write.status === "conflict") return { status: "conflict" };
  await deps.onPhase?.("committed");
  const archiveDir = await getAssigneeArchiveDir(root, month, assignee, true);
  const archived: string[] = [];
  const keptLive: string[] = [];
  for (const entry of selectCompactionCandidates(listing, offsets, cutoffMs)) {
    const moved = await moveFileVerified(assigneeDir, entry.name, archiveDir, entry.size);
    (moved.status === "moved" ? archived : keptLive).push(entry.name);
  }
  await deps.onPhase?.("moved");
  return { status: "compacted", revision: write.snapshot.revision, archived, keptLive };
}

const lastRunByKey = new Map<string, number>();

export function __resetCompactionRateLimitForTests(): void {
  lastRunByKey.clear();
}

/**
 * The trigger (spec §7): only the signed-in OWNER of the folder, never a demo
 * session, never a closed month, at most once per hour per (month, assignee) in
 * this tab. Returns null when gated out; the promise never rejects (errors are
 * logged) so a fire-and-forget caller cannot leak an unhandled rejection.
 */
export function maybeScheduleCompaction(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  read: Pick<AssigneeReadResult, "snapshot" | "liveSegmentNames" | "rebuilt">,
  deps: Omit<CompactionDeps, "actor"> & { session?: () => AuthSession | null }
): Promise<CompactionOutcome | null> | null {
  const session = (deps.session ?? readRealSession)();
  if (!session || session.mode === "demo") return null;
  if (session.username.trim().toLowerCase() !== assignee.trim().toLowerCase()) return null;
  const nowMs = deps.nowMs ?? Date.now();
  if (!shouldCompact({ liveSegmentCount: read.liveSegmentNames.length, snapshot: read.snapshot, rebuilt: read.rebuilt, nowMs })) return null;
  const key = `${workspaceScopeId(root)}|${month}|${answerAssigneeFolderName(assignee)}`;
  const last = lastRunByKey.get(key);
  if (last !== undefined && nowMs - last < COMPACTION_MIN_INTERVAL_MS) return null;
  lastRunByKey.set(key, nowMs);
  return (async () => {
    if (await isMonthClosed(root, month)) return null;
    return compactAssignee(root, month, assignee, { ...deps, actor: session.username });
  })().catch((error: unknown) => {
    logError("answers:compaction", error instanceof Error ? error : new Error(String(error)), { action: month });
    return null;
  });
}
```

- [ ] **Step 5: Run the compaction tests**

Run: `npx vitest run src/data/answers/compaction/compactAssignee.test.ts`
Expected: PASS (10). If `isMonthClosed` reads the manifest and fails on the fixture, the `rate` test still passes (a closed/unknown month returns before compacting, and the second call is still rate-limited by the key set before the async body).

- [ ] **Step 6: Trigger compaction after a successful v2 employee load**

In `loadEmployeeItemStateV2` (`answerStorage.ts`, Task 4), after `readAssigneeState` resolves:

```ts
  // Spec §7: the employee's own browser compacts its own folder, after a successful load.
  void maybeScheduleCompaction(directoryHandle, monthFolderName, username, read, {
    loadLegacySeed: () => loadLegacyAnswerSeed(directoryHandle, monthFolderName, username),
    foldFn: foldEmployeeEvents,
  });
```

Import `maybeScheduleCompaction` from `./compaction/compactAssignee`. Check there is no import cycle: `compactAssignee.ts` must not import `answerStorage.ts` (it does not — legacy seed and fold come in through `deps`).

- [ ] **Step 7: Gates and commit**

Run: `npx vitest run src/data/answers && npm run typecheck && npm run lint && npm run check:complexity`
Expected: PASS.

```bash
git add src/data/answers/compaction src/data/answers/answerStorage.ts
git commit -m "Add (answers): automatic per-assignee compaction (quiet window, head-safe, CAS, hourly)"
```

---

### Task 10: Supervisor/report readers, in-tab cache keyed `{assignee}/{segment}`, history, and the v2 read-cost test

**Files:**
- Modify: `src/data/answers/answerStorage.ts` — `AnswerEventsCacheEntry` (`:285-305`), `loadEmployeeItemStateV2`, `decideV2Write`, `loadAllEmployeeFiles` (`:1849-1907`)
- Modify: `src/data/history/actionHistoryReaders.ts:58-70`
- Modify: `src/data/answers/answerSaveReadCost.test.ts` (add a v2 case)
- Test: `src/data/answers/answerV2Fanout.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1–9; `mapWithConcurrency`, `DIRECTORY_READ_CONCURRENCY`.
- Produces:
  - `AnswerEventsCacheEntry.assignees?: Map<string, AssigneeCacheState>` where `type AssigneeCacheState = { snapshot: AnswerSnapshot | null; snapshotStat: SnapshotStat | null; delta: Map<string, AnswerEvent>; listedSegmentNames: readonly string[]; seeded: boolean }`; v2 offsets live in `entry.offsets` under `assigneeOffsetKey(folder, name) = "{folder}/{name}"`
  - `export function assigneeOffsetKey(folder: string, segmentName: string): string`
  - `loadAllEmployeeFiles` v2 branch: one `EmployeeAnswerFile` per union(stems in `2-employees/`, assignee folders), concurrency 8, same strict/lenient contract.
  - `loadAnswerActionHistory` reads `readAllAssigneeEvents` on v2.

- [ ] **Step 1: Write the failing fan-out test**

```ts
// src/data/answers/answerV2Fanout.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, clearReadLog, getReadLog } from "../storage/memoryDirectory";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadAllEmployeeFiles, loadEmployeeAnswers, upsertItemAnswer, upsertItemAnswerOnBehalf } from "./answerStorage";
import { loadAnswerActionHistory } from "../history/actionHistoryReaders";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
function item(id: string, answeredBy = "emp1"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status: "draft" };
}
function reset(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

describe("v2 fan-out readers", () => {
  beforeEach(reset);

  it("loadAllEmployeeFiles returns exactly what each per-employee read returns", async () => {
    const root = createMemoryDirectory("fan");
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp2", item("B", "emp2"));
    await upsertItemAnswerOnBehalf(root, MONTH, "emp3", item("C", "emp3"), "sup1", "r");
    reset();
    const all = await loadAllEmployeeFiles(root, MONTH);
    expect(all.map((f) => f.username)).toEqual(["emp1", "emp2", "emp3"]);
    for (const file of all) {
      reset();
      expect(file.items).toEqual((await loadEmployeeAnswers(root, MONTH, file.username)).items);
    }
  });

  it("an employee's load never opens another assignee's folder", async () => {
    const root = createMemoryDirectory("scope", { trackReads: true });
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp2", item("B", "emp2"));
    reset();
    clearReadLog(root);
    await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(getReadLog(root).filter((path) => path.includes("answers.events/emp2/"))).toEqual([]);
  });

  it("a warm second load re-reads no segment the cache already consumed", async () => {
    const root = createMemoryDirectory("warm", { trackReads: true });
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    reset();
    await loadEmployeeAnswers(root, MONTH, "emp1");
    clearReadLog(root);
    await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(getReadLog(root).filter((path) => path.endsWith("snapshot.json"))).toEqual([]);
  });

  it("history reads the assignee's own events on a v2 month", async () => {
    const root = createMemoryDirectory("hist");
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp1", { ...item("A"), answers: [{ fieldId: "f", value: "v2" }] });
    reset();
    const history = await loadAnswerActionHistory(root, MONTH, "emp1", "A");
    expect(history).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/answers/answerV2Fanout.test.ts`
Expected: FAIL — `loadAllEmployeeFiles` returns `[]`/legacy-only on v2; history returns `[]`; warm load re-reads.

- [ ] **Step 3: Extend the cache entry with per-assignee state**

In `AnswerEventsCacheEntry` (`:285-305`) add:

```ts
  /**
   * Layout v2 only: per-assignee read state, keyed by assignee FOLDER name.
   * Byte offsets for v2 live in `offsets` under `assigneeOffsetKey(folder, name)`
   * (`{folder}/{segment}`), so one month entry holds every assignee this tab read.
   */
  assignees?: Map<string, AssigneeCacheState>;
```

Above it:

```ts
type AssigneeCacheState = {
  snapshot: AnswerSnapshot | null;
  snapshotStat: SnapshotStat | null;
  /** Events read past the snapshot's offsets, minus any the snapshot already folds. */
  delta: Map<string, AnswerEvent>;
  listedSegmentNames: readonly string[];
  seeded: boolean;
};

export function assigneeOffsetKey(folder: string, segmentName: string): string {
  return `${folder}/${segmentName}`;
}

function cachedAssigneeReadOptions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string
): Pick<AssigneeReadOptions, "knownOffsets" | "cachedDelta" | "cachedSnapshot"> {
  const entry = getAnswerEventsCacheEntry(directoryHandle, monthFolderName);
  const folder = answerAssigneeFolderName(assignee);
  const state = entry?.assignees?.get(folder);
  if (!entry || !state) return {};
  const prefix = `${folder}/`;
  const knownOffsets: Record<string, number> = {};
  for (const [key, value] of Object.entries(entry.offsets)) {
    if (key.startsWith(prefix)) knownOffsets[key.slice(prefix.length)] = value;
  }
  return {
    knownOffsets,
    cachedDelta: [...state.delta.values()],
    cachedSnapshot: state.snapshot && state.snapshotStat ? { stat: state.snapshotStat, snapshot: state.snapshot } : null,
  };
}

function storeAssigneeRead(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  read: AssigneeReadResult
): void {
  const folder = answerAssigneeFolderName(assignee);
  const entry = getAnswerEventsCacheEntry(directoryHandle, monthFolderName) ?? { events: new Map<string, AnswerEvent>(), offsets: {} };
  const prefix = `${folder}/`;
  const offsets: Record<string, number> = {};
  for (const [key, value] of Object.entries(entry.offsets)) if (!key.startsWith(prefix)) offsets[key] = value;
  const assignees = new Map(entry.assignees ?? []);
  if (read.rebuilt) {
    assignees.delete(folder); // a rebuild's events include archive/: start the next read cold
  } else {
    for (const name of read.liveSegmentNames) {
      const value = read.liveOffsets[name];
      if (value !== undefined) offsets[assigneeOffsetKey(folder, name)] = value;
    }
    const folded = new Set(read.snapshot?.foldedEventIds ?? []);
    assignees.set(folder, {
      snapshot: read.snapshot,
      snapshotStat: read.snapshotStat,
      delta: new Map(read.deltaEvents.filter((event) => !folded.has(event.eventId)).map((event) => [event.eventId, event])),
      listedSegmentNames: read.liveSegmentNames,
      seeded: read.result.seeded,
    });
  }
  setAnswerEventsCacheEntry(directoryHandle, monthFolderName, { ...entry, offsets, assignees });
}

/** This tab's own v2 append, reflected without a read (offsets untouched — the re-read dedups). */
function reflectLocalAppendInAssigneeCache(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  appended: readonly AnswerEvent[]
): void {
  const state = getAnswerEventsCacheEntry(directoryHandle, monthFolderName)?.assignees?.get(answerAssigneeFolderName(assignee));
  if (!state) return;
  for (const event of appended) {
    state.delta.set(event.eventId, event);
    if (event.eventType === "migration-seed") state.seeded = true;
  }
}
```

Imports: `type AnswerSnapshot` from `./v2/answerSnapshot`; `type SnapshotStat` from `./v2/answerSnapshotStore`; `type AssigneeReadResult` from `./v2/assigneeEventReader`.

- [ ] **Step 4: Use the cache in the v2 read and write paths**

`loadEmployeeItemStateV2` (Task 4/9) — read with the cache and store the result:

```ts
  const read = await readAssigneeState(directoryHandle, monthFolderName, username, {
    ...v2ReadOptions(directoryHandle, monthFolderName, username, extra),
    ...cachedAssigneeReadOptions(directoryHandle, monthFolderName, username),
  });
  storeAssigneeRead(directoryHandle, monthFolderName, username, read);
```

`decideV2Write`: same `{ ...v2ReadOptions(...), ...cachedAssigneeReadOptions(...) }` + `storeAssigneeRead(...)`, and add a blind branch (spec A5 parity on v2) at its top:

```ts
  if (blindAppendWhenSeeded) {
    const cached = decideFromAssigneeCache(directoryHandle, monthFolderName, assignee, xrayImageId, build);
    if (cached) return { ...target, seedEvent: null, blind: true, ...cached };
  }
```

with `decideV2Write` gaining a `blindAppendWhenSeeded: boolean` parameter (the `performAnswerWrite` call passes `options.blindAppendWhenSeeded ?? false`) and:

```ts
function decideFromAssigneeCache(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  xrayImageId: string,
  build: WriteBuild
): Pick<DecidedWrite, "previous" | "decision" | "listedNames"> | null {
  const state = getAnswerEventsCacheEntry(directoryHandle, monthFolderName)?.assignees?.get(answerAssigneeFolderName(assignee));
  if (!state?.seeded) return null;
  const legacySeed = state.snapshot?.legacySeed ?? getLegacySeedMemo(directoryHandle, monthFolderName, assignee);
  if (!legacySeed) return null;
  try {
    const folded = foldSnapshotPlusDelta(state.snapshot, [...state.delta.values()], {
      legacySeed, username: assignee, monthFolderName, foldFn: foldEmployeeEvents,
    });
    if (folded.kind === "late") return null;
    const previous = folded.result.file.items.find((item) => item.xrayImageId === xrayImageId);
    return { previous, decision: build({ previous }), listedNames: state.listedSegmentNames };
  } catch {
    return null;
  }
}
```

In `performAnswerWrite`'s `attempt`, replace `if (layout !== "v2") reflectLocalAppendInAnswerEventsCache(...)` with:

```ts
    if (layout === "v2") reflectLocalAppendInAssigneeCache(directoryHandle, monthFolderName, username, batch);
    else reflectLocalAppendInAnswerEventsCache(directoryHandle, monthFolderName, batch);
```

and in `appendOnBehalfV2` call `reflectLocalAppendInAssigneeCache(directoryHandle, monthFolderName, assigneeUsername, batch)` after the append. Import `foldSnapshotPlusDelta` from `./v2/answerSnapshot`.

- [ ] **Step 5: Add the v2 branch of `loadAllEmployeeFiles`**

At the top of `loadAllEmployeeFiles` (`:1853`):

```ts
  if ((await getAnswerEventsLayout(directoryHandle, monthFolderName)) === "v2") {
    return loadAllEmployeeFilesV2(directoryHandle, monthFolderName, options);
  }
```

and below the function:

```ts
/**
 * v2 fan-out (spec §5): enumerate assignee folders + per-employee stems, then
 * read each assignee's own folder, concurrency 8. Same strict/lenient contract
 * as the v1 scan above: lenient skips (and logs) one unreadable employee;
 * strict raises AnswersUnreadableError; a failed enumeration always throws.
 */
async function loadAllEmployeeFilesV2(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  options?: { strict?: boolean; tolerateConfirmedDead?: boolean }
): Promise<EmployeeAnswerFile[]> {
  const strict = options?.strict ?? false;
  try {
    const [dirStems, folders] = await Promise.all([
      listAnswerDirStems(directoryHandle, monthFolderName),
      listAssigneeFolders(directoryHandle, monthFolderName),
    ]);
    const byFolder = new Map<string, string>();
    for (const stem of dirStems) byFolder.set(stem.trim().toLowerCase(), stem);
    for (const folder of folders) if (!byFolder.has(folder)) byFolder.set(folder, folder);
    const files = await mapWithConcurrency([...byFolder.values()], DIRECTORY_READ_CONCURRENCY, async (username) => {
      try {
        const [itemState, requests] = await Promise.all([
          loadEmployeeItemStateV2(directoryHandle, monthFolderName, username, { strict, tolerateConfirmedDead: options?.tolerateConfirmedDead }),
          loadEmployeeRequestsFile(directoryHandle, monthFolderName, username),
        ]);
        const file: EmployeeAnswerFile = {
          username,
          monthFolderName,
          revision: requests.revision ?? 0,
          items: itemState.items,
          referralRequests: requests.referralRequests,
          replacementRequests: requests.replacementRequests,
          reopenRequests: requests.reopenRequests,
          lastUpdatedAt: requests.lastUpdatedAt,
        };
        return file;
      } catch (error) {
        if (strict) throw error;
        logError("answerStorage:loadAllEmployeeFiles:employee", error, { action: username });
        return null;
      }
    });
    return files.filter((file): file is EmployeeAnswerFile => file !== null).sort((a, b) => a.username.localeCompare(b.username));
  } catch (err) {
    logError("answerStorage:loadAllEmployeeFiles", err instanceof Error ? err : new Error(String(err)));
    throw strict && !(err instanceof AnswersUnreadableError) ? new AnswersUnreadableError(monthFolderName, { cause: err }) : err;
  }
}
```

Imports: `listAssigneeFolders` from `./v2/assigneeEventReader`; `DIRECTORY_READ_CONCURRENCY` from `../storage/directoryScan` (`mapWithConcurrency` is already imported at `:53`).

- [ ] **Step 6: v2 history source**

`actionHistoryReaders.ts:65-66` →

```ts
    const ownEvents = (await getAnswerEventsLayout(directoryHandle, monthFolderName)) === "v2"
      ? (await readAllAssigneeEvents(directoryHandle, monthFolderName, username)).events
      : eventsForEmployee(await readAllAnswerEventsForMonth(directoryHandle, monthFolderName), username);
```

Imports: `getAnswerEventsLayout` from `../workspace/workspacePaths`; `readAllAssigneeEvents` from `../answers/v2/assigneeEventReader`.

- [ ] **Step 7: Add the v2 read-cost case to `answerSaveReadCost.test.ts`**

The existing two tests build a v1 month (`answers.events/` with flat segments, no marker), so their numbers are unchanged (the layout probe uses `getFileHandle`, which the read log does not record). Append:

```ts
import { makeV2Month, writeAssigneeSegment, seedEvent as v2Seed, savedEvent } from "./v2/v2TestFixtures";
import { __clearWorkspaceDirCacheForTests, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";

describe("answer save — read cost on a v2 month (spec §10)", () => {
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });

  it("cold save opens only the saver's own folder; warm save ≤ 3 reads", async () => {
    const root = createMemoryDirectory("cost-v2", { trackReads: true }) as unknown as DirectoryHandleLike;
    await makeV2Month(root, MONTH);
    for (let other = 0; other < 4; other += 1) {
      for (let seq = 0; seq < 5; seq += 1) {
        const assignee = `other${other}`;
        await writeAssigneeSegment(root, assignee, `ans-dev0000${other}-abcde${other}${seq ? `-${seq}` : ""}.ndjson`, seq === 0 ? [v2Seed(assignee)] : [savedEvent(`${assignee}-${seq}`, seq, {}, assignee)], MONTH);
      }
    }
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    expect(getReadLog(root).filter((path) => path.includes("/other"))).toEqual([]);
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("B"))).ok).toBe(true);
    expect(getReadLog(root).length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 8: Run tests and gates**

Run: `npx vitest run src/data/answers src/data/history src/data/population/populationOverwriteGuard.test.ts src/data/reporting src/data/powerbiExport src/data/integrity && npm run typecheck && npm run lint && npm run check:complexity`
Expected: PASS (report/export snapshot tests unchanged — they consume `loadAllEmployeeFiles`, whose per-employee output the first fan-out test pins).

- [ ] **Step 9: Commit**

```bash
git add src/data/answers src/data/history
git commit -m "Change (answers): v2 fan-out readers, {assignee}/{segment} cache keys, v2 history source"
```

---

### Task 11: Sync tick probe for v2, and v2-aware restore

**Files:**
- Modify: `src/data/workspace/workspaceSync.ts` — `safeAnswerSegmentsSignature` (`:619-648`) and its call (`:768`), `probeChangedFamilies` (`:1010-1059`), owner selection (`:1132-1136`)
- Create: `src/data/answers/v2/answerRestoreSupport.ts`
- Modify: `src/data/backup/backupStorage.ts` — `collectJsonRestoreEntries` file branch (`:1027-1031`), `restoreJsonTree` answers block (`:1309-1312`)
- Test: `src/data/workspace/workspaceSync.answersV2.test.ts`, `src/data/answers/v2/answerRestoreSupport.test.ts` (create)

**Interfaces:**
- Consumes: `boundedSizeSignature(dir, suffix, budget?, exclude?, headsOnly?, probed?)` (`directoryScan.ts:708`), `ownStableAnswerSegmentMatcher(month, actor)` (`answerSegmentChain.ts:140`), `readRealSession`, `restoreActionFor(fileName): RestoreAction` and `RestoreAction` (`backupStorage.ts:911`), Tasks 1, 4, 9.
- Produces:
  - `answerFoldersSignature(eventsDir, monthFolderName): Promise<string>` — `"v2:" + JSON.stringify([[folder, boundedSignature], …])`
  - `movedAnswerFolders(previous: string, current: string): Set<string> | null` (null unless BOTH are v2 signatures)
  - `answerEventsRestoreAction(fileName: string, eventsDirName: string | null): RestoreAction | null`
  - `restoredAnswerAssignees(paths: readonly string[]): Array<{ month: string; folder: string }>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/data/workspace/workspaceSync.answersV2.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { encodeEventLine } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, getAnswerEventsDir, invalidateAnswerEventsLayout } from "./workspacePaths";
import { answerFoldersSignature, movedAnswerFolders } from "./workspaceSync";
import { appendToSegment, makeV2Month, savedEvent, writeAssigneeSegment } from "../answers/v2/v2TestFixtures";

describe("v2 answers signature", () => {
  beforeEach(() => { __clearWorkspaceDirCacheForTests(); invalidateAnswerEventsLayout(); });

  it("names exactly the assignee folders that moved", async () => {
    const root = createMemoryDirectory("sig");
    await makeV2Month(root);
    await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    const emp2 = await writeAssigneeSegment(root, "emp2", "b.ndjson", [savedEvent("b", 1, {}, "emp2")]);
    const events = await getAnswerEventsDir(root, "5-may-2026");
    const before = await answerFoldersSignature(events, "5-may-2026");
    await appendToSegment(emp2, "b.ndjson", [savedEvent("b2", 2, {}, "emp2")]);
    const after = await answerFoldersSignature(events, "5-may-2026");
    expect(movedAnswerFolders(before, after)).toEqual(new Set(["emp2"]));
    expect(movedAnswerFolders(before, before)).toEqual(new Set());
    expect(movedAnswerFolders("1|a.ndjson:10", after)).toBeNull(); // v1 → v2 flip: owners unknown
    expect(encodeEventLine).toBeTypeOf("function");
  });
});
```

```ts
// src/data/answers/v2/answerRestoreSupport.test.ts
import { describe, expect, it } from "vitest";
import { answerEventsRestoreAction, restoredAnswerAssignees } from "./answerRestoreSupport";

describe("answer restore support", () => {
  it("classifies v2 files under answers.events only", () => {
    expect(answerEventsRestoreAction("snapshot.json", "answers.events")).toBe("skip-derived");
    expect(answerEventsRestoreAction("_migration.lock.json", "answers.events")).toBe("skip-derived");
    expect(answerEventsRestoreAction("_layout.json", "answers.events")).toBe("restore-if-absent");
    expect(answerEventsRestoreAction("x.ndjson", "answers.events")).toBeNull();
    expect(answerEventsRestoreAction("snapshot.json", null)).toBeNull();
  });

  it("finds each (month, assignee) a restore touched — live or archive, never flat or reserved", () => {
    expect(
      restoredAnswerAssignees([
        "2-samples/5-may-2026/1-main/answers.events/emp1/a.ndjson",
        "2-samples/5-may-2026/1-main/answers.events/emp1/archive/b.ndjson",
        "2-samples/5-may-2026/1-main/answers.events/flat.ndjson",
        "2-samples/5-may-2026/1-main/answers.events/_archive-v1/c.ndjson",
        "2-samples/6-jun-2026/1-main/answers.events/emp2/d.ndjson",
      ])
    ).toEqual([{ month: "5-may-2026", folder: "emp1" }, { month: "6-jun-2026", folder: "emp2" }]);
  });
});
```

Run: `npx vitest run src/data/workspace/workspaceSync.answersV2.test.ts src/data/answers/v2/answerRestoreSupport.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Implement the v2 signature and owners**

In `workspaceSync.ts`, add (near `safeAnswerSegmentsSignature`):

```ts
const V2_ANSWERS_SIGNATURE_PREFIX = "v2:";
/** Per assignee folder: a v2 folder holds < ~20 live segments, so a small head budget covers it. */
const ANSWER_FOLDER_HEAD_STAT_BUDGET = 8;

/** v2 (spec §5): one bounded signature per assignee folder. Owners of a change = folders that moved. */
export async function answerFoldersSignature(eventsDir: DirectoryHandleLike, monthFolderName: string): Promise<string> {
  const actor = readRealSession()?.username;
  const exclude = actor ? ownStableAnswerSegmentMatcher(monthFolderName, actor) : undefined;
  const folders = (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "directory" && isAnswerAssigneeFolderName(entry.name))
    .map((entry) => entry.name)
    .sort();
  const entries = await mapWithConcurrency(folders, DIRECTORY_READ_CONCURRENCY, async (folder) => {
    const dir = await eventsDir.getDirectoryHandle(folder, { create: false });
    return [folder, await boundedSizeSignature(dir, ANSWER_EVENT_SEGMENT_SUFFIX, ANSWER_FOLDER_HEAD_STAT_BUDGET, exclude, true)] as const;
  });
  return `${V2_ANSWERS_SIGNATURE_PREFIX}${JSON.stringify(entries)}`;
}

/** Folders whose entry differs; null unless BOTH signatures are v2 (a v1→v2 flip = owners unknown). */
export function movedAnswerFolders(previous: string, current: string): Set<string> | null {
  if (!previous.startsWith(V2_ANSWERS_SIGNATURE_PREFIX) || !current.startsWith(V2_ANSWERS_SIGNATURE_PREFIX)) return null;
  try {
    const before = new Map<string, string>(JSON.parse(previous.slice(V2_ANSWERS_SIGNATURE_PREFIX.length)) as Array<[string, string]>);
    const after = new Map<string, string>(JSON.parse(current.slice(V2_ANSWERS_SIGNATURE_PREFIX.length)) as Array<[string, string]>);
    const moved = new Set<string>();
    for (const [folder, signature] of after) if (before.get(folder) !== signature) moved.add(folder);
    for (const folder of before.keys()) if (!after.has(folder)) moved.add(folder);
    return moved;
  } catch {
    return null;
  }
}
```

`safeAnswerSegmentsSignature` gains a third parameter `directoryHandle: DirectoryHandleLike` and, first thing inside the `try`:

```ts
    if ((await getAnswerEventsLayout(directoryHandle, monthFolderName)) === "v2") {
      return await answerFoldersSignature(dir, monthFolderName);
    }
```

Update its call (`:768`) to `safeAnswerSegmentsSignature(dirs.answersEventsDir, monthFolderName, directoryHandle)`.

In `probeChangedFamilies` (`:1010-1059`), before the existing `if (previous && movedFrom(previous.answersEventsSignature, …))` block:

```ts
  const v2Owners =
    previous && isProbed(previous.answersEventsSignature) && isProbed(current.answersEventsSignature)
      ? movedAnswerFolders(previous.answersEventsSignature, current.answersEventsSignature)
      : null;
```

wrap the existing block's condition with `!v2Owners &&` (a v2 tick has no sealed-segment confirmations and no peek to do), add `v2Owners` to the returned object and to the `ChangedFamilies` result type (`:978-992`, `v2Owners: Set<string> | null`). At `:1132-1136` destructure `v2Owners` too and choose owners:

```ts
      if (changed.has("answers") && v2Owners) {
        answerOwners = v2Owners;
      } else if (changed.has("answers") && movedSegmentPrevSizes && !ownersUnknown) {
        answerOwners = await peekAnswerOwners(movedSegmentPrevSizes);
      }
```

Imports to add: `getAnswerEventsLayout`, `isAnswerAssigneeFolderName` from `./workspacePaths`; `listDirectoryEntries`, `DIRECTORY_READ_CONCURRENCY` from `../storage/directoryScan` (`boundedSizeSignature` and `mapWithConcurrency` are already imported).

- [ ] **Step 3: Implement restore support and wire it into backupStorage**

```ts
// src/data/answers/v2/answerRestoreSupport.ts
import type { RestoreAction } from "../../backup/backupStorage";
import { ANSWER_EVENTS_FOLDERS, isAnswerAssigneeFolderName } from "../../workspace/workspacePaths";

/**
 * Layout-v2 files under `answers.events/`: `snapshot.json` is DERIVED (rebuilt
 * after the restore from the merged segments — restoring an older one would
 * hide segments archived since); a migration lock is never restored; the
 * layout marker only when absent (a restore never downgrades or re-stamps).
 */
export function answerEventsRestoreAction(fileName: string, eventsDirName: string | null): RestoreAction | null {
  if (eventsDirName !== ANSWER_EVENTS_FOLDERS.root) return null;
  if (fileName === ANSWER_EVENTS_FOLDERS.assigneeSnapshot || fileName === ANSWER_EVENTS_FOLDERS.migrationLock) return "skip-derived";
  if (fileName === ANSWER_EVENTS_FOLDERS.layoutMarker) return "restore-if-absent";
  return null;
}

/** Every (month, assignee folder) a restore wrote into — live or archive. Flat (v1) and reserved paths are skipped. */
export function restoredAnswerAssignees(paths: readonly string[]): Array<{ month: string; folder: string }> {
  const seen = new Map<string, { month: string; folder: string }>();
  for (const path of paths) {
    const parts = path.split("/");
    const at = parts.indexOf(ANSWER_EVENTS_FOLDERS.root);
    if (at < 2 || parts.length < at + 3) continue;
    const folder = parts[at + 1]!;
    if (!isAnswerAssigneeFolderName(folder)) continue;
    const month = parts[at - 2]!;
    seen.set(`${month}/${folder}`, { month, folder });
  }
  return [...seen.values()];
}
```

If `RestoreAction` is not exported from `backupStorage.ts`, add `export` to its type declaration (it is a type-only import, so no runtime cycle).

In `collectJsonRestoreEntries` (`:1027`): `const action = answerEventsRestoreAction(entry.name, params.eventsDirName) ?? restoreActionFor(entry.name);`

In `restoreJsonTree`, extend the answers block (`:1309-1312`):

```ts
  if (applied.some((result) => result.eventsDirName === ANSWER_EVENTS_DIR)) {
    clearAnswerEventsCache();
    invalidateSealedAnswerSegments();
    // v2: snapshot.json is skip-derived, so every assignee whose segments the
    // restore merged gets its snapshot refolded from archive + live.
    for (const { month, folder } of restoredAnswerAssignees(applied.map((result) => result.path))) {
      try {
        if ((await getAnswerEventsLayout(params.targetDir, month)) !== "v2") continue;
        await rebuildAndPersistAssigneeSnapshot(params.targetDir, month, folder, {
          actor: "restore",
          loadLegacySeed: () => loadLegacyAnswerSeed(params.targetDir, month, folder),
          foldFn: foldEmployeeEvents,
        });
      } catch (error) {
        logError("backup:restore:answer-snapshot-rebuild", error, { action: `${month}/${folder}` });
      }
    }
  }
```

Imports: `answerEventsRestoreAction`, `restoredAnswerAssignees` from `../answers/v2/answerRestoreSupport`; `rebuildAndPersistAssigneeSnapshot` from `../answers/v2/rebuildAssigneeSnapshot`; `loadLegacyAnswerSeed`, `foldEmployeeEvents` from `../answers/answerStorage` (already imports `clearAnswerEventsCache` from there); `getAnswerEventsLayout` from `../workspace/workspacePaths`.

- [ ] **Step 4: Run tests and the regression set**

Run: `npx vitest run src/data/workspace src/data/answers/v2 src/data/backup && npm run typecheck && npm run lint && npm run check:complexity`
Expected: PASS. If `check:complexity` flags `probeChangedFamilies`, extract the v1 sealed/owners block into `v1AnswerSegmentChanges(previous, current)` returning `{ sealedInvalidation, movedSegmentPrevSizes, ownersUnknown }`.

- [ ] **Step 5: Commit**

```bash
git add src/data/workspace src/data/answers/v2 src/data/backup
git commit -m "Change (answers): v2 sync signature with per-folder owners; v2-aware restore with snapshot rebuild"
```

---

### Task 12: Data-system report, rollback procedure, release gates, edit log (v154.0)

**Files:**
- Modify: `docs/architecture/data-system-report.md` (row at `:185`; new subsection after the table, before `## Population Row Data Dictionary` at `:191`)
- Modify: `CLAUDE.md` (disk layout block, `2-samples/` lines)
- Modify: `docs/edit logs/2026-10-13.md`, `package.json` (via `npm run editlog`)

**Interfaces:**
- Consumes: everything above.
- Produces: docs; version `154.0.0`.

- [ ] **Step 1: Update `data-system-report.md`**

Replace the `answers.events/...` row (`:185`) with:

```markdown
| `answers.events/_layout.json` | `2-samples/{month}/1-main/` | Layout-v2 commit marker (`JsonEnvelope<{ layout: "per-assignee", schemaVersion: 1, migratedAt, migratedBy, flatSegmentsArchived, assignees, unmovable[], origin }>`). Absent = v1 (flat). Written LAST by the admin migration, or before the first append of a brand-new month. |
| `answers.events/{assignee}/snapshot.json` | `2-samples/{month}/1-main/` | `JsonEnvelope<AnswerSnapshot>`: folded items, frozen legacy seed, `foldedOffsets` (bare name = this folder or its `archive/`; `_archive-v1/{name}` = a v1 flat segment), `seeded`, `markers`, `foldedEventIds`, `revision` (CAS), `compactedAt/By`. Derived: rebuildable from `archive/` + live + the legacy `.answers.json`. |
| `answers.events/{assignee}/{creationMinute}-ans-{deviceHash}-{chainHash}[-seq].ndjson` | `2-samples/{month}/1-main/` | Live answer segments of ONE assignee (self-saves AND supervisors' on-behalf saves). Byte-identical line format to v1. One stable chain per browser × month × writer, now per assignee folder. |
| `answers.events/{assignee}/archive/*.ndjson` | `2-samples/{month}/1-main/` | Segments folded into the snapshot and moved here by compaction, plus `v1-…` files holding this assignee's v1 lines (written by the migration). Never listed by the reader; read only by a full rebuild and the history view. |
| `answers.events/_archive-v1/*.ndjson` | `2-samples/{month}/1-main/` | The month's original flat v1 segments, moved untouched by the migration. Kept forever; nothing reads them once the month is v2. |
| `answers.events/_quarantine/unparsed-v1-*.ndjson` | `2-samples/{month}/1-main/` | v1 lines the migration could not parse or attribute, wrapped as `{ quarantinedFrom, line, reason, raw, quarantinedAt }`. |
| `answers.events/_migration.lock.json` | `2-samples/{month}/1-main/` | Present only while (or after a crash of) an admin migration: `{ by, deviceId, startedAt, token, revision }`. Writers defer saves to the local pending queue while it, or `_archive-v1/` without `_layout.json`, exists. Stale after 30 min. |
| `answers.events/{creationMinute}-ans-{deviceHash}-{chainHash}[-seq].ndjson` (v1) | `2-samples/{month}/1-main/` | v1 (flat) months only: every employee's segments in one folder. Read by the unchanged v1 reader until an admin migrates the month. |
```

After the table add:

```markdown
### Answer events layout v2 (per-assignee), v154.0 — 2026-10-13

Spec: `docs/superpowers/specs/2026-10-13-answers-compaction-and-load-path-design.md` §4–§7. Plan: `docs/superpowers/plans/2026-10-13-answers-layout-v2.md`.

- **Read (v2):** `readAssigneeState` reads `{assignee}/snapshot.json`, then the live segments past `foldedOffsets`, and resumes the fold. It rebuilds from `archive/` + live instead when the snapshot was recovered from `.bak`, is corrupt, changed during the read (three tries), or a new event sorts before the snapshot's last folded event. Supervisors/reports enumerate assignee folders (concurrency 8). The in-tab cache keys v2 offsets `{assignee}/{segment}`.
- **Write:** every append goes to `answers.events/{assignee}/`. The layout is probed on every save (v2 is cached per tab once seen; v1 never is). A month with no `answers.events/` is stamped v2 before its first append. During a migration (`v1-migrating`) item saves go to the local pending queue and reopen/quality-note actions are refused with a retry message.
- **Migration (admin, one-time):** offered after an admin signs in (`AnswersLayoutMigrationPrompt`), never automatic. Steps: CAS lock → read every flat segment once → per assignee: append its lines to `{assignee}/archive/v1-…`, refold, write `snapshot.json` → move each flat segment to `_archive-v1/` (move, or copy → verify bytes → remove) → re-list for stragglers (≤ 3 passes) → write `_layout.json` → remove the lock. A crash before `_layout.json` leaves the month v1: v1 readers then also read `_archive-v1/`. Unopenable segments stay flat and are listed in `_layout.json.unmovable`.
- **Compaction (automatic, employee's own browser, own folder):** after a load, when live segments > 20 or the snapshot is older than 7 days, at most hourly per tab. Folds lines older than 10 minutes from every live segment, writes the snapshot (CAS on `revision`), then moves fully-folded, quiet, non-head segments to `archive/`. A writer's head segment is never moved.
- **Restore:** `snapshot.json` and the lock are skip-derived; `_layout.json` restore-if-absent; every assignee whose segments a restore merged gets its snapshot refolded. A v1 backup restored into a v2 month leaves flat "stragglers", which the admin prompt offers to migrate.

**Rollback (manual; requires the pre-154 build).** Nothing is deleted, so every original byte is still on disk:
1. Close every client. Back up the workspace.
2. For each v2 month: move every file in `answers.events/_archive-v1/` back into `answers.events/`.
3. To keep answers saved AFTER the migration, copy each `answers.events/{assignee}/*.ndjson` and `answers.events/{assignee}/archive/*.ndjson` EXCEPT `v1-…` files into `answers.events/`, renaming each to `{assignee}--{name}` (two assignee folders can hold the same chain name). Watch the 260-character path limit on deep shares.
4. Delete `answers.events/_layout.json` (and `_migration.lock.json` if present). Leave the assignee folders; v1 code ignores directories.
5. Reopen with the pre-154 build. Expect the first load of each month to be slow (it is the flat layout again).
```

- [ ] **Step 2: Update `CLAUDE.md`'s disk layout block**

Under `2-samples/`, after `distribution.current.json (derived cache), main.samples.json`, add:

```
                    answers.events/ — v2: _layout.json, {assignee}/snapshot.json + live segments
                    + archive/, _archive-v1/ (v1 originals); v1 months: flat segments
```

- [ ] **Step 3: Run the full tier-3 gate sequence**

Run each, in order, and fix before moving on:
```
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
```
Expected: all PASS. Quote the decisive line of any failure in the edit log if it needed a fix.

- [ ] **Step 4: Generate the edit-log entry and bump the version**

Run: `npm run editlog -- --tier=3 --append --sync-package --version=154.0 "Change (answers): per-assignee answer layout v2 with admin migration and automatic compaction"`

Then write the prose under the generated skeleton: `Why:` (spec §1 field evidence: ~2,000 segments, every load opens every unsealed segment), `What changed:` per task, Before/After snippets (the `answerWriterIdentity` scopeId change; `loadEmployeeItemState`'s v2 branch), the migration/rollback paragraph (point to `data-system-report.md`), every test file Task 5 Step 7 pinned to v1 with `makeV1Month`, and the behavior change that v1 events with no `answeredBy` now fold under their `eventBy` after migration.

- [ ] **Step 5: Release check**

Run: `npm run check:release`
Expected: PASS (`package.json` 154.0.0 ↔ latest edit-log entry v154.0).

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/data-system-report.md CLAUDE.md "docs/edit logs/2026-10-13.md" package.json package-lock.json src/data/changelog/latestUpdates.generated.ts
git commit -m "Docs (answers): layout v2 data-system report, rollback procedure, v154.0 edit log"
```

---

## Self-review (run before handing off)

| Spec item | Task |
|---|---|
| §4 `_layout.json` fields + written last | 5 (type), 7 (written last), 12 (doc) |
| §4 `_archive-v1/`, `{assignee}/snapshot.json`, `{assignee}/archive/` | 1, 3, 7, 9 |
| §4 helpers `getAnswerEventsLayout`, `getAssigneeAnswerEventsDir`, `getAnswerArchiveV1Dir`, `getAssigneeArchiveDir` | 1 |
| §4 `AnswerSnapshot` fields, legacy seed carried | 2 |
| §4 every writer appends into the assignee's folder | 5 |
| §5 snapshot + live past `foldedOffsets`; archived never listed | 4 |
| §5 parity test, randomized, fixed seed | 2 (pure), 4 (disk) |
| §5 supervisors iterate assignee folders, concurrency 8 | 10 |
| §5 cache keys `{assignee}/{segmentName}` | 10 |
| §5 v1 unchanged | 5, 7 (plus `_archive-v1/` while incomplete) |
| §5 layout checked per save; sync tick `_layout.json` probe | 1, 5, 11 |
| §6 trigger: admin sign-in prompt, Arabic labels, counts, estimate, Confirm/Later | 8 |
| §6 steps 1–6, crash re-runnable, archive-never-delete, quarantine, unmovable, stragglers | 6, 7 |
| §6 non-admin saves deferred to pending queue during the lock | 5 |
| §7 thresholds, quiet window, head safety, CAS, rate limit, failed move | 9 |
| §7 invariant under interleaving | 9 |
| §10 tests (routing, parity, migration, compaction, read cost v2) | 2, 4, 5, 7, 9, 10 |
| §11 PR 3 tier 3, v154.0.0, data-system-report, rollback | 12 |
| §12 `move()` fallback | 6 |
