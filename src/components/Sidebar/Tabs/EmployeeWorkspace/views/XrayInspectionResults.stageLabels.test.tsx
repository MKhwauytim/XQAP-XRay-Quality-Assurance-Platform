/* @vitest-environment jsdom */
// C1: «نتائج فحص الأشعة» must label a stage with the WORKSPACE alias table
// (config.json → stageMappings), not only the built-in defaults — a custom
// alias rendered as its raw text here while the referral queue already showed
// the Arabic level label.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import {
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_STAGE_MAPPINGS,
  savePopulationConfig,
} from "../../../../../data/population/populationConfig";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { makeRow } from "../../../../../data/reporting/reportTestFixtures";
import XrayInspectionResults from "./XrayInspectionResults";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-02T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

describe("XrayInspectionResults — stage labels use the workspace alias table (C1)", () => {
  it("renders a custom-alias stage as its Arabic level label", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    const savedConfig = await savePopulationConfig(root, {
      ...DEFAULT_POPULATION_CONFIG,
      stageMappings: {
        ...DEFAULT_STAGE_MAPPINGS,
        second: [...DEFAULT_STAGE_MAPPINGS.second, "X2-CUSTOM"],
      },
    });
    if (!savedConfig.ok) throw new Error(`seed config failed: ${savedConfig.error}`);
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-S2", "بري", { stage: "X2-CUSTOM" })]));
    const assigned = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-S2", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!assigned.ok) throw new Error(`seed assign failed: ${assigned.error}`);

    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-S2").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryAllByText("X2-CUSTOM")).toHaveLength(0));
    expect(screen.getAllByText("المستوى الثاني").length).toBeGreaterThan(0);
  });
});
