import { describe, expect, test } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  buildAssignEvent,
  deriveCurrentDistribution,
  EVENT_SCHEMA_VERSION,
} from "./distributionLog";
import type { DistributionEvent, DistributionLog } from "./distributionTypes";

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

function makeLog(events: DistributionEvent[]): DistributionLog {
  return { monthFolderName: "5-may-2026", revision: 1, events };
}

describe("event schema versioning (A7)", () => {
  test("newly built events are stamped with the current schema version", () => {
    const evt = buildAssignEvent({ xrayImageId: "X1", assignedTo: "emp1", eventBy: "sup" });
    expect(evt.eventSchemaVersion).toBe(EVENT_SCHEMA_VERSION);
  });

  test("a legacy event with no version reads as version 1 and folds normally", () => {
    const legacy: DistributionEvent = {
      eventId: "e1",
      eventType: "assigned",
      xrayImageId: "X1",
      assignedTo: "emp1",
      eventAt: new Date().toISOString(),
      eventBy: "sup",
      // eventSchemaVersion intentionally absent
    };
    const current = deriveCurrentDistribution(makeLog([legacy]), [makeRow("X1")]);
    expect(current.entries).toHaveLength(1);
    expect(current.entries[0]!.status).toBe("pending");
    expect(current.entries[0]!.assignedTo).toBe("emp1");
  });

  test("an unknown future event version is dropped, preserving the existing entry", () => {
    const assign: DistributionEvent = {
      eventId: "e1",
      eventType: "completed",
      eventSchemaVersion: 1,
      xrayImageId: "X1",
      assignedTo: "emp1",
      eventAt: "2026-07-14T10:00:00.000Z",
      eventBy: "sup",
    };
    const futureAssign = buildAssignEvent({ xrayImageId: "X1", assignedTo: "emp1", eventBy: "sup" });
    // First establish a "completed" entry, then a NEWER-versioned event tries to
    // mutate it — the version guard must drop it and preserve "completed".
    const future: DistributionEvent = { ...futureAssign, eventSchemaVersion: 99, eventAt: "2026-07-14T11:00:00.000Z" };

    const current = deriveCurrentDistribution(makeLog([assign, future]), [makeRow("X1")]);
    expect(current.entries).toHaveLength(1);
    expect(current.entries[0]!.status).toBe("completed"); // preserved, not downgraded
  });
});
