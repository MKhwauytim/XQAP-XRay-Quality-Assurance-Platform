import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { loadDistributionLog } from "../distribution/distributionStorage";
import { submitReopenRequest } from "./requestReopen";
import { loadReopenLog } from "./referralStorage";
import { approveReopen, denyReopen } from "./approveReferral";

const MONTH = "5-May-2026";

function submittedItem(xrayImageId: string, answeredBy: string): ItemAnswer {
  const now = new Date().toISOString();
  return {
    xrayImageId,
    templateId: "tpl-1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "قيمة" }],
    lastSavedAt: now,
    submittedAt: now,
    answeredBy,
    status: "submitted",
  };
}

async function seedSubmittedAnswer(root: DirectoryHandleLike, xrayImageId: string, user: string): Promise<void> {
  await upsertItemAnswer(root, MONTH, user, submittedItem(xrayImageId, user));
}

describe("submitReopenRequest — instant vs approval-required branching", () => {
  it("instant mode flips the submitted answer to draft and creates NO request", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedSubmittedAnswer(root, "IMG-1", "alice");

    const result = await submitReopenRequest({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: "alice",
      xrayImageId: "IMG-1",
      assignedTo: "alice",
      requestedBy: "alice",
      requestedByRole: "employee",
      reason: "خطأ في الإدخال",
      instant: true,
    });
    expect(result).toEqual({ ok: true, mode: "instant" });

    const file = await loadEmployeeAnswers(root, MONTH, "alice");
    expect(file.items[0].status).toBe("draft");
    expect(file.reopenRequests ?? []).toHaveLength(0);

    const reopenLog = await loadReopenLog(root, MONTH);
    expect(reopenLog.requests).toHaveLength(0);
  });

  it("approval-required mode creates a pending request, leaves the answer submitted, and logs a reopen-requested event", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedSubmittedAnswer(root, "IMG-2", "bob");

    const result = await submitReopenRequest({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: "bob",
      xrayImageId: "IMG-2",
      assignedTo: "bob",
      requestedBy: "bob",
      requestedByRole: "employee",
      reason: "أريد التصحيح",
      instant: false,
    });
    expect(result).toEqual({ ok: true, mode: "requested" });

    const file = await loadEmployeeAnswers(root, MONTH, "bob");
    expect(file.items[0].status).toBe("submitted"); // untouched until approved

    const reopenLog = await loadReopenLog(root, MONTH);
    expect(reopenLog.requests).toHaveLength(1);
    expect(reopenLog.requests[0].status).toBe("pending");
    expect(reopenLog.requests[0].xrayImageId).toBe("IMG-2");
    expect(reopenLog.requests[0].employeeUsername).toBe("bob");

    // Best-effort audit marker present in the distribution log.
    const distLog = await loadDistributionLog(root, MONTH);
    expect(distLog.events.some((e) => e.eventType === "reopen-requested" && e.xrayImageId === "IMG-2")).toBe(true);
  });
});

describe("approveReopen / denyReopen", () => {
  it("approve flips the answer to draft and records an approved decision", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedSubmittedAnswer(root, "IMG-3", "carol");
    await submitReopenRequest({
      directoryHandle: root, monthFolderName: MONTH, employeeUsername: "carol", xrayImageId: "IMG-3",
      assignedTo: "carol", requestedBy: "carol", requestedByRole: "employee", reason: "تصحيح", instant: false,
    });
    const before = await loadReopenLog(root, MONTH);
    const requestId = before.requests[0].requestId;

    const outcome = await approveReopen({
      directoryHandle: root, monthFolderName: MONTH, requestId,
      reviewedBy: "sup-1", reviewedByRole: "supervisor", reviewNotes: "موافق",
    });
    expect(outcome.ok).toBe(true);

    const file = await loadEmployeeAnswers(root, MONTH, "carol");
    expect(file.items[0].status).toBe("draft");

    const after = await loadReopenLog(root, MONTH);
    expect(after.requests[0].status).toBe("approved");
    expect(after.requests[0].reviewedBy).toBe("sup-1");
    expect(after.requests[0].history).toHaveLength(1);
  });

  it("deny leaves the answer submitted and records a denied decision", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedSubmittedAnswer(root, "IMG-4", "dave");
    await submitReopenRequest({
      directoryHandle: root, monthFolderName: MONTH, employeeUsername: "dave", xrayImageId: "IMG-4",
      assignedTo: "dave", requestedBy: "dave", requestedByRole: "employee", reason: "تصحيح", instant: false,
    });
    const before = await loadReopenLog(root, MONTH);
    const requestId = before.requests[0].requestId;

    const outcome = await denyReopen({
      directoryHandle: root, monthFolderName: MONTH, requestId,
      reviewedBy: "sup-1", reviewNotes: "غير مبرر",
    });
    expect(outcome.ok).toBe(true);

    const file = await loadEmployeeAnswers(root, MONTH, "dave");
    expect(file.items[0].status).toBe("submitted"); // unchanged

    const after = await loadReopenLog(root, MONTH);
    expect(after.requests[0].status).toBe("denied");
  });

  it("rejects approving a request that was already reviewed (idempotency)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedSubmittedAnswer(root, "IMG-5", "erin");
    await submitReopenRequest({
      directoryHandle: root, monthFolderName: MONTH, employeeUsername: "erin", xrayImageId: "IMG-5",
      assignedTo: "erin", requestedBy: "erin", requestedByRole: "employee", reason: "تصحيح", instant: false,
    });
    const before = await loadReopenLog(root, MONTH);
    const requestId = before.requests[0].requestId;

    await denyReopen({ directoryHandle: root, monthFolderName: MONTH, requestId, reviewedBy: "sup-1" });
    const outcome = await approveReopen({
      directoryHandle: root, monthFolderName: MONTH, requestId,
      reviewedBy: "sup-2", reviewedByRole: "supervisor",
    });
    expect(outcome.ok).toBe(false);

    const after = await loadReopenLog(root, MONTH);
    expect(after.requests[0].status).toBe("denied"); // first decision stands
  });
});
