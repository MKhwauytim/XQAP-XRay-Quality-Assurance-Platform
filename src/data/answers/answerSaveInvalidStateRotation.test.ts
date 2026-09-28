/* @vitest-environment jsdom */
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
// answer-level twin the task brief calls out by name (R5): under A1's stable
// per-(browser, month, user) chain, two `upsertItemAnswer`s under a
// replace-blocked seq 0 are both `ok: true` and both items load, the
// rotation SURVIVES a reload (the stable chain resumes at the rotated seq,
// never retries the blocked one), and a SECOND consecutive blocked rotation
// target still lands quickly.
//
// jsdom (not the default `node` environment) is required here: `stableAnswerChain`
// (A1) persists its chain id to `localStorage`, and this file's `simulateReload`
// deliberately clears the IN-PAGE memo but not `localStorage` — exactly what a
// real page reload does — so the chain must survive across it the same way a
// real reload does, which only a real `localStorage` (jsdom) can exercise.
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryDirectory,
  setSimulatedFaults,
  getOperationLog,
  clearOperationLog,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearErrors } from "../storage/errorLogger";
import { __resetAppendOnlyEventLogMemosForTests, segmentFileNameForSeq } from "../storage/appendOnlyEventLog";
import { __resetDistributionSessionIdForTests } from "../distribution/distributionEventStore";
import { ANSWER_EVENTS_DIR, ANSWER_EVENT_SEGMENT_SUFFIX } from "./answerEventStore";
import {
  __resetAnswerSegmentChainMemoForTests,
  stableAnswerChainSegmentBase,
  stableAnswerChainSegmentName,
} from "./answerSegmentChain";
import {
  __resetAnswerEventsCacheForTests,
  loadEmployeeAnswers,
  upsertItemAnswer,
} from "./answerStorage";
import { listDirectoryEntries } from "../storage/directoryScan";
import { getSampleMainDir } from "../workspace/workspacePaths";
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

/** Everything a page reload forgets; localStorage (the stable chain's home) survives it. */
function simulateReload(): void {
  __resetAppendOnlyEventLogMemosForTests();
  __resetAnswerSegmentChainMemoForTests();
  __resetDistributionSessionIdForTests();
  __resetAnswerEventsCacheForTests();
}

async function segmentNames(root: DirectoryHandleLike): Promise<string[]> {
  const mainDir = await getSampleMainDir(root, MONTH, false);
  const events = await mainDir.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: false });
  return (await listDirectoryEntries(events))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX))
    .map((entry) => entry.name);
}

let root: DirectoryHandleLike;

beforeEach(() => {
  localStorage.clear();
  simulateReload();
  root = createMemoryDirectory("root", { trackOperations: true }) as unknown as DirectoryHandleLike;
  clearErrors();
});

