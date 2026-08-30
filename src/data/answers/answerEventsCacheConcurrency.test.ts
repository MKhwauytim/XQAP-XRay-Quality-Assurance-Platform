/* @vitest-environment jsdom */
/**
 * INDEPENDENT VALIDATOR PROBE — not part of the Stage 2 implementer's own
 * test suite. Written during adversarial review of Stage 2's in-memory
 * `answerEventsCache` (see `answerStorage.ts`'s module doc right above
 * `readAllAnswerEventsForMonth`).
 *
 * `answerEventsCache.test.ts` (the implementer's own coverage) exercises
 * SEQUENTIAL same-tab saves only — each awaited before the next starts. This
 * file asks the harder question: what happens when two writes from the SAME
 * tab are issued CONCURRENTLY (fired without awaiting the first), so their
 * `readAllAnswerEventsForMonth` / `setAnswerEventsCacheEntry` calls interleave
 * and the second call's cache write can clobber the first's (a `Map`/`WeakMap`
 * entry is a plain last-write-wins object, there is no lock around it)?
 *
 * The cache module doc argues informally this is still safe because a cache
 * entry's `offsets` never overstate what is really on disk, so even a
 * "clobbered" entry is a valid (if stale) resume point and a later real read
 * self-heals. This test verifies that claim holds in practice rather than
 * trusting the argument.
 */
import { describe, test, expect, beforeEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  __resetAnswerEventsCacheForTests,
  __resetAnswerEventClockForTests,
  loadEmployeeAnswers,
  upsertItemAnswer,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const EMPLOYEE = "emp1";

beforeEach(() => {
  __resetAnswerEventsCacheForTests();
  __resetAnswerEventClockForTests();
});

function makeItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v0" }],
    lastSavedAt: "2026-05-12T09:00:00.000Z",
    submittedAt: null,
    answeredBy: EMPLOYEE,
    status: "draft",
    ...overrides,
  };
}

describe("answerEventsCache under genuinely concurrent same-tab writes", () => {
  test("two concurrent (unawaited) upsertItemAnswer calls for DIFFERENT items both durably land, even if the cache clobbers itself", async () => {
    const dir = createMemoryDirectory();

    const [r1, r2] = await Promise.all([
      upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" })),
      upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X2" })),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Fresh cache, forcing a real cold re-read from disk — the ground-truth
    // check: did both events actually land, regardless of what the in-memory
    // cache thought happened during the race?
    __resetAnswerEventsCacheForTests();
    const file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(file.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X2"]);
  });

  test("ten concurrent (unawaited) upsertItemAnswer calls for distinct items all land", async () => {
    const dir = createMemoryDirectory();

    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: `X${i}` }))
      )
    );
    for (const r of results) expect(r.ok).toBe(true);

    __resetAnswerEventsCacheForTests();
    const file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    const ids = file.items.map((i) => i.xrayImageId).sort();
    expect(ids).toEqual(Array.from({ length: N }, (_, i) => `X${i}`).sort());
  });

  test("a warm-cache concurrent pair (cache already primed by a prior save) still lands both writes and a subsequent WARM read (no cache reset) sees both", async () => {
    const dir = createMemoryDirectory();

    // Prime the cache with a real prior read/write.
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X0" }));
    await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);

    const [r1, r2] = await Promise.all([
      upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" })),
      upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X2" })),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // WARM read: no cache reset. This is the scenario most exposed to a
    // clobbered/lost optimistic cache entry masking a just-written event
    // behind stale (but not overstated) offsets — if the self-healing
    // property does NOT hold, this is where it would show as a missing item.
    const file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(file.items.map((i) => i.xrayImageId).sort()).toEqual(["X0", "X1", "X2"]);
  });
});
