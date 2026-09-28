/**
 * Test-only builders shared by bulkAssignment.test.ts and
 * bulkAssignment.snapshot.test.ts (and any later A3/A4 task that exercises
 * `calculateBulkAssignment`). Never imported by app code.
 */
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import { makePopulationRow } from "../population/populationTestFixtures";

export function makeUser(
  username: string,
  role: ManagedLoginUser["role"] = "employee",
  hasCertScanLicense = false
): ManagedLoginUser {
  return {
    id: username,
    username,
    displayName: username,
    role,
    passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
    isActive: true,
    hasCertScanLicense,
    createdAt: "",
    updatedAt: ""
  };
}

/** Matches bulkAssignment.test.ts's historical argument order: id, stage, cert, port. */
export function makeRow(
  id: string,
  stage: string,
  cert: "Certscan" | "NonCertscan",
  portName = "المنفذ"
): PreparedPopulationRow {
  return { ...makePopulationRow(id, portName), stage, certScanStatus: cert };
}

/** Matches bulkAssignment.snapshot.test.ts's historical argument order: id, stage, port, cert. */
export function row(id: string, stage: string, port: string, cert: "Certscan" | "NonCertscan" = "NonCertscan"): PreparedPopulationRow {
  return { ...makePopulationRow(id, port), stage, certScanStatus: cert };
}

export function rows(prefix: string, count: number, stage: string, port: string): PreparedPopulationRow[] {
  return Array.from({ length: count }, (_, i) => row(`${prefix}-${String(i).padStart(4, "0")}`, stage, port));
}

export function alloc(
  username: string,
  stageKey: EmployeeStageAllocation["stageKey"],
  value: number,
  method: EmployeeStageAllocation["method"] = "percentage"
): EmployeeStageAllocation {
  return { username, stageKey, method, value, isActive: true };
}
