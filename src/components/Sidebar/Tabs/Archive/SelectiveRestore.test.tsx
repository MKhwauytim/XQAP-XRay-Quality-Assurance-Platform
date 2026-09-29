/* @vitest-environment jsdom */
// Workstream D — the Archive restore dialog's full/selective mode switch.
// Same mocking strategy as index.test.tsx: the data layer is mocked; auth and
// permissions are real and driven through a real session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clearSession, writeSession } from "../../../../auth/authSession";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { getLabels } from "../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import { formatNumber } from "../../../../utils/formatting";
import type { AutoBackupSettings, BackupHistoryItem } from "../../../../data/backup/backupStorage";
import type { RestorePreview, SelectiveRestorePlan } from "../../../../data/backup/selectiveRestore";
import { fillTemplate } from "./selectiveRestoreText";

const testDir: DirectoryHandleLike = createMemoryDirectory("archive-selective-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ refreshMonths: async () => {} }),
}));

vi.mock("../../../../data/backup/backupStorage", () => ({
  createBackup: vi.fn(),
  loadArchiveStatus: vi.fn(),
  loadAutoBackupSettings: vi.fn(),
  loadAutoBackupState: vi.fn(),
  loadBackupHistory: vi.fn(),
  restoreBackupSnapshot: vi.fn(),
  saveAutoBackupSettings: vi.fn(),
}));

vi.mock("../../../../data/backup/selectiveRestore", () => ({
  previewSelectiveRestore: vi.fn(),
  planSelectiveRestore: vi.fn(),
  runSelectiveRestore: vi.fn(),
}));

vi.mock("../../../../data/population/populationStorage", () => ({
  listMonthFolders: vi.fn(),
}));

vi.mock("../../../../data/population/monthLock", () => ({
  closeMonth: vi.fn(),
  reopenMonth: vi.fn(),
}));

vi.mock("../../../../data/audit/actionLog", () => ({
  appendWorkspaceAction: vi.fn(),
  recordAction: vi.fn(),
}));

vi.mock("../../../../data/integrity/orphanScanLoader", () => ({
  runMonthIntegrityScan: vi.fn(),
}));

vi.mock("../../../../data/workspace/dataRefreshSignal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/workspace/dataRefreshSignal")>();
  return { ...actual, broadcastDataRefresh: vi.fn() };
});

import ArchiveTab from "./index";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import {
  loadArchiveStatus,
  loadAutoBackupSettings,
  loadAutoBackupState,
  loadBackupHistory,
  restoreBackupSnapshot,
} from "../../../../data/backup/backupStorage";
import {
  planSelectiveRestore,
  previewSelectiveRestore,
  runSelectiveRestore,
} from "../../../../data/backup/selectiveRestore";
import { listMonthFolders } from "../../../../data/population/populationStorage";

const L = getLabels();
const FOLDER = "2026-05-20T09-00-00-manual-sel1";
const M1 = "5-may-2026";
const M1_LABEL = formatMonthFolderShortLabel(M1);

const SETTINGS: AutoBackupSettings = { frequency: "daily", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "system" };

const HISTORY_ITEM: BackupHistoryItem = {
  folderName: FOLDER,
  createdAt: "2026-05-20T09:00:00.000Z",
  createdBy: "admin",
  mode: "manual",
  monthsCount: 1,
  jsonFilesCount: 10,
  xlsxFilesCount: 0,
  totalRows: 120,
  status: "complete",
  failedFilesCount: 0,
};

const PREVIEW: RestorePreview = {
  backupFolderName: FOLDER,
  months: [M1],
  cells: [{ element: "population", month: M1, fileCount: 3 }],
  unclassifiedCount: 0,
};

function makePlan(overrides: Partial<SelectiveRestorePlan> = {}): SelectiveRestorePlan {
  return {
    scope: { elements: ["population"], months: [M1] },
    invalidReason: null,
    selections: [{ element: "population", month: M1, fileCount: 3 }],
    selectedFileCount: 3,
    emptySelections: [],
    blocked: [],
    warnings: [],
    canConfirm: true,
    ...overrides,
  };
}

function renderArchiveTab() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchiveTab />
    </QueryClientProvider>
  );
}

