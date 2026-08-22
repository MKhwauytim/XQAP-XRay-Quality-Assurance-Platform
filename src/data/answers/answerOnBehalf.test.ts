/**
 * Supervisor answers a sample assigned to somebody else (`answer-on-behalf`).
 *
 * The invariant these tests exist to protect: the answer must stay indexable by
 * `${xrayImageId}::${assignedTo}`. Every read path — the completion count, the
 * per-row "submitted" badge, the reports' employee join — matches answers back
 * to distribution entries on that key, and `answeredBy` is the half of it the
 * answer file supplies. Move it to the supervisor and the row silently reads as
 * unanswered. So the on-behalf write keeps `answeredBy` = the assignee, keeps
 * the answer in the assignee's file, and records the real author separately.
 *
 * `isStudyCompleted` itself is a component-module export; these tests assert the
 * STORED SHAPE it reads (`answersMap.get(...)?.status === "submitted"`) rather
 * than importing a component into a node-environment test.
 */
import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  loadEmployeeAnswers,
  reopenItemAnswer,
  saveEmployeeAnswers,
  upsertItemAnswer,
  upsertItemAnswerOnBehalf,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const ASSIGNEE = "emp1";
const SUPERVISOR = "sup1";

function makeItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "سليمة" }],
    lastSavedAt: "2026-05-12T09:00:00.000Z",
    submittedAt: "2026-05-12T09:00:00.000Z",
    answeredBy: ASSIGNEE,
    status: "submitted",
    ...overrides,
  };
}

async function readItem(
  dir: ReturnType<typeof createMemoryDirectory>,
  username = ASSIGNEE,
  xrayImageId = "X1"
): Promise<ItemAnswer> {
  const file = await loadEmployeeAnswers(dir, MONTH, username);
  const item = file.items.find((i) => i.xrayImageId === xrayImageId);
  if (!item) throw new Error(`item ${xrayImageId} missing from ${username}'s file`);
  return item;
}

/** The exact map XrayReferrals builds: keyed on `${xrayImageId}::${answeredBy}`. */
function answersMapOf(items: ItemAnswer[]): Map<string, ItemAnswer> {
  return new Map(items.map((a) => [`${a.xrayImageId}::${a.answeredBy}`, a]));
}

describe("upsertItemAnswerOnBehalf — storage location and identity", () => {
  test("lands in the ASSIGNEE's file, not the author's", async () => {
    const dir = createMemoryDirectory();

    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem(),
      SUPERVISOR,
      "الموظف في إجازة"
    );
    expect(result.ok).toBe(true);

    const assigneeFile = await loadEmployeeAnswers(dir, MONTH, ASSIGNEE);
    expect(assigneeFile.items.map((i) => i.xrayImageId)).toEqual(["X1"]);

    // The supervisor's own file must not have acquired someone else's sample.
    const supervisorFile = await loadEmployeeAnswers(dir, MONTH, SUPERVISOR);
    expect(supervisorFile.items).toEqual([]);
  });

  test("keeps answeredBy = the assignee and records the author separately", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR);

    const item = await readItem(dir);
    expect(item.answeredBy).toBe(ASSIGNEE);
    expect(item.answeredOnBehalfBy).toBe(SUPERVISOR);
  });

  test("forces answeredBy back to the assignee even when the caller passes the author", async () => {
    // The most likely UI mistake: the panel hands over the ACTING user. Left
    // alone it moves the answer out from under the ${id}::${assignedTo} join.
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answeredBy: SUPERVISOR }),
      SUPERVISOR
    );

    expect((await readItem(dir)).answeredBy).toBe(ASSIGNEE);
  });

  test("the existing ${xrayImageId}::${assignedTo} lookup still resolves it as submitted", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR);

    // Answers are aggregated across every employee file, exactly as the view does.
    const all = (await loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).items;
    const map = answersMapOf(all);

    const entry = { xrayImageId: "X1", assignedTo: ASSIGNEE, status: "pending" as const };
    // isStudyCompleted's second clause, verbatim.
    expect(map.get(`${entry.xrayImageId}::${entry.assignedTo}`)?.status).toBe("submitted");
    // And nothing is filed under the supervisor's key.
    expect(map.has(`X1::${SUPERVISOR}`)).toBe(false);
  });
});

