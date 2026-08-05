/* @vitest-environment jsdom */
// Direct unit coverage for the shared `writeOrCloseOnFailure` helper
// (htmlReport.ts), which is the single choke point all 7 `openXxx` report
// entry points (sampleReport.ts x2, distributionReport.ts x2,
// executive/index.ts, executive/deck2/index.ts, management/managementDeck.ts)
// route through to fix the "opened a blank tab, then the async build threw"
// bug (commit d40a1cd9). Before this file, only ONE of those 7 call sites
// (executive/index.test.ts) had a regression test for this failure mode, and
// it exercised the guarantee only indirectly (by mocking that one builder's
// internals). This file tests the shared helper itself, directly, so any
// future change to `writeOrCloseOnFailure`'s own logic — regardless of which
// call site would be affected — is caught here without depending on each
// call site separately re-deriving the same coverage.
import { afterEach, describe, expect, it, vi } from "vitest";

import { openReportWindow, writeOrCloseOnFailure, writeReportToWindow } from "./htmlReport";
import { makeFakeReportWindow } from "./reportTestFixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeOrCloseOnFailure", () => {
  it("closes the window and rethrows when buildHtml() throws, without writing anything", async () => {
    const fakeWindow = makeFakeReportWindow();
    const err = new Error("build failed");

    await expect(
      writeOrCloseOnFailure(fakeWindow as unknown as Window, () => Promise.reject(err), "report.html")
    ).rejects.toThrow("build failed");

    expect(fakeWindow.close).toHaveBeenCalledTimes(1);
    expect(fakeWindow.document.open).not.toHaveBeenCalled();
    expect(fakeWindow.document.write).not.toHaveBeenCalled();
  });

  it("writes the built HTML into the window and never calls close() on the success path", async () => {
    const fakeWindow = makeFakeReportWindow();

    await writeOrCloseOnFailure(fakeWindow as unknown as Window, () => Promise.resolve("<html></html>"), "report.html");

    expect(fakeWindow.document.open).toHaveBeenCalledTimes(1);
    expect(fakeWindow.document.write).toHaveBeenCalledWith("<html></html>");
    expect(fakeWindow.document.close).toHaveBeenCalledTimes(1);
    expect(fakeWindow.close).not.toHaveBeenCalled();
  });

  it("rethrows the build error, without a secondary null-window failure, when the window is already null", async () => {
    const err = new Error("build failed, no window to close either");

    await expect(
      writeOrCloseOnFailure(null, () => Promise.reject(err), "report.html")
    ).rejects.toThrow("build failed, no window to close either");
  });

  it("swallows an error thrown by reportWindow.close() itself and still rethrows the original build error", async () => {
    const fakeWindow = makeFakeReportWindow();
    fakeWindow.close.mockImplementation(() => {
      throw new Error("close() refused");
    });
    const buildErr = new Error("build failed");

    await expect(
      writeOrCloseOnFailure(fakeWindow as unknown as Window, () => Promise.reject(buildErr), "report.html")
    ).rejects.toThrow("build failed");

    expect(fakeWindow.close).toHaveBeenCalledTimes(1);
  });
});

describe("openReportWindow / writeReportToWindow", () => {
  it("opens a blank same-origin window and severs opener", () => {
    const fakeWindow = makeFakeReportWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    const result = openReportWindow();

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(result).toBe(fakeWindow);
    expect(fakeWindow.opener).toBeNull();
  });

  it("writeReportToWindow falls back to a download when the window is null", () => {
    const clickSpy = vi.fn();
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node as Node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node as Node);
    vi.spyOn(document, "createElement").mockImplementation(() => {
      return { click: clickSpy, href: "", download: "" } as unknown as HTMLAnchorElement;
    });
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURLSpy = vi.fn();
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL.
    const previousCreateObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const previousRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURLSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURLSpy;

    try {
      writeReportToWindow(null, "<html></html>", "report.html");

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:fake");
    } finally {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = previousCreateObjectURL;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = previousRevokeObjectURL;
    }
  });
});
