import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getAdhocImportsDir } from "../workspace/workspacePaths";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import type { AdhocRecord, AdhocRow } from "./adhocImportModel";
import { loadAdhocRecord } from "./adhocImportStorage";
import { normalizeAdhocRecord, toIndexEntry, toLegacyRecord } from "./adhocRecordMigration";

/**
 * A v1 document exactly as the shipped build writes it: `mapped` is a
 * `NormalizedRiskRow`, assignment state is four scalars, and none of
 * `schemaVersion` / `kind` / `mapping` / `fieldCatalog` / `monthBinding` exists.
 */
function v1Document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    importId: "adh-v1",
    fileName: "batch.xlsx",
    importedBy: "mkhuwaytim",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    revision: 4,
    rows: [
      {
        rowKey: "s1:2",
        mapped: {
          movementType: "s1",
          portCode: null, portName: "ميناء جدة", portType: "بحري",
          movementNumber: null, movementDate: null, movementHijriDate: null,
          declarationNumber: "DEC-1", transitDeclarationNumber: null,
          declarationDate: null, declarationHijriDate: null,
          manifestNumber: null, manifestType: null, manifestDate: null,
          plateOrContainerNumber: null, finalDestination: null,
          entryDate: null, exitDate: null,
          chassisNumber: null, reportNumber: null, hasReport: false,
          xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه",
          inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
          xrayImageId: "XR-1", xrayEntryDate: null,
          targetedByRiskEngine: null, riskMessage: null, stage: "المستوى الأول",
          sourceSheetName: "s1", sourceRowNumber: 2,
        },
        validation: { valid: true },
        excludedByAdmin: false,
        assigned: true,
        assignedTo: "jalgahamdi",
        assignedAt: "2026-08-07T11:00:00.000Z",
        namespacedXrayImageId: "ADHOC-adh-v1-XR-1",
      },
      {
        rowKey: "s1:3",
        mapped: { xrayImageId: null, sourceSheetName: "s1", sourceRowNumber: 3 },
        validation: { valid: false, reason: "معرّف الأشعة مفقود." },
        excludedByAdmin: true,
        assigned: false,
        assignedTo: null,
        assignedAt: null,
        namespacedXrayImageId: null,
      },
    ],
    ...overrides,
  };
}

function v2Row(rowKey: string, xrayImageId: string, assignments: AdhocRow["assignments"]): AdhocRow {
  return {
    rowKey,
    mapped: { xrayImageId },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments,
  };
}

function v2Record(rows: AdhocRow[], overrides: Partial<AdhocRecord> = {}): AdhocRecord {
  return {
    importId: "adh-v2",
    schemaVersion: 2,
    fileName: "fanout.xlsx",
    importedBy: "admin",
    importedAt: "2026-08-21T09:00:00.000Z",
    status: "open",
    kind: "sample",
    sourceKind: "paste",
    mapping: { fields: {}, valueMappings: {} },
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    rows,
    ...overrides,
  };
}

