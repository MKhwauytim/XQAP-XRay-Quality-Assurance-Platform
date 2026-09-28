/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const replay = vi.hoisted(() => vi.fn(async () => ({ replayed: 0, alreadyOnDisk: 0, failed: 0 })));
const prune = vi.hoisted(() => vi.fn());

vi.mock("./pendingAnswerReplay", () => ({ replayPendingAnswers: replay }));
vi.mock("./answerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./answerDraftStore")>()),
  pruneAnswerDrafts: prune,
}));
vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));

import { PENDING_REPLAY_INTERVAL_MS, PendingAnswerReplayRunner } from "./PendingAnswerReplayRunner";

beforeEach(() => {
  vi.useFakeTimers();
  replay.mockClear();
  prune.mockClear();
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("does not replay when disabled", () => {
    render(<PendingAnswerReplayRunner username="emp1" enabled={false} />);
    expect(replay).not.toHaveBeenCalled();
  });
});
