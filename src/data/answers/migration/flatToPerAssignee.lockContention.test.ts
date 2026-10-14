// src/data/answers/migration/flatToPerAssignee.lockContention.test.ts
//
// v154.0 round 7 field report: migrating a month on the real SMB share while
// employees kept the app open failed with "unexpected error" — the share kept
// refusing the replace of `_migration.lock.json` (every v154 client reads it),
// and the leftover lock then blocked the owner's own retry as "another device".
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { unwrap, wrap } from "../../storage/jsonEnvelope";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { clearErrors, getRecentErrors } from "../../storage/errorLogger";
import { pickSiblingHealCandidates } from "../../integrity/bootIntegrityScan";
import { getDistributionDeviceId } from "../../distribution/distributionEventStore";
import {
  __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerArchiveV1Dir, getAnswerEventsDir,
  getAnswerEventsLayout, getAssigneeArchiveDir, invalidateAnswerEventsLayout,
} from "../../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "../answerStorage";
import type { ItemAnswer } from "../answerTypes";
import { fileNames, makeV1Month, readText, savedEvent, writeText } from "../v2/v2TestFixtures";
import { probeAnswerLayoutMigrations } from "./answerLayoutMigrationProbe";
import { classifyMigrationFailure } from "./migrationFailureReason";
import {
  __forgetEndedMigrationRunsForTests, MIGRATION_LOCK_SILENT_MS, MIGRATION_LOCK_STALE_MS,
  migrateMonthToPerAssignee, type MigrationPhase,
} from "./flatToPerAssignee";

const MONTH = "1-january-2026";
const LOCK = ANSWER_EVENTS_FOLDERS.migrationLock;

function item(id: string, answeredBy = "emp1"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-01-02T00:00:00.000Z", submittedAt: null, answeredBy, status: "draft" };
}

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

async function month(name: string): Promise<{ root: DirectoryHandleLike; events: DirectoryHandleLike }> {
  const root = createMemoryDirectory(name);
  await makeV1Month(root, MONTH);
  for (const [id, who] of [["A1", "emp1"], ["A2", "emp1"], ["B1", "emp2"], ["C1", "emp3"]] as const) {
    expect((await upsertItemAnswer(root, MONTH, who, item(id, who))).ok).toBe(true);
  }
  const events = await getAnswerEventsDir(root, MONTH, false);
  await writeText(events, "zz-bad-devb-sesb.ndjson", `${encodeEventLine(savedEvent("q", 6, { xrayImageId: "X8" }))}{not json\n`);
  resetCaches();
  return { root, events };
}

/** A clock that moves `stepMs` on every read: the run's progress steps cross the heartbeat interval. */
function steppingClock(stepMs: number, start = Date.now()): () => number {
  let t = start;
  return () => (t += stepMs);
}

async function dirBytes(dir: DirectoryHandleLike): Promise<number> {
  let total = 0;
  for (const name of await fileNames(dir)) total += (await readText(dir, name)).length;
  return total;
}

async function archiveBytes(root: DirectoryHandleLike): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const who of ["emp1", "emp2", "emp3"]) out[who] = await dirBytes(await getAssigneeArchiveDir(root, MONTH, who));
  const events = await getAnswerEventsDir(root, MONTH, false);
  out.quarantine = await dirBytes(await events.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.quarantine));
  return out;
}

async function allAnswers(root: DirectoryHandleLike) {
  resetCaches();
  const out: Record<string, string[]> = {};
  for (const who of ["emp1", "emp2", "emp3"]) out[who] = (await loadEmployeeAnswers(root, MONTH, who)).items.map((i) => i.xrayImageId).sort();
  return out;
}

