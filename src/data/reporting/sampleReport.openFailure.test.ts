/* @vitest-environment jsdom */
// Regression test for the "opened a blank tab, then the async build threw"
// bug fixed across all 7 openXxx call sites in commit d40a1cd9 (see
// htmlReport.ts's `writeOrCloseOnFailure`). Before this file, only
// executive/index.test.ts had an equivalent test — `openSampleReport` and
// `openSampleDeck` (this file's subjects) had no direct regression coverage
// even though they were touched in the same commit.
//
// Kept as its own file (not merged into sampleReport.test.ts) because the
// `vi.mock` below is file-scoped and forces every render through
// `./shared/reportChrome` to throw — that would break sampleReport.test.ts's
// other (non-failure-path) assertions if mixed into the same file.
import { describe, expect, it, vi } from "vitest";

vi.mock("./shared/reportChrome", async () => {
  const actual = await vi.importActual<typeof import("./shared/reportChrome")>("./shared/reportChrome");
  return {
    ...actual,
    buildDocViewer: vi.fn(() => {
      throw new Error("doc viewer boom");
    }),
    buildDeckViewer: vi.fn(() => {
      throw new Error("deck viewer boom");
    }),
  };
});

import { openSampleReport, openSampleDeck } from "./sampleReport";
import { makeRow, makeManifest, makeSampleMaster, makeFakeReportWindow } from "./reportTestFixtures";
import type { SampleReportInput } from "./sampleReport";

function input(): SampleReportInput {
  const rows = [makeRow("IMG-1", "منفذ أ")];
  return {
    monthFolderName: "6-June-2026",
    manifest: makeManifest(),
    populationRows: rows,
    sample: makeSampleMaster(rows),
  };
}

describe("openSampleReport — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the document build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openSampleReport(input())).rejects.toThrow("doc viewer boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});

describe("openSampleDeck — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the deck build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openSampleDeck(input())).rejects.toThrow("deck viewer boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
