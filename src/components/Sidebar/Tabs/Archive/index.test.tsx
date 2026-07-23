/* @vitest-environment jsdom */
// B8-archive item 7 — first Archive component render/role test.
//
// Archive/index.tsx had zero test coverage before this bucket. This file covers the
// checklist from the fix plan:
//   - guest/employee sessions: every mutating control stays disabled. The "archive" tab's
//     default page access is "none" for both roles, so the page-edit gate inside
//     canMutate() blocks archive.createBackup/restoreBackup/closeMonth regardless of the
//     per-feature defaults below it.
//   - supervisor session: same disabled result, but for a different reason — page access
//     defaults to "view", one notch short of the "edit" canMutate requires. Genuinely
//     read-only, not merely feature-disabled.
//   - manager session: archive.createBackup defaults on for manager (the only one of the
//     three archive.* features that does), so the backup button/XLSX option are enabled
//     while restore/close-month stay blocked.
//   - admin session: all three enabled.
//   - the closed-month badge (.arc-badge-closed, item 4) plus every other manifestStatus's
//     badge class/label, and the row actions (close/reopen/—) they gate.
//   - both dialogs' error paths (item 1): RestoreDialog and MonthLockDialog (close AND
//     reopen) must stay open and render the failure text inside the modal card when the
//     underlying operation resolves ok:false, instead of the failure being swallowed
//     behind the modal's z-index:10020 backdrop.
//
// Mocking strategy: the data layer (backupStorage, populationStorage.listMonthFolders,
// monthLock.closeMonth/reopenMonth, actionLog.appendWorkspaceAction) is mocked so this file
// stays a focused unit test of THIS component's rendering/gating/error-surfacing logic —
// backupStorage's own correctness already has deep coverage in backupStorage.test.ts.
// auth/usePermissions and auth/userManagement are deliberately left REAL and driven through
// a real session (writeSession/clearSession) so every role assertion below reflects the
// actual default permission matrix rather than a hand-rolled stand-in that could silently
// drift from it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import type { AuthRole } from "../../../../auth/authTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { getLabels } from "../../../../data/labels/labelsStore";
import type {
  AutoBackupSettings,
  BackupHistoryItem,
  MonthArchiveStatus,
} from "../../../../data/backup/backupStorage";

const testDir: DirectoryHandleLike = createMemoryDirectory("archive-test-root");

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

vi.mock("../../../../data/population/populationStorage", () => ({
  listMonthFolders: vi.fn(),
}));

vi.mock("../../../../data/population/monthLock", () => ({
  closeMonth: vi.fn(),
  reopenMonth: vi.fn(),
}));

vi.mock("../../../../data/audit/actionLog", () => ({
  appendWorkspaceAction: vi.fn(),
}));

import ArchiveTab from "./index";
import {
  createBackup,
  loadArchiveStatus,
  loadAutoBackupSettings,
  loadAutoBackupState,
  loadBackupHistory,
  restoreBackupSnapshot,
  saveAutoBackupSettings,
} from "../../../../data/backup/backupStorage";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { closeMonth, reopenMonth } from "../../../../data/population/monthLock";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";

const L = getLabels();

const DEFAULT_AUTO_SETTINGS: AutoBackupSettings = {
  frequency: "daily",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "system",
};

function makeStatus(overrides: Partial<MonthArchiveStatus> = {}): MonthArchiveStatus {
  return {
    folderName: "5-may-2026",
    month: 5,
    year: 2026,
    hasManifest: true,
    hasPopulation: true,
    hasRawRisk: true,
    hasRawBi: false,
    hasSample: true,
    hasDistribution: true,
    hasAnswers: true,
    manifestStatus: "processed-saved",
    totalProcessedRows: 120,
    sampleRows: 40,
    distributionRows: 40,
    answerFiles: 3,
    answerItems: 40,
    ...overrides,
  };
}

