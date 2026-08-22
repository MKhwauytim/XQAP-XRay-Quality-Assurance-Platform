/* @vitest-environment jsdom */
// The `kind: "historical"` path through the ad-hoc import wizard: a study the
// department carried out BEFORE the app existed, arriving as one spreadsheet
// that holds both the sample columns and the answers a reviewer already
// recorded.
//
// The data layer (src/data/adhocImport/adhocHistoricalImport.ts) was built and
// tested first and had no caller at all; these tests are about the wiring —
// that the template picker appears, that the template's own fields are mappable
// and auto-detected, that an unresolvable reviewer blocks the write with the
// offending value on screen, and that a successful run really lands as
// assigned+completed work with answers in the reviewer's own file.
//
// auth/usePermissions and auth/userManagement are left REAL (driven through a
// real session, as index.test.tsx does) so the permission behavior reflects the
// shipped matrix rather than a stand-in.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { DEFAULT_LABELS as L } from "../../../../data/labels/labelsStore";
import { saveTemplate } from "../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../data/templates/templateTypes";
import {
  loadAdhocImportIndex,
  saveAdhocRecord,
} from "../../../../data/adhocImport/adhocImportStorage";
import { ADHOC_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import {
  adhocMonthFolder,
  PASTE_SHEET_NAME,
} from "../../../../data/adhocImport/adhocImportModel";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
import { loadEmployeeAnswers } from "../../../../data/answers/answerStorage";

const testDir: DirectoryHandleLike = createMemoryDirectory("adhoc-historical-test-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

const TEMPLATE_ID = "tpl-hist-2026";
const PHASE_ONE = "المرحلة الأولى";
const PHASE_TWO = "المرحلة الثانية";

/**
 * Three answerable fields across two phases, one of which ("عدد الطرود") the
 * source file does NOT carry — partial coverage is the normal state of an
 * honest historical file, so it is baked into the fixture rather than tested as
 * an edge case.
 */
function templateSchema(): TemplateSchema {
  const at = "2026-08-01T00:00:00.000Z";
  return {
    templateId: TEMPLATE_ID,
    templateName: "نموذج الفحص",
    version: 4,
    createdAt: at,
    createdBy: "admin",
    updatedAt: at,
    updatedBy: "admin",
    phases: [
      { phaseId: "ph-1", title: PHASE_ONE, order: 1 },
      { phaseId: "ph-2", title: PHASE_TWO, order: 2 },
    ],
    fields: [
      {
        fieldId: "f-verdict",
        phaseId: "ph-1",
        label: "النتيجة",
        type: "dropdown",
        required: true,
        options: ["مطابق", "غير مطابق"],
        order: 1,
      },
      {
        fieldId: "f-notes",
        phaseId: "ph-1",
        label: "ملاحظات",
        type: "text",
        required: false,
        options: [],
        order: 2,
      },
      {
        fieldId: "f-count",
        phaseId: "ph-2",
        label: "عدد الطرود",
        type: "number",
        required: false,
        options: [],
        order: 3,
      },
    ],
  };
}

const REVIEWER_HEADER = "المراجع";
const DATE_HEADER = "تاريخ المراجعة";

/** Two rows, two different reviewers, and no "عدد الطرود" column. */
function tsv(firstReviewer: string, secondReviewer: string): string {
  return [
    ["معرف الأشعة", REVIEWER_HEADER, DATE_HEADER, "النتيجة", "ملاحظات"].join("\t"),
    ["XR-1", firstReviewer, "2024-03-05", "مطابق", "لا توجد ملاحظات"].join("\t"),
    ["XR-2", secondReviewer, "2024-03-06", "غير مطابق", "أعيد الفحص"].join("\t"),
  ].join("\n");
}

const GOOD_TSV = tsv("jalgahamdi", "hihaloraini");

beforeAll(async () => {
  await saveTemplate(testDir, templateSchema());
  await saveInspectionTemplateSelection(testDir, {
    templateId: TEMPLATE_ID,
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "admin",
  });
});

afterEach(() => {
  cleanup();
  clearSession();
});

async function renderTab() {
  writeSession({ role: "admin", username: "admin-user", loginAt: new Date().toISOString() });
  const { default: AdhocImportTab } = await import("./index");
  return render(<AdhocImportTab />);
}

function declareConstant(fieldLabel: string, value: string): void {
  fireEvent.click(
    screen.getByLabelText(L.adhoc_map_constant_toggle_aria.replace("{field}", fieldLabel))
  );
  fireEvent.change(
    screen.getByLabelText(L.adhoc_map_constant_aria.replace("{field}", fieldLabel)),
    { target: { value } }
  );
}

/** New import → paste the study → declare it a historical import, and wait for the proposed template. */
async function startHistoricalWizard(table = GOOD_TSV): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: L.adhoc_wizard_new_import }));
  fireEvent.click(screen.getByLabelText(L.adhoc_source_mode_paste));
  fireEvent.paste(screen.getByLabelText(L.adhoc_paste_aria), {
    clipboardData: { getData: () => `${table}\n` },
  });
  fireEvent.change(screen.getByLabelText(L.adhoc_kind_label), {
    target: { value: "historical" },
  });
  await waitFor(() => {
    const picker = screen.getByLabelText(L.adhoc_hist_template_select_aria) as HTMLSelectElement;
    expect(picker.value).toBe(TEMPLATE_ID);
  });
}

