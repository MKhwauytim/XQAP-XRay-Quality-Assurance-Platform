/* @vitest-environment jsdom */
// A1 follow-up (task 18): after a reload the auto-select effect used to open
// displayEntries[0] regardless of what the employee had open, so a restored
// draft (keyed on the sample it belongs to) was not what appeared on screen.
// This pins that the remembered sample reopens instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import { makePopulationRow, makeSampleMaster } from "../../../../../data/population/populationTestFixtures";
import { rememberLastOpenSample } from "../../../../../data/answers/lastOpenSampleStore";
import {
  XRAY_REFERRALS_TEST_MONTH,
  ResizeObserverStub,
  renderXrayReferrals,
} from "./XrayReferrals.testSupport";

const IDS = ["IMG-001", "IMG-002", "IMG-003"];

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: XRAY_REFERRALS_TEST_MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: XRAY_REFERRALS_TEST_MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

/** Seeds three assigned rows (the single-row testSupport helper isn't enough here). */
async function seedThreeRows(root: DirectoryHandleLike): Promise<void> {
  const sampled = await saveSampleMaster(
    root,
    XRAY_REFERRALS_TEST_MONTH,
    makeSampleMaster(IDS.map((id) => makePopulationRow(id)))
  );
  if (!sampled.ok) throw new Error(sampled.error);
  const assigned = await appendDistributionEvents(
    root,
    XRAY_REFERRALS_TEST_MONTH,
    IDS.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp-a", eventBy: "admin" }))
  );
  if (!assigned.ok) throw new Error(assigned.error);
  const template: TemplateSchema = {
    templateId: "tmpl-last-open",
    templateName: "قالب الاختبار",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    fields: [{ fieldId: "note", label: "ملاحظة", type: "text", required: false, options: [] }],
  };
  const savedTpl = await saveTemplate(root, template);
  if (!savedTpl.ok) throw new Error(savedTpl.error);
  const selected = await saveInspectionTemplateSelection(root, {
    templateId: template.templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!selected.ok) throw new Error(selected.error);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — reopens the last sample after a reload (A1)", () => {
  it("opens the remembered sample instead of the first row", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    const root = createMemoryDirectory("root");
    await seedThreeRows(root);
    rememberLastOpenSample("emp-a", XRAY_REFERRALS_TEST_MONTH, "IMG-003");

    renderXrayReferrals(root);

    await waitFor(() => expect(document.querySelector(".ip-xray-id")?.textContent).toBe("IMG-003"));
  });
});
