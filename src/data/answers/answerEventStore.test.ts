// Stage 1 of `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md`.
//
// These tests are the actual proof of this stage, not decoration: the fold has
// no production callers yet, so nothing else in the suite exercises it. The
// load-bearing ones are the DIFFERENTIAL tests (a later self-save must still win
// over an earlier supervisor event; `foldSingleItem` must agree with the full
// fold) and the DETERMINISM test (two folds of the same bytes must be
// byte-identical) — a happy-path assertion that "something plausible came back"
// would have passed against the exact designs three adversarial review rounds
// rejected.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  __resetAppendOnlyEventLogMemosForTests,
  maxSegmentBaseNameChars,
} from "../storage/appendOnlyEventLog";
import { VALUE_HISTORY_CAP } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import {
  ANSWER_DERIVE_VERSION,
  ANSWER_EVENT_LOG,
  ANSWER_EVENT_SEGMENT_SUFFIX,
  ANSWER_VALUE_HISTORY_CAP,
  type AnswerEvent,
  type AnswerFoldResult,
  AnswerFoldError,
  answerCheckpointResumeVerdict,
  answerEventSetId,
  answerEventSetIdFromIds,
  answerSegmentFileName,
  appendAnswerEventSegment,
  buildAnswerFoldCheckpoint,
  compareAnswerEventsForFold,
  findLateAnswerEvent,
  foldAnswerEvents,
  foldSingleItem,
  isAnswerEventOutOfOrder,
  readAnswerEventDelta,
  sortAnswerEventsForFold,
} from "./answerEventStore";

const MONTH = "5-may-2026";
const ASSIGNEE = "emp1";
const SUPERVISOR = "sup1";

/** A `migration-seed` for an employee who had no legacy file (§8's empty-hash case). */
const SEED: AnswerEvent = {
  eventId: "seed-0",
  eventType: "migration-seed",
  eventAt: "2026-05-01T00:00:00.000Z",
  eventBy: ASSIGNEE,
  authority: "self",
  legacyContentHash: "",
};

function saved(overrides: Partial<AnswerEvent> & { eventId: string; eventAt: string }): AnswerEvent {
  return {
    eventType: "item-saved",
    eventBy: ASSIGNEE,
    authority: "self",
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v" }],
    status: "submitted",
    answeredBy: ASSIGNEE,
    ...overrides,
  };
}

function reopened(
  overrides: Partial<AnswerEvent> & { eventId: string; eventAt: string }
): AnswerEvent {
  return {
    eventType: "item-reopened",
    eventBy: SUPERVISOR,
    authority: "supervisor",
    xrayImageId: "X1",
    reason: "يرجى التصحيح",
    ...overrides,
  };
}

function fold(events: readonly AnswerEvent[], extra: Record<string, unknown> = {}): AnswerFoldResult {
  return foldAnswerEvents(events, { username: ASSIGNEE, monthFolderName: MONTH, ...extra });
}

function itemOf(result: AnswerFoldResult, xrayImageId = "X1"): ItemAnswer {
  const item = result.file.items.find((i) => i.xrayImageId === xrayImageId);
  if (!item) throw new Error(`item ${xrayImageId} missing from the fold output`);
  return item;
}

/* ───────────────────────────── 1. basic fold ────────────────────────────── */

