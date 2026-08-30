/**
 * Stage 3 (independent adversarial validation) of
 * `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md`.
 *
 * Every prior test file exercises Stage 0 (generic mechanics), Stage 1 (pure
 * fold logic) or Stage 2 (individual write functions against individually
 * crafted event fixtures) in isolation. None of them drives the FULLY WIRED
 * system through a realistic multi-actor workflow and checks that the folded
 * state a human would read back is exactly right at every step — which is the
 * only way to catch a bug that only exists in the interaction between the
 * write path (`performAnswerWrite`/`performOnBehalfWrite`), the in-memory
 * per-tab event cache, and the read path (`loadEmployeeAnswers`).
 *
 * Scenario: employee saves a draft, submits it, a supervisor reopens it for
 * correction, the employee corrects and resubmits, the supervisor leaves a
 * quality note, and the employee saves once more (an ordinary re-save on an
 * already-submitted, noted item). Every step re-reads through
 * `loadEmployeeAnswers` — the same function every real UI call site uses —
 * and a final assertion clears the in-memory cache first, so that read is a
 * genuinely cold fold from disk, standing in for a different machine/tab
 * opening the workspace for the first time.
 */
import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  loadEmployeeAnswers,
  reopenItemAnswer,
  setItemQualityNote,
  upsertItemAnswer,
  __resetAnswerEventsCacheForTests,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const EMPLOYEE = "emp1";
const SUPERVISOR = "sup1";
const IMAGE_ID = "XR-workflow-1";

function draftItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  const now = new Date().toISOString();
  return {
    xrayImageId: IMAGE_ID,
    templateId: "tpl-1",
    templateVersion: 3,
    answers: [{ fieldId: "finding", value: "normal" }],
    lastSavedAt: now,
    submittedAt: null,
    answeredBy: EMPLOYEE,
    status: "draft",
    ...overrides,
  };
}

function submittedItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  const now = new Date().toISOString();
  return draftItem({ submittedAt: now, status: "submitted", ...overrides });
}

describe("full answer workflow, wired end to end (save -> reopen -> correct -> note -> save)", () => {
  test("folded state matches a human's expectation at every step, cold-read included", async () => {
    const dir = createMemoryDirectory();

    // 1. Employee saves a draft, then submits.
    const draftResult = await upsertItemAnswer(dir, MONTH, EMPLOYEE, draftItem());
    expect(draftResult.ok).toBe(true);

    const submitResult = await upsertItemAnswer(
      dir,
      MONTH,
      EMPLOYEE,
      submittedItem({ answers: [{ fieldId: "finding", value: "abnormal-mass" }] })
    );
    expect(submitResult.ok).toBe(true);

    let file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    let item = file.items.find((i) => i.xrayImageId === IMAGE_ID);
    expect(item?.status).toBe("submitted");
    expect(item?.answers).toEqual([{ fieldId: "finding", value: "abnormal-mass" }]);
    expect(item?.history ?? []).toEqual([]);

    // 2. Supervisor reopens it for correction.
    const reopenResult = await reopenItemAnswer(
      dir,
      MONTH,
      EMPLOYEE,
      IMAGE_ID,
      SUPERVISOR,
      "قياس غير دقيق، يرجى المراجعة"
    );
    expect(reopenResult.ok).toBe(true);

    file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    item = file.items.find((i) => i.xrayImageId === IMAGE_ID);
    expect(item?.status).toBe("draft");
    expect(item?.submittedAt).toBeNull();
    expect(item?.history).toHaveLength(1);
    expect(item?.history?.[0]?.action).toBe("reopened");
    expect(item?.history?.[0]?.by).toBe(SUPERVISOR);
    // Correction is possible ONLY because the reopen flipped status back to
    // draft — this is the exact workflow round 3 found the earlier
    // authority-as-primary-key design would have broken.
    expect(item?.answers).toEqual([{ fieldId: "finding", value: "abnormal-mass" }]);

    // 3. Employee corrects and resubmits. The write's `previous` must be
    // freshly folded (post-reopen) state, not a stale pre-reopen snapshot —
    // this is the exact "does the employee's tab see the reopen before its
    // next save" question the review was asked to check.
    const correctionResult = await upsertItemAnswer(
      dir,
      MONTH,
      EMPLOYEE,
      submittedItem({ answers: [{ fieldId: "finding", value: "abnormal-mass-corrected" }] })
    );
    expect(correctionResult.ok).toBe(true);

    file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    item = file.items.find((i) => i.xrayImageId === IMAGE_ID);
    expect(item?.status).toBe("submitted");
    expect(item?.answers).toEqual([{ fieldId: "finding", value: "abnormal-mass-corrected" }]);
    // The reopen history entry is a STORED entry (`withStoredHistory`) that an
    // ordinary self-save must never erase, plus one new value-history entry
    // recording the correction as `reopen-correction` (`changeReason`).
    expect(item?.history).toHaveLength(1);
    expect(item?.history?.[0]?.action).toBe("reopened");
    expect(item?.valueHistory?.at(-1)?.reason).toBe("reopen-correction");

    // 4. Supervisor leaves a coaching note on the (now submitted) item.
    const noteResult = await setItemQualityNote(dir, MONTH, EMPLOYEE, IMAGE_ID, "دقة جيدة بعد التصحيح");
    expect(noteResult.ok).toBe(true);

    file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    item = file.items.find((i) => i.xrayImageId === IMAGE_ID);
    expect(item?.qualityNote).toBe("دقة جيدة بعد التصحيح");
    expect(item?.status).toBe("submitted");
    expect(item?.answers).toEqual([{ fieldId: "finding", value: "abnormal-mass-corrected" }]);

    // 5. Employee saves once more (e.g. a redundant re-submit of the same
    // panel). Faithful to today's pre-existing behaviour: an ordinary
    // self-save clears a supervisor's coaching note (see
    // `itemFromSavedEvent`'s doc comment — reproduced deliberately, not a
    // regression introduced by this rewrite).
    const resaveResult = await upsertItemAnswer(
      dir,
      MONTH,
      EMPLOYEE,
      submittedItem({ answers: [{ fieldId: "finding", value: "abnormal-mass-corrected" }] })
    );
    expect(resaveResult.ok).toBe(true);

    // Cold read: drop the in-memory per-tab cache first, standing in for a
    // different machine/tab opening the workspace for the first time and
    // folding `answers.events/` from scratch. Must match the warm read
    // exactly — the fold is a pure function of the event bytes on disk.
    __resetAnswerEventsCacheForTests();
    file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    item = file.items.find((i) => i.xrayImageId === IMAGE_ID);
    expect(item?.status).toBe("submitted");
    expect(item?.answers).toEqual([{ fieldId: "finding", value: "abnormal-mass-corrected" }]);
    expect(item?.qualityNote).toBeUndefined();
    expect(item?.history).toHaveLength(1);
    expect(item?.history?.[0]?.action).toBe("reopened");
    // Exactly one item on the file, in a stable identity — no duplication
    // from the five writes that touched this one xrayImageId.
    expect(file.items.filter((i) => i.xrayImageId === IMAGE_ID)).toHaveLength(1);
  });
});
