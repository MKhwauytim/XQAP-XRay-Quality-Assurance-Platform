/* @vitest-environment jsdom */
// The dead-segment evidence must survive what a real user does between scans:
// page reloads (module memory gone, sessionStorage kept) and manual refreshes.
// Field cause (2026-10-13): both used to reset the 5-minute evidence window, so
// a user who reloaded or refreshed more often than every 5 minutes never let the
// strict pending-answer replay past an unopenable colleague segment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import {
  DEAD_SEGMENT_MIN_AGE_MS,
  DEAD_SEGMENT_MIN_SCANS,
  DEAD_SEGMENTS_KEY_PREFIX,
  __deadSegmentScopesForTests,
  __resetDeadSegmentRegistryMemoryForTests,
  clearDeadSegmentRegistry,
  confirmedDeadNames,
  isConfirmedDead,
  recordOpenableSegment,
  recordUnopenableSegment,
  requestDeadSegmentRecheck,
} from "./deadSegmentRegistry";
import { getSampleMainDir, __clearWorkspaceDirCacheForTests, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "../answers/answerEventStore";
import { __clearAnswerEventsCacheForTests, loadAllEmployeeFiles } from "../answers/answerStorage";
import { __resetWorkspaceSyncStateForTests, runSync } from "../workspace/workspaceSync";
import { makeV2Month, savedEvent, writeAssigneeSegment } from "../answers/v2/v2TestFixtures";
import { getAssigneeArchiveDir } from "../workspace/workspacePaths";
import { readAllAssigneeEvents } from "../answers/v2/assigneeEventReader";
import { encodeEventLine } from "./appendOnlyEventLog";

class FakeStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const MONTH = "5-May-2026";
const DEAD = new Set(["hrdzl-ans-8ab25b91-d79301.ndjson", "hrgce-ans-c5d5686e-849590.ndjson"]);

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const h: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!();
  await w.write(content);
  await w.close();
}

