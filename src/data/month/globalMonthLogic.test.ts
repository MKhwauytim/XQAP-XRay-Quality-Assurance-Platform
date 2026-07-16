import { describe, expect, it } from "vitest";
import type { MonthFolderInfo } from "../population/monthFolder";
import {
  latestMonthSelection,
  reconcileSelection,
  resolveInitialSelection,
} from "./globalMonthLogic";

const m = (month: number, year: number): MonthFolderInfo => ({
  month,
  year,
  folderName: `${month}-${["january","february","march","april","may","june","july","august","september","october","november","december"][month - 1]}-${year}`,
});

const MONTHS = [m(3, 2026), m(4, 2026), m(5, 2026)];

describe("latestMonthSelection", () => {
  it("picks the last folder in the list", () => {
    expect(latestMonthSelection(MONTHS)).toEqual({
      kind: "existing", month: 5, year: 2026, folderName: "5-may-2026",
    });
  });

  it("falls back to a pending current-calendar month when the list is empty", () => {
    const sel = latestMonthSelection([]);
    expect(sel.kind).toBe("pending");
    if (sel.kind === "pending") {
      expect(sel.month).toBe(new Date().getMonth() + 1);
      expect(sel.year).toBe(new Date().getFullYear());
    }
  });
});

describe("resolveInitialSelection", () => {
  it("restores a stored folder that still exists", () => {
    expect(resolveInitialSelection(MONTHS, "4-april-2026")).toEqual({
      kind: "existing", month: 4, year: 2026, folderName: "4-april-2026",
    });
  });

  it("falls back to latest when the stored folder is gone", () => {
    expect(resolveInitialSelection(MONTHS, "1-january-2020").folderName).toBe("5-may-2026");
  });

  it("falls back to latest when nothing is stored", () => {
    expect(resolveInitialSelection(MONTHS, null).folderName).toBe("5-may-2026");
  });
});

describe("reconcileSelection", () => {
  it("keeps an existing selection whose folder still exists", () => {
    const cur = { kind: "existing" as const, month: 4, year: 2026, folderName: "4-april-2026" };
    expect(reconcileSelection(MONTHS, cur)).toBe(cur);
  });

  it("moves to latest when the selected folder disappeared", () => {
    const cur = { kind: "existing" as const, month: 1, year: 2020, folderName: "1-january-2020" };
    expect(reconcileSelection(MONTHS, cur).folderName).toBe("5-may-2026");
  });

  it("promotes a pending month once its folder appears", () => {
    const cur = { kind: "pending" as const, month: 5, year: 2026, folderName: "5-may-2026" };
    expect(reconcileSelection(MONTHS, cur)).toEqual({
      kind: "existing", month: 5, year: 2026, folderName: "5-may-2026",
    });
  });

  it("keeps a pending month whose folder does not exist yet", () => {
    const cur = { kind: "pending" as const, month: 6, year: 2026, folderName: "6-june-2026" };
    expect(reconcileSelection(MONTHS, cur)).toBe(cur);
  });

  it("resolves 'none' to latest", () => {
    expect(reconcileSelection(MONTHS, { kind: "none" }).folderName).toBe("5-may-2026");
  });
});
