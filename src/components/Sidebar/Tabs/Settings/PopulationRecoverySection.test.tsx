/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import type { PopulationRecoveryCandidate } from "../../../../data/population/populationRecovery";

const permissions = vi.hoisted(() => ({ role: "admin" }));
const recovery = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PopulationRecoveryCandidate[]>>(),
  restore: vi.fn(),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ role: permissions.role, username: "admin" }),
}));
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" } }),
}));
vi.mock("../../../../data/population/populationRecovery", () => ({
  listPopulationRecoveryCandidates: recovery.list,
  restorePopulationCandidate: recovery.restore,
}));

import { PopulationRecoverySection } from "./PopulationRecoverySection";

afterEach(() => {
  cleanup();
  permissions.role = "admin";
  recovery.list.mockReset();
  recovery.restore.mockReset();
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

describe("PopulationRecoverySection", () => {
  it("is not rendered for a non-admin", () => {
    permissions.role = "manager";
    const { container } = render(<PopulationRecoverySection />);
    expect(container.textContent).toBe("");
  });

  it("lists candidates with coverage and restores the chosen one after confirmation", async () => {
    recovery.list.mockResolvedValue([ARCHIVE]);
    recovery.restore.mockResolvedValue({ ok: true, archivedAs: "population.final.x.superseded.json", rowCount: 300 });
    render(<PopulationRecoverySection />);

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn }));
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() => expect(recovery.restore).toHaveBeenCalledWith(
      expect.anything(), "5-may-2026", ARCHIVE.fileName, "admin"
    ));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_restored.replace("{archived}", "population.final.x.superseded.json")
      )
    );
  });
});
