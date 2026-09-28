// Error-log audit, errorlog-2026-09-28, §C / Task E4:
// `casLoop:exhausted(adhocImport:index)` paired with `AdhocImport.assign`
// (09-16 06:09, admin). `assignAdhocPlan` (adhocDistributionBridge.ts) commits,
// in order: the durable distribution events, the cache refresh, then the
// per-import record (`saveAdhocRecord`), which used to THROW when its final
// step — refreshing the shared `adhoc-imports.index.json` listing — could not
// be written. By the time that throw happened the assignment was already
// durable on disk (the events and the record itself), so the admin was told
// «فشل التعيين» for an assign that had, in fact, succeeded, and a retry then
// found the rows already assigned and refused.
//
// This mirrors b74f968's fix for `appendDistributionEvents`: the shared index
// is a rebuildable LISTING projection (see adhocImportStorage.ts's own doc on
// `readIndexForUpdate`), so a failure to update it is a DEGRADED SUCCESS, not a
// failed save — reported, never thrown, and self-repairing on the next
// successful write to it.

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import { adhocMonthFolder } from "./adhocImportModel";
import type { AdhocRecord, AdhocRow } from "./adhocImportModel";
import { planAdhocAssignment } from "./adhocAssignmentPlan";
import { loadAdhocImportIndex, loadAdhocRecord, saveAdhocRecord } from "./adhocImportStorage";
import { assignAdhocPlan } from "./adhocDistributionBridge";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";

const REVIEWERS = ["jalgahamdi", "hihaloraini", "saalhijji"];
const INDEX_FILE = "adhoc-imports.index.json";

function row(rowKey: string, xrayImageId: string): AdhocRow {
  return {
    rowKey,
    mapped: { xrayImageId, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

function record(importId: string, rows: AdhocRow[]): AdhocRecord {
  return {
    importId,
    schemaVersion: 2,
    fileName: "batch.xlsx",
    importedBy: "mkhuwaytim",
    importedAt: "2026-08-21T10:00:00.000Z",
    status: "open",
    kind: "sample",
    sourceKind: "file",
    mapping: { fields: {}, valueMappings: {} },
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    rows,
  };
}

afterEach(() => {
  clearErrors();
});

describe("assignAdhocPlan — a failed index write on a committed assign is not a failure", () => {
  it("reports ok: true with the assignment counted, even though the index CAS is exhausted", async () => {
    clearErrors();
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:1", "XR-adh-1")];
    const rec = await saveAdhocRecord(root, record("adh-idx-1", rows));
    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: [{ username: REVIEWERS[0] }],
      importId: "adh-idx-1",
    }).plan;

    // Only the shared index's own read (readIndexForUpdate, inside
    // updateIndex's casLoop) fails — the record's own file and the
    // distribution events are unaffected, matching the production shape: one
    // shared file contended by every machine, unrelated to the per-import
    // document.
    setSimulatedFaults(root, [
      { operation: "readFile", name: INDEX_FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await assignAdhocPlan(root, rec, plan, "admin");

    // Pre-fix this threw out of saveAdhocRecord, so assignAdhocPlan's caller
    // (AdhocImport.assign) caught it and reported «فشل التعيين».
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignedCount).toBe(1);
  });

  it("commits the assignment durably (record + distribution events) despite the index failure, and logs the degradation", async () => {
    clearErrors();
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-adh-2")];
    const rec = await saveAdhocRecord(root, record("adh-idx-2", rows));
    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: [{ username: REVIEWERS[1] }],
      importId: "adh-idx-2",
    }).plan;

    setSimulatedFaults(root, [
      { operation: "readFile", name: INDEX_FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await assignAdhocPlan(root, rec, plan, "admin");
    expect(result.ok).toBe(true);

    // The record on disk carries the assignment.
    const saved = await loadAdhocRecord(root, "adh-idx-2");
    expect(saved?.rows[0].assignments.map((a) => a.username)).toEqual([REVIEWERS[1]]);

    // The distribution events are durable — the fold sees the assignment.
    const monthFolderName = adhocMonthFolder("adh-idx-2");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries.some((e) => e.assignedTo === REVIEWERS[1])).toBe(true);

    // Exactly one degradation is logged — reported, not swallowed.
    expect(
      getRecentErrors().filter((entry) => entry.context.includes("adhocImport:index-degraded")).length
    ).toBe(1);
  });

  it("does not throw or report a false failure on a subsequent call, once the index write is healthy again", async () => {
    clearErrors();
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:3", "XR-adh-3")];
    const rec = await saveAdhocRecord(root, record("adh-idx-3", rows));
    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: [{ username: REVIEWERS[2] }],
      importId: "adh-idx-3",
    }).plan;

    setSimulatedFaults(root, [
      { operation: "readFile", name: INDEX_FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    const degraded = await assignAdhocPlan(root, rec, plan, "admin");
    expect(degraded.ok).toBe(true);
    expect(degraded.ok && degraded.indexDegraded).toBe(true);

    // Clear the fault (the share recovers) and save the record again — the
    // ordinary next write to this import's own index entry, no special repair
    // code needed. This must not throw, and must repair the index.
    setSimulatedFaults(root, []);
    const fresh = await loadAdhocRecord(root, "adh-idx-3");
    expect(fresh).not.toBeNull();
    if (fresh === null) return;
    await expect(saveAdhocRecord(root, fresh)).resolves.toBeTruthy();

    const repairedIndex = await loadAdhocImportIndex(root);
    const repairedEntry = repairedIndex.find((e) => e.importId === "adh-idx-3");
    expect(repairedEntry?.assignedRows).toBeGreaterThan(0);
  });
});
