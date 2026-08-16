/**
 * The read contract, enforced at every site that turns a read into a default.
 *
 * `safeReadJson` distinguishes a file that is genuinely absent from one that
 * exists but cannot be read, and it throws outright when the read itself fails
 * past its retry budget. Callers that collapse those into "return the empty
 * default" convert an I/O hiccup into data loss, because an empty default handed
 * to a read-modify-write is written back as the whole file.
 *
 * Every test below simulates BOTH shapes of unreadability:
 *
 *  - a THROWING read — a NotReadableError that outlives safeWrite's ~2-retry /
 *    80 ms budget, which is what a share going away mid-read looks like;
 *  - a CORRUPT-BUT-PARSEABLE read — a well-formed envelope whose payload no
 *    longer matches its own `contentHash`, with no `.bak`/`.tmp` left to
 *    recover from, which is what a torn write leaves behind. `safeReadJson`
 *    reports `corrupt` for it, never `missing`.
 *
 * Neither may ever be answered with an empty default. Absence — and only
 * absence — may.
 */

import { describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "./safeWrite";
import { errorCodeOf } from "./errorCodes";

import { loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { appendWorkspaceAction, readWorkspaceActions } from "../audit/actionLog";
import {
  appendDecisionEvent,
  loadSupervisorDecisions,
  verifyDecisionChain,
} from "../approvals/approvalStorage";
import { loadNotifications, postNotification } from "../notifications/notificationStorage";
import { appendDistributionEvents, loadDistributionLog } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { writeImmutableDistributionEvent } from "../distribution/distributionEventStore";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { saveMonthRun } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  getSampleApprovalsDir,
  getSampleEmployeeDir,
  getSampleMainDir,
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
} from "../workspace/workspacePaths";

// Must match `formatMonthFolderName(5, 2026)` — the saveMonthRun guard test
// resolves the month folder through it, and folder names are case-sensitive.
const MONTH = "5-may-2026";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

async function overwriteRaw(
  dir: DirectoryHandleLike,
  fileName: string,
  text: string
): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  if (!handle.createWritable) throw new Error("memory directory cannot write");
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readRaw(dir: DirectoryHandleLike, fileName: string): Promise<string> {
  return (await (await dir.getFileHandle(fileName)).getFile()).text();
}

async function removeQuietly(dir: DirectoryHandleLike, fileName: string): Promise<void> {
  try {
    await dir.removeEntry?.(fileName);
  } catch {
    // absent already
  }
}

/**
 * Turn a healthy file into a CORRUPT-BUT-PARSEABLE one.
 *
 * The payload is mutated while its envelope keeps the ORIGINAL `contentHash`, so
 * the file is still well-formed JSON with a well-formed envelope around it and
 * only `verifyContentHash` rejects it — exactly what a torn write or a
 * half-flushed share leaves behind, and the shape `safeReadJson` reports as
 * `corrupt` rather than `missing`. A bare `{"data":…}` blob would NOT do: the
 * reader deliberately tolerates un-enveloped legacy JSON and would accept it.
 *
 * The `.bak` and `.tmp` companions are removed too — otherwise safeReadJson
 * legitimately recovers from one of them, which is a different (working) code
 * path, not the condition under test.
 */
async function corruptInPlace(dir: DirectoryHandleLike, fileName: string): Promise<string> {
  const parsed = JSON.parse(await readRaw(dir, fileName)) as {
    metadata: Record<string, unknown>;
    data: unknown;
  };
  const corrupted = JSON.stringify({
    metadata: parsed.metadata,
    data: { ...(parsed.data as Record<string, unknown>), __torn: true },
  });
  await overwriteRaw(dir, fileName, corrupted);
  await removeQuietly(dir, `${fileName}.bak`);
  await removeQuietly(dir, `${fileName}.tmp`);
  return corrupted;
}

/** Assert a promise rejects with an error carrying `XQ-IO-029` (the code lives on
 *  the error object, not in its internal English message). */
async function expectUnreadableRejection(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow();
  await promise.then(
    () => expect.unreachable("expected a rejection"),
    (error: unknown) => expect(errorCodeOf(error)).toBe("XQ-IO-029")
  );
}

/**
 * `safeWrite`'s NotReadableError budget: the initial `getFile` plus
 * NOT_READABLE_RETRY_DELAYS_MS (two retries). A fault with exactly this many
 * firings outlives ONE read and then clears.
 */
const READ_ATTEMPTS_BEFORE_GIVING_UP = 3;

/** A NotReadableError that never clears — a share that went away for good. */
function makeUnreadable(root: DirectoryHandleLike, fileName: string): void {
  setSimulatedFaults(root, [
    {
      operation: "getFile",
      name: fileName,
      errorName: "NotReadableError",
      times: Number.POSITIVE_INFINITY,
    },
  ]);
}

/**
 * THE read-modify-write hazard, reproduced exactly.
 *
 * One transient NotReadableError that outlives the BASE read's retry budget and
 * then clears — so `safeWriteJson`'s own pre-write read a moment later succeeds
 * and the write goes through. A permanent fault would fail the write too and
 * hide the bug; this is the interleaving that silently truncated real files.
 */
function makeBaseReadTransientlyUnreadable(
  root: DirectoryHandleLike,
  fileName: string
): void {
  setSimulatedFaults(root, [
    {
      operation: "getFile",
      name: fileName,
      errorName: "NotReadableError",
      times: READ_ATTEMPTS_BEFORE_GIVING_UP,
    },
  ]);
}

function makeAnswer(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: id }],
    lastSavedAt: "2026-05-01T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

