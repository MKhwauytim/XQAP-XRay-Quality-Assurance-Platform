import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { loadSampleMaster } from "../sampling/sampleStorage";
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
