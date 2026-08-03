/* @vitest-environment jsdom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceContext, type WorkspaceContextValue } from "./WorkspaceContext";
import { WorkspaceGate } from "./WorkspaceGate";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import * as populationStorage from "../population/populationStorage";
import type { AuthSession } from "../../auth/authTypes";

vi.mock("../../auth/authConfig", () => ({
  ADMIN_SHORTCUT_KEYS: [],
  VIEWER_PASSWORD: "unused",
}));

// Not part of the brief's test body verbatim, but required for environment
// stability: without it, the second test's render() leaves the first test's
// DOM in place (no other cleanup mechanism runs between `it` blocks in this
// project's vitest setup — see src/test-setup.ts), causing a spurious
// "multiple elements found" failure. Every other multi-test jsdom file in
// this repo (e.g. AuthGate.test.tsx, App.landing.test.tsx) already does this.
afterEach(cleanup);

function makeContextValue(overrides: Partial<WorkspaceContextValue>): WorkspaceContextValue {
  return {
    status: "ready",
    directoryHandle: null,
    selectedDirectoryName: "",
    loadedFiles: { manifest: null, usersPermissions: null, sampleMaster: null, sampleDistribution: null },
    missingItems: [],
    invalidItems: [],
    message: "",
    isSupported: true,
    pendingReconnect: false,
    usersHydrated: true,
    selectWorkspace: async () => {},
    reconnectWorkspace: async () => {},
    reloadWorkspace: async () => {},
    refreshPermissions: async () => true,
    createInitialStructure: async () => {},
    clearWorkspace: () => {},
    enterDemoWorkspace: async () => {},
    ...overrides,
  };
}

const session: AuthSession = { role: "employee", username: "alice", loginAt: new Date().toISOString() };
const adminSession: AuthSession = { role: "admin", username: "boss", loginAt: new Date().toISOString() };

describe("WorkspaceGate — usersHydrated render gate (Task 2)", () => {
  it("does not render children when status is ready but usersHydrated is false", () => {
    const value = makeContextValue({ status: "ready", usersHydrated: false });
    render(
      <WorkspaceContext.Provider value={value}>
        <WorkspaceGate session={session}>
          <div data-testid="app-content">app</div>
        </WorkspaceGate>
      </WorkspaceContext.Provider>
    );
    expect(screen.queryByTestId("app-content")).toBeNull();
  });

  it("renders children once status is ready AND usersHydrated is true", () => {
    const value = makeContextValue({ status: "ready", usersHydrated: true });
    render(
      <WorkspaceContext.Provider value={value}>
        <WorkspaceGate session={session}>
          <div data-testid="app-content">app</div>
        </WorkspaceGate>
      </WorkspaceContext.Provider>
    );
    expect(screen.queryByTestId("app-content")).not.toBeNull();
  });
});

describe("WorkspaceGate — FirstRunChecklist month-count refresh (Task 4)", () => {
  it("refreshes the month count on a visibility change but not also on a redundant focus event for the same user action", async () => {
    // Admin + ready workspace + empty months so the first-run banner renders
    // (FirstRunChecklist is admin-only and auto-hides once monthCount >= 1).
    const listSpy = vi.spyOn(populationStorage, "listMonthFolders").mockResolvedValue([]);
    const directoryHandle = createMemoryDirectory("workspace-root");
    const value = makeContextValue({
      status: "ready",
      usersHydrated: true,
      directoryHandle,
      selectedDirectoryName: "workspace-root",
    });

    render(
      <WorkspaceContext.Provider value={value}>
        <WorkspaceGate session={adminSession}>
          <div data-testid="app-content">app</div>
        </WorkspaceGate>
      </WorkspaceContext.Provider>
    );

    // Wait for the first-run banner itself, i.e. for the initial mount-time
    // listMonthFolders() read to resolve and monthCount to settle at 0.
    await screen.findByRole("complementary");
    const callsAfterMount = listSpy.mock.calls.length;

    // Simulate the single real-world user action of switching back to this
    // tab: visibilitychange (hidden -> visible) fires, and in most browsers a
    // focus event fires alongside it for the same action.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(listSpy.mock.calls.length).toBe(callsAfterMount + 1);
    });
  });
});
