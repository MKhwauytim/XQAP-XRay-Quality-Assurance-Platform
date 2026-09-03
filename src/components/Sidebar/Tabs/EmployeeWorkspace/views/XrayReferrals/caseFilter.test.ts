// The case-queue filter's predicate, counts and helper, tested without
// rendering the page. The component test alongside XrayReferrals.tsx covers the
// wiring; this covers the rule itself — in particular that «مستهدف المؤشر» is
// the exact complement of «إحالات استثنائية» (every row from the regular
// population pipeline, regardless of what its own risk-engine column says),
// so the two buckets now partition «جميع الحالات» exactly.

import { describe, expect, it } from "vitest";
import type { AdhocDistributionEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { toEmployeeMirrorRowStub, type PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import { countCaseFilters, filterCases, matchesCaseFilter, CASE_FILTERS } from "./caseFilter";

function makeRow(xrayImageId: string, targetedByRiskEngine: string | null): PreparedPopulationRow {
  return {
    xrayImageId,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function entry(
  xrayImageId: string,
  targetedByRiskEngine: string | null,
  adhocImportId?: string
): DistributionEntry {
  const base: DistributionEntry = {
    xrayImageId,
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-01T00:00:00.000Z",
    row: toEmployeeMirrorRowStub(makeRow(xrayImageId, targetedByRiskEngine)),
  };
  // `isAdhocEntry` keys on the presence of `adhocImportId`, which is exactly
  // what `AdhocDistributionEntry` adds on top of a plain entry.
  if (adhocImportId === undefined) return base;
  const adhoc: AdhocDistributionEntry = { ...base, adhocImportId, adhocFileName: `${adhocImportId}.xlsx` };
  return adhoc;
}

describe("matchesCaseFilter — «جميع الحالات»", () => {
  it("accepts every entry, whatever the risk column or the origin says", () => {
    for (const e of [entry("A", "نعم"), entry("B", null), entry("C", "ربما"), entry("D", null, "adh-1")]) {
      expect(matchesCaseFilter(e, "all")).toBe(true);
    }
  });
});

describe("matchesCaseFilter — «مستهدف المؤشر»", () => {
  it("accepts every regular-pipeline row regardless of its own risk column value", () => {
    for (const raw of ["نعم", "لا", "ربما", null, "", "   ", "xyz"]) {
      expect(matchesCaseFilter(entry("A", raw), "risk-targeted")).toBe(true);
    }
  });

  it("rejects an ad-hoc-imported row, even one whose risk column reads affirmative", () => {
    expect(matchesCaseFilter(entry("A", "نعم", "adh-1"), "risk-targeted")).toBe(false);
    expect(matchesCaseFilter(entry("A", null, "adh-1"), "risk-targeted")).toBe(false);
  });

  it("is the exact logical complement of «إحالات استثنائية»", () => {
    for (const e of [entry("A", "نعم"), entry("B", null, "adh-1"), entry("C", "لا")]) {
      expect(matchesCaseFilter(e, "risk-targeted")).toBe(!matchesCaseFilter(e, "adhoc"));
    }
  });
});

describe("matchesCaseFilter — «إحالات استثنائية»", () => {
  it("accepts only entries that carry an ad-hoc import id", () => {
    expect(matchesCaseFilter(entry("A", null, "adh-1"), "adhoc")).toBe(true);
    expect(matchesCaseFilter(entry("A", null), "adhoc")).toBe(false);
    expect(matchesCaseFilter(entry("A", "نعم"), "adhoc")).toBe(false);
  });
});

describe("filterCases", () => {
  const rows = [entry("A", "نعم"), entry("B", "لا"), entry("C", null), entry("D", "ربما"), entry("E", "نعم", "adh-1")];

  it("returns the input array itself for «جميع الحالات» (no needless copy)", () => {
    expect(filterCases(rows, "all")).toBe(rows);
  });

  it("keeps every non-ad-hoc row for «مستهدف المؤشر»", () => {
    expect(filterCases(rows, "risk-targeted").map((e) => e.xrayImageId)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps only ad-hoc rows for «إحالات استثنائية»", () => {
    expect(filterCases(rows, "adhoc").map((e) => e.xrayImageId)).toEqual(["E"]);
  });

  it("preserves the input order within every bucket", () => {
    const many = [entry("Z", "نعم"), entry("Y", "نعم"), entry("X", "نعم")];
    expect(filterCases(many, "risk-targeted").map((e) => e.xrayImageId)).toEqual(["Z", "Y", "X"]);
  });
});

describe("countCaseFilters", () => {
  it("counts each bucket over exactly the set it is given", () => {
    const counts = countCaseFilters([
      entry("A", "نعم"),
      entry("B", "لا"),
      entry("C", null),
      entry("D", "ربما"),
      entry("E", "نعم", "adh-1"),
      entry("F", null, "adh-2"),
    ]);
    expect(counts).toEqual({ all: 6, "risk-targeted": 4, adhoc: 2 });
  });

  it("agrees with filterCases for every bucket — a chip's number is its list's length", () => {
    const rows = [entry("A", "yes"), entry("B", "  NO "), entry("C", null, "adh-1"), entry("D", "TRUE", "adh-1")];
    const counts = countCaseFilters(rows);
    for (const bucket of CASE_FILTERS) {
      expect(counts[bucket]).toBe(filterCases(rows, bucket).length);
    }
  });

  it("reports zeros for an empty queue", () => {
    expect(countCaseFilters([])).toEqual({ all: 0, "risk-targeted": 0, adhoc: 0 });
  });

  it("partitions the queue exactly — «مستهدف المؤشر» + «إحالات استثنائية» always equals «جميع الحالات»", () => {
    const rows = [entry("A", "نعم"), entry("B", null, "adh-1"), entry("C", "لا"), entry("D", "نعم", "adh-2")];
    const counts = countCaseFilters(rows);
    expect(counts["risk-targeted"] + counts.adhoc).toBe(counts.all);
  });
});
