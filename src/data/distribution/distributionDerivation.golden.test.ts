import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry, DistributionEvent, QuotaFacts } from "./distributionTypes";
import {
  deriveEmployeeQuotas,
  deriveEmployeeQuotasWithFacts,
  findLateEvent,
  foldDistributionEvents,
  summarizeDistribution,
} from "./distributionDerivation";

/**
 * GOLDEN MASTER (Slice 0) — `distributionDerivation.ts`.
 *
 * This module had NO test file of its own before this one; it was only covered
 * indirectly through `distributionLog.ts`. Everything below pins the behavior
 * the code has TODAY, including behavior that looks wrong. Nothing here is an
 * aspirational assertion: if a line reads oddly, the comment above it says so
 * and the value is still the observed one. A future refactor that changes any
 * of these values is changing observable behavior and must do so deliberately.
 *
 * Determinism: no Date.now(), no randomness. The only environment coupling is
 * the local timezone, via `computeDaysRemainingForDeadline`'s use of
 * `new Date(year, month, 0)` — the existing suite already pins that under UTC
 * (`distributionLog.test.ts:375`), so this file follows the same precedent.
 */

const MONTH = "5-May-2026";

function makeRow(id: string, portName = "بري"): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
    certScanStatus: "NonCertscan",
    stage: "1",
    xrayEntryDate: "2026-05-02",
    portCode: "P1",
    portType: "بري",
    declarationNumber: "D-1",
    declarationDate: "2026-05-01",
    plateOrContainerNumber: "PLATE-1",
    chassisNumber: "CH-1",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: "R-1",
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: "L1",
    levelTwoEmployee: "L2",
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
    // rawRow is deliberately populated: the fold must never carry it through.
    rawRow: { anything: "at all" },
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function evt(
  eventId: string,
  eventType: DistributionEvent["eventType"],
  xrayImageId: string,
  assignedTo: string,
  eventAt: string,
  extra: Partial<DistributionEvent> = {}
): DistributionEvent {
  return {
    eventId,
    eventSchemaVersion: 1,
    eventType,
    xrayImageId,
    assignedTo,
    eventAt,
    eventBy: "admin",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// foldDistributionEvents
// ---------------------------------------------------------------------------

describe("foldDistributionEvents — golden master", () => {
  const rows = [makeRow("img-1"), makeRow("img-2", "بحري"), makeRow("img-3")];

  it("pins the full entry shape produced for a single assignment", () => {
    const result = foldDistributionEvents(
      [evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z")],
      rows,
      1
    );

    expect(result.entries).toEqual([
      {
        xrayImageId: "img-1",
        status: "pending",
        assignedTo: "emp-a",
        replacedById: null,
        lastEventAt: "2026-05-04T08:00:00.000Z",
        lastEventId: "e1",
        row: {
          stage: "1",
          portName: "بري",
          xrayEntryDate: "2026-05-02",
          plateOrContainerNumber: "PLATE-1",
          xrayLevelOneResult: "سليمة",
          xrayLevelTwoResult: "سليمة",
          certScanStatus: "NonCertscan",
          declarationNumber: "D-1",
          declarationDate: "2026-05-01",
          chassisNumber: "CH-1",
          movementType: "LAND",
          portCode: "P1",
          portType: "بري",
          targetedByRiskEngine: null,
          riskMessage: null,
          biEnrichmentStatus: "BI Not Provided",
          reportNumber: "R-1",
        },
      },
    ]);
    // The stub is a projection: xrayImageId and rawRow are NOT inside `row`.
    expect(Object.keys(result.entries[0].row)).not.toContain("rawRow");
    expect(Object.keys(result.entries[0].row)).not.toContain("xrayImageId");
    expect([...result.droppedEventIds]).toEqual([]);
    expect([...result.droppedImageIds]).toEqual([]);
  });

  it("pins entry ORDER as first-seen-event order, not sample-row order", () => {
    // img-3 is assigned before img-1 even though it comes later in `rows`.
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-3", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "assigned", "img-1", "emp-b", "2026-05-04T09:00:00.000Z"),
        evt("e3", "completed", "img-3", "emp-a", "2026-05-05T09:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries.map((e) => e.xrayImageId)).toEqual(["img-3", "img-1"]);
  });

  it("pins the full happy-path lifecycle: assigned → reassigned → completed", () => {
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "reassigned", "img-1", "emp-a", "2026-05-05T08:00:00.000Z", {
          reassignedTo: "emp-b",
        }),
        evt("e3", "completed", "img-1", "IGNORED-BY-FOLD", "2026-05-06T08:00:00.000Z"),
      ],
      rows,
      1
    );
    const entry = result.entries[0];
    expect(entry.status).toBe("completed");
    // `completed` keeps the PRIOR assignee, ignoring the event's own assignedTo.
    expect(entry.assignedTo).toBe("emp-b");
    expect(entry.lastEventId).toBe("e3");
    expect([...result.droppedEventIds]).toEqual([]);
  });

  it("pins reassigned falling back to assignedTo when reassignedTo is absent", () => {
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        // No reassignedTo — the handler falls back to event.assignedTo.
        evt("e2", "reassigned", "img-1", "emp-c", "2026-05-05T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries[0].assignedTo).toBe("emp-c");
    expect(result.entries[0].status).toBe("pending");
  });

  it("pins the replacement lifecycle and the terminal 'replaced' guard", () => {
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "replacement-requested", "img-1", "x", "2026-05-05T08:00:00.000Z"),
        evt("e3", "replaced", "img-1", "x", "2026-05-06T08:00:00.000Z", {
          replacedById: "img-9",
        }),
        // Anything after `replaced` that is not itself a `replaced` event is dropped.
        evt("e4", "completed", "img-1", "emp-a", "2026-05-07T08:00:00.000Z"),
        evt("e5", "reopened", "img-1", "emp-a", "2026-05-08T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries[0]).toMatchObject({
      status: "replaced",
      assignedTo: "emp-a",
      replacedById: "img-9",
      lastEventId: "e3",
    });
    expect([...result.droppedEventIds]).toEqual(["e4", "e5"]);
    expect([...result.droppedImageIds]).toEqual(["img-1"]);
  });

  it("SURPRISE: a second `replaced` event is NOT blocked and overwrites replacedById", () => {
    // isIllegalTerminalTransition only blocks `event.eventType !== "replaced"`
    // after a replaced entry (distributionDerivation.ts:52), so `replaced`
    // remains re-appliable forever once terminal.
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "replaced", "img-1", "x", "2026-05-05T08:00:00.000Z", { replacedById: "img-9" }),
        evt("e3", "replaced", "img-1", "x", "2026-05-06T08:00:00.000Z", { replacedById: "img-8" }),
        // …and a `replaced` event with no replacedById erases it back to null.
        evt("e4", "replaced", "img-1", "x", "2026-05-07T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries[0].replacedById).toBeNull();
    expect(result.entries[0].lastEventId).toBe("e4");
    expect([...result.droppedEventIds]).toEqual([]);
  });

  it("pins the completed-entry guard: assigned/reassigned dropped, others applied", () => {
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
        evt("e3", "assigned", "img-1", "emp-b", "2026-05-06T08:00:00.000Z"),
        evt("e4", "reassigned", "img-1", "emp-a", "2026-05-06T09:00:00.000Z", {
          reassignedTo: "emp-b",
        }),
      ],
      rows,
      1
    );
    expect(result.entries[0]).toMatchObject({
      status: "completed",
      assignedTo: "emp-a",
      lastEventId: "e2",
    });
    expect([...result.droppedEventIds]).toEqual(["e3", "e4"]);
  });

  it("SURPRISE: `reopen-requested` on a completed entry keeps status 'completed' but advances lastEventAt", () => {
    // The reopen-requested handler returns `existing?.status ?? "pending"`, and
    // the completed-guard does not cover it, so the entry stays completed while
    // its lastEventAt/lastEventId move forward — i.e. the entry is rewritten
    // with no visible status change.
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
        evt("e3", "reopen-requested", "img-1", "emp-a", "2026-05-06T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries[0]).toMatchObject({
      status: "completed",
      lastEventAt: "2026-05-06T08:00:00.000Z",
      lastEventId: "e3",
    });
    expect([...result.droppedEventIds]).toEqual([]);
  });

  it("pins `reopened` moving a completed entry back to pending", () => {
    const result = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
        evt("e3", "reopened", "img-1", "IGNORED", "2026-05-06T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(result.entries[0]).toMatchObject({ status: "pending", assignedTo: "emp-a" });
  });

  it("reports an event for an unknown xrayImageId in absentRowEventIds", () => {
    // No sample row → nothing to fold, but the absorption is now VISIBLE: the
    // event lands in its own `absentRowEventIds` set (and is logged via
    // errorLogger). It stays OUT of droppedEventIds/droppedImageIds, which mean
    // "a real row exists but this event was illegal/uninterpretable" and feed
    // the aggregated distribution:derive warning. Quota derivation excludes
    // both sets, so a phantom assignment no longer inflates a quota (pinned
    // separately below).
    const result = foldDistributionEvents(
      [evt("e1", "assigned", "ghost", "emp-a", "2026-05-04T08:00:00.000Z")],
      rows,
      1
    );
    expect(result.entries).toEqual([]);
    expect([...result.absentRowEventIds]).toEqual(["e1"]);
    expect([...result.droppedEventIds]).toEqual([]);
    expect([...result.droppedImageIds]).toEqual([]);
  });

  it("pins the newer-schema-version drop (and that a missing version reads as 1)", () => {
    const result = foldDistributionEvents(
      [
        // eventSchemaVersion absent → treated as 1 → accepted.
        { ...evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"), eventSchemaVersion: undefined },
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z", { eventSchemaVersion: 2 }),
      ],
      rows,
      1
    );
    expect(result.entries[0].status).toBe("pending");
    expect([...result.droppedEventIds]).toEqual(["e2"]);
    expect([...result.droppedImageIds]).toEqual(["img-1"]);
  });

  it("SURPRISE: an unknown event type with an existing entry is reported dropped AND still rewrites the entry", () => {
    // transitionForEvent falls through to the "preserve existing" branch, the
    // event is recorded as dropped, and then entries.set() runs anyway — so
    // lastEventAt/lastEventId advance to an event the fold claims it dropped.
    const unknown = {
      ...evt("e2", "assigned", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
      eventType: "invented-type",
    } as unknown as DistributionEvent;
    const result = foldDistributionEvents(
      [evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"), unknown],
      rows,
      1
    );
    expect([...result.droppedEventIds]).toEqual(["e2"]);
    expect(result.entries[0]).toMatchObject({
      status: "pending",
      lastEventAt: "2026-05-05T08:00:00.000Z",
      lastEventId: "e2",
    });
  });

  it("pins an unknown event type with NO existing entry: dropped, no entry created", () => {
    const unknown = {
      ...evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
      eventType: "invented-type",
    } as unknown as DistributionEvent;
    const result = foldDistributionEvents([unknown], rows, 1);
    expect(result.entries).toEqual([]);
    expect([...result.droppedEventIds]).toEqual(["e1"]);
  });

  it("SURPRISE: the fold is order-sensitive, not timestamp-sensitive — it never sorts by eventAt", () => {
    const ordered = foldDistributionEvents(
      [
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
      ],
      rows,
      1
    );
    // Same two events, reversed in the array: the completion lands first and
    // creates the entry outright (no prior assignment needed), after which the
    // genuinely-earlier assignment is rejected by the completed-terminal guard.
    const reversed = foldDistributionEvents(
      [
        evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z"),
        evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
      ],
      rows,
      1
    );
    expect(ordered.entries[0].status).toBe("completed");
    expect([...ordered.droppedEventIds]).toEqual([]);

    // Same end status — but reached by DROPPING the assignment rather than by
    // applying it, and `assignedTo` now comes from the completed event itself
    // (priorTransitionValues falls back to event.assignedTo with no existing
    // entry) instead of from the assignment.
    expect(reversed.entries[0]).toMatchObject({
      status: "completed",
      lastEventAt: "2026-05-05T08:00:00.000Z",
      lastEventId: "e2",
    });
    expect([...reversed.droppedEventIds]).toEqual(["e1"]);
  });

  it("pins the resume path: resumeEntries is copied, never mutated", () => {
    const first = foldDistributionEvents(
      [evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z")],
      rows,
      1
    );
    const resume = new Map<string, DistributionEntry>(
      first.entries.map((entry) => [entry.xrayImageId, entry])
    );
    const second = foldDistributionEvents(
      [evt("e2", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z")],
      rows,
      1,
      resume
    );
    expect(second.entries[0].status).toBe("completed");
    // The caller's own snapshot is untouched.
    expect(resume.get("img-1")!.status).toBe("pending");
    // Resumed entries that receive no new event are carried through verbatim.
    expect(second.entries).toHaveLength(1);
  });

  it("pins that resumed entries with no new events are re-emitted in map order", () => {
    const resume = new Map<string, DistributionEntry>([
      [
        "img-2",
        {
          xrayImageId: "img-2",
          status: "pending",
          assignedTo: "emp-z",
          replacedById: null,
          lastEventAt: "2026-05-01T00:00:00.000Z",
          lastEventId: "old",
          row: makeRow("img-2", "بحري"),
        },
      ],
    ]);
    const result = foldDistributionEvents(
      [evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z")],
      rows,
      1,
      resume
    );
    expect(result.entries.map((e) => e.xrayImageId)).toEqual(["img-2", "img-1"]);
  });

  it("pins the empty-input results", () => {
    expect(foldDistributionEvents([], rows, 1)).toEqual({
      entries: [],
      droppedEventIds: new Set(),
      droppedImageIds: new Set(),
      absentRowEventIds: new Set(),
    });
    // Events with an empty row set: every event is absorbed as absent-row
    // (logged once via the distribution:fold-no-rows key), never as dropped.
    const noRows = foldDistributionEvents(
      [evt("e1", "assigned", "img-1", "emp-a", "2026-05-04T08:00:00.000Z")],
      [],
      1
    );
    expect(noRows.entries).toEqual([]);
    expect([...noRows.absentRowEventIds]).toEqual(["e1"]);
    expect([...noRows.droppedEventIds]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// summarizeDistribution (used to interpret the fold's output)
// ---------------------------------------------------------------------------

describe("summarizeDistribution — golden master", () => {
  it("pins that replacement-requested counts as assigned but not pending", () => {
    const entries: DistributionEntry[] = (
      ["pending", "completed", "replaced", "replacement-requested"] as const
    ).map((status, i) => ({
      xrayImageId: `img-${i}`,
      assignedTo: "emp-a",
      status,
      replacedById: null,
      lastEventAt: "2026-05-04T08:00:00.000Z",
      row: makeRow(`img-${i}`),
    }));
    expect(summarizeDistribution(entries)).toEqual({
      totalAssigned: 3,
      totalCompleted: 1,
      totalReplaced: 1,
      totalPending: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// findLateEvent
// ---------------------------------------------------------------------------

describe("findLateEvent — golden master", () => {
  const entry: DistributionEntry = {
    xrayImageId: "img-1",
    assignedTo: "emp-a",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-05T08:00:00.000Z",
    lastEventId: "e5",
    row: makeRow("img-1"),
  };

  it("returns null for a strictly later event and for unknown images", () => {
    expect(
      findLateEvent([entry], [evt("e9", "completed", "img-1", "emp-a", "2026-05-06T08:00:00.000Z")])
    ).toBeNull();
    // Unknown image → never late, regardless of how old it is.
    expect(
      findLateEvent([entry], [evt("e0", "assigned", "img-9", "emp-a", "2020-01-01T00:00:00.000Z")])
    ).toBeNull();
  });

  it("flags an earlier timestamp and, on a tie, an eventId that sorts lower", () => {
    expect(
      findLateEvent([entry], [evt("e9", "completed", "img-1", "emp-a", "2026-05-04T08:00:00.000Z")])
        ?.eventId
    ).toBe("e9");
    expect(
      findLateEvent([entry], [evt("e1", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z")])
        ?.eventId
    ).toBe("e1");
    // Equal timestamp, equal id → not late (localeCompare === 0).
    expect(
      findLateEvent([entry], [evt("e5", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z")])
    ).toBeNull();
  });

  it("treats a checkpoint entry with no lastEventId as always late", () => {
    const legacy = { ...entry, lastEventId: undefined };
    expect(
      findLateEvent([legacy], [evt("z9", "completed", "img-1", "emp-a", "2026-05-05T08:00:00.000Z")])
        ?.eventId
    ).toBe("z9");
  });
});

// ---------------------------------------------------------------------------
// deriveEmployeeQuotasWithFacts
// ---------------------------------------------------------------------------

describe("deriveEmployeeQuotasWithFacts — golden master", () => {
  it("pins the full quota+facts output for a fixed assignment set", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z", {
        dailyQuota: 999,
        daysRemainingAtAssignment: 999,
      }),
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-02T00:00:00.000Z"),
      evt("a3", "assigned", "img-3", "emp-b", "2026-05-20T00:00:00.000Z"),
      // Non-assigned events never contribute.
      evt("c1", "completed", "img-1", "emp-a", "2026-05-03T00:00:00.000Z"),
    ];
    const { quotas, facts } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);

    // Deadline for May 2026 = 28 May 23:59:59 (3 days before month end).
    // emp-a first assigned 1 May 00:00Z → ceil(27d 23:59:59) = 28 days.
    // emp-b first assigned 20 May 00:00Z → ceil(8d 23:59:59)  = 9 days.
    expect(quotas).toEqual({
      "emp-a": {
        username: "emp-a",
        sampleCount: 2,
        // SURPRISE: the event's own frozen dailyQuota (999) is ignored whenever
        // the month folder name parses — it is recomputed from scratch here.
        dailyQuota: 1,
        daysRemainingAtAssignment: 28,
        assignedAt: "2026-05-01T00:00:00.000Z",
      },
      "emp-b": {
        username: "emp-b",
        sampleCount: 1,
        dailyQuota: 1,
        daysRemainingAtAssignment: 9,
        assignedAt: "2026-05-20T00:00:00.000Z",
      },
    });

    expect(facts.assignmentCounts).toEqual({ "emp-a": 2, "emp-b": 1 });
    expect(Object.keys(facts.firstAssignments)).toEqual(["emp-a", "emp-b"]);
    expect(facts.firstAssignments["emp-a"].eventId).toBe("a1");
    // Only events carrying BOTH quota fields land in latestStoredQuotas.
    expect(Object.keys(facts.latestStoredQuotas)).toEqual(["emp-a"]);
    expect(facts.latestStoredQuotas["emp-a"].eventId).toBe("a1");

    // deriveEmployeeQuotas is the same computation, quotas only.
    expect(deriveEmployeeQuotas(events, new Set(), MONTH)).toEqual(quotas);
  });

  it("pins the ceil-based dailyQuota arithmetic", () => {
    const events = Array.from({ length: 57 }, (_, i) =>
      evt(`a${i}`, "assigned", `img-${i}`, "emp-a", "2026-05-01T00:00:00.000Z")
    );
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);
    // ceil(57 / 28) === 3
    expect(quotas?.["emp-a"]).toMatchObject({ sampleCount: 57, dailyQuota: 3 });
  });

  it("SURPRISE: 'first assignment' is array order, not chronological order", () => {
    const events = [
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-20T00:00:00.000Z"),
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);
    // The 20 May event wins purely because it appears first in the array, so
    // the employee's whole quota is computed off the SHORTER window: 9 days
    // rather than 28. ceil(2/9) === 1 here, but the effect scales.
    expect(quotas?.["emp-a"]).toMatchObject({
      assignedAt: "2026-05-20T00:00:00.000Z",
      daysRemainingAtAssignment: 9,
    });
  });

  it("SURPRISE: duplicate `assigned` events for the SAME image inflate sampleCount", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
      evt("a2", "assigned", "img-1", "emp-a", "2026-05-02T00:00:00.000Z"),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);
    // One image, two events → sampleCount 2. Counting is per-event, not per-image.
    expect(quotas?.["emp-a"].sampleCount).toBe(2);
  });

  it("excludes assignments for images absent from the sample when the fold result is passed", () => {
    // Pairs with the fold behavior pinned above. Passing the whole FoldResult
    // (both exclusion sets) is what production does — the phantom assignment is
    // filtered out, so emp-a has no countable assignment left and drops out of
    // `quotas` entirely. Before the fix this returned sampleCount 1 and a
    // dailyQuota derived from it.
    const events = [evt("a1", "assigned", "ghost", "emp-a", "2026-05-01T00:00:00.000Z")];
    const fold = foldDistributionEvents(events, [makeRow("img-1")], 1);
    expect(fold.entries).toEqual([]);
    expect([...fold.absentRowEventIds]).toEqual(["a1"]);
    expect(deriveEmployeeQuotasWithFacts(events, fold, MONTH).quotas).toBeUndefined();

    // A bare Set is still accepted (callers holding only an explicit drop
    // list), and then only that list is excluded — this is the pre-fix shape.
    const legacy = deriveEmployeeQuotasWithFacts(events, fold.droppedEventIds, MONTH);
    expect(legacy.quotas?.["emp-a"].sampleCount).toBe(1);
  });

  it("counts a real assignment while excluding a phantom one from the same employee", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
      evt("a2", "assigned", "ghost", "emp-a", "2026-05-01T00:00:00.000Z"),
    ];
    const fold = foldDistributionEvents(events, [makeRow("img-1")], 1);
    const { quotas } = deriveEmployeeQuotasWithFacts(events, fold, MONTH);
    // sampleCount 1, not 2 — and dailyQuota follows from the honest count.
    expect(quotas?.["emp-a"]).toMatchObject({ sampleCount: 1, dailyQuota: 1 });
  });

  it("pins that dropped assignment events are excluded", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-02T00:00:00.000Z"),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(["a2"]), MONTH);
    expect(quotas?.["emp-a"].sampleCount).toBe(1);
  });

  it("SURPRISE: dropping ONLY the first assignment leaves the employee out entirely", () => {
    // firstAssignments is populated from non-dropped events only, so dropping
    // "a1" simply promotes "a2"; but if EVERY assignment is dropped the
    // employee vanishes — including from facts. Pinned here for the partial case.
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-20T00:00:00.000Z"),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(["a1"]), MONTH);
    expect(quotas?.["emp-a"]).toMatchObject({
      sampleCount: 1,
      assignedAt: "2026-05-20T00:00:00.000Z",
      daysRemainingAtAssignment: 9,
    });
  });

  it("pins the past-deadline clamp: 0 days remaining ⇒ dailyQuota === sampleCount", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-30T00:00:00.000Z"),
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-30T00:00:00.000Z"),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);
    expect(quotas?.["emp-a"]).toMatchObject({
      daysRemainingAtAssignment: 0,
      // Math.max(1, 0) === 1 → ceil(2/1) === 2
      dailyQuota: 2,
    });
  });

  it("pins the unparseable-month fallback to the event's frozen daysRemaining", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z"),
      evt("a2", "assigned", "img-2", "emp-a", "2026-05-02T00:00:00.000Z", {
        dailyQuota: 7,
        daysRemainingAtAssignment: 4,
      }),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), "not-a-month");
    expect(quotas?.["emp-a"]).toEqual({
      username: "emp-a",
      sampleCount: 2,
      // Falls back to the LATEST stored daysRemaining (4), while assignedAt
      // still comes from the FIRST assignment (a1) — the two fields are
      // sourced from different events.
      dailyQuota: 1,
      daysRemainingAtAssignment: 4,
      assignedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("pins that an unparseable month with no stored quota yields undefined quotas", () => {
    const events = [evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z")];
    const { quotas, facts } = deriveEmployeeQuotasWithFacts(events, new Set(), "not-a-month");
    // Empty result is normalized to undefined, but the facts are still returned.
    expect(quotas).toBeUndefined();
    expect(facts.assignmentCounts).toEqual({ "emp-a": 1 });
  });

  it("SURPRISE: an invalid eventAt with a parseable month also falls through to the stored quota", () => {
    const events = [
      evt("a1", "assigned", "img-1", "emp-a", "not-a-date", {
        dailyQuota: 7,
        daysRemainingAtAssignment: 6,
      }),
    ];
    const { quotas } = deriveEmployeeQuotasWithFacts(events, new Set(), MONTH);
    expect(quotas?.["emp-a"]).toMatchObject({
      daysRemainingAtAssignment: 6,
      assignedAt: "not-a-date",
      dailyQuota: 1,
    });
  });

  it("pins the resume path: prior facts are extended, first assignment is preserved", () => {
    const priorEvent = evt("a1", "assigned", "img-1", "emp-a", "2026-05-01T00:00:00.000Z");
    const resumeFacts: QuotaFacts = {
      assignmentCounts: { "emp-a": 1 },
      firstAssignments: { "emp-a": priorEvent },
      latestStoredQuotas: {},
    };
    const { quotas, facts } = deriveEmployeeQuotasWithFacts(
      [evt("a2", "assigned", "img-2", "emp-a", "2026-05-20T00:00:00.000Z")],
      new Set(),
      MONTH,
      resumeFacts
    );
    expect(facts.assignmentCounts).toEqual({ "emp-a": 2 });
    expect(facts.firstAssignments["emp-a"].eventId).toBe("a1");
    expect(quotas?.["emp-a"]).toMatchObject({
      sampleCount: 2,
      daysRemainingAtAssignment: 28,
    });
    // The caller's resumeFacts object is not mutated (shallow copies).
    expect(resumeFacts.assignmentCounts).toEqual({ "emp-a": 1 });
  });
});
