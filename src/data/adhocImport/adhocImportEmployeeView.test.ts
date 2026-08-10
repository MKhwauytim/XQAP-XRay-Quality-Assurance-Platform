import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type { AdhocImportRecord, AdhocImportRow } from "./adhocImportTypes";
import { adhocMonthFolderName } from "./adhocImportTypes";
import { assignAdhocRowsToEmployee, ensureAdhocSampleMaster } from "./adhocImportAssignment";
import { loadAdhocEntriesForEmployeeView } from "./adhocImportEmployeeView";

function mappedRow(xrayImageId: string, sourceRowNumber = 2): NormalizedRiskRow {
  return {
    movementType: "s1",
    portCode: null, portName: "ميناء جدة", portType: "بحري",
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: "DEC-1", transitDeclarationNumber: null, declarationDate: null, declarationHijriDate: null,
    manifestNumber: null, manifestType: null, manifestDate: null,
    plateOrContainerNumber: null, finalDestination: null,
    entryDate: null, exitDate: null,
    chassisNumber: null, reportNumber: null, hasReport: false,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه",
    inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
    xrayImageId, xrayEntryDate: null,
    targetedByRiskEngine: null, riskMessage: null, stage: "المستوى الأول",
    sourceSheetName: "s1", sourceRowNumber,
  };
}

function importRow(xrayImageId: string, sourceRowNumber = 2): AdhocImportRow {
  return {
    rowKey: `s1:${sourceRowNumber}`,
    mapped: mappedRow(xrayImageId, sourceRowNumber),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
}

function makeRecord(importId: string, rows: AdhocImportRow[]): AdhocImportRecord {
  return {
    importId,
    fileName: `${importId}.xlsx`,
    importedBy: "admin",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows,
  };
}

describe("adhocImportEmployeeView", () => {
  it("surfaces an ad-hoc assignment for the assigned employee, tagged with the import's id and file name", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-1", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    const assignResult = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp1", "admin");
    expect(assignResult.ok).toBe(true);

    const entries = await loadAdhocEntriesForEmployeeView(root, "emp1", false);
    expect(entries).toHaveLength(1);
    expect(entries[0].xrayImageId).toBe("ADHOC-adh-1-XR-1");
    expect(entries[0].assignedTo).toBe("emp1");
    expect(entries[0].adhocImportId).toBe("adh-1");
    expect(entries[0].adhocFileName).toBe("adh-1.xlsx");
  });

  it("does not surface a row assigned to a different employee for a personal-scope user", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-2", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp2", "admin");

    const entries = await loadAdhocEntriesForEmployeeView(root, "emp1", false);
    expect(entries).toEqual([]);
  });

  it("surfaces every assignee's rows for an oversight (canSeeAll) user", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-3", [importRow("XR-1"), importRow("XR-2", 3)]);
    await ensureAdhocSampleMaster(root, record);
    const first = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp1", "admin");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await assignAdhocRowsToEmployee(root, first.record, ["s1:3"], "emp2", "admin");

    const entries = await loadAdhocEntriesForEmployeeView(root, "supervisor-1", true);
    expect(entries.map((e) => e.assignedTo).sort()).toEqual(["emp1", "emp2"]);
  });

  it("skips an ad-hoc import that has no assignments at all (cost bound: never loads its sample/distribution store)", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-4", [importRow("XR-1")]);
    // Finalized (so a sample.master.json exists) but never assigned to anyone.
    await ensureAdhocSampleMaster(root, record);
    // Persist a record with the finalized rows so its index entry reflects
    // assignedRows === 0, exactly like a real "uploaded but not yet assigned" import.
    const { saveAdhocImportRecord } = await import("./adhocImportStorage");
    await saveAdhocImportRecord(root, record);

    const entries = await loadAdhocEntriesForEmployeeView(root, "emp1", false);
    expect(entries).toEqual([]);
  });

  it("degrades to [] (never throws) when the ad-hoc index is entirely missing — a fresh workspace with no ad-hoc imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await expect(loadAdhocEntriesForEmployeeView(root, "emp1", false)).resolves.toEqual([]);
  });

  it("skips a corrupt/unreadable per-import sample store instead of throwing, without affecting other healthy imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");

    // Healthy import.
    const good = makeRecord("adh-good", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, good);
    await assignAdhocRowsToEmployee(root, good, ["s1:2"], "emp1", "admin");

    // Corrupt import: its index entry claims an assignment exists, but its
    // sample.master.json on disk is garbage with no valid .bak to recover from.
    const bad = makeRecord("adh-bad", [importRow("XR-9")]);
    await ensureAdhocSampleMaster(root, bad);
    const assignedBad = await assignAdhocRowsToEmployee(root, bad, ["s1:2"], "emp1", "admin");
    expect(assignedBad.ok).toBe(true);
    const badDir = await getSampleMainDir(root, adhocMonthFolderName("adh-bad"), true);
    const handle = await badDir.getFileHandle("sample.master.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    const entries = await loadAdhocEntriesForEmployeeView(root, "emp1", false);
    expect(entries.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-good-XR-1"]);
  });
});
