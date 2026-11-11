/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { safeWriteJson } from "../../../../data/storage/safeWrite";
import type { MonthManifestData, PopulationFinalData } from "../../../../data/population/monthTypes";
import { makePopulationRow, makeSampleMaster } from "../../../../data/population/populationTestFixtures";
import { liveSampleRows, loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../../../../data/workspace/workspacePaths";
import { AddToSampleButton } from "./AddToSampleButton";

const JAN = "1-January-2026";

async function seed(root: DirectoryHandleLike): Promise<void> {
  const manifest: MonthManifestData = {
    monthFolderName: JAN, month: 1, year: 2026, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false, templateVersion: null, rngSeed: null,
    totalRawRows: 0, totalProcessedRows: 3, status: "distributed",
  };
  const monthDir = await getPopulationMonthDir(root, JAN, true);
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
  const final: PopulationFinalData = {
    sourceMonthFolder: JAN, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    totalRows: 3, certScanRows: 0, nonCertScanRows: 3,
    rows: ["S1", "P1", "P2"].map((id) => makePopulationRow(id)) as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true }), "population.final.json", final);
  expect((await saveSampleMaster(root, JAN, makeSampleMaster([makePopulationRow("S1")]))).ok).toBe(true);
}

function renderButton(root: DirectoryHandleLike, hasFilter = true) {
  render(
    <AddToSampleButton
      directoryHandle={root}
      month={JAN}
      hasFilter={hasFilter}
      collectIds={async () => ["S1", "P1", "P2"]}
      portRestrictions={[]}
      username="admin"
    />
  );
}

afterEach(cleanup);

describe("AddToSampleButton", () => {
  it("is disabled until a search or filter narrows the table", () => {
    renderButton(createMemoryDirectory(), false);
    expect(screen.getByRole("button", { name: "إضافة للعينة" })).toBeDisabled();
  });

  it("adds the filtered rows that are not sampled yet and gives them to the picked employee", async () => {
    const root = createMemoryDirectory();
    await seed(root);
    renderButton(root);

    fireEvent.click(screen.getByRole("button", { name: "إضافة للعينة" }));
    expect(await screen.findByText("إضافة 2 حالة إلى مستهدف المؤشر")).toBeInTheDocument();

    // Confirming with nobody picked is refused in place and writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "إضافة وتوزيع" }));
    expect(screen.getByRole("alert")).toHaveTextContent("اختر موظفاً واحداً على الأقل.");

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "إضافة وتوزيع" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("أُضيفت 2 حالة إلى العينة ووُزِّعت 2 حالة."));
    const sample = await loadSampleMaster(root, JAN);
    expect(liveSampleRows(sample).map((row) => row.xrayImageId)).toEqual(["S1", "P1", "P2"]);
    const current = await loadOrDeriveDistributionCurrent(root, JAN, liveSampleRows(sample));
    expect(current?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["P1", "P2"]);
  });
});
