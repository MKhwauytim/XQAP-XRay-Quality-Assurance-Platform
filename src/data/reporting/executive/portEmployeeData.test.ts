import { describe, it, expect } from "vitest";
import { buildPortEmployeeAnalyses } from "./portEmployeeData";
import type { ExecutiveReportRow } from "../executiveReportTypes";

function makeRow(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "img-1",
    portCode: null,
    portName: "منفذ الأول",
    portType: "land",
    movementType: null,
    stage: "stage1",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: null,
    distributionStatus: null,
    expertResult: null,
    imageAvailable: null,
    noImageReason: null,
    hasMarking: null,
    imageQuality: null,
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: null,
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: null,
    levelOneAccurate: null,
    levelTwoAccurate: null,
    verificationCategory: null,
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    ...overrides,
  };
}

describe("buildPortEmployeeAnalyses", () => {
  it("returns land ports first, then sea ports", () => {
    const rows: ExecutiveReportRow[] = [
      // Sea port: ميناء الخليج — 2 rows
      makeRow({ portName: "ميناء الخليج", portType: "sea", levelOneEmployeeId: "emp-sea-1", xrayImageId: "s1" }),
      makeRow({ portName: "ميناء الخليج", portType: "sea", levelOneEmployeeId: "emp-sea-1", xrayImageId: "s2" }),
      // Land port: منفذ جازان — 3 rows
      makeRow({ portName: "منفذ جازان", portType: "land", levelOneEmployeeId: "emp-land-1", xrayImageId: "l1" }),
      makeRow({ portName: "منفذ جازان", portType: "land", levelOneEmployeeId: "emp-land-1", xrayImageId: "l2" }),
      makeRow({ portName: "منفذ جازان", portType: "land", levelOneEmployeeId: "emp-land-2", xrayImageId: "l3" }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    expect(result.length).toBe(2);
    expect(result[0].portName).toBe("منفذ جازان");
    expect(result[0].portType).toBe("land");
    expect(result[1].portName).toBe("ميناء الخليج");
    expect(result[1].portType).toBe("sea");
  });

  it("filters out ports with no levelOneEmployeeId or levelTwoEmployeeId", () => {
    const rows: ExecutiveReportRow[] = [
      // Port with no employee ids at all
      makeRow({ portName: "منفذ مجهول", levelOneEmployeeId: null, levelTwoEmployeeId: null, xrayImageId: "x1" }),
      // Port with employees
      makeRow({ portName: "منفذ معروف", levelOneEmployeeId: "emp-1", xrayImageId: "x2" }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    expect(result.length).toBe(1);
    expect(result[0].portName).toBe("منفذ معروف");
  });

  it("accuracy is null when no rows have verificationCategory", () => {
    const rows: ExecutiveReportRow[] = [
      makeRow({
        portName: "منفذ أ",
        levelOneEmployeeId: "emp-1",
        levelOneResult: "اشتباه",
        verificationCategory: null,
        levelOneAccurate: null,
        xrayImageId: "a1",
      }),
      makeRow({
        portName: "منفذ أ",
        levelOneEmployeeId: "emp-1",
        levelOneResult: "سليمة",
        verificationCategory: null,
        levelOneAccurate: null,
        xrayImageId: "a2",
      }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    expect(result.length).toBe(1);
    const emp = result[0].levelOne.employees[0];
    expect(emp.employeeId).toBe("emp-1");
    expect(emp.accuracy).toBeNull();
  });

  it("accuracy equals expected % when some rows have verificationCategory", () => {
    // emp-1: 3 studied, 2 verified, 1 correct → accuracy = 50%
    const rows: ExecutiveReportRow[] = [
      makeRow({
        portName: "منفذ ب",
        levelOneEmployeeId: "emp-1",
        levelOneResult: "اشتباه",
        verificationCategory: "correct-suspicious",
        levelOneAccurate: true,
        xrayImageId: "b1",
      }),
      makeRow({
        portName: "منفذ ب",
        levelOneEmployeeId: "emp-1",
        levelOneResult: "سليمة",
        verificationCategory: "missed-suspicious",
        levelOneAccurate: false,
        xrayImageId: "b2",
      }),
      makeRow({
        portName: "منفذ ب",
        levelOneEmployeeId: "emp-1",
        levelOneResult: "سليمة",
        verificationCategory: null,
        levelOneAccurate: null,
        xrayImageId: "b3",
      }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    const emp = result[0].levelOne.employees[0];
    expect(emp.studied).toBe(3);
    expect(emp.accuracy).toBeCloseTo(50, 5);
  });

  it("suspicious + clean === studied per employee", () => {
    const rows: ExecutiveReportRow[] = [
      makeRow({ portName: "منفذ ج", levelOneEmployeeId: "emp-1", levelOneResult: "اشتباه", xrayImageId: "c1" }),
      makeRow({ portName: "منفذ ج", levelOneEmployeeId: "emp-1", levelOneResult: "سليمة", xrayImageId: "c2" }),
      makeRow({ portName: "منفذ ج", levelOneEmployeeId: "emp-1", levelOneResult: "اشتباه", xrayImageId: "c3" }),
      makeRow({ portName: "منفذ ج", levelTwoEmployeeId: "emp-2", levelTwoResult: "سليمة", xrayImageId: "c4" }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    expect(result.length).toBe(1);

    const l1emp = result[0].levelOne.employees.find(e => e.employeeId === "emp-1")!;
    expect(l1emp.studied).toBe(3);
    expect(l1emp.suspicious + l1emp.clean).toBe(l1emp.studied);
    expect(l1emp.suspicious).toBe(2);
    expect(l1emp.clean).toBe(1);

    const l2emp = result[0].levelTwo.employees.find(e => e.employeeId === "emp-2")!;
    expect(l2emp.studied).toBe(1);
    expect(l2emp.suspicious + l2emp.clean).toBe(l2emp.studied);
  });

  it("handles mixed L1 and L2 employees across two ports with correct ordering", () => {
    const rows: ExecutiveReportRow[] = [
      // Land port with 2 L1 + 1 L2
      makeRow({ portName: "منفذ دير", portType: "land", levelOneEmployeeId: "l1-a", xrayImageId: "d1" }),
      makeRow({ portName: "منفذ دير", portType: "land", levelOneEmployeeId: "l1-a", xrayImageId: "d2" }),
      makeRow({ portName: "منفذ دير", portType: "land", levelOneEmployeeId: "l1-b", xrayImageId: "d3" }),
      makeRow({ portName: "منفذ دير", portType: "land", levelTwoEmployeeId: "l2-a", xrayImageId: "d4" }),
      // Sea port with 1 L1 + 1 L2
      makeRow({ portName: "ميناء صفاقس", portType: "sea", levelOneEmployeeId: "l1-c", xrayImageId: "e1" }),
      makeRow({ portName: "ميناء صفاقس", portType: "sea", levelTwoEmployeeId: "l2-b", xrayImageId: "e2" }),
    ];

    const result = buildPortEmployeeAnalyses(rows);
    expect(result[0].portType).toBe("land");
    expect(result[0].levelOne.employees.length).toBe(2);
    expect(result[0].levelTwo.employees.length).toBe(1);
    // l1-a studied 2 rows, l1-b studied 1 — should be sorted by studied desc
    expect(result[0].levelOne.employees[0].employeeId).toBe("l1-a");
    expect(result[0].levelOne.employees[1].employeeId).toBe("l1-b");

    expect(result[1].portType).toBe("sea");
    expect(result[1].levelOne.employees.length).toBe(1);
    expect(result[1].levelTwo.employees.length).toBe(1);
  });
});
