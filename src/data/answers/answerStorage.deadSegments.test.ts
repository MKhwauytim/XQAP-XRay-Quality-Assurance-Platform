import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, loadAllEmployeeFiles } from "./answerStorage";
import { EventSegmentUnreadableError } from "../storage/appendOnlyEventLog";
import { DEAD_SEGMENT_MIN_AGE_MS, DEAD_SEGMENT_MIN_SCANS, clearDeadSegmentRegistry } from "../storage/deadSegmentRegistry";

const MONTH = "5-May-2026";
const DEAD = "zzz-ans-dev2-s1.ndjson";

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const h: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!(); await w.write(content); await w.close();
}
const line = (id: string, who: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: who, authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: who })}\n`;

function notFound(): Error { const e = new Error("gone"); e.name = "NotFoundError"; return e; }

/** `DEAD` stays in listings but every open of it throws NotFoundError. */
function withDeadFile(dir: DirectoryHandleLike): DirectoryHandleLike {
  const wrap = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(t, p, r) {
        if (p === "getDirectoryHandle") return async (n: string, o?: { create?: boolean }) => wrap(await t.getDirectoryHandle(n, o));
        if (p === "getFileHandle") return async (n: string, o?: { create?: boolean }) => { if (n === DEAD) throw notFound(); return t.getFileHandle(n, o); };
        const enumerable = t as DirectoryHandleLike & {
          values?: () => AsyncIterable<{ kind: string; name: string }>;
        };
        if (p === "values" && typeof enumerable.values === "function") {
          return () => (async function* () {
            for await (const e of enumerable.values!()) {
              if (e.kind === "file" && e.name === DEAD) yield { ...e, getFile: async () => { throw notFound(); } };
              else yield e;
            }
          })();
        }
        return Reflect.get(t, p, r);
      },
    });
  return wrap(dir);
}

describe("strict reads vs a persistently unopenable colleague segment", () => {
  let now = 1_000_000;
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    clearDeadSegmentRegistry();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  async function setup(): Promise<DirectoryHandleLike> {
    const root = createMemoryDirectory("dead") as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRaw(events, "aaa-ans-dev1-s1.ndjson", line("e1", "emp1"));
    await writeRaw(events, DEAD, line("e2", "emp2"));
    return withDeadFile(root);
  }

  function expectDeadThrow(err: unknown): void {
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(EventSegmentUnreadableError);
    expect(((err as { cause?: Error }).cause as EventSegmentUnreadableError).segmentNames).toEqual([DEAD]);
  }

  /** Drive DEAD through the registry's scan/age thresholds; every strict read throws meanwhile. */
  async function confirmDead(dir: DirectoryHandleLike, options: { strict: true; tolerateConfirmedDead?: boolean }): Promise<void> {
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) {
      __clearAnswerEventsCacheForTests();
      expectDeadThrow(await loadAllEmployeeFiles(dir, MONTH, options).catch((e: unknown) => e));
      now += Math.ceil(DEAD_SEGMENT_MIN_AGE_MS / (DEAD_SEGMENT_MIN_SCANS - 1));
    }
    __clearAnswerEventsCacheForTests();
  }

  it("with tolerateConfirmedDead (the replay's opt-in): throws until confirmed dead, then reads everything else", async () => {
    const dir = await setup();
    await confirmDead(dir, { strict: true, tolerateConfirmedDead: true });
    const files = await loadAllEmployeeFiles(dir, MONTH, { strict: true, tolerateConfirmedDead: true });
    expect(files.map((f) => f.username)).toEqual(["emp1"]);
  }, 30_000);

  it("strict WITHOUT the flag still throws after the name is confirmed dead", async () => {
    const dir = await setup();
    await confirmDead(dir, { strict: true, tolerateConfirmedDead: true });
    // Confirmed dead now (the tolerant read succeeds) — a guard-style strict read must still refuse.
    expect((await loadAllEmployeeFiles(dir, MONTH, { strict: true, tolerateConfirmedDead: true })).length).toBe(1);
    __clearAnswerEventsCacheForTests();
    expectDeadThrow(await loadAllEmployeeFiles(dir, MONTH, { strict: true }).catch((e: unknown) => e));
  }, 30_000);

  it("the guards' call shape — loadAllEmployeeFiles(dir, month, { strict: true }) — throws on a confirmed-dead segment", async () => {
    const dir = await setup();
    await confirmDead(dir, { strict: true });
    // Well past both thresholds: the registry has confirmed DEAD, and the strict read still refuses.
    now += DEAD_SEGMENT_MIN_AGE_MS;
    for (let i = 0; i < 2; i += 1) {
      __clearAnswerEventsCacheForTests();
      expectDeadThrow(await loadAllEmployeeFiles(dir, MONTH, { strict: true }).catch((e: unknown) => e));
    }
    // Proof the name IS confirmed dead: the replay's opt-in read gets past it.
    __clearAnswerEventsCacheForTests();
    expect((await loadAllEmployeeFiles(dir, MONTH, { strict: true, tolerateConfirmedDead: true })).length).toBe(1);
    // The non-strict path is unchanged: the dead name is skipped, the rest reads.
    __clearAnswerEventsCacheForTests();
    const lenient = await loadAllEmployeeFiles(dir, MONTH);
    expect(lenient.map((f) => f.username)).toEqual(["emp1"]);
  }, 30_000);
});
