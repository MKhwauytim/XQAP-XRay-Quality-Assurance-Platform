import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type { AdhocImportRecord, AdhocImportRow } from "./adhocImportTypes";
import { adhocMonthFolderName } from "./adhocImportTypes";
import { assignAdhocRowsToEmployee, ensureAdhocSampleMaster } from "./adhocImportAssignment";
import {
  adhocStoreHasDistributionEvents,
  loadAdhocImportIndex,
  saveAdhocRecord,
} from "./adhocImportStorage";
import { normalizeAdhocRecord } from "./adhocRecordMigration";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { assignAdhocPlan } from "./adhocDistributionBridge";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import type { AdhocMonthBinding, AdhocRecord } from "./adhocImportModel";
import {
  displayXrayImageId,
  listAdhocSampleFolders,
  loadAdhocEntriesForEmployeeView,
} from "./adhocImportEmployeeView";

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
    const assignResult = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin");
    expect(assignResult.ok).toBe(true);

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(entries).toHaveLength(1);
    expect(entries[0].xrayImageId).toBe("ADHOC-adh-1-XR-1");
    expect(entries[0].assignedTo).toBe("jalgahamdi");
    expect(entries[0].adhocImportId).toBe("adh-1");
    expect(entries[0].adhocFileName).toBe("adh-1.xlsx");
  });

  it("does not surface a row assigned to a different employee for a personal-scope user", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-2", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    await assignAdhocRowsToEmployee(root, record, ["s1:2"], "hihaloraini", "admin");

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(entries).toEqual([]);
  });

  it("surfaces every assignee's rows for an oversight (canSeeAll) user", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-3", [importRow("XR-1"), importRow("XR-2", 3)]);
    await ensureAdhocSampleMaster(root, record);
    const first = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await assignAdhocRowsToEmployee(root, first.record, ["s1:3"], "hihaloraini", "admin");

    const entries = await loadAdhocEntriesForEmployeeView(root, "supervisor-1", true);
    expect(entries.map((e) => e.assignedTo).sort()).toEqual(["hihaloraini", "jalgahamdi"]);
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

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(entries).toEqual([]);
  });

  it("degrades to [] (never throws) when the ad-hoc index is entirely missing — a fresh workspace with no ad-hoc imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await expect(loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false)).resolves.toEqual([]);
  });

  it("skips a corrupt/unreadable per-import sample store instead of throwing, without affecting other healthy imports", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");

    // Healthy import.
    const good = makeRecord("adh-good", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, good);
    await assignAdhocRowsToEmployee(root, good, ["s1:2"], "jalgahamdi", "admin");

    // Corrupt import: its index entry claims an assignment exists, but its
    // sample.master.json on disk is garbage with no valid .bak to recover from.
    const bad = makeRecord("adh-bad", [importRow("XR-9")]);
    await ensureAdhocSampleMaster(root, bad);
    const assignedBad = await assignAdhocRowsToEmployee(root, bad, ["s1:2"], "jalgahamdi", "admin");
    expect(assignedBad.ok).toBe(true);
    const badDir = await getSampleMainDir(root, adhocMonthFolderName("adh-bad"), true);
    // Every rung of safeReadJson's recovery ladder has to be garbage, not just
    // the live file: assignment rewrites sample.master.json (it must, so a
    // fan-out plan's replica ids exist before any event names them), which
    // leaves a perfectly valid `.bak` behind that the reader would otherwise
    // recover from — and then this would be testing recovery, not degradation.
    for (const name of ["sample.master.json", "sample.master.json.bak", "sample.master.json.tmp"]) {
      const handle = await badDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{not valid json");
      await writable.close();
    }

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(entries.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-good-XR-1"]);
  });
});

/**
 * Month scoping. `linkedMonths` lives on the index so a month-scoped reader can
 * decide what to open from one small file — an import bound to another month
 * must cost nothing, not a sample-master read that is then discarded.
 */
