import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __clearWorkspaceDirCacheForTests, getAssigneeAnswerEventsDir, getAssigneeArchiveDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { foldAnswerEvents, type AnswerEvent } from "../answerEventStore";
import { snapshotDraftFromFold } from "../v2/answerSnapshot";
import { writeAnswerSnapshotCas } from "../v2/answerSnapshotStore";
import { readAssigneeState } from "../v2/assigneeEventReader";
import { appendToSegment, fileNames, makeV2Month, savedEvent, seedEvent, writeAssigneeSegment, V2_MONTH } from "../v2/v2TestFixtures";
import { __resetCompactionRateLimitForTests, compactAssignee, foldablePrefix, maybeScheduleCompaction, selectCompactionCandidates } from "./compactAssignee";

const LEGACY = { contentHash: "", items: [] };
const loadLegacySeed = async () => LEGACY;
const LATER = Date.UTC(2026, 4, 3, 0, 0); // a day after every fixture event
/** Segment mtimes come from the memory double's wall clock, so a "quiet" run must be later than now. */
const RUN_MS = Date.now() + 11 * 60_000;
const A = "abcde-ans-deva0000-sesa00";
const B = "abcde-ans-devb0000-sesb00";

/** Writer A: sealed seq 0..2 + head seq 3; writer B: head seq 0. Every event is old. */
async function fixture(name: string): Promise<{ root: DirectoryHandleLike; all: AnswerEvent[] }> {
  const root = createMemoryDirectory(name);
  await makeV2Month(root);
  const all: AnswerEvent[] = [seedEvent()];
  await writeAssigneeSegment(root, "emp1", `${A}.ndjson`, [seedEvent(), savedEvent("a0", 1)]);
  all.push(savedEvent("a0", 1));
  for (let seq = 1; seq <= 3; seq += 1) {
    const event = savedEvent(`a${seq}`, seq * 10);
    await writeAssigneeSegment(root, "emp1", `${A}-${seq}.ndjson`, [event]);
    all.push(event);
  }
  const b0 = savedEvent("b0", 50, { authority: "supervisor", eventBy: "sup1", answeredOnBehalfBy: "sup1", reason: "r" });
  await writeAssigneeSegment(root, "emp1", `${B}.ndjson`, [b0]);
  all.push(b0);
  return { root, all };
}

async function state(root: DirectoryHandleLike) {
  __clearWorkspaceDirCacheForTests();
  return readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
}
const fullFold = (events: AnswerEvent[]) => foldAnswerEvents(events, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }).file.items;

describe("pure helpers", () => {
  it("foldablePrefix stops at the first recent or torn line", () => {
    const old = JSON.stringify(savedEvent("o", 1));
    const fresh = JSON.stringify(savedEvent("f", 10_000));
    const { events, prefixBytes } = foldablePrefix(`${old}\n${fresh}\n${old}`, LATER);
    expect(events.map((e) => e.eventId)).toEqual(["o"]);
    expect(prefixBytes).toBe(new TextEncoder().encode(`${old}\n`).length);
  });

  it("foldablePrefix stops at an unparseable line instead of throwing (one corrupt line must not block compaction forever)", () => {
    const old = JSON.stringify(savedEvent("o", 1));
    const { events, prefixBytes } = foldablePrefix(`${old}
{not json
${old}
`, LATER);
    expect(events.map((e) => e.eventId)).toEqual(["o"]);
    expect(prefixBytes).toBe(new TextEncoder().encode(`${old}
`).length);
  });

  it("never selects a writer's head", () => {
    const listing = [`${A}.ndjson`, `${A}-1.ndjson`, `${A}-2.ndjson`, `${B}.ndjson`].map((name) => ({ name, size: 10, lastModified: 0 }));
    const offsets = Object.fromEntries(listing.map((e) => [e.name, 10]));
    expect(selectCompactionCandidates(listing, offsets, 1).map((e) => e.name)).toEqual([`${A}.ndjson`, `${A}-1.ndjson`]);
  });
});

