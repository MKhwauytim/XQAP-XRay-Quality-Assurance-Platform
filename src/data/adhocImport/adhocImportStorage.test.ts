import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import type { AdhocImportRecord } from "./adhocImportTypes";
import {
  createImportId,
  deleteAdhocImportRecord,
  loadAdhocImportIndex,
  loadAdhocImportRecord,
  saveAdhocImportRecord,
} from "./adhocImportStorage";

function makeRecord(importId: string): AdhocImportRecord {
  return {
    importId,
    fileName: "batch.xlsx",
    importedBy: "mkhuwaytim",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows: [
      {
        rowKey: "s1:2",
        mapped: {
          movementType: "s1",
          portCode: null, portName: "ميناء", portType: "بحري",
          movementNumber: null, movementDate: null, movementHijriDate: null,
          declarationNumber: null, transitDeclarationNumber: null, declarationDate: null, declarationHijriDate: null,
          manifestNumber: null, manifestType: null, manifestDate: null,
          plateOrContainerNumber: null, finalDestination: null,
          entryDate: null, exitDate: null,
          chassisNumber: null, reportNumber: null, hasReport: false,
          xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة",
          inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
          xrayImageId: "XR-1", xrayEntryDate: null,
          targetedByRiskEngine: null, riskMessage: null, stage: null,
          sourceSheetName: "s1", sourceRowNumber: 2,
        },
        validation: { valid: true },
        excludedByAdmin: false,
        assigned: false,
        assignedTo: null,
        assignedAt: null,
        namespacedXrayImageId: null,
      },
    ],
  };
}

describe("adhocImportStorage", () => {
  it("saves a record, stamps a revision, and lists it in the index — entirely outside 1-population", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const importId = createImportId();
    const record = makeRecord(importId);

    const saved = await saveAdhocImportRecord(root, record);
    expect(saved.revision).toBe(1);

    const index = await loadAdhocImportIndex(root);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      importId,
      fileName: "batch.xlsx",
      totalRows: 1,
      validRows: 1,
      assignedRows: 0,
    });

    // Not written under 1-population/ at all.
    const populationRoot = await root.getDirectoryHandle("1-population", { create: false }).catch(() => null);
    if (populationRoot) {
      await expect(populationRoot.getDirectoryHandle(importId, { create: false })).rejects.toThrow();
    }

    const reloaded = await loadAdhocImportRecord(root, importId);
    expect(reloaded?.rows).toHaveLength(1);
  });

  it("bumps the revision on a second save and keeps the index entry in sync", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const importId = createImportId();
    const first = await saveAdhocImportRecord(root, makeRecord(importId));

    const closed = await saveAdhocImportRecord(root, { ...first, status: "closed" as const });
    expect(closed.revision).toBe(2);

    const index = await loadAdhocImportIndex(root);
    expect(index.find((e) => e.importId === importId)?.status).toBe("closed");
  });

  it("deleteAdhocImportRecord removes the import from the index", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const importId = createImportId();
    await saveAdhocImportRecord(root, makeRecord(importId));

    await deleteAdhocImportRecord(root, importId);

    const index = await loadAdhocImportIndex(root);
    expect(index.find((e) => e.importId === importId)).toBeUndefined();
  });

  it("loadAdhocImportIndex returns an empty list for a fresh workspace with no imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    expect(await loadAdhocImportIndex(root)).toEqual([]);
  });
});
