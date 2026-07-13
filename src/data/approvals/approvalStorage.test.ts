import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  appendDecisionEvent,
  effectiveDecision,
  hashDecisionEvent,
  loadSupervisorDecisions,
  mergeDecisionHistory,
  verifyDecisionChain,
} from "./approvalStorage";

describe("approvalStorage decision events", () => {
  it("appends a decision event and persists it", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const result = await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1",
      kind: "referral",
      status: "approved",
      reviewedBy: "sup-1",
      reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    expect(file.decisionEvents).toHaveLength(1);
    expect(file.decisionEvents?.[0].status).toBe("approved");
  });

  it("keeps every event for repeated decisions on the same request", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "denied",
      reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "approved",
      reviewedBy: "sup-1", reviewedAt: "2026-07-02T10:00:00.000Z", reviewNotes: "correction",
    });

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    expect(file.decisionEvents).toHaveLength(2);
  });

  it("survives two concurrent decision appends without losing either (cross-machine CAS)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    // Two decisions on two different requests, appended near-simultaneously by
    // the same reviewer (e.g. the reviewer's session open on two PCs). Neither
    // append may clobber the other's event — the withResourceLock + casLoop
    // read-back/retry loop must serialize them to one consistent file.
    const [r1, r2] = await Promise.all([
      appendDecisionEvent(root, "5-may-2026", "sup-1", {
        requestId: "req-A", kind: "referral", status: "approved",
        reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
      }),
      appendDecisionEvent(root, "5-may-2026", "sup-1", {
        requestId: "req-B", kind: "replacement", status: "denied",
        reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:01.000Z",
      }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    expect(file.decisionEvents).toHaveLength(2);
    const ids = (file.decisionEvents ?? []).map((e) => e.requestId).sort();
    expect(ids).toEqual(["req-A", "req-B"]);
  });

  it("merges events across supervisor files and legacy decision arrays, sorted by time", () => {
    const files = [
      {
        supervisorUsername: "sup-1", monthFolderName: "5-may-2026",
        referralDecisions: [{ requestId: "req-1", status: "denied" as const, reviewedBy: "sup-1", reviewedAt: "2026-07-01T09:00:00.000Z" }],
        replacementDecisions: [],
        decisionEvents: [{ requestId: "req-1", kind: "referral" as const, status: "approved" as const, reviewedBy: "sup-1", reviewedAt: "2026-07-03T09:00:00.000Z" }],
        lastUpdatedAt: "2026-07-03T09:00:00.000Z",
      },
      {
        supervisorUsername: "sup-2", monthFolderName: "5-may-2026",
        referralDecisions: [], replacementDecisions: [],
        decisionEvents: [{ requestId: "req-1", kind: "referral" as const, status: "denied" as const, reviewedBy: "sup-2", reviewedAt: "2026-07-02T09:00:00.000Z" }],
        lastUpdatedAt: "2026-07-02T09:00:00.000Z",
      },
    ];

    const history = mergeDecisionHistory(files, "referral", "req-1");
    expect(history.map((e) => e.reviewedBy)).toEqual(["sup-1", "sup-2", "sup-1"]);
    // First-wins: the EARLIEST decision is authoritative (sup-1 denied @ 07-01),
    // not the most recent one — deterministic across per-supervisor files.
    expect(effectiveDecision(history)?.status).toBe("denied");
    expect(effectiveDecision(history)?.reviewedAt).toBe("2026-07-01T09:00:00.000Z");
  });

  it("returns undefined for a request with no history", () => {
    expect(effectiveDecision([])).toBeUndefined();
  });
});

describe("B5 decision hash-chaining (tamper-evident)", () => {
  it("stamps previousDecisionHash on every event after the first", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "approved",
      reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-2", kind: "referral", status: "denied",
      reviewedBy: "sup-1", reviewedAt: "2026-07-02T10:00:00.000Z",
    });
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-3", kind: "replacement", status: "approved",
      reviewedBy: "sup-1", reviewedAt: "2026-07-03T10:00:00.000Z",
    });

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    const events = file.decisionEvents ?? [];
    expect(events).toHaveLength(3);
    // First event has no predecessor → no hash.
    expect(events[0].previousDecisionHash).toBeUndefined();
    // Each later event chains to the actual hash of its predecessor.
    expect(events[1].previousDecisionHash).toBe(hashDecisionEvent(events[0]));
    expect(events[2].previousDecisionHash).toBe(hashDecisionEvent(events[1]));
    // The intact chain verifies.
    expect(verifyDecisionChain(events)).toBeNull();
  });

  it("verifyDecisionChain reports the first broken link when an event is tampered", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "approved",
      reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-2", kind: "referral", status: "denied",
      reviewedBy: "sup-1", reviewedAt: "2026-07-02T10:00:00.000Z",
    });
    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    const events = file.decisionEvents ?? [];
    // Out-of-band edit: flip the first decision's status. Now event[1]'s recorded
    // previousDecisionHash no longer matches the (mutated) event[0].
    const tampered = [{ ...events[0], status: "denied" as const }, events[1]];
    expect(verifyDecisionChain(tampered)).toBe(1);
  });

  it("treats a pre-B5 legacy chain (no previousDecisionHash) as intact", () => {
    const legacy = [
      { requestId: "a", kind: "referral" as const, status: "approved" as const, reviewedBy: "s", reviewedAt: "2026-07-01T10:00:00.000Z" },
      { requestId: "b", kind: "referral" as const, status: "denied" as const, reviewedBy: "s", reviewedAt: "2026-07-02T10:00:00.000Z" },
    ];
    expect(verifyDecisionChain(legacy)).toBeNull();
  });
});
