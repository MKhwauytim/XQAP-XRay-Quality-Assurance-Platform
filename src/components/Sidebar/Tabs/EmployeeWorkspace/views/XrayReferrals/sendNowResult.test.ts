import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import { describeFlushResult, flushLeftAnswersBehind } from "./sendNowResult";

const L = DEFAULT_LABELS;
const base = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 };

describe("describeFlushResult", () => {
  it("reports what landed", () => {
    expect(describeFlushResult({ ...base, replayed: 3, alreadyOnDisk: 1 }, L)).toEqual([
      L.ew_answers_send_ok.replace("{count}", "4"),
    ]);
  });

  it("names every reason answers stayed unsent, with counts, months and the last error", () => {
    const lines = describeFlushResult({
      ...base, replayed: 1, failed: 2, cannotLand: 6, lastError: "NotAllowedError",
      blocked: {
        "month-closed": { count: 1, months: ["11-November-2025"] },
        "folder-missing": { count: 3, months: ["12-December-2025", "adhoc-x"] },
        "folder-unreachable": { count: 1, months: ["12-December-2025"] },
        "not-responding": { count: 1, months: ["12-December-2025"] },
      },
    }, L);
    expect(lines).toEqual([
      L.ew_answers_send_ok.replace("{count}", "1"),
      L.ew_answers_send_blocked_month_closed.replace("{count}", "1").replace("{months}", "11-November-2025"),
      L.ew_answers_send_blocked_folder_missing.replace("{count}", "3").replace("{months}", "12-December-2025، adhoc-x"),
      L.ew_answers_send_blocked_folder_unreachable.replace("{count}", "1").replace("{months}", "12-December-2025").replace("{error}", "NotAllowedError"),
      L.ew_answers_send_blocked_not_responding.replace("{count}", "1").replace("{months}", "12-December-2025"),
      L.ew_answers_send_failed.replace("{count}", "2").replace("{error}", "NotAllowedError"),
    ]);
    expect(lines.join("\n")).not.toMatch(/\{\w+\}/);
  });

  it("says another tab is sending when the pass was skipped", () => {
    expect(describeFlushResult({ ...base, skipped: true }, L)).toEqual([L.ew_answers_send_busy]);
  });

  it("is never empty", () => {
    expect(describeFlushResult(base, L)).toEqual([L.ew_answers_send_nothing]);
  });

  it("offers a backup only when something was left behind", () => {
    expect(flushLeftAnswersBehind({ ...base, replayed: 2 })).toBe(false);
    expect(flushLeftAnswersBehind({ ...base, failed: 1 })).toBe(true);
    expect(flushLeftAnswersBehind({ ...base, cannotLand: 1 })).toBe(true);
    expect(flushLeftAnswersBehind({ ...base, skipped: true })).toBe(true);
  });
});
