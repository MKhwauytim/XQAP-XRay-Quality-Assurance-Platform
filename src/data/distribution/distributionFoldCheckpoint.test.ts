// Golden-master coverage for the fold-checkpoint perf work: resuming a fold
// from a prior accumulator must produce output IDENTICAL to folding the same
// events from scratch, and a "late" (out-of-order) event relative to the
// checkpoint must force a full refold rather than a silently wrong resume —
// see distributionDerivation.ts's findLateEvent doc comment for why patching
// in place is never safe.
import { describe, expect, it } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  buildReopenedEvent,
  buildReopenRequestedEvent,
  buildReplacedEvent,
  buildReplacementRequestedEvent,
  deriveCurrentDistribution,
  deriveCurrentDistributionIncremental,
  deriveCurrentDistributionWithFacts,
} from "./distributionLog";
import { findLateEvent } from "./distributionDerivation";
import type { DistributionCurrentData, DistributionEvent, DistributionLog } from "./distributionTypes";

/** Strips the wall-clock derivedAt stamp so two independently-produced snapshots can be compared for logical equality. */
function withoutDerivedAt(data: DistributionCurrentData): Omit<DistributionCurrentData, "derivedAt"> {
  const copy: Partial<DistributionCurrentData> = { ...data };
  delete copy.derivedAt;
  return copy as Omit<DistributionCurrentData, "derivedAt">;
}

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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

function makeLog(events: DistributionEvent[]): DistributionLog {
  return { monthFolderName: "5-May-2026", revision: 0, events };
}

// A representative event set spanning every terminal-transition case this
// codebase cares about: a plain completion, a reassignment, a full
// replacement lifecycle (replacement-requested -> replaced) with a stray late
// event dropped by the terminal guard, a reopen lifecycle, and an
// unsupported-schema-version event that must be preserved-but-dropped.
function representativeEvents(): DistributionEvent[] {
  return [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin", eventAt: "2026-05-01T08:00:00.000Z" }),
    buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
    buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin", eventAt: "2026-05-01T08:05:00.000Z" }),
    buildReassignEvent({ xrayImageId: "A2", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "admin", eventAt: "2026-05-01T08:10:00.000Z" }),
    buildAssignEvent({ xrayImageId: "B3", assignedTo: "emp1", eventBy: "admin", eventAt: "2026-05-01T08:11:00.000Z" }),
    buildReplacementRequestedEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "emp1" }),
    buildReplacedEvent({ xrayImageId: "A3", assignedTo: "emp1", replacedById: "B3", eventBy: "admin" }),
    // Stray late event against a terminal (replaced) row -- must be dropped.
    buildCompletedEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "emp1" }),
    buildAssignEvent({ xrayImageId: "A4", assignedTo: "emp2", eventBy: "admin", eventAt: "2026-05-01T08:15:00.000Z" }),
    buildCompletedEvent({ xrayImageId: "A4", assignedTo: "emp2", eventBy: "emp2" }),
    buildReopenRequestedEvent({ xrayImageId: "A4", assignedTo: "emp2", eventBy: "emp2" }),
    buildReopenedEvent({ xrayImageId: "A4", assignedTo: "emp2", eventBy: "sup1" }),
    // Unsupported future schema version -- preserved-but-dropped by the fold.
    {
      ...buildAssignEvent({ xrayImageId: "A5", assignedTo: "emp2", eventBy: "admin" }),
      eventSchemaVersion: 999,
    },
  ];
}

function rowsFor(events: DistributionEvent[]): PreparedPopulationRow[] {
  return [...new Set(events.map((event) => event.xrayImageId))].map(makeRow);
}

describe("fold-checkpoint golden master", () => {
  it("resuming a fold in two batches matches folding the whole event set from scratch", () => {
    const events = representativeEvents();
    const rows = rowsFor(events);
    const fromScratch = deriveCurrentDistribution(makeLog(events), rows);

    // Split arbitrarily into "already folded" vs "new" -- every new event here
    // sorts strictly after the entries already folded for its own image, so
    // this is the safe (non-late) resume case.
    const splitAt = 9;
    const already = events.slice(0, splitAt);
    const rest = events.slice(splitAt);

    const { current: partial, quotaFacts } = deriveCurrentDistributionWithFacts(makeLog(already), rows);
    const resumed = deriveCurrentDistributionIncremental(partial, quotaFacts, rest, rows);

    expect(resumed.requiresFullRefold).toBe(false);
    // Compare everything except derivedAt (a wall-clock stamp that legitimately
    // differs between the two independent derivations being compared here).
    expect(withoutDerivedAt(resumed.current)).toEqual(withoutDerivedAt(fromScratch));
  });

  it("a late event (out of order relative to the checkpoint) is detected and forces a full refold with an identical result", () => {
    const events = representativeEvents();
    const rows = rowsFor(events);
    const fromScratch = deriveCurrentDistribution(makeLog(events), rows);

    // Fold everything except A1's completion first...
    const completedIndex = events.findIndex((e) => e.eventType === "completed" && e.xrayImageId === "A1");
    const withoutA1Completion = events.filter((_, i) => i !== completedIndex);
    const { current: partial, quotaFacts } = deriveCurrentDistributionWithFacts(makeLog(withoutA1Completion), rows);

    // ...then surface A1's completion as a "new" event with an eventAt that
    // PREDATES an already-folded later event for the same image (A1 has no
    // later event here, so backdate it before its own assignment instead --
    // still earlier than partial's lastEventAt for A1, which is what matters).
    const lateCompletion: DistributionEvent = {
      ...events[completedIndex]!,
      eventAt: "2026-05-01T00:00:00.000Z", // earlier than A1's assignment (08:00)
    };

    expect(findLateEvent(partial.entries, [lateCompletion])).not.toBeNull();

    const resumed = deriveCurrentDistributionIncremental(partial, quotaFacts, [lateCompletion], rows);
    expect(resumed.requiresFullRefold).toBe(true);

    // Caller contract: on requiresFullRefold, refold the COMPLETE event list
    // (not just the late event) from scratch -- and that must match the
    // pre-computed from-scratch result exactly (using the ORIGINAL, correctly
    // timestamped event list, not the artificially-backdated one, since a real
    // caller would re-read every event fresh from disk here).
    const refolded = deriveCurrentDistribution(makeLog(events), rows);
    expect(withoutDerivedAt(refolded)).toEqual(withoutDerivedAt(fromScratch));
  });

  it("an equal-timestamp event with a smaller eventId is treated as late when lastEventId is unknown (legacy checkpoint)", () => {
    // Guards the conservative fallback in isEventEarlierThanEntry: an entry
    // without lastEventId (an older checkpoint shape) must never be resumed
    // past silently -- see distributionDerivation.ts.
    const rows = [makeRow("A1")];
    const assign = buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" });
    const { current: partial } = deriveCurrentDistributionWithFacts(makeLog([assign]), rows);
    const entryWithoutLastEventId = {
      ...partial.entries[0]!,
      lastEventId: undefined,
    };
    const sameTimestampEvent: DistributionEvent = {
      ...buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
      eventAt: assign.eventAt,
    };
    expect(findLateEvent([entryWithoutLastEventId], [sameTimestampEvent])).not.toBeNull();
  });
});