// ── The primitive itself ────────────────────────────────────────────────────

describe("readOptionalJson", () => {
  it("reports absent only when the file is genuinely not there", async () => {
    const root = makeRoot();
    const read = await readOptionalJson<{ v: number }>("t", [
      { directory: async () => root, fileName: "nothing.json" },
    ]);
    expect(read.kind).toBe("absent");
  });

  it("throws XQ-IO-029 for a file that exists but is corrupt", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "thing.json", { v: 1 });
    await corruptInPlace(root, "thing.json");
    await expectUnreadableRejection(readOptionalJson<{ v: number }>("t", [
        { directory: async () => root, fileName: "thing.json" },
      ]));
  });

  it("propagates a throwing read instead of reporting absence", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "thing.json", { v: 1 });
    makeUnreadable(root, "thing.json");
    await expect(
      readOptionalJson<{ v: number }>("t", [
        { directory: async () => root, fileName: "thing.json" },
      ])
    ).rejects.toThrow(/NotReadableError/);
  });

  it("still answers from a legacy location when the current one is unreadable", async () => {
    const root = makeRoot();
    const legacy = await root.getDirectoryHandle("legacy", { create: true });
    await safeWriteJson(root, "current.json", { v: 1 });
    await safeWriteJson(legacy, "legacy.json", { v: 2 });
    makeUnreadable(root, "current.json");
    // A held-back failure must not shadow a real answer: a legacy file is a
    // perfectly good result when the current location is the unreadable one.
    const read = await readOptionalJson<{ v: number }>("t", [
      { directory: async () => root, fileName: "current.json" },
      { directory: async () => legacy, fileName: "legacy.json" },
    ]);
    expect(read).toEqual({ kind: "found", value: { v: 2 } });
  });

  it("throws when the current location is unreadable and no later one answers", async () => {
    const root = makeRoot();
    const legacy = await root.getDirectoryHandle("legacy", { create: true });
    await safeWriteJson(root, "current.json", { v: 1 });
    makeUnreadable(root, "current.json");
    // A genuinely-absent legacy path is still `absent` — but it cannot promote
    // the unreadable current location into an overall "absent".
    await expect(
      readOptionalJson<{ v: number }>("t", [
        { directory: async () => root, fileName: "current.json" },
        { directory: async () => legacy, fileName: "legacy.json" },
      ])
    ).rejects.toThrow(/NotReadableError/);
  });

  it("does not consult a later location once an earlier one answered", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "thing.json", { v: 1 });
    const read = await readOptionalJson<{ v: number }>("t", [
      { directory: async () => root, fileName: "thing.json" },
      {
        directory: async () => {
          throw new Error("must not be reached");
        },
        fileName: "thing.json",
      },
    ]);
    expect(read).toEqual({ kind: "found", value: { v: 1 } });
  });
});

