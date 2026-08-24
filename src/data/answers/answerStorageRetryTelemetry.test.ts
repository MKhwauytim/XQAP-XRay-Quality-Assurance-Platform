import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { casLoop as CasLoopFn } from "../storage/casLoop";

type CasLoopOptions = NonNullable<Parameters<typeof CasLoopFn>[1]>;

/**
 * B-XQIO032 — two things this suite locks in for `updateEmployeeAnswerFile`
 * (the shared casLoop write behind every answer-file mutation):
 *
 *  1. It no longer relies on casLoop's shared light-touch defaults
 *     (`DEFAULT_MAX_RETRIES`/`DEFAULT_BASE_DELAY_MS` in casLoop.ts) — it passes
 *     its own wider, per-call ladder, the same override pattern
 *     `actionLog.ts` already uses for its own SMB-tuned append.
 *  2. When that ladder is still exhausted by a THROWING attempt (not a plain
 *     lost-revision conflict), the raw error is captured into the persisted
 *     error log with call-site-specific context — not just the generic
 *     `casLoop:exhausted` entry casLoop always logs regardless of caller.
 *
 * `casLoop` is mocked here so the config it receives can be asserted directly
 * and so the `onExhausted` closure `answerStorage.ts` builds can be invoked
 * synchronously with a synthetic error — proving the real production closure
 * calls `logError` correctly without needing to drive casLoop's real backoff
 * loop (14 attempts at 150 ms base) or fight the storage layer's OWN nested
 * transient-error retry ladders to force a genuine end-to-end exhaustion.
 * `casLoop.test.ts` separately proves the hook's firing rules (fires only on
 * a throwing exhaustion, never on a lost-revision one, and a throwing
 * observer can't affect the outcome) against the real casLoop implementation.
 */

const hooks = vi.hoisted(() => ({
  casLoopCalls: [] as Array<{ options?: CasLoopOptions }>,
  logErrorCalls: [] as Array<{ context: string; error: unknown; meta?: { action?: string; errorCode?: string } }>,
}));

vi.mock("../storage/casLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/casLoop")>();
  return {
    ...actual,
    casLoop: async (
      fn: Parameters<typeof actual.casLoop>[0],
      options?: Parameters<typeof actual.casLoop>[1]
    ) => {
      hooks.casLoopCalls.push({ options });
      // Delegate to the real implementation so every existing behavioral
      // guarantee (retry, verify, conflict handling) is exercised unchanged —
      // this test only needs to OBSERVE what answerStorage.ts hands casLoop.
      return actual.casLoop(fn, options);
    },
  };
});

vi.mock("../storage/errorLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/errorLogger")>();
  return {
    ...actual,
    logError: (context: string, error: unknown, meta?: { action?: string; errorCode?: string }) => {
      hooks.logErrorCalls.push({ context, error, meta });
      return actual.logError(context, error, meta);
    },
  };
});

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  appendReferralToEmployee,
  appendReplacementToEmployee,
  appendReopenToEmployee,
  reopenItemAnswer,
  saveEmployeeAnswers,
  setItemQualityNote,
  upsertItemAnswer,
  upsertItemAnswerOnBehalf,
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

