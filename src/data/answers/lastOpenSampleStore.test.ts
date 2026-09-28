/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetLastOpenSample,
  pickAutoSelectId,
  readLastOpenSample,
  rememberLastOpenSample,
} from "./lastOpenSampleStore";

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

  describe("forgetLastOpenSample (A1 fix round 1: explicit close)", () => {
    it("clears the remembered sample for the month it was recorded under", () => {
      rememberLastOpenSample("emp1", "5-may-2026", "IMG-3");
      forgetLastOpenSample("emp1", "5-may-2026");
      expect(readLastOpenSample("emp1", "5-may-2026")).toBeNull();
    });

    it("does not clear a DIFFERENT month's remembered sample", () => {
      rememberLastOpenSample("emp1", "5-may-2026", "IMG-3");
      forgetLastOpenSample("emp1", "6-june-2026");
      expect(readLastOpenSample("emp1", "5-may-2026")).toBe("IMG-3");
    });

    it("is a no-op when nothing is remembered", () => {
      expect(() => forgetLastOpenSample("emp1", "5-may-2026")).not.toThrow();
    });
  });

  describe("sessionStorage throwing (private window / blocked site data)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("degrades to old behaviour without crashing when storage access throws", () => {
      const throwing: Partial<Storage> = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      vi.stubGlobal("sessionStorage", throwing);

      expect(() => rememberLastOpenSample("emp1", "5-may-2026", "IMG-3")).not.toThrow();
      expect(readLastOpenSample("emp1", "5-may-2026")).toBeNull();
      expect(() => forgetLastOpenSample("emp1", "5-may-2026")).not.toThrow();
    });
  });
});