// ── P0-1: answerStorage ─────────────────────────────────────────────────────

describe("P0-1 answerStorage: an unreadable answer file never becomes an empty one", () => {
  async function seedTwentyAnswers(root: DirectoryHandleLike): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const result = await upsertItemAnswer(root, MONTH, "emp1", makeAnswer(`X${i}`));
      expect(result.ok).toBe(true);
    }
    const dir = await getSampleEmployeeDir(root, MONTH, true);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items).toHaveLength(20);
    void dir;
    return "emp1.answers.json";
  }

  it("never truncates 20 answers to 1 when the base read THROWS", async () => {
    const root = makeRoot();
    const fileName = await seedTwentyAnswers(root);

    makeBaseReadTransientlyUnreadable(root, fileName);
    const result = await upsertItemAnswer(root, MONTH, "emp1", makeAnswer("X-new"));

    setSimulatedFaults(root, []);
    const items = (await loadEmployeeAnswers(root, MONTH, "emp1")).items;
    // BEFORE the fix: the empty default was written back — one item, revision
    // reset, `{ ok: true }`, nothing in the error buffer.
    //
    // AFTER: the throw reaches casLoop, which retries the whole attempt. The
    // transient fault has cleared by then, so the write lands on the REAL base
    // and the original twenty survive. That is the guarantee — the write either
    // sees the whole file or does not happen; it is never truncated.
    expect(items.length).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < 20; i += 1) {
      expect(items.some((item) => item.xrayImageId === `X${i}`)).toBe(true);
    }
    if (result.ok) expect(items.some((item) => item.xrayImageId === "X-new")).toBe(true);
  });

  it("aborts the write on a CORRUPT base read rather than replacing the file", async () => {
    const root = makeRoot();
    const fileName = await seedTwentyAnswers(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await corruptInPlace(answersDir, fileName);

    const result = await upsertItemAnswer(root, MONTH, "emp1", makeAnswer("X-new"));
    expect(result.ok).toBe(false);
    await expectUnreadableRejection(loadEmployeeAnswers(root, MONTH, "emp1"));
  });

  it("still returns the empty shell when the employee genuinely has no file", async () => {
    const root = makeRoot();
    const file = await loadEmployeeAnswers(root, MONTH, "nobody");
    expect(file.items).toEqual([]);
    expect(file.revision).toBe(0);
  });
});

// ── P0-2: distribution ──────────────────────────────────────────────────────

describe("P0-2 distribution: an unreadable event store never reads as zero events", () => {
  async function seedEvents(root: DirectoryHandleLike): Promise<void> {
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "alice", eventBy: "admin" }),
    ]);
    expect(appended.ok).toBe(true);
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(2);
  }

  it("rejects on a THROWING read of the event directory instead of returning []", async () => {
    const root = makeRoot();
    await seedEvents(root);

    setSimulatedFaults(root, [
      {
        operation: "getDirectoryHandle",
        name: "distribution.events",
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(loadDistributionLog(root, MONTH)).rejects.toThrow(/NotReadableError/);
  });

  it("rejects on ONE corrupt legacy event file instead of dropping every event", async () => {
    const root = makeRoot();
    await seedEvents(root);

    const mainDir = await getSampleMainDir(root, MONTH, true);
    const legacyEvent = buildAssignEvent({
      xrayImageId: "A3",
      assignedTo: "bob",
      eventBy: "admin",
    });
    await writeImmutableDistributionEvent(mainDir, legacyEvent);
    const eventsDir = await mainDir.getDirectoryHandle("distribution.events", { create: false });
    await corruptInPlace(eventsDir, `${legacyEvent.eventId}.json`);

    // Before the fix this resolved to an EMPTY log — which the re-draw hard
    // block reads as "nothing distributed yet", clearing the way to overwrite
    // sample.master.json and orphan the month.
    await expect(loadDistributionLog(root, MONTH)).rejects.toThrow();
  });

  it("still reports an empty log for a month that genuinely has no events", async () => {
    const root = makeRoot();
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events).toEqual([]);
  });
});

