import { describe, expect, it } from "vitest";
import {
  computeCertScanMatchPreview,
  IMPLAUSIBLY_HIGH_MATCH_PERCENTAGE,
  SUSPICIOUSLY_LOW_MATCH_PERCENTAGE
} from "./certScanMatchPreview";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";

/**
 * X-ray ID fixtures use the real shape `[deviceCode][YYYYMMDD][sequence]`
 * (see `certScanParser.ts`), so what these tests assert about matching is what
 * the real month actually does.
 */

function makeRow(overrides: Partial<NormalizedRiskRow>): NormalizedRiskRow {
  return {
    stage: "FIRST_STAGE",
    xrayImageId: "IMG0001",
    xrayEntryDate: null,
    portCode: null,
    portName: "منفذ جدة",
    portType: null,
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    transitDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    manifestDate: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: null,
    xrayLevelTwoResult: null,
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    movementType: "بري",
    targetedByRiskEngine: null,
    riskMessage: null,
    sourceSheetName: "بري",
    sourceRowNumber: 2,
    rawRow: {},
    ...overrides
  };
}

describe("computeCertScanMatchPreview", () => {
  it("reports no paste data when the paste text is empty", () => {
    const preview = computeCertScanMatchPreview([makeRow({})], "");
    expect(preview.hasPasteData).toBe(false);
    expect(preview.totalCertScanEntries).toBe(0);
  });

  it("computes total/matched counts and a per-port breakdown for a clean match", () => {
    // "منفذ الرياض" has no taa-marbuta/alef-hamza/tatweel characters, so parsing
    // the paste doesn't alter its spelling at all — a genuine exact-tier match.
    const rows = [
      makeRow({ xrayImageId: "SN12345-20260504-0001", portName: "منفذ الرياض" }),
      makeRow({ xrayImageId: "OTHER99-20260504-0002", portName: "منفذ الرياض" }),
      makeRow({ xrayImageId: "SN99999-20260504-0003", portName: "منفذ الدمام" })
    ];
    const paste = "Port Name\tSystem S/N\nمنفذ الرياض\tSN-12345\nمنفذ الدمام\tSN-99999";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.hasPasteData).toBe(true);
    expect(preview.totalCertScanEntries).toBe(2);
    expect(preview.totalPopulationRows).toBe(3);
    expect(preview.totalMatchedRows).toBe(2);
    expect(preview.pasteOnlyPorts).toEqual([]);
    expect(preview.populationOnlyPorts).toEqual([]);

    const riyadhRow = preview.portBreakdown.find((p) => p.populationPortName === "منفذ الرياض");
    expect(riyadhRow?.populationRowCount).toBe(2);
    expect(riyadhRow?.matchedRowCount).toBe(1);
    expect(riyadhRow?.tier).toBe("exact");
  });

  it("surfaces the ~30-vs-30,000-shaped failure: a port named differently in the paste matches nothing at the exact tier", () => {
    // Population has 3 rows at a port; CertScan paste names the SAME port with a
    // completely different spelling that shares nothing with it — this port
    // should show up in both pasteOnlyPorts and populationOnlyPorts, and its
    // breakdown row should show tier: null with 0 matches, instantly explaining
    // "why did I only get a few matches when I expected thousands".
    const rows = [
      makeRow({ xrayImageId: "AAA111-20260504-0001", portName: "منفذ الدمام" }),
      makeRow({ xrayImageId: "AAA222-20260504-0002", portName: "منفذ الدمام" }),
      makeRow({ xrayImageId: "AAA333-20260504-0003", portName: "منفذ الدمام" })
    ];
    // Deliberately unrelated port name string (not a spelling variant of "الدمام").
    const paste = "Port Name\tSystem S/N\nمركز الفحص الشرقي\tAAA111";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.totalPopulationRows).toBe(3);
    expect(preview.totalMatchedRows).toBe(0);
    expect(preview.populationOnlyPorts).toContain("منفذ الدمام");
    expect(preview.pasteOnlyPorts).toContain("مركز الفحص الشرقي");

    const dammamRow = preview.portBreakdown.find((p) => p.populationPortName === "منفذ الدمام");
    expect(dammamRow?.tier).toBeNull();
    expect(dammamRow?.matchedRowCount).toBe(0);
  });

  it("discloses a looser-than-exact port alignment via looseTierAlignments", () => {
    const rows = [makeRow({ xrayImageId: "SN555-20260504-0001", portName: "منفذ الدمام" })];
    // Paste names it with the "ميناء" descriptor instead of "منفذ" — fuzzy tier.
    const paste = "Port Name\tSystem S/N\nميناء الدمام\tSN-555";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.looseTierAlignments).toEqual([
      { populationPortName: "منفذ الدمام", pastePortName: "ميناء الدمام", tier: "fuzzy" }
    ]);
    expect(preview.totalMatchedRows).toBe(1);
  });


  // ── Part 1: the match-rate plausibility flags, in BOTH directions ────────
  describe("match-rate plausibility flags", () => {
    function rowsAtPort(port: string, n: number, device: string): NormalizedRiskRow[] {
      return Array.from({ length: n }, (_, i) =>
        makeRow({
          portName: port,
          xrayImageId: `${device}-20260504-${String(i + 1).padStart(4, "0")}`
        })
      );
    }

    it("flags an implausibly LOW match rate", () => {
      // 1 of 100 rows carries the pasted device -> 1%.
      const rows = [
        ...rowsAtPort("منفذ الرياض", 1, "SN12345"),
        ...rowsAtPort("منفذ الرياض", 99, "OTHER99")
      ];
      const preview = computeCertScanMatchPreview(
        rows,
        "Port Name\tSystem S/N\nمنفذ الرياض\tSN-12345"
      );

      expect(preview.totalMatchedRows).toBe(1);
      expect(preview.totalMatchPercentage).toBeLessThan(SUSPICIOUSLY_LOW_MATCH_PERCENTAGE);
      expect(preview.isSuspiciouslyLowMatch).toBe(true);
      expect(preview.isImplausiblyHighMatch).toBe(false);
    });

    it("flags an implausibly HIGH match rate — the over-matching mirror image", () => {
      // Every row carries the pasted device -> 100%. Before this flag existed,
      // an over-matching paste produced a confidently-wrong preview with no
      // warning at all, which is how a fabricated CertScan split could ship.
      const rows = rowsAtPort("منفذ الرياض", 100, "SN12345");
      const preview = computeCertScanMatchPreview(
        rows,
        "Port Name\tSystem S/N\nمنفذ الرياض\tSN-12345"
      );

      expect(preview.totalMatchedRows).toBe(100);
      expect(preview.totalMatchPercentage).toBe(100);
      expect(preview.isImplausiblyHighMatch).toBe(true);
      expect(preview.isSuspiciouslyLowMatch).toBe(false);
    });

    it("leaves a plausible mid-range match rate unflagged in both directions", () => {
      // 40% — comfortably clear of both thresholds, and above the 17.31% ceiling
      // the real month's most generous legitimate paste produces.
      const rows = [
        ...rowsAtPort("منفذ الرياض", 40, "SN12345"),
        ...rowsAtPort("منفذ الرياض", 60, "OTHER99")
      ];
      const preview = computeCertScanMatchPreview(
        rows,
        "Port Name\tSystem S/N\nمنفذ الرياض\tSN-12345"
      );

      expect(preview.totalMatchPercentage).toBe(40);
      expect(preview.isSuspiciouslyLowMatch).toBe(false);
      expect(preview.isImplausiblyHighMatch).toBe(false);
    });

    it("does not flag a low rate when there are no candidate population rows at all", () => {
      // 0 rows -> percentage is a meaningless 0, not evidence of a bad paste.
      const preview = computeCertScanMatchPreview(
        [makeRow({ xrayImageId: "-" })],
        "Port Name\tSystem S/N\nمنفذ الرياض\tSN-12345"
      );

      expect(preview.totalPopulationRows).toBe(0);
      expect(preview.isSuspiciouslyLowMatch).toBe(false);
      expect(preview.isImplausiblyHighMatch).toBe(false);
    });

    it("keeps the two thresholds ordered and non-overlapping", () => {
      expect(SUSPICIOUSLY_LOW_MATCH_PERCENTAGE).toBeLessThan(IMPLAUSIBLY_HIGH_MATCH_PERCENTAGE);
    });
  });

  it("ignores rows with an invalid or duplicate X-ray ID, matching processPopulation's own candidate rules", () => {
    const rows = [
      makeRow({ xrayImageId: "SN12345-20260504-0001", portName: "منفذ جدة" }),
      makeRow({ xrayImageId: "SN12345-20260504-0001", portName: "منفذ جدة" }), // duplicate
      makeRow({ xrayImageId: "-", portName: "منفذ جدة" }) // invalid
    ];
    const paste = "Port Name\tSystem S/N\nمنفذ جدة\tSN-12345";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.totalPopulationRows).toBe(1);
  });
});
