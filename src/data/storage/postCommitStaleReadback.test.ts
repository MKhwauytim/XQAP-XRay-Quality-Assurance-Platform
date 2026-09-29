/**
 * Task E3b — a write whose COMMIT landed must not be reported as failed (and
 * re-committed) just because the post-commit read-back hit a stale/transient
 * error. See `.superpowers/sdd/errorlog-2026-09-28/other-groups.md` §B
 * (reproductions A and C) and `task-E3b-report.md`.
 *
 * NO-WAIT design: safeWriteJson does not sleep longer on the read-back. When
 * the pre-commit `.tmp` verify was byte-exact and the post-commit read-back
 * throws a transient error, it returns `{ committedUnverified: true }`; casLoop
 * callers that run their own token read-back treat that as "accept once the
 * token read confirms or is itself inconclusive", never as "re-commit".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors, getRecentErrors } from "./errorLogger";
import { createMemoryDirectory, getOperationLog, setSimulatedFaults } from "./memoryDirectory";
import { __resetPostCommitReadbackLogForTests, safeReadJson, safeWriteJson } from "./safeWrite";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { appendReply, createThread, flushPendingFeedbackIndexWrites, feedbackThreadFileName, loadThread } from "../feedback/feedbackStorage";
import { getFeedbackThreadsDir } from "../workspace/workspacePaths";
import { appendDecisionEvent, loadSupervisorDecisions } from "../approvals/approvalStorage";
import type { DecisionEvent } from "../approvals/approvalTypes";

beforeEach(() => {
  clearErrors();
  __resetPostCommitReadbackLogForTests();
});
afterEach(() => {
  clearErrors();
  __resetPostCommitReadbackLogForTests();
});

async function fileExists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "NotFoundError") return false;
    throw error;
  }
}

/** After EVERY landed close() of `name`, the next 6 reads of it throw NotReadableError
 * (what Chromium actually produces for a stale-snapshot read). */
function staleAfterEveryCommit(name: string) {
  return {
    operation: "readFile" as const,
    name,
    errorName: "NotReadableError",
    times: 6,
    rearmAfterClose: true,
  };
}

describe("reproduction A: safeWriteJson post-commit read-back throws", () => {
  it("returns committed-but-unverified instead of throwing; live file correct, no .tmp", async () => {
    const dir = createMemoryDirectory("e3b-a");
    setSimulatedFaults(dir, [staleAfterEveryCommit("t.json")]);

    const result = await safeWriteJson(dir, "t.json", { v: 1 });
    expect(result).toMatchObject({ committedUnverified: true });

    setSimulatedFaults(dir, []);
    const read = await safeReadJson<{ v: number }>(dir, "t.json");
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual({ v: 1 });
    expect(await fileExists(dir, "t.json.tmp")).toBe(false);
  });

  it("healthy path is unchanged: resolves undefined", async () => {
    const dir = createMemoryDirectory("e3b-a-healthy");
    await expect(safeWriteJson(dir, "t.json", { v: 1 })).resolves.toBeUndefined();
  });

  it("a persistent (not just stale) index read-back failure is ACCEPTED: one commit, verify-inconclusive logged, .tmp gone", async () => {
    const root = createMemoryDirectory("e3b-c-index-accept", { trackOperations: true });
    await getFeedbackThreadsDir(root, true);
    setSimulatedFaults(root, [{ ...staleAfterEveryCommit("threads.index.json"), times: 12 }]);

    await createThread(root, { from: "u", role: "employee", category: "bug", text: "hello" } as never);

    await flushPendingFeedbackIndexWrites(); // B4: the index write is background

    const commits = getOperationLog(root).filter(
      (o) => o.operation === "close" && o.name === "threads.index.json"
    );
    expect(commits).toHaveLength(1);
    const contexts = getRecentErrors().map((e) => e.context);
    expect(contexts.some((c) => c.startsWith("casLoop:verify-inconclusive(feedback:threadsIndex)"))).toBe(true);
    expect(contexts.filter((c) => c.includes("casLoop:exhausted"))).toEqual([]);
  });

  it("a NON-transient read-back error still throws (only stale/transient is downgraded)", async () => {
    const dir = createMemoryDirectory("e3b-a-hard");
    setSimulatedFaults(dir, [
      { operation: "readFile", name: "t.json", errorName: "SecurityError", times: Number.POSITIVE_INFINITY },
    ]);
    await expect(safeWriteJson(dir, "t.json", { v: 1 })).rejects.toThrow();
  });
});

