import { expect, test } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import { calculateBulkAssignment } from "./bulkAssignment";

function makeRow(id: string, stage: string, cert: "Certscan" | "NonCertscan"): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "المنفذ",
    certScanStatus: cert,
    stage,
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
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "ورقة",
    sourceRowNumber: 1
  };
}

test("calculateBulkAssignment fails if no employees assigned in active stage", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "NonCertscan")];
  const allocations: EmployeeStageAllocation[] = [];
  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees: [],
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(1);
  expect(result.events).toHaveLength(0);
});

test("calculateBulkAssignment fails for CertScan rows if no employee has CertScan license", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "Certscan")];
  const allocations: EmployeeStageAllocation[] = [
    { username: "user1", stageKey: "second", method: "percentage", value: 100, isActive: true }
  ];
  const employees: ManagedLoginUser[] = [
    {
      id: "u1",
      username: "user1",
      displayName: "User 1",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: false, // NOT LICENSED
      createdAt: "",
      updatedAt: ""
    }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("خطأ: توجد سجلات CertScan");
  expect(result.events).toHaveLength(0);
});

test("calculateBulkAssignment assigns CertScan records and normal records correctly", () => {
  const rows = [
    makeRow("img-c1", "SECOND_STAGE", "Certscan"),
    makeRow("img-n1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-n2", "SECOND_STAGE", "NonCertscan")
  ];

  const allocations: EmployeeStageAllocation[] = [
    { username: "user1", stageKey: "second", method: "percentage", value: 50, isActive: true },
    { username: "user2", stageKey: "second", method: "percentage", value: 50, isActive: true }
  ];

  const employees: ManagedLoginUser[] = [
    {
      id: "u1",
      username: "user1",
      displayName: "User 1",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: true, // CertScan licensed
      createdAt: "",
      updatedAt: ""
    },
    {
      id: "u2",
      username: "user2",
      displayName: "User 2",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: false, // Normal employee
      createdAt: "",
      updatedAt: ""
    }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(3);

  // CertScan record img-c1 should ONLY go to user1
  const certEvent = result.events.find(e => e.xrayImageId === "img-c1");
  expect(certEvent?.assignedTo).toBe("user1");

  // Normal records should be distributed proportionately
  const user1Events = result.events.filter(e => e.assignedTo === "user1");
  const user2Events = result.events.filter(e => e.assignedTo === "user2");
  expect(user1Events.length).toBeGreaterThanOrEqual(1);
  expect(user2Events.length).toBeGreaterThanOrEqual(1);
});