describe("upsertItemAnswerOnBehalf — history trail", () => {
  test("appends an answered-on-behalf entry naming author, assignee and time", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR, "تغطية إجازة");

    const item = await readItem(dir);
    expect(item.history).toHaveLength(1);
    const entry = item.history![0]!;
    expect(entry.action).toBe("answered-on-behalf");
    expect(entry.by).toBe(SUPERVISOR);
    expect(entry.onBehalfOf).toBe(ASSIGNEE);
    expect(entry.reason).toBe("تغطية إجازة");
    // First answer for the item — there was no prior submission to displace.
    expect(entry.previousSubmittedAt).toBeNull();
    expect(Date.parse(entry.at)).not.toBeNaN();
  });

  test("displacing an unsubmitted draft still snapshots A4 value history, attributed to the author", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem({ status: "draft", submittedAt: null }));
    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "اشتباه" }] }),
      SUPERVISOR
    );
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.history![0]!.previousSubmittedAt).toBeNull();
    // A4 still snapshots the answers the supervisor overwrote...
    expect(item.valueHistory).toHaveLength(1);
    expect(item.valueHistory![0]!.previous.answers).toEqual([{ fieldId: "f1", value: "سليمة" }]);
    // ...attributed to the person who actually made the change, not the file owner.
    expect(item.valueHistory![0]!.changedBy).toBe(SUPERVISOR);
  });

  test("two on-behalf answers append two entries, oldest first", async () => {
    const dir = createMemoryDirectory();
    // Left as a draft, so the second on-behalf write is not blocked by the
    // "unanswered only" rule.
    await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ status: "draft", submittedAt: null }),
      SUPERVISOR
    );
    await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ status: "draft", submittedAt: null }),
      "sup2"
    );

    const item = await readItem(dir);
    expect(item.history!.map((h) => h.by)).toEqual([SUPERVISOR, "sup2"]);
    expect(item.answeredOnBehalfBy).toBe("sup2");
  });

  test("the trail survives the assignee re-answering, and the attribution field clears", async () => {
    // XrayReferrals.handleSave builds a fresh ItemAnswer with no history on it,
    // so the trail is only durable because the fold takes history from the
    // STORED predecessor. If that regresses, the audit record disappears on the
    // assignee's very next save.
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR);

    await upsertItemAnswer(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "مراجعة الموظف" }] })
    );

    const item = await readItem(dir);
    // Current state: the assignee authored what is stored now.
    expect(item.answeredOnBehalfBy).toBeUndefined();
    expect(item.answeredBy).toBe(ASSIGNEE);
    // Permanent record: the supervisor's authorship is still on file.
    expect(item.history).toHaveLength(1);
    expect(item.history![0]!.action).toBe("answered-on-behalf");
    expect(item.history![0]!.by).toBe(SUPERVISOR);
  });

  test("a client cannot forge attribution through the ordinary write paths", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem({ answeredOnBehalfBy: "someone-else" }));
    expect((await readItem(dir)).answeredOnBehalfBy).toBeUndefined();

    await saveEmployeeAnswers(dir, MONTH, ASSIGNEE, [
      makeItem({ xrayImageId: "X2", answeredOnBehalfBy: "someone-else" }),
    ]);
    expect((await readItem(dir, ASSIGNEE, "X2")).answeredOnBehalfBy).toBeUndefined();
  });
});

describe("upsertItemAnswerOnBehalf — refusals and the self-answer case", () => {
  test("refuses, and writes nothing, when no author is named", async () => {
    const dir = createMemoryDirectory();

    const result = await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), "   ");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("نيابةً");

    // Nothing landed — an unattributed answer in someone else's file is exactly
    // the outcome this feature exists to prevent.
    expect((await loadEmployeeAnswers(dir, MONTH, ASSIGNEE)).items).toEqual([]);
  });

  test("author === assignee is a plain self-answer: no field, no history entry", async () => {
    const dir = createMemoryDirectory();
    const result = await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), " EMP1 ");
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.answeredBy).toBe(ASSIGNEE);
    expect(item.answeredOnBehalfBy).toBeUndefined();
    expect(item.history ?? []).toHaveLength(0);
  });

  test("an ordinary self-answer through upsertItemAnswer is unchanged", async () => {
    const dir = createMemoryDirectory();
    const result = await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.answeredBy).toBe(ASSIGNEE);
    expect(item.answeredOnBehalfBy).toBeUndefined();
    expect(item.history ?? []).toHaveLength(0);
    expect(item.valueHistory ?? []).toHaveLength(0);
    expect(item.status).toBe("submitted");
  });
});

