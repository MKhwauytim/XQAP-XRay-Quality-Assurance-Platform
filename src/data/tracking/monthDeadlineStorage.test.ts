import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  clearMonthDeadline,
  formatDeadlineDate,
  isDeadlineInMonth,
  loadMonthDeadline,
  parseDeadlineDate,
  resolveDeadline,
  saveMonthDeadline,
} from "./monthDeadlineStorage";

const OCT = "10-october-2026";

describe("deadline date helpers", () => {
  it("parses real days only", () => {
    expect(parseDeadlineDate("2026-10-27")?.getDate()).toBe(27);
    expect(parseDeadlineDate("2026-02-30")).toBeNull();
    expect(parseDeadlineDate("27/10/2026")).toBeNull();
  });

  it("round-trips through format", () => {
    expect(formatDeadlineDate(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  it("accepts a day only inside the month folder's month", () => {
    expect(isDeadlineInMonth(OCT, "2026-10-01")).toBe(true);
    expect(isDeadlineInMonth(OCT, "2026-11-01")).toBe(false);
    expect(isDeadlineInMonth(OCT, "2025-10-15")).toBe(false);
    expect(isDeadlineInMonth("not-a-month", "2026-10-15")).toBe(false);
  });
});

describe("resolveDeadline", () => {
  it("defaults to the distribution deadline: last day − 3", () => {
    const r = resolveDeadline(2026, 10, null);
    expect(r.source).toBe("default");
    expect(formatDeadlineDate(r.date)).toBe("2026-10-28");
    // February of a leap year: 29 − 3
    expect(formatDeadlineDate(resolveDeadline(2028, 2, null).date)).toBe("2028-02-26");
  });

  it("uses a valid override", () => {
    const o = { date: "2026-10-20", updatedAt: "x", updatedBy: "admin" };
    const r = resolveDeadline(2026, 10, o);
    expect(r.source).toBe("override");
    expect(formatDeadlineDate(r.date)).toBe("2026-10-20");
  });

  it("ignores an override from another month", () => {
    const r = resolveDeadline(2026, 10, { date: "2026-11-05", updatedAt: "x", updatedBy: "admin" });
    expect(r.source).toBe("default");
  });
});

describe("month deadline storage", () => {
  it("is null before anything is saved", async () => {
    expect(await loadMonthDeadline(createMemoryDirectory(), OCT)).toBeNull();
  });

  it("round-trips an override for one month without touching another", async () => {
    const root = createMemoryDirectory();
    expect((await saveMonthDeadline(root, OCT, "2026-10-20", "admin")).ok).toBe(true);
    expect((await saveMonthDeadline(root, "9-september-2026", "2026-09-22", "admin")).ok).toBe(true);
    expect(await loadMonthDeadline(root, OCT)).toMatchObject({ date: "2026-10-20", updatedBy: "admin" });
    expect(await loadMonthDeadline(root, "9-september-2026")).toMatchObject({ date: "2026-09-22" });
  });

  it("rejects a date outside the month and writes nothing", async () => {
    const root = createMemoryDirectory();
    const r = await saveMonthDeadline(root, OCT, "2026-11-02", "admin");
    expect(r.ok).toBe(false);
    expect(await loadMonthDeadline(root, OCT)).toBeNull();
  });

  it("clearing restores the default for that month only", async () => {
    const root = createMemoryDirectory();
    await saveMonthDeadline(root, OCT, "2026-10-20", "admin");
    await saveMonthDeadline(root, "9-september-2026", "2026-09-22", "admin");
    expect((await clearMonthDeadline(root, OCT)).ok).toBe(true);
    expect(await loadMonthDeadline(root, OCT)).toBeNull();
    expect(await loadMonthDeadline(root, "9-september-2026")).not.toBeNull();
  });

  it("concurrent saves for different months both land (CAS)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveMonthDeadline(root, OCT, "2026-10-20", "a"),
      saveMonthDeadline(root, "9-september-2026", "2026-09-22", "b"),
    ]);
    expect(await loadMonthDeadline(root, OCT)).not.toBeNull();
    expect(await loadMonthDeadline(root, "9-september-2026")).not.toBeNull();
  });
});
