import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, loadAllEmployeeFiles } from "./answerStorage";
import * as reg from "../storage/deadSegmentRegistry";
import { getRecentErrors, clearErrors } from "../storage/errorLogger";

const MONTH = "5-May-2026";
const DEAD = new Set([
  "hrdzl-ans-8ab25b91-d79301.ndjson",
  "hrf36-ans-8ab25b91-3daae1.ndjson",
  "hrgce-ans-c5d5686e-849590-1.ndjson",
  "hrgce-ans-c5d5686e-849590.ndjson",
  "hrlr2-ans-c5d5686e-e7e843.ndjson",
]);

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const h: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!(); await w.write(content); await w.close();
}
const line = (id: string, who: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: who, authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: who })}\n`;
function notFound(): Error { const e = new Error("gone"); e.name = "NotFoundError"; return e; }

function withDead(dir: DirectoryHandleLike): DirectoryHandleLike {
  const wrap = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(t, p, r) {
        if (p === "getDirectoryHandle") return async (n: string, o?: { create?: boolean }) => wrap(await t.getDirectoryHandle(n, o));
        if (p === "getFileHandle") return async (n: string, o?: { create?: boolean }) => { if (DEAD.has(n)) throw notFound(); return t.getFileHandle(n, o); };
        const en = t as DirectoryHandleLike & { values?: () => AsyncIterable<{ kind: string; name: string }> };
        if (p === "values" && typeof en.values === "function") {
          return () => (async function* () {
            for await (const e of en.values!()) {
              if (e.kind === "file" && DEAD.has(e.name)) yield { ...e, getFile: async () => { throw notFound(); } };
              else yield e;
            }
          })();
        }
        return Reflect.get(t, p, r);
      },
    });
  return wrap(dir);
}

describe("field repro", () => {
  let now = 1_000_000;
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    reg.clearDeadSegmentRegistry();
    clearErrors();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("H1: strict tolerant reads 30 s apart, cache NOT cleared, interleaved lenient reads", async () => {
    const root = createMemoryDirectory("dead") as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRaw(events, "aaa-ans-dev1-s1.ndjson", line("e1", "emp1"));
    for (const n of DEAD) await writeRaw(events, n, line(`d-${n}`, "emp2"));
    const dir = withDead(root);
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await loadAllEmployeeFiles(dir, MONTH).catch(() => undefined); // lenient (save path / views)
      const r = await loadAllEmployeeFiles(dir, MONTH, { strict: true, tolerateConfirmedDead: true }).then(
        () => "ok",
        (e: unknown) => `throw:${(e as Error).name}`
      );
      outcomes.push(r);
      now += 30_000;
    }
    console.log("OUTCOMES", outcomes.join(","));
    console.log("ERRS", getRecentErrors().map((e) => `${e.context}: ${String(e.message).slice(0, 90)}`).join("\n"));
    expect(outcomes.at(-1)).toBe("ok");
  }, 60_000);
});
