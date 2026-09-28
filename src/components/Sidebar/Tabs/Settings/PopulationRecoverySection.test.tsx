/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import type { PopulationRecoveryCandidate } from "../../../../data/population/populationRecovery";

const permissions = vi.hoisted(() => ({ view: true, mutate: true }));
const recovery = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PopulationRecoveryCandidate[]>>(),
  restore: vi.fn(),
  months: vi.fn(),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    role: "admin",
    username: "admin",
    can: () => permissions.view,
    canMutate: () => permissions.mutate,
  }),
}));
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));
vi.mock("../../../../data/population/populationStorage", () => ({
  listMonthFolders: recovery.months,
}));
vi.mock("../../../../data/population/populationRecovery", () => ({
  listPopulationRecoveryCandidates: recovery.list,
  restorePopulationCandidate: recovery.restore,
}));

import { PopulationRecoverySection } from "./PopulationRecoverySection";

afterEach(() => {
  cleanup();
  permissions.view = true;
  permissions.mutate = true;
  recovery.list.mockReset();
  recovery.restore.mockReset();
  recovery.months.mockReset();
});

const ARCHIVE: PopulationRecoveryCandidate = {
  fileName: "population.final.2026-09-28T101500.000Z.superseded.json",
  source: "superseded",
  rowCount: 300,
  processedAt: "2026-09-27T08:00:00.000Z",
  coveredSampledIds: 40,
  totalSampledIds: 40,
  wouldBlock: false,
};

function withMonth(): void {
  recovery.months.mockResolvedValue([{ folderName: "5-may-2026", month: 5, year: 2026 }]);
}

async function openAndScan(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("5-may-2026"));
  fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn }));
}

describe("PopulationRecoverySection", () => {
  it("is not rendered without view permission", () => {
    permissions.view = false;
    const { container } = render(<PopulationRecoverySection />);
    expect(container.textContent).toBe("");
  });

  it("shows no restore button without mutate permission", async () => {
    withMonth();
    permissions.mutate = false;
    recovery.list.mockResolvedValue([ARCHIVE]);
    render(<PopulationRecoverySection />);
    await openAndScan();
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn })).toBeNull();
  });

  it("lists candidates with coverage and restores the chosen one after confirmation", async () => {
    withMonth();
    recovery.list.mockResolvedValue([ARCHIVE]);
    recovery.restore.mockResolvedValue({ ok: true, archivedAs: "population.final.x.superseded.json", rowCount: 300 });
    render(<PopulationRecoverySection />);
    await openAndScan();
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    expect(
      screen.getByText(
        DEFAULT_LABELS.population_recovery_confirm_coverage
          .replace("{covered}", "40")
          .replace("{total}", "40")
          .replace("{missing}", "0")
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() =>
      expect(recovery.restore).toHaveBeenCalledWith(expect.anything(), "5-may-2026", ARCHIVE.fileName, "admin")
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_restored.replace("{archived}", "population.final.x.superseded.json")
      )
    );
  });

  it("does not restore when the confirmation is cancelled", async () => {
    withMonth();
    recovery.list.mockResolvedValue([ARCHIVE]);
    render(<PopulationRecoverySection />);
    await openAndScan();
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_cancel }));

    expect(recovery.restore).not.toHaveBeenCalled();
  });

  it("shows a scan-failed notice, not the empty state, when the listing throws", async () => {
    withMonth();
    recovery.list.mockRejectedValue(new Error("share offline"));
    render(<PopulationRecoverySection />);
    await openAndScan();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_scan_failed.replace("{error}", "share offline")
      )
    );
    expect(screen.queryByText(DEFAULT_LABELS.population_recovery_none)).toBeNull();
  });

  it("renders the no-month state when the workspace has no saved months", async () => {
    recovery.months.mockResolvedValue([]);
    render(<PopulationRecoverySection />);
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
    await waitFor(() => expect(screen.getByText(DEFAULT_LABELS.population_recovery_no_month)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn })).toBeDisabled();
  });

  it("shows the missing count and disables restore for a candidate the guard would refuse", async () => {
    withMonth();
    recovery.list.mockResolvedValue([{ ...ARCHIVE, coveredSampledIds: 31, wouldBlock: true }]);
    render(<PopulationRecoverySection />);
    await openAndScan();

    await waitFor(() => expect(screen.getByText("31 / 40")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn })).toBeDisabled();
    expect(
      screen.getByText(DEFAULT_LABELS.population_recovery_blocked_note.replace("{missing}", "9"))
    ).toBeInTheDocument();
  });

  it("names the missing count when the engine refuses a restore", async () => {
    withMonth();
    recovery.list.mockResolvedValue([ARCHIVE]);
    recovery.restore.mockResolvedValue({ ok: false, reason: "blocked", missingCount: 4, missingExamples: [], distributionCount: 1, answerCount: 0 });
    render(<PopulationRecoverySection />);
    await openAndScan();
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_blocked_refused.replace("{missing}", "4")
      )
    );
  });
});
