// Landing a queued (outbox) answer with the identity minted at SUBMIT time.
//
// SEED FINDING (plan Task 2, Step 1): `resolveSeed` derives the migration-seed
// event from the identity passed in: id = `${eventId}-seed`, time = `eventAt`.
// So the seed is already deterministic in the identity -- landing the same
// identity twice (or retrying a first landing that failed after the seed was
// built) can never mint a second, differently-named seed. Beyond that, a second
// landing finds the employee already seeded (`alreadySeeded`) and builds no seed
// at all. No change to `resolveSeed` was needed; the seed assertions below pin
// that behaviour.
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  loadEmployeeAnswers,
  mintAnswerEventIdentity,
  readAllAnswerEventsForMonth,
  upsertItemAnswer,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { __pinNewAnswerMonthsToV1ForTests } from "./v2/answerEventsLayout";

// This suite pins the v1 flat answers layout for months it creates (layout v2: brand-new months start per-assignee).
beforeEach(() => __pinNewAnswerMonthsToV1ForTests(true));
afterEach(() => __pinNewAnswerMonthsToV1ForTests(false));

const MONTH = "5-may-2026";

function setup(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

function makeSubmittedItem(id: string, user: string, savedAt: string): ItemAnswer {
  return {
    xrayImageId: id,
    answeredBy: user,
    answers: [],
    status: "submitted",
    submittedAt: savedAt,
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: savedAt,
  };
}

describe("upsertItemAnswer with a fixed identity", () => {
  it("landing the same identity twice folds to one item and one event", async () => {
    const dir = setup();
    const identity = mintAnswerEventIdentity();
    const item = makeSubmittedItem("IMG-1", "u1", identity.eventAt);
    expect((await upsertItemAnswer(dir, MONTH, "u1", item, identity)).ok).toBe(true);
    expect((await upsertItemAnswer(dir, MONTH, "u1", item, identity)).ok).toBe(true);

    const events = await readAllAnswerEventsForMonth(dir, MONTH);
    expect(events.filter((e) => e.eventId === identity.eventId)).toHaveLength(1);
    const file = await loadEmployeeAnswers(dir, MONTH, "u1");
    expect(file.items.filter((i) => i.xrayImageId === "IMG-1")).toHaveLength(1);
  });

  it("mints exactly one deterministic seed event across repeated landings", async () => {
    const dir = setup();
    const identity = mintAnswerEventIdentity();
    const item = makeSubmittedItem("IMG-1", "u1", identity.eventAt);
    await upsertItemAnswer(dir, MONTH, "u1", item, identity);
    await upsertItemAnswer(dir, MONTH, "u1", item, identity);

    const seeds = (await readAllAnswerEventsForMonth(dir, MONTH)).filter(
      (e) => e.eventType === "migration-seed"
    );
    expect(seeds.map((s) => s.eventId)).toEqual([`${identity.eventId}-seed`]);
  });

  it("uses the supplied eventAt, not the landing time", async () => {
    const dir = setup();
    const identity = { eventId: "fixed-id", eventAt: "2026-10-13T08:00:00.000Z" };
    await upsertItemAnswer(dir, MONTH, "u1", makeSubmittedItem("IMG-2", "u1", identity.eventAt), identity);
    const ev = (await readAllAnswerEventsForMonth(dir, MONTH)).find((e) => e.eventId === "fixed-id");
    expect(ev?.eventAt).toBe("2026-10-13T08:00:00.000Z");
  });

  it("mintAnswerEventIdentity yields a fresh id and a strictly increasing time", () => {
    const a = mintAnswerEventIdentity();
    const b = mintAnswerEventIdentity();
    expect(a.eventId).not.toBe(b.eventId);
    expect(Date.parse(b.eventAt)).toBeGreaterThan(Date.parse(a.eventAt));
  });
});
