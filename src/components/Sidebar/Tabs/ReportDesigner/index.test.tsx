/* @vitest-environment jsdom */
// B6 — ReportDesigner permission gating: a supervisor with view-only access to
// reports/report-designer (canMutate("report-designer.edit") === false, but tab *view*
// access true — the default permission matrix, TabGuard already enforces it one level up
// in Reports/index.tsx) must be able to browse and open saved designs and reach print,
// while create/save/delete stay blocked. A role with edit access must retain full
// functionality. Also covers the "آخر تعديل" date digit-locale fix (Latin, not
// Arabic-Indic digits).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createEmptyDocument } from "../../../../data/reportDesigner/reportTypes";
import { saveDesign } from "../../../../data/reportDesigner/storage/reportDesignStorage";

// Mutable module-level flag so each test can pick view-only vs edit access (mirrors the
// pattern already used in Reports/index.test.tsx's globalMonthMock).
const permissionsMock = vi.hoisted(() => ({ state: { canEdit: false } }));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    role: "supervisor",
    username: "tester",
    // TabGuard (Reports/index.tsx, one level up, not owned by this bucket) already
    // enforces reports/report-designer view access before this component ever mounts —
    // simulate that "always reachable once we're here" contract.
    canAccessTab: () => true,
    can: () => true,
    canMutate: (featureId: string) => featureId === "report-designer.edit" && permissionsMock.state.canEdit,
    getMutationCapability: () => ({
      allowed: permissionsMock.state.canEdit,
      reason: permissionsMock.state.canEdit ? null : "page-not-editable",
    }),
    permissions: [],
    featurePermissions: [],
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: (globalThis as { __testDir?: DirectoryHandleLike }).__testDir ?? null }),
}));

import ReportDesigner from "./index";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testDir?: DirectoryHandleLike }).__testDir;
  permissionsMock.state.canEdit = false;
});

function hasArabicIndicDigits(s: string): boolean {
  return /[٠-٩]/.test(s);
}

async function seedDesign(root: DirectoryHandleLike, name: string) {
  const doc = createEmptyDocument(name, "tester");
  const result = await saveDesign(root, doc);
  expect(result.ok).toBe(true);
  return doc;
}

describe("ReportDesigner — B6 view vs edit gating", () => {
  it("view-only (canEdit=false): open/thumbnail/print reachable, create/delete blocked", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير الإشراف");
    permissionsMock.state.canEdit = false;

    render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير الإشراف")).toBeInTheDocument();
    });

    // Create is blocked (report-designer.edit mutation).
    expect(screen.getByText("+ تقرير جديد").closest("button")).toBeDisabled();
    // Delete is blocked (report-designer.edit mutation).
    expect(screen.getByText("حذف").closest("button")).toBeDisabled();

    // Open is allowed — a read, gated on tab view access rather than canEditDesigns.
    const openBtn = screen.getByText("فتح").closest("button") as HTMLButtonElement;
    expect(openBtn).not.toBeDisabled();
    // The thumbnail itself (click-to-open affordance) must also be enabled.
    const thumb = screen.getByLabelText("فتح تقرير الإشراف");
    expect(thumb).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTitle("طباعة")).toBeInTheDocument();
    });
    // Print is reachable and enabled for a view-only user once inside the editor.
    expect(screen.getByTitle("طباعة")).not.toBeDisabled();
    // Save stays blocked for a view-only user.
    expect(screen.getByText("حفظ").closest("button")).toBeDisabled();
  });

  it("edit access (canEdit=true): create, delete, and save are all enabled", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير الإدارة");
    permissionsMock.state.canEdit = true;

    render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير الإدارة")).toBeInTheDocument();
    });

    expect(screen.getByText("+ تقرير جديد").closest("button")).not.toBeDisabled();
    expect(screen.getByText("حذف").closest("button")).not.toBeDisabled();

    fireEvent.click(screen.getByText("فتح").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText("حفظ").closest("button")).not.toBeDisabled();
    });
  });

  it("formats the 'آخر تعديل' design-list date with Latin digits, not Arabic-Indic", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير التواريخ");
    permissionsMock.state.canEdit = false;

    const { container } = render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير التواريخ")).toBeInTheDocument();
    });

    const dateNode = container.querySelector(".rd-card-date");
    expect(dateNode).toBeTruthy();
    const text = dateNode?.textContent ?? "";
    expect(hasArabicIndicDigits(text)).toBe(false);
    expect(/[0-9]/.test(text)).toBe(true);
  });
});