describe("normalizeAdhocRecord", () => {
  it("upgrades a v1 record read from disk without losing anything the record actually said", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const dir = await getAdhocImportsDir(root, true);
    // Written as the raw v1 document, bypassing the storage layer entirely —
    // this is what an existing workspace holds.
    await safeWriteJson(dir, "adh-v1.json", v1Document());

    const record = await loadAdhocRecord(root, "adh-v1");
    expect(record).not.toBeNull();
    if (!record) return;

    expect(record.importId).toBe("adh-v1");
    expect(record.schemaVersion).toBe(2);
    expect(record.fileName).toBe("batch.xlsx");
    expect(record.importedBy).toBe("mkhuwaytim");
    expect(record.importedAt).toBe("2026-08-07T10:00:00.000Z");
    expect(record.status).toBe("open");
    expect(record.revision).toBe(4);
    expect(record.rows).toHaveLength(2);

    const [first, second] = record.rows;
    expect(first.mapped.xrayImageId).toBe("XR-1");
    expect(first.mapped.portName).toBe("ميناء جدة");
    expect(first.mapped.xrayLevelOneResult).toBe("سليمة");
    expect(first.mapped.xrayLevelTwoResult).toBe("اشتباه");
    expect(first.mapped.stage).toBe("المستوى الأول");
    expect(first.validation).toEqual({ valid: true });
    expect(first.excludedByAdmin).toBe(false);

    expect(second.validation).toEqual({ valid: false, reason: "معرّف الأشعة مفقود." });
    expect(second.excludedByAdmin).toBe(true);
    expect(second.assignments).toEqual([]);
  });

  it("derives one replica-0 assignment from v1's four scalars, keeping the id already on the event log", () => {
    const record = normalizeAdhocRecord(v1Document());
    expect(record?.rows[0].assignments).toEqual([
      {
        username: "jalgahamdi",
        replicaIndex: 0,
        xrayImageId: "ADHOC-adh-v1-XR-1",
        assignedAt: "2026-08-07T11:00:00.000Z",
      },
    ]);
  });

  it("keeps every string-valued mapped key and drops only what a string bag cannot hold", () => {
    const mapped = normalizeAdhocRecord(v1Document())?.rows[0].mapped ?? {};
    // Null is a value ("mapped, but blank"), not an absence.
    expect(mapped.portCode).toBeNull();
    expect(mapped.movementType).toBe("s1");
    expect(mapped.sourceSheetName).toBe("s1");
    // A number is readable as text and is coerced rather than dropped...
    expect(mapped.sourceRowNumber).toBe("2");
    // ...a boolean is not, and `hasReport` has no consumer on the ad-hoc path.
    expect("hasReport" in mapped).toBe(false);
  });

  it("supplies the documented v1 defaults for everything v1 never recorded", () => {
    const record = normalizeAdhocRecord(v1Document());
    expect(record?.monthBinding).toEqual({ kind: "isolated" });
    expect(record?.kind).toBe("population");
    expect(record?.sourceKind).toBe("file");
    // Best-effort reconstruction: v1 parsed against the workspace's live
    // Population aliases and never snapshotted what it used.
    expect(record?.fieldCatalog).toBe(ADHOC_FIELD_CATALOG);
    expect(record?.mapping).toEqual({ fields: {}, valueMappings: {} });
  });

  it("prefers an existing v2 assignments array over the legacy scalars", () => {
    const record = normalizeAdhocRecord(
      v1Document({
        rows: [
          {
            rowKey: "s1:2",
            mapped: { xrayImageId: "XR-1" },
            validation: { valid: true },
            excludedByAdmin: false,
            assignments: [
              { username: "a", replicaIndex: 0, xrayImageId: "ADHOC-adh-v1-XR-1", assignedAt: "t0" },
              { username: "b", replicaIndex: 1, xrayImageId: "ADHOC-adh-v1-R1-XR-1", assignedAt: "t0" },
            ],
            // Deliberately contradictory legacy scalars: the v2 array wins, so a
            // document written by this build and read back cannot lose a replica.
            assigned: true,
            assignedTo: "a",
            assignedAt: "t0",
            namespacedXrayImageId: "ADHOC-adh-v1-XR-1",
          },
        ],
      })
    );
    expect(record?.rows[0].assignments.map((a) => a.username)).toEqual(["a", "b"]);
  });

  it("answers null for input that is not a record document, and never throws", () => {
    expect(normalizeAdhocRecord(null)).toBeNull();
    expect(normalizeAdhocRecord(undefined)).toBeNull();
    expect(normalizeAdhocRecord("not a record")).toBeNull();
    expect(normalizeAdhocRecord(42)).toBeNull();
    expect(normalizeAdhocRecord([])).toBeNull();
    expect(normalizeAdhocRecord({})).toBeNull();
    expect(normalizeAdhocRecord({ importId: 7 })).toBeNull();
  });

  it("survives a structurally broken document instead of taking the whole listing down with it", () => {
    const record = normalizeAdhocRecord({
      importId: "adh-junk",
      status: 12,
      rows: [null, "row", { rowKey: 5 }, { rowKey: "s1:9", mapped: "nope", assignments: "nope" }],
      monthBinding: { kind: "month" },
      fieldCatalog: [{ labelAr: "no key" }],
    });
    expect(record?.status).toBe("open");
    // Only the one row with a usable key survives; the rest cannot be addressed.
    expect(record?.rows.map((row) => row.rowKey)).toEqual(["s1:9"]);
    expect(record?.rows[0].mapped).toEqual({});
    expect(record?.rows[0].assignments).toEqual([]);
    // A `month` binding with no month name is not a binding.
    expect(record?.monthBinding).toEqual({ kind: "isolated" });
    expect(record?.fieldCatalog).toBe(ADHOC_FIELD_CATALOG);
  });
});

