import { beforeEach, describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import {
  countUnsentAnswers,
  loadPendingAnswerItems,
  loadPendingAnswerRecords,
  queueAnswerForLanding,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

const item = (id: string, savedAt: string): ItemAnswer => ({
  xrayImageId: id, templateId: "t", templateVersion: 1, answers: [],
  lastSavedAt: savedAt, submittedAt: savedAt, answeredBy: "u1", status: "submitted",
});

describe("queueAnswerForLanding", () => {
  beforeEach(() => installFreshIndexedDb());

  it("stores the item as unsent together with its event identity", async () => {
    const identity = { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" };
    expect(await queueAnswerForLanding("10-October-2026", "u1", item("A", "2026-10-13T10:00:00.000Z"), identity)).toBe(true);
    const pending = await loadPendingAnswerRecords("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].identity).toEqual(identity);
    expect(await countUnsentAnswers("u1")).toBe(1);
    expect(await countUnsentAnswers()).toBe(1);
    expect(await countUnsentAnswers("someone-else")).toBe(0);
  });

  it("a later submit of the same image replaces the earlier unsent one", async () => {
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:05:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:05:00.000Z" });
    const pending = await loadPendingAnswerRecords("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].identity?.eventId).toBe("e2");
  });

  it("an older submit never replaces a newer unsent one", async () => {
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:05:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:05:00.000Z" });
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    expect((await loadPendingAnswerRecords("u1"))[0].identity?.eventId).toBe("e2");
  });

  it("loadPendingAnswerItems returns only this month's unsent items", async () => {
    await queueAnswerForLanding("m1", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    await queueAnswerForLanding("m2", "u1", item("B", "2026-10-13T10:00:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:00:00.000Z" });
    expect((await loadPendingAnswerItems("m1", "u1")).map((i) => i.xrayImageId)).toEqual(["A"]);
  });

  it("returns false (not a fake success) when IndexedDB is unavailable", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" })).toBe(false);
  });
});