function makeHistoryItem(overrides: Partial<BackupHistoryItem> = {}): BackupHistoryItem {
  return {
    folderName: "2026-05-20T09-00-00-manual-tst1",
    createdAt: "2026-05-20T09:00:00.000Z",
    createdBy: "admin",
    mode: "manual",
    monthsCount: 1,
    jsonFilesCount: 10,
    xlsxFilesCount: 0,
    totalRows: 120,
    ...overrides,
  };
}

function loginAs(role: AuthRole): void {
  writeSession({ role, username: "test-user", loginAt: new Date().toISOString() });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadArchiveStatus).mockResolvedValue([]);
  vi.mocked(loadBackupHistory).mockResolvedValue([]);
  vi.mocked(loadAutoBackupState).mockResolvedValue(null);
  vi.mocked(loadAutoBackupSettings).mockResolvedValue(DEFAULT_AUTO_SETTINGS);
  vi.mocked(listMonthFolders).mockResolvedValue([]);
  vi.mocked(createBackup).mockResolvedValue({
    ok: true,
    folderName: "backup-1",
    manifest: {
      createdAt: new Date().toISOString(),
      createdBy: "test-user",
      mode: "manual",
      monthsFolders: [],
      jsonFilesBackedUp: [],
      xlsxFilesBackedUp: [],
      datasets: [],
      rowLimitPerWorkbookPart: 25_000,
      excelSheetRowLimit: 1_048_576,
    },
  });
  vi.mocked(restoreBackupSnapshot).mockResolvedValue({
    ok: true,
    restoredFiles: [],
    rollbackFolderName: "rollback-1",
  });
  vi.mocked(saveAutoBackupSettings).mockResolvedValue({ ok: true, settings: DEFAULT_AUTO_SETTINGS });
  vi.mocked(closeMonth).mockResolvedValue({ ok: true });
  vi.mocked(reopenMonth).mockResolvedValue({ ok: true });
  vi.mocked(appendWorkspaceAction).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("Archive role-based mutation gating", () => {
  it("guest: every mutating control stays disabled (archive page access defaults to none)", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([makeStatus()]);
    vi.mocked(loadBackupHistory).mockResolvedValue([makeHistoryItem()]);
    loginAs("guest");

    render(<ArchiveTab />);
    await screen.findByText("معالج"); // wait for the async refresh() to settle

    const backupBtn = screen.getByRole("button", { name: "نسخ احتياطي الآن" });
    expect(backupBtn).toBeDisabled();
    expect(backupBtn).toHaveAttribute(
      "title",
      "يتطلب هذا الإجراء صلاحية التعديل ومساحة عمل قابلة للكتابة."
    );
    expect(screen.queryByText(L.backup_include_xlsx_option)).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "استعادة" })).toBeDisabled();
    expect(screen.queryByText("الإجراءات")).not.toBeInTheDocument();
  });

  it("employee: every mutating control stays disabled (archive page access defaults to none)", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([makeStatus()]);
    vi.mocked(loadBackupHistory).mockResolvedValue([makeHistoryItem()]);
    loginAs("employee");

    render(<ArchiveTab />);
    await screen.findByText("معالج");

    expect(screen.getByRole("button", { name: "نسخ احتياطي الآن" })).toBeDisabled();
    expect(screen.queryByText(L.backup_include_xlsx_option)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استعادة" })).toBeDisabled();
    expect(screen.queryByText("الإجراءات")).not.toBeInTheDocument();
  });

  it("supervisor: stays read-only (page access is view, one notch short of the edit canMutate requires)", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([makeStatus()]);
    vi.mocked(loadBackupHistory).mockResolvedValue([makeHistoryItem()]);
    loginAs("supervisor");

    render(<ArchiveTab />);
    await screen.findByText("معالج");

    expect(screen.getByRole("button", { name: "نسخ احتياطي الآن" })).toBeDisabled();
    expect(screen.queryByText(L.backup_include_xlsx_option)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استعادة" })).toBeDisabled();
    expect(screen.queryByText("الإجراءات")).not.toBeInTheDocument();
  });

  it("manager: can create a backup but not restore one or close/reopen a month", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([makeStatus()]);
    vi.mocked(loadBackupHistory).mockResolvedValue([makeHistoryItem()]);
    loginAs("manager");

    render(<ArchiveTab />);
    await screen.findByText("معالج");

    expect(screen.getByRole("button", { name: "نسخ احتياطي الآن" })).not.toBeDisabled();
    expect(screen.getByText(L.backup_include_xlsx_option)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "استعادة" })).toBeDisabled();
    expect(screen.queryByText("الإجراءات")).not.toBeInTheDocument();
  });

  it("admin: every mutating control is enabled", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([makeStatus()]);
    vi.mocked(loadBackupHistory).mockResolvedValue([makeHistoryItem()]);
    loginAs("admin");

    render(<ArchiveTab />);
    await screen.findByText("معالج");

    expect(screen.getByRole("button", { name: "نسخ احتياطي الآن" })).not.toBeDisabled();
    expect(screen.getByText(L.backup_include_xlsx_option)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استعادة" })).not.toBeDisabled();
    expect(screen.getByText("الإجراءات")).toBeInTheDocument();
  });
});

