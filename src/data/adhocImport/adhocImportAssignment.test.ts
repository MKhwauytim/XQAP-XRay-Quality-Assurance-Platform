import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { closeMonth, MonthClosedError } from "../population/monthLock";
import type { MonthManifestData } from "../population/monthTypes";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type { AdhocImportRecord, AdhocImportRow } from "./adhocImportTypes";
import { adhocMonthFolderName } from "./adhocImportTypes";
import { loadAdhocImportRecord, saveAdhocImportRecord } from "./adhocImportStorage";
import { namespacedXrayImageId } from "./adhocImportModel";
import { assignAdhocRowsToEmployee, ensureAdhocSampleMaster } from "./adhocImportAssignment";

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
    fileName: "batch.xlsx",
    importedBy: "mkhuwaytim",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows,
  };
}

describe("adhocImportAssignment", () => {
  it("namespaces the xrayImageId so it can never collide with a real population id", () => {
    expect(namespacedXrayImageId("adh-1", "XR-1")).toBe("ADHOC-adh-1-XR-1");
  });

  it("ensureAdhocSampleMaster writes sample.master.json under 2-samples/adhoc-{importId}/, never under 1-population/", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-1", [importRow("XR-1"), importRow("XR-2", 3)]);

    await ensureAdhocSampleMaster(root, record);

    const monthFolderName = adhocMonthFolderName("adh-1");
    const master = await loadSampleMaster(root, monthFolderName);
    expect(master?.rows).toHaveLength(2);
    expect(master?.rows.map((r) => r.xrayImageId).sort()).toEqual([
      "ADHOC-adh-1-XR-1",
      "ADHOC-adh-1-XR-2",
    ]);

    const populationRoot = await root.getDirectoryHandle("1-population", { create: false }).catch(() => null);
    if (populationRoot) {
      await expect(populationRoot.getDirectoryHandle(monthFolderName, { create: false })).rejects.toThrow();
    }
  });

  it("assigns selected rows through the standard buildAssignEvent/appendDistributionEvents path and surfaces them in loadOrDeriveDistributionCurrent", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-2", [importRow("XR-1"), importRow("XR-2", 3)]);
    await ensureAdhocSampleMaster(root, record);

    const result = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.record.rows.find((r) => r.rowKey === "s1:2")?.assigned).toBe(true);
    expect(result.record.rows.find((r) => r.rowKey === "s1:3")?.assigned).toBe(false);

    const monthFolderName = adhocMonthFolderName("adh-2");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries).toHaveLength(1);
    expect(current?.entries[0].xrayImageId).toBe("ADHOC-adh-2-XR-1");
    expect(current?.entries[0].assignedTo).toBe("jalgahamdi");
  });

  it("is idempotent: re-running assignment on an already-assigned row skips it instead of double-assigning", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-3", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);

    const first = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await assignAdhocRowsToEmployee(root, first.record, ["s1:2"], "hihaloraini", "admin");
    // The row's own bookkeeping already marks it assigned, so it is filtered out
    // before an event is even built — this surfaces as the "no assignable rows" error,
    // exactly like requesting to assign zero eligible rows.
    expect(second.ok).toBe(false);
  });

  it("refuses to assign rows from a closed import", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = { ...makeRecord("adh-4", [importRow("XR-1")]), status: "closed" as const };
    await ensureAdhocSampleMaster(root, record);

    const result = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin");
    expect(result.ok).toBe(false);
  });

  it("respects the month lock: appendDistributionEvents rejects when the (synthetic) month manifest is closed", async () => {
    // Ad-hoc months normally have no population manifest at all (fail-open — see
    // ensureMonthWritable's documented fail-open-on-missing-manifest design). This
    // test proves the SAME gate is actually invoked (not bypassed) by simulating
    // the rare case where a manifest happens to exist for the synthetic folder name.
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-5", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);

    const monthFolderName = adhocMonthFolderName("adh-5");
    const monthDir = await getPopulationMonthDir(root, monthFolderName, true);
    const manifest: MonthManifestData = {
      monthFolderName, month: 0, year: 0,
      processedAt: new Date().toISOString(), processedBy: "admin",
      riskFileName: null, biFileName: null, certScanUsed: false,
      templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 1,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, monthFolderName, "admin");

    await expect(
      assignAdhocRowsToEmployee(root, record, ["s1:2"], "jalgahamdi", "admin")
    ).rejects.toThrow(MonthClosedError);
  });

  // Audit finding 6: assignAdhocRowsToEmployee used to accept ANY string as
  // `assignedTo` -- including a username that does not exist, belongs to a
  // deactivated account, or belongs to a manager/admin/guest who cannot log
  // in to work a review. That silently stalled the review with no one able
  // to act on it.
  it("refuses to assign to a username that does not exist in the managed roster", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-6", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);

    const result = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "no-such-user", "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/غير موجود|غير نشط/);

    // No event should have been durably written for the rejected assignee.
    const monthFolderName = adhocMonthFolderName("adh-6");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("refuses to assign to a manager username (not an employee/supervisor role, so it can never work the review)", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const record = makeRecord("adh-7", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);

    // "amonem" is a default manager account -- present in the roster, but not
    // an assignable sample role.
    const result = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "amonem", "admin");
    expect(result.ok).toBe(false);
  });
});

