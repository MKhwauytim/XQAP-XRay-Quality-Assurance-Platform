/* @vitest-environment jsdom */
// Regression test for the "opened a blank tab, then the async build threw"
// bug fixed across all 7 openXxx call sites in commit d40a1cd9 (see
// htmlReport.ts's `writeOrCloseOnFailure`). Before this file, only
// executive/index.test.ts had an equivalent test — `openManagementDeck`
// (this file's subject) had no direct regression coverage even though
// managementDeck.test.ts was touched in the same commit range.
//
// Kept as its own file (not merged into managementDeck.test.ts) because the
// `vi.mock` below is file-scoped and forces the deck viewer to throw — that
// would break managementDeck.test.ts's other (non-failure-path) assertions
// and golden snapshot if mixed into the same file.
import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/reportChrome", async () => {
  const actual = await vi.importActual<typeof import("../shared/reportChrome")>("../shared/reportChrome");
  return {
    ...actual,
    buildDeckViewer: vi.fn(() => {
      throw new Error("deck viewer boom");
    }),
  };
});

import { openManagementDeck } from "./managementDeck";
import { makeRow, makeFakeReportWindow } from "../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";

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

describe("openManagementDeck — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the deck build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openManagementDeck(input())).rejects.toThrow("deck viewer boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
