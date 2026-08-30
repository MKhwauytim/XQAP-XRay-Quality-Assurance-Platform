/**
 * Stage 2 of `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md` —
 * coverage for everything Stage 2 adds that Stage 0/1's own test suites do not
 * (and cannot: they have zero production call sites) exercise:
 *
 *  - migration-seed application on first write (§8), both when a legacy
 *    `.answers.json` already exists and when it does not
 *  - the request-queue split (§7): `{username}.requests.json` as its own
 *    file, and the legacy `.answers.json` never written again post-migration
 *  - `loadAllEmployeeFiles`'s fan-out (§7 Finding 5c), including an employee
 *    who exists ONLY via `answers.events/`
 *  - `loadAllEmployeeRequestFiles`'s requests-only fast path never opening
 *    `answers.events/` at all
 *  - the append-then-confirm on-behalf protocol (§5) under a simulated
 *    concurrent self-save
 *  - the blank-author refusal guard writing nothing
 */
import { describe, expect, test } from "vitest";

import { createMemoryDirectory, getOperationLog, clearOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR, appendAnswerEventSegment, type AnswerEvent } from "./answerEventStore";
import {
  appendReferralToEmployee,
  loadAllEmployeeFiles,
  loadAllEmployeeRequestFiles,
  loadEmployeeAnswers,
  upsertItemAnswer,
  upsertItemAnswerOnBehalf,
} from "./answerStorage";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";
import type { ReferralRequest } from "../referral/referralTypes";

const MONTH = "5-may-2026";
const ASSIGNEE = "emp1";
const SUPERVISOR = "sup1";

function makeItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v0" }],
    lastSavedAt: "2026-05-12T09:00:00.000Z",
    submittedAt: null,
    answeredBy: ASSIGNEE,
    status: "draft",
    ...overrides,
  };
}

async function readAnswersFileRaw(dir: DirectoryHandleLike, month: string, username: string): Promise<string | null> {
  const employeeDir = await getSampleEmployeeDir(dir, month, true);
  try {
    const handle = await employeeDir.getFileHandle(`${username}.answers.json`, { create: false });
    return (await handle.getFile()).text();
  } catch {
    return null;
  }
}

async function fileExists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

describe("§8 migration-seed application", () => {
  test("first write for a brand-new employee freezes an EMPTY legacy shell exactly once", async () => {
    const dir = createMemoryDirectory();
    const employeeDir = await getSampleEmployeeDir(dir, MONTH, true);

    expect(await fileExists(employeeDir, `${ASSIGNEE}.answers.json`)).toBe(false);

    const first = await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    expect(first.ok).toBe(true);

    // The legacy file now exists, holding no items — it is the migration-seed
    // source (§8), not a second copy of item state.
    expect(await fileExists(employeeDir, `${ASSIGNEE}.answers.json`)).toBe(true);
    const afterFirst = await readAnswersFileRaw(dir, MONTH, ASSIGNEE);
    expect(afterFirst).not.toBeNull();

    const second = await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem({ xrayImageId: "X2" }));
    expect(second.ok).toBe(true);

    // Never rewritten again — byte-identical to what the FIRST write froze.
    const afterSecond = await readAnswersFileRaw(dir, MONTH, ASSIGNEE);
    expect(afterSecond).toBe(afterFirst);

    // Both items are visible, folded from segments — the frozen shell held nothing.
    const file = await loadEmployeeAnswers(dir, MONTH, ASSIGNEE);
    expect(file.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X2"]);
  });

  test("first write for an employee with EXISTING legacy answers seeds them, then never rewrites the legacy file again", async () => {
    const dir = createMemoryDirectory();
    const employeeDir = await getSampleEmployeeDir(dir, MONTH, true);
    const legacy: EmployeeAnswerFile = {
      username: ASSIGNEE,
      monthFolderName: MONTH,
      revision: 3,
      items: [makeItem({ xrayImageId: "LEGACY-1", status: "submitted", submittedAt: "2026-04-01T00:00:00.000Z" })],
    };
    await safeWriteJson(employeeDir, `${ASSIGNEE}.answers.json`, legacy);
    const beforeAnyEventWrite = await readAnswersFileRaw(dir, MONTH, ASSIGNEE);

    const result = await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem({ xrayImageId: "X1" }));
    expect(result.ok).toBe(true);

    // Legacy content survives byte-for-byte — this write only ever READ it.
    const afterWrite = await readAnswersFileRaw(dir, MONTH, ASSIGNEE);
    expect(afterWrite).toBe(beforeAnyEventWrite);

    const file = await loadEmployeeAnswers(dir, MONTH, ASSIGNEE);
    const ids = file.items.map((i) => i.xrayImageId).sort();
    expect(ids).toEqual(["LEGACY-1", "X1"]);
    const seeded = file.items.find((i) => i.xrayImageId === "LEGACY-1")!;
    expect(seeded.status).toBe("submitted");

    // A second write still leaves it untouched.
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem({ xrayImageId: "X2" }));
    expect(await readAnswersFileRaw(dir, MONTH, ASSIGNEE)).toBe(beforeAnyEventWrite);
  });
});