describe("foldAnswerEvents — basic correctness", () => {
  it("folds item-saved events into current item state", () => {
    const result = fold([
      SEED,
      saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
      saved({
        eventId: "e2",
        eventAt: "2026-05-10T11:00:00.000Z",
        xrayImageId: "X2",
        answers: [{ fieldId: "f1", value: "other" }],
      }),
    ]);

    expect(result.file.items.map((i) => i.xrayImageId)).toEqual(["X1", "X2"]);
    expect(itemOf(result).status).toBe("submitted");
    expect(itemOf(result).answeredBy).toBe(ASSIGNEE);
    expect(result.file.username).toBe(ASSIGNEE);
    expect(result.file.monthFolderName).toBe(MONTH);
    expect(result.dropped).toEqual([]);
    expect(result.refusals).toEqual([]);
  });

  it("takes the LATEST by (eventAt, eventId), not by append order", () => {
    // Appended newest-first, exactly as an out-of-order segment read can present.
    const result = fold([
      saved({
        eventId: "e2",
        eventAt: "2026-05-10T12:00:00.000Z",
        answers: [{ fieldId: "f1", value: "late" }],
      }),
      saved({
        eventId: "e1",
        eventAt: "2026-05-10T10:00:00.000Z",
        answers: [{ fieldId: "f1", value: "early" }],
      }),
      SEED,
    ]);

    expect(itemOf(result).answers).toEqual([{ fieldId: "f1", value: "late" }]);
    // The overwritten value is preserved in the A4 snapshot, oldest first.
    expect(itemOf(result).valueHistory).toHaveLength(1);
    expect(itemOf(result).valueHistory![0]!.previous.answers).toEqual([
      { fieldId: "f1", value: "early" },
    ]);
  });

  it("breaks an equal-eventAt, equal-authority tie by eventId", () => {
    const result = fold([
      SEED,
      saved({
        eventId: "b",
        eventAt: "2026-05-10T10:00:00.000Z",
        answers: [{ fieldId: "f1", value: "b" }],
      }),
      saved({
        eventId: "a",
        eventAt: "2026-05-10T10:00:00.000Z",
        answers: [{ fieldId: "f1", value: "a" }],
      }),
    ]);
    expect(itemOf(result).answers).toEqual([{ fieldId: "f1", value: "b" }]);
  });

  it("reproduces reopen and quality-note semantics from answerStorage", () => {
    const result = fold([
      SEED,
      saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
      reopened({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" }),
      {
        eventId: "e3",
        eventType: "quality-note-set",
        eventAt: "2026-05-10T12:00:00.000Z",
        eventBy: SUPERVISOR,
        authority: "supervisor",
        xrayImageId: "X1",
        qualityNote: "  انتبه للتفاصيل  ",
      },
    ]);

    const item = itemOf(result);
    expect(item.status).toBe("draft");
    expect(item.submittedAt).toBeNull();
    expect(item.history!.map((h) => h.action)).toEqual(["reopened"]);
    expect(item.history![0]!.previousSubmittedAt).toBe("2026-05-10T10:00:00.000Z");
    expect(item.qualityNote).toBe("انتبه للتفاصيل");
    // A reopen records no A4 snapshot — `reopenItemAnswer` maps in place today.
    expect(item.valueHistory ?? []).toHaveLength(0);
  });

  it("treats reopen of a non-submitted item and a note on a missing item as no-ops", () => {
    const result = fold([
      SEED,
      reopened({ eventId: "r1", eventAt: "2026-05-10T09:00:00.000Z" }),
      {
        eventId: "q1",
        eventType: "quality-note-set",
        eventAt: "2026-05-10T09:30:00.000Z",
        eventBy: SUPERVISOR,
        authority: "supervisor",
        xrayImageId: "X9",
        qualityNote: "note",
      },
    ]);
    expect(result.file.items).toEqual([]);
    // Both were folded (they are in the marker set and the known-id set) — they
    // simply changed nothing.
    expect(result.foldedEventIds).toEqual(["q1", "r1", "seed-0"]);
    expect(Object.keys(result.markers).sort()).toEqual(["X1", "X9"]);
  });
});

/* ───────── 2. the regression an earlier design round found broken ────────── */

describe("a LATER self-authored save wins over an EARLIER supervisor event (§4)", () => {
  it("reopen-then-correct: the employee's fix wins over the supervisor's reopen", () => {
    // The single most important correction flow in the app. Under the rejected
    // `authority`-as-primary-key design the reopen would outrank the fix
    // forever, and the item would never leave "draft".
    const result = fold([
      SEED,
      saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
      reopened({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" }),
      saved({
        eventId: "e3",
        eventAt: "2026-05-10T12:00:00.000Z",
        answers: [{ fieldId: "f1", value: "مصححة" }],
      }),
    ]);

    const item = itemOf(result);
    expect(item.status).toBe("submitted");
    expect(item.answers).toEqual([{ fieldId: "f1", value: "مصححة" }]);
    // The correction is recorded as a reopen-correction, not a plain save.
    expect(item.valueHistory).toHaveLength(1);
    expect(item.valueHistory![0]!.reason).toBe("reopen-correction");
    // The oversight trail survives the employee's re-save (withStoredHistory).
    expect(item.history!.map((h) => h.action)).toEqual(["reopened"]);
  });

  it("a later self-save wins over an earlier on-behalf save, and clears the attribution", () => {
    // Same contract `answerOnBehalf.test.ts` pins for the legacy path: "the
    // trail survives the assignee re-answering, and the attribution field
    // clears" + "the assignee may still overwrite their OWN submitted answer".
    const result = fold([
      SEED,
      saved({
        eventId: "e1",
        eventAt: "2026-05-10T10:00:00.000Z",
        eventBy: SUPERVISOR,
        authority: "supervisor",
        answeredOnBehalfBy: SUPERVISOR,
        reason: "تغطية إجازة",
        answers: [{ fieldId: "f1", value: "سليمة" }],
      }),
      saved({
        eventId: "e2",
        eventAt: "2026-05-10T11:00:00.000Z",
        answers: [{ fieldId: "f1", value: "مراجعة الموظف" }],
      }),
    ]);

    const item = itemOf(result);
    expect(item.answers).toEqual([{ fieldId: "f1", value: "مراجعة الموظف" }]);
    expect(item.answeredBy).toBe(ASSIGNEE);
    expect(item.answeredOnBehalfBy).toBeUndefined();
    // Permanent record of the supervisor's authorship stays on file.
    expect(item.history).toHaveLength(1);
    expect(item.history![0]!.action).toBe("answered-on-behalf");
    expect(item.history![0]!.by).toBe(SUPERVISOR);
    expect(item.history![0]!.onBehalfOf).toBe(ASSIGNEE);
    expect(item.valueHistory![0]!.changedBy).toBe(ASSIGNEE);
  });

  it("refuses an on-behalf save onto an already-submitted item, changing nothing", () => {
    const before = fold([SEED, saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })]);
    const after = fold([
      SEED,
      saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
      saved({
        eventId: "e2",
        eventAt: "2026-05-10T11:00:00.000Z",
        eventBy: SUPERVISOR,
        authority: "supervisor",
        answeredOnBehalfBy: SUPERVISOR,
        answers: [{ fieldId: "f1", value: "اشتباه" }],
      }),
    ]);

    expect(after.refusals).toEqual([
      { eventId: "e2", xrayImageId: "X1", reason: "on-behalf-already-submitted" },
    ]);
    expect(itemOf(after)).toEqual(itemOf(before));
  });

  it("allows the on-behalf save again once a reopen flipped the item to draft", () => {
    const result = fold([
      SEED,
      saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
      reopened({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" }),
      saved({
        eventId: "e3",
        eventAt: "2026-05-10T12:00:00.000Z",
        eventBy: SUPERVISOR,
        authority: "supervisor",
        answeredOnBehalfBy: SUPERVISOR,
        answers: [{ fieldId: "f1", value: "مصححة" }],
      }),
    ]);

    expect(result.refusals).toEqual([]);
    expect(itemOf(result).answeredOnBehalfBy).toBe(SUPERVISOR);
    expect(itemOf(result).history!.map((h) => h.action)).toEqual([
      "reopened",
      "answered-on-behalf",
    ]);
  });

  it("author === assignee routed through the on-behalf shape is a plain self-answer", () => {
    const result = fold([
      SEED,
      saved({
        eventId: "e1",
        eventAt: "2026-05-10T10:00:00.000Z",
        answeredOnBehalfBy: " EMP1 ",
      }),
    ]);
    expect(itemOf(result).answeredOnBehalfBy).toBeUndefined();
    expect(itemOf(result).history ?? []).toHaveLength(0);
  });
});

/* ──────────────── 3. authority: tie-break at equal eventAt ONLY ──────────── */

describe("authority is a tie-break at exactly equal eventAt, never a ranking (§4)", () => {
  const AT = "2026-05-10T10:00:00.000Z";
  // eventId "a-sup" < "z-self", so an eventId-only tie-break would hand the win
  // to the self event. Only the authority rule can flip it.
  const supervisorEvent = saved({
    eventId: "a-sup",
    eventAt: AT,
    eventBy: SUPERVISOR,
    authority: "supervisor",
    answeredOnBehalfBy: SUPERVISOR,
    answers: [{ fieldId: "f1", value: "supervisor" }],
    status: "draft",
    submittedAt: null,
  });
  const selfEvent = saved({
    eventId: "z-self",
    eventAt: AT,
    answers: [{ fieldId: "f1", value: "self" }],
    status: "draft",
    submittedAt: null,
  });

  it("supervisor wins a genuine same-instant race", () => {
    const result = fold([SEED, selfEvent, supervisorEvent]);
    expect(itemOf(result).answers).toEqual([{ fieldId: "f1", value: "supervisor" }]);
    expect(compareAnswerEventsForFold(selfEvent, supervisorEvent)).toBeLessThan(0);
  });

  it("does NOT override when eventAt differs, even by one millisecond", () => {
    const laterSelf = { ...selfEvent, eventAt: "2026-05-10T10:00:00.001Z" };
    const result = fold([SEED, laterSelf, supervisorEvent]);
    expect(itemOf(result).answers).toEqual([{ fieldId: "f1", value: "self" }]);
    expect(compareAnswerEventsForFold(supervisorEvent, laterSelf)).toBeLessThan(0);
  });

  it("sortAnswerEventsForFold orders (eventAt, authority, eventId)", () => {
    const ordered = sortAnswerEventsForFold([
      supervisorEvent,
      { ...selfEvent, eventAt: "2026-05-10T10:00:00.001Z" },
      selfEvent,
    ]);
    expect(ordered.map((e) => e.eventId)).toEqual(["z-self", "a-sup", "z-self"]);
  });
});

/* ─────────────────────────── 4. determinism ─────────────────────────────── */

describe("the fold is a pure function of its event bytes", () => {
  const events: AnswerEvent[] = [
    SEED,
    saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" }),
    reopened({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" }),
    saved({
      eventId: "e3",
      eventAt: "2026-05-10T12:00:00.000Z",
      answers: [{ fieldId: "f1", value: "مصححة" }],
    }),
  ];

  it("folding the same array twice produces byte-identical output", () => {
    expect(JSON.stringify(fold(events))).toBe(JSON.stringify(fold(events)));
  });

  it("folding a shuffled copy produces the same state (the order is in the events, not the array)", () => {
    const shuffled = [events[3]!, events[1]!, events[0]!, events[2]!];
    expect(JSON.stringify(fold(shuffled).file)).toBe(JSON.stringify(fold(events).file));
  });

  it("every folded timestamp comes from an event, never from the clock", () => {
    const result = fold(events);
    const item = itemOf(result);
    expect(item.valueHistory![0]!.changedAt).toBe("2026-05-10T12:00:00.000Z");
    expect(item.history![0]!.at).toBe("2026-05-10T11:00:00.000Z");
    expect(item.lastSavedAt).toBe("2026-05-10T12:00:00.000Z");
    expect(item.submittedAt).toBe("2026-05-10T12:00:00.000Z");
  });
});

/* ─────────────────── 5. valueHistory cap on the OUTPUT ──────────────────── */

describe("valueHistory is capped in the fold OUTPUT, not in the events (§5)", () => {
  it("keeps the original entry plus the most recent CAP-1, from an uncapped input", () => {
    const total = ANSWER_VALUE_HISTORY_CAP + 5;
    const events: AnswerEvent[] = [SEED];
    for (let index = 0; index <= total; index += 1) {
      events.push(
        saved({
          eventId: `e${String(index).padStart(3, "0")}`,
          eventAt: `2026-05-10T${String(index).padStart(2, "0")}:00:00.000Z`,
          answers: [{ fieldId: "f1", value: index === 0 ? "orig" : `v${index}` }],
        })
      );
    }

    const result = fold(events);
    const item = itemOf(result);
    expect(item.valueHistory).toHaveLength(ANSWER_VALUE_HISTORY_CAP);
    expect(item.valueHistory![0]!.previous.answers).toEqual([{ fieldId: "f1", value: "orig" }]);
    const last = item.valueHistory![item.valueHistory!.length - 1]!;
    expect(last.previous.answers).toEqual([{ fieldId: "f1", value: `v${total - 1}` }]);
    // The events themselves are the uncapped source of truth.
    expect(result.foldedEventIds).toHaveLength(total + 2);
  });

  it("uses the same cap as the legacy path", () => {
    expect(ANSWER_VALUE_HISTORY_CAP).toBe(VALUE_HISTORY_CAP);
  });
});

/* ──────────── 6. foldSingleItem agrees with the full fold (§5) ───────────── */

describe("foldSingleItem is consistent with foldAnswerEvents", () => {
  const events: AnswerEvent[] = [
    SEED,
    saved({ eventId: "a1", eventAt: "2026-05-10T10:00:00.000Z" }),
    saved({ eventId: "b1", eventAt: "2026-05-10T10:30:00.000Z", xrayImageId: "X2" }),
    reopened({ eventId: "a2", eventAt: "2026-05-10T11:00:00.000Z" }),
    saved({
      eventId: "a3",
      eventAt: "2026-05-10T12:00:00.000Z",
      answers: [{ fieldId: "f1", value: "مصححة" }],
    }),
    saved({
      eventId: "b2",
      eventAt: "2026-05-10T13:00:00.000Z",
      xrayImageId: "X2",
      eventBy: SUPERVISOR,
      authority: "supervisor",
      answeredOnBehalfBy: SUPERVISOR,
    }),
  ];

  it("matches the whole-set fold for each item, byte for byte", () => {
    const full = fold(events);
    for (const xrayImageId of ["X1", "X2"]) {
      const single = foldSingleItem(events, xrayImageId, {
        username: ASSIGNEE,
        monthFolderName: MONTH,
      });
      expect(JSON.stringify(single)).toBe(JSON.stringify(itemOf(full, xrayImageId)));
    }
  });

  it("reports the same refusal outcome as the full fold", () => {
    // X2 is submitted by the assignee first, so the later on-behalf save is refused.
    const withPriorSubmit = [
      ...events,
      saved({
        eventId: "b0",
        eventAt: "2026-05-10T12:30:00.000Z",
        xrayImageId: "X2",
        answers: [{ fieldId: "f1", value: "الموظف" }],
      }),
    ];
    const full = fold(withPriorSubmit);
    expect(full.refusals.map((r) => r.eventId)).toEqual(["b2"]);
    const single = foldSingleItem(withPriorSubmit, "X2", {
      username: ASSIGNEE,
      monthFolderName: MONTH,
    });
    expect(JSON.stringify(single)).toBe(JSON.stringify(itemOf(full, "X2")));
  });

  it("returns undefined for an item the events never touch", () => {
    expect(foldSingleItem(events, "X404", { username: ASSIGNEE })).toBeUndefined();
  });
});

/* ─────────────────────── 7. the migration-seed marker (§8) ──────────────── */

describe("migration-seed marker (§8)", () => {
  const legacyItem: ItemAnswer = {
    xrayImageId: "L1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "legacy" }],
    lastSavedAt: "2026-05-02T08:00:00.000Z",
    submittedAt: "2026-05-02T08:00:00.000Z",
    answeredBy: ASSIGNEE,
    status: "submitted",
  };
  const seedWithLegacy: AnswerEvent = { ...SEED, legacyContentHash: "hash-abc" };
  const legacySeed = { contentHash: "hash-abc", items: [legacyItem] };

  it("seeds from the named legacy content when the marker is found", () => {
    const result = fold(
      [seedWithLegacy, saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })],
      { legacySeed }
    );
    expect(result.seeded).toBe(true);
    expect(result.file.items.map((i) => i.xrayImageId)).toEqual(["L1", "X1"]);
    expect(itemOf(result, "L1").answers).toEqual([{ fieldId: "f1", value: "legacy" }]);
  });

  it("seeds exactly once — a second marker in the chain changes nothing", () => {
    const once = fold([seedWithLegacy], { legacySeed });
    const twice = fold(
      [seedWithLegacy, { ...seedWithLegacy, eventId: "seed-1", legacyContentHash: "hash-other" }],
      { legacySeed }
    );
    expect(JSON.stringify(twice.file)).toBe(JSON.stringify(once.file));
  });

  it("a chain with events but NO marker anywhere is a hard read failure, not empty state", () => {
    expect(() => fold([saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })])).toThrow(
      AnswerFoldError
    );
    expect(() => fold([saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })])).toThrow(
      /no migration-seed marker/
    );
  });

  it("an empty event set is not a failure — there is no chain to be missing a marker from", () => {
    const result = fold([]);
    expect(result.file.items).toEqual([]);
    expect(result.seeded).toBe(false);
  });

  it("refuses to guess when the legacy snapshot is missing or does not match the named hash", () => {
    expect(() => fold([seedWithLegacy])).toThrow(/no legacy snapshot was supplied/);
    expect(() =>
      fold([seedWithLegacy], { legacySeed: { contentHash: "hash-other", items: [legacyItem] } })
    ).toThrow(/hashes to hash-other/);
  });

  it("an empty legacyContentHash seeds nothing and is still a valid marker", () => {
    const result = fold([SEED, saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })]);
    expect(result.seeded).toBe(true);
    expect(result.file.items.map((i) => i.xrayImageId)).toEqual(["X1"]);
  });

  it("a resumed fold does not demand the marker again", () => {
    const first = fold([seedWithLegacy], { legacySeed });
    const second = fold([saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })], {
      resume: first,
    });
    expect(second.seeded).toBe(true);
    expect(second.file.items.map((i) => i.xrayImageId)).toEqual(["L1", "X1"]);
  });

  it("reports an unrecognized event type instead of throwing (forward compatibility)", () => {
    const result = fold([
      SEED,
      { ...saved({ eventId: "e9", eventAt: "2026-05-10T10:00:00.000Z" }), eventType: "future-type" as never },
    ]);
    expect(result.dropped).toEqual([{ eventId: "e9", reason: "unrecognized-type" }]);
    expect(result.file.items).toEqual([]);
  });
});

