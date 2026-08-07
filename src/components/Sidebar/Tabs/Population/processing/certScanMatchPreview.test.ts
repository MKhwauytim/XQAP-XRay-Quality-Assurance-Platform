import { describe, expect, it } from "vitest";
import { computeCertScanMatchPreview } from "./certScanMatchPreview";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";

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
      makeRow({ xrayImageId: "IMG-SN12345-001", portName: "منفذ الرياض" }),
      makeRow({ xrayImageId: "IMG-OTHERSERIAL-002", portName: "منفذ الرياض" }),
      makeRow({ xrayImageId: "IMG-SN99999-003", portName: "منفذ الدمام" })
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
      makeRow({ xrayImageId: "IMG-AAA111-1", portName: "منفذ الدمام" }),
      makeRow({ xrayImageId: "IMG-AAA222-2", portName: "منفذ الدمام" }),
      makeRow({ xrayImageId: "IMG-AAA333-3", portName: "منفذ الدمام" })
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
    const rows = [makeRow({ xrayImageId: "IMG-SN555-1", portName: "منفذ الدمام" })];
    // Paste names it with the "ميناء" descriptor instead of "منفذ" — fuzzy tier.
    const paste = "Port Name\tSystem S/N\nميناء الدمام\tSN-555";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.looseTierAlignments).toEqual([
      { populationPortName: "منفذ الدمام", pastePortName: "ميناء الدمام", tier: "fuzzy" }
    ]);
    expect(preview.totalMatchedRows).toBe(1);
  });

  it("ignores rows with an invalid or duplicate X-ray ID, matching processPopulation's own candidate rules", () => {
    const rows = [
      makeRow({ xrayImageId: "IMG-SN12345-1", portName: "منفذ جدة" }),
      makeRow({ xrayImageId: "IMG-SN12345-1", portName: "منفذ جدة" }), // duplicate
      makeRow({ xrayImageId: "-", portName: "منفذ جدة" }) // invalid
    ];
    const paste = "Port Name\tSystem S/N\nمنفذ جدة\tSN-12345";

    const preview = computeCertScanMatchPreview(rows, paste);

    expect(preview.totalPopulationRows).toBe(1);
  });
});
