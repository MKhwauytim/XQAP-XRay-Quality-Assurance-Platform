/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const replay = vi.hoisted(() => vi.fn(async () => ({ replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 })));
const prune = vi.hoisted(() => vi.fn());
const canMutate = vi.hoisted(() => vi.fn((_featureId: string) => true));
const isReadOnlyMode = vi.hoisted(() => vi.fn(() => false));

vi.mock("./pendingAnswerReplay", () => ({ replayPendingAnswers: replay }));
vi.mock("./answerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./answerDraftStore")>()),
  pruneAnswerDrafts: prune,
}));
// A STABLE directoryHandle object -- unlike the real WorkspaceProvider
// context value, an inline object literal returned fresh on every mock call
// would itself change identity on every render, masking the exact
// canMutate-identity-churn bug the fix-round-2 tests below target.
const stableDirectoryHandle = vi.hoisted(() => ({ kind: "directory", name: "root" }));
vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: stableDirectoryHandle, status: "ready" }),
}));
// The real `usePermissions()` hands back a BRAND NEW `canMutate` closure on
// every call (it is not memoized) -- wrapping the shared spy in a fresh arrow
// function here, rather than returning the spy itself, reproduces that
// identity churn so the fix-round-2 "no needless effect teardown" tests
// below actually exercise the bug they cover.
vi.mock("../../auth/usePermissions", () => ({
  usePermissions: () => ({ canMutate: (featureId: string) => canMutate(featureId) }),
}));
vi.mock("../storage/readOnlyMode", () => ({ isReadOnlyMode }));

import { PENDING_REPLAY_INTERVAL_MS, PendingAnswerReplayRunner } from "./PendingAnswerReplayRunner";

beforeEach(() => {
  vi.useFakeTimers();
  replay.mockClear();
  prune.mockClear();
  canMutate.mockReset().mockReturnValue(true);
  isReadOnlyMode.mockReset().mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PendingAnswerReplayRunner", () => {
  it("prunes old drafts once, replays at mount, and again every interval", async () => {
    render(<PendingAnswerReplayRunner username="emp1" />);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(expect.anything(), "emp1");
    expect(canMutate).toHaveBeenCalledWith("submit-answers");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("does not replay when disabled", () => {
    render(<PendingAnswerReplayRunner username="emp1" enabled={false} />);
    expect(replay).not.toHaveBeenCalled();
  });

  // IMPORTANT 4 (fix round 1): a background poller must never write on the
  // signed-in user's behalf while the app is in demo/read-only mode.
  it("does not replay while the app is in read-only mode", async () => {
    isReadOnlyMode.mockReturnValue(true);
    render(<PendingAnswerReplayRunner username="emp1" />);
    expect(replay).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).not.toHaveBeenCalled();
  });

  // IMPORTANT 4 (fix round 1): a background poller must never write an
  // answer the signed-in role/permission state would not itself be allowed
  // to save -- gated on the SAME feature id the answer-save UI itself uses.
  it("does not replay without the submit-answers mutation capability", async () => {
    canMutate.mockReturnValue(false);
    render(<PendingAnswerReplayRunner username="emp1" />);
    expect(canMutate).toHaveBeenCalledWith("submit-answers");
    expect(replay).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).not.toHaveBeenCalled();
  });

  // Fix round 2 (minor): `canMutate`'s function IDENTITY changes on every
  // render of the real `usePermissions()` hook -- using it directly as an
  // effect dependency tore the interval down and fired an immediate extra
  // tick on every unrelated re-render. The effect must depend on the
  // DERIVED BOOLEAN instead, which only changes value when the underlying
  // permission state actually does.
  it("does not tear down and re-tick just because canMutate's identity changed across an unrelated re-render", async () => {
    const { rerender } = render(<PendingAnswerReplayRunner username="emp1" />);
    expect(replay).toHaveBeenCalledTimes(1);

    // Re-render with the same props and the same permission VALUE -- the
    // mock still hands back a brand-new canMutate closure, exactly like the
    // real hook would on any unrelated re-render of this component.
    rerender(<PendingAnswerReplayRunner username="emp1" />);
    expect(replay).toHaveBeenCalledTimes(1); // no extra synchronous tick from a needless teardown

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).toHaveBeenCalledTimes(2); // exactly one interval firing, not a duplicated one
  });

  // Fix round 2 (minor): the interval must install itself once the gate
  // flips from false to true (e.g. permissions finish loading after mount),
  // not only when it started out true.
  it("starts replaying once the mutation capability flips from false to true", async () => {
    canMutate.mockReturnValue(false);
    const { rerender } = render(<PendingAnswerReplayRunner username="emp1" />);
    expect(replay).not.toHaveBeenCalled();

    canMutate.mockReturnValue(true);
    rerender(<PendingAnswerReplayRunner username="emp1" />);
    expect(replay).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).toHaveBeenCalledTimes(2);
  });
});
