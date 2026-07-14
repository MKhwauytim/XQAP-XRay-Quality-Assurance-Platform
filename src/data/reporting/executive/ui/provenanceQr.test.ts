import { describe, it, expect } from "vitest";
import { buildProvenanceString, generateProvenanceQrSvg } from "./provenanceQr";

describe("buildProvenanceString", () => {
  it("packs month key + file:rev pairs + generation date", () => {
    const s = buildProvenanceString(
      "5-may-2026",
      { "population.final.json": 7, "sample.master.json": 3 },
      new Date(2026, 6, 14), // local 2026-07-14
    );
    expect(s).toContain("5-may-2026");
    expect(s).toContain("population.final.json:7");
    expect(s).toContain("sample.master.json:3");
    expect(s).toContain("2026-07-14");
  });

  it("stays valid with no revisions (month + date only)", () => {
    const s = buildProvenanceString("5-may-2026", undefined, new Date(2026, 6, 14));
    expect(s).toContain("5-may-2026");
    expect(s).toContain("2026-07-14");
    expect(s).not.toContain("||"); // empty rev segment is dropped, not left blank
  });
});

describe("generateProvenanceQrSvg", () => {
  it("produces a scannable <svg> QR string", async () => {
    const svg = await generateProvenanceQrSvg("5-may-2026|population.final.json:7|2026-07-14");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    // dark-on-white for scanner contrast
    expect(svg.toLowerCase()).toContain("#ffffff");
  });
});
