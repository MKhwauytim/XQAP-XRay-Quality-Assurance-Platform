/* @vitest-environment jsdom */
// Permission-gating coverage for the ad-hoc import tab (owner requirement, 2026-08):
// the tab is admin-only (see tabCatalog.ts's ADMIN_ONLY ceiling + userManagement.ts's
// "adhoc-import" default permission rows). auth/usePermissions and auth/userManagement
// are left REAL (driven through a real session via writeSession/clearSession, like
// Archive/index.test.tsx) so this reflects the actual shipped default matrix instead of
// a hand-rolled stand-in that could silently drift from it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import type { AuthRole } from "../../../../auth/authTypes";
import {
  createDefaultManagedUsers,
  createManagedUser,
  readUserManagementState,
  writeUserManagementState,
} from "../../../../auth/userManagement";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { ensureAdhocSampleMaster } from "../../../../data/adhocImport/adhocImportAssignment";
import { saveAdhocImportRecord } from "../../../../data/adhocImport/adhocImportStorage";
import type { AdhocImportRecord, AdhocImportRow } from "../../../../data/adhocImport/adhocImportTypes";
import type { NormalizedRiskRow } from "../Population/riskData/riskDataTypes";

const testDir: DirectoryHandleLike = createMemoryDirectory("adhoc-import-test-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

afterEach(() => {
  cleanup();
  clearSession();
});

function mappedRow(xrayImageId: string): NormalizedRiskRow {
  return {
    movementType: "s1", portCode: null, portName: "ميناء جدة", portType: "بحري",
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
    sourceSheetName: "s1", sourceRowNumber: 2,
  };
}

async function seedOpenImport(importId: string): Promise<void> {
  const row: AdhocImportRow = {
    rowKey: "s1:2",
    mapped: mappedRow("XR-1"),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
  const record: AdhocImportRecord = {
    importId,
    fileName: `${importId}.xlsx`,
    importedBy: "admin-user",
    importedAt: new Date().toISOString(),
    status: "open",
    rows: [row],
  };
  const saved = await saveAdhocImportRecord(testDir, record);
  await ensureAdhocSampleMaster(testDir, saved);
}

async function renderTab(role: AuthRole) {
  writeSession({ role, username: `${role}-user`, loginAt: new Date().toISOString() });
  const { default: AdhocImportTab } = await import("./index");
  return render(<AdhocImportTab />);
}

describe("AdhocImportTab — permission gating", () => {
  it("disables the upload control for a guest session (default page access = none)", async () => {
    await renderTab("guest");
    const button = screen.getByRole("button", { name: /رفع ومعالجة/ });
    expect(button).toBeDisabled();
    const fileInput = document.getElementById("adhoc-import-file");
    expect(fileInput).toBeDisabled();
  });

  it("disables the upload control for a manager session (tab is admin-only, not manager)", async () => {
    // Managers have broad population/reports edit rights elsewhere, but the ad-hoc
    // import tab's role ceiling is ADMIN_ONLY (tabCatalog.ts) and its default page
    // permission is "none" for manager — this is the regression this test guards.
    await renderTab("manager");
    const button = screen.getByRole("button", { name: /رفع ومعالجة/ });
    expect(button).toBeDisabled();
  });

  it("enables the upload control for an admin session", async () => {
    await renderTab("admin");
    const button = screen.getByRole("button", { name: /رفع ومعالجة/ });
    expect(button).not.toBeDisabled();
    const fileInput = document.getElementById("adhoc-import-file");
    expect(fileInput).not.toBeDisabled();
  });

  it("renders the page title and scope note for an admin session", async () => {
    await renderTab("admin");
    expect(await screen.findByRole("heading", { level: 1, name: "استيراد بيانات مخصص" })).toBeInTheDocument();
    expect(screen.getByText(/1-population/)).toBeInTheDocument();
  });
});

// Audit finding 6: the assignment dropdown used to be a mount-time-only
// `useMemo(...,[])` snapshot of the managed-user roster, so a user added
// after the tab mounted never appeared as an assignable option until a full
// remount -- and, separately, assignAdhocRowsToEmployee accepted whatever
// string the (possibly stale) dropdown produced with no re-validation.
describe("AdhocImportTab — live assignee roster (audit finding 6)", () => {
  it("adds a newly-created active employee to the assignment dropdown without remounting", async () => {
    const savedState = readUserManagementState();
    try {
      await seedOpenImport("adh-live-1");
      await renderTab("admin");

      const row = await screen.findByText("adh-live-1.xlsx");
      fireEvent.click(row.closest("tr")!);

      const select = await screen.findByLabelText("تعيين إلى موظف");
      const optionsBefore = within(select).getAllByRole("option").map((o) => o.textContent);
      expect(optionsBefore.some((t) => t?.includes("new-live-employee"))).toBe(false);

      const newUser = createManagedUser({
        username: "new-live-employee",
        displayName: "موظف جديد",
        role: "employee",
        passwordHash: savedState.users[0].passwordHash,
        isActive: true,
      });
      act(() => {
        writeUserManagementState({
          ...savedState,
          users: [...savedState.users, newUser],
        });
      });

      await waitFor(() => {
        const optionsAfter = within(select).getAllByRole("option").map((o) => o.textContent);
        expect(optionsAfter.some((t) => t?.includes("new-live-employee"))).toBe(true);
      });
    } finally {
      writeUserManagementState(savedState);
    }
  });

  it("drops a deactivated employee from the assignment dropdown without remounting", async () => {
    const savedState = readUserManagementState();
    try {
      await seedOpenImport("adh-live-2");
      // jalgahamdi is a default active employee -- present in the roster from the start.
      const employeeUsername = createDefaultManagedUsers().find((u) => u.username === "jalgahamdi")!.username;

      await renderTab("admin");
      const row = await screen.findByText("adh-live-2.xlsx");
      fireEvent.click(row.closest("tr")!);

      const select = await screen.findByLabelText("تعيين إلى موظف");
      await waitFor(() => {
        expect(within(select).getAllByRole("option").some((o) => o.textContent?.includes(employeeUsername))).toBe(true);
      });

      act(() => {
        writeUserManagementState({
          ...savedState,
          users: savedState.users.map((u) => (u.username === employeeUsername ? { ...u, isActive: false } : u)),
        });
      });

      await waitFor(() => {
        expect(within(select).getAllByRole("option").some((o) => o.textContent?.includes(employeeUsername))).toBe(false);
      });
    } finally {
      writeUserManagementState(savedState);
    }
  });
});
