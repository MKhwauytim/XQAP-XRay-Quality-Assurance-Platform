/* @vitest-environment jsdom */
// The provider computes a coded diagnostic for nine workspace states
// (XQ-WS-001/002/003/008/009/010/014/015 …) and stores it in `message` — and
// `WorkspacePicker` rendered fixed labels only, so every one of them was
// computed and then discarded. Same "the app knows and doesn't say" shape as
// the error-code work.
//
// It bites hardest here of anywhere: the error log lives behind Settings, which
// requires a mounted workspace, so when workspace selection fails this screen is
// the ONLY surface the user can read anything from. A failed pick also set
// status "error", which fell straight through to `children` — dropping the user
// on the LOGIN screen with no indication anything had gone wrong.
//
// Both tests fail against the pre-fix component: the coded text was absent, and
// the error state rendered the children instead of a card.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkspaceStatus } from "./workspaceTypes";

const workspaceMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("./useWorkspace", () => ({
  useWorkspace: () => workspaceMock.value,
}));

import { WorkspacePicker } from "./WorkspaceGate";

function mountWith(status: WorkspaceStatus, message: string) {
  workspaceMock.value = {
    isSupported: true,
    status,
    message,
    pendingReconnect: false,
    selectWorkspace: vi.fn(),
    reconnectWorkspace: vi.fn(),
    enterDemoWorkspace: vi.fn(),
  };
  render(
    <WorkspacePicker>
      <div>LOGIN SCREEN</div>
    </WorkspacePicker>
  );
}

afterEach(cleanup);

describe("WorkspacePicker surfaces what the provider worked out", () => {
  it("shows a coded diagnostic on the picker screen", () => {
    mountWith("not_selected", "«تعذر إعادة الاتصال بمساحة العمل.» (XQ-WS-010)");

    expect(screen.getByText(/XQ-WS-010/)).toBeInTheDocument();
  });

  it("does not repeat the ordinary no-workspace-yet text under itself", () => {
    // The default message carries no code, so it must not be echoed as a
    // second paragraph below the card's own copy.
    mountWith("not_selected", "لم يتم اختيار مساحة العمل بعد.");

    // The card shows its own `wsgate_picker_select_msg`; the provider's
    // uncoded default must not be appended as a second paragraph beneath it.
    expect(screen.queryByText(/XQ-/)).not.toBeInTheDocument();
    expect(screen.queryByText("لم يتم اختيار مساحة العمل بعد.")).not.toBeInTheDocument();
  });

  it("does not silently drop the user on the login screen when the pick failed", () => {
    mountWith("error", "«تعذر اختيار مجلد مساحة العمل.» (XQ-WS-003)");

    // Pre-fix: children rendered and this assertion failed.
    expect(screen.queryByText("LOGIN SCREEN")).not.toBeInTheDocument();
    expect(screen.getByText(/XQ-WS-003/)).toBeInTheDocument();
  });

  it("still renders children once a workspace is mounted", () => {
    // The gate must not become a wall: a ready workspace passes through.
    mountWith("ready", "تم فتح مساحة العمل.");

    expect(screen.getByText("LOGIN SCREEN")).toBeInTheDocument();
  });
});
