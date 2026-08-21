import { afterEach, describe, expect, it } from "vitest";

import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
} from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { loadSampleMaster } from "../sampling/sampleStorage";
import {
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../distribution/distributionStorage";
import { loadEmployeeAnswers } from "../answers/answerStorage";
import {
  createDefaultManagedUsers,
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../auth/userManagement";
import type { TemplateSchema } from "../templates/templateTypes";
import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import { adhocMonthFolder, namespacedXrayImageId } from "./adhocImportModel";
import type { AdhocRecord, AdhocRow, FieldSource } from "./adhocImportModel";
import { loadAdhocRecord, saveAdhocRecord } from "./adhocImportStorage";
import { applyHistoricalImport, planHistoricalImport } from "./adhocHistoricalImport";

const REVIEWER_HEADER = "المراجع";
const DATE_HEADER = "تاريخ المراجعة";
const IMPORTED_AT = "2026-08-21T10:00:00.000Z";

/**
 * Four answerable fields plus one `empty` spacer — enough that "the file covers
 * some of them" is a state the tests can actually observe, which is the whole
 * point of a historical import.
 */
function templateSchema(): TemplateSchema {
  return {
    templateId: "tpl-2026",
    templateName: "نموذج الفحص",
    version: 3,
    createdAt: IMPORTED_AT,
    createdBy: "admin",
    updatedAt: IMPORTED_AT,
    updatedBy: "admin",
    fields: [
      {
        fieldId: "f-verdict",
        label: "النتيجة",
        type: "dropdown",
        required: true,
        options: ["مطابق", "غير مطابق"],
      },
      { fieldId: "f-notes", label: "ملاحظات", type: "text", required: false, options: [] },
      { fieldId: "f-count", label: "عدد الطرود", type: "number", required: false, options: [] },
      { fieldId: "f-flag", label: "يحتاج متابعة", type: "checkbox", required: false, options: [] },
      { fieldId: "f-spacer", label: "", type: "empty", required: false, options: [] },
    ],
  };
}

/** Full column coverage — the mapping a file that happens to match the template gets. */
function fullTemplateMapping(): Record<string, FieldSource> {
  return {
    "f-verdict": { kind: "column", header: "النتيجة" },
    "f-notes": { kind: "column", header: "ملاحظات" },
    "f-count": { kind: "column", header: "عدد الطرود" },
    "f-flag": { kind: "column", header: "يحتاج متابعة" },
  };
}

function row(rowKey: string, xrayImageId: string, overrides: Partial<AdhocRow> = {}): AdhocRow {
  return {
    rowKey,
    // L1/L2 are a precondition of projection (`projectToDistributionRow` throws
    // without them), not the subject of these tests.
    mapped: { xrayImageId, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
    ...overrides,
  };
}

function record(
  importId: string,
  rows: AdhocRow[],
  overrides: Partial<AdhocRecord> = {}
): AdhocRecord {
  return {
    importId,
    schemaVersion: 2,
    fileName: "study-2024.xlsx",
    importedBy: "mkhuwaytim",
    importedAt: IMPORTED_AT,
    status: "open",
    kind: "historical",
    sourceKind: "file",
    mapping: { fields: {}, valueMappings: {}, templateFields: fullTemplateMapping() },
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    templateId: "tpl-2026",
    templateVersion: 3,
    rows,
    ...overrides,
  };
}

function cells(reviewer: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [REVIEWER_HEADER]: reviewer,
    [DATE_HEADER]: "2024-03-05",
    "النتيجة": "مطابق",
    "ملاحظات": "لا توجد ملاحظات",
    "عدد الطرود": "12",
    "يحتاج متابعة": "نعم",
    ...extra,
  };
}

const ANSWERED_BY_COLUMN: FieldSource = { kind: "column", header: REVIEWER_HEADER };
const SUBMITTED_AT_COLUMN: FieldSource = { kind: "column", header: DATE_HEADER };
const UNMAPPED: FieldSource = { kind: "none" };

function planFor(
  rec: AdhocRecord,
  rawValuesByRowKey: Record<string, Record<string, unknown>>,
  submittedAtSource: FieldSource = SUBMITTED_AT_COLUMN
) {
  return planHistoricalImport({
    record: rec,
    schema: templateSchema(),
    answeredBySource: ANSWERED_BY_COLUMN,
    submittedAtSource,
    rawValuesByRowKey,
  });
}

afterEach(() => {
  // The roster is a module-level runtime variable; a test that edits it must not
  // leak that into the next one.
  writeUserManagementState(createEmptyUserManagementState(), false);
  clearErrors();
});

describe("planHistoricalImport", () => {
  it("resolves reviewer, timestamp and template answers per row", () => {
    const rec = record("adh-h1", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);
    const result = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("hihaloraini"),
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toHaveLength(2);
    expect(result.plan[0]).toMatchObject({
      rowKey: "s1:2",
      xrayImageId: namespacedXrayImageId("adh-h1", "XR-1", 0),
      answeredBy: "jalgahamdi",
      submittedAt: "2024-03-05T00:00:00.000Z",
    });
    expect(result.plan[0].answers).toEqual([
      { fieldId: "f-verdict", value: "مطابق" },
      { fieldId: "f-notes", value: "لا توجد ملاحظات" },
      { fieldId: "f-count", value: 12 },
      { fieldId: "f-flag", value: true },
    ]);
  });

  it("normalizes a reviewer name the file spelled in mixed case", () => {
    const rec = record("adh-h2", [row("s1:2", "XR-1")]);
    const result = planFor(rec, { "s1:2": cells("  JAlGahamdi ") });

    expect(result.errors).toEqual([]);
    expect(result.plan[0].answeredBy).toBe("jalgahamdi");
  });

  it("accepts partial template coverage without an error, and says so once", () => {
    const rec = record("adh-h3", [row("s1:2", "XR-1")], {
      mapping: {
        fields: {},
        valueMappings: {},
        // The study predates two of the four questions.
        templateFields: {
          "f-verdict": { kind: "column", header: "النتيجة" },
          "f-notes": { kind: "column", header: "ملاحظات" },
        },
      },
    });
    const result = planFor(rec, { "s1:2": cells("jalgahamdi") });

    expect(result.errors).toEqual([]);
    expect(result.plan[0].answers.map((answer) => answer.fieldId)).toEqual([
      "f-verdict",
      "f-notes",
    ]);
    expect(result.warnings.some((warning) => warning.includes("2 من 4"))).toBe(true);
  });

  it("keeps a row whose cell failed coercion, dropping only that field", () => {
    const rec = record("adh-h4", [row("s1:2", "XR-1")]);
    const result = planFor(rec, {
      "s1:2": cells("jalgahamdi", { "عدد الطرود": "كثيرة" }),
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0].answers.map((answer) => answer.fieldId)).toEqual([
      "f-verdict",
      "f-notes",
      "f-flag",
    ]);
    expect(result.plan[0].warnings).toHaveLength(1);
    expect(result.plan[0].warnings[0]).toContain("عدد الطرود");
    expect(result.warnings.some((warning) => warning.includes("1"))).toBe(true);
  });

  it("falls back to the record's importedAt when no review-date column is mapped, and reports it", () => {
    const rec = record("adh-h5", [row("s1:2", "XR-1")]);
    const result = planFor(rec, { "s1:2": cells("jalgahamdi") }, UNMAPPED);

    expect(result.errors).toEqual([]);
    expect(result.plan[0].submittedAt).toBe(IMPORTED_AT);
    // Import-wide, so it is stated once and NOT repeated on every row.
    expect(result.plan[0].warnings).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes(IMPORTED_AT))).toBe(true);
  });

  it("warns per row when a mapped review-date cell is blank or unreadable", () => {
    const rec = record("adh-h6", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);
    const result = planFor(rec, {
      "s1:2": cells("jalgahamdi", { [DATE_HEADER]: "" }),
      "s1:3": cells("jalgahamdi", { [DATE_HEADER]: "الأسبوع الماضي" }),
    });

    expect(result.errors).toEqual([]);
    expect(result.plan[0].submittedAt).toBe(IMPORTED_AT);
    expect(result.plan[0].warnings).toHaveLength(1);
    expect(result.plan[1].submittedAt).toBe(IMPORTED_AT);
    expect(result.plan[1].warnings[0]).toContain("الأسبوع الماضي");
  });

  it("reads an Excel date serial, and refuses a number that cannot be one", () => {
    const rec = record("adh-h7", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);
    const result = planFor(rec, {
      "s1:2": cells("jalgahamdi", { [DATE_HEADER]: 45351 }),
      "s1:3": cells("jalgahamdi", { [DATE_HEADER]: 7 }),
    });

    expect(result.plan[0].submittedAt).toBe("2024-02-29T00:00:00.000Z");
    // A bare 7 is not a date; it must not become 1970-01-08.
    expect(result.plan[1].submittedAt).toBe(IMPORTED_AT);
  });

  it("refuses a row with no reviewer name rather than attributing it to nobody", () => {
    const rec = record("adh-h8", [row("s1:2", "XR-1"), row("s1:3", "XR-2")]);
    const result = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("   "),
    });

    expect(result.plan).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("s1:3");
  });

  it("reports a reviewer the live roster does not know as a blocking error", () => {
    const rec = record("adh-h9", [row("s1:2", "XR-1")]);
    const result = planFor(rec, { "s1:2": cells("ghost-user") });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("ghost-user");
  });

  it("reports a reviewer deactivated since the study as unknown too", () => {
    writeUserManagementState(
      {
        ...createEmptyUserManagementState(),
        users: createDefaultManagedUsers().map((user) =>
          user.username === "hihaloraini" ? { ...user, isActive: false } : user
        ),
      },
      false
    );
    const rec = record("adh-h10", [row("s1:2", "XR-1")]);
    const result = planFor(rec, { "s1:2": cells("hihaloraini") });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("hihaloraini");
  });

  it("refuses a mapping authored against a different template", () => {
    const rec = record("adh-h11", [row("s1:2", "XR-1")], { templateId: "tpl-other" });
    const result = planFor(rec, { "s1:2": cells("jalgahamdi") });

    expect(result.errors.some((error) => error.includes("tpl-other"))).toBe(true);
  });

  it("skips rows an admin excluded, and reports an import with nothing left", () => {
    const rec = record("adh-h12", [row("s1:2", "XR-1", { excludedByAdmin: true })]);
    const result = planFor(rec, { "s1:2": cells("jalgahamdi") });

    expect(result.plan).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});

