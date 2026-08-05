/* @vitest-environment jsdom */
// Regression test for the "opened a blank tab, then the async build threw"
// bug fixed across all 7 openXxx call sites in commit d40a1cd9 (see
// ../../htmlReport.ts's `writeOrCloseOnFailure`). Before this file, only
// executive/index.test.ts had an equivalent test — `openExecutiveDeckV2`
// (this file's subject, the LIVE default executive-deck edition since
// 2026-07-14) had no direct regression coverage even though this module was
// touched in the same commit range.
//
// Kept as its own file (not merged into deck2.test.ts) because the
// `vi.mock` below is file-scoped and forces `buildReportModel` to throw for
// every test in the file — that would break deck2.test.ts's many
// non-failure-path slide-builder assertions if mixed into the same file.
import { describe, expect, it, vi } from "vitest";

vi.mock("../model/reportModel", async () => {
  const actual = await vi.importActual<typeof import("../model/reportModel")>("../model/reportModel");
  return {
    ...actual,
    buildReportModel: vi.fn(() => {
      throw new Error("report model boom");
    }),
  };
});

import { openExecutiveDeckV2 } from "./index";
import { makeRow, makeFakeReportWindow } from "../../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";

function input(): ExecutiveReportInput {
  return {
    monthFolderName: "6-June-2026",
    populationRows: [makeRow("IMG-1", "منفذ أ")],
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("openExecutiveDeckV2 — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the model build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openExecutiveDeckV2(input())).rejects.toThrow("report model boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
