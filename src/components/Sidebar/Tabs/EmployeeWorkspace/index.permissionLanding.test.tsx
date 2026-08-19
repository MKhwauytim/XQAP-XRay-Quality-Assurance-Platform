/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { getLabels } from "../../../../data/labels/labelsStore";

// Permission-aware landing sub-tab. Unlike index.test.tsx (which grants every
// permission), this suite drives `canAccessTab` from a mutable allow-set so a
// role that cannot view the default landing sub-tab can be exercised.
const permMock = vi.hoisted(() => ({
  allowed: new Set<string>(),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canAccessTab: (tabId: string) => permMock.allowed.has(tabId),
    role: "employee",
    featurePermissions: [] as { role: string; featureId: string; enabled: boolean }[],
  }),
}));

// The feature gate is exercised by its own suite; here the page-permission
// allow-set is the only variable, so this always passes.
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

function allow(...tabIds: string[]) {
  permMock.allowed = new Set(tabIds);
}

function switchTo(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

function accessDenied() {
  return screen.queryByText(getLabels().access_denied_title);
}

describe("EmployeeWorkspaceTab permission-aware landing sub-tab", () => {
  beforeEach(() => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  });

  afterEach(() => {
    cleanup();
    permMock.allowed = new Set();
    for (const key of Object.keys(mountCounts) as (keyof typeof mountCounts)[]) {
      mountCounts[key] = 0;
    }
  });

  it("lands a user without referrals access on the first sub-tab they can view", () => {
    allow("ew/xray-results");
    render(<EmployeeWorkspaceTab />);

    expect(screen.getByTestId("view-xray-results")).toBeInTheDocument();
    expect(screen.getByTestId("view-xray-results").parentElement).not.toHaveAttribute("hidden");
    expect(accessDenied()).not.toBeInTheDocument();
    expect(mountCounts["xray-referrals"]).toBe(0);
  });

  it("honours the fallback order when several sub-tabs are permitted", () => {
    allow("ew/referral-approval", "ew/xray-results", "ew/inspection-form");
    render(<EmployeeWorkspaceTab />);

    expect(screen.getByTestId("view-referral-approval")).toBeInTheDocument();
    expect(screen.queryByTestId("view-xray-results")).not.toBeInTheDocument();
    expect(accessDenied()).not.toBeInTheDocument();
  });

  it("leaves a user who can view referrals exactly where they land today", () => {
    allow("ew/xray-referrals", "ew/xray-results", "ew/referral-approval", "ew/inspection-form");
    render(<EmployeeWorkspaceTab />);

    expect(screen.getByTestId("view-xray-referrals")).toBeInTheDocument();
    expect(screen.getByTestId("view-xray-referrals").parentElement).not.toHaveAttribute("hidden");
    // No redirect churn: the landing view mounts once and nothing else mounts.
    expect(mountCounts["xray-referrals"]).toBe(1);
    expect(mountCounts["referral-approval"]).toBe(0);
    expect(mountCounts["xray-results"]).toBe(0);
    expect(mountCounts["inspection-form"]).toBe(0);
    expect(accessDenied()).not.toBeInTheDocument();
  });

  it("still shows AccessDenied when no sub-tab is permitted", () => {
    allow();
    render(<EmployeeWorkspaceTab />);

    expect(accessDenied()).toBeInTheDocument();
    expect(screen.queryByTestId("view-xray-referrals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("view-xray-results")).not.toBeInTheDocument();
  });

  it("does not yank a user off a sub-tab they navigated to that was later revoked", () => {
    allow("ew/xray-referrals", "ew/xray-results");
    const { rerender } = render(<EmployeeWorkspaceTab />);
    expect(screen.getByTestId("view-xray-referrals")).toBeInTheDocument();

    switchTo("xray-results");
    expect(screen.getByTestId("view-xray-results").parentElement).not.toHaveAttribute("hidden");

    // Results access is revoked while the user is sitting on it.
    allow("ew/xray-referrals");
    rerender(<EmployeeWorkspaceTab />);

    expect(accessDenied()).toBeInTheDocument();
    expect(screen.queryByTestId("view-xray-results")).not.toBeInTheDocument();
    // The user is not silently teleported back to referrals.
    expect(screen.getByTestId("view-xray-referrals").parentElement).toHaveAttribute("hidden");
  });
});