describe("applyHistoricalImport", () => {
  it("writes the rows as assigned-and-completed work with the reviewer's answers attached", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-r1", rows));
    const { plan, errors } = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("hihaloraini"),
    });
    expect(errors).toEqual([]);

    const result = await applyHistoricalImport(root, rec, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const monthFolderName = adhocMonthFolder("adh-r1");
    const master = await loadSampleMaster(root, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(root, monthFolderName, master?.rows ?? []);
    expect(current?.entries).toHaveLength(2);
    expect(current?.entries.every((entry) => entry.status === "completed")).toBe(true);
    expect(current?.totalCompleted).toBe(2);
    expect(
      current?.entries.find(
        (entry) => entry.xrayImageId === namespacedXrayImageId("adh-r1", "XR-1", 0)
      )?.assignedTo
    ).toBe("jalgahamdi");

    const answers = await loadEmployeeAnswers(root, monthFolderName, "jalgahamdi");
    expect(answers.items).toHaveLength(1);
    expect(answers.items[0]).toMatchObject({
      xrayImageId: namespacedXrayImageId("adh-r1", "XR-1", 0),
      templateId: "tpl-2026",
      templateVersion: 3,
      status: "submitted",
      submittedAt: "2024-03-05T00:00:00.000Z",
      answeredBy: "jalgahamdi",
    });
    expect(answers.items[0].answers).toHaveLength(4);

    // The other reviewer's answer went to their own file, not this one.
    const other = await loadEmployeeAnswers(root, monthFolderName, "hihaloraini");
    expect(other.items).toHaveLength(1);

    // And the record's own bookkeeping records the assignment.
    const saved = await loadAdhocRecord(root, "adh-r1");
    expect(saved?.rows.every((r) => r.assignments.length === 1)).toBe(true);
  });

  it("stores fewer answers than the template has fields when the study predates them", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(
      root,
      record("adh-r2", rows, {
        mapping: {
          fields: {},
          valueMappings: {},
          templateFields: { "f-verdict": { kind: "column", header: "النتيجة" } },
        },
      })
    );
    const { plan, errors } = planFor(rec, { "s1:2": cells("jalgahamdi") });
    expect(errors).toEqual([]);

    const result = await applyHistoricalImport(root, rec, plan, "admin");
    expect(result.ok).toBe(true);

    const answers = await loadEmployeeAnswers(root, adhocMonthFolder("adh-r2"), "jalgahamdi");
    // Sparse, not padded: three of the four answerable fields are simply absent.
    expect(answers.items[0].answers).toEqual([{ fieldId: "f-verdict", value: "مطابق" }]);
  });

  it("keeps a row whose cell failed coercion, storing every field that did coerce", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-r3", rows));
    const { plan } = planFor(rec, {
      "s1:2": cells("jalgahamdi", { "عدد الطرود": "كثيرة" }),
    });

    const result = await applyHistoricalImport(root, rec, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedCount).toBe(1);

    const answers = await loadEmployeeAnswers(root, adhocMonthFolder("adh-r3"), "jalgahamdi");
    expect(answers.items[0].answers.map((answer) => answer.fieldId)).toEqual([
      "f-verdict",
      "f-notes",
      "f-flag",
    ]);
  });

  it("stores the importedAt fallback when no review-date column was mapped", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-r4", rows));
    const { plan } = planFor(rec, { "s1:2": cells("jalgahamdi") }, UNMAPPED);

    expect(await applyHistoricalImport(root, rec, plan, "admin")).toMatchObject({ ok: true });

    const answers = await loadEmployeeAnswers(root, adhocMonthFolder("adh-r4"), "jalgahamdi");
    expect(answers.items[0].submittedAt).toBe(IMPORTED_AT);
    expect(answers.items[0].lastSavedAt).toBe(IMPORTED_AT);
  });

  it("refuses the whole import for one unknown reviewer, before touching disk", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-r5", rows));
    const { plan, errors } = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("ghost-user"),
    });
    // The pre-flight already said so — this test is about apply refusing too.
    expect(errors).toHaveLength(1);

    clearOperationLog(root);
    const result = await applyHistoricalImport(root, rec, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("غير نشط");

    // Nothing was written at all — not the sample master, not the valid
    // reviewer's half of the batch.
    expect(getOperationLog(root).some((entry) => entry.operation === "createWritable")).toBe(false);
    expect(await loadSampleMaster(root, adhocMonthFolder("adh-r5"))).toBeNull();
    const answers = await loadEmployeeAnswers(root, adhocMonthFolder("adh-r5"), "jalgahamdi");
    expect(answers.items).toEqual([]);
  });

  it("refuses a closed import, using the on-disk status and not the caller's copy", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const stale = await saveAdhocRecord(root, record("adh-r6", rows));
    const { plan } = planFor(stale, { "s1:2": cells("jalgahamdi") });

    // Another machine closes it after this tab rendered its plan.
    await saveAdhocRecord(root, { ...stale, status: "closed", closedBy: "amonem" });

    const result = await applyHistoricalImport(root, stale, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("مغلق");
    expect(await loadSampleMaster(root, adhocMonthFolder("adh-r6"))).toBeNull();
  });

  it("refuses a record that never recorded which template its answers belong to", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(
      root,
      record("adh-r7", rows, { templateId: undefined, templateVersion: undefined })
    );
    const { plan } = planFor(rec, { "s1:2": cells("jalgahamdi") });

    const result = await applyHistoricalImport(root, rec, plan, "admin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("قالب");
    expect(await loadSampleMaster(root, adhocMonthFolder("adh-r7"))).toBeNull();
  });

  it("is a no-op on a re-run: no second event, no duplicated answer", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-r8", rows));
    const { plan } = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("jalgahamdi"),
    });

    const first = await applyHistoricalImport(root, rec, plan, "admin");
    expect(first.ok).toBe(true);

    const monthFolderName = adhocMonthFolder("adh-r8");
    const afterFirst = await loadDistributionLog(root, monthFolderName);
    // One assigned + one completed per row.
    expect(afterFirst.events).toHaveLength(4);

    // Replayed against the STALE record on purpose: a tab that never saw the
    // first commit must not be able to import the study twice.
    const second = await applyHistoricalImport(root, rec, plan, "admin");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("مستوردة بالفعل");

    expect((await loadDistributionLog(root, monthFolderName)).events).toHaveLength(4);
    const answers = await loadEmployeeAnswers(root, monthFolderName, "jalgahamdi");
    expect(answers.items).toHaveLength(2);
    // A second write of the same answer would have snapshotted the first into
    // valueHistory (A4). Nothing was rewritten.
    expect(answers.items.every((item) => item.valueHistory === undefined)).toBe(true);
    const saved = await loadAdhocRecord(root, "adh-r8");
    expect(saved?.rows.every((r) => r.assignments.length === 1)).toBe(true);
  });

  it("writes the sample-master rows before any event references them", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1")];
    const rec = await saveAdhocRecord(root, record("adh-r9", rows));
    const { plan } = planFor(rec, { "s1:2": cells("jalgahamdi") });

    clearOperationLog(root);
    clearErrors();
    expect(await applyHistoricalImport(root, rec, plan, "admin")).toMatchObject({ ok: true });

    const writes = getOperationLog(root)
      .filter((entry) => entry.operation === "createWritable")
      .map((entry) => entry.name);
    const sampleAt = writes.findIndex((name) => name.includes("sample.master.json"));
    const eventAt = writes.findIndex(
      (name) => name.endsWith(".ndjson") || /^evt-.*\.json$/.test(name)
    );
    expect(sampleAt).toBeGreaterThanOrEqual(0);
    expect(eventAt).toBeGreaterThanOrEqual(0);
    expect(sampleAt).toBeLessThan(eventAt);

    // The fold logs absorbed events whose xrayImageId it could not find. If the
    // ordering above ever regressed, the import would still "succeed" and this
    // is what would betray it.
    expect(getRecentErrors().some((entry) => entry.context.includes("fold-absent-row"))).toBe(
      false
    );
  });

  it("repairs a run that wrote the events but not the answers", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const rec = await saveAdhocRecord(root, record("adh-r10", rows));
    const full = planFor(rec, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("jalgahamdi"),
    }).plan;

    // First run covers one row only — the same shape an interrupted run leaves:
    // events and answers on disk for part of the study.
    expect(await applyHistoricalImport(root, rec, [full[0]], "admin")).toMatchObject({ ok: true });

    const second = await applyHistoricalImport(root, rec, full, "admin");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.importedCount).toBe(1);
    expect(second.skippedCount).toBe(1);

    const monthFolderName = adhocMonthFolder("adh-r10");
    expect((await loadDistributionLog(root, monthFolderName)).events).toHaveLength(4);
    const answers = await loadEmployeeAnswers(root, monthFolderName, "jalgahamdi");
    expect(answers.items).toHaveLength(2);
    expect(answers.items.every((item) => item.valueHistory === undefined)).toBe(true);
  });

  it("ignores a plan entry for a row another machine excluded meanwhile", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rows = [row("s1:2", "XR-1"), row("s1:3", "XR-2")];
    const stale = await saveAdhocRecord(root, record("adh-r11", rows));
    const { plan } = planFor(stale, {
      "s1:2": cells("jalgahamdi"),
      "s1:3": cells("jalgahamdi"),
    });

    await saveAdhocRecord(root, {
      ...stale,
      rows: stale.rows.map((r) => (r.rowKey === "s1:2" ? { ...r, excludedByAdmin: true } : r)),
    });

    const result = await applyHistoricalImport(root, stale, plan, "admin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedCount).toBe(1);

    const answers = await loadEmployeeAnswers(root, adhocMonthFolder("adh-r11"), "jalgahamdi");
    expect(answers.items.map((item) => item.xrayImageId)).toEqual([
      namespacedXrayImageId("adh-r11", "XR-2", 0),
    ]);
    // The exclusion survived the whole-document save.
    const saved = await loadAdhocRecord(root, "adh-r11");
    expect(saved?.rows.find((r) => r.rowKey === "s1:2")?.excludedByAdmin).toBe(true);
  });

  it("refuses an empty plan rather than writing an empty sample master", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    const rec = await saveAdhocRecord(root, record("adh-r12", [row("s1:2", "XR-1")]));

    const result = await applyHistoricalImport(root, rec, [], "admin");
    expect(result.ok).toBe(false);
    expect(await loadSampleMaster(root, adhocMonthFolder("adh-r12"))).toBeNull();
  });
});
