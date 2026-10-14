// src/data/answers/v2/answerSnapshot.parity.test.ts
import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../../sampling/rng";
import {
  foldAnswerEvents,
  sortAnswerEventsForFold,
  type AnswerEvent,
  type AnswerFoldResult,
  type AnswerLegacySeed,
} from "../answerEventStore";
import type { ItemAnswer } from "../answerTypes";
import { foldSnapshotPlusDelta, snapshotDraftFromFold, v1OffsetKey } from "./answerSnapshot";

const MONTH = "5-may-2026";
const USER = "emp1";
const LEGACY_ITEM: ItemAnswer = {
  xrayImageId: "X0",
  templateId: "t",
  templateVersion: 1,
  answers: [{ fieldId: "f", value: "legacy" }],
  lastSavedAt: "2026-05-01T00:00:00.000Z",
  submittedAt: "2026-05-01T00:00:00.000Z",
  answeredBy: USER,
  status: "submitted",
};
const LEGACY: AnswerLegacySeed = { contentHash: "h-legacy", items: [LEGACY_ITEM] };
const OPTS = { legacySeed: LEGACY, username: USER, monthFolderName: MONTH };

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function randomEvents(rng: Rng, count: number): AnswerEvent[] {
  const events: AnswerEvent[] = [
    { eventId: "seed", eventType: "migration-seed", eventAt: "2026-05-01T00:00:00.000Z", eventBy: USER, authority: "self", answeredBy: USER, legacyContentHash: LEGACY.contentHash },
  ];
  for (let i = 0; i < count; i += 1) {
    const eventAt = new Date(Date.UTC(2026, 4, 2, 8, 0) + Math.floor(rng() * 600) * 60_000).toISOString();
    const type = pick(rng, ["item-saved", "item-saved", "item-reopened", "quality-note-set"] as const);
    const supervisor = rng() < 0.3;
    const base = { eventId: `e${i}`, eventType: type, eventAt, eventBy: supervisor ? "sup1" : USER, authority: supervisor ? "supervisor" : "self", xrayImageId: pick(rng, ["X0", "X1", "X2", "X3"]), answeredBy: USER } as const;
    if (type === "item-saved") {
      events.push({ ...base, answers: [{ fieldId: "f", value: `v${i}` }], status: rng() < 0.5 ? "submitted" : "draft", ...(supervisor ? { answeredOnBehalfBy: "sup1", reason: "r" } : {}) });
    } else if (type === "quality-note-set") {
      events.push({ ...base, qualityNote: `n${i}` });
    } else {
      events.push({ ...base, reason: "r" });
    }
  }
  // A retried append after an ambiguous failure: same id, same content.
  if (events.length > 3) events.push({ ...events[2]! });
  return events;
}

function comparable(result: AnswerFoldResult) {
  return { items: result.file.items, markers: result.markers, seeded: result.seeded, foldedEventIds: result.foldedEventIds, eventSetId: result.eventSetId };
}

function snapshotOf(prefix: readonly AnswerEvent[]) {
  return snapshotDraftFromFold(foldAnswerEvents(prefix, OPTS), {
    assignee: USER, monthFolderName: MONTH, legacySeed: LEGACY, foldedOffsets: {}, compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: USER,
  });
}

describe("read(snapshot + live delta) == full fold (spec §5, §10)", () => {
  it("time-ordered compaction cut: always resumes and always equals the full fold (300 seeds)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = createRng(seed);
      const events = randomEvents(rng, 3 + Math.floor(rng() * 40));
      const full = foldAnswerEvents(events, OPTS);
      const ordered = sortAnswerEventsForFold([...events]);
      const cut = Math.floor(rng() * (ordered.length + 1));
      const delta = ordered.slice(cut).reverse(); // arrival order must not matter
      const merged = foldSnapshotPlusDelta(snapshotOf(ordered.slice(0, cut)), delta, OPTS);
      expect(merged.kind, `seed ${seed}`).toBe("resumed");
      if (merged.kind === "resumed") expect(comparable(merged.result), `seed ${seed}`).toEqual(comparable(full));
    }
  });

  it("random-subset cut: a late delta is reported, never silently merged (300 seeds)", () => {
    let late = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = createRng(10_000 + seed);
      const events = randomEvents(rng, 5 + Math.floor(rng() * 30));
      const full = foldAnswerEvents(events, OPTS);
      const prefix = events.filter((event) => event.eventType === "migration-seed" || rng() < 0.5);
      const prefixIds = new Set(prefix.map((event) => event.eventId));
      const delta = events.filter((event) => !prefixIds.has(event.eventId));
      const merged = foldSnapshotPlusDelta(snapshotOf(prefix), delta, OPTS);
      if (merged.kind === "late") late += 1;
      else expect(comparable(merged.result), `seed ${seed}`).toEqual(comparable(full));
    }
    expect(late).toBeGreaterThan(0);
  });

  it("no snapshot → a plain fold of the delta", () => {
    const events = randomEvents(createRng(7), 10);
    const merged = foldSnapshotPlusDelta(null, events, OPTS);
    expect(merged.kind).toBe("resumed");
    if (merged.kind === "resumed") expect(comparable(merged.result)).toEqual(comparable(foldAnswerEvents(events, OPTS)));
  });

  it("v1 offset keys never collide with a bare live segment name", () => {
    expect(v1OffsetKey("abc-ans-dev-ch.ndjson")).toBe("_archive-v1/abc-ans-dev-ch.ndjson");
  });
});
