/**
 * An employee's answer chain with events but no `migration-seed` marker used to
 * fail the whole read (`XQ-ANS-005`), and because the oversight queue reads every
 * assignee, one such employee blanked the admin's Referrals queue too.
 *
 * When the employee's frozen legacy snapshot is EMPTY the missing marker could
 * only ever have seeded nothing, so the baseline is provably empty and the fold
 * proceeds. When the legacy snapshot has items the baseline is genuinely
 * ambiguous (§8/§10), so the refusal stays.
 */
import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, getSampleMainDir } from "../workspace/workspacePaths";
import { appendAnswerEventSegment, type AnswerEvent } from "./answerEventStore";
import { loadAllEmployeeFiles, loadEmployeeAnswers } from "./answerStorage";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";

const MONTH = "1-january-2026";
const USER = "emp1";

function savedEvent(id: string, at: string): AnswerEvent {
  return {
    eventId: id,
    eventType: "item-saved",
    eventAt: at,
    eventBy: USER,
    authority: "self",
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v" }],
    status: "draft",
    lastSavedAt: at,
    answeredBy: USER,
  };
}

async function seedlessChain(dir: ReturnType<typeof createMemoryDirectory>): Promise<void> {
  const mainDir = await getSampleMainDir(dir, MONTH, true);
  await appendAnswerEventSegment(
    mainDir,
    [savedEvent("e1", "2026-01-05T09:00:00.000Z"), savedEvent("e2", "2026-01-05T09:05:00.000Z")],
    { deviceId: "dev", sessionId: "sess" }
  );
}

async function writeLegacy(
  dir: ReturnType<typeof createMemoryDirectory>,
  items: ItemAnswer[]
): Promise<void> {
  const employeeDir = await getSampleEmployeeDir(dir, MONTH, true);
  const file: EmployeeAnswerFile = { username: USER, monthFolderName: MONTH, revision: 1, items };
  await safeWriteJson(employeeDir, `${USER}.answers.json`, file);
}

describe("seedless answer chain", () => {
  test("no legacy file: loads the folded items instead of throwing", async () => {
    const dir = createMemoryDirectory();
    await seedlessChain(dir);
    const file = await loadEmployeeAnswers(dir, MONTH, USER);
    expect(file.items.map((i) => i.xrayImageId)).toEqual(["X1"]);
  });

  test("empty legacy file: loads the folded items instead of throwing", async () => {
    const dir = createMemoryDirectory();
    await writeLegacy(dir, []);
    await seedlessChain(dir);
    const file = await loadEmployeeAnswers(dir, MONTH, USER);
    expect(file.items).toHaveLength(1);
  });

  test("legacy file WITH items: the baseline is ambiguous, so the refusal stays", async () => {
    const dir = createMemoryDirectory();
    await writeLegacy(dir, [
      {
        xrayImageId: "OLD",
        templateId: "t1",
        templateVersion: 1,
        answers: [],
        lastSavedAt: "2025-12-01T00:00:00.000Z",
        submittedAt: null,
        answeredBy: USER,
        status: "draft",
      },
    ]);
    await seedlessChain(dir);
    await expect(loadEmployeeAnswers(dir, MONTH, USER)).rejects.toThrow(/no migration-seed marker/);
  });

  test("the month-wide scan keeps the repaired employee", async () => {
    const dir = createMemoryDirectory();
    await seedlessChain(dir);
    const files = await loadAllEmployeeFiles(dir, MONTH);
    expect(files.find((f) => f.username === USER)?.items).toHaveLength(1);
  });
});
