import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  loadEmployeeAnswers,
  reopenItemAnswer,
  upsertItemAnswer,
  VALUE_HISTORY_CAP,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const USER = "emp1";

function makeItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v0" }],
    lastSavedAt: new Date().toISOString(),
    submittedAt: null,
    answeredBy: USER,
    status: "draft",
    ...overrides,
  };
}

async function readItem(dir: ReturnType<typeof createMemoryDirectory>): Promise<ItemAnswer> {
  const file = await loadEmployeeAnswers(dir, MONTH, USER);
  const item = file.items.find((i) => i.xrayImageId === "X1");
  if (!item) throw new Error("item missing");
  return item;
}

describe("answer value history (A4)", () => {
  test("first insert records no history; an overwrite snapshots the prior value", async () => {
    const dir = createMemoryDirectory();

    await upsertItemAnswer(dir, MONTH, USER, makeItem({ answers: [{ fieldId: "f1", value: "v0" }] }));
    let item = await readItem(dir);
    expect(item.valueHistory ?? []).toHaveLength(0);

    await upsertItemAnswer(dir, MONTH, USER, makeItem({ answers: [{ fieldId: "f1", value: "v1" }] }));
    item = await readItem(dir);
    expect(item.valueHistory).toHaveLength(1);
    expect(item.valueHistory![0]!.reason).toBe("save");
    expect(item.valueHistory![0]!.previous.answers).toEqual([{ fieldId: "f1", value: "v0" }]);
    // current value is the new one
    expect(item.answers).toEqual([{ fieldId: "f1", value: "v1" }]);
  });

  test("a save onto a reopened draft is recorded as reopen-correction", async () => {
    const dir = createMemoryDirectory();
    // submit an item
    await upsertItemAnswer(
      dir,
      MONTH,
      USER,
      makeItem({ status: "submitted", submittedAt: "2026-05-10T10:00:00.000Z" })
    );
    // reopen it (adds reopen-history, flips to draft)
    await reopenItemAnswer(dir, MONTH, USER, "X1", "sup1", "please fix");
    // correct it
    await upsertItemAnswer(dir, MONTH, USER, makeItem({ answers: [{ fieldId: "f1", value: "corrected" }] }));

    const item = await readItem(dir);
    expect(item.valueHistory).toHaveLength(1);
    expect(item.valueHistory![0]!.reason).toBe("reopen-correction");
  });

  test("history is capped and the first/original entry is always kept", async () => {
    const dir = createMemoryDirectory();
    // insert
    await upsertItemAnswer(dir, MONTH, USER, makeItem({ answers: [{ fieldId: "f1", value: "orig" }] }));
    // perform many overwriting saves (well past the cap)
    const total = VALUE_HISTORY_CAP + 5;
    for (let i = 1; i <= total; i += 1) {
      await upsertItemAnswer(dir, MONTH, USER, makeItem({ answers: [{ fieldId: "f1", value: `v${i}` }] }));
    }

    const item = await readItem(dir);
    expect(item.valueHistory).toHaveLength(VALUE_HISTORY_CAP);
    // first recorded snapshot is the original insert value ("orig")
    expect(item.valueHistory![0]!.previous.answers).toEqual([{ fieldId: "f1", value: "orig" }]);
    // last snapshot is the value just before the final save
    const last = item.valueHistory![item.valueHistory!.length - 1]!;
    expect(last.previous.answers).toEqual([{ fieldId: "f1", value: `v${total - 1}` }]);
  });
});
