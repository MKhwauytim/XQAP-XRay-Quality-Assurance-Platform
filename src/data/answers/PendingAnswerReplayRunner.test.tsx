/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const replay = vi.hoisted(() => vi.fn(async () => ({ replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 })));
const prune = vi.hoisted(() => vi.fn());
const canMutate = vi.hoisted(() => vi.fn(() => true));
const isReadOnlyMode = vi.hoisted(() => vi.fn(() => false));

vi.mock("./pendingAnswerReplay", () => ({ replayPendingAnswers: replay }));
vi.mock("./answerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./answerDraftStore")>()),
  pruneAnswerDrafts: prune,
}));
vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));
vi.mock("../../auth/usePermissions", () => ({ usePermissions: () => ({ canMutate }) }));
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
});