beforeEach(() => {
  hooks.casLoopCalls.length = 0;
  hooks.logErrorCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateEmployeeAnswerFile — widened retry ladder (B-XQIO032)", () => {
  it("passes a wider, explicit ladder than casLoop's shared defaults on an answer save", async () => {
    const dir = createMemoryDirectory();
    const result = await upsertItemAnswer(dir, MONTH, USER, makeItem());
    expect(result.ok).toBe(true);

    expect(hooks.casLoopCalls).toHaveLength(1);
    const { options } = hooks.casLoopCalls[0]!;
    // casLoop's own shared defaults are 10 retries / 200 ms base (casLoop.ts).
    // This call must override both, not merely equal them.
    expect(options?.maxRetries).toBe(14);
    expect(options?.maxRetries).toBeGreaterThan(10);
    expect(options?.baseDelayMs).toBe(150);
    expect(typeof options?.onExhausted).toBe("function");
  });

  it("applies the same widened ladder to every answer-file write path, not just one", async () => {
    const dir = createMemoryDirectory();
    // Seed an item so reopen/quality-note/on-behalf have something to act on.
    await upsertItemAnswer(dir, MONTH, USER, makeItem({ status: "submitted", submittedAt: new Date().toISOString() }));
    hooks.casLoopCalls.length = 0;

    await saveEmployeeAnswers(dir, MONTH, USER, [makeItem()]);
    await reopenItemAnswer(dir, MONTH, USER, "X1", "supervisor1", "سبب");
    await setItemQualityNote(dir, MONTH, USER, "X1", "ملاحظة");
    await upsertItemAnswerOnBehalf(dir, MONTH, "emp2", makeItem({ xrayImageId: "X2", answeredBy: "emp2" }), "supervisor1");
    await appendReferralToEmployee(dir, MONTH, {
      requestId: "r1",
      monthFolderName: MONTH,
      fromEmployee: USER,
      toEmployee: "emp2",
      xrayImageIds: ["X1"],
      reason: "x",
      requestedAt: new Date().toISOString(),
      requestedBy: USER,
      status: "pending",
    });
    await appendReplacementToEmployee(dir, MONTH, {
      requestId: "p1",
      monthFolderName: MONTH,
      employeeUsername: USER,
      originalXrayImageId: "X1",
      replacementXrayImageId: "X3",
      reason: "x",
      requestedAt: new Date().toISOString(),
      requestedBy: USER,
      status: "pending",
    });
    await appendReopenToEmployee(dir, MONTH, {
      requestId: "o1",
      monthFolderName: MONTH,
      employeeUsername: USER,
      xrayImageId: "X1",
      reason: "x",
      requestedAt: new Date().toISOString(),
      requestedBy: USER,
      status: "pending",
    });

    expect(hooks.casLoopCalls.length).toBeGreaterThanOrEqual(7);
    for (const call of hooks.casLoopCalls) {
      expect(call.options?.maxRetries).toBe(14);
      expect(call.options?.baseDelayMs).toBe(150);
    }
  });
});

describe("updateEmployeeAnswerFile — onExhausted telemetry wiring (B-XQIO032)", () => {
  it("an answer save's onExhausted logs the RAW error under its own page/action context", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem());
    const onExhausted = hooks.casLoopCalls.at(-1)!.options!.onExhausted!;

    const rawCause = new Error("share went away mid-write");
    rawCause.name = "SomeUnclassifiedTransientError";
    onExhausted(rawCause, "XQ-IO-032");

    const logged = hooks.logErrorCalls.find((c) => c.context === "answerStorage:answer-save");
    expect(logged).toBeDefined();
    // The RAW error object itself is what's logged — not a re-derived string —
    // so `logError`'s own name/message/stack extraction sees the real thing.
    expect(logged!.error).toBe(rawCause);
    expect((logged!.error as Error).message).toBe("share went away mid-write");
    expect(logged!.meta).toEqual({ action: "answer-save", errorCode: "XQ-IO-032" });
  });

  it("gives each write path its own action label instead of one generic bucket", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, USER, makeItem({ status: "submitted", submittedAt: new Date().toISOString() }));
    hooks.casLoopCalls.length = 0;

    await reopenItemAnswer(dir, MONTH, USER, "X1", "supervisor1", "سبب");
    const reopenExhausted = hooks.casLoopCalls.at(-1)!.options!.onExhausted!;
    reopenExhausted(new Error("boom"), "XQ-IO-018");
    expect(hooks.logErrorCalls.at(-1)!.context).toBe("answerStorage:answer-reopen");
    expect(hooks.logErrorCalls.at(-1)!.meta).toEqual({ action: "answer-reopen", errorCode: "XQ-IO-018" });

    await setItemQualityNote(dir, MONTH, USER, "X1", "ملاحظة");
    const noteExhausted = hooks.casLoopCalls.at(-1)!.options!.onExhausted!;
    noteExhausted(new Error("boom"), "XQ-IO-018");
    expect(hooks.logErrorCalls.at(-1)!.context).toBe("answerStorage:quality-note-save");
  });

  it("does not change what the caller resolves to — additive telemetry only", async () => {
    const dir = createMemoryDirectory();
    const before = await upsertItemAnswer(dir, MONTH, USER, makeItem());
    expect(before).toEqual({ ok: true });

    const onExhausted = hooks.casLoopCalls.at(-1)!.options!.onExhausted!;
    const returnValue = onExhausted(new Error("irrelevant"), "XQ-IO-032");
    // The hook is fire-and-forget from casLoop's perspective (void), and must
    // never itself become something a caller awaits or branches on.
    expect(returnValue).toBeUndefined();
  });
});
