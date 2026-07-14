import { describe, it, expect } from "vitest";
import { coverMeshSvg, dividerPatternSvg } from "./generativeArt";

describe("coverMeshSvg (trianglify, headless)", () => {
  it("returns a non-empty <svg> string", () => {
    const svg = coverMeshSvg("5-may-2026");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain("</svg>");
  });

  it("is byte-identical for the same seed (deterministic per report)", () => {
    expect(coverMeshSvg("5-may-2026")).toBe(coverMeshSvg("5-may-2026"));
  });

  it("differs for different seeds", () => {
    expect(coverMeshSvg("5-may-2026")).not.toBe(coverMeshSvg("6-june-2026"));
  });
});

describe("dividerPatternSvg (geopattern, headless)", () => {
  it("returns a non-empty <svg> string", () => {
    const svg = dividerPatternSvg("5-may-2026__section1", "#f4b400");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });

  it("is deterministic for the same seed + color", () => {
    expect(dividerPatternSvg("5-may-2026__section1", "#f4b400")).toBe(
      dividerPatternSvg("5-may-2026__section1", "#f4b400"),
    );
  });

  it("differs for different seeds", () => {
    expect(dividerPatternSvg("5-may-2026__section1", "#f4b400")).not.toBe(
      dividerPatternSvg("5-may-2026__section2", "#f4b400"),
    );
  });
});
