/* @vitest-environment jsdom */
// Regression test for the "opened a blank tab, then the async build threw"
// bug fixed across all 7 openXxx call sites in commit d40a1cd9 (see
// ../htmlReport.ts's `writeOrCloseOnFailure`). This report has no separate
// `reportChrome`-style viewer builder to mock (unlike sampleReport.ts /
// managementDeck.ts) — document.ts builds its HTML directly — so, mirroring
// deck2/index.openFailure.test.ts's approach of mocking the model-building
// step instead, this mocks `computePopulationReportModel` (the first thing
// `buildPopulationDocument` calls) to throw.
//
// Kept as its own file (not merged into document.test.ts) because the
// `vi.mock` below is file-scoped and forces every render through
// `./model` to throw — that would break document.test.ts's other
// (non-failure-path) assertions and golden snapshot if mixed into the same
// file.
import { describe, expect, it, vi } from "vitest";

vi.mock("./model", async () => {
  const actual = await vi.importActual<typeof import("./model")>("./model");
  return {
    ...actual,
    computePopulationReportModel: vi.fn(() => {
      throw new Error("model boom");
    }),
  };
});

import { openPopulationDocument } from "./document";
import { makeRow, makeManifest, makeProcessingSummary, makeFakeReportWindow } from "../reportTestFixtures";
import type { PopulationReportInput } from "./model";

function input(): PopulationReportInput {
  return {
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 1,
    biRawRowCount: null,
    populationRows: [makeRow("1", "x")],
    sampleRows: [],
    distributionEntries: [],
    employeeDisplayNames: {},
  };
}

describe("openPopulationDocument — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the model build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openPopulationDocument(input())).rejects.toThrow("model boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
