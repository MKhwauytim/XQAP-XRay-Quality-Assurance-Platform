import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  appendDecisionEvent,
  effectiveDecision,
  loadSupervisorDecisions,
  mergeDecisionHistory,
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
    expect(effectiveDecision(history)?.status).toBe("approved");
    expect(effectiveDecision(history)?.reviewedAt).toBe("2026-07-03T09:00:00.000Z");
  });

  it("returns undefined for a request with no history", () => {
    expect(effectiveDecision([])).toBeUndefined();
  });
});