describe("§7 request-queue split", () => {
  test("a referral request lands in {username}.requests.json, never in .answers.json", async () => {
    const dir = createMemoryDirectory();
    // Migrate the employee first so .answers.json is frozen.
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    const frozenBefore = await readAnswersFileRaw(dir, MONTH, ASSIGNEE);

    const request: ReferralRequest = {
      requestId: "req-1",
      monthFolderName: MONTH,
      fromEmployee: ASSIGNEE,
      toEmployee: "reviewer1",
      xrayImageIds: ["X1"],
      reason: "يحتاج مراجعة",
      requestedAt: "2026-05-12T10:00:00.000Z",
      requestedBy: ASSIGNEE,
      status: "pending",
    };
    const appended = await appendReferralToEmployee(dir, MONTH, request);
    expect(appended.ok).toBe(true);

    // The legacy file is untouched by the request write.
    expect(await readAnswersFileRaw(dir, MONTH, ASSIGNEE)).toBe(frozenBefore);

    const employeeDir = await getSampleEmployeeDir(dir, MONTH, true);
    expect(await fileExists(employeeDir, `${ASSIGNEE}.requests.json`)).toBe(true);

    const file = await loadEmployeeAnswers(dir, MONTH, ASSIGNEE);
    expect(file.referralRequests).toHaveLength(1);
    expect(file.referralRequests![0]!.requestId).toBe("req-1");
    // Item state (from segments) is unaffected by the request write.
    expect(file.items).toHaveLength(1);
  });

  test("a pre-Stage-2 legacy request embedded in .answers.json is still visible before any write migrates it", async () => {
    const dir = createMemoryDirectory();
    const employeeDir = await getSampleEmployeeDir(dir, MONTH, true);
    const legacyRequest: ReferralRequest = {
      requestId: "legacy-req-1",
      monthFolderName: MONTH,
      fromEmployee: ASSIGNEE,
      toEmployee: "reviewer1",
      xrayImageIds: ["X9"],
      reason: "قديم",
      requestedAt: "2026-04-01T00:00:00.000Z",
      requestedBy: ASSIGNEE,
      status: "pending",
    };
    const legacy: EmployeeAnswerFile = {
      username: ASSIGNEE,
      monthFolderName: MONTH,
      revision: 1,
      items: [],
      referralRequests: [legacyRequest],
    };
    await safeWriteJson(employeeDir, `${ASSIGNEE}.answers.json`, legacy);

    // No .requests.json exists yet, and no event-log write has happened either.
    expect(await fileExists(employeeDir, `${ASSIGNEE}.requests.json`)).toBe(false);

    const file = await loadEmployeeAnswers(dir, MONTH, ASSIGNEE);
    expect(file.referralRequests).toHaveLength(1);
    expect(file.referralRequests![0]!.requestId).toBe("legacy-req-1");
  });
});

describe("§7 Finding 5c: loadAllEmployeeFiles fan-out", () => {
  test("an employee who exists ONLY via answers.events (no legacy file at all) still appears", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, "segment-only-emp", makeItem({ answeredBy: "segment-only-emp" }));

    const files = await loadAllEmployeeFiles(dir, MONTH);
    const usernames = files.map((f) => f.username);
    expect(usernames).toContain("segment-only-emp");
    const file = files.find((f) => f.username === "segment-only-emp")!;
    expect(file.items).toHaveLength(1);
  });

  test("the requests-only fast path returns the same request queues without opening answers.events", async () => {
    const dir = createMemoryDirectory("op-root", { trackOperations: true } as never);
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    await appendReferralToEmployee(dir, MONTH, {
      requestId: "req-fast-1",
      monthFolderName: MONTH,
      fromEmployee: ASSIGNEE,
      toEmployee: "reviewer1",
      xrayImageIds: ["X1"],
      reason: "سريع",
      requestedAt: "2026-05-12T10:00:00.000Z",
      requestedBy: ASSIGNEE,
      status: "pending",
    });

    clearOperationLog(dir);
    const fast = await loadAllEmployeeRequestFiles(dir, MONTH);
    const opened = getOperationLog(dir)
      .filter((entry) => entry.operation === "getDirectoryHandle")
      .map((entry) => entry.name);
    expect(opened).not.toContain(ANSWER_EVENTS_DIR);

    const fastEntry = fast.find((f) => f.username === ASSIGNEE)!;
    expect(fastEntry.referralRequests).toHaveLength(1);
    expect(fastEntry.referralRequests![0]!.requestId).toBe("req-fast-1");
    // The requests-only shape has no items field to compare — it never folds one.
    expect((fastEntry as unknown as { items?: unknown }).items).toBeUndefined();
  });
});

