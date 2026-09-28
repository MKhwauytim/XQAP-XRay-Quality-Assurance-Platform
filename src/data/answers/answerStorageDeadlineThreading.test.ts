// R6 (fix round 1): a direct, FAST wiring pin for
// `performAnswerWrite`/`performOnBehalfWrite` threading `{ deadline }` into
// `appendAnswerEventSegment` (answerStorage.ts's two call sites). Nothing
// else in the suite would fail if that fifth argument were dropped — every
// existing behavioural test still passes with an unbounded inner ladder,
// since the fault scenarios they use resolve well within any deadline. This
// mocks `appendAnswerEventSegment` (delegating to the real implementation)
// purely to CAPTURE its call arguments and assert the deadline object is
// really there — removing `{ deadline }` from either call site makes this
// fail immediately, with no real or fake time needed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import * as answerEventStore from "./answerEventStore";
import { upsertItemAnswer, upsertItemAnswerOnBehalf } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

vi.mock("./answerEventStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerEventStore")>();
  return {
    ...actual,
    appendAnswerEventSegment: vi.fn(actual.appendAnswerEventSegment),
  };
});
const appendMock = vi.mocked(answerEventStore.appendAnswerEventSegment);

const MONTH = "5-may-2026";

function makeItem(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    answeredBy: "emp-1",
    answers: [{ fieldId: "f1", value: `v-${id}` }],
    status: "submitted",
    submittedAt: "2026-05-02T00:00:00.000Z",
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: "2026-05-02T00:00:00.000Z",
  };
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  appendMock.mockClear();
});

describe("R6: answerStorage.ts threads a real OperationDeadline into appendAnswerEventSegment", () => {
  it("performAnswerWrite (upsertItemAnswer) — line ~877", async () => {
    const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem("IMG-1"));
    expect(result).toMatchObject({ ok: true });

    expect(appendMock).toHaveBeenCalledTimes(1);
    const [, , , , options] = appendMock.mock.calls[0]!;
    // Removing `{ deadline }` from the call site makes `options` either
    // absent or `{}` — either way `options?.deadline` is `undefined` here.
    expect(options?.deadline).toBeDefined();
    expect(typeof options!.deadline!.at).toBe("number");
    expect(options!.deadline!.label).toBe("answers:interactive-write");
  });

  it("performOnBehalfWrite (upsertItemAnswerOnBehalf) — line ~1231", async () => {
    const result = await upsertItemAnswerOnBehalf(
      root,
      MONTH,
      "emp-1",
      makeItem("IMG-2"),
      "supervisor-1",
      "correction"
    );
    expect(result).toMatchObject({ ok: true });

    expect(appendMock).toHaveBeenCalledTimes(1);
    const [, , , , options] = appendMock.mock.calls[0]!;
    expect(options?.deadline).toBeDefined();
    expect(typeof options!.deadline!.at).toBe("number");
    expect(options!.deadline!.label).toBe("answers:interactive-write");
  });
});
