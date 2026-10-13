import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { appendEventSegment, SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS } from "./appendOnlyEventLog";
import { buildAnswerEventLogConfig } from "../answers/answerEventStore";
import { createDeadline } from "./operationDeadline";

type Ev = { eventId: string; eventAt: string };
const writer = { deviceId: "dev00001", sessionId: "sess0001", stable: true } as const;
const config = buildAnswerEventLogConfig(0);

/** Directory whose first `failures` close() calls throw InvalidStateError, then succeed. */
function withFlakyClose(dir: DirectoryHandleLike, failures: number): DirectoryHandleLike {
  let remaining = failures;
  const wrapDir = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(target, prop, recv) {
        if (prop === "getDirectoryHandle") {
          return async (name: string, opts?: { create?: boolean }) =>
            wrapDir(await target.getDirectoryHandle(name, opts));
        }
        if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
        return async (name: string, opts?: { create?: boolean }) => {
          const handle = await target.getFileHandle(name, opts);
          if (!handle.createWritable) return handle;
          const origCw = handle.createWritable.bind(handle);
          const wrapped: FileHandleLike = {
            ...handle,
            getFile: handle.getFile.bind(handle),
            createWritable: async () => {
              const w = await origCw();
              return {
                write: w.write.bind(w),
                close: async () => {
                  if (remaining > 0) {
                    remaining -= 1;
                    const err = new Error("stale state");
                    err.name = "InvalidStateError";
                    throw err;
                  }
                  return w.close();
                },
              };
            },
          };
          return wrapped;
        };
      },
    });
  return wrapDir(dir);
}

async function segmentNames(dir: DirectoryHandleLike): Promise<string[]> {
  const events = (await dir.getDirectoryHandle(config.eventsDirName, { create: false })) as unknown as {
    values: () => AsyncIterable<{ kind: string; name: string }>;
  };
  const names: string[] = [];
  for await (const e of events.values()) if (e.kind === "file" && e.name.endsWith(".ndjson")) names.push(e.name);
  return names.sort();
}

describe("blocked replace: retry the same segment before rotating", () => {
  it("ladder has >= 4 rungs totalling >= 4 s", () => {
    expect(SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(4);
    expect(SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4000);
  });

  it("three InvalidStateErrors at close then success → ONE segment, no rotation", async () => {
    const root = createMemoryDirectory("blocked") as unknown as DirectoryHandleLike;
    await appendEventSegment<Ev>(root, [{ eventId: "a", eventAt: "2026-10-13T00:00:00.000Z" }], writer, config, {});
    const flaky = withFlakyClose(root, 3);
    await appendEventSegment<Ev>(flaky, [{ eventId: "b", eventAt: "2026-10-13T00:00:01.000Z" }], writer, config, {
      deadline: createDeadline(30_000, "test"),
    });
    expect(await segmentNames(root)).toHaveLength(1);
  }, 20_000);
});
