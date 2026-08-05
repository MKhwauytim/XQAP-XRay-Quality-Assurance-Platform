/* @vitest-environment jsdom */
// Regression test for the "opened a blank tab, then the async build threw"
// bug fixed across all 7 openXxx call sites in commit d40a1cd9 (see
// htmlReport.ts's `writeOrCloseOnFailure`). Before this file, only
// executive/index.test.ts had an equivalent test — `openDistributionDocument`
// and `openDistributionDeck` (this file's subjects) had no direct regression
// coverage even though they were touched in the same commit.
//
// Kept as its own file (not merged into distributionReport.test.ts) because
// the `vi.mock` below is file-scoped and forces every render through
// `./shared/reportChrome` to throw — that would break
// distributionReport.test.ts's other (non-failure-path) assertions if mixed
// into the same file.
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

import { openDistributionDocument, openDistributionDeck } from "./distributionReport";
import { makeRow, makeDistribution, makeFakeReportWindow } from "./reportTestFixtures";

function data() {
  return makeDistribution([
    { id: "IMG-1", assignedTo: "u1", status: "pending", row: makeRow("IMG-1", "منفذ أ") },
  ]);
}

describe("openDistributionDocument — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the document build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openDistributionDocument(data(), "6-June-2026")).rejects.toThrow("doc viewer boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});

describe("openDistributionDeck — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the deck build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(openDistributionDeck(data(), "6-June-2026")).rejects.toThrow("deck viewer boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