const line = (id: string, who: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: who, authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: who })}\n`;

function notFound(): Error {
  const e = new Error("gone");
  e.name = "NotFoundError";
  return e;
}

/** Listed but never openable: the field symptom of a quarantined colleague file. */
function withDead(dir: DirectoryHandleLike, dead: ReadonlySet<string>): DirectoryHandleLike {
  const wrap = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(t, p, r) {
        if (p === "getDirectoryHandle") return async (n: string, o?: { create?: boolean }) => wrap(await t.getDirectoryHandle(n, o));
        if (p === "getFileHandle")
          return async (n: string, o?: { create?: boolean }) => {
            if (dead.has(n)) throw notFound();
            return t.getFileHandle(n, o);
          };
        const en = t as DirectoryHandleLike & { values?: () => AsyncIterable<{ kind: string; name: string }> };
        if (p === "values" && typeof en.values === "function") {
          return () =>
            (async function* () {
              for await (const e of en.values!()) {
                if (e.kind === "file" && dead.has(e.name)) yield { ...e, getFile: async () => { throw notFound(); } };
                else yield e;
              }
            })();
        }
        return Reflect.get(t, p, r);
      },
    });
  return wrap(dir);
}

/** A page reload: every module memo is gone, sessionStorage is not. */
function reload(): void {
  __resetDeadSegmentRegistryMemoryForTests();
  __clearAnswerEventsCacheForTests();
  __resetWorkspaceSyncStateForTests();
}

describe("dead-segment registry persistence (per tab, sessionStorage)", () => {
  let storage: FakeStorage;
  let now = 1_000_000;
  beforeEach(() => {
    storage = new FakeStorage();
    vi.stubGlobal("sessionStorage", storage);
    clearDeadSegmentRegistry();
    __clearAnswerEventsCacheForTests();
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    clearDeadSegmentRegistry();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("evidence survives a reload and keeps its first-failure time", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    __resetDeadSegmentRegistryMemoryForTests();
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS / 2);
    __resetDeadSegmentRegistryMemoryForTests();
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS);
    __resetDeadSegmentRegistryMemoryForTests();
    expect(isConfirmedDead("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS)).toBe(true);
    expect([...Array(storage.length).keys()].map((i) => storage.key(i))).toEqual([`${DEAD_SEGMENTS_KEY_PREFIX}k`]);
  });

  it("a segment that opens again is dropped from storage too", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    recordOpenableSegment("k", "a.ndjson");
    __resetDeadSegmentRegistryMemoryForTests();
    expect(storage.length).toBe(0);
    expect(isConfirmedDead("k", "a.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
  });

  it("works with no sessionStorage at all (node, blocked storage)", () => {
    vi.stubGlobal("sessionStorage", undefined);
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) recordUnopenableSegment("k", "a.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    expect(isConfirmedDead("k", "a.ndjson", 3 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(true);
  });

  it("garbage in storage is ignored, not thrown", () => {
    storage.setItem(`${DEAD_SEGMENTS_KEY_PREFIX}k`, "{not json");
    expect(isConfirmedDead("k", "a.ndjson", 0)).toBe(false);
    recordUnopenableSegment("k", "a.ndjson", 0);
    expect(isConfirmedDead("k", "a.ndjson", 0)).toBe(false);
  });

  it("a recheck request re-opens confirmed-dead names once without resetting their evidence", () => {
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) recordUnopenableSegment("k", "a.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    const at = 3 * DEAD_SEGMENT_MIN_AGE_MS;
    expect(confirmedDeadNames("k", at)).toEqual(new Set(["a.ndjson"]));
    requestDeadSegmentRecheck();
    expect(confirmedDeadNames("k", at)).toEqual(new Set()); // this scan re-opens it
    expect(isConfirmedDead("k", "a.ndjson", at)).toBe(true); // evidence intact
    expect(confirmedDeadNames("k", at)).toEqual(new Set(["a.ndjson"])); // and only once
  });

  it("replay eventually lands although the tab reloads AND manually refreshes every 2 minutes", async () => {
    const raw = createMemoryDirectory("dead") as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(raw, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRaw(events, "aaa-ans-dev1-s1.ndjson", line("e1", "emp1"));
    for (const n of DEAD) await writeRaw(events, n, line(`d-${n}`, "emp2"));
    const root = withDead(raw, DEAD);
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      reload();
      await runSync({ directoryHandle: root, monthFolderName: MONTH, manual: true });
      await loadAllEmployeeFiles(root, MONTH).catch(() => undefined); // a view's lenient read
      outcomes.push(
        await loadAllEmployeeFiles(root, MONTH, { strict: true, tolerateConfirmedDead: true }).then(
          () => "ok",
          (e: unknown) => (e as Error).name
        )
      );
      now += 2 * 60_000;
    }
    // Before 5 minutes of evidence the strict replay must still refuse...
    expect(outcomes[0]).not.toBe("ok");
    // ...and once the evidence spans 5 minutes it lands, reloads and refreshes notwithstanding.
    expect(outcomes.slice(4)).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("v2: each assignee folder and its archive is its own scope", async () => {
    const raw = createMemoryDirectory("v2dead") as unknown as DirectoryHandleLike;
    await makeV2Month(raw, MONTH);
    await writeAssigneeSegment(raw, "emp1", "d1.ndjson", [savedEvent("a", 1)], MONTH);
    await writeAssigneeSegment(raw, "emp2", "ok.ndjson", [savedEvent("b", 1, {}, "emp2")], MONTH);
    const archive = await getAssigneeArchiveDir(raw, MONTH, "emp2", true);
    await writeRaw(archive, "d2.ndjson", encodeEventLine(savedEvent("c", 2, {}, "emp2")));
    const root = withDead(raw, new Set(["d1.ndjson", "d2.ndjson"]));
    await loadAllEmployeeFiles(root, MONTH).catch(() => undefined);
    // The archive is read by the full refold (rebuild, compaction, restore).
    await readAllAssigneeEvents(root, MONTH, "emp2");
    const scopes = __deadSegmentScopesForTests();
    const base = `2-samples/${MONTH}/1-main/answers.events`;
    expect(scopes).toContain(`${base}/emp1`);
    expect(scopes).toContain(`${base}/emp2/archive`);
    expect(scopes).not.toContain(`${base}/emp2`);
  });
});