describe("round 7: lock heartbeat contention on the share", () => {
  beforeEach(() => {
    resetCaches();
    __forgetEndedMigrationRunsForTests();
    clearErrors();
  });

  it("(a) the share refusing every heartbeat replace of the lock does NOT abort the month — it migrates", async () => {
    const { root, events } = await month("hb-refused");
    // The acquisition's own commit lands (skip 1); every later replace of the live lock is refused.
    setSimulatedFaults(root, [{ operation: "close", name: LOCK, errorName: "InvalidStateError", skip: 1, times: Number.POSITIVE_INFINITY }]);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: steppingClock(20_000) });
    expect(result.status).toBe("migrated");
    expect(getRecentErrors().some((e) => e.context === "answers:migration-lock-heartbeat")).toBe(true);
    setSimulatedFaults(root, []);
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    expect(await fileNames(events)).toEqual([]);
  }, 60_000);

  it("(a) gives up with a NAMED error once no heartbeat landed for half the stale window", async () => {
    const { root } = await month("hb-silent");
    setSimulatedFaults(root, [{ operation: "close", name: LOCK, errorName: "InvalidStateError", skip: 1, times: Number.POSITIVE_INFINITY }]);
    const error = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: steppingClock(MIGRATION_LOCK_STALE_MS / 4) }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("MigrationLockHeartbeatError");
    expect(classifyMigrationFailure(error).labelKey).toBe("answers_layout_migration_reason_lock_write");
  }, 60_000);

  it("(a) the lock acquisition itself refused by the share maps to the specific reason, not 'unexpected error'", async () => {
    const { root } = await month("acquire-refused");
    setSimulatedFaults(root, [{ operation: "close", name: LOCK, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY }]);
    const error = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("MigrationLockWriteError");
    expect(classifyMigrationFailure(error).labelKey).toBe("answers_layout_migration_reason_lock_write");
  }, 60_000);

  it("a plain Error carrying the formatted XQ-IO-036 sentence maps to share-refused", () => {
    expect(classifyMigrationFailure(new Error("«…» (XQ-IO-036: InvalidStateError: x)")).labelKey).toBe("answers_layout_migration_reason_share_refused");
  });

  it("a lock that cannot be removed after a COMPLETED migration does not fail it; _layout.json wins", async () => {
    const { root, events } = await month("release-refused");
    setSimulatedFaults(root, [{ operation: "removeEntry", name: LOCK, errorName: "NoModificationAllowedError", times: Number.POSITIVE_INFINITY }]);
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
    await events.getFileHandle(LOCK); // still there
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
  }, 60_000);
});

describe("round 7: bookkeeping files never raise the integrity banner / heal", () => {
  beforeEach(() => {
    resetCaches();
    clearErrors();
  });

  it("(b) a lock served from its .tmp is not a heal candidate and dispatches no banner event", async () => {
    expect(pickSiblingHealCandidates([LOCK, `${LOCK}.tmp`, "x.json", "x.json.tmp"])).toEqual(["x.json"]);
    const { events } = await month("lock-tmp");
    await safeWriteJson(events, LOCK, wrap({ by: "admin", deviceId: "d", startedAt: new Date().toISOString(), token: "t", revision: 1 }));
    await writeText(events, `${LOCK}.tmp`, await readText(events, LOCK));
    await writeText(events, LOCK, "{torn");
    const seen: string[] = [];
    const g = globalThis as unknown as { window?: { dispatchEvent: (e: { type: string }) => void } };
    const hadWindow = "window" in g;
    const previous = g.window;
    g.window = { dispatchEvent: (e) => { seen.push(e.type); } };
    (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class { type: string; constructor(type: string) { this.type = type; } };
    try {
      const read = await safeReadJson(events, LOCK);
      expect(read.ok).toBe(true);
    } finally {
      if (hadWindow) g.window = previous; else delete g.window;
    }
    expect(seen).not.toContain("data:recovered-from-bak");
  }, 60_000);
});

describe("round 7: the owner's stuck month (leftover lock, .tmp, partial archive)", () => {
  beforeEach(() => {
    resetCaches();
    __forgetEndedMigrationRunsForTests();
  });

  async function crashMidway(root: DirectoryHandleLike, phase: MigrationPhase, after: number): Promise<void> {
    let n = 0;
    // The lock removal is refused too, exactly as on the share: the failed run leaves its lock.
    setSimulatedFaults(root, [{ operation: "removeEntry", name: LOCK, errorName: "NoModificationAllowedError", times: Number.POSITIVE_INFINITY }]);
    await expect(migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: (p) => { if (p.phase === phase && (n += 1) > after) throw new Error("simulated crash"); },
    })).rejects.toThrow(/simulated crash/);
    setSimulatedFaults(root, []);
    resetCaches();
  }

  it("same tab: the admin's own leftover lock never reads as 'another device' — the retry resumes at once", async () => {
    const { root, events } = await month("same-tab");
    await crashMidway(root, "move", 1);
    await writeText(events, `${LOCK}.tmp`, await readText(events, LOCK));
    expect((await getAnswerArchiveV1Dir(root, MONTH, false))).toBeTruthy();
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result.status).toBe("migrated");
    await expect(events.getFileHandle(LOCK)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(events.getFileHandle(`${LOCK}.tmp`)).rejects.toMatchObject({ name: "NotFoundError" });
  }, 60_000);

  it("after a reload: own lock → locked-elsewhere with self + takeoverAllowed; confirming that token resumes", async () => {
    const { root } = await month("reload");
    // (crashMidway leaves our lock; its failed release marks it abandoned when the share allows that write.)
    await crashMidway(root, "move", 1);
    // The share refused the `abandoned` mark too: the lock still reads as a live run of ours.
    const events = await getAnswerEventsDir(root, MONTH, false);
    const left = await safeReadJson<never>(events, LOCK);
    if (!left.ok) throw new Error("lock expected");
    const { abandoned: _a, ...still } = unwrap<Record<string, unknown>>(left.value);
    void _a;
    await safeWriteJson(events, LOCK, wrap(still));
    __forgetEndedMigrationRunsForTests();
    const first = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    if (first.status !== "locked-elsewhere") throw new Error(first.status);
    expect(first).toMatchObject({ by: "admin", self: true, takeoverAllowed: true });
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", takeOverLockToken: first.token })).status).toBe("migrated");
  }, 60_000);

  it("another device's lock: shows who/since/last heartbeat; takeover only once its heartbeat is silent ≥ 3 min, and only for the confirmed token", async () => {
    const { root, events } = await month("other-device");
    const start = Date.now();
    const at = new Date(start).toISOString();
    await safeWriteJson(events, LOCK, wrap({ by: "admin2", deviceId: "other", startedAt: at, heartbeatAt: at, token: "theirs", revision: 1 }));
    const live = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => start + 60_000 });
    if (live.status !== "locked-elsewhere") throw new Error(live.status);
    expect(live).toMatchObject({ by: "admin2", self: false, takeoverAllowed: false, startedAt: at, lastSeenAt: at });
    // A confirmed token cannot take a LIVE holder's lock.
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => start + 60_000, takeOverLockToken: "theirs" })).status).toBe("locked-elsewhere");
    const silentAt = start + MIGRATION_LOCK_SILENT_MS + 1_000;
    const silent = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => silentAt });
    expect(silent).toMatchObject({ status: "locked-elsewhere", takeoverAllowed: true });
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => silentAt, takeOverLockToken: "someone-else" })).status).toBe("locked-elsewhere");
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => silentAt, takeOverLockToken: "theirs" })).status).toBe("migrated");
  }, 60_000);

  it("another admin on THIS device is not 'self'", async () => {
    const { root, events } = await month("other-admin");
    const at = new Date().toISOString();
    await safeWriteJson(events, LOCK, wrap({ by: "admin2", deviceId: getDistributionDeviceId(), startedAt: at, heartbeatAt: at, token: "x", revision: 1 }));
    expect(await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).toMatchObject({ status: "locked-elsewhere", self: false });
  }, 60_000);
});