describe("§5 append-then-confirm on-behalf protocol under a simulated concurrent self-save", () => {
  test("a self-save landing with an EARLIER eventAt than the on-behalf append refuses it — decided at CONFIRM time, not by any pre-check", async () => {
    const dir = createMemoryDirectory();
    // Stand in for "another writer's self-submit append had already landed
    // durably by the time this call's CONFIRM read runs" — appended directly
    // through the low-level segment API (bypassing the public write functions
    // entirely) with an eventAt that predates anything upsertItemAnswerOnBehalf
    // below will mint. This is exactly the interleaving append-then-confirm
    // (§5) exists to resolve correctly: the outcome must be decided by a fresh
    // post-append fold under the true (eventAt, authority, eventId) order, not
    // by whatever a pre-check would have seen.
    const mainDir = await getSampleMainDir(dir, MONTH, true);
    const seedEvent: AnswerEvent = {
      eventId: "seed-concurrent",
      eventType: "migration-seed",
      eventAt: "2020-01-01T00:00:00.000Z",
      eventBy: ASSIGNEE,
      authority: "self",
      answeredBy: ASSIGNEE,
      legacyContentHash: "",
    };
    const selfSubmit: AnswerEvent = {
      eventId: "self-concurrent-1",
      eventType: "item-saved",
      eventAt: "2020-01-01T00:00:01.000Z",
      eventBy: ASSIGNEE,
      authority: "self",
      xrayImageId: "X1",
      answers: [{ fieldId: "f1", value: "self-answer" }],
      status: "submitted",
      submittedAt: "2020-01-01T00:00:01.000Z",
      answeredBy: ASSIGNEE,
    };
    await appendAnswerEventSegment(mainDir, [seedEvent, selfSubmit], {
      deviceId: "concurrent-device",
      sessionId: "concurrent-session",
    });

    const result = await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the on-behalf write to be refused");
    expect(result.error).toContain("تم تقديم إجابة لهذه العينة بالفعل");

    // The item reflects the self-save, never the on-behalf attempt — even
    // though the on-behalf event WAS durably appended (append-then-confirm
    // never withholds the append itself).
    const item = (await loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).items.find((i) => i.xrayImageId === "X1")!;
    expect(item.answeredBy).toBe(ASSIGNEE);
    expect(item.answeredOnBehalfBy).toBeUndefined();
    expect(item.answers).toEqual([{ fieldId: "f1", value: "self-answer" }]);
  });

  test("a self-save landing with a LATER eventAt does not retroactively refuse an on-behalf write that already won", async () => {
    const dir = createMemoryDirectory();
    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ status: "draft", submittedAt: null }),
      SUPERVISOR
    );
    expect(result.ok).toBe(true);

    const item = (await loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).items.find((i) => i.xrayImageId === "X1")!;
    expect(item.answeredOnBehalfBy).toBe(SUPERVISOR);
  });
});

describe("blank-author refusal guard", () => {
  test("writes nothing at all — never even opens answers.events", async () => {
    const dir = createMemoryDirectory("op-root", { trackOperations: true } as never);
    clearOperationLog(dir);

    const result = await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), "   ");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("نيابةً");

    const opened = getOperationLog(dir).filter(
      (entry) => entry.operation === "getDirectoryHandle" || entry.operation === "createWritable"
    );
    expect(opened).toHaveLength(0);

    expect((await loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).items).toEqual([]);
  });
});

describe("XQ-ANS-004: an unreadable answers.events segment is never silently treated as empty", () => {
  test("a corrupt segment file throws rather than reading as no answers", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());

    const mainDir = await getSampleMainDir(dir, MONTH, true);
    const eventsDir = await mainDir.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    // Corrupt every segment file directly — write malformed NDJSON.
    const values = (eventsDir as DirectoryHandleLike & {
      values: () => AsyncIterable<{ name: string; kind: string }>;
    }).values();
    const names: string[] = [];
    for await (const entry of values) {
      if (entry.kind === "file" && entry.name.endsWith(".ndjson")) names.push(entry.name);
    }
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const handle = await eventsDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{not valid ndjson\n");
      await writable.close();
    }

    await expect(loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).rejects.toThrow();
  });
});