describe("upsertItemAnswerOnBehalf — only an UNANSWERED sample may be answered on behalf", () => {
  test("succeeds when the item does not exist yet", async () => {
    const dir = createMemoryDirectory();
    const result = await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR);
    expect(result.ok).toBe(true);
    expect((await readItem(dir)).answeredOnBehalfBy).toBe(SUPERVISOR);
  });

  test("refuses when the assignee has already submitted, leaving the answer untouched", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    const before = await readItem(dir);

    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "اشتباه" }] }),
      SUPERVISOR
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("تم تقديم إجابة لهذه العينة بالفعل");

    // Byte-for-byte unchanged: answers, status, attribution and both trails.
    const after = await readItem(dir);
    expect(after).toEqual(before);
    expect(after.answeredOnBehalfBy).toBeUndefined();
    expect(after.history ?? []).toHaveLength(0);
    expect(after.valueHistory ?? []).toHaveLength(0);
  });

  test("the refusal is a typed failure, never a throw and never a silent success", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    await expect(
      upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR)
    ).resolves.toMatchObject({ ok: false });
  });

  test("succeeds again once the item is reopened — the gate is the STATUS, not existence", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    expect((await upsertItemAnswerOnBehalf(dir, MONTH, ASSIGNEE, makeItem(), SUPERVISOR)).ok).toBe(
      false
    );

    await reopenItemAnswer(dir, MONTH, ASSIGNEE, "X1", "sup2", "يرجى التصحيح");
    expect((await readItem(dir)).status).toBe("draft");

    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "مصححة" }] }),
      SUPERVISOR
    );
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.answeredOnBehalfBy).toBe(SUPERVISOR);
    expect(item.answers).toEqual([{ fieldId: "f1", value: "مصححة" }]);
    expect(item.history!.map((h) => h.action)).toEqual(["reopened", "answered-on-behalf"]);
  });

  test("the assignee may still overwrite their OWN submitted answer, valueHistory included", async () => {
    // The restriction is on-behalf-only; the ordinary path is untouched.
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());

    const result = await upsertItemAnswer(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "تصحيح ذاتي" }] })
    );
    expect(result.ok).toBe(true);

    const item = await readItem(dir);
    expect(item.answers).toEqual([{ fieldId: "f1", value: "تصحيح ذاتي" }]);
    expect(item.valueHistory).toHaveLength(1);
    expect(item.valueHistory![0]!.previous.answers).toEqual([{ fieldId: "f1", value: "سليمة" }]);
    expect(item.valueHistory![0]!.changedBy).toBe(ASSIGNEE);
  });

  test("author === assignee bypasses nothing it should not: it is the ordinary self path", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, ASSIGNEE, makeItem());
    // Routed through the on-behalf API but naming the assignee — allowed,
    // because it IS the assignee correcting their own submitted answer.
    const result = await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ answers: [{ fieldId: "f1", value: "تصحيح ذاتي" }] }),
      ASSIGNEE
    );
    expect(result.ok).toBe(true);
    expect((await readItem(dir)).answeredOnBehalfBy).toBeUndefined();
  });
});

describe("the shared oversight trail keeps reopen semantics intact", () => {
  test("reopen appends alongside an on-behalf entry without disturbing it", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswerOnBehalf(
      dir,
      MONTH,
      ASSIGNEE,
      makeItem({ submittedAt: "2026-05-12T09:00:00.000Z" }),
      SUPERVISOR
    );
    await reopenItemAnswer(dir, MONTH, ASSIGNEE, "X1", "sup2", "يرجى التصحيح");

    const item = await readItem(dir);
    expect(item.status).toBe("draft");
    expect(item.submittedAt).toBeNull();
    expect(item.history!.map((h) => h.action)).toEqual(["answered-on-behalf", "reopened"]);
    const reopened = item.history![1]!;
    expect(reopened.by).toBe("sup2");
    expect(reopened.previousSubmittedAt).toBe("2026-05-12T09:00:00.000Z");
  });
});
