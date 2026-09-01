/* @vitest-environment jsdom */
// Basic render/gating coverage for the "سجل التحديثات" tab. The tab has no
// workspace dependency (its content is the build-time-generated
// LATEST_UPDATES array), so this stays a thin test: an admin session sees the
// list; a role with no explicit default permission (getRolePermission's
// "none" fallback — see tabCatalog.ts's comment on the "changelog" entry)
// sees AccessDenied instead.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { clearSession, writeSession } from "../../../../auth/authSession";
import type { AuthRole } from "../../../../auth/authTypes";
import { getLabels } from "../../../../data/labels/labelsStore";
import {
  emptyLoadedFiles,
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../../../../data/workspace/WorkspaceContext";
import ChangelogTab from "./index";

const workspaceStub: WorkspaceContextValue = {
  status: "not_selected",
  directoryHandle: null,
  selectedDirectoryName: "",
  loadedFiles: emptyLoadedFiles,
  missingItems: [],
  invalidItems: [],
  message: "",
  isSupported: true,
  pendingReconnect: false,
  selectWorkspace: async () => {},
  reconnectWorkspace: async () => {},
  reloadWorkspace: async () => {},
  refreshPermissions: async () => false,
  createInitialStructure: async () => {},
  clearWorkspace: () => {},
  enterDemoWorkspace: async () => {},
};

function renderAs(role: AuthRole) {
  writeSession({ role, username: role, loginAt: new Date().toISOString() });
  return render(
    <WorkspaceContext.Provider value={workspaceStub}>
      <ChangelogTab />
    </WorkspaceContext.Provider>
  );
}

describe("ChangelogTab", () => {
  afterEach(() => {
    clearSession();
    cleanup();
  });

  it("renders the latest-updates list for admin (always full access)", () => {
    renderAs("admin");
    expect(screen.getByText(getLabels().changelog_title)).toBeInTheDocument();
  });

  it("shows AccessDenied for a role with no explicit default permission", () => {
    renderAs("employee");
    expect(screen.queryByText(getLabels().changelog_title)).not.toBeInTheDocument();
  });
});