// ── P1: audit action log ────────────────────────────────────────────────────

describe("P1 actionLog: an unreadable audit trail is never truncated to one entry", () => {
  async function auditDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
    const system = await getSystemRoot(root, true);
    return system.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, { create: true });
  }

  async function seed(root: DirectoryHandleLike): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await appendWorkspaceAction(root, {
        actor: "admin",
        actorRole: "admin",
        action: "sample-drawn",
        target: `seed-${i}`,
      });
    }
    expect(await readWorkspaceActions(root)).toHaveLength(5);
  }

  it("never truncates the trail to one entry when the base read THROWS", async () => {
    const root = makeRoot();
    await seed(root);

    makeBaseReadTransientlyUnreadable(root, "actions.log.json");
    await appendWorkspaceAction(root, {
      actor: "admin",
      actorRole: "admin",
      action: "sample-drawn",
      target: "late",
    });

    setSimulatedFaults(root, []);
    const entries = await readWorkspaceActions(root);
    // BEFORE the fix: the empty shell was written back and the trail became a
    // single entry. AFTER: casLoop retries onto the real base, so all five seed
    // entries survive whether or not the append itself lands.
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 5; i += 1) {
      expect(entries.some((e) => e.target === `seed-${i}`)).toBe(true);
    }
  });

  it("leaves the existing entries on disk when the base read is CORRUPT", async () => {
    const root = makeRoot();
    await seed(root);
    const dir = await auditDir(root);
    // Snapshot the good bytes so the assertion can prove the append did not
    // overwrite them.
    const before = await readRaw(dir, "actions.log.json");
    const corrupted = await corruptInPlace(dir, "actions.log.json");

    await appendWorkspaceAction(root, {
      actor: "admin",
      actorRole: "admin",
      action: "sample-drawn",
      target: "late",
    });

    const after = await readRaw(dir, "actions.log.json");
    expect(after).toBe(corrupted);
    expect(after).not.toBe(before);
  });
});

// ── P1: supervisor decision chain ───────────────────────────────────────────

