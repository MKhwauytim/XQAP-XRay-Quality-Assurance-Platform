import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearErrors } from "../storage/errorLogger";
import { upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { loadAnswerActionHistory } from "./actionHistoryReaders";

const MONTH = "5-may-2026";
const USER = "emp-1";
const IMG = "IMG-1";

function makeItem(qualityNote: string, savedAt: string): ItemAnswer {
  return {
    xrayImageId: IMG,
    answeredBy: USER,
    answers: [],
    status: "draft",
    submittedAt: null,
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: savedAt,
    qualityNote,
  };
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  clearErrors();
});

describe("answer action history derived from the event log", () => {
  it("returns nothing for an item that was never answered", async () => {
    await expect(loadAnswerActionHistory(root, MONTH, USER, IMG)).resolves.toEqual([]);
  });

  it("reports the state each save was about to overwrite, newest first", async () => {
    await upsertItemAnswer(root, MONTH, USER, makeItem("first", "2026-05-02T00:00:00.000Z"));
    await upsertItemAnswer(root, MONTH, USER, makeItem("second", "2026-05-02T01:00:00.000Z"));
    await upsertItemAnswer(root, MONTH, USER, makeItem("third", "2026-05-02T02:00:00.000Z"));

    const history = await loadAnswerActionHistory(root, MONTH, USER, IMG);

    // Three saves, three entries. The FIRST save overwrote nothing, so its
    // entry carries a null state -- exactly what the deleted writer stored as
    // `previousState` when the record did not exist yet.
    expect(history).toHaveLength(3);
    // `lastSavedAt` is what identifies a revision in the folded item
    // (`qualityNote` is not carried by the fold), so it is what distinguishes
    // "the state before save 3" from "the state before save 2".
    expect(history[0]!.state?.lastSavedAt).toBe("2026-05-02T01:00:00.000Z");
    expect(history[1]!.state?.lastSavedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(history[2]!.state).toBeNull();
    expect(history[0]!.actor).toBe(USER);
    expect(history[0]!.action).toContain("answer:");
  });

  it("keeps one item's history out of another's", async () => {
    await upsertItemAnswer(root, MONTH, USER, makeItem("mine", "2026-05-02T00:00:00.000Z"));
    await upsertItemAnswer(root, MONTH, USER, {
      ...makeItem("theirs", "2026-05-02T01:00:00.000Z"),
      xrayImageId: "IMG-2",
    });

    const history = await loadAnswerActionHistory(root, MONTH, USER, IMG);

    expect(history).toHaveLength(1);
    expect(history[0]!.state).toBeNull();
  });

  it("degrades to an empty trail rather than throwing into a caller", async () => {
    const broken = createMemoryDirectory("root", {
      faults: [{ operation: "getDirectoryHandle", times: Number.POSITIVE_INFINITY }],
    }) as unknown as DirectoryHandleLike;

    await expect(loadAnswerActionHistory(broken, MONTH, USER, IMG)).resolves.toEqual([]);
  });
});
