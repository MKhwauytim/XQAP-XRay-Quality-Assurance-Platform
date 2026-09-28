import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { createDeadline } from "./operationDeadline";
import { retryTransientWrite } from "./transientFileErrors";
import {
  __resetAppendOnlyEventLogMemosForTests,
  appendEventSegment,
  type AppendOnlyEventLogConfig,
} from "./appendOnlyEventLog";

const CONFIG: AppendOnlyEventLogConfig = {
  consumerNamespace: "tst",
  eventsDirName: "test.events",
  segmentSuffix: ".ndjson",
  diagnostics: {
    writeContext: "test:write",
    rereadContext: "test:reread",
    verifyContext: "test:verify",
    cannotWriteCode: "XQ-ANS-001",
    unverifiedCode: "XQ-ANS-002",
    sizeMismatchCode: "XQ-ANS-003",
    segmentParseError: (name) => `bad segment ${name}`,
    verificationFailedError: (fileName, expected, observed) => `${fileName}: ${expected} != ${observed}`,
  },
};

beforeEach(() => {
  __resetAppendOnlyEventLogMemosForTests();
});

describe("retryTransientWrite with a deadline", () => {
  it("stops retrying once the operation's budget is spent", async () => {
    const started = Date.now();
    let attempts = 0;
    await expect(
      retryTransientWrite(
        async () => {
          attempts += 1;
          throw new DOMException("busy", "NotReadableError");
        },
        undefined,
        [20, 60, 150, 400, 800, 1600, 3000, 5000],
        createDeadline(100, "test")
      )
    ).rejects.toMatchObject({ name: "NotReadableError" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(attempts).toBeGreaterThan(1);
  });
});

describe("appendEventSegment with a deadline (A1)", () => {
  it("gives up within the budget instead of riding the ~11 s write ladder", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [
      { operation: "createWritable", nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);
    const started = Date.now();

    await expect(
      appendEventSegment(
        root,
        [{ id: "e1" }],
        { deviceId: "device-a", sessionId: "session-a", scopeId: "scope" },
        CONFIG,
        { deadline: createDeadline(150, "test") }
      )
    ).rejects.toMatchObject({ name: "NotReadableError" });

    expect(Date.now() - started).toBeLessThan(2_000);
  }, 20_000);

  it("without a deadline keeps today's behaviour (the append still succeeds normally)", async () => {
    const root = createMemoryDirectory("root");
    await expect(
      appendEventSegment(root, [{ id: "e1" }], { deviceId: "device-a", sessionId: "session-b" }, CONFIG)
    ).resolves.toBe("verified");
  });
});
