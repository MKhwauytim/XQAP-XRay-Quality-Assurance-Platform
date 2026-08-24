/* @vitest-environment jsdom */
// B10 — ErrorLogSection (synthesis medium, ErrorLogSection.tsx:17/23 + .css:94).
//
// Two behavioral regressions fixed together, both covered here:
//  1. The whole section (including its collapsed header) used to vanish
//     whenever the in-memory ring buffer was empty at mount, hiding the
//     feature entirely and freezing the badge count for the rest of the
//     session once mounted with zero errors.
//  2. "مسح السجل" (Clear) had no mutation gate at all -- any role that could
//     view the log could also wipe it, even in read-only/demo mode.
// (The third fix in this bucket -- the four undefined CSS custom properties
// in ErrorLogSection.css -- is a pure token rename with no runtime behavior
// to assert here.)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearErrors, logError } from "../../../../data/storage/errorLogger";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { ErrorLogSection } from "./ErrorLogSection";

const permissionsMock = vi.hoisted(() => ({ can: true, canMutate: true }));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) => (featureId === "view-error-log" ? permissionsMock.can : false),
    canMutate: (featureId: string) =>
      featureId === "view-error-log" ? permissionsMock.canMutate : false,
  }),
}));

// The component now also reads useWorkspace() (to decide whether to show the
// export button) — every pre-existing test in this file exercised the
// component with no workspace mock at all, so without this it would fail at
// render for every one of them, not just the new export tests below.
// Defaults to no workspace connected, matching the pre-existing tests' world.
const workspaceMock = vi.hoisted(() => ({ handle: null as DirectoryHandleLike | null }));
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.handle, status: "ready" }),
}));

const exportMock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../../data/errorLog/errorLogExport", () => ({
  exportWorkspaceErrorLog: exportMock.run,
}));

beforeEach(() => {
  clearErrors();
  permissionsMock.can = true;
  permissionsMock.canMutate = true;
  workspaceMock.handle = null;
  exportMock.run.mockReset().mockResolvedValue({ rowCount: 3 });
});

afterEach(() => {
  cleanup();
  clearErrors();
  vi.useRealTimers();
});

describe("ErrorLogSection — visibility, clear gating, refresh", () => {
  it("renders nothing when the user cannot view the error log", () => {
    permissionsMock.can = false;
    const { container } = render(<ErrorLogSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("always renders the collapsed header when the user can view, even with zero errors logged", () => {
    // Regression: this used to `return null` whenever errors.length === 0 &&
    // !isOpen, hiding the whole section -- not just the badge -- for the
    // common empty-log case.
    render(<ErrorLogSection />);
    expect(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the current error count in the collapsed header badge", () => {
    logError("test-context", new Error("boom"));
    render(<ErrorLogSection />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("disables Clear and blocks clearErrors() when canMutate denies it, even though the panel can still be viewed", () => {
    logError("test-context", new Error("boom"));
    permissionsMock.canMutate = false;
    render(<ErrorLogSection />);

    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ }));
    const clearBtn = screen.getByRole("button", { name: "مسح السجل" });
    expect(clearBtn).toBeDisabled();

    fireEvent.click(clearBtn);
    // Assert the *effect*, not just the disabled attribute: handleClear itself
    // also rejects the call, so the log survives even if a click somehow reaches it.
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("clears the log when canMutate allows it", () => {
    logError("test-context", new Error("boom"));
    render(<ErrorLogSection />);

    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ }));
    fireEvent.click(screen.getByRole("button", { name: "مسح السجل" }));

    expect(screen.getByText("لا توجد أخطاء مسجّلة.")).toBeInTheDocument();
  });

  it("refreshes the badge count on an interval instead of only at mount", () => {
    vi.useFakeTimers();
    render(<ErrorLogSection />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    logError("late-error", new Error("arrived after mount"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("ErrorLogSection — workspace export", () => {
  function openPanel() {
    render(<ErrorLogSection />);
    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ }));
  }

  it("exports the workspace-wide log, not just this browser's ring buffer", async () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    await waitFor(() => expect(exportMock.run).toHaveBeenCalledWith(workspaceMock.handle, expect.anything()));
  });

  it("disables the export button while an export is running", async () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    let resolve!: (v: { rowCount: number }) => void;
    exportMock.run.mockReturnValue(new Promise((r) => { resolve = r; }));
    openPanel();

    const button = screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_exporting })).toBeDisabled());

    await act(async () => { resolve({ rowCount: 3 }); });
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn })).toBeEnabled());
  });

  it("reports an empty export as empty rather than as a silent success", async () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    exportMock.run.mockResolvedValue({ rowCount: 0 });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    expect(await screen.findByRole("status")).toHaveTextContent(DEFAULT_LABELS.errlog_export_empty);
  });

  it("surfaces a thrown export as an in-page alert, not an unhandled rejection", async () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    exportMock.run.mockRejectedValue(new Error("boom"));
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(DEFAULT_LABELS.errlog_export_failed);
  });

  it("hides the export button when no workspace is connected", () => {
    workspaceMock.handle = null;
    openPanel();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.errlog_export_btn })).not.toBeInTheDocument();
  });
});
