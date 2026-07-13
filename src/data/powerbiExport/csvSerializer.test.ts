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

  // ── Formula-injection mitigation ──────────────────────────────────────────
  it("neutralizes a leading '=' formula string with an apostrophe", () => {
    const lines = toCsvString(["v"], [{ v: "=1+1" }]).split("\n");
    // No comma/quote/newline → not wrapped, just prefixed with '.
    expect(lines[1]).toBe("'=1+1");
  });

  it("wraps AND prefixes a formula string that also contains a comma", () => {
    const result = toCsvString(["v"], [{ v: "=A1,B1" }]);
    expect(result).toContain('"\'=A1,B1"');
  });

  it("neutralizes strings starting with +, -, @", () => {
    const rows = [{ v: "+cmd" }, { v: "-2+3" }, { v: "@SUM(A1)" }];
    const lines = toCsvString(["v"], rows).split("\n");
    expect(lines[1]).toBe("'+cmd");
    expect(lines[2]).toBe("'-2+3");
    // @SUM(A1) has no comma/quote/newline → not wrapped, just prefixed.
    expect(lines[3]).toBe("'@SUM(A1)");
  });

  it("neutralizes strings starting with a tab or carriage return", () => {
    const lines = toCsvString(["v"], [{ v: "\t=danger" }, { v: "\r=danger" }]).split("\n");
    expect(lines[1].startsWith("'\t")).toBe(true);
    expect(lines[2].startsWith("'\r") || lines[1].includes("'\r")).toBe(true);
  });

  it("does NOT prefix a pure negative number", () => {
    const result = toCsvString(["v"], [{ v: -5 }]);
    const lines = result.split("\n");
    expect(lines[1]).toBe("-5");
  });

  it("does not touch a benign leading-letter string", () => {
    const result = toCsvString(["v"], [{ v: "ميناء" }]);
    expect(result).toContain("ميناء");
    expect(result).not.toContain("'ميناء");
  });
});
