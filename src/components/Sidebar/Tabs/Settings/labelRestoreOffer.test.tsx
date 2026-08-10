/* @vitest-environment jsdom */
// Fix round 1 (task-4 review): the restore-offer effect in SettingsPage
// (reads the workspace label snapshot on mount, decides whether to offer a
// restore, and applies it only on an explicit button press) had zero test
// coverage. These tests exercise the effect end to end rather than just the
// pure shouldOfferLabelRestore predicate, which the pre-existing tests
// already covered.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceContext, type WorkspaceContextValue } from "../../../../data/workspace/WorkspaceContext";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { getCustomLabelOverrides, resetAllLabels, setLabel } from "../../../../data/labels/labelsStore";
import * as labelsSnapshot from "../../../../data/workspace/labelsSnapshot";
import SettingsPage from "./index";

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    role: "admin",
    username: "tester",
    canAccessTab: () => true,
    can: () => true,
    canMutate: () => true,
    getMutationCapability: () => ({ allowed: true }),
    permissions: [],
    featurePermissions: [],
  }),
}));

function makeWorkspaceValue(overrides: Partial<WorkspaceContextValue>): WorkspaceContextValue {
  return {
    status: "ready",
    directoryHandle: createMemoryDirectory("workspace-root"),
    selectedDirectoryName: "workspace-root",
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

function renderSettings(workspaceOverrides: Partial<WorkspaceContextValue> = {}) {
  const value = makeWorkspaceValue(workspaceOverrides);
  return render(
    <WorkspaceContext.Provider value={value}>
      <SettingsPage />
    </WorkspaceContext.Provider>
  );
}

const RESTORE_TITLE = "تم فقد التسميات المخصصة";
const RESTORE_BUTTON = "استعادة التسميات من مجلد العمل";

beforeEach(() => {
  resetAllLabels();
});

afterEach(() => {
  cleanup();
  resetAllLabels();
  vi.restoreAllMocks();
});

describe("SettingsPage — label-override restore offer effect", () => {
  it("offers a restore when a workspace snapshot exists and no local overrides remain", async () => {
    vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(3);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(RESTORE_TITLE)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: RESTORE_BUTTON })).toBeInTheDocument();
  });

  it("does not offer a restore when the workspace snapshot has nothing to restore", async () => {
    vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(0);

    renderSettings();

    // Let the effect's promise resolve before asserting absence.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(RESTORE_TITLE)).not.toBeInTheDocument();
  });

  it("does not offer a restore when local overrides are already intact", async () => {
    setLabel("sidebar_title", "custom title");
    vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(3);

    renderSettings();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(RESTORE_TITLE)).not.toBeInTheDocument();
  });

  it("never applies the snapshot from the effect itself — only an explicit button press calls importLabelsSnapshot", async () => {
    vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(2);
    const importSpy = vi.spyOn(labelsSnapshot, "importLabelsSnapshot").mockResolvedValue(2);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(RESTORE_TITLE)).toBeInTheDocument();
    });
    // The effect alone (mount + resolved promise) must not have triggered a restore.
    expect(importSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: RESTORE_BUTTON }));

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });
    expect(importSpy).toHaveBeenCalledWith(expect.anything());
    // The offer clears itself once the explicit restore completes.
    await waitFor(() => {
      expect(screen.queryByText(RESTORE_TITLE)).not.toBeInTheDocument();
    });
  });

  it("does not offer a restore without a workspace directory handle", async () => {
    const readSpy = vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(5);

    renderSettings({ directoryHandle: null });

    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(RESTORE_TITLE)).not.toBeInTheDocument();
  });

  it("cross-checks against getCustomLabelOverrides directly: an empty override map plus a non-empty snapshot is what triggers the offer", async () => {
    expect(Object.keys(getCustomLabelOverrides())).toHaveLength(0);
    vi.spyOn(labelsSnapshot, "readLabelsSnapshotOverrideCount").mockResolvedValue(1);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(RESTORE_TITLE)).toBeInTheDocument();
    });
  });
});
