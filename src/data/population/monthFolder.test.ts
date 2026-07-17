import { expect, test } from "vitest";

import {
  formatMonthFolderName,
  formatMonthFolderShortLabel,
  formatMonthShortLabel,
  parseMonthFolderName
} from "./monthFolder";

test("formatMonthFolderName produces MM-monthname-YYYY (lowercase)", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-may-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-december-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-january-2024");
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

test("month display labels are Arabic without changing the folder format", () => {
  expect(formatMonthShortLabel(5, 2026)).toBe("مايو 2026");
  expect(formatMonthFolderShortLabel("12-december-2025")).toBe("ديسمبر 2025");
  expect(formatMonthFolderShortLabel("legacy-folder")).toBe("legacy-folder");
});
