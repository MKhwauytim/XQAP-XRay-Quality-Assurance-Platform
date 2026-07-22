import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import { writeEmployeeXlsx } from "./employeeXlsx";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { ItemAnswer } from "./answerTypes";

// NOTE on scope: createMemoryDirectory()'s in-memory FileHandleLike mock only
// faithfully round-trips STRING content (JSON files) — its `write(data)`
// implementation does `buffer += data`, which does not preserve real binary
// bytes for an ArrayBuffer write. These tests therefore verify the function
// completes without throwing and creates a file at the correct name/path —
// NOT the XLSX binary structure itself (that would need a real FS-backed
// test, out of scope for this unit-test tier).

function makeEntry(xrayImageId: string, assignedTo: string): DistributionEntry {
  return {
    xrayImageId,
    assignedTo,
    status: "pending",
    replacedById: null,
    lastEventAt: new Date().toISOString(),
    row: {
      xrayImageId,
      portName: "ميناء أ",
      certScanStatus: "Certscan",
      xrayEntryDate: "2026-05-01",
      declarationNumber: "D-1",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
    } as never,
  };
}

describe("employeeXlsx", () => {
  it("writes a blank-answers file without throwing and creates it at the expected path", async () => {
    const root = createMemoryDirectory();
    const entries = [makeEntry("IMG-1", "alice")];

    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "alice", entries)
    ).resolves.not.toThrow();

    // Locate the file via the SAME production helper writeEmployeeXlsx uses
    // internally (getSampleEmployeeDir → 2-samples/{month}/2-employees/),
    // rather than a hand-rolled parallel path guess, so this genuinely
    // exercises the real write location. Called with create:false: if the
    // production code ever wrote to the wrong path (or never created these
    // directories), this lookup throws and the test fails — it does not
    // pass vacuously.
    const employeeDir = await getSampleEmployeeDir(root, "5-may-2026", false);
    const fileHandle = await employeeDir.getFileHandle("alice.xlsx", { create: false });
    expect(fileHandle.name).toBe("alice.xlsx");
  });

  it("overwrites the file on a second call with answers, without throwing", async () => {
    const root = createMemoryDirectory();
    const entries = [makeEntry("IMG-1", "bob")];

    const answers: ItemAnswer[] = [
      {
        xrayImageId: "IMG-1",
        templateId: "t1",
        templateVersion: 1,
        answers: [{ fieldId: "qualityImageResult", value: "سليمة" }],
        lastSavedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        answeredBy: "bob",
        status: "submitted",
      },
    ];

    await writeEmployeeXlsx(root, "5-may-2026", "bob", entries);
    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "bob", entries, answers)
    ).resolves.not.toThrow();

    const employeeDir = await getSampleEmployeeDir(root, "5-may-2026", false);
    const fileHandle = await employeeDir.getFileHandle("bob.xlsx", { create: false });
    expect(fileHandle.name).toBe("bob.xlsx");
  });

  it("requests write permission and succeeds on a freshly-restored read-only workspace", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "granted",
    });
    const entries = [makeEntry("IMG-1", "carol")];

    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "carol", entries)
    ).resolves.not.toThrow();

    // Confirms the write actually landed (not just "didn't throw") — a
    // withWorkspaceWriteAccess that resolved without invoking the wrapped
    // operation would pass the assertion above but fail this one.
    const employeeDir = await getSampleEmployeeDir(root, "5-may-2026", false);
    const fileHandle = await employeeDir.getFileHandle("carol.xlsx", { create: false });
    expect(fileHandle.name).toBe("carol.xlsx");
  });

  it("rejects with the Arabic permission message, not a raw browser error, when write access is declined", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "denied",
    });
    const entries = [makeEntry("IMG-1", "dave")];

    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "dave", entries)
    ).rejects.toThrow(new WorkspacePermissionError().message);
  });
});