describe("toIndexEntry", () => {
  it("counts ASSIGNMENTS, not assigned rows — the two differ under fan-out", () => {
    const record = v2Record([
      v2Row("s1:2", "XR-1", [
        { username: "a", replicaIndex: 0, xrayImageId: "ADHOC-adh-v2-XR-1", assignedAt: "t" },
        { username: "b", replicaIndex: 1, xrayImageId: "ADHOC-adh-v2-R1-XR-1", assignedAt: "t" },
        { username: "c", replicaIndex: 2, xrayImageId: "ADHOC-adh-v2-R2-XR-1", assignedAt: "t" },
      ]),
      v2Row("s1:3", "XR-2", []),
    ]);
    const entry = toIndexEntry(record);
    expect(entry.totalRows).toBe(2);
    expect(entry.validRows).toBe(2);
    expect(entry.assignedRows).toBe(3);
    expect(entry.kind).toBe("sample");
  });

  it("reports an isolated import's linkedMonths as empty and a bound import's as its month", () => {
    const rows = [v2Row("s1:2", "XR-1", [])];
    expect(toIndexEntry(v2Record(rows)).linkedMonths).toEqual([]);
    expect(
      toIndexEntry(v2Record(rows, { monthBinding: { kind: "month", monthFolderName: "5-May-2026" } }))
        .linkedMonths
    ).toEqual(["5-May-2026"]);
  });

  it("derives linkedMonths per row for a column binding, oldest first", () => {
    const record = v2Record(
      [
        { ...v2Row("s1:2", "XR-1", []), mapped: { xrayImageId: "XR-1", studyMonth: "2026-10" } },
        { ...v2Row("s1:3", "XR-2", []), mapped: { xrayImageId: "XR-2", studyMonth: "مايو 2026" } },
        { ...v2Row("s1:4", "XR-3", []), mapped: { xrayImageId: "XR-3", studyMonth: "" } },
      ],
      { monthBinding: { kind: "column", fieldKey: "studyMonth" } }
    );
    expect(toIndexEntry(record).linkedMonths).toEqual(["5-may-2026", "10-october-2026"]);
  });
});

describe("toLegacyRecord", () => {
  it("re-derives v1's scalars from assignments[0] so an older build still sees the row as taken", () => {
    const legacy = toLegacyRecord(
      v2Record([
        v2Row("s1:2", "XR-1", [
          { username: "a", replicaIndex: 0, xrayImageId: "ADHOC-adh-v2-XR-1", assignedAt: "t0" },
          { username: "b", replicaIndex: 1, xrayImageId: "ADHOC-adh-v2-R1-XR-1", assignedAt: "t0" },
        ]),
        v2Row("s1:3", "XR-2", []),
      ])
    );
    expect(legacy.rows[0].assigned).toBe(true);
    expect(legacy.rows[0].assignedTo).toBe("a");
    expect(legacy.rows[0].assignedAt).toBe("t0");
    expect(legacy.rows[0].namespacedXrayImageId).toBe("ADHOC-adh-v2-XR-1");
    // Both replicas still travel on the v2 field — the scalars are a view, not
    // the storage.
    expect(legacy.rows[0].assignments).toHaveLength(2);
    expect(legacy.rows[1].assigned).toBe(false);
    expect(legacy.rows[1].assignedTo).toBeNull();
  });

  it("round-trips: normalize(toLegacyRecord(record)) is the record again", () => {
    const record = v2Record([
      v2Row("s1:2", "XR-1", [
        { username: "a", replicaIndex: 0, xrayImageId: "ADHOC-adh-v2-XR-1", assignedAt: "t0" },
        { username: "b", replicaIndex: 1, xrayImageId: "ADHOC-adh-v2-R1-XR-1", assignedAt: "t0" },
      ]),
    ]);
    expect(normalizeAdhocRecord(toLegacyRecord(record))).toEqual(record);
  });
});
