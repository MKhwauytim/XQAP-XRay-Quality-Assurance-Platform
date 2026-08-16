/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";

// Audit finding 14: canViewXrayReferrals/canViewReferralApproval now read
// hasRequiredSubTabFeature(subTabId, role, featurePermissions) instead of
// `can()`, so this mock must supply `role` and `featurePermissions` (all
// features enabled for every role -- this suite grants full access, matching
// the pre-existing `can: () => true`).
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canAccessTab: () => true,
    role: "admin",
    featurePermissions: [] as { role: string; featureId: string; enabled: boolean }[],
  }),
}));

vi.mock("../../../../auth/subTabFeatureGate", () => ({
  hasRequiredSubTabFeature: () => true,
}));

const workspaceMock = vi.hoisted(() => ({
  handle: null as DirectoryHandleLike | null,
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.handle }),
}));

const mountCounts = vi.hoisted(() => ({
  "xray-referrals": 0,
  "referral-approval": 0,
  "xray-results": 0,
  "inspection-form": 0,
}));

vi.mock("./views/XrayReferrals", () => ({
  default: () => {
    mountCounts["xray-referrals"] += 1;
    return <div data-testid="view-xray-referrals" />;
  },
}));
vi.mock("./views/ReferralApproval", () => ({
  default: () => {
    mountCounts["referral-approval"] += 1;
    return <div data-testid="view-referral-approval" />;
  },
}));
vi.mock("./views/XrayInspectionResults", () => ({
  default: () => {
    mountCounts["xray-results"] += 1;
    return <div data-testid="view-xray-results" />;
  },
}));
vi.mock("../TemplateBuilder", () => ({
  default: () => {
    mountCounts["inspection-form"] += 1;
    return <div data-testid="view-inspection-form" />;
  },
}));

import EmployeeWorkspaceTab from "./index";

function switchTo(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

describe("EmployeeWorkspaceTab sub-tab mount preservation (§T)", () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(mountCounts) as (keyof typeof mountCounts)[]) {
      mountCounts[key] = 0;
    }
  });

  it("keeps a visited sub-tab mounted when switching away and back", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);
    expect(mountCounts["xray-referrals"]).toBe(1);

    switchTo("xray-results");
    expect(mountCounts["xray-results"]).toBe(1);
    expect(mountCounts["xray-referrals"]).toBe(1); // still mounted, not remounted

    switchTo("xray-referrals");
    expect(mountCounts["xray-referrals"]).toBe(1); // switching back does NOT remount it
  });

  it("hides an inactive but visited sub-tab instead of unmounting it", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);
    switchTo("xray-results");

    const referrals = screen.getByTestId("view-xray-referrals").parentElement;
    expect(referrals).toHaveAttribute("hidden");
  });

  it("never mounts a sub-tab the user hasn't visited yet", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);

    expect(mountCounts["referral-approval"]).toBe(0);
    expect(screen.queryByTestId("view-referral-approval")).not.toBeInTheDocument();
  });
});
