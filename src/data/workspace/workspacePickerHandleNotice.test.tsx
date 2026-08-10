/* @vitest-environment jsdom */
// Fix round 1 (task-4 review): the sawCheckingRef/resolvedOnceRef status-
// transition gate and the file://-origin branch in WorkspacePicker had zero
// test coverage — only the label copy itself was asserted
// (handleLossMessage.test.tsx). These tests exercise the actual
// effect-driven state machine.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { WorkspaceContext, type WorkspaceContextValue } from "./WorkspaceContext";
import { WorkspacePicker } from "./WorkspaceGate";

vi.mock("../../auth/authConfig", () => ({
  ADMIN_SHORTCUT_KEYS: [],
  VIEWER_PASSWORD: "unused",
}));

const persistenceMock = vi.hoisted(() => ({ state: "unknown" as "granted" | "denied" | "unsupported" | "unknown" }));
vi.mock("../storage/storageRegistry", () => ({
  getPersistenceState: () => persistenceMock.state,
  // Mirrors the real storageRegistry.wasStoragePreviouslyPersisted: "granted"
  // short-circuits to true, otherwise falls back to navigator.storage.persisted()
  // (absent in jsdom by default, so it resolves false in these tests).
  wasStoragePreviouslyPersisted: async () => {
    if (persistenceMock.state === "granted") return true;
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage || typeof storage.persisted !== "function") return false;
    try {
      return await storage.persisted();
    } catch {
      return false;
    }
  },
}));

const originMock = vi.hoisted(() => ({ isFile: false }));
vi.mock("./originDetection", () => ({
  isFileOrigin: () => originMock.isFile,
}));

afterEach(() => {
  cleanup();
  persistenceMock.state = "unknown";
  originMock.isFile = false;
});

function makeContextValue(overrides: Partial<WorkspaceContextValue>): WorkspaceContextValue {
  return {
    status: "checking",
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

const LOST_TITLE = "تم فقد الارتباط بمجلد العمل";
const UNKNOWN_TITLE = "اختيار مجلد العمل";

function renderPicker(value: WorkspaceContextValue) {
  return render(
    <WorkspaceContext.Provider value={value}>
      <WorkspacePicker>
        <div data-testid="app-content">app</div>
      </WorkspacePicker>
    </WorkspaceContext.Provider>
  );
}

describe("WorkspacePicker — handle-loss notice status-transition gate", () => {
  it("shows the loss notice on a checking -> not_selected transition WITH prior persistence", async () => {
    persistenceMock.state = "granted";
    const { rerender } = renderPicker(makeContextValue({ status: "checking" }));
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "not_selected" })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText(LOST_TITLE)).toBeInTheDocument();
    });
  });

  it("does NOT show the loss notice on the same transition WITHOUT prior persistence", async () => {
    persistenceMock.state = "unknown"; // navigator.storage is also absent in jsdom by default
    const { rerender } = renderPicker(makeContextValue({ status: "checking" }));
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "not_selected" })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );

    // Give any pending microtask a chance to resolve before asserting absence.
    // The base picker card always renders once status is "not_selected", so
    // waiting for it is a reliable "settled" signal.
    await waitFor(() => {
      expect(screen.getByText("اختر مساحة العمل")).toBeInTheDocument();
    });
    expect(screen.queryByText(LOST_TITLE)).not.toBeInTheDocument();
  });

  it("does NOT re-show the notice on a later user-driven not_selected transition", async () => {
    persistenceMock.state = "unknown";
    const { rerender } = renderPicker(makeContextValue({ status: "checking" }));

    const notSelected = makeContextValue({ status: "not_selected" });
    rerender(
      <WorkspaceContext.Provider value={notSelected}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );
    await waitFor(() => expect(screen.queryByText(LOST_TITLE)).not.toBeInTheDocument());

    // Simulate persistence now reporting "granted" (e.g. a race) and the user
    // cancelling a re-opened picker (checking -> not_selected again). The
    // first automatic resolution already happened, so this must not trigger
    // the notice even though the heuristic would now say "lost".
    persistenceMock.state = "granted";
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "checking" })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "not_selected" })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );

    // Settle any pending microtasks, then assert the notice stayed hidden.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(LOST_TITLE)).not.toBeInTheDocument();
  });

  it("does NOT show any notice while pendingReconnect is true (permission-only loss)", async () => {
    persistenceMock.state = "granted";
    const { rerender } = renderPicker(makeContextValue({ status: "checking" }));
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "not_selected", pendingReconnect: true })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(LOST_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN_TITLE)).not.toBeInTheDocument();
  });

  it("shows the conditional-free 'unknown' notice on a file:// origin instead of guessing a loss", async () => {
    originMock.isFile = true;
    persistenceMock.state = "unknown";
    const { rerender } = renderPicker(makeContextValue({ status: "checking" }));
    rerender(
      <WorkspaceContext.Provider value={makeContextValue({ status: "not_selected" })}>
        <WorkspacePicker>
          <div data-testid="app-content">app</div>
        </WorkspacePicker>
      </WorkspaceContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText(UNKNOWN_TITLE)).toBeInTheDocument();
    });
    expect(screen.queryByText(LOST_TITLE)).not.toBeInTheDocument();
  });
});
