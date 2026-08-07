import { describe, expect, it } from "vitest";
import {
  alignPortNames,
  buildCertScanPortIndex,
  matchXrayIdAgainstPortEntries,
  normalizeCertScanXrayId,
  parseCertScanPasteText
} from "./certScanParser";

describe("parseCertScanPasteText", () => {
  it("parses tab-delimited paste with an Arabic header", () => {
    const text = "اسم المنفذ\tSystem S/N\nميناء جدة الإسلامي\tSN-12345-AB";
    const entries = parseCertScanPasteText(text);

    expect(entries).toHaveLength(1);
    expect(entries[0].portName).toBe("ميناء جده الاسلامي");
    expect(entries[0].snippets).toContain("SN12345AB");
  });

  it("returns an empty list when required columns are missing", () => {
    expect(parseCertScanPasteText("Foo\tBar\n1\t2")).toEqual([]);
  });
});

describe("alignPortNames — matching ladder", () => {
  it("aligns identical port names at the exact tier", () => {
    const result = alignPortNames(["ميناء جدة"], ["ميناء جدة"]);

    expect(result.alignments).toEqual([
      { populationPortName: "ميناء جدة", pastePortName: "ميناء جدة", tier: "exact" }
    ]);
    expect(result.unmatchedPastePorts).toEqual([]);
    expect(result.unmatchedPopulationPorts).toEqual([]);
  });

  it("aligns spellings differing only by tatweel padding at the normalized tier", () => {
    // Population spells it "منفذ البطحاة", the CertScan paste pads it with tatweel
    // kashida characters — a naming-convention divergence that would previously
    // miss this port's entire CertScan bucket.
    const result = alignPortNames(["منفذ الـبطحاة"], ["منفذ البطحاة"]);

    expect(result.alignments).toHaveLength(1);
    expect(result.alignments[0].tier).toBe("normalized");
    expect(result.unmatchedPopulationPorts).toEqual([]);
  });

  it("aligns names differing by a port-type descriptor word at the fuzzy tier only", () => {
    const result = alignPortNames(["ميناء الدمام"], ["الدمام"]);

    expect(result.alignments).toHaveLength(1);
    expect(result.alignments[0].tier).toBe("fuzzy");
  });

  it("reports a population port with no CertScan match at any tier as unmatched", () => {
    const result = alignPortNames(["منفذ الرياض"], ["منفذ جدة"]);

    expect(result.alignments).toEqual([]);
    expect(result.unmatchedPopulationPorts).toEqual(["منفذ جدة"]);
    expect(result.unmatchedPastePorts).toEqual(["منفذ الرياض"]);
  });

  it("is deterministic: repeated calls with the same input produce the same alignment", () => {
    const paste = ["منفذ جدة", "منفذ الدمام"];
    const population = ["منفذ جدة", "منفذ الدمام", "منفذ الرياض"];

    const first = alignPortNames(paste, population);
    const second = alignPortNames(paste, population);

    expect(second).toEqual(first);
  });
});

describe("buildCertScanPortIndex + matchXrayIdAgainstPortEntries", () => {
  it("matches an X-ray ID against entries aligned via a looser tier", () => {
    const entries = parseCertScanPasteText(
      "Port Name\tSystem S/N\nميناء الدمام\tSN-99900-ZZ"
    );

    const { entriesByPopulationPort } = buildCertScanPortIndex(entries, ["الدمام"]);
    const portEntries = entriesByPopulationPort.get("الدمام") ?? [];

    expect(portEntries).toHaveLength(1);

    const match = matchXrayIdAgainstPortEntries(
      normalizeCertScanXrayId("IMG-SN99900ZZ-001"),
      portEntries
    );

    expect(match.matched).toBe(true);
  });

  it("never matches a population port that has no CertScan alignment", () => {
    const entries = parseCertScanPasteText(
      "Port Name\tSystem S/N\nمنفذ جدة\tSN-12345-AB"
    );

    const { entriesByPopulationPort } = buildCertScanPortIndex(entries, ["منفذ الرياض"]);

    expect(entriesByPopulationPort.has("منفذ الرياض")).toBe(false);
  });
});
