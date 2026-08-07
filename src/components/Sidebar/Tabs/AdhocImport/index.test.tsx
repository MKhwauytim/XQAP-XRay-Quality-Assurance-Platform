/* @vitest-environment jsdom */
// Permission-gating coverage for the ad-hoc import tab (owner requirement, 2026-08):
// the tab is admin-only (see tabCatalog.ts's ADMIN_ONLY ceiling + userManagement.ts's
// "adhoc-import" default permission rows). auth/usePermissions and auth/userManagement
// are left REAL (driven through a real session via writeSession/clearSession, like
// Archive/index.test.tsx) so this reflects the actual shipped default matrix instead of
// a hand-rolled stand-in that could silently drift from it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import type { AuthRole } from "../../../../auth/authTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

const testDir: DirectoryHandleLike = createMemoryDirectory("adhoc-import-test-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

afterEach(() => {
  cleanup();
  clearSession();
});

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
