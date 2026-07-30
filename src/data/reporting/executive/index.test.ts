/* @vitest-environment jsdom */
// Regression test for a gap the P3-7 chunking rework (2026-07-29) introduced:
// `openExecutiveReport` opens the report tab via `openReportWindow()` BEFORE
// awaiting the (now async/chunked) HTML build, then writes into it once the
// build resolves. If the build throws instead of resolving, nothing ever
// wrote into the already-opened tab — it was left permanently blank, with
// only a generic error toast in the ORIGINAL tab hinting anything went wrong.
// This is the same failure class as the v56.12 "permanently blank opened tab"
// bug (docs/edit logs/2026-07-21.md), just reintroduced via a different
// mechanism (an unhandled build exception instead of a blob-URL revoke race).
import { describe, expect, it, vi } from "vitest";

vi.mock("./document/index", () => ({
  buildDocumentSlides: vi.fn(async () => {
    throw new Error("boom");
  }),
}));

import { openExecutiveReport } from "./index";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";

function makeFakeReportWindow() {
  return {
    document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
    close: vi.fn(),
  };
}

describe("openExecutiveReport — abandoned-window regression (P3-7 build-failure gap)", () => {
  it("closes the already-opened report window instead of leaving it permanently blank when the HTML build throws", async () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    await expect(
      openExecutiveReport({
        monthFolderName: "6-June-2026",
        populationRows: [],
        sample: null,
        distribution: null,
        employeeFiles: [],
        template: null,
        config: DEFAULT_EXEC_CONFIG,
      })
    ).rejects.toThrow("boom");

    expect(openSpy).toHaveBeenCalled();
    expect(fakeWindow.close).toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
