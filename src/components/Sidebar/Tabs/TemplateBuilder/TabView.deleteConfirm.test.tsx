/* @vitest-environment jsdom */
// Deleting an inspection template is irreversible -- it removes the file from the
// workspace. Until the overlay audit it fired straight from the card's "حذف"
// button with NO confirmation, the only unconfirmed destructive action in the
// app; every other one goes through ConfirmDialog.
//
// This suite was written against the pre-fix component first and BOTH assertions
// failed: `deleteTemplate` was called on the very first click, and no dialog
// text was ever rendered.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../auth/authSession";

const storageMock = vi.hoisted(() => ({
  deleteTemplate: vi.fn(async () => ({ ok: true as const })),
  loadTemplateIndex: vi.fn(async () => ({
    templates: [
      {
        templateId: "tpl-1",
        templateName: "نموذج ضمان جودة الأشعة",
        version: 1,
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "admin",
      },
    ],
  })),
}));

vi.mock("../../../../data/templates/templateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/templates/templateStorage")>();
  return { ...actual, ...storageMock };
});

let root: DirectoryHandleLike;

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: root }),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, canMutate: () => true }),
}));

import TemplateBuilderTab from "./TabView";

beforeEach(() => {
  root = createMemoryDirectory();
  storageMock.deleteTemplate.mockClear();
  writeSession({ username: "admin", role: "admin", loginAt: new Date(0).toISOString() });
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("TemplateBuilder delete confirmation", () => {
  it("does NOT delete on the first click -- it asks first", async () => {
    render(<TemplateBuilderTab />);

    const deleteButton = await screen.findByRole("button", { name: "حذف" });
    fireEvent.click(deleteButton);

    // The whole point: the click opens a dialog, it does not touch the disk.
    expect(storageMock.deleteTemplate).not.toHaveBeenCalled();
    expect(await screen.findByText(/سيتم حذف النموذج «/)).toBeInTheDocument();
  });

  it("deletes only after the destructive action is confirmed", async () => {
    render(<TemplateBuilderTab />);

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));
    fireEvent.click(await screen.findByRole("button", { name: "حذف نهائي" }));

    await waitFor(() => {
      expect(storageMock.deleteTemplate).toHaveBeenCalledTimes(1);
    });
    expect(storageMock.deleteTemplate).toHaveBeenCalledWith(expect.anything(), "tpl-1");
  });

  it("cancelling leaves the template on disk", async () => {
    render(<TemplateBuilderTab />);

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء" }));

    await waitFor(() => {
      expect(screen.queryByText(/سيتم حذف النموذج «/)).not.toBeInTheDocument();
    });
    expect(storageMock.deleteTemplate).not.toHaveBeenCalled();
  });
});
