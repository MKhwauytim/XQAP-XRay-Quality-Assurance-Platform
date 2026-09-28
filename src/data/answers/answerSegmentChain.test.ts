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
import {
  __resetAnswerSegmentChainMemoForTests,
  peekStableAnswerChainSegmentBase,
  stableAnswerChainSegmentBase,
  stableAnswerChainSegmentName,
} from "./answerSegmentChain";
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

  it("F11: stableAnswerChainSegmentName equals the name upsertItemAnswer actually wrote", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);

    const [writtenName] = await segmentNames(root);
    expect(writtenName).toBeDefined();
    // Computed BEFORE any write ever happened for this (month, actor) would
    // mint the same chain (same persisted creation minute), so this also
    // proves the accessor never drifts from the real writer.
    expect(stableAnswerChainSegmentName(MONTH, "emp1")).toBe(writtenName);
  });

  it("F11: stableAnswerChainSegmentBase is the writtenName's prefix, so a rotation still prefix-matches", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    const [writtenName] = await segmentNames(root);

    const base = stableAnswerChainSegmentBase(MONTH, "emp1");
    expect(writtenName).toBeDefined();
    expect(writtenName!.startsWith(base)).toBe(true);
    // The seq-0 file name is exactly the base plus the suffix (no `-N`).
    expect(writtenName).toBe(`${base}.ndjson`);
  });

  it("F11: peekStableAnswerChainSegmentBase returns undefined before any chain exists, and matches once one does", async () => {
    // Nothing has been written for (MONTH, "emp-never-saved") yet — the sync
    // probe must not mint a chain entry just by asking.
    expect(peekStableAnswerChainSegmentBase(MONTH, "emp-never-saved")).toBeUndefined();
    expect(localStorage.getItem("xray_answer_segment_chain_v1")).toBeNull();

    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    const base = stableAnswerChainSegmentBase(MONTH, "emp1");

    // Now a chain DOES exist (this page's memo still has it) — peek agrees
    // with the minting accessor without minting anything new itself.
    expect(peekStableAnswerChainSegmentBase(MONTH, "emp1")).toBe(base);

    // And it still agrees after a reload, reading the persisted value back
    // from localStorage rather than the (now-cleared) in-page memo.
    simulateReload();
    expect(peekStableAnswerChainSegmentBase(MONTH, "emp1")).toBe(base);
  });
});
