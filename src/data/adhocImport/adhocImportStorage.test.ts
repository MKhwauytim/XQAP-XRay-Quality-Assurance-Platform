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
import { safeReadJson } from "../storage/safeWrite";
import { loadAdhocRecord, saveAdhocRecord } from "./adhocImportStorage";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import type { AdhocRecord } from "./adhocImportModel";

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

/**
 * The document on disk is the v2 record PLUS v1's assignment scalars. This app
 * ships as a single `index.html` that people keep copies of, so a workspace
 * written by this build has to stay readable by last week's build for one
 * release — see `adhocRecordMigration.ts`.
 */
describe("adhocImportStorage v1 ↔ v2", () => {
  function v2Record(importId: string): AdhocRecord {
    return {
      importId,
      schemaVersion: 2,
      fileName: "study.xlsx",
      importedBy: "admin",
      importedAt: "2026-08-21T10:00:00.000Z",
      status: "open",
      kind: "historical",
      sourceKind: "paste",
      mapping: { fields: { xrayImageId: { kind: "column", header: "معرف الأشعة" } }, valueMappings: {} },
      fieldCatalog: ADHOC_FIELD_CATALOG,
      monthBinding: { kind: "month", monthFolderName: "5-may-2026" },
      rows: [
        {
          rowKey: "s1:2",
          mapped: { xrayImageId: "XR-1" },
          validation: { valid: true },
          excludedByAdmin: false,
          assignments: [
            { username: "a", replicaIndex: 0, xrayImageId: `ADHOC-${importId}-XR-1`, assignedAt: "t0" },
            { username: "b", replicaIndex: 1, xrayImageId: `ADHOC-${importId}-R1-XR-1`, assignedAt: "t0" },
          ],
        },
      ],
    };
  }

  it("writes the v1 assignment scalars alongside the v2 fields", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await saveAdhocRecord(root, v2Record("adh-compat"));

    const dir = await getAdhocImportsDir(root, false);
    const raw = await safeReadJson<Record<string, unknown>>(dir, "adh-compat.json");
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const rows = raw.value.rows as Array<Record<string, unknown>>;
    expect(rows[0].assigned).toBe(true);
    expect(rows[0].assignedTo).toBe("a");
    expect(rows[0].namespacedXrayImageId).toBe("ADHOC-adh-compat-XR-1");
    // …and the v2 fields are the real storage.
    expect(rows[0].assignments).toHaveLength(2);
    expect(raw.value.schemaVersion).toBe(2);
    expect(raw.value.monthBinding).toEqual({ kind: "month", monthFolderName: "5-may-2026" });
  });

  it("indexes the assignment COUNT and the linked months, so a month-scoped reader can skip this import unopened", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await saveAdhocRecord(root, v2Record("adh-index"));

    const entry = (await loadAdhocImportIndex(root)).find((e) => e.importId === "adh-index");
    expect(entry?.kind).toBe("historical");
    expect(entry?.assignedRows).toBe(2);
    expect(entry?.linkedMonths).toEqual(["5-may-2026"]);
  });

  it("upgrades a v1 record saved through the legacy signature, without losing its assignment", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const v1 = makeRecord("adh-upgrade");
    await saveAdhocImportRecord(root, {
      ...v1,
      rows: v1.rows.map((r) => ({
        ...r,
        assigned: true,
        assignedTo: "jalgahamdi",
        assignedAt: "2026-08-07T11:00:00.000Z",
        namespacedXrayImageId: "ADHOC-adh-upgrade-XR-1",
      })),
    });

    const upgraded = await loadAdhocRecord(root, "adh-upgrade");
    expect(upgraded?.schemaVersion).toBe(2);
    expect(upgraded?.monthBinding).toEqual({ kind: "isolated" });
    expect(upgraded?.rows[0].assignments).toEqual([
      {
        username: "jalgahamdi",
        replicaIndex: 0,
        xrayImageId: "ADHOC-adh-upgrade-XR-1",
        assignedAt: "2026-08-07T11:00:00.000Z",
      },
    ]);

    // The legacy view of the same document still answers the v1 question.
    const legacy = await loadAdhocImportRecord(root, "adh-upgrade");
    expect(legacy?.rows[0].assigned).toBe(true);
    expect(legacy?.rows[0].assignedTo).toBe("jalgahamdi");
  });
});
