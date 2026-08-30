import { describe, expect, it, vi } from "vitest";
import {
  formatClock,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatOneDecimal,
  formatShortDayLabel,
  formatTimeOfDay,
} from "./userManagementFormatters";

describe("user-management formatters", () => {
  it("formats durations with Arabic labels and Latin digits", () => {
    expect(formatDuration(90 * 60_000)).toBe("1س 30د");
  });

  it("keeps the existing no-sign-out and invalid-date fallbacks", () => {
    expect(formatDateTime(null)).toBe("لم يسجل خروج");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("formats a full day-only label — weekday + day + month, no comma, Latin digits", () => {
    // 2026-08-27 is a Thursday.
    expect(formatDayLabel("2026-08-27")).toBe("الخميس 27 أغسطس");
  });

  it("falls back to the raw string for an unparseable day", () => {
    expect(formatDayLabel("not-a-day")).toBe("not-a-day");
  });

  it("formats a short day label — weekday + day only, no month", () => {
    expect(formatShortDayLabel("2026-08-27")).toBe("الخميس 27");
  });

  it("formats time-only, 24h, Latin digits", () => {
    vi.stubEnv("TZ", "UTC");
    try {
      expect(formatTimeOfDay("2026-08-27T09:15:00.000Z")).toBe("09:15");
      expect(formatTimeOfDay("2026-08-27T23:05:00.000Z")).toBe("23:05");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to an em dash for an unparseable time", () => {
    expect(formatTimeOfDay("not-a-time")).toBe("—");
  });

  it("formats a clock label without a leading zero on the hour", () => {
    expect(formatClock(7 * 60 + 30)).toBe("7:30");
    expect(formatClock(17 * 60 + 30)).toBe("17:30");
  });

  it("formats one decimal place with Latin digits", () => {
    expect(formatOneDecimal(3.5)).toBe("3.5");
    expect(formatOneDecimal(4)).toBe("4.0");
  });
});
