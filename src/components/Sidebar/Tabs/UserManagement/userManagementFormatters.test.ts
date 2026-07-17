import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration } from "./userManagementFormatters";

describe("user-management formatters", () => {
  it("formats durations with Arabic labels and Latin digits", () => {
    expect(formatDuration(90 * 60_000)).toBe("1س 30د");
  });

  it("keeps the existing no-sign-out and invalid-date fallbacks", () => {
    expect(formatDateTime(null)).toBe("لم يسجل خروج");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
