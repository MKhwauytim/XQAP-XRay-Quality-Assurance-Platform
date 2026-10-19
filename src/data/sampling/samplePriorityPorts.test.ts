import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageSamplingRule } from "../population/populationConfig";
import { drawSample } from "./sampleAlgorithm";

function row(id: string, portName: string, certScanStatus: "Certscan" | "NonCertscan"): PreparedPopulationRow {
  return {
    xrayImageId: id, portName, certScanStatus, stage: "SECOND_STAGE", xrayEntryDate: null, portCode: null,
    portType: null, declarationNumber: null, declarationDate: null, plateOrContainerNumber: null,
    chassisNumber: null, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: "LAND",
    reportNumber: null, targetedByRiskEngine: null, riskMessage: null, levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanSnippet: null, originalCertScanSnippet: null, biEnrichmentStatus: "BI Not Provided",
    biMatched: false, biFilledFields: [], sourceSheetName: "بري", sourceRowNumber: 1,
  };
}

function port(name: string, cert: number, nonCert: number): PreparedPopulationRow[] {
  return [
    ...Array.from({ length: cert }, (_, i) => row(`${name}-C${i}`, name, "Certscan")),
    ...Array.from({ length: nonCert }, (_, i) => row(`${name}-N${i}`, name, "NonCertscan")),
  ];
}

function rule(target: number, cert: Partial<StageSamplingRule> = {}): StageSamplingRule[] {
  return [{
    stageKey: "second", method: "exact", value: target, isLocked: false, minRequiredCount: 0,
    certScanPercentage: 25, certScanExactCount: 0, certScanMethod: "percentage", certScanStrategy: "preferred",
    ...cert,
  }];
}

function draw(rows: PreparedPopulationRow[], samplingRules: StageSamplingRule[], priorityPorts?: string[]) {
  const result = drawSample(rows, { rngSeed: "priority-seed", samplingRules, ...(priorityPorts ? { priorityPorts } : {}) }, "user");
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

const byPort = (rows: PreparedPopulationRow[]) =>
  rows.reduce<Record<string, { cert: number; nonCert: number }>>((acc, r) => {
    const entry = (acc[r.portName!] ??= { cert: 0, nonCert: 0 });
    if (r.certScanStatus === "Certscan") entry.cert += 1;
    else entry.nonCert += 1;
    return acc;
  }, {});

describe("drawSample — high-priority ports (\"1.3\")", () => {
  it("takes the whole stage from priority ports when they hold enough, keeping the CertScan split", () => {
    const data = draw([...port("A", 10, 30), ...port("B", 50, 50)], rule(20), ["A"]);
    expect(data.totalActual).toBe(20);
    expect(byPort(data.rows)).toEqual({ A: { cert: 5, nonCert: 15 } });
    expect(data.certScanActual).toBe(5);
  });

  it("takes what priority ports have, then draws the rest from the other ports normally", () => {
    const data = draw([...port("A", 2, 6), ...port("B", 50, 50)], rule(20), ["A"]);
    expect(data.totalActual).toBe(20);
    expect(byPort(data.rows)).toEqual({ A: { cert: 2, nonCert: 6 }, B: { cert: 3, nonCert: 9 } });
    expect(data.certScanActual).toBe(5); // 25% of 20, met across both groups
  });

  it("splits between several priority ports by each port's pool of the type", () => {
    const data = draw([...port("A", 10, 30), ...port("C", 10, 10), ...port("B", 50, 50)], rule(20), ["A", "C"]);
    const counts = byPort(data.rows);
    expect(counts.B).toBeUndefined();
    expect(counts.A!.cert + counts.C!.cert).toBe(5);
    expect(counts.A!.nonCert + counts.C!.nonCert).toBe(15);
    expect(counts.A!.nonCert).toBeGreaterThan(counts.C!.nonCert); // A holds 30 non-CertScan, C 10
  });

  it("fills a type the priority ports lack from the other ports", () => {
    const data = draw([...port("A", 0, 20), ...port("B", 3, 20)], rule(10, { certScanMethod: "exact", certScanExactCount: 8 }), ["A"]);
    expect(data.totalActual).toBe(10);
    expect(byPort(data.rows)).toEqual({ A: { cert: 0, nonCert: 7 }, B: { cert: 3, nonCert: 0 } });
  });

  it("records the priority ports and flags their allocations", () => {
    const data = draw([...port("A", 2, 6), ...port("B", 50, 50)], rule(20), ["A"]);
    expect(data.priorityPorts).toEqual(["A"]);
    expect(data.portAllocations.find((a) => a.portName === "A")?.priority).toBe(true);
    expect(data.portAllocations.find((a) => a.portName === "B")?.priority).toBeUndefined();
  });

  it("is the plain draw, row for row, with no priority ports or none present in the stage", () => {
    const rows = [...port("A", 10, 30), ...port("B", 50, 50)];
    const plain = draw(rows, rule(20));
    for (const variant of [draw(rows, rule(20), []), draw(rows, rule(20), ["Z"])]) {
      expect(variant.rows.map((r) => r.xrayImageId)).toEqual(plain.rows.map((r) => r.xrayImageId));
      expect(variant.portAllocations).toEqual(plain.portAllocations);
    }
    expect(plain.priorityPorts).toBeUndefined();
  });
});
