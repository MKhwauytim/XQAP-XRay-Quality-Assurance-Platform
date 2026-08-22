import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { readEnvelopeRevision, safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { closeMonth, MonthClosedError } from "../population/monthLock";
import type { MonthManifestData } from "../population/monthTypes";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadEmployeeSampleMirror } from "../samples/sampleMirrorStorage";
import {
  createDefaultManagedUsers,
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../auth/userManagement";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import { adhocMonthFolder } from "./adhocImportModel";
import type {
  AdhocRecord,
  AdhocRow,
  FieldSource,
  ImportMapping,
  PlannedAssignment,
  SourceTable,
} from "./adhocImportModel";
import { projectTable } from "./adhocRowProjection";
import { planAdhocAssignment } from "./adhocAssignmentPlan";
import { saveAdhocRecord, loadAdhocRecord } from "./adhocImportStorage";
import {
  assignAdhocPlan,
  ensureAdhocSampleMaster,
  projectToDistributionRow,
} from "./adhocDistributionBridge";

const REVIEWERS = ["jalgahamdi", "hihaloraini", "saalhijji"];

/**
 * A validated row, as every caller of the bridge hands one over: an identity
 * plus the two required results.
 *
 * The results are defaulted rather than repeated in twenty fixtures because
 * they are a PRECONDITION of projection, not the subject of these tests —
 * `projectToDistributionRow` throws without them rather than inventing one, so
 * a fixture missing them would be testing the throw. `bareRow` below is the
 * deliberate opposite, for the tests that ARE about that.
 */
function row(rowKey: string, xrayImageId: string, mapped: Record<string, string | null> = {}): AdhocRow {
  const base = bareRow(rowKey, xrayImageId, mapped);
  return {
    ...base,
    // Defaults first, so an explicit result in `mapped` still wins.
    mapped: { xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", ...base.mapped },
  };
}

/** A row whose L1/L2 never resolved — what a caller that skipped validation has. */
function bareRow(
  rowKey: string,
  xrayImageId: string,
  mapped: Record<string, string | null> = {}
): AdhocRow {
  return {
    rowKey,
    mapped: { xrayImageId, ...mapped },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

function record(importId: string, rows: AdhocRow[], overrides: Partial<AdhocRecord> = {}): AdhocRecord {
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
    ...overrides,
  };
}

function explicitPlan(importId: string, rows: AdhocRow[], username: string): PlannedAssignment[] {
  return planAdhocAssignment({
    rows,
    mode: "explicit",
    targets: [{ username }],
    explicitRowKeys: rows.map((r) => r.rowKey),
    importId,
  }).plan;
}

afterEach(() => {
  // The roster lives in a module-level runtime variable; a test that deactivates
  // an account must not leak that into the next one.
  writeUserManagementState(createEmptyUserManagementState(), false);
});

describe("projectToDistributionRow", () => {
  it("takes certScanStatus from the MAPPED value instead of hardcoding it (G4)", () => {
    const certscan = projectToDistributionRow(
      "adh-1",
      row("s1:2", "XR-1", { certScanStatus: "Certscan" }),
      ADHOC_FIELD_CATALOG,
      0
    );
    expect(certscan.certScanStatus).toBe("Certscan");
  });

  it("falls back to NonCertscan for a file that does not say, and for a value the catalog does not offer", () => {
    expect(projectToDistributionRow("adh-1", row("s1:2", "XR-1"), ADHOC_FIELD_CATALOG, 0).certScanStatus)
      .toBe("NonCertscan");
    expect(
      projectToDistributionRow(
        "adh-1",
        row("s1:2", "XR-1", { certScanStatus: "maybe" }),
        ADHOC_FIELD_CATALOG,
        0
      ).certScanStatus
    ).toBe("NonCertscan");
  });

  it("keeps the honest defaults for what ad-hoc genuinely lacks (no BI file, no cert-scan reference)", () => {
    const prepared = projectToDistributionRow("adh-1", row("s1:2", "XR-1"), ADHOC_FIELD_CATALOG, 0);
    expect(prepared.biEnrichmentStatus).toBe("BI Not Provided");
    expect(prepared.biMatched).toBe(false);
    expect(prepared.certScanSnippet).toBeNull();
    expect(prepared.levelOneEmployee).toBeNull();
    expect(prepared.levelTwoEmployee).toBeNull();
    expect(prepared.otherResults.manual.result).toBeNull();
  });

  it("stamps the provenance a later agreement analysis needs, and recovers the source location from rowKey", () => {
    const prepared = projectToDistributionRow("adh-1", row("ورقة1:412", "XR-1"), ADHOC_FIELD_CATALOG, 2);
    expect(prepared.adhocSourceRowKey).toBe("ورقة1:412");
    expect(prepared.adhocReplicaIndex).toBe(2);
    expect(prepared.sourceSheetName).toBe("ورقة1");
    expect(prepared.sourceRowNumber).toBe(412);
    expect(prepared.xrayImageId).toBe("ADHOC-adh-1-R2-XR-1");
  });

  it("refuses a row with no identity — a programmer error, since every caller filters on validity", () => {
    const identityless: AdhocRow = { ...row("s1:2", "XR-1"), mapped: {} };
    expect(() => projectToDistributionRow("adh-1", identityless, ADHOC_FIELD_CATALOG, 0)).toThrow();
  });

  it("carries the mapped L1/L2 results through unchanged", () => {
    const prepared = projectToDistributionRow(
      "adh-1",
      row("s1:2", "XR-1", { xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "سليمة" }),
      ADHOC_FIELD_CATALOG,
      0
    );
    expect(prepared.xrayLevelOneResult).toBe("اشتباه");
    expect(prepared.xrayLevelTwoResult).toBe("سليمة");
  });

  it("throws rather than substituting a result when L1 or L2 never resolved", () => {
    // The whole point of requiring the two fields: there is no representable
    // "unknown" on PreparedPopulationRow, so any value picked here would render
    // in the reviewer's table as though a person had recorded it. A caller that
    // skipped validation gets an exception, not a fabricated clinical result.
    expect(() =>
      projectToDistributionRow("adh-1", bareRow("s1:2", "XR-1"), ADHOC_FIELD_CATALOG, 0)
    ).toThrow(/xrayLevelOneResult/);

    // L2 alone is just as fatal as both.
    expect(() =>
      projectToDistributionRow(
        "adh-1",
        bareRow("s1:3", "XR-2", { xrayLevelOneResult: "سليمة" }),
        ADHOC_FIELD_CATALOG,
        0
      )
    ).toThrow(/xrayLevelTwoResult/);
  });

  it("refuses a stored value the catalog does not offer instead of letting it through as a result", () => {
    // `mapped` is a plain string bag — a hand-edited record, or one written
    // against an older catalog, can hold anything. It must not reach
    // PreparedPopulationRow's `"سليمة" | "اشتباه"` union verbatim, and it must
    // not quietly become the other option either.
    expect(() =>
      projectToDistributionRow(
        "adh-1",
        row("s1:2", "XR-1", { xrayLevelOneResult: "غير معروف" }),
        ADHOC_FIELD_CATALOG,
        0
      )
    ).toThrow(/xrayLevelOneResult/);
  });
});

/**
 * The two halves of "a file with no result columns is still importable":
 * the admin declares the value once and every row carries it, or nobody
 * declares it and every row is visibly rejected before assignment.
 */
describe("a bare image list", () => {
  const BARE_TABLE: SourceTable = {
    sheetName: "الورقة1",
    headers: ["معرف الأشعة"],
    rows: [
      { sourceRowNumber: 2, values: { "معرف الأشعة": "XR-1" } },
      { sourceRowNumber: 3, values: { "معرف الأشعة": "XR-2" } },
    ],
  };

  function mappingWith(results: FieldSource): ImportMapping {
    return {
      fields: {
        xrayImageId: { kind: "column", header: "معرف الأشعة" },
        xrayLevelOneResult: results,
        xrayLevelTwoResult: results,
      },
      valueMappings: {},
    };
  }

  function project(results: FieldSource): AdhocRow[] {
    return projectTable({
      table: BARE_TABLE,
      mapping: mappingWith(results),
      catalog: ADHOC_FIELD_CATALOG,
      binding: { kind: "isolated" },
    });
  }

  it("imports and projects when the admin declares the file's result as a constant", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = project({ kind: "constant", value: "سليمة" });
    expect(rows.every((r) => r.validation.valid)).toBe(true);

    const written = await ensureAdhocSampleMaster(root, record("adh-const", rows));

    expect(written.map((r) => r.xrayImageId)).toEqual([
      "ADHOC-adh-const-XR-1",
      "ADHOC-adh-const-XR-2",
    ]);
    // The declared value rides on every row — recorded once, attributable to
    // the admin who declared it, and never invented per row.
    expect(written.map((r) => r.xrayLevelOneResult)).toEqual(["سليمة", "سليمة"]);
    expect(written.map((r) => r.xrayLevelTwoResult)).toEqual(["سليمة", "سليمة"]);
  });

  it("invalidates every row when nobody declares one, so the rejection is operator-visible", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = project({ kind: "none" });

    expect(rows.map((r) => r.validation.valid)).toEqual([false, false]);
    const reason = rows[0].validation.valid === false ? rows[0].validation.reason : "";
    expect(reason).toContain("نتيجة المستوى الأول");

    // And the bridge skips them rather than throwing: an invalid row is never
    // projected, so the admin sees a rejection count, not a crashed screen.
    const written = await ensureAdhocSampleMaster(root, record("adh-bare", rows));
    expect(written).toEqual([]);
    expect((await loadSampleMaster(root, adhocMonthFolder("adh-bare")))?.rows).toEqual([]);
  });
});

describe("ensureAdhocSampleMaster", () => {
  it("writes a row for every replica the plan references, before any event can name one", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = record("adh-fan", rows);
    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: REVIEWERS.map((username) => ({ username })),
      importId: "adh-fan",
    }).plan;

    const written = await ensureAdhocSampleMaster(root, rec, plan);
    const ids = new Set(written.map((r) => r.xrayImageId));
    // Every id the plan is about to reference must already be a sample row:
    // foldDistributionEvents silently DROPS an event whose xrayImageId is absent
    // from the rows it is folded against, which would make the assignment
    // durably written but invisible to everyone.
    for (const planned of plan) {
      expect(ids.has(planned.xrayImageId)).toBe(true);
    }
    // 2 rows x 3 reviewers = 6 replicas, and replica 0 is one of the three.
    expect(written).toHaveLength(6);

    const master = await loadSampleMaster(root, adhocMonthFolder("adh-fan"));
    expect(master?.rows.map((r) => r.xrayImageId)).toEqual(written.map((r) => r.xrayImageId));
  });

  it("keeps every valid row browsable at replica 0 even when the plan names none of them", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-plain", [
      row("s1:2", "XR-1"),
      { ...row("s1:3", "XR-2"), validation: { valid: false, reason: "سيء" } },
    ]);

    const written = await ensureAdhocSampleMaster(root, rec);
    expect(written.map((r) => r.xrayImageId)).toEqual(["ADHOC-adh-plain-XR-1"]);
  });

  it("counts CertScan rows honestly instead of reporting zero", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-cs", [
      row("s1:2", "XR-1", { certScanStatus: "Certscan" }),
      row("s1:3", "XR-2", { certScanStatus: "NonCertscan" }),
    ]);

    await ensureAdhocSampleMaster(root, rec);
    const master = await loadSampleMaster(root, adhocMonthFolder("adh-cs"));
    expect(master?.certScanActual).toBe(1);
    expect(master?.nonCertScanActual).toBe(1);
  });
});

