import { describe, expect, it } from "vitest";
import { DATA_PAGE_SIZE, clampPage, pageSlice } from "./paginationUtils";

describe("paginationUtils", () => {
  it("uses 100 rows per page and returns the requested window", () => {
    const rows = Array.from({ length: 205 }, (_, index) => index + 1);

    expect(DATA_PAGE_SIZE).toBe(100);
    expect(pageSlice(rows, 1)).toEqual(rows.slice(0, 100));
    expect(pageSlice(rows, 2)).toEqual(rows.slice(100, 200));
    expect(pageSlice(rows, 3)).toEqual(rows.slice(200, 205));
  });

  it("clamps page numbers to the available range", () => {
    expect(clampPage(0, 205)).toBe(1);
    expect(clampPage(99, 205)).toBe(3);
    expect(clampPage(4, 0)).toBe(1);
  });
});
