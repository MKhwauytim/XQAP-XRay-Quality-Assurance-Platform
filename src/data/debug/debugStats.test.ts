import { describe, expect, it } from "vitest";
import { summarizeMs } from "./debugStats";

describe("summarizeMs", () => {
  it("returns zeros for an empty list", () => {
    expect(summarizeMs([])).toEqual({ avgMs: 0, maxMs: 0, sampleCount: 0 });
  });

  it("computes avg/max/count rounded to one decimal", () => {
    expect(summarizeMs([10, 20, 33.33])).toEqual({
      avgMs: 21.1,
      maxMs: 33.3,
      sampleCount: 3,
    });
  });

  it("handles a single value", () => {
    expect(summarizeMs([16.666])).toEqual({ avgMs: 16.7, maxMs: 16.7, sampleCount: 1 });
  });
});