describe("compactAssignee (spec §7)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __resetCompactionRateLimitForTests();
  });

  it("archives sealed segments, never a head, and the read still equals the full fold", async () => {
    const { root, all } = await fixture("c1");
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: RUN_MS });
    expect(outcome).toMatchObject({ status: "compacted", revision: 1 });
    if (outcome.status === "compacted") expect(outcome.archived.sort()).toEqual([`${A}-1.ndjson`, `${A}-2.ndjson`, `${A}.ndjson`]);
    expect(await fileNames(await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1"))).toEqual([`${A}-3.ndjson`, `${B}.ndjson`]);
    expect((await fileNames(await getAssigneeArchiveDir(root, V2_MONTH, "emp1"))).length).toBe(3);
    const read = await state(root);
    expect(read.rebuilt).toBe(false);
    expect(read.result.file.items).toEqual(fullFold(all));
  });

  it("a lost CAS aborts cleanly: nothing moved", async () => {
    const { root } = await fixture("c2");
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", {
      actor: "emp1", loadLegacySeed, nowMs: RUN_MS,
      onPhase: async (phase) => {
        if (phase !== "folded") return;
        const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
        await writeAnswerSnapshotCas(dir, 0, snapshotDraftFromFold(foldAnswerEvents([seedEvent()], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }), { assignee: "emp1", monthFolderName: V2_MONTH, legacySeed: LEGACY, foldedOffsets: {}, compactedAt: "x", compactedBy: "other-tab" }), "test");
      },
    });
    expect(outcome).toEqual({ status: "conflict" });
    expect((await fileNames(await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1"))).length).toBe(5);
  });

  it("a move the share refuses leaves the segment live and the read correct", async () => {
    const { root, all } = await fixture("c3");
    setSimulatedFaults(root, [{ operation: "removeEntry", name: `${A}.ndjson`, errorName: "NoModificationAllowedError", times: 10_000 }]);
    const outcome = await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: RUN_MS });
    if (outcome.status !== "compacted") throw new Error(outcome.status);
    expect(outcome.keptLive).toEqual([`${A}.ndjson`]);
    expect((await state(root)).result.file.items).toEqual(fullFold(all));
  }, 60_000);

  for (const phase of ["folded", "committed", "moved"] as const) {
    it(`invariant: an append landing at "${phase}" is never lost`, async () => {
      const { root, all } = await fixture(`inv-${phase}`);
      const nowMs = RUN_MS;
      const outcome = await compactAssignee(root, V2_MONTH, "emp1", {
        actor: "emp1", loadLegacySeed, nowMs,
        onPhase: async (at) => {
          if (at !== phase) return;
          const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
          const toB = savedEvent("b-late", 24 * 60 + 5); // on writer B's head
          const toA = savedEvent("a-new", 24 * 60 + 6); // writer A rotates to a new head
          await appendToSegment(dir, `${B}.ndjson`, [toB]);
          await writeAssigneeSegment(root, "emp1", `${A}-4.ndjson`, [toA]);
          all.push(toB, toA);
        },
      });
      expect(outcome.status).toBe("compacted");
      expect((await state(root)).result.file.items).toEqual(fullFold(all));
    });
  }

  it("events inside the quiet window are not folded", async () => {
    const { root } = await fixture("quiet");
    const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1");
    const fresh = savedEvent("fresh", 24 * 60); // == LATER
    await appendToSegment(dir, `${B}.ndjson`, [fresh]);
    await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: LATER + 5 * 60_000 });
    const read = await state(root);
    expect(read.snapshot?.foldedEventIds).not.toContain("fresh");
    expect(read.deltaEvents.map((e) => e.eventId)).toEqual(["fresh"]);
  });

  it("scheduling: owner only, at most once per hour per (month, assignee)", async () => {
    const { root } = await fixture("rate");
    const read = { snapshot: null, liveSegmentNames: Array.from({ length: 21 }, (_, i) => `s${i}`), rebuilt: false };
    const session = () => ({ role: "employee" as const, username: "emp1", loginAt: "x" });
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 11 * 60_000, session: () => ({ ...session(), username: "sup1" }) })).toBeNull();
    const first = maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 11 * 60_000, session });
    expect(first).not.toBeNull();
    await first;
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 30 * 60_000, session })).toBeNull();
    expect(maybeScheduleCompaction(root, V2_MONTH, "emp1", read, { loadLegacySeed, nowMs: LATER + 72 * 60_000, session })).not.toBeNull();
  });
});