/* ─────────────── 8. late-event detection (same comparator) ──────────────── */

describe("late-event detection uses the SAME comparator as the fold (§1 Gap 1b)", () => {
  const base = fold([SEED, saved({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" })]);

  it("an event earlier than the marker is late — the caller must refold, not patch", () => {
    const late = saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" });
    expect(isAnswerEventOutOfOrder(late, base.markers.X1)).toBe(true);
    expect(findLateAnswerEvent(base.markers, [late])?.eventId).toBe("e1");
  });

  it("a later event, and an event for an unseen item, are not late", () => {
    const next = saved({ eventId: "e3", eventAt: "2026-05-10T12:00:00.000Z" });
    const other = saved({ eventId: "e4", eventAt: "2026-05-01T00:00:00.000Z", xrayImageId: "X9" });
    expect(isAnswerEventOutOfOrder(next, base.markers.X1)).toBe(false);
    expect(findLateAnswerEvent(base.markers, [next, other])).toBeNull();
  });

  it("applies the authority tie-break at equal eventAt, exactly as the fold does", () => {
    const sameInstantSelf = saved({ eventId: "e2b", eventAt: "2026-05-10T11:00:00.000Z" });
    // The marker's event is self-authored at the same instant with a smaller
    // eventId, so a same-instant SELF event sorts after it (not late) …
    expect(isAnswerEventOutOfOrder(sameInstantSelf, base.markers.X1)).toBe(false);
    // … while a same-instant SUPERVISOR event outranks it, which is also "not
    // late" — the two sides agree because there is only one comparator.
    const supervisorSameInstant = reopened({ eventId: "a", eventAt: "2026-05-10T11:00:00.000Z" });
    expect(isAnswerEventOutOfOrder(supervisorSameInstant, base.markers.X1)).toBe(false);
    // A self event at the same instant with a SMALLER id genuinely is late.
    expect(
      isAnswerEventOutOfOrder(saved({ eventId: "a", eventAt: "2026-05-10T11:00:00.000Z" }), base.markers.X1)
    ).toBe(true);
  });

  it("an older marker format that cannot be ordered counts as late (conservative)", () => {
    const marker = { lastEventAt: "2026-05-10T11:00:00.000Z" };
    expect(isAnswerEventOutOfOrder(saved({ eventId: "z", eventAt: "2026-05-11T00:00:00.000Z" }), marker)).toBe(
      true
    );
  });

  it("an absent marker is never late", () => {
    expect(isAnswerEventOutOfOrder(saved({ eventId: "e", eventAt: "2026-05-10T10:00:00.000Z" }), undefined)).toBe(
      false
    );
  });
});

/* ─────────────── 9. checkpoint resume + dedup across the boundary ───────── */

describe("checkpoint resume and dedup (§1 bullet 2)", () => {
  const batch1: AnswerEvent[] = [SEED, saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })];
  const batch2: AnswerEvent[] = [
    reopened({ eventId: "e2", eventAt: "2026-05-10T11:00:00.000Z" }),
    saved({
      eventId: "e3",
      eventAt: "2026-05-10T12:00:00.000Z",
      answers: [{ fieldId: "f1", value: "مصححة" }],
    }),
  ];

  it("resuming folds only the new events and lands on the full-replay state", () => {
    const resumed = fold(batch2, { resume: fold(batch1) });
    const full = fold([...batch1, ...batch2]);
    expect(JSON.stringify(resumed.file)).toBe(JSON.stringify(full.file));
    expect(resumed.foldedEventIds).toEqual(full.foldedEventIds);
    expect(resumed.eventSetId).toBe(full.eventSetId);
  });

  it("a duplicate eventId across the boundary is deduped, never applied twice", () => {
    // `eventId` is stable per user action by design (§3), so a retried append
    // after an ambiguous failure re-presents the SAME id — the dedup is what
    // makes that a detectable duplicate rather than a double-applied save.
    const first = fold([...batch1, ...batch2]);
    const replayed = fold([batch2[1]!, ...batch2], { resume: first });

    expect(replayed.dropped.every((d) => d.reason === "already-folded")).toBe(true);
    expect(replayed.dropped).toHaveLength(3);
    expect(JSON.stringify(replayed.file)).toBe(JSON.stringify(first.file));
    // Not double-counted in the A4 trail either.
    expect(itemOf(replayed).valueHistory).toHaveLength(1);
  });

  it("a duplicate eventId WITHIN one batch is applied ONCE, not twice", () => {
    // Content resolution for a repeated id is the generic module's, unchanged:
    // `filterAlreadyFolded` keeps first-seen ORDER and the last copy's CONTENT.
    // Same-id-different-content is out of contract — it is a merge error the
    // backup layer must detect (§8a), not something this fold arbitrates — so
    // what is pinned here is that the event is absorbed exactly once.
    const duplicate = saved({
      eventId: "e3",
      eventAt: "2026-05-10T12:00:00.000Z",
      answers: [{ fieldId: "f1", value: "نسخة ثانية" }],
    });
    const result = fold([...batch1, ...batch2, duplicate]);
    expect(result.dropped).toEqual([{ eventId: "e3", reason: "duplicate-event-id" }]);
    expect(result.foldedEventIds).toEqual(["e1", "e2", "e3", "seed-0"]);
    expect(itemOf(result).valueHistory).toHaveLength(1);

    // A byte-identical duplicate — the real retry case — is indistinguishable
    // from the single-copy fold.
    const retried = fold([...batch1, ...batch2, batch2[1]!]);
    expect(JSON.stringify(retried.file)).toBe(JSON.stringify(fold([...batch1, ...batch2]).file));
  });

  it("builds a checkpoint whose digest binds it to the folded event set", () => {
    const result = fold([...batch1, ...batch2]);
    const checkpoint = buildAnswerFoldCheckpoint(result, { "a.ndjson": 512 });

    expect(checkpoint.segmentOffsets).toEqual({ "a.ndjson": 512 });
    expect(checkpoint.knownEventIds).toEqual(["e1", "e2", "e3", "seed-0"]);
    expect(checkpoint.deriveVersion).toBe(ANSWER_DERIVE_VERSION);
    expect(checkpoint.eventSetId).toBe(answerEventSetIdFromIds(checkpoint.knownEventIds));
    // The digest is a SET identity: the same events discovered in a different
    // order must produce the same value, or the cache-validity binding is noise.
    expect(answerEventSetId([...batch2, ...batch1])).toBe(checkpoint.eventSetId);
    expect(answerCheckpointResumeVerdict(checkpoint, checkpoint.eventSetId)).toEqual({
      usable: true,
    });
  });

  it("resumes correctly from a checkpoint reconstructed from its PERSISTED shape, not the in-memory fold result", () => {
    // The regression this guards: buildAnswerFoldCheckpoint used to drop
    // `seeded`, so a Stage 2 read path that reconstructs a resume state from
    // disk (checkpoint + cached file, never the original in-memory
    // AnswerFoldResult) would default seeded to false and hit the "no
    // migration-seed marker" hard failure on the very next incremental fold
    // — a spurious "this employee has no answers" false negative one read
    // after the first checkpoint. Simulate exactly that cold-resume path:
    // only fields the persisted checkpoint actually carries are used below,
    // nothing borrowed from the original in-memory result.
    const original = fold(batch1);
    const checkpoint = buildAnswerFoldCheckpoint(original, { "a.ndjson": 256 });

    const resumeFromDisk: AnswerFoldResult = {
      file: original.file,
      markers: {}, // not persisted by the checkpoint — degrades to "unknown order", safe
      seeded: checkpoint.seeded,
      foldedEventIds: checkpoint.knownEventIds,
      eventSetId: checkpoint.eventSetId ?? answerEventSetIdFromIds(checkpoint.knownEventIds),
      deriveVersion: checkpoint.deriveVersion,
      refusals: [],
      dropped: [],
    };

    expect(() => fold(batch2, { resume: resumeFromDisk })).not.toThrow();
    const resumed = fold(batch2, { resume: resumeFromDisk });
    const full = fold([...batch1, ...batch2]);
    expect(JSON.stringify(resumed.file)).toBe(JSON.stringify(full.file));
  });

  it("rejects a checkpoint from another derive version, a missing digest, or a mismatched one", () => {
    const result = fold([...batch1, ...batch2]);
    const checkpoint = buildAnswerFoldCheckpoint(result, {});
    expect(
      answerCheckpointResumeVerdict({ ...checkpoint, deriveVersion: 0 }, checkpoint.eventSetId)
    ).toEqual({ usable: false, reason: "derive-version" });
    expect(
      answerCheckpointResumeVerdict({ ...checkpoint, eventSetId: undefined }, checkpoint.eventSetId)
    ).toEqual({ usable: false, reason: "digest-absent" });
    expect(answerCheckpointResumeVerdict(checkpoint, "d1:0:0:0")).toEqual({
      usable: false,
      reason: "digest-mismatch",
    });
  });
});

/* ────────────── the storage binding, end to end on a memory dir ─────────── */

describe("the answers binding of the generic append-only event log", () => {
  beforeEach(() => {
    __resetAppendOnlyEventLogMemosForTests();
  });

  const writer = { deviceId: "device-uuid-1", sessionId: "session-uuid-1", scopeId: "ws|5-may" };

  it("uses the ans namespace and a segment name inside the UNC length budget", () => {
    expect(ANSWER_EVENT_LOG.consumerNamespace).toBe("ans");
    const name = answerSegmentFileName(writer);
    const budget = maxSegmentBaseNameChars(ANSWER_EVENT_SEGMENT_SUFFIX);
    expect(name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX)).toBe(true);
    expect(name).toContain("-ans-");
    expect(name.length - ANSWER_EVENT_SEGMENT_SUFFIX.length).toBeLessThanOrEqual(budget);
  });

  it("round-trips events through a segment and folds them to the same state", async () => {
    const dir = createMemoryDirectory();
    const events = [SEED, saved({ eventId: "e1", eventAt: "2026-05-10T10:00:00.000Z" })];

    expect(await appendAnswerEventSegment(dir, events, writer)).toBe("verified");
    const delta = await readAnswerEventDelta(dir, {});

    expect(delta.events.map((e) => e.eventId)).toEqual(["seed-0", "e1"]);
    expect(delta.segmentNames).toEqual([answerSegmentFileName(writer)]);
    expect(JSON.stringify(fold(delta.events).file)).toBe(JSON.stringify(fold(events).file));

    // A second read past the recorded offsets yields nothing new — the
    // checkpoint contract the resume path depends on.
    const second = await readAnswerEventDelta(dir, delta.offsets);
    expect(second.events).toEqual([]);
  });
});