describe("R1/R5 (E1b): a persistently replace-blocked answer segment rotates instead of failing every save", () => {
  it("lands the first save via a rotated segment, and a second save in the same session succeeds too", async () => {
    // The real writer identity is A1's STABLE per-(browser, month, user) chain
    // (`stableAnswerChain`), not the old per-page-load distribution session id
    // — computing the fault's target name any other way would silently fault a
    // file the writer never touches and let this test pass without ever
    // exercising the rotation it means to pin.
    const seq0 = stableAnswerChainSegmentName(MONTH, USER);
    // close() on THIS chain's seq-0 segment is persistently refused — the
    // reproduced production condition, standing in for another client holding
    // the writer's own segment open without FILE_SHARE_DELETE. Scoped to the
    // exact seq-0 name (not every ".ndjson") so the ROTATED target is free to
    // land normally, matching the real share condition, which blocks one
    // file, not every file this writer could ever produce. `skip: 1` models
    // "the share refuses to REPLACE the file" rather than "refuses to CREATE
    // it": the very first close() (creating a brand-new, empty seq 0) is let
    // through, and only the SECOND one onward — an actual replace of an
    // existing file — is blocked.
    setSimulatedFaults(root, [
      {
        operation: "close",
        name: seq0,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
        skip: 1,
      },
    ]);

    const first = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-1"));
    expect(first).toMatchObject({ ok: true });
    expect(await segmentNames(root)).toEqual([seq0]);

    const second = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-2"));
    expect(second).toMatchObject({ ok: true });

    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
  }, 30_000);

  it("R5: the rotation survives a reload — the stable chain resumes at the rotated segment with ZERO further close attempts on the blocked one, and the fold returns every event", async () => {
    const seq0 = stableAnswerChainSegmentName(MONTH, USER);
    const base = stableAnswerChainSegmentBase(MONTH, USER);
    const seq1 = segmentFileNameForSeq(base, 1, ANSWER_EVENT_SEGMENT_SUFFIX);

    setSimulatedFaults(root, [
      {
        operation: "close",
        name: seq0,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
        skip: 1,
      },
    ]);

    expect((await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-1"))).ok).toBe(true);
    expect((await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-2"))).ok).toBe(true);
    expect(await segmentNames(root)).toEqual(expect.arrayContaining([seq0, seq1]));

    // Simulate a reload: the in-page memos are gone, but the stable chain's
    // identity (persisted to localStorage) and the still-live fault plan on
    // the memory directory survive — this is the "employee hits reload and
    // saves again" shape the production incident actually followed.
    simulateReload();
    clearOperationLog(root);

    const third = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-3"));
    expect(third).toMatchObject({ ok: true });

    // No WRITE attempt of any kind against the blocked seq-0 segment this
    // time — the stable chain's `discoverHighestOwnSeq` listing found seq 1
    // already on disk and resumed there directly, without retrying the
    // sealed target. A READ of seq 0 is expected and fine here: the ordinary
    // answers fold re-reads every segment in the flat `answers.events/`
    // directory (including sealed ones) on a cold cache, which
    // `simulateReload`'s cache reset forces — that is normal, correct
    // behaviour, not the hazard this test pins.
    const writeAttemptsOnSeqZero = getOperationLog(root).filter(
      (entry) =>
        (entry.operation === "close" || entry.operation === "createWritable") && entry.name === seq0
    ).length;
    expect(writeAttemptsOnSeqZero).toBe(0);

    expect(await segmentNames(root)).toEqual(expect.arrayContaining([seq0, seq1]));

    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2", "IMG-3"]);
  }, 30_000);

  it("R5 variant: a second consecutive blocked rotation target still lands within one short ladder", async () => {
    const seq0 = stableAnswerChainSegmentName(MONTH, USER);
    const base = stableAnswerChainSegmentBase(MONTH, USER);
    const seq1 = segmentFileNameForSeq(base, 1, ANSWER_EVENT_SEGMENT_SUFFIX);
    const seq2 = segmentFileNameForSeq(base, 2, ANSWER_EVENT_SEGMENT_SUFFIX);

    setSimulatedFaults(root, [
      {
        operation: "close",
        name: seq0,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
        skip: 1,
      },
    ]);

    expect((await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-1"))).ok).toBe(true);
    expect((await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-2"))).ok).toBe(true);
    expect(await segmentNames(root)).toEqual(expect.arrayContaining([seq0, seq1]));

    simulateReload();

    // Now seq 1 — already holding IMG-2's content from the append above — is
    // ALSO persistently refused. No `skip` needed: by the time this fault can
    // fire, seq 1 already exists, so every close() against it IS a replace.
    setSimulatedFaults(root, [
      {
        operation: "close",
        name: seq1,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const start = Date.now();
    const third = await upsertItemAnswer(root, MONTH, USER, makeItem("IMG-3"));
    const elapsedMs = Date.now() - start;
    expect(third).toMatchObject({ ok: true });
    // Bounded by the short replace-blocked ladder (SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS
    // = [20]), not the ~11 s patient one a NotFoundError would take.
    expect(elapsedMs).toBeLessThan(2_000);

    expect(await segmentNames(root)).toEqual(expect.arrayContaining([seq0, seq1, seq2]));
    expect((await import("../storage/directoryScan")).listDirectoryEntries).toBeDefined();

    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2", "IMG-3"]);
  }, 30_000);
});
