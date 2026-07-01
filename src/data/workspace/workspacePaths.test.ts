import { expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  REPORTS_SUBFOLDERS,
  getSampleMainDir,
  getSampleEmployeeDir,
  getSampleApprovalsDir,
} from "./workspacePaths";

test("WORKSPACE_ROOTS are lowercase kebab-case", () => {
  expect(WORKSPACE_ROOTS).toEqual({
    population: "1-population",
    samples: "2-samples",
    userData: "3-user-data",
    reports: "4-reports",
    system: "5-system",
    templates: "6-templates",
  });
});

test("POPULATION_SUBFOLDERS, SAMPLE_SUBFOLDERS, SYSTEM_FOLDER_NAMES, REPORTS_SUBFOLDERS are lowercase", () => {
  expect(POPULATION_SUBFOLDERS).toEqual({ raw: "1-raw", processed: "2-processed" });
  expect(SAMPLE_SUBFOLDERS).toEqual({
    main: "1-main",
    employees: "2-employees",
    approvals: "3-approvals",
  });
  expect(SYSTEM_FOLDER_NAMES).toEqual({
    locks: "locks",
    audit: "audit",
    backups: "backups",
    powerbiExport: "powerbi-export",
    userPresets: "user-presets",
    feedback: "feedback",
  });
  expect(REPORTS_SUBFOLDERS).toEqual({ designs: "designs" });
});

test("getSampleMainDir/EmployeeDir/ApprovalsDir create lowercase numbered subfolders", async () => {
  const root = createMemoryDirectory();

  const main = await getSampleMainDir(root, "5-may-2026", true);
  expect(main.name).toBe("1-main");

  const employees = await getSampleEmployeeDir(root, "5-may-2026", true);
  expect(employees.name).toBe("2-employees");

  const approvals = await getSampleApprovalsDir(root, "5-may-2026", true);
  expect(approvals.name).toBe("3-approvals");
});
