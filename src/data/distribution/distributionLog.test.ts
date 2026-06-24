import { expect, test } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  buildReplacedEvent,
  buildReplacementRequestedEvent,
  computeDaysRemainingForDeadline,
  deriveCurrentDistribution
} from "./distributionLog";
import type { DistributionLog } from "./distributionTypes";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
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
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

function makeLog(events: DistributionLog["events"] = []): DistributionLog {
  return {
    monthFolderName: "5-May-2026",
    revision: 0,
    events
  };
}

test("empty log produces empty distribution", () => {
  const log = makeLog();
  const result = deriveCurrentDistribution(log, [makeRow("A1")]);
  expect(result.entries).toHaveLength(0);
  expect(result.totalAssigned).toBe(0);
});

test("assigned event creates pending entry", () => {
  const rows = [makeRow("A1")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]!.status).toBe("pending");
  expect(result.entries[0]!.assignedTo).toBe("emp1");
  expect(result.totalPending).toBe(1);
});

test("completed event marks entry completed", () => {
  const rows = [makeRow("A1")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.entries[0]!.status).toBe("completed");
  expect(result.totalCompleted).toBe(1);
  expect(result.totalPending).toBe(0);
});

test("reassigned event changes assignee and keeps pending", () => {
  const rows = [makeRow("A1")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildReassignEvent({
        xrayImageId: "A1",
        assignedTo: "emp1",
        reassignedTo: "emp2",
        eventBy: "admin"
      })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.entries[0]!.assignedTo).toBe("emp2");
  expect(result.entries[0]!.status).toBe("pending");
});

test("replacement-requested then replaced marks as replaced", () => {
  const rows = [makeRow("A1")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildReplacementRequestedEvent({
        xrayImageId: "A1",
        assignedTo: "emp1",
        eventBy: "emp1"
      }),
      buildReplacedEvent({
        xrayImageId: "A1",
        assignedTo: "emp1",
        replacedById: "B2",
        eventBy: "admin"
      })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.entries[0]!.status).toBe("replaced");
  expect(result.entries[0]!.replacedById).toBe("B2");
  expect(result.totalReplaced).toBe(1);
});

test("replacement sample starts as pending while original sample is marked replaced", () => {
  const rows = [makeRow("A1"), makeRow("B2")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "B2", assignedTo: "emp1", eventBy: "admin" }),
      buildReplacedEvent({
        xrayImageId: "A1",
        assignedTo: "emp1",
        replacedById: "B2",
        eventBy: "admin"
      })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  const original = result.entries.find((entry) => entry.xrayImageId === "A1");
  const replacement = result.entries.find((entry) => entry.xrayImageId === "B2");

  expect(original?.status).toBe("replaced");
  expect(original?.replacedById).toBe("B2");
  expect(replacement?.status).toBe("pending");
  expect(replacement?.replacedById).toBeNull();
});

test("multiple items tracked independently", () => {
  const rows = [makeRow("A1"), makeRow("A2"), makeRow("A3")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp2", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "admin" }),
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.totalAssigned).toBe(3);
  expect(result.totalCompleted).toBe(1);
  expect(result.totalPending).toBe(2);
});

test("events for unknown xrayImageId are ignored", () => {
  const rows = [makeRow("A1")];
  const log = makeLog([
      buildAssignEvent({ xrayImageId: "UNKNOWN", assignedTo: "emp1", eventBy: "admin" })
  ]);
  const result = deriveCurrentDistribution(log, rows);
  expect(result.entries).toHaveLength(0);
});

test("daily quota is derived from assignment date through three days before month end", () => {
  const rows = Array.from({ length: 1000 }, (_, index) => makeRow(`A${index + 1}`));
  const log = makeLog(
    rows.map((row, index) => ({
      ...buildAssignEvent({ xrayImageId: row.xrayImageId, assignedTo: "emp1", eventBy: "admin" }),
      eventId: `evt-${index + 1}`,
      eventAt: "2026-06-01T00:00:00.000Z",
    }))
  );
  log.monthFolderName = "6-June-2026";

  expect(computeDaysRemainingForDeadline(6, 2026, new Date("2026-06-01T00:00:00.000Z"))).toBe(27);

  const result = deriveCurrentDistribution(log, rows);
  expect(result.quotas?.emp1?.sampleCount).toBe(1000);
  expect(result.quotas?.emp1?.daysRemainingAtAssignment).toBe(27);
  expect(result.quotas?.emp1?.dailyQuota).toBe(38);
});