describe("adhocImportEmployeeView month filter", () => {
  const MAY = "5-may-2026";
  const JUNE = "6-june-2026";

  async function seedImport(
    root: ReturnType<typeof createMemoryDirectory>,
    importId: string,
    xrayImageId: string,
    monthBinding: AdhocMonthBinding
  ): Promise<void> {
    const record: AdhocRecord = {
      importId,
      schemaVersion: 2,
      fileName: `${importId}.xlsx`,
      importedBy: "admin",
      importedAt: "2026-08-07T10:00:00.000Z",
      status: "open",
      kind: "sample",
      sourceKind: "file",
      mapping: { fields: {}, valueMappings: {} },
      fieldCatalog: ADHOC_FIELD_CATALOG,
      monthBinding,
      rows: [
        {
          rowKey: "s1:2",
          // Both result fields are required by `ADHOC_FIELD_CATALOG` and are
          // what the reviewer's table renders, so a record that reached
          // assignment carries them — a row without them never gets this far.
          mapped: {
            xrayImageId,
            xrayLevelOneResult: "سليمة",
            xrayLevelTwoResult: "اشتباه",
          },
          validation: { valid: true },
          excludedByAdmin: false,
          assignments: [],
        },
      ],
    };
    const saved = await saveAdhocRecord(root, record);
    const result = await assignAdhocPlan(
      root,
      saved,
      [
        {
          rowKey: "s1:2",
          username: "jalgahamdi",
          replicaIndex: 0,
          xrayImageId: `ADHOC-${importId}-${xrayImageId}`,
        },
      ],
      "admin"
    );
    expect(result.ok).toBe(true);
  }

  async function seedThreeImports(): Promise<ReturnType<typeof createMemoryDirectory>> {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await seedImport(root, "adh-may", "XR-MAY", { kind: "month", monthFolderName: MAY });
    await seedImport(root, "adh-june", "XR-JUNE", { kind: "month", monthFolderName: JUNE });
    await seedImport(root, "adh-iso", "XR-ISO", { kind: "isolated" });
    return root;
  }

  it("opens only the imports linked to the requested month", async () => {
    const root = await seedThreeImports();

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false, MAY);
    expect(entries.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-may-XR-MAY"]);

    const june = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false, JUNE);
    expect(june.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-june-XR-JUNE"]);
  });

  it("excludes an isolated import from every month scope, and includes it when unscoped", async () => {
    const root = await seedThreeImports();

    const scoped = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false, MAY);
    expect(scoped.some((e) => e.adhocImportId === "adh-iso")).toBe(false);

    const unscoped = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(unscoped.map((e) => e.adhocImportId).sort()).toEqual(["adh-iso", "adh-june", "adh-may"]);
  });

  it("answers [] for a month no import links to, without opening anything", async () => {
    const root = await seedThreeImports();
    expect(await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false, "1-january-2026")).toEqual([]);
  });

  it("scopes listAdhocSampleFolders the same way, so employee-authored records are looked for in the right stores", async () => {
    const root = await seedThreeImports();

    expect(await listAdhocSampleFolders(root, MAY)).toEqual(["adhoc-adh-may"]);
    expect((await listAdhocSampleFolders(root)).sort()).toEqual([
      "adhoc-adh-iso",
      "adhoc-adh-june",
      "adhoc-adh-may",
    ]);
  });

  it("treats a legacy index entry with no linkedMonths as isolated under a month scope", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    // A record saved before month binding existed: v1 shape, no binding at all.
    const record = makeRecord("adh-legacy", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    expect((await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin")).ok).toBe(true);

    expect(await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false, MAY)).toEqual([]);
    expect(await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false)).toHaveLength(1);
  });
});

/**
 * The repair path. Visibility must follow what is on disk, not a counter a
 * half-failed write can strand.
 *
 * An assignment commits in three writes — sample rows, distribution events,
 * then the record that refreshes `adhoc-imports.index.json`. The events are the
 * durable part and they land SECOND, so a failure on the third write (a share
 * hiccup, a lost workspace handle, a CAS conflict) leaves rows genuinely
 * assigned while the index still says `assignedRows: 0`. That used to hide them
 * from every reader permanently: re-running the assignment finds its own events
 * already there and answers «كل الصفوف المحددة معيّنة بالفعل», so the
 * bookkeeping can never catch up on its own.
 *
 * The failure is simulated by re-saving the PRE-assignment record, which is
 * exactly the document a failed third write leaves behind.
 */
