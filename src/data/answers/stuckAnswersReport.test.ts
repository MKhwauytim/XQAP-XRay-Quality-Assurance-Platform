import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("../storage/errorLogger", () => ({ logError }));

import { __resetStuckAnswersReportForTests, reportStuckAnswers } from "./stuckAnswersReport";

const base = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 3 };

describe("reportStuckAnswers", () => {
  beforeEach(() => {
    logError.mockClear();
    __resetStuckAnswersReportForTests();
  });

  it("logs each blocked cause with the employee, count and months", () => {
    reportStuckAnswers("emp1", {
      ...base,
      lastError: "NotAllowedError",
      blocked: { "folder-unreachable": { count: 2, months: ["5-may-2026"] }, "month-closed": { count: 1, months: ["4-april-2026"] } },
    });

    expect(logError).toHaveBeenCalledTimes(2);
    const [context, error, meta] = logError.mock.calls[0];
    expect(context).toBe("answers:stuck-unsent");
    expect((error as Error).message).toContain("2 answer(s) by emp1");
    expect((error as Error).message).toContain("folder-unreachable (NotAllowedError)");
    expect((error as Error).message).toContain("5-may-2026");
    expect(meta).toEqual({ action: "stuck-unsent:folder-unreachable" });
  });

  it("logs the same cause and months only once per session", () => {
    const summary = { ...base, blocked: { "folder-missing": { count: 3, months: ["5-may-2026"] } } };
    reportStuckAnswers("emp1", summary);
    reportStuckAnswers("emp1", summary);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("logs nothing when nothing is blocked", () => {
    reportStuckAnswers("emp1", { ...base, cannotLand: 0 });
    expect(logError).not.toHaveBeenCalled();
  });
});
