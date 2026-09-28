// E1b — the production root cause and its answer-level twin, R1, from
// `.superpowers/sdd/errorlog-2026-09-28/answer-save-invalidstate.md`:
//
// `writable.close()` in `appendEventSegment` (shared by answers and
// distribution) fails with InvalidStateError because the share refuses to
// replace ONE segment file. Every retry ladder and every casLoop attempt used
// to retarget that SAME name, so a save made ~27 identical failed closes over
// ~34 s, and every LATER save in the page session failed the same way too —
// "employees press submit and nothing happens".
//
// The mechanics (short ladder, then rotation to a fresh segment) are pinned
// generically in `../storage/appendOnlyEventLog.test.ts` and for distribution
// in `../distribution/distributionEventSegmentRotation.test.ts`; this is the
// answer-level twin the task brief calls out by name: two `upsertItemAnswer`s
// under a replace-blocked seq 0 are both `ok: true` and both items load.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearErrors } from "../storage/errorLogger";
import { getDistributionDeviceId, getDistributionSessionId } from "../distribution/distributionEventStore";
import { answerSegmentFileName } from "./answerEventStore";
import { loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const USER = "emp-1";

function makeItem(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    answeredBy: USER,
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
  clearErrors();
});

describe("R1 (E1b): a persistently replace-blocked answer segment rotates instead of failing every save", () => {
  it("lands the first save via a rotated segment, and a second save in the same session succeeds too", async () => {
    // close() on THIS session's seq-0 segment is persistently refused — the
    // reproduced production condition, standing in for another client holding
    // the writer's own segment open without FILE_SHARE_DELETE. Scoped to the
    // exact seq-0 name (not every ".ndjson") so the ROTATED target is free to
    // land normally, matching the real share condition, which blocks one
    // file, not every file this writer could ever produce.
    const seq0 = answerSegmentFileName({
      deviceId: getDistributionDeviceId(),
      sessionId: getDistributionSessionId(),
    });
    setSimulatedFaults(root, [
      {
        operation: "close",
        name: seq0,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const first = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-1"));
    expect(first).toMatchObject({ ok: true });

    const second = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-2"));
    expect(second).toMatchObject({ ok: true });

    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
  }, 30_000);
});
