/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { __resetDistributionSessionIdForTests } from "../distribution/distributionEventStore";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import { __resetAnswerSegmentChainMemoForTests, stableAnswerChainSegmentName } from "./answerSegmentChain";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";

function answer(xrayImageId: string): ItemAnswer {
  return {
    xrayImageId,
    templateId: "tpl",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    answeredBy: "emp1",
    status: "submitted",
  };
}

/** Everything a page reload forgets; localStorage survives it. */
function simulateReload(): void {
  __resetAppendOnlyEventLogMemosForTests();
  __resetAnswerSegmentChainMemoForTests();
  __resetDistributionSessionIdForTests();
  __resetAnswerEventsCacheForTests();
}

async function segmentNames(root: DirectoryHandleLike): Promise<string[]> {
  const main = await getSampleMainDir(root, MONTH, false);
  const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: false });
  return (await listDirectoryEntries(events))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".ndjson"))
    .map((entry) => entry.name);
}

beforeEach(() => {
  localStorage.clear();
  simulateReload();
});

describe("stable answer segment chain (A1)", () => {
  it("keeps appending to the same segment across page reloads", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    simulateReload();
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);

    expect(await segmentNames(root)).toHaveLength(1);
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  it("gives a different browser (device id) its own segment", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    simulateReload();
    localStorage.setItem("xray_distribution_device_id_v1", "another-browser");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);

    expect(await segmentNames(root)).toHaveLength(2);
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  it("exposes the stable chain's segment name for the sync probe (F11)", () => {
    const name = stableAnswerChainSegmentName(MONTH, "emp1");
    expect(name.endsWith(".ndjson")).toBe(true);
    expect(stableAnswerChainSegmentName(MONTH, "emp1")).toBe(name);
  });
});
