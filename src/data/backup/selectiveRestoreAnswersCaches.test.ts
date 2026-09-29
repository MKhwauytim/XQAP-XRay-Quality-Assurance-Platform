import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ clearCache: vi.fn(), invalidateSealed: vi.fn() }));

vi.mock("../answers/answerStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../answers/answerStorage")>();
  return {
    ...actual,
    clearAnswerEventsCache: (...args: Parameters<typeof actual.clearAnswerEventsCache>) => {
      spies.clearCache();
      return actual.clearAnswerEventsCache(...args);
    },
  };
});
vi.mock("../answers/answerSealedSegments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../answers/answerSealedSegments")>();
  return {
    ...actual,
    invalidateSealedAnswerSegments: (...args: Parameters<typeof actual.invalidateSealedAnswerSegments>) => {
      spies.invalidateSealed();
      return actual.invalidateSealedAnswerSegments(...args);
    },
  };
});

import { restoreBackupSnapshot } from "./backupStorage";
import { M1, makeRoot, ndjson, seedBackup, TEST_BACKUP } from "./selectiveRestoreTestKit";

const ANSWERS_SEGMENT = `2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`;
const SAMPLE = `2-samples/${M1}/1-main/sample.master.json`;

afterEach(() => {
  spies.clearCache.mockClear();
  spies.invalidateSealed.mockClear();
});

describe("scoped restore and the answers read caches (S3)", () => {
  it("drops the incremental answers cache and sealed-segment confirmations when answers.events were merged", async () => {
    const root = makeRoot();
    await seedBackup(root, {}, { [ANSWERS_SEGMENT]: ndjson([{ eventId: "a01", eventType: "saved" }]) });

    const result = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["answers"], months: [M1] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredFiles).toContain(ANSWERS_SEGMENT);
    expect(spies.clearCache).toHaveBeenCalled();
    expect(spies.invalidateSealed).toHaveBeenCalled();
  });

  it("leaves them alone when the scope does not reach answers.events", async () => {
    const root = makeRoot();
    await seedBackup(
      root,
      { [SAMPLE]: { rows: [] } },
      { [ANSWERS_SEGMENT]: ndjson([{ eventId: "a01", eventType: "saved" }]) }
    );

    const result = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["sampleDistribution"], months: [M1] },
    });

    expect(result.ok).toBe(true);
    expect(spies.clearCache).not.toHaveBeenCalled();
    expect(spies.invalidateSealed).not.toHaveBeenCalled();
  });
});
