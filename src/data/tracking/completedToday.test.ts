// «المنجز اليوم»: the stats-strip tile reuses the tracking tab's «مكتملة في هذا
// اليوم» definition — state "completed" (hold excluded), day = local calendar
// day of doneAt (answer.submittedAt, else entry.lastEventAt).
import { describe, expect, it } from "vitest";
import type { ItemAnswer } from "../answers/answerTypes";
import { countCompletedOnDay, trackingDoneAt, type TrackingRow } from "./deadlineTracking";

const local = (y: number, m: number, d: number, h: number, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

describe("countCompletedOnDay", () => {
  const day = new Date(2026, 9, 14, 15, 30);

  it("counts completed rows finished within the LOCAL calendar day, bounds inclusive", () => {
    const rows: TrackingRow[] = [
      { assignedTo: "a", state: "completed", doneAt: local(2026, 10, 14, 0, 0) },
      { assignedTo: "a", state: "completed", doneAt: local(2026, 10, 14, 23, 59) },
      { assignedTo: "b", state: "completed", doneAt: local(2026, 10, 13, 23, 59) },
      { assignedTo: "b", state: "completed", doneAt: local(2026, 10, 15, 0, 0) },
    ];
    expect(countCompletedOnDay(rows, day)).toBe(2);
  });

  it("excludes hold, pending, unknown and unparseable dates; same day of another month/year does not count", () => {
    const rows: TrackingRow[] = [
      { assignedTo: "a", state: "hold", doneAt: local(2026, 10, 14, 9) },
      { assignedTo: "a", state: "pending", doneAt: null },
      { assignedTo: "a", state: "completed", doneAt: null },
      { assignedTo: "a", state: "completed", doneAt: "not-a-date" },
      { assignedTo: "a", state: "completed", doneAt: local(2026, 9, 14, 9) },
      { assignedTo: "a", state: "completed", doneAt: local(2025, 10, 14, 9) },
      { assignedTo: "a", state: "completed", doneAt: local(2026, 10, 14, 9) },
    ];
    expect(countCompletedOnDay(rows, day)).toBe(1);
  });
});

describe("trackingDoneAt", () => {
  const ans = { submittedAt: "2026-10-14T08:00:00.000Z" } as unknown as ItemAnswer;
  it("prefers answer.submittedAt, falls back to entry.lastEventAt, null when pending", () => {
    expect(trackingDoneAt("completed", ans, "2026-10-01T00:00:00.000Z")).toBe("2026-10-14T08:00:00.000Z");
    expect(trackingDoneAt("completed", null, "2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
    expect(trackingDoneAt("pending", ans, "2026-10-01T00:00:00.000Z")).toBeNull();
    expect(trackingDoneAt("hold", null, undefined)).toBeNull();
  });
});
