/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { pickAutoSelectId, readLastOpenSample, rememberLastOpenSample } from "./lastOpenSampleStore";

beforeEach(() => {
  sessionStorage.clear();
});

describe("last-open sample (A1)", () => {
  it("remembers per user and month", () => {
    rememberLastOpenSample("emp1", "5-may-2026", "IMG-3");
    expect(readLastOpenSample("emp1", "5-may-2026")).toBe("IMG-3");
    expect(readLastOpenSample("emp1", "6-june-2026")).toBeNull();
    expect(readLastOpenSample("emp2", "5-may-2026")).toBeNull();
  });

  it("prefers the remembered sample only while it is in the list", () => {
    const rows = [{ xrayImageId: "IMG-1" }, { xrayImageId: "IMG-3" }];
    expect(pickAutoSelectId(rows, "IMG-3")).toBe("IMG-3");
    expect(pickAutoSelectId(rows, "IMG-9")).toBe("IMG-1");
    expect(pickAutoSelectId(rows, null)).toBe("IMG-1");
    expect(pickAutoSelectId([], "IMG-3")).toBeNull();
  });
});
