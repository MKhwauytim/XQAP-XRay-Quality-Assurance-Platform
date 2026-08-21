/* @vitest-environment jsdom */
// The ad-hoc import tab as of the revision-2 rework: an imports LIST as the
// landing screen, and a three-step wizard (المصدر → مطابقة الأعمدة → المراجعة
// والتعيين) behind "استيراد جديد".
//
// auth/usePermissions and auth/userManagement are left REAL (driven through a
// real session via writeSession/clearSession, like Archive/index.test.tsx) so the
// permission assertions reflect the actual shipped default matrix instead of a
// hand-rolled stand-in that could silently drift from it. The page is admin-only:
// as of 2026-08-21 it is Population's `population/adhoc-import` SUB-TAB, whose own
// ADMIN_ONLY ceiling (tabCatalog.ts) plus the shipped `adhoc-import.ingest` /
// `adhoc-import.assign` feature defaults (both off for every managed role) keep it
// closed. This module exports only a default component -- no `tabConfig` -- so
// tabRegistry.ts does not resurrect it as a top-level tab.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import type { AuthRole } from "../../../../auth/authTypes";
import {
  createManagedUser,
  readUserManagementState,
  writeUserManagementState,
} from "../../../../auth/userManagement";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { DEFAULT_LABELS as L } from "../../../../data/labels/labelsStore";
import { ADHOC_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import { saveAdhocRecord } from "../../../../data/adhocImport/adhocImportStorage";
import type { AdhocRecord, AdhocRow } from "../../../../data/adhocImport/adhocImportModel";

const testDir: DirectoryHandleLike = createMemoryDirectory("adhoc-import-test-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

afterEach(() => {
  cleanup();
  clearSession();
});

/** Two columns and no result column — the "bare image list" shape the constant escape hatch exists for. */
const TSV = [
  "معرف الأشعة\tاسم المنفذ",
  "XR-1\tميناء جدة",
  "XR-2\tميناء الدمام",
].join("\n");

function seededRow(index: number): AdhocRow {
  return {
    rowKey: `s1:${index}`,
    mapped: {
      xrayImageId: `XR-${index}`,
      portName: "ميناء جدة",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "اشتباه",
    },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

async function seedOpenImport(importId: string): Promise<void> {
  const record: AdhocRecord = {
    importId,
    schemaVersion: 2,
    fileName: `${importId}.xlsx`,
    importedBy: "admin-user",
    importedAt: new Date().toISOString(),
    status: "open",
    kind: "sample",
    sourceKind: "file",
    mapping: { fields: {}, valueMappings: {} },
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    rows: [seededRow(2), seededRow(3)],
  };
  await saveAdhocRecord(testDir, record);
}

async function renderTab(role: AuthRole) {
  writeSession({ role, username: `${role}-user`, loginAt: new Date().toISOString() });
  const { default: AdhocImportTab } = await import("./index");
  return render(<AdhocImportTab />);
}

/** Walks the wizard as far as its paste source: new import → paste mode → TSV on the clipboard. */
async function startPasteWizard(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: L.adhoc_wizard_new_import }));
  fireEvent.click(screen.getByLabelText(L.adhoc_source_mode_paste));
  fireEvent.paste(screen.getByLabelText(L.adhoc_paste_aria), {
    clipboardData: { getData: () => `${TSV}\n` },
  });
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

describe("AdhocImportTab — list and review", () => {
  it("renders the page header and the imports list", async () => {
    await seedOpenImport("adh-list-1");
    await renderTab("admin");

    expect(
      await screen.findByRole("heading", { level: 1, name: L.page_adhoc_import_title })
    ).toBeInTheDocument();
    expect(await screen.findByText("adh-list-1.xlsx")).toBeInTheDocument();
  });

  it("opening an import from the list goes straight to the review step", async () => {
    await seedOpenImport("adh-list-2");
    await renderTab("admin");

    const cell = await screen.findByText("adh-list-2.xlsx");
    fireEvent.click(cell.closest("tr")!);

    // The review step: its note, its row summary and the assignment panel.
    expect(await screen.findByText(L.adhoc_review_note)).toBeInTheDocument();
    expect(
      screen.getByText(
        L.adhoc_review_summary
          .replace("{total}", "2")
          .replace("{valid}", "2")
          .replace("{invalid}", "0")
          .replace("{excluded}", "0")
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: L.adhoc_assign_title })).toBeInTheDocument();
    // An existing import has no source tables to re-map, so no wizard rail.
    expect(screen.queryByRole("button", { name: L.adhoc_wizard_next })).toBeNull();
  });

  it("an isolated import reports that it links to no month", async () => {
    await seedOpenImport("adh-list-3");
    await renderTab("admin");
    fireEvent.click((await screen.findByText("adh-list-3.xlsx")).closest("tr")!);

    expect(await screen.findByText(L.adhoc_review_linked_none)).toBeInTheDocument();
  });
});

describe("AdhocImportTab — wizard progression", () => {
  it("walks المصدر → مطابقة الأعمدة → المراجعة والتعيين", async () => {
    await renderTab("admin");
    await startPasteWizard();

    // Step 1: the source is loaded, so "next" is live.
    const next = screen.getByRole("button", { name: L.adhoc_wizard_next });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);

    // Step 2: the mapping workbench, with the file's own headers on the grid.
    expect(await screen.findByRole("heading", { name: L.adhoc_map_title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "اسم المنفذ" })).toBeInTheDocument();

    declareConstant("نتيجة المستوى الأول", "سليمة");
    declareConstant("نتيجة المستوى الثاني", "اشتباه");

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));

    // Step 3: both pasted rows projected and reviewable.
    expect(await screen.findByText(L.adhoc_review_note)).toBeInTheDocument();
    expect(
      screen.getByText(
        L.adhoc_review_summary
          .replace("{total}", "2")
          .replace("{valid}", "2")
          .replace("{invalid}", "0")
          .replace("{excluded}", "0")
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: L.adhoc_assign_title })).toBeInTheDocument();
  });

  it("blocks step 2 → 3 while a required field is unmapped, and the constant unblocks it", async () => {
    await renderTab("admin");
    await startPasteWizard();
    fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));

    // The pasted file carries no result column, so both required result fields
    // are unmapped after auto-detection.
    await screen.findByRole("heading", { name: L.adhoc_map_title });
    expect(screen.getByRole("button", { name: L.adhoc_wizard_next })).toBeDisabled();
    expect(screen.getByText(L.adhoc_wizard_blocked_required)).toBeInTheDocument();
    // …and the escape hatch is named on screen rather than left to be discovered.
    expect(screen.getByText(L.adhoc_map_result_constant_hint)).toBeInTheDocument();

    declareConstant("نتيجة المستوى الأول", "سليمة");
    // One of the two is still unmapped — still blocked.
    expect(screen.getByRole("button", { name: L.adhoc_wizard_next })).toBeDisabled();

    declareConstant("نتيجة المستوى الثاني", "اشتباه");
    expect(screen.getByRole("button", { name: L.adhoc_wizard_next })).not.toBeDisabled();
    expect(screen.queryByText(L.adhoc_map_result_constant_hint)).toBeNull();
  });

  it("keeps a hand-edited mapping when stepping back from the review step", async () => {
    await renderTab("admin");
    await startPasteWizard();
    fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));
    await screen.findByRole("heading", { name: L.adhoc_map_title });
    declareConstant("نتيجة المستوى الأول", "سليمة");
    declareConstant("نتيجة المستوى الثاني", "اشتباه");
    fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_next }));
    await screen.findByText(L.adhoc_review_note);

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_wizard_back }));

    // Auto-detection must not run back over a mapping a person has edited.
    expect(
      await screen.findByText(L.adhoc_map_constant_binding.replace("{value}", "سليمة"))
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: L.adhoc_wizard_next })).not.toBeDisabled();
  });

  it("offers the month-binding controls on step 1", async () => {
    await renderTab("admin");
    fireEvent.click(await screen.findByRole("button", { name: L.adhoc_wizard_new_import }));

    // Isolated is the default; picking "من عمود" reveals the field picker.
    expect(screen.getByLabelText(L.adhoc_binding_isolated)).toBeChecked();
    fireEvent.click(screen.getByLabelText(L.adhoc_binding_column));
    const fieldSelect = await screen.findByLabelText(L.adhoc_binding_column_select_aria);
    expect(within(fieldSelect).getAllByRole("option").length).toBeGreaterThan(0);
  });
});