/**
 * The write-amplification guard.
 *
 * `ensureAdhocSampleMaster` runs on EVERY record save — a single
 * exclude-checkbox toggle during review included — so an unconditional rewrite
 * pushed the whole (potentially multi-megabyte) document through
 * `safeWriteJson`'s stage-verify-commit-reverify ladder plus a `.bak` rotation
 * per click. Every test here observes the FILE, never the return value: a skip
 * is only a skip if nothing on disk moved, and a write is only proven by the
 * ids that end up persisted.
 */
describe("ensureAdhocSampleMaster write coverage", () => {
  const FILE = "sample.master.json";

  /** `safeWriteJson` increments this on every commit, so it counts writes. */
  async function revisionOf(root: DirectoryHandleLike, importId: string): Promise<number> {
    const dir = await getSampleMainDir(root, adhocMonthFolder(importId), false);
    return (await readEnvelopeRevision(dir, FILE)) ?? -1;
  }

  async function persistedIds(root: DirectoryHandleLike, importId: string): Promise<string[]> {
    const master = await loadSampleMaster(root, adhocMonthFolder(importId));
    return (master?.rows ?? []).map((r) => r.xrayImageId);
  }

  it("does not write again when the same record is saved a second time", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-skip", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);

    await ensureAdhocSampleMaster(root, rec);

    // A sentinel in a field the write path REBUILDS from the record: `drawnBy`
    // comes back as the importer's username the instant a write happens, so its
    // survival is direct evidence, not an inference from timing. The envelope
    // revision is the second, independent witness.
    const master = await loadSampleMaster(root, adhocMonthFolder("adh-skip"));
    if (master === null) throw new Error("first call must have written the file");
    await saveSampleMaster(root, adhocMonthFolder("adh-skip"), { ...master, drawnBy: "SENTINEL" });
    const revisionBefore = await revisionOf(root, "adh-skip");

    const second = await ensureAdhocSampleMaster(root, rec);

    expect(await revisionOf(root, "adh-skip")).toBe(revisionBefore);
    expect((await loadSampleMaster(root, adhocMonthFolder("adh-skip")))?.drawnBy).toBe("SENTINEL");
    // And the caller cannot tell: it gets exactly the rows a write would return.
    expect(second.map((r) => r.xrayImageId)).toEqual([
      "ADHOC-adh-skip-XR-1",
      "ADHOC-adh-skip-XR-2",
    ]);
  });

  it("writes for a fan-out plan whose replica ids are not in the file yet, and persists every one", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = record("adh-fan-cover", rows);

    // Replica 0 only — the state a plain save leaves behind.
    await ensureAdhocSampleMaster(root, rec);
    const revisionBefore = await revisionOf(root, "adh-fan-cover");

    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: REVIEWERS.map((username) => ({ username })),
      importId: "adh-fan-cover",
    }).plan;
    expect(plan.some((planned) => planned.replicaIndex > 0)).toBe(true);

    await ensureAdhocSampleMaster(root, rec, plan);

    expect(await revisionOf(root, "adh-fan-cover")).toBe(revisionBefore + 1);
    // The safety property, asserted against the PERSISTED file: an assign event
    // naming an id that is not a sample row is silently dropped by
    // foldDistributionEvents — durably written, permanently invisible.
    const ids = new Set(await persistedIds(root, "adh-fan-cover"));
    for (const planned of plan) {
      expect(ids.has(planned.xrayImageId)).toBe(true);
    }
  });

  it("writes when a new valid row joins the record", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await ensureAdhocSampleMaster(root, record("adh-grow", [row("s1:2", "XR-1")]));
    const revisionBefore = await revisionOf(root, "adh-grow");

    await ensureAdhocSampleMaster(
      root,
      record("adh-grow", [row("s1:2", "XR-1"), row("s1:3", "XR-2")])
    );

    expect(await revisionOf(root, "adh-grow")).toBe(revisionBefore + 1);
    expect(await persistedIds(root, "adh-grow")).toEqual([
      "ADHOC-adh-grow-XR-1",
      "ADHOC-adh-grow-XR-2",
    ]);
  });

  it("writes when a re-mapped column changes what a row says, even though no id moved", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await ensureAdhocSampleMaster(
      root,
      record("adh-remap", [row("s1:2", "XR-1", { certScanStatus: "NonCertscan" })])
    );
    const revisionBefore = await revisionOf(root, "adh-remap");

    // Coverage is about the rows, not just their names: an admin who re-maps a
    // column keeps every xrayImageId while changing the row's content, and a
    // file left un-refreshed there disagrees with the record every report is
    // read beside.
    await ensureAdhocSampleMaster(
      root,
      record("adh-remap", [row("s1:2", "XR-1", { certScanStatus: "Certscan" })])
    );

    expect(await revisionOf(root, "adh-remap")).toBe(revisionBefore + 1);
    const master = await loadSampleMaster(root, adhocMonthFolder("adh-remap"));
    expect(master?.rows[0].certScanStatus).toBe("Certscan");
  });

  it("skips the rewrite when the required set SHRINKS, and the dropped row survives on disk", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-shrink", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);
    await ensureAdhocSampleMaster(root, rec);
    const revisionBefore = await revisionOf(root, "adh-shrink");

    // Two ways the review table shrinks what this call would write. Excluding a
    // row does NOT actually shrink the sample rows — `excludedByAdmin` gates
    // assignability, not browsability — so the real shrink is the second row,
    // which a re-map has made invalid and which is therefore no longer
    // projected at all.
    const shrunk = record("adh-shrink", [
      { ...rec.rows[0], excludedByAdmin: true },
      { ...rec.rows[1], validation: { valid: false, reason: "عمود ناقص" } },
    ]);

    const written = await ensureAdhocSampleMaster(root, shrunk);

    expect(written.map((r) => r.xrayImageId)).toEqual(["ADHOC-adh-shrink-XR-1"]);
    expect(await revisionOf(root, "adh-shrink")).toBe(revisionBefore);
    // Rewriting to drop the row would delete a sample row an assignment may
    // still name; an extra row costs bytes and nothing else.
    expect(await persistedIds(root, "adh-shrink")).toEqual([
      "ADHOC-adh-shrink-XR-1",
      "ADHOC-adh-shrink-XR-2",
    ]);
  });

  it("falls through to a write when the existing file is corrupt instead of reading it as covered", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-corrupt", [row("s1:2", "XR-1")]);
    await ensureAdhocSampleMaster(root, rec);

    // Every rung of safeReadJson's recovery ladder has to be garbage, or this
    // would be testing recovery rather than the fall-through.
    const dir = await getSampleMainDir(root, adhocMonthFolder("adh-corrupt"), true);
    for (const name of [FILE, `${FILE}.bak`, `${FILE}.tmp`]) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable?.();
      if (!writable) throw new Error("the memory directory must be writable");
      await writable.write("{not valid json");
      await writable.close();
    }

    const written = await ensureAdhocSampleMaster(root, rec);

    expect(written.map((r) => r.xrayImageId)).toEqual(["ADHOC-adh-corrupt-XR-1"]);
    expect(await persistedIds(root, "adh-corrupt")).toEqual(["ADHOC-adh-corrupt-XR-1"]);
  });
});

