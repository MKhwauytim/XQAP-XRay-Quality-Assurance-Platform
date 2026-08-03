/* @vitest-environment jsdom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkspaceContext, type WorkspaceContextValue } from "./WorkspaceContext";
import { WorkspaceGate } from "./WorkspaceGate";
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