describe("adhocImportEmployeeView — assignments the index lost", () => {
  it("still surfaces rows whose events are on disk when the index reports assignedRows: 0", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-stranded", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    expect((await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin")).ok).toBe(true);

    // The third write never landed: the record on disk is still the one from
    // before the assignment, so its index entry counts zero assignments.
    await saveAdhocRecord(root, normalizeAdhocRecord(record)!);
    const index = await loadAdhocImportIndex(root);
    expect(index.find((entry) => entry.importId === "adh-stranded")?.assignedRows).toBe(0);

    const entries = await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false);
    expect(entries.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-stranded-XR-1"]);
    expect(entries[0].assignedTo).toBe("jalgahamdi");
    // …and the employee's writes are routed to the store that holds them.
    expect(await listAdhocSampleFolders(root)).toEqual(["adhoc-adh-stranded"]);
  });

  it("still ignores an import that was saved but never assigned — a store folder is not an assignment", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    // `persist` in the AdhocImport tab writes sample.master.json on every save,
    // so the store folder exists for an unassigned import too. Only
    // `distribution.events/` proves an assignment, and nothing wrote one here.
    const record = makeRecord("adh-idle", [importRow("XR-1")]);
    await saveAdhocRecord(root, normalizeAdhocRecord(record)!);
    await ensureAdhocSampleMaster(root, record);

    expect(await adhocStoreHasDistributionEvents(root, "adh-idle")).toBe(false);
    expect(await loadAdhocEntriesForEmployeeView(root, "jalgahamdi", false)).toEqual([]);
    expect(await listAdhocSampleFolders(root)).toEqual([]);
  });
});

/**
 * Display identity. The namespaced id is storage; the operator's own id is what
 * belongs on screen.
 */
describe("displayXrayImageId", () => {
  const adhocEntry = (xrayImageId: string, adhocImportId: string): DistributionEntry => ({
    xrayImageId,
    assignedTo: "jalgahamdi",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-08-07T10:00:00.000Z",
    row: { xrayImageId } as unknown as DistributionEntry["row"],
    adhocImportId,
    adhocFileName: `${adhocImportId}.xlsx`,
  } as DistributionEntry);

  it("shows the operator's own id for an ad-hoc row, not the ADHOC- namespace", () => {
    const entry = adhocEntry("ADHOC-adh-9f2c-4b11-10B1326010300151", "adh-9f2c-4b11");
    expect(displayXrayImageId(entry)).toBe("10B1326010300151");
  });

  it("strips the replica marker a fan-out adds, so every reviewer sees the same id", () => {
    const entry = adhocEntry("ADHOC-adh-9f2c-R3-10B1326010300151", "adh-9f2c");
    expect(displayXrayImageId(entry)).toBe("10B1326010300151");
  });

  it("leaves a real population row's id completely alone", () => {
    const entry = {
      xrayImageId: "10B1326010300151",
      assignedTo: "jalgahamdi",
      status: "pending",
      replacedById: null,
      lastEventAt: "2026-08-07T10:00:00.000Z",
      row: {} as unknown as DistributionEntry["row"],
    } as DistributionEntry;
    expect(displayXrayImageId(entry)).toBe("10B1326010300151");
  });

  it("returns an ad-hoc id it does not recognize untouched rather than guessing at it", () => {
    // Belt and braces: an entry whose id was not built from its own importId
    // (a hand-edited file, a future id shape) must not be silently truncated.
    const entry = adhocEntry("ADHOC-adh-other-XR-1", "adh-mine");
    expect(displayXrayImageId(entry)).toBe("ADHOC-adh-other-XR-1");
  });
});
