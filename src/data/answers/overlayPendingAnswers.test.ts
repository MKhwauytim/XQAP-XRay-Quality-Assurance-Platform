import { describe, expect, it } from "vitest";
import { overlayPendingAnswers } from "./overlayPendingAnswers";
import type { ItemAnswer } from "./answerTypes";

const mk = (id: string, at: string): ItemAnswer => ({
  xrayImageId: id, templateId: "t", templateVersion: 1, answers: [], lastSavedAt: at,
  submittedAt: at, answeredBy: "u1", status: "submitted",
});

describe("overlayPendingAnswers", () => {
  it("lets a pending item newer than disk win", () => {
    const out = overlayPendingAnswers([mk("A", "2026-10-13T10:00:00.000Z")], [mk("A", "2026-10-13T11:00:00.000Z")]);
    expect(out).toHaveLength(1);
    expect(out[0].lastSavedAt).toBe("2026-10-13T11:00:00.000Z");
  });

  it("keeps the disk item when the pending one is older", () => {
    const out = overlayPendingAnswers([mk("A", "2026-10-13T11:00:00.000Z")], [mk("A", "2026-10-13T10:00:00.000Z")]);
    expect(out).toHaveLength(1);
    expect(out[0].lastSavedAt).toBe("2026-10-13T11:00:00.000Z");
  });

  it("adds a pending item whose image is absent on disk", () => {
    const out = overlayPendingAnswers([mk("A", "2026-10-13T10:00:00.000Z")], [mk("B", "2026-10-13T10:00:00.000Z")]);
    expect(out.map((i) => i.xrayImageId).sort()).toEqual(["A", "B"]);
  });

  it("emits one entry per xrayImageId", () => {
    const out = overlayPendingAnswers(
      [mk("A", "2026-10-13T10:00:00.000Z"), mk("B", "2026-10-13T10:00:00.000Z")],
      [mk("A", "2026-10-13T12:00:00.000Z"), mk("B", "2026-10-13T09:00:00.000Z"), mk("C", "2026-10-13T09:00:00.000Z")],
    );
    expect(out.map((i) => i.xrayImageId).sort()).toEqual(["A", "B", "C"]);
  });

  it("does not mutate its inputs", () => {
    const disk = [mk("A", "2026-10-13T10:00:00.000Z")];
    const pending = [mk("A", "2026-10-13T11:00:00.000Z"), mk("B", "2026-10-13T11:00:00.000Z")];
    const d = JSON.stringify(disk);
    const p = JSON.stringify(pending);
    overlayPendingAnswers(disk, pending);
    expect(JSON.stringify(disk)).toBe(d);
    expect(JSON.stringify(pending)).toBe(p);
  });
});