/** Step 1 → step 2, and wait for both halves of the mapping screen. */
async function goToMapping(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));
  await screen.findByRole("heading", { name: L.adhoc_map_title });
  await screen.findByRole("heading", { name: L.adhoc_hist_map_title });
}

/** Everything step 2 needs: the two result constants plus the provenance columns. */
function completeMapping(): void {
  declareConstant("نتيجة المستوى الأول", "سليمة");
  declareConstant("نتيجة المستوى الثاني", "سليمة");
  fireEvent.change(screen.getByLabelText(L.adhoc_hist_answered_by_aria), {
    target: { value: REVIEWER_HEADER },
  });
  fireEvent.change(screen.getByLabelText(L.adhoc_hist_submitted_at_aria), {
    target: { value: DATE_HEADER },
  });
}

async function goToReview(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));
  await screen.findByRole("heading", { name: L.adhoc_hist_panel_title });
}

/** The whole happy path, stopping just before the commit. */
async function walkToHistoricalReview(table = GOOD_TSV): Promise<void> {
  await renderTab();
  await startHistoricalWizard(table);
  await goToMapping();
  completeMapping();
  await goToReview();
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

async function importIdsOnDisk(): Promise<string[]> {
  const index = await loadAdhocImportIndex(testDir);
  return index.map((entry) => entry.importId);
}

describe("AdhocImportTab — historical kind reveals its own controls", () => {
  it("shows no template picker until the import is declared historical", async () => {
    await renderTab();
    fireEvent.click(await screen.findByRole("button", { name: L.adhoc_wizard_new_import }));

    expect(screen.queryByLabelText(L.adhoc_hist_template_select_aria)).toBeNull();

    fireEvent.change(screen.getByLabelText(L.adhoc_kind_label), {
      target: { value: "historical" },
    });

    // The workspace's active inspection template is proposed, so the common
    // case needs no second decision.
    await waitFor(() => {
      const picker = screen.getByLabelText(L.adhoc_hist_template_select_aria) as HTMLSelectElement;
      expect(picker.value).toBe(TEMPLATE_ID);
    });
  });

  it("adds the template-field mapping section to step 2, grouped by phase and auto-detected", async () => {
    await renderTab();
    await startHistoricalWizard();
    await goToMapping();

    // Grouped by the template's own phases.
    expect(screen.getByText(PHASE_ONE)).toBeInTheDocument();
    expect(screen.getByText(PHASE_TWO)).toBeInTheDocument();

    // Auto-detection matched the two fields the file actually carries…
    const verdict = screen.getByLabelText(
      L.adhoc_hist_map_field_aria.replace("{field}", "النتيجة")
    ) as HTMLSelectElement;
    expect(verdict.value).toBe("النتيجة");
    const notes = screen.getByLabelText(
      L.adhoc_hist_map_field_aria.replace("{field}", "ملاحظات")
    ) as HTMLSelectElement;
    expect(notes.value).toBe("ملاحظات");

    // …and left the one it does not as an explicit "not imported", which is the
    // expected state for a study older than the field.
    const count = screen.getByLabelText(
      L.adhoc_hist_map_field_aria.replace("{field}", "عدد الطرود")
    ) as HTMLSelectElement;
    expect(count.value).toBe("");

    expect(
      screen.getByText(fill(L.adhoc_hist_map_coverage, { mapped: "2", total: "3" }))
    ).toBeInTheDocument();
  });

  it("says so when no review-date column is mapped instead of defaulting silently", async () => {
    await renderTab();
    await startHistoricalWizard();
    await goToMapping();

    // Nothing auto-detects the date column, so the fallback note is up front…
    expect(
      screen.getByText((content) => content.startsWith("لم يُربط عمود تاريخ المراجعة"))
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(L.adhoc_hist_submitted_at_aria), {
      target: { value: DATE_HEADER },
    });

    // …and gone once a real column answers the question.
    expect(
      screen.queryByText((content) => content.startsWith("لم يُربط عمود تاريخ المراجعة"))
    ).toBeNull();
  });
});

describe("AdhocImportTab — historical pre-flight", () => {
  it("blocks the import and names a reviewer the roster cannot resolve", async () => {
    await walkToHistoricalReview(tsv("jalgahamdi", "ghost-reviewer"));

    // The offending value itself is on screen — "one of the reviewers is
    // unknown" would leave the admin to find which.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ghost-reviewer");
    expect(alert.textContent).toContain(L.adhoc_hist_plan_errors_title);

    expect(screen.getByRole("button", { name: L.adhoc_hist_import_button })).toBeDisabled();

    // …and nothing was written on the way to finding out.
    const answers = await loadEmployeeAnswers(
      testDir,
      adhocMonthFolder((await importIdsOnDisk())[0] ?? "none"),
      "jalgahamdi"
    );
    expect(answers.items.some((item) => item.xrayImageId.includes("XR-1"))).toBe(false);
  });

  it("reports the plan — rows, reviewers, answers — before anything is written", async () => {
    await walkToHistoricalReview();

    expect(
      screen.getByText(fill(L.adhoc_hist_plan_rows, { count: "2" }))
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(L.adhoc_hist_plan_reviewers, { count: "2" }))
    ).toBeInTheDocument();
    // Two answers per row: the file covers "النتيجة" and "ملاحظات" only.
    expect(
      screen.getByText(fill(L.adhoc_hist_plan_answers, { answers: "4", perRow: "2.0" }))
    ).toBeInTheDocument();

    // Partial coverage is reported as a NOTE, not an error: no alert is raised
    // and the button stays live.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(L.adhoc_hist_plan_warnings_title)).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("يغطي الملف 2 من 3"))
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: L.adhoc_hist_import_button })).not.toBeDisabled();
  });

  it("surfaces a per-row coercion warning without dropping the row", async () => {
    // "كثيرة" is not a number, so that one cell is skipped — and only that cell.
    const table = [
      ["معرف الأشعة", REVIEWER_HEADER, DATE_HEADER, "النتيجة", "عدد الطرود"].join("\t"),
      ["XR-9", "jalgahamdi", "2024-03-05", "مطابق", "كثيرة"].join("\t"),
    ].join("\n");
    await walkToHistoricalReview(table);

    expect(screen.getByText(L.adhoc_hist_row_warnings_title)).toBeInTheDocument();
    expect(
      screen.getByText(
        (content) => content.includes(`${PASTE_SHEET_NAME}:2`) && content.includes("عدد الطرود")
      )
    ).toBeInTheDocument();
    // Still one importable row, and still no error.
    expect(screen.getByText(fill(L.adhoc_hist_plan_rows, { count: "1" }))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AdhocImportTab — committing a historical import", () => {
  it("imports the study as assigned+completed work, with answers in each reviewer's own file", async () => {
    const before = new Set(await importIdsOnDisk());
    await walkToHistoricalReview();

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_hist_import_button }));

    // The summary reports what was written…
    expect(
      await screen.findByText(fill(L.adhoc_hist_import_success, { count: "2" }))
    ).toBeInTheDocument();
    // …and the warnings survive the write rather than being cleared by success.
    expect(
      screen.getByText((content) => content.includes("يغطي الملف 2 من 3"))
    ).toBeInTheDocument();

    const importId = (await importIdsOnDisk()).find((id) => !before.has(id));
    expect(importId).toBeDefined();
    const monthFolderName = adhocMonthFolder(importId!);

    // The distribution log really carries the pair: both rows owned and terminal.
    const master = await loadSampleMaster(testDir, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(
      testDir,
      monthFolderName,
      master?.rows ?? []
    );
    expect(current?.entries).toHaveLength(2);
    expect(current?.entries.every((entry) => entry.status === "completed")).toBe(true);
    expect(current?.entries.map((entry) => entry.assignedTo).sort()).toEqual([
      "hihaloraini",
      "jalgahamdi",
    ]);

    // And each reviewer's answers are readable from their OWN file, sparse by
    // design — two of the template's three answerable fields, not three.
    const first = await loadEmployeeAnswers(testDir, monthFolderName, "jalgahamdi");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      templateId: TEMPLATE_ID,
      templateVersion: 4,
      status: "submitted",
      answeredBy: "jalgahamdi",
      // The study's own clock, not the import's.
      submittedAt: "2024-03-05T00:00:00.000Z",
    });
    expect(first.items[0].answers).toEqual([
      { fieldId: "f-verdict", value: "مطابق" },
      { fieldId: "f-notes", value: "لا توجد ملاحظات" },
    ]);

    const second = await loadEmployeeAnswers(testDir, monthFolderName, "hihaloraini");
    expect(second.items).toHaveLength(1);
    expect(second.items[0].answers).toEqual([
      { fieldId: "f-verdict", value: "غير مطابق" },
      { fieldId: "f-notes", value: "أعيد الفحص" },
    ]);
  });

  it("re-running the same import writes nothing new and says so", async () => {
    await walkToHistoricalReview();

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_hist_import_button }));
    await screen.findByText(fill(L.adhoc_hist_import_success, { count: "2" }));

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_hist_import_button }));

    // Two-signal idempotency: events AND answers are already there, so the
    // second run reports a refusal rather than duplicating the work.
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "كل الصفوف المحددة مستوردة بالفعل"
      );
    });
  });
});

