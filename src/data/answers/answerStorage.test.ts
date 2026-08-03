import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { loadEmployeeAnswers, loadAllEmployeeFiles, saveEmployeeAnswers, setItemQualityNote, upsertItemAnswer } from "./answerStorage";
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

// P2-2: setItemQualityNote is a fully separate write path from the
// referral/replacement/reopen reviewNotes/DecisionEvent trail (src/data/approvals,
// src/data/referral) — these tests only exercise src/data/answers.
describe("setItemQualityNote (P2-2)", () => {
  test("writes a note onto an existing item and read-back returns it via loadEmployeeAnswers", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem());

    const result = await setItemQualityNote(dir, MONTH, USER, "X1", "يرجى مراجعة زاوية التصوير في المرة القادمة.");
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.qualityNote).toBe("يرجى مراجعة زاوية التصوير في المرة القادمة.");
    // The answers/status this note is attached to must be untouched.
    expect(item.answers).toEqual([{ fieldId: "f1", value: "v0" }]);
    expect(item.status).toBe("draft");
  });

  test("trims whitespace and overwrites a previous note", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem());
    await setItemQualityNote(dir, MONTH, USER, "X1", "  ملاحظة أولى  ");
    let item = await readItem(dir);
    expect(item.qualityNote).toBe("ملاحظة أولى");

    await setItemQualityNote(dir, MONTH, USER, "X1", "ملاحظة محدّثة");
    item = await readItem(dir);
    expect(item.qualityNote).toBe("ملاحظة محدّثة");
  });

  test("an empty/whitespace-only note clears the field", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem());
    await setItemQualityNote(dir, MONTH, USER, "X1", "ملاحظة سيتم مسحها");
    let item = await readItem(dir);
    expect(item.qualityNote).toBe("ملاحظة سيتم مسحها");

    await setItemQualityNote(dir, MONTH, USER, "X1", "   ");
    item = await readItem(dir);
    expect(item.qualityNote).toBeUndefined();
  });

  test("is an idempotent no-op when the item does not exist yet", async () => {
    const dir = createMemoryDirectory();
    const result = await setItemQualityNote(dir, MONTH, USER, "MISSING", "ملاحظة");
    expect(result.ok).toBe(true);

    const file = await loadEmployeeAnswers(dir, MONTH, USER);
    expect(file.items).toHaveLength(0);
  });

  test("never writes referralRequests/replacementRequests/reopenRequests on the file", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem());
    await setItemQualityNote(dir, MONTH, USER, "X1", "ملاحظة جودة مستقلة");

    const file = await loadEmployeeAnswers(dir, MONTH, USER);
    expect(file.referralRequests ?? []).toHaveLength(0);
    expect(file.replacementRequests ?? []).toHaveLength(0);
    expect(file.reopenRequests ?? []).toHaveLength(0);
  });
});

describe("loadAllEmployeeFiles — concurrency-safe (Task 5)", () => {
  test("reads all employee answer files under load, in parallel", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    for (let i = 0; i < 15; i++) {
      await saveEmployeeAnswers(root, month, `employee${i}`, []);
    }
    const files = await loadAllEmployeeFiles(root, month);
    expect(files).toHaveLength(15);
    expect(files.map((f) => f.username).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `employee${i}`).sort()
    );
  });

  test("skips a corrupt employee file instead of throwing", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    await saveEmployeeAnswers(root, month, "goodemployee", []);
    const dir = await root.getDirectoryHandle("2-samples", { create: true })
      .then((d) => d.getDirectoryHandle(month, { create: true }))
      .then((d) => d.getDirectoryHandle("1-main", { create: true }))
      .then((d) => d.getDirectoryHandle("employee-answers", { create: true }));
    const handle = await dir.getFileHandle("bademployee.answers.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    const files = await loadAllEmployeeFiles(root, month);
    expect(files.map((f) => f.username)).toEqual(["goodemployee"]);
  });
});
