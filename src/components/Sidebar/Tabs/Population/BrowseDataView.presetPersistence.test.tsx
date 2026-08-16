/* @vitest-environment jsdom */
// Finding 9 — BrowseDataView.saveCurrentPreset never called the existing,
// tested `saveUserBrowseDatasetPreset`: it only persisted a column
// order/visibility change to disk when the acting session's role was
// "admin" (via `saveAdminBrowseDatasetPreset`), silently discarding any
// non-admin's choice after updating an in-memory ref that looked saved for
// the rest of the session but vanished on the next reload. The fix mirrors
// XrayReferrals.tsx's onColConfigChange call site: every user persists
// their OWN personal layout via `saveUserBrowseDatasetPreset`, regardless
// of role.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import { loadUserBrowsePreset } from "../../../../data/preferences/browsePresetStorage";
import { clearSession, writeSession } from "../../../../auth/authSession";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

vi.mock("../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import("./populationQueryWorkerTestStub");
  return { default: createPopulationQueryWorkerStubClass() };
});

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH_FOLDER }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH_FOLDER },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {}
  })
}));

const ROWS = [
  { xrayImageId: "X-1", portName: "ميناء الرياض", stage: "المستوى الأول" },
  { xrayImageId: "X-2", portName: "ميناء جدة", stage: "المستوى الأول" }
];

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  cleanup();
  clearSession();
});

async function seedAndRender(username: string): Promise<DirectoryHandleLike> {
  const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  await saveMonthRun({
    directoryHandle: dir,
    month: 5,
    year: 2026,
    username: "tester",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    riskRawRows: [],
    biRawRows: [],
    processedRows: ROWS,
    certScanRows: 0,
    nonCertScanRows: ROWS.length
  });

  render(
    <BrowseDataView
      directoryHandle={dir}
      refreshKey={0}
      username={username}
      config={DEFAULT_POPULATION_CONFIG}
      canExportReports
    />
  );

  await screen.findByText("X-1");
  return dir;
}

describe("BrowseDataView — non-admin column preset persistence (finding 9)", () => {
  it("persists a non-admin user's column visibility change to their OWN preset file", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    const dir = await seedAndRender("emp-1");

    // Sanity: nothing persisted yet for this user.
    const before = await loadUserBrowsePreset(dir, "emp-1");
    expect(before.browseData.population).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    const idColumnCheckbox = screen.getByRole("checkbox", { name: "معرف الأشعة" });
    expect(idColumnCheckbox).toBeChecked();
    fireEvent.click(idColumnCheckbox);

    await waitFor(async () => {
      const after = await loadUserBrowsePreset(dir, "emp-1");
      expect(after.browseData.population?.visibleColumns).toBeDefined();
      expect(after.browseData.population?.visibleColumns).not.toContain("xrayImageId");
    });
  });
});