describe("AdhocImportTab — permission gating", () => {
  it("disables the new-import control for a guest session (default page access = none)", async () => {
    await renderTab("guest");
    expect(await screen.findByRole("button", { name: L.adhoc_wizard_new_import })).toBeDisabled();
  });

  it("disables the new-import control for a manager session (tab is admin-only)", async () => {
    // Managers have broad population/reports edit rights elsewhere, but the ad-hoc
    // import tab's role ceiling is ADMIN_ONLY (tabCatalog.ts) and its default page
    // permission is "none" for manager — this is the regression this test guards.
    await renderTab("manager");
    expect(await screen.findByRole("button", { name: L.adhoc_wizard_new_import })).toBeDisabled();
  });

  it("enables the new-import control for an admin session", async () => {
    await renderTab("admin");
    expect(
      await screen.findByRole("button", { name: L.adhoc_wizard_new_import })
    ).not.toBeDisabled();
  });

  it("hides the assign and save controls on an opened import without the capabilities", async () => {
    await seedOpenImport("adh-denied-1");
    await renderTab("manager");
    fireEvent.click((await screen.findByText("adh-denied-1.xlsx")).closest("tr")!);

    await screen.findByText(L.adhoc_review_note);
    expect(screen.queryByRole("button", { name: L.adhoc_assign_submit })).toBeNull();
    expect(screen.queryByRole("button", { name: L.adhoc_review_save_button })).toBeNull();
    expect(screen.queryByRole("button", { name: L.adhoc_import_close_button })).toBeNull();
  });
});

// Audit finding 6: the assignment dropdown used to be a mount-time-only
// `useMemo(...,[])` snapshot of the managed-user roster, so a user added after
// the tab mounted never appeared as an assignable option until a full remount.
describe("AdhocImportTab — live assignee roster (audit finding 6)", () => {
  it("adds a newly-created active employee to the assignment dropdown without remounting", async () => {
    const savedState = readUserManagementState();
    try {
      await seedOpenImport("adh-live-1");
      await renderTab("admin");

      fireEvent.click((await screen.findByText("adh-live-1.xlsx")).closest("tr")!);
      const select = await screen.findByLabelText(L.adhoc_import_assign_to_label);
      expect(
        within(select).getAllByRole("option").some((o) => o.textContent?.includes("new-live-employee"))
      ).toBe(false);

      const newUser = createManagedUser({
        username: "new-live-employee",
        displayName: "موظف جديد",
        role: "employee",
        passwordHash: savedState.users[0].passwordHash,
        isActive: true,
      });
      act(() => {
        writeUserManagementState({ ...savedState, users: [...savedState.users, newUser] });
      });

      await waitFor(() => {
        expect(
          within(select)
            .getAllByRole("option")
            .some((o) => o.textContent?.includes("new-live-employee"))
        ).toBe(true);
      });
    } finally {
      writeUserManagementState(savedState);
    }
  });
});
