import { describe, expect, it } from "vitest";
import {
  alignPortNames,
  buildCertScanPortIndex,
  matchXrayIdAgainstPortEntries,
  normalizeCertScanXrayId,
  parseCertScanPasteText,
  splitXrayIdSegments
} from "./certScanParser";

/**
 * All fixtures below use ID shapes taken verbatim from the owner's real month
 * (see the segmentation comment block in `certScanParser.ts`):
 *
 *   Shape A  [deviceCode][YYYYMMDD][sequence]   96601PB04|20260501|0138
 *   Shape B  [YYYYMMDD][deviceCode][sequence]   20260509|002368|0130
 */
function pasteFor(portName: string, ...serials: string[]): string {
  return ["Port Name\tSystem S/N", ...serials.map((s) => `${portName}\t${s}`)].join("\n");
}

function matchAt(portName: string, paste: string, xrayImageId: string): boolean {
  const { entriesByPopulationPort } = buildCertScanPortIndex(
    parseCertScanPasteText(paste),
    [portName]
  );
  return matchXrayIdAgainstPortEntries(
    normalizeCertScanXrayId(xrayImageId),
    entriesByPopulationPort.get(portName) ?? []
  ).matched;
}

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

    // Shape A: [deviceCode][YYYYMMDD][sequence] — the serial leads the ID.
    const match = matchXrayIdAgainstPortEntries(
      normalizeCertScanXrayId("SN99900ZZ-20260504-0021"),
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

describe("splitXrayIdSegments", () => {
  it("splits shape A — device code leads, date follows", () => {
    expect(splitXrayIdSegments("96601PB04202605010138")).toEqual({
      head: "96601PB04",
      tail: "0138",
      hasEmbeddedDate: true
    });
  });

  it("splits shape B — date leads, device code follows", () => {
    expect(splitXrayIdSegments("202605090023680130")).toEqual({
      head: "",
      tail: "0023680130",
      hasEmbeddedDate: true
    });
  });

  it("skips an invalid leading date-like run to find the real date", () => {
    // "20202605" is not a date (month 26); the real date starts at index 2.
    expect(splitXrayIdSegments("2020260528339424")).toEqual({
      head: "20",
      tail: "339424",
      hasEmbeddedDate: true
    });
  });

  it("degrades to a whole-ID head when no date can be parsed", () => {
    expect(splitXrayIdSegments("10B1926050200158")).toEqual({
      head: "10B1926050200158",
      tail: "",
      hasEmbeddedDate: false
    });
  });
});

describe("CertScan snippet matching — anchoring (both directions)", () => {
  const PORT = "ميناء جده الاسلامي";

  // ── Direction 1: the FALSE POSITIVES that exist today ────────────────────
  // Every real X-ray ID embeds the scan date, so a substring matcher lets any
  // date-shaped serial match essentially the whole population. Measured on the
  // real month: "2026" substring-matched 117,268 of 117,337 rows (99.94%).
  describe("must NOT match — date fragments and sequence-digit coincidences", () => {
    it.each([
      ["2026", "202605090023680130", "year fragment vs a date-leading ID"],
      ["2026", "6184202605040021", "year fragment vs a device-led ID"],
      ["0260", "6184202605040021", "date fragment straddling year/month"],
      ["202605", "202605090023680130", "full year+month fragment"],
      ["20260504", "6184202605040021", "the embedded date itself"]
    ])("rejects serial %s against %s (%s)", (serial, xrayId) => {
      expect(matchAt(PORT, pasteFor(PORT, serial), xrayId)).toBe(false);
    });

    it.each([
      // Real coincidences observed in the month's data: the serial appears only
      // inside the trailing sequence number, never on a segment boundary.
      ["2366", "9520260503422366"],
      ["2366", "4820260502366986"],
      ["6184", "6620260516184616"],
      ["6192", "9520260531661924"]
    ])("rejects serial %s buried in the sequence digits of %s", (serial, xrayId) => {
      expect(matchAt(PORT, pasteFor(PORT, serial), xrayId)).toBe(false);
    });
  });

  // ── Direction 2: the FALSE NEGATIVES over-tightening would create ────────
  // Anchoring on `startsWith` alone would destroy shape B entirely: on the real
  // month it drops legitimate matches from 20,239 rows to 174.
  describe("must STILL match — every legitimate shape", () => {
    it("matches shape A: device code is the ID prefix", () => {
      expect(matchAt(PORT, pasteFor(PORT, "96601PB04"), "96601PB04202605010138")).toBe(true);
    });

    it("matches shape B: device code sits AFTER the leading date", () => {
      // This is the case a naive `startsWith` fix silently breaks.
      expect(matchAt(PORT, pasteFor(PORT, "851530"), "202605278515300519")).toBe(true);
      expect(matchAt(PORT, pasteFor(PORT, "002368"), "202605090023680130")).toBe(true);
    });

    it("matches a serial-family stem, not just the exact device code", () => {
      // Head-prefix rather than head-equality: pasting the shared `96601` stem
      // still matches every 96601xxxx device at that port.
      expect(matchAt(PORT, pasteFor(PORT, "96601"), "96601PB04202605010138")).toBe(true);
      expect(matchAt(PORT, pasteFor(PORT, "96601"), "96601MB13202605220003")).toBe(true);
    });

    it("matches a punctuated / lowercased paste of the same serial", () => {
      expect(matchAt(PORT, pasteFor(PORT, "96601-pb-04"), "96601PB04202605010138")).toBe(true);
    });

    it("matches a short numeric device code on a segment boundary", () => {
      expect(matchAt(PORT, pasteFor(PORT, "6184"), "6184202605040021")).toBe(true);
      expect(matchAt(PORT, pasteFor(PORT, "22501"), "22501202605060001")).toBe(true);
    });

    it("still matches an ID with no parseable date, by plain prefix", () => {
      expect(matchAt(PORT, pasteFor(PORT, "10B1926"), "10B1926050200158")).toBe(true);
    });

    it("reports the matching snippet and the original pasted serial", () => {
      const { entriesByPopulationPort } = buildCertScanPortIndex(
        parseCertScanPasteText(pasteFor(PORT, "SN-96601-PB04")),
        [PORT]
      );
      const result = matchXrayIdAgainstPortEntries(
        normalizeCertScanXrayId("96601PB04202605010138"),
        entriesByPopulationPort.get(PORT) ?? []
      );

      expect(result.matched).toBe(true);
      // The paste's "SN" prefix is not part of the ID, so the whole-serial
      // snippet "SN96601PB04" cannot anchor; the `96601` part snippet does.
      // The reported snippet is the one that actually anchored.
      expect(result.snippet).toBe("96601");
      expect(result.originalSerial).toBe("SN-96601-PB04");
    });
  });

  it("still never matches across ports", () => {
    expect(matchAt("الدمام", pasteFor(PORT, "96601PB04"), "96601PB04202605010138")).toBe(false);
  });
});
