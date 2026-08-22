// The case-queue filter's predicate, counts and helper, tested without
// rendering the page. The component test alongside XrayReferrals.tsx covers the
// wiring; this covers the rule itself, which is where the interesting edges are
// (blank vs. unrecognized vs. negative, and the fact that the three buckets
// overlap rather than partition).

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
  it("accepts an entry whose risk column classifies as affirmative", () => {
    for (const raw of ["نعم", "مستهدف", "y", "yes", "true", "1", "  YES  "]) {
      expect(matchesCaseFilter(entry("A", raw), "risk-targeted")).toBe(true);
    }
  });

  it("rejects an entry whose risk column classifies as negative", () => {
    for (const raw of ["لا", "غير مستهدف", "n", "no", "false", "0"]) {
      expect(matchesCaseFilter(entry("A", raw), "risk-targeted")).toBe(false);
    }
  });

  it("rejects a BLANK risk column — unknown is never 'targeted'", () => {
    expect(matchesCaseFilter(entry("A", null), "risk-targeted")).toBe(false);
    expect(matchesCaseFilter(entry("A", ""), "risk-targeted")).toBe(false);
    expect(matchesCaseFilter(entry("A", "   "), "risk-targeted")).toBe(false);
  });

  it("rejects an UNRECOGNIZED risk column value rather than guessing", () => {
    for (const raw of ["ربما", "xyz", "2", "غير محدد"]) {
      expect(matchesCaseFilter(entry("A", raw), "risk-targeted")).toBe(false);
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

  it("keeps only affirmative-engine rows for «مستهدف المؤشر», blanks and unknowns excluded", () => {
    expect(filterCases(rows, "risk-targeted").map((e) => e.xrayImageId)).toEqual(["A", "E"]);
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
    expect(counts).toEqual({ all: 6, "risk-targeted": 2, adhoc: 2 });
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

  it("does NOT partition the queue — an ad-hoc row can also be engine-targeted", () => {
    // Documented on purpose: the three counts are three independent lenses, so
    // «مستهدف المؤشر» + «إحالات استثنائية» may exceed «جميع الحالات».
    const counts = countCaseFilters([entry("A", "نعم", "adh-1")]);
    expect(counts.all).toBe(1);
    expect(counts["risk-targeted"]).toBe(1);
    expect(counts.adhoc).toBe(1);
  });
});