describe("reproduction C: a stale window re-armed by every commit", () => {
  it("createThread commits the threads index ONCE (revision 1), no exhaustion, no .tmp", async () => {
    const root = createMemoryDirectory("e3b-c", { trackOperations: true });
    // Create the feedback dirs, then arm the fault on the index only.
    await getFeedbackThreadsDir(root, true);
    setSimulatedFaults(root, [staleAfterEveryCommit("threads.index.json")]);

    await createThread(root, { from: "u", role: "employee", category: "bug", text: "hello" } as never);

    await flushPendingFeedbackIndexWrites(); // B4: the index write is background

    const errors = getRecentErrors().map((e) => e.context);
    expect(errors.filter((c) => c.includes("casLoop:exhausted(feedback:threadsIndex)"))).toEqual([]);
    expect(errors.filter((c) => c.includes("createThreadIndex"))).toEqual([]);

    const commits = getOperationLog(root).filter(
      (o) => o.operation === "close" && o.name === "threads.index.json"
    );
    expect(commits).toHaveLength(1);

    setSimulatedFaults(root, []);
    const sys = await (await root.getDirectoryHandle("5-system")).getDirectoryHandle("feedback");
    const idx = await safeReadJson<{ revision: number }>(sys, "threads.index.json");
    expect(idx.ok && idx.value.revision).toBe(1);
    expect(await fileExists(sys, "threads.index.json.tmp")).toBe(false);
  });

  it("appendReply commits the thread file once per reply (no re-commit on a stale read-back)", async () => {
    const root = createMemoryDirectory("e3b-reply", { trackOperations: true });
    const thread = await createThread(root, { from: "u", role: "employee", category: "bug", text: "hi" } as never);
    const name = feedbackThreadFileName(thread.id);
    const before = getOperationLog(root).filter((o) => o.operation === "close" && o.name === name).length;
    setSimulatedFaults(root, [staleAfterEveryCommit(name)]);

    await appendReply(root, thread.id, { from: "admin", text: "r", timestamp: new Date().toISOString() } as never, false);

    const after = getOperationLog(root).filter((o) => o.operation === "close" && o.name === name).length;
    expect(after - before).toBe(1);
    setSimulatedFaults(root, []);
    const loaded = await loadThread(root, thread.id);
    expect(loaded?.replies).toHaveLength(1);
    expect(getRecentErrors().filter((e) => e.context.includes("casLoop:exhausted"))).toEqual([]);
  });

  it("appendDecisionEvent commits once and reports ok", async () => {
    const root = createMemoryDirectory("e3b-decision", { trackOperations: true });
    const event: DecisionEvent = {
      requestId: "r1",
      kind: "referral",
      status: "approved",
      reviewedBy: "sup",
      reviewedAt: "2026-09-28T00:00:00.000Z",
    };
    const month = "9-September-2026";
    const first = await appendDecisionEvent(root, month, "sup", event);
    expect(first.ok).toBe(true);
    const before = getOperationLog(root).filter((o) => o.operation === "close" && o.name.endsWith("decisions.json")).length;
    setSimulatedFaults(root, [
      { ...staleAfterEveryCommit("sup.decisions.json") },
    ]);
    // Arm by writing once more through the same name.
    const second = await appendDecisionEvent(root, month, "sup", { ...event, requestId: "r2" });
    expect(second.ok).toBe(true);
    const after = getOperationLog(root).filter((o) => o.operation === "close" && o.name.endsWith("decisions.json")).length;
    expect(after - before).toBe(1);
    setSimulatedFaults(root, []);
    const loaded = await loadSupervisorDecisions(root, month, "sup");
    expect(loaded.decisionEvents).toHaveLength(2);
  });
});

describe("the failing step is visible in the exhaustion log", () => {
  it("a refused commit (close() swap) is logged step=commit, so the export can tell it from a failed read-back", async () => {
    const root = createMemoryDirectory("e3b-step");
    await getFeedbackThreadsDir(root, true);
    setSimulatedFaults(root, [
      { operation: "close", name: "threads.index.json", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    await createThread(root, { from: "u", role: "employee", category: "issue", text: "x" });

    await flushPendingFeedbackIndexWrites(); // B4: the index write is background

    const exhausted = getRecentErrors().filter((e) => e.context.includes("casLoop:exhausted(feedback:threadsIndex)"));
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.context).toContain("step=commit");
  });
});
