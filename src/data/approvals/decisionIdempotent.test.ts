/**
 * E3b fix round — `appendDecisionEvent` (a hash-chained, durable audit history)
 * is idempotent by the decision's own identity, so a write whose commit could
 * not be read back is retried, never accepted blind and never duplicated. The
 * identity check runs BEFORE the next chain link is computed, so the chain stays
 * valid. Interleavings are driven by wrapping `safeWriteJson` (see
 * feedback/replyIdempotent.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearErrors } from "../storage/errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleApprovalsDir } from "../workspace/workspacePaths";

const hooks = vi.hoisted(() => ({
  afterFirstCommit: null as null | (() => Promise<void>),
  fired: false,
}));

vi.mock("../storage/safeWrite", async (importOriginal) => {
  const original = await importOriginal<typeof import("../storage/safeWrite")>();
  return {
    ...original,
    safeWriteJson: (async (dir: never, fileName: string, value: unknown, options?: never) => {
      const result = await original.safeWriteJson(dir, fileName, value, options);
      if (hooks.afterFirstCommit && !hooks.fired && fileName.endsWith(".decisions.json")) {
        hooks.fired = true;
        await hooks.afterFirstCommit();
        return { committedUnverified: true, cause: new Error("simulated stale read-back") };
      }
      return result;
    }) as typeof original.safeWriteJson,
  };
});

import { safeWriteJson } from "../storage/safeWrite";
import {
  appendDecisionEvent,
  hashDecisionEvent,
  loadSupervisorDecisions,
  verifyDecisionChain,
} from "./approvalStorage";
import type { DecisionEvent, SupervisorDecisionFile } from "./approvalTypes";

const MONTH = "9-September-2026";
const SUP = "sup";
const FILE = "sup.decisions.json";

const decision = (requestId: string, reviewedAt: string): DecisionEvent => ({
  requestId,
  kind: "referral",
  status: "approved",
  reviewedBy: SUP,
  reviewedAt,
});

beforeEach(() => {
  clearErrors();
  hooks.afterFirstCommit = null;
  hooks.fired = false;
});
afterEach(() => clearErrors());

async function seed(root: DirectoryHandleLike): Promise<SupervisorDecisionFile> {
  expect((await appendDecisionEvent(root, MONTH, SUP, decision("r0", "2026-09-28T00:00:00.000Z"))).ok).toBe(true);
  return loadSupervisorDecisions(root, MONTH, SUP);
}

async function otherWriterCommits(
  root: DirectoryHandleLike,
  before: SupervisorDecisionFile,
  event: DecisionEvent
): Promise<void> {
  const dir = await getSampleApprovalsDir(root, MONTH, true);
  const live = await loadSupervisorDecisions(root, MONTH, SUP);
  const last = (before.decisionEvents ?? []).at(-1)!;
  await safeWriteJson<SupervisorDecisionFile>(dir, FILE, {
    ...before,
    revision: (live.revision ?? 0) + 1,
    _writeToken: `other-token-${event.requestId}`,
    decisionEvents: [
      ...(before.decisionEvents ?? []),
      { ...event, previousDecisionHash: hashDecisionEvent(last) },
    ],
  });
}

const ids = async (root: DirectoryHandleLike) =>
  ((await loadSupervisorDecisions(root, MONTH, SUP)).decisionEvents ?? []).map((e) => e.requestId);

describe("appendDecisionEvent is idempotent by decision identity", () => {
  it("unverified, then the token read returns ANOTHER writer's token: retry, our event lands exactly once, chain valid", async () => {
    const root = createMemoryDirectory("dec-a") as DirectoryHandleLike;
    const before = await seed(root);
    hooks.afterFirstCommit = () => otherWriterCommits(root, before, decision("rB", "2026-09-28T00:00:02.000Z"));

    const result = await appendDecisionEvent(root, MONTH, SUP, decision("rA", "2026-09-28T00:00:01.000Z"));

    expect(result.ok).toBe(true);
    const all = await ids(root);
    expect(all.filter((r) => r === "rA")).toHaveLength(1);
    expect(all.filter((r) => r === "rB")).toHaveLength(1);
    expect(verifyDecisionChain((await loadSupervisorDecisions(root, MONTH, SUP)).decisionEvents ?? [])).toBeNull();
  });

  it("unverified, then the token read ALSO throws: retry finds the event, exactly one copy", async () => {
    const root = createMemoryDirectory("dec-b") as DirectoryHandleLike;
    await seed(root);
    setSimulatedFaults(root, [
      { operation: "readFile", name: FILE, errorName: "NotReadableError", times: 12, rearmAfterClose: true },
    ]);

    const result = await appendDecisionEvent(root, MONTH, SUP, decision("rA", "2026-09-28T00:00:01.000Z"));

    setSimulatedFaults(root, []);
    expect(result.ok).toBe(true);
    expect((await ids(root)).filter((r) => r === "rA")).toHaveLength(1);
    expect(verifyDecisionChain((await loadSupervisorDecisions(root, MONTH, SUP)).decisionEvents ?? [])).toBeNull();
  });

  it("the lost-race interleaving (A read, B read, A commit, B commit, A's reads failing): both present exactly once", async () => {
    const root = createMemoryDirectory("dec-c") as DirectoryHandleLike;
    const before = await seed(root);
    hooks.afterFirstCommit = async () => {
      await otherWriterCommits(root, before, decision("rB", "2026-09-28T00:00:02.000Z"));
      setSimulatedFaults(root, [
        { operation: "readFile", name: FILE, errorName: "NotReadableError", times: 12 },
      ]);
    };

    const result = await appendDecisionEvent(root, MONTH, SUP, decision("rA", "2026-09-28T00:00:01.000Z"));

    setSimulatedFaults(root, []);
    expect(result.ok).toBe(true);
    const all = await ids(root);
    expect(all.filter((r) => r === "rA")).toHaveLength(1);
    expect(all.filter((r) => r === "rB")).toHaveLength(1);
    expect(verifyDecisionChain((await loadSupervisorDecisions(root, MONTH, SUP)).decisionEvents ?? [])).toBeNull();
  });
});