describe("assignAdhocPlan", () => {
  it("fans one row out to N reviewers as N distinct entries, each mirrored only to its own reviewer", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-f1", rows));
    const plan = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: REVIEWERS.map((username) => ({ username })),
      importId: "adh-f1",
    }).plan;

    const result = await assignAdhocPlan(root, rec, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignedCount).toBe(3);

    const monthFolderName = adhocMonthFolder("adh-f1");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries).toHaveLength(3);
    expect(new Set((current?.entries ?? []).map((e) => e.assignedTo))).toEqual(new Set(REVIEWERS));
    // Three distinct ids for one source row — that is what makes three
    // independent answers representable at all.
    expect(new Set((current?.entries ?? []).map((e) => e.xrayImageId)).size).toBe(3);

    for (const username of REVIEWERS) {
      const mirror = await loadEmployeeSampleMirror(root, monthFolderName, username);
      expect(mirror?.entries.map((e) => e.assignedTo)).toEqual([username]);
    }

    // All three replicas are bookkept on the one source row.
    const saved = await loadAdhocRecord(root, "adh-f1");
    expect(saved?.rows[0].assignments.map((a) => a.username).sort()).toEqual([...REVIEWERS].sort());
    expect(saved?.rows[0].assignments.map((a) => a.replicaIndex).sort()).toEqual([0, 1, 2]);
  });

  it("is idempotent: applying the same plan twice appends no second event", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-idem", rows));
    const plan = explicitPlan("adh-idem", rows, "jalgahamdi");

    const first = await assignAdhocPlan(root, rec, plan, "admin");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.assignedCount).toBe(2);

    // Replayed against the STALE record on purpose — a tab that never saw the
    // first commit must not be able to double-assign.
    const second = await assignAdhocPlan(root, rec, plan, "admin");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("معيّنة بالفعل");

    const monthFolderName = adhocMonthFolder("adh-idem");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries).toHaveLength(2);
    const saved = await loadAdhocRecord(root, "adh-idem");
    expect(saved?.rows.every((r) => r.assignments.length === 1)).toBe(true);
  });

  it("refuses to assign out of a closed import, and writes nothing", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-closed", rows, { status: "closed" }));
    const plan = explicitPlan("adh-closed", rows, "jalgahamdi");

    const result = await assignAdhocPlan(root, rec, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("مُغلق");
    expect(await loadSampleMaster(root, adhocMonthFolder("adh-closed"))).toBeNull();
  });

  it("refuses the whole plan when a target was deactivated after the admin's list was rendered", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-inactive", rows));
    const plan = planAdhocAssignment({
      rows,
      mode: "count",
      targets: [{ username: "jalgahamdi", count: 1 }, { username: "hihaloraini", count: 1 }],
      importId: "adh-inactive",
    }).plan;

    writeUserManagementState(
      {
        ...createEmptyUserManagementState(),
        users: createDefaultManagedUsers().map((user) =>
          user.username === "hihaloraini" ? { ...user, isActive: false } : user
        ),
      },
      false
    );

    const result = await assignAdhocPlan(root, rec, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/غير موجود|غير نشط/);

    // Not even the still-valid reviewer's half was committed: a partially
    // delivered distribution is not the one the admin asked for.
    const master = await loadSampleMaster(root, adhocMonthFolder("adh-inactive"));
    const current = await loadOrDeriveDistributionCurrent(
      root,
      adhocMonthFolder("adh-inactive"),
      master?.rows ?? []
    );
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("refuses a username that is not in the roster at all", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-ghost", rows));

    const result = await assignAdhocPlan(
      root,
      rec,
      [{ rowKey: "s1:2", username: "no-such-user", replicaIndex: 0, xrayImageId: "ADHOC-adh-ghost-XR-1" }],
      "admin"
    );
    expect(result.ok).toBe(false);
  });

  it("skips a row another machine excluded meanwhile, using the on-disk record and not the caller's", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const stale = await saveAdhocRecord(root, record("adh-stale", rows));
    const plan = explicitPlan("adh-stale", rows, "jalgahamdi");

    await saveAdhocRecord(root, {
      ...stale,
      rows: stale.rows.map((r) => (r.rowKey === "s1:2" ? { ...r, excludedByAdmin: true } : r)),
    });

    const result = await assignAdhocPlan(root, stale, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignedCount).toBe(1);
    // And the exclusion survived the whole-document save.
    const saved = await loadAdhocRecord(root, "adh-stale");
    expect(saved?.rows.find((r) => r.rowKey === "s1:2")?.excludedByAdmin).toBe(true);
    expect(saved?.rows.find((r) => r.rowKey === "s1:2")?.assignments).toEqual([]);
  });
});