async function openSelectiveDialog(): Promise<HTMLElement> {
  writeSession({ role: "admin", username: "test-user", loginAt: new Date().toISOString() });
  renderArchiveTab();
  fireEvent.click(await screen.findByRole("button", { name: "استعادة" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("radio", { name: L.archive_restore_mode_selective }));
  await within(dialog).findByRole("checkbox", { name: L.restore_element_population });
  return dialog;
}

/** Month first, then element — so the only plan request carries both. */
function pickPopulationForM1(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole("checkbox", { name: M1_LABEL }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: L.restore_element_population }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadArchiveStatus).mockResolvedValue([]);
  vi.mocked(loadBackupHistory).mockResolvedValue([HISTORY_ITEM]);
  vi.mocked(loadAutoBackupState).mockResolvedValue(null);
  vi.mocked(loadAutoBackupSettings).mockResolvedValue(SETTINGS);
  vi.mocked(listMonthFolders).mockResolvedValue([]);
  vi.mocked(previewSelectiveRestore).mockResolvedValue(PREVIEW);
  vi.mocked(planSelectiveRestore).mockResolvedValue(makePlan());
  vi.mocked(runSelectiveRestore).mockResolvedValue({
    ok: true,
    restoredFiles: ["a", "b", "c"],
    rollbackFolderName: "rollback-1",
    derivedWarnings: [],
    integrity: [
      {
        month: M1,
        result: { answersOrphans: [], approvalsOrphans: [], sampleOrphans: [], distributionOrphans: [], clean: true },
        error: null,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("Archive restore dialog — selective mode (Workstream D)", () => {
  it("offers an admin the full/selective switch, defaulting to a full restore", async () => {
    writeSession({ role: "admin", username: "test-user", loginAt: new Date().toISOString() });
    renderArchiveTab();
    fireEvent.click(await screen.findByRole("button", { name: "استعادة" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("radio", { name: L.archive_restore_mode_full })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: L.archive_restore_mode_selective })).not.toBeChecked();
    expect(within(dialog).queryByRole("checkbox", { name: L.restore_element_population })).toBeNull();
    expect(vi.mocked(previewSelectiveRestore)).not.toHaveBeenCalled();
  });

  it("previews the backup, plans the chosen element × month and runs the scoped restore", async () => {
    const dialog = await openSelectiveDialog();
    expect(vi.mocked(previewSelectiveRestore)).toHaveBeenCalledWith(testDir, FOLDER);

    pickPopulationForM1(dialog);

    await waitFor(() => {
      expect(vi.mocked(planSelectiveRestore)).toHaveBeenLastCalledWith(
        expect.objectContaining({ backupFolderName: FOLDER, scope: { elements: ["population"], months: [M1] } })
      );
    });
    const row = fillTemplate(L.archive_restore_preview_row, {
      element: L.restore_element_population,
      month: M1_LABEL,
      count: formatNumber(3),
    });
    expect(await within(dialog).findByText(row)).toBeInTheDocument();

    const next = within(dialog).getByRole("button", { name: "متابعة التحقق" });
    expect(next).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(next).not.toBeDisabled();
    fireEvent.click(next);

    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(vi.mocked(runSelectiveRestore)).toHaveBeenCalledWith(
        expect.objectContaining({
          backupFolderName: FOLDER,
          username: "test-user",
          scope: { elements: ["population"], months: [M1] },
        })
      );
    });
    expect(vi.mocked(restoreBackupSnapshot)).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(vi.mocked(broadcastDataRefresh)).toHaveBeenCalledWith("manual");
    });
    const integrityLine = fillTemplate(L.archive_restore_integrity_clean, { month: M1_LABEL });
    await waitFor(() => {
      expect(document.body.textContent).toContain(integrityLine);
    });
  });

  it("explains a blocked population restore and keeps continue disabled", async () => {
    vi.mocked(planSelectiveRestore).mockResolvedValue(
      makePlan({
        canConfirm: false,
        blocked: [{ month: M1, sampledCount: 40, missingCount: 2, missingExamples: ["X1", "X2"] }],
      })
    );
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);

    const blocked = fillTemplate(L.archive_restore_blocked_population, {
      month: M1_LABEL,
      missing: formatNumber(2),
      sampled: formatNumber(40),
      examples: "X1، X2",
    });
    expect(await within(dialog).findByText(blocked)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(within(dialog).getByRole("button", { name: "متابعة التحقق" })).toBeDisabled();
  });

  it("marks a selection the backup does not contain and keeps continue disabled", async () => {
    vi.mocked(planSelectiveRestore).mockResolvedValue(
      makePlan({
        canConfirm: false,
        scope: { elements: ["templates"], months: [] },
        selections: [{ element: "templates", month: null, fileCount: 0 }],
        selectedFileCount: 0,
        emptySelections: [{ element: "templates", month: null }],
      })
    );
    const dialog = await openSelectiveDialog();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: L.restore_element_templates }));

    const missing = fillTemplate(L.archive_restore_not_present_workspace, { element: L.restore_element_templates });
    expect(await within(dialog).findByText(missing)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(within(dialog).getByRole("button", { name: "متابعة التحقق" })).toBeDisabled();
  });

  it("keeps a failed selective restore's reason inside the dialog", async () => {
    vi.mocked(runSelectiveRestore).mockResolvedValue({ ok: false, reason: "restore-failed", error: "boom" });
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    await within(dialog).findByText(
      fillTemplate(L.archive_restore_preview_row, { element: L.restore_element_population, month: M1_LABEL, count: formatNumber(3) })
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));
    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(`${L.archive_restore_failed_prefix}: boom`);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tells the admin how many backup files a selective restore cannot reach", async () => {
    vi.mocked(previewSelectiveRestore).mockResolvedValue({ ...PREVIEW, unclassifiedCount: 4 });
    const dialog = await openSelectiveDialog();

    expect(
      within(dialog).getByText(fillTemplate(L.archive_restore_unclassified, { count: formatNumber(4) }))
    ).toBeInTheDocument();
  });

  it("shows the legacy embedded-requests warnings from the plan", async () => {
    vi.mocked(planSelectiveRestore).mockResolvedValue(
      makePlan({
        warnings: [
          { kind: "answers-restore-embedded-requests", month: M1 },
          { kind: "requests-embedded-in-answers", month: M1 },
        ],
      })
    );
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);

    expect(
      await within(dialog).findByText(fillTemplate(L.archive_restore_warning_answers_embed_requests, { month: M1_LABEL }))
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(fillTemplate(L.archive_restore_warning_requests_embedded, { month: M1_LABEL }))
    ).toBeInTheDocument();
  });

  it("keeps a late plan from a discarded panel from re-arming the selection (remount race)", async () => {
    let resolvePlan: (plan: SelectiveRestorePlan) => void = () => {};
    vi.mocked(planSelectiveRestore).mockImplementation(
      () => new Promise<SelectiveRestorePlan>((resolve) => { resolvePlan = resolve; })
    );
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    // Back to full mode unmounts the panel while its plan is still in flight.
    fireEvent.click(within(dialog).getByRole("radio", { name: L.archive_restore_mode_full }));
    fireEvent.click(within(dialog).getByRole("radio", { name: L.archive_restore_mode_selective }));
    await within(dialog).findByRole("checkbox", { name: L.restore_element_population });
    await act(async () => {
      resolvePlan(makePlan());
      await Promise.resolve();
    });

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(within(dialog).getByRole("button", { name: "متابعة التحقق" })).toBeDisabled();
  });

  it("reports rebuild steps that failed as a warning, not as a clean success", async () => {
    vi.mocked(runSelectiveRestore).mockResolvedValue({
      ok: true,
      restoredFiles: ["a"],
      rollbackFolderName: "rollback-1",
      integrity: [],
      derivedWarnings: [{ month: M1, step: "replacement-index", error: "boom" }],
    });
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    await within(dialog).findByText(
      fillTemplate(L.archive_restore_preview_row, { element: L.restore_element_population, month: M1_LABEL, count: formatNumber(3) })
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));
    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        fillTemplate(L.archive_restore_derived_warning, {
          step: L.archive_restore_derived_step_replacement_index,
          month: M1_LABEL,
          error: "boom",
        })
      );
    });
    expect(document.querySelector(".arc-msg-warn")).not.toBeNull();
  });

  it("names the rollback folder and still refreshes when a restore fails after it started", async () => {
    vi.mocked(runSelectiveRestore).mockResolvedValue({
      ok: false,
      reason: "restore-failed",
      error: "boom",
      rollbackFolderName: "rollback-9",
    });
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    await within(dialog).findByText(
      fillTemplate(L.archive_restore_preview_row, { element: L.restore_element_population, month: M1_LABEL, count: formatNumber(3) })
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));
    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent("rollback-9");
    });
    expect(vi.mocked(broadcastDataRefresh)).toHaveBeenCalledWith("manual");
  });

  it("shows an unexpected rejection inside the dialog and still refreshes other views", async () => {
    vi.mocked(runSelectiveRestore).mockRejectedValue(new Error("share vanished"));
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    await within(dialog).findByText(
      fillTemplate(L.archive_restore_preview_row, { element: L.restore_element_population, month: M1_LABEL, count: formatNumber(3) })
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));
    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent("share vanished");
    });
    expect(vi.mocked(broadcastDataRefresh)).toHaveBeenCalledWith("manual");
  });
});
