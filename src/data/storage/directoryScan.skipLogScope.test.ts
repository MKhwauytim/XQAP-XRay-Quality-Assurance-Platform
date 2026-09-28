import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, getRecentErrors } from "./errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { __resetVanishedEntryLogForTests } from "./directoryScan";
import { readEventSegmentDelta, type AppendOnlyEventLogConfig } from "./appendOnlyEventLog";
import type { DirectoryHandleLike } from "./fileSystemAccess";

const CONFIG: AppendOnlyEventLogConfig = {
  consumerNamespace: "tst",
  eventsDirName: "distribution.events",
  segmentSuffix: ".ndjson",
  diagnostics: {
    writeContext: "test:append-segment",
    rereadContext: "test:segment-reread",
    verifyContext: "test:segment-verify",
    cannotWriteCode: "XQ-DIST-006",
    unverifiedCode: "XQ-DIST-007",
    sizeMismatchCode: "XQ-DIST-008",
    segmentParseError: (name) => `Cannot parse test event segment: ${name}`,
    verificationFailedError: (fileName, expected, observed) =>
      `Test segment write verification failed: ${fileName} (expected ${expected}, saw ${observed})`,
  },
};

/** A copy of a handle that was never passed to registerDirectoryPath, like a raw production getDirectoryHandle result. */
function unregistered(dir: DirectoryHandleLike): DirectoryHandleLike {
  return {
    ...dir,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      unregistered(await dir.getDirectoryHandle(name, options)),
  };
}

beforeEach(() => {
  clearErrors();
  __resetVanishedEntryLogForTests();
});

describe("segment-skip log scope", () => {
  it("keeps the once-per-session log per month folder even when handles are unregistered", async () => {
    const root = createMemoryDirectory("root");
    for (const month of ["5-may", "6-jun"]) {
      const parent = await root.getDirectoryHandle(month, { create: true });
      const events = await parent.getDirectoryHandle("distribution.events", { create: true });
      const file = await events.getFileHandle("devGone-s1.ndjson", { create: true });
      const w = await file.createWritable!();
      await w.write("x\n");
      await w.close();
      setSimulatedFaults(events, [
        { operation: "getFile", name: "devGone-s1.ndjson", errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
      ]);
      await readEventSegmentDelta(unregistered(parent), {}, CONFIG);
      await readEventSegmentDelta(unregistered(parent), {}, CONFIG); // repeat: still logged once per month
    }
    const logged = getRecentErrors().filter((e) => e.context === "directoryScan:segment-tails");
    expect(logged).toHaveLength(2);
  });
});
