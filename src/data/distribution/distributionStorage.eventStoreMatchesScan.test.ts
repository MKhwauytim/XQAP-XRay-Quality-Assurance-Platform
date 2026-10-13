/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { DISTRIBUTION_EVENTS_DIR, DISTRIBUTION_EVENT_SEGMENT_SUFFIX } from "./distributionEventStore";
import { eventStoreMatchesScan, legacyFilesDigest } from "./distributionStorage";

const MONTH = "5-May-2026";
const SEGMENT_NAME = `a-dist-x${DISTRIBUTION_EVENT_SEGMENT_SUFFIX}`;
const LEGACY_NAME = "legacy-1.json";
const SEGMENT_TEXT = '{"event":"one"}\n';

/**
 * Wraps a directory handle so that every enumeration of `distribution.events/`
 * (`values()` or `entries()`) is counted. Child handles are wrapped too, so the
 * count holds whichever path the caller walks to reach the events directory.
 */
function countEventsEnumerations(root: DirectoryHandleLike): { root: DirectoryHandleLike; count: () => number } {
  let enumerations = 0;

  function wrapDir(target: any, name: string | null): any {
    return new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === "getDirectoryHandle") {
          return async (childName: string, opts?: unknown) => {
            const child = await t.getDirectoryHandle(childName, opts);
            return wrapDir(child, childName);
          };
        }
        if (name === DISTRIBUTION_EVENTS_DIR && (prop === "values" || prop === "entries")) {
          return () => {
            enumerations += 1;
            return t[prop]();
          };
        }
        return Reflect.get(t, prop, receiver);
      },
    });
  }

  return { root: wrapDir(root, null), count: () => enumerations };
}

async function writeText(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await (handle as any).createWritable();
  await writable.write(text);
  await writable.close();
}

async function seedEventStore(root: DirectoryHandleLike): Promise<void> {
  const monthMain = await getSampleMainDir(root, MONTH, true);
  const eventsDir = await monthMain.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  await writeText(eventsDir, SEGMENT_NAME, SEGMENT_TEXT);
  await writeText(eventsDir, LEGACY_NAME, "{}");
}

describe("eventStoreMatchesScan enumeration", () => {
  it("lists distribution.events/ exactly once and trusts a matching identity", async () => {
    const root = createMemoryDirectory();
    await seedEventStore(root);
    const counted = countEventsEnumerations(root);

    const matches = await eventStoreMatchesScan(counted.root, MONTH, {
      segmentOffsets: { [SEGMENT_NAME]: new TextEncoder().encode(SEGMENT_TEXT).byteLength },
      legacyFilesDigest: legacyFilesDigest([LEGACY_NAME]),
    });

    expect(matches).toBe(true);
    expect(counted.count()).toBe(1);
  });
});
