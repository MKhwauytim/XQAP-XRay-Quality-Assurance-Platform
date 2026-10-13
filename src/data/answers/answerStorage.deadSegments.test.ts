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

  it("throws until the segment is confirmed dead, then reads everything else", async () => {
    const root = createMemoryDirectory("dead") as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRaw(events, "aaa-ans-dev1-s1.ndjson", line("e1", "emp1"));
    await writeRaw(events, DEAD, line("e2", "emp2"));
    const dir = withDeadFile(root);

    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) {
      __clearAnswerEventsCacheForTests();
      const err = await loadAllEmployeeFiles(dir, MONTH, { strict: true }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as { cause?: unknown }).cause).toBeInstanceOf(EventSegmentUnreadableError);
      expect(((err as { cause?: Error }).cause as EventSegmentUnreadableError).segmentNames).toEqual([DEAD]);
      now += Math.ceil(DEAD_SEGMENT_MIN_AGE_MS / (DEAD_SEGMENT_MIN_SCANS - 1));
    }
    __clearAnswerEventsCacheForTests();
    const files = await loadAllEmployeeFiles(dir, MONTH, { strict: true });
    expect(files.map((f) => f.username)).toEqual(["emp1"]);
  }, 30_000);
});