describe("Archive status badges + row actions per manifestStatus (admin)", () => {
  it("renders the correct badge class/label for every manifestStatus, including closed, and gates row actions accordingly", async () => {
    const rows: MonthArchiveStatus[] = [
      makeStatus({
        folderName: "1-january-2026",
        month: 1,
        year: 2026,
        manifestStatus: null,
        hasManifest: false,
        hasPopulation: false,
        hasRawRisk: false,
        hasRawBi: false,
        hasSample: false,
        hasDistribution: false,
        hasAnswers: false,
        totalProcessedRows: 0,
        sampleRows: 0,
        distributionRows: 0,
        answerFiles: 0,
        answerItems: 0,
      }),
      makeStatus({ folderName: "2-february-2026", month: 2, year: 2026, manifestStatus: "raw-saved" }),
      makeStatus({ folderName: "3-march-2026", month: 3, year: 2026, manifestStatus: "processed-saved" }),
      makeStatus({ folderName: "4-april-2026", month: 4, year: 2026, manifestStatus: "sampled" }),
      makeStatus({ folderName: "5-may-2026", month: 5, year: 2026, manifestStatus: "distributed" }),
      makeStatus({ folderName: "6-june-2026", month: 6, year: 2026, manifestStatus: "closed" }),
    ];
    vi.mocked(loadArchiveStatus).mockResolvedValue(rows);
    loginAs("admin");

    const { container } = render(<ArchiveTab />);
    await waitFor(() => {
      expect(container.querySelectorAll(".arc-table tbody tr").length).toBe(6);
    });

    const trs = Array.from(container.querySelectorAll<HTMLTableRowElement>(".arc-table tbody tr"));
    const expected: Array<{ badgeClass: string; label: string; action: "close" | "reopen" | "none" }> = [
      { badgeClass: "arc-badge-none", label: "غير مكتمل", action: "none" },
      { badgeClass: "arc-badge-raw-saved", label: "خام", action: "close" },
      { badgeClass: "arc-badge-processed-saved", label: "معالج", action: "close" },
      { badgeClass: "arc-badge-sampled", label: "مسحوب", action: "close" },
      { badgeClass: "arc-badge-distributed", label: "موزع", action: "close" },
      { badgeClass: "arc-badge-closed", label: L.archive_month_closed_badge, action: "reopen" },
    ];

    expected.forEach((expectation, index) => {
      const row = trs[index]!;
      const badge = row.querySelector<HTMLElement>(".arc-badge");
      expect(badge).not.toBeNull();
      expect(badge!.className).toContain(expectation.badgeClass);
      expect(badge!.textContent).toBe(expectation.label);

      const cells = within(row).getAllByRole("cell");
      const actionsCell = cells[cells.length - 1]!;
      if (expectation.action === "close") {
        expect(
          within(actionsCell).getByRole("button", { name: L.archive_close_month_btn })
        ).toBeInTheDocument();
      } else if (expectation.action === "reopen") {
        expect(
          within(actionsCell).getByRole("button", { name: L.archive_reopen_month_btn })
        ).toBeInTheDocument();
      } else {
        expect(within(actionsCell).getByText("—")).toBeInTheDocument();
      }
    });
  });
});

