import { describe, it, expect } from "vitest";
import { toCsvString } from "./csvSerializer";

describe("toCsvString", () => {
  it("produces UTF-8 BOM header + comma-separated header row", () => {
    const result = toCsvString(["a", "b"], []);
    expect(result.startsWith("﻿")).toBe(true);
    expect(result).toContain("a,b");
  });

  it("serializes a simple row", () => {
    const result = toCsvString(["name", "count"], [{ name: "ميناء A", count: 42 }]);
    expect(result).toContain("ميناء A,42");
  });

  it("wraps values containing commas in double quotes", () => {
    const result = toCsvString(["v"], [{ v: "hello, world" }]);
    expect(result).toContain('"hello, world"');
  });

  it("escapes double quotes by doubling them", () => {
    const result = toCsvString(["v"], [{ v: 'say "hi"' }]);
    expect(result).toContain('"say ""hi"""');
  });

  it("converts null to empty string", () => {
    const result = toCsvString(["v"], [{ v: null }]);
    const lines = result.split("\n");
    expect(lines[1].trim()).toBe(",".repeat(0)); // single empty column
  });

  it("converts boolean to 1/0", () => {
    const result = toCsvString(["a", "b"], [{ a: true, b: false }]);
    expect(result).toContain("1,0");
  });

  it("handles missing key as empty", () => {
    const result = toCsvString(["a", "b"], [{ a: "x" }]);
    // b is undefined → empty
    expect(result).toContain("x,");
  });
});