describe("P1 approvalStorage: an unreadable decision chain never reverts to pending", () => {
  async function seed(root: DirectoryHandleLike): Promise<string> {
    for (let i = 0; i < 3; i += 1) {
      const result = await appendDecisionEvent(root, MONTH, "sup1", {
        kind: "referral",
        requestId: `req-${i}`,
        status: "approved",
        reviewedBy: "sup1",
        reviewedAt: "2026-05-01T00:00:00.000Z",
      });
      expect(result.ok).toBe(true);
    }
    const file = await loadSupervisorDecisions(root, MONTH, "sup1");
    expect(file.decisionEvents).toHaveLength(3);
    return "sup1.decisions.json";
  }

  it("never resets the decision chain when the base read THROWS", async () => {
    const root = makeRoot();
    const fileName = await seed(root);

    makeBaseReadTransientlyUnreadable(root, fileName);
    await appendDecisionEvent(root, MONTH, "sup1", {
      kind: "referral",
      requestId: "req-late",
      status: "approved",
      reviewedBy: "sup1",
      reviewedAt: "2026-05-02T00:00:00.000Z",
    });

    setSimulatedFaults(root, []);
    const events = (await loadSupervisorDecisions(root, MONTH, "sup1")).decisionEvents ?? [];
    // BEFORE the fix: the empty shell replaced the whole chain, so all three
    // approved requests reverted to pending and became re-approvable.
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i += 1) {
      expect(events.some((e) => e.requestId === `req-${i}`)).toBe(true);
    }
    expect(verifyDecisionChain(events)).toBeNull();
  });

  it("aborts the append on a CORRUPT read rather than resetting the chain", async () => {
    const root = makeRoot();
    const fileName = await seed(root);
    const dir = await getSampleApprovalsDir(root, MONTH, true);
    await corruptInPlace(dir, fileName);

    const result = await appendDecisionEvent(root, MONTH, "sup1", {
      kind: "referral",
      requestId: "req-late",
      status: "approved",
      reviewedBy: "sup1",
      reviewedAt: "2026-05-02T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    await expectUnreadableRejection(loadSupervisorDecisions(root, MONTH, "sup1"));
  });
});

// ── P1: notifications ───────────────────────────────────────────────────────

describe("P1 notificationStorage: unreadable notifications are never replaced", () => {
  async function seed(root: DirectoryHandleLike): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      const result = await postNotification(root, { message: `n${i}`, postedBy: "admin" });
      expect(result.ok).toBe(true);
    }
    expect(await loadNotifications(root)).toHaveLength(3);
  }

  it("never replaces the list when the base read THROWS", async () => {
    const root = makeRoot();
    await seed(root);

    makeBaseReadTransientlyUnreadable(root, "notifications.json");
    await postNotification(root, { message: "late", postedBy: "admin" });

    setSimulatedFaults(root, []);
    const after = await loadNotifications(root);
    // BEFORE the fix: every existing notification — and every recipient's
    // acknowledgement — was replaced by the single new one.
    expect(after.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i += 1) {
      expect(after.some((n) => n.message === `n${i}`)).toBe(true);
    }
  });

  it("aborts the post on a CORRUPT read rather than replacing the list", async () => {
    const root = makeRoot();
    await seed(root);
    const system = await getSystemRoot(root, true);
    const dir = await system.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, { create: true });
    const corrupted = await corruptInPlace(dir, "notifications.json");

    const result = await postNotification(root, { message: "late", postedBy: "admin" });
    expect(result.ok).toBe(false);
    const after = await readRaw(dir, "notifications.json");
    expect(after).toBe(corrupted);
  });
});

// ── P1: sample master and the population overwrite guard ────────────────────

describe("P1 sampleStorage: an unreadable sample.master.json never reads as 'no sample'", () => {
  async function seedSample(root: DirectoryHandleLike): Promise<void> {
    const result = await saveSampleMaster(root, MONTH, {
      rngSeed: "seed",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 1,
      certScanActual: 0,
      nonCertScanActual: 1,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: "2026-05-01T00:00:00.000Z",
      drawnBy: "admin",
      rows: [makeRow("A1")],
    });
    expect(result.ok).toBe(true);
    expect(await loadSampleMaster(root, MONTH)).not.toBeNull();
  }

  it("rejects on a THROWING read instead of returning null", async () => {
    const root = makeRoot();
    await seedSample(root);
    makeUnreadable(root, "sample.master.json");
    await expect(loadSampleMaster(root, MONTH)).rejects.toThrow(/NotReadableError/);
  });

  it("rejects on a CORRUPT read instead of returning null", async () => {
    const root = makeRoot();
    await seedSample(root);
    const dir = await getSampleMainDir(root, MONTH, true);
    await corruptInPlace(dir, "sample.master.json");
    await expectUnreadableRejection(loadSampleMaster(root, MONTH));
  });

  it("still returns null for a month that genuinely has no sample", async () => {
    const root = makeRoot();
    expect(await loadSampleMaster(root, MONTH)).toBeNull();
  });

  it("saveMonthRun's overwrite guard aborts instead of orphaning an unreadable sample", async () => {
    const root = makeRoot();
    await seedSample(root);
    const dir = await getSampleMainDir(root, MONTH, true);
    await corruptInPlace(dir, "sample.master.json");

    // The guard's whole job is to refuse to overwrite a population that a drawn
    // sample already points at. Before the fix an unreadable sample answered
    // "no sample here" and the save proceeded.
    const result = await saveMonthRun({
      directoryHandle: root,
      month: 5,
      year: 2026,
      username: "admin",
      riskFileName: "risk.xlsx",
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [],
      biRawRows: [],
      processedRows: [makeRow("A1") as unknown as Record<string, unknown>],
      certScanRows: 0,
      nonCertScanRows: 1,
    });
    expect(result.ok).toBe(false);
  });
});
