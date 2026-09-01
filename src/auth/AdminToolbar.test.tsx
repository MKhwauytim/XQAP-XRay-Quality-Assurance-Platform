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
  // Read by the admin-only DemoDebugPanel (rendered when debug mode is
  // toggled on for a real admin session) — not exercised by the non-admin
  // tests below, but the module still needs to export something callable.
  getSyncIntervalMs: () => 45_000,
  getLastSyncStartedAt: () => 0,
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

  it("keeps refresh AND the role-preview switch for a demo session (writable demo, 2026-08-26)", () => {
    render(
      <AdminToolbar
        session={{ ...session, role: "admin", username: "demo", mode: "demo" }}
        previewRole={null}
        onPreviewRoleChange={() => {}}
        onFeedback={() => {}}
      />
    );
    // The demo walks through every role's view with the SAME switch a real
    // admin gets — no separate demo control (owner request: "keep it as it is").
    expect(document.querySelector(".auth-toolbar-refresh")).not.toBeNull();
    expect(document.querySelector(".auth-role-switcher")).not.toBeNull();
    // Only the admin feedback button stays real-admin-only.
    expect(document.querySelector(".auth-toolbar-help")).toBeNull();
  });
});

describe("AdminToolbar — admin-only debug tools", () => {
  const demoSession: AuthSession = { ...session, role: "admin", username: "demo", mode: "demo" };
  const realAdminSession: AuthSession = { ...session, role: "admin", username: "admin" };

  afterEach(async () => {
    cleanup();
    const { __resetDemoDebugStoreForTests } = await import("../data/debug/demoDebugStore");
    __resetDemoDebugStoreForTests();
  });

  function debugToggle(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(".auth-toolbar-debug");
    if (!button) throw new Error("debug toggle not rendered");
    return button;
  }

  it("is not rendered for a demo session, even though it carries the admin role", () => {
    render(
      <AdminToolbar session={demoSession} previewRole={null} onPreviewRoleChange={() => {}} onFeedback={() => {}} />
    );
    expect(document.querySelector(".auth-toolbar-debug")).toBeNull();
  });

  it("is not rendered for a non-admin role", () => {
    renderToolbar();
    expect(document.querySelector(".auth-toolbar-debug")).toBeNull();
  });

  it("is rendered for a real admin session", () => {
    render(
      <AdminToolbar session={realAdminSession} previewRole={null} onPreviewRoleChange={() => {}} onFeedback={() => {}} />
    );
    expect(document.querySelector(".auth-toolbar-debug")).not.toBeNull();
  });

  it("toggles the debug panel and the export button on/off, and the panel's close button toggles it back off", () => {
    render(
      <AdminToolbar session={realAdminSession} previewRole={null} onPreviewRoleChange={() => {}} onFeedback={() => {}} />
    );

    expect(document.querySelector(".demo-debug-panel")).toBeNull();
    expect(document.querySelector(".auth-toolbar-debug-export")).toBeNull();

    fireEvent.click(debugToggle());
    expect(document.querySelector(".demo-debug-panel")).not.toBeNull();
    expect(document.querySelector(".auth-toolbar-debug-export")).not.toBeNull();
    expect(debugToggle().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(document.querySelector<HTMLButtonElement>(".demo-debug-panel-close")!);
    expect(document.querySelector(".demo-debug-panel")).toBeNull();
    expect(document.querySelector(".auth-toolbar-debug-export")).toBeNull();
  });

  it("records a sample for the debug panel when a manual refresh runs", async () => {
    mocks.runSync.mockResolvedValue({ ran: true, ok: true, changed: new Set(["distribution"]), broadcast: true });
    const { getSyncSamples, __clearSyncSamplesForTests } = await import("../data/debug/syncMetrics");
    __clearSyncSamplesForTests();

    render(
      <AdminToolbar session={realAdminSession} previewRole={null} onPreviewRoleChange={() => {}} onFeedback={() => {}} />
    );
    fireEvent.click(document.querySelector<HTMLButtonElement>(".auth-toolbar-refresh")!);

    await waitFor(() => expect(getSyncSamples()).toHaveLength(1));
    expect(getSyncSamples()[0]).toMatchObject({ ok: true, ran: true, broadcast: true, changedCount: 1 });
  });

  it("does not record a sample when a manual refresh runs for a demo session", async () => {
    const priorCalls = mocks.runSync.mock.calls.length;
    mocks.runSync.mockResolvedValue({ ran: true, ok: true, changed: new Set(["distribution"]), broadcast: true });
    const { getSyncSamples, __clearSyncSamplesForTests } = await import("../data/debug/syncMetrics");
    __clearSyncSamplesForTests();

    render(
      <AdminToolbar session={demoSession} previewRole={null} onPreviewRoleChange={() => {}} onFeedback={() => {}} />
    );
    fireEvent.click(document.querySelector<HTMLButtonElement>(".auth-toolbar-refresh")!);

    await waitFor(() => expect(mocks.runSync.mock.calls.length).toBe(priorCalls + 1));
    expect(getSyncSamples()).toHaveLength(0);
  });
});
