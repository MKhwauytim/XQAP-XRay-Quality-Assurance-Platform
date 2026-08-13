/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

import { AdminToolbar } from "./AdminToolbar";
import type { AuthSession } from "./authTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../data/month/globalMonthLogic";
import { getLabels } from "../data/labels/labelsStore";

const MONTH = "5-May-2026";

const mocks = vi.hoisted(() => ({
  directoryHandle: { name: "workspace-root" },
  refreshPermissions: vi.fn(async () => true),
  runSync: vi.fn(async () => ({ ran: true, ok: true, changed: new Set(), broadcast: true })),
  selection: { kind: "existing", folderName: "5-May-2026", month: 5, year: 2026 },
}));

vi.mock("../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({
    directoryHandle: mocks.directoryHandle as unknown as DirectoryHandleLike,
    refreshPermissions: mocks.refreshPermissions,
  }),
}));
vi.mock("../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: mocks.selection as GlobalMonthSelection }),
}));
vi.mock("../components/GlobalMonthSelector/GlobalMonthSelector", () => ({
  GlobalMonthSelector: () => <div data-testid="global-month-selector" />,
}));
vi.mock("../data/workspace/workspaceSync", () => ({
  runSync: mocks.runSync,
}));

const session: AuthSession = {
  role: "employee",
  username: "amal",
  loginAt: new Date().toISOString(),
};

function renderToolbar() {
  return render(
    <AdminToolbar
      session={session}
      previewRole={null}
      onPreviewRoleChange={() => {}}
      onLogout={() => {}}
      onFeedback={() => {}}
    />
  );
}

/** Queried by class, not by accessible name: the name changes with the state
 *  (running/success/failed), which is exactly what these tests assert on. */
function refreshButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".auth-toolbar-refresh");
  if (!button) throw new Error("refresh button not rendered");
  return button;
}

describe("AdminToolbar — the manual sync trigger", () => {
  beforeEach(() => {
    mocks.runSync.mockClear();
    mocks.runSync.mockResolvedValue({ ran: true, ok: true, changed: new Set(), broadcast: true });
    mocks.refreshPermissions.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("calls the SAME runSync the timer calls, with manual: true and the current workspace/month", async () => {
    renderToolbar();
    fireEvent.click(refreshButton());

    await waitFor(() => expect(mocks.runSync).toHaveBeenCalledTimes(1));
    expect(mocks.runSync).toHaveBeenCalledWith({
      manual: true,
      directoryHandle: mocks.directoryHandle,
      monthFolderName: MONTH,
      refreshPermissions: mocks.refreshPermissions,
    });
    // The toolbar no longer calls refreshPermissions itself — runSync owns it,
    // so both triggers share one permission-refresh path.
    expect(mocks.refreshPermissions).not.toHaveBeenCalled();
  });

  it("goes running → success and back to idle after 2s", async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    mocks.runSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ran: true, ok: true, changed: new Set(), broadcast: true });
        })
    );

    renderToolbar();
    fireEvent.click(refreshButton());

    // running: spinner + disabled, so a second click cannot start a second run.
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().className).toContain("is-running");
    expect(refreshButton().querySelector(".is-spinning")).not.toBeNull();
    expect(refreshButton().getAttribute("title")).toBe(getLabels().toolbar_refresh_running);
    fireEvent.click(refreshButton());
    expect(mocks.runSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      release!();
      await Promise.resolve();
    });

    expect(refreshButton().className).toContain("is-success");
    expect(refreshButton().disabled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(refreshButton().className).not.toContain("is-success");
    expect(refreshButton().getAttribute("title")).toBe(getLabels().toolbar_refresh_label);
  });

  it("shows the failed state when runSync reports ok: false", async () => {
    mocks.runSync.mockResolvedValue({ ran: true, ok: false, changed: new Set(), broadcast: true });
    renderToolbar();
    fireEvent.click(refreshButton());

    await waitFor(() => expect(refreshButton().className).toContain("is-failed"));
    expect(refreshButton().getAttribute("title")).toBe(getLabels().toolbar_refresh_failed);
  });

  it("is rendered for a non-admin role too (the refresh button is not admin-gated)", () => {
    renderToolbar();
    expect(refreshButton()).toBeTruthy();
  });

  it("is not rendered at all for a demo/viewer session", () => {
    render(
      <AdminToolbar
        session={{ ...session, role: "admin", username: "viewer", mode: "demo" }}
        previewRole={null}
        onPreviewRoleChange={() => {}}
        onLogout={() => {}}
        onFeedback={() => {}}
      />
    );
    expect(document.querySelector(".auth-toolbar-refresh")).toBeNull();
  });
});
