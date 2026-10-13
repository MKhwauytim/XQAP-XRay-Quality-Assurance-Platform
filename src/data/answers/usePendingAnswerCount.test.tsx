/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";
import { mirrorAnswerLocally, queueAnswerForLanding } from "./answerLocalMirror";
import { usePendingAnswerCount } from "./usePendingAnswerCount";
import type { ItemAnswer } from "./answerTypes";

const item: ItemAnswer = {
  xrayImageId: "A", templateId: "t", templateVersion: 1, answers: [], lastSavedAt: "2026-10-13T10:00:00.000Z",
  submittedAt: "2026-10-13T10:00:00.000Z", answeredBy: "u1", status: "submitted",
};
const identity = (id: string) => ({ eventId: id, eventAt: item.lastSavedAt });

describe("usePendingAnswerCount", () => {
  beforeEach(() => { cleanup(); installFreshIndexedDb(); });

  it("reports queued items and drops to 0 after confirmation plus a data refresh", async () => {
    await queueAnswerForLanding("m", "u1", item, identity("e1"));
    const { result } = renderHook(() => usePendingAnswerCount({ username: "u1", month: "m" }));
    await waitFor(() => expect(result.current).toBe(1));

    await mirrorAnswerLocally("m", "u1", item);
    await act(async () => { broadcastDataRefresh("manual"); });
    await waitFor(() => expect(result.current).toBe(0));
  });

  it("counts across all months when month is omitted", async () => {
    await queueAnswerForLanding("m1", "u1", item, identity("e1"));
    await queueAnswerForLanding("m2", "u1", { ...item, xrayImageId: "B" }, identity("e2"));
    const { result } = renderHook(() => usePendingAnswerCount({ username: "u1" }));
    await waitFor(() => expect(result.current).toBe(2));
  });
});