describe("Archive dialog error paths (item 1)", () => {
  it("RestoreDialog stays open and shows the failure message inside the modal when restoreBackupSnapshot fails", async () => {
    const historyItem = makeHistoryItem({ folderName: "2026-06-01T08-00-00-manual-fail" });
    vi.mocked(loadBackupHistory).mockResolvedValue([historyItem]);
    vi.mocked(restoreBackupSnapshot).mockResolvedValue({
      ok: false,
      error: "تعذر الوصول إلى مساحة العمل أثناء الاستعادة.",
    });
    loginAs("admin");

    render(<ArchiveTab />);
    fireEvent.click(await screen.findByRole("button", { name: "استعادة" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));

    const input = within(dialog).getByPlaceholderText(historyItem.folderName);
    fireEvent.change(input, { target: { value: historyItem.folderName } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "فشلت الاستعادة: تعذر الوصول إلى مساحة العمل أثناء الاستعادة."
      );
    });
    // The dialog must stay open on failure — only the success branch clears restoreTarget.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(restoreBackupSnapshot)).toHaveBeenCalledTimes(1);
  });

  it("MonthLockDialog (close) stays open and shows the failure message inside the modal when closeMonth fails", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([
      makeStatus({ manifestStatus: "processed-saved", hasManifest: true }),
    ]);
    vi.mocked(closeMonth).mockResolvedValue({
      ok: false,
      error: "تعذّر إقفال الشهر: تعارض في الكتابة بعد عدة محاولات.",
    });
    loginAs("admin");

    render(<ArchiveTab />);
    fireEvent.click(await screen.findByRole("button", { name: L.archive_close_month_btn }));

    const dialog = screen.getByRole("dialog");
    // Task 4: the dialog kicker now reads the shared label key instead of a hardcoded
    // English string ("Close Month"/"Reopen Month").
    expect(within(dialog).getByText(L.archive_month_action_kicker)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: L.archive_close_month_btn }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "تعذّر إقفال الشهر: تعارض في الكتابة بعد عدة محاولات."
      );
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(closeMonth)).toHaveBeenCalledTimes(1);
  });

  it("MonthLockDialog (reopen) stays open and shows the failure message inside the modal when reopenMonth fails", async () => {
    vi.mocked(loadArchiveStatus).mockResolvedValue([
      makeStatus({ manifestStatus: "closed", hasManifest: true }),
    ]);
    vi.mocked(reopenMonth).mockResolvedValue({
      ok: false,
      error: "تعذّر إعادة فتح الشهر: تعارض في الكتابة بعد عدة محاولات.",
    });
    loginAs("admin");

    render(<ArchiveTab />);
    fireEvent.click(await screen.findByRole("button", { name: L.archive_reopen_month_btn }));

    const dialog = screen.getByRole("dialog");
    const reasonInput = within(dialog).getByPlaceholderText(L.archive_reopen_reason_placeholder);
    fireEvent.change(reasonInput, { target: { value: "سبب تجريبي لإعادة الفتح" } });
    fireEvent.click(within(dialog).getByRole("button", { name: L.archive_reopen_month_btn }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "تعذّر إعادة فتح الشهر: تعارض في الكتابة بعد عدة محاولات."
      );
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(reopenMonth)).toHaveBeenCalledTimes(1);
  });
});
