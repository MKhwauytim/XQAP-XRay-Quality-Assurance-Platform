import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import { describeFlushResult } from "./sendNowResult";

const L = DEFAULT_LABELS;
const base = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 };

describe("describeFlushResult", () => {
  it("reports what landed", () => {
    expect(describeFlushResult({ ...base, replayed: 3, alreadyOnDisk: 1 }, L)).toEqual([
      L.ew_answers_send_ok.replace("{count}", "4"),
    ]);
  });

  it("names every reason answers stayed unsent, with counts and the last error", () => {
    const lines = describeFlushResult({
      ...base, replayed: 1, failed: 2, cannotLand: 5, lastError: "NotAllowedError",
      blocked: { "month-closed": 1, "folder-missing": 3, "folder-unreachable": 1 },
    }, L);
    expect(lines).toEqual([
      L.ew_answers_send_ok.replace("{count}", "1"),
      L.ew_answers_send_blocked_month_closed.replace("{count}", "1"),
      L.ew_answers_send_blocked_folder_missing.replace("{count}", "3"),
      L.ew_answers_send_blocked_folder_unreachable.replace("{count}", "1").replace("{error}", "NotAllowedError"),
      L.ew_answers_send_failed.replace("{count}", "2").replace("{error}", "NotAllowedError"),
    ]);
  });

  it("says another tab is sending when the pass was skipped", () => {
    expect(describeFlushResult({ ...base, skipped: true }, L)).toEqual([L.ew_answers_send_busy]);
  });

  it("is never empty", () => {
    expect(describeFlushResult(base, L)).toEqual([L.ew_answers_send_nothing]);
  });
});