/**
 * Guards that used to be proven only through the v1 adapter's own test file
 * (`adhocImportAssignment.test.ts`). Each one exercises a branch the describes
 * above genuinely leave open, so they belong to the bridge regardless of what
 * happens to the v1 entry point:
 *
 *  - the month-lock gate — the bridge's own docblock cites a test as proof that
 *    `ensureMonthWritable` is INVOKED (and merely fails open for a synthetic
 *    month with no manifest) rather than bypassed. Nothing here proved that.
 *  - `sample.master.json` staying out of `1-population/`.
 *  - `findAssignableEmployee`'s ROLE branch. The describes above cover its other
 *    two rejections (absent user, deactivated user); a present, active account
 *    whose role simply cannot work a review is a third branch.
 *  - the stale-tab close, and another machine's assignment bookkeeping surviving
 *    the whole-document save.
 */
describe("assignAdhocPlan — guards carried over from the v1 adapter", () => {
  it("respects the month lock: the append rejects when the synthetic month's manifest is closed", async () => {
    // Ad-hoc months normally have no population manifest at all, so
    // `ensureMonthWritable` fails OPEN for them by design. This simulates the
    // rare case where a manifest does exist for the synthetic folder name, which
    // is the only way to observe that the gate runs at all.
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-locked", rows));
    const plan = explicitPlan("adh-locked", rows, "jalgahamdi");

    const monthFolderName = adhocMonthFolder("adh-locked");
    const monthDir = await getPopulationMonthDir(root, monthFolderName, true);
    const manifest: MonthManifestData = {
      monthFolderName,
      month: 0,
      year: 0,
      processedAt: new Date().toISOString(),
      processedBy: "admin",
      riskFileName: null,
      biFileName: null,
      certScanUsed: false,
      templateVersion: null,
      rngSeed: null,
      totalRawRows: 0,
      totalProcessedRows: 1,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, monthFolderName, "admin");

    await expect(assignAdhocPlan(root, rec, plan, "admin")).rejects.toThrow(MonthClosedError);
  });

  it("writes the sample master under 2-samples/adhoc-{importId}/, never under 1-population/", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = record("adh-not-pop", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);

    await ensureAdhocSampleMaster(root, rec);

    const monthFolderName = adhocMonthFolder("adh-not-pop");
    const master = await loadSampleMaster(root, monthFolderName);
    expect(master?.rows.map((r) => r.xrayImageId).sort()).toEqual([
      "ADHOC-adh-not-pop-XR-1",
      "ADHOC-adh-not-pop-XR-2",
    ]);

    // An ad-hoc import must never manufacture a population month folder: a real
    // month is a genuine audited population, and a synthetic one appearing there
    // would show up in month listings, reports and the archive as if it were.
    const populationRoot = await root
      .getDirectoryHandle("1-population", { create: false })
      .catch(() => null);
    if (populationRoot) {
      await expect(
        populationRoot.getDirectoryHandle(monthFolderName, { create: false })
      ).rejects.toThrow();
    }
  });

  it("refuses a manager username — present and active in the roster, but never assignable a review", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-role", rows));
    // "amonem" is a default MANAGER account. Accepting it would strand the
    // review with nobody able to open it, which is why the role is checked and
    // not just the account's existence.
    const plan = explicitPlan("adh-role", rows, "amonem");

    const result = await assignAdhocPlan(root, rec, plan, "admin");
    expect(result.ok).toBe(false);
    // Pinned to the assignability message specifically: a plan that was simply
    // empty, or rows that were ineligible, would also fail here and would make
    // this test pass while proving nothing about the role check.
    if (result.ok) return;
    expect(result.error).toMatch(/غير موجود|غير نشط/);

    const monthFolderName = adhocMonthFolder("adh-role");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("refuses to assign into an import another machine closed, without reverting the close", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    // This tab loaded the import while it was still open...
    const stale = await saveAdhocRecord(root, record("adh-stale-closed", rows));
    const plan = explicitPlan("adh-stale-closed", rows, "jalgahamdi");
    // ...and another machine closed it afterwards.
    await saveAdhocRecord(root, { ...stale, status: "closed" });

    const result = await assignAdhocPlan(root, stale, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("مُغلق");
    // The stale copy said "open"; saving from it would have reopened the import.
    expect((await loadAdhocRecord(root, "adh-stale-closed"))?.status).toBe("closed");
  });

  it("preserves another machine's assignment bookkeeping across the whole-document save", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    // This tab's copy: two free rows.
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const stale = await saveAdhocRecord(root, record("adh-keep-bk", rows));
    const plan = explicitPlan("adh-keep-bk", rows, "jalgahamdi");

    // Meanwhile on disk, another machine assigned XR-2 to someone else.
    const otherAssignment = {
      username: "hihaloraini",
      replicaIndex: 0,
      xrayImageId: "ADHOC-adh-keep-bk-XR-2",
      assignedAt: "2026-08-17T06:00:00.000Z",
    };
    await saveAdhocRecord(root, {
      ...stale,
      rows: stale.rows.map((r) =>
        r.rowKey === "s1:3" ? { ...r, assignments: [otherAssignment] } : r
      ),
    });

    const result = await assignAdhocPlan(root, stale, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the genuinely free row was taken.
    expect(result.assignedCount).toBe(1);

    const saved = await loadAdhocRecord(root, "adh-keep-bk");
    const byKey = new Map((saved?.rows ?? []).map((r) => [r.rowKey, r]));
    expect(byKey.get("s1:2")?.assignments.map((a) => a.username)).toEqual(["jalgahamdi"]);
    // Not overwritten, not duplicated, and its timestamp is the other machine's.
    expect(byKey.get("s1:3")?.assignments).toEqual([otherAssignment]);

    // The durable event log agrees: exactly one new assign event, for XR-1.
    const monthFolderName = adhocMonthFolder("adh-keep-bk");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries.map((e) => e.xrayImageId)).toEqual(["ADHOC-adh-keep-bk-XR-1"]);
  });
});
