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
import { getAdhocImportsDir } from "../workspace/workspacePaths";

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

  // safeWrite.ts's own module doc: "An empty default handed to a
  // read-modify-write is not a harmless placeholder: it is written back as the
  // entire file." The index used to seed `{ imports: [] }` from ANY failed read,
  // and safeReadJson reports a corrupt file (live/.bak/.tmp ladder exhausted)
  // exactly as it reports a missing one — so the next save rewrote the whole
  // index with just its own entry, and since the index is the only lister the
  // app has, every other import's `{importId}.json` became unreachable.
  it("refuses to rewrite a corrupt index, keeping the other imports' entries", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await saveAdhocImportRecord(root, makeRecord("adh-1"));
    await saveAdhocImportRecord(root, makeRecord("adh-2"));
    expect((await loadAdhocImportIndex(root)).map((e) => e.importId)).toEqual(["adh-1", "adh-2"]);

    const dir = await getAdhocImportsDir(root, false);
    for (const suffix of ["", ".bak", ".tmp"]) {
      const handle = await dir.getFileHandle(`adhoc-imports.index.json${suffix}`, { create: true });
      const writable = await handle.createWritable?.();
      if (!writable) throw new Error("memory directory handle is not writable");
      await writable.write("{ truncated");
      await writable.close();
    }

    await expect(saveAdhocImportRecord(root, makeRecord("adh-3"))).rejects.toThrow(/تالف/);

    // The corrupt index was left alone rather than replaced by a one-entry one,
    // so repairing it (or restoring a backup) still brings adh-1/adh-2 back.
    const raw = await (await dir.getFileHandle("adhoc-imports.index.json", { create: false })).getFile();
    expect(await raw.text()).toBe("{ truncated");
  });

  it("loadAdhocImportIndex returns an empty list for a fresh workspace with no imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    expect(await loadAdhocImportIndex(root)).toEqual([]);
  });
});
