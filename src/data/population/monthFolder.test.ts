import { expect, test } from "vitest";

import {
  formatMonthFolderName,
  parseMonthFolderName
} from "./monthFolder";

test("formatMonthFolderName produces MM-MonthName-YYYY", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-May-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-December-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-January-2024");
});

test("formatMonthFolderName throws on invalid month", () => {
  expect(() => formatMonthFolderName(0, 2026)).toThrow(RangeError);
  expect(() => formatMonthFolderName(13, 2026)).toThrow(RangeError);
});

test("parseMonthFolderName round-trips formatMonthFolderName", () => {
  for (let month = 1; month <= 12; month++) {
    const name = formatMonthFolderName(month, 2026);
    const parsed = parseMonthFolderName(name);
    expect(parsed).not.toBeNull();
    expect(parsed?.month).toBe(month);
    expect(parsed?.year).toBe(2026);
    expect(parsed?.folderName).toBe(name);
  }
});

test("parseMonthFolderName returns null for invalid names", () => {
  expect(parseMonthFolderName("5-May")).toBeNull();
  expect(parseMonthFolderName("May-5-2026")).toBeNull();
  expect(parseMonthFolderName("5-Xyz-2026")).toBeNull();
  expect(parseMonthFolderName("random")).toBeNull();
  expect(parseMonthFolderName("")).toBeNull();
});