// The caller's `record` is tab React state — potentially hours old on a shared
// workspace — while saveAdhocImportRecord is a whole-document overwrite. The
// assignment path must therefore trust only the ON-DISK record for the status
// gate, the row filters, and the save base; otherwise a stale tab reverts a
// close, assigns excluded rows, and wipes other machines' bookkeeping.
describe("assignAdhocRowsToEmployee against a stale tab record", () => {
  it("refuses to assign into an import another machine closed, without reverting the close", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const staleRecord = makeRecord("adh-8", [importRow("XR-1")]);
    await ensureAdhocSampleMaster(root, staleRecord);
    // Another machine closed the import after this tab loaded its copy.
    await saveAdhocImportRecord(root, { ...staleRecord, status: "closed" });

    const result = await assignAdhocRowsToEmployee(root, staleRecord, ["s1:2"], "jalgahamdi", "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("مُغلق");
    expect((await loadAdhocImportRecord(root, "adh-8"))?.status).toBe("closed");
  });

  it("honors on-disk exclusions and preserves other machines' assignment bookkeeping", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    // This tab's copy: three free rows.
    const staleRecord = makeRecord("adh-9", [
      importRow("XR-1", 2),
      importRow("XR-2", 3),
      importRow("XR-3", 4),
    ]);
    await ensureAdhocSampleMaster(root, staleRecord);
    // Meanwhile on disk: an admin excluded XR-1 and another machine assigned
    // XR-2 to someone else (record-level bookkeeping only — the exact state a
    // stale full-document overwrite used to erase).
    const onDisk: AdhocImportRecord = {
      ...staleRecord,
      rows: staleRecord.rows.map((r) => {
        if (r.rowKey === "s1:2") return { ...r, excludedByAdmin: true };
        if (r.rowKey === "s1:3") {
          return {
            ...r,
            assigned: true,
            assignedTo: "hihaloraini",
            assignedAt: "2026-08-17T06:00:00.000Z",
            namespacedXrayImageId: namespacedXrayImageId("adh-9", "XR-2"),
          };
        }
        return r;
      }),
    };
    await saveAdhocImportRecord(root, onDisk);

    // The stale tab selects all three rows.
    const result = await assignAdhocRowsToEmployee(
      root, staleRecord, ["s1:2", "s1:3", "s1:4"], "jalgahamdi", "admin"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the genuinely free row was assigned.
    expect(result.assignedCount).toBe(1);

    const saved = (await loadAdhocImportRecord(root, "adh-9"))!;
    const byKey = new Map(saved.rows.map((r) => [r.rowKey, r]));
    expect(byKey.get("s1:2")?.excludedByAdmin).toBe(true);
    expect(byKey.get("s1:2")?.assigned).toBe(false);
    expect(byKey.get("s1:3")?.assignedTo).toBe("hihaloraini");
    expect(byKey.get("s1:3")?.assignedAt).toBe("2026-08-17T06:00:00.000Z");
    expect(byKey.get("s1:4")?.assigned).toBe(true);
    expect(byKey.get("s1:4")?.assignedTo).toBe("jalgahamdi");

    // The durable event log agrees: exactly one assign event, for XR-3.
    const monthFolderName = adhocMonthFolderName("adh-9");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries).toHaveLength(1);
    expect(current?.entries[0].xrayImageId).toBe("ADHOC-adh-9-XR-3");
  });
});