describe("round 7: resume — reruns only finish what is left and never grow files", () => {
  beforeEach(() => {
    resetCaches();
    __forgetEndedMigrationRunsForTests();
  });

  const crashPoints: Array<[MigrationPhase, number]> = [["read", 1], ["archive", 1], ["archive", 2], ["snapshot", 1], ["move", 1]];

  it.each(crashPoints)("crash in %s after step %i, then two reruns == one clean run", async (phase, after) => {
    const clean = await month(`clean-${phase}-${after}`);
    expect((await migrateMonthToPerAssignee(clean.root, MONTH, { actor: "admin" })).status).toBe("migrated");
    const cleanBytes = await archiveBytes(clean.root);
    const cleanAnswers = await allAnswers(clean.root);

    const { root, events } = await month(`crash-${phase}-${after}`);
    const flatTotal = (await fileNames(events)).length;
    let n = 0;
    await expect(migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: (p) => { if (p.phase === phase && (n += 1) > after) throw new Error("simulated crash"); },
    })).rejects.toThrow(/simulated crash/);
    resetCaches();
    const flatLeft = (await fileNames(events)).length;
    const probe = await probeAnswerLayoutMigrations(root, [MONTH]);
    if (probe.length > 0 && probe[0]!.kind === "incomplete") {
      expect(probe[0]!.flatSegments).toBe(flatLeft);
      expect(probe[0]!.flatSegments + probe[0]!.archivedSegments).toBe(flatTotal);
      expect(probe[0]!.archivedSegments).toBeGreaterThan(0);
    }
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
    expect(await archiveBytes(root)).toEqual(cleanBytes);
    expect(await allAnswers(root)).toEqual(cleanAnswers);
  }, 60_000);

  it("a straggler rerun on an already-migrated month appends nothing it already holds", async () => {
    const { root, events } = await month("rerun-no-growth");
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
    const before = await archiveBytes(root);
    // Put an archived flat segment back (a share that resurrected it): its events are already folded.
    const archive = await getAnswerArchiveV1Dir(root, MONTH, false);
    const [name] = await fileNames(archive);
    await writeText(events, name!, await readText(archive, name!));
    resetCaches();
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
    expect(await archiveBytes(root)).toEqual(before);
    const lock = await safeReadJson(events, LOCK);
    expect(lock.ok ? unwrap(lock.value as never) : null).toBeNull();
  }, 60_000);
});
