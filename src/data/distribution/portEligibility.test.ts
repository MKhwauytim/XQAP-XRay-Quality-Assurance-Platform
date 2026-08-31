import { expect, test } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeePortRestriction } from "../population/populationConfig";
import { derivePortCatalog, hasAnyPortRestriction, isPortEligible } from "./portEligibility";

function makeRow(portType: string | null, portName: string | null): PreparedPopulationRow {
  return {
    xrayImageId: "img",
    portName,
    portType,
    certScanStatus: "NonCertscan",
    stage: "SECOND_STAGE",
    xrayEntryDate: null,
    portCode: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
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
    sourceSheetName: "sheet",
    sourceRowNumber: 1,
  };
}

test("isPortEligible: an employee with no restriction entry is eligible for any port", () => {
  expect(isPortEligible("emp", "ميناء جدة", [])).toBe(true);
});

test("isPortEligible: an entry with restricted=false is eligible for any port", () => {
  const restrictions: EmployeePortRestriction[] = [
    { username: "emp", restricted: false, enabledPorts: [] },
  ];
  expect(isPortEligible("emp", "ميناء جدة", restrictions)).toBe(true);
});

test("isPortEligible: a restricted employee is only eligible for listed ports", () => {
  const restrictions: EmployeePortRestriction[] = [
    { username: "emp", restricted: true, enabledPorts: ["ميناء جدة"] },
  ];
  expect(isPortEligible("emp", "ميناء جدة", restrictions)).toBe(true);
  expect(isPortEligible("emp", "ميناء الدمام", restrictions)).toBe(false);
});

test("isPortEligible: a restriction on another employee does not affect this one", () => {
  const restrictions: EmployeePortRestriction[] = [
    { username: "other", restricted: true, enabledPorts: [] },
  ];
  expect(isPortEligible("emp", "ميناء جدة", restrictions)).toBe(true);
});

test("hasAnyPortRestriction: false for an empty list", () => {
  expect(hasAnyPortRestriction([])).toBe(false);
});

test("hasAnyPortRestriction: false when every entry has restricted=false", () => {
  expect(
    hasAnyPortRestriction([{ username: "emp", restricted: false, enabledPorts: [] }])
  ).toBe(false);
});

test("hasAnyPortRestriction: true when any entry has restricted=true", () => {
  expect(
    hasAnyPortRestriction([
      { username: "emp1", restricted: false, enabledPorts: [] },
      { username: "emp2", restricted: true, enabledPorts: ["ميناء جدة"] },
    ])
  ).toBe(true);
});

test("derivePortCatalog groups distinct ports under their portType category with row counts", () => {
  const rows = [
    makeRow("بحري", "ميناء جدة"),
    makeRow("بحري", "ميناء جدة"),
    makeRow("بحري", "ميناء الدمام"),
    makeRow("بري", "منفذ الحديثة"),
  ];

  const catalog = derivePortCatalog(rows);

  const sea = catalog.find((c) => c.category === "بحري");
  expect(sea?.ports).toEqual(
    expect.arrayContaining([
      { portName: "ميناء جدة", rowCount: 2 },
      { portName: "ميناء الدمام", rowCount: 1 },
    ])
  );
  const land = catalog.find((c) => c.category === "بري");
  expect(land?.ports).toEqual([{ portName: "منفذ الحديثة", rowCount: 1 }]);
});

test("derivePortCatalog falls back for a null portType and a null portName", () => {
  const rows = [makeRow(null, null)];
  const catalog = derivePortCatalog(rows);
  expect(catalog).toEqual([
    { category: "غير مصنّف", ports: [{ portName: "غير محدد", rowCount: 1 }] },
  ]);
});