describe("AdhocImportTab — historical import re-opened from the list", () => {
  it("explains why it cannot be planned instead of showing an empty plan", async () => {
    // `AdhocRow` persists only its MAPPED values, so the answer cells a
    // historical plan reads are gone once the session that parsed them is. The
    // screen has to say that rather than silently offer nothing to import.
    await saveAdhocRecord(testDir, {
      importId: "adh-reopened",
      schemaVersion: 2,
      fileName: "study-reopened.xlsx",
      importedBy: "admin-user",
      importedAt: "2026-08-20T09:00:00.000Z",
      status: "open",
      kind: "historical",
      sourceKind: "file",
      mapping: {
        fields: {},
        valueMappings: {},
        templateFields: { "f-verdict": { kind: "column", header: "النتيجة" } },
        answeredBySource: { kind: "column", header: REVIEWER_HEADER },
        submittedAtSource: { kind: "column", header: DATE_HEADER },
      },
      fieldCatalog: ADHOC_FIELD_CATALOG,
      monthBinding: { kind: "isolated" },
      templateId: TEMPLATE_ID,
      templateVersion: 4,
      rows: [
        {
          rowKey: `${PASTE_SHEET_NAME}:2`,
          mapped: {
            xrayImageId: "XR-9",
            xrayLevelOneResult: "سليمة",
            xrayLevelTwoResult: "سليمة",
          },
          validation: { valid: true },
          excludedByAdmin: false,
          assignments: [],
        },
      ],
    });

    await renderTab();
    fireEvent.click((await screen.findByText("study-reopened.xlsx")).closest("tr")!);

    expect(await screen.findByText(L.adhoc_hist_no_source)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: L.adhoc_hist_import_button })).toBeDisabled();
  });
});

describe("AdhocImportTab — historical permission gating", () => {
  it("hides the import control from a session without adhoc-import.assign", async () => {
    // The commit appends assigned+completed events to the distribution log and
    // writes into another user's answer file, so it is gated on the ASSIGN
    // capability, which manager does not hold by default.
    writeSession({ role: "manager", username: "manager-user", loginAt: new Date().toISOString() });
    const { default: AdhocImportTab } = await import("./index");
    render(<AdhocImportTab />);

    expect(await screen.findByRole("button", { name: L.adhoc_wizard_new_import })).toBeDisabled();
    expect(screen.queryByRole("button", { name: L.adhoc_hist_import_button })).toBeNull();
  });
});
