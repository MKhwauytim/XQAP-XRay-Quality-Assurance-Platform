/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import { getLabels } from "../../../../../data/labels/labelsStore";

const m = vi.hoisted(() => ({
  upsertItemAnswer: vi.fn(),
  upsertItemAnswerOnBehalf: vi.fn(),
  getAnswerSubmitMode: vi.fn(),
  submitAnswerLocalFirst: vi.fn(),
  requestAnswerFlush: vi.fn(),
}));

vi.mock("../../../../../data/answers/answerStorage", async (orig) => ({
  ...(await orig<object>()),
  upsertItemAnswer: m.upsertItemAnswer,
  upsertItemAnswerOnBehalf: m.upsertItemAnswerOnBehalf,
}));
vi.mock("../../../../../data/answers/answerOutbox", () => ({
  getAnswerSubmitMode: m.getAnswerSubmitMode,
  submitAnswerLocalFirst: m.submitAnswerLocalFirst,
  requestAnswerFlush: m.requestAnswerFlush,
}));
vi.mock("../../../../../data/audit/actionLog", async (orig) => ({
  ...(await orig<object>()),
  recordAction: vi.fn(),
}));
vi.mock("../../../../../data/workspace/dataRefreshSignal", async (orig) => ({
  ...(await orig<object>()),
  notifyLocalDataChange: vi.fn(),
}));
vi.mock("../../../../../data/answers/answerDraftStore", async (orig) => ({
  ...(await orig<object>()),
  clearAnswerDraftAndLegacy: vi.fn(),
}));

import { createSaveAnswerHandler } from "./XrayReferrals";

function setup(assignedTo = "alice") {
  const setAnswers = vi.fn();
  const setStatusMsg = vi.fn();
  const handler = createSaveAnswerHandler({
    directoryHandle: {} as never,
    username: "alice",
    role: "employee",
    activeTpl: { templateId: "t1", version: 1 } as unknown as TemplateSchema,
    selMonth: "5-May-2026",
    canSubmitAnswers: true,
    canAnswerOnBehalf: true,
    setAnswers,
    setStatusMsg,
    ownBroadcastRef: { current: false },
    setDirtyEntryId: vi.fn(),
    recordLocalSubmission: vi.fn(),
  });
  const entry = { xrayImageId: "img1", assignedTo } as unknown as DistributionEntry;
  return { handler, entry, setAnswers, setStatusMsg };
}

describe("createSaveAnswerHandler local-first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.upsertItemAnswer.mockResolvedValue({ ok: true });
    m.upsertItemAnswerOnBehalf.mockResolvedValue({ ok: true });
  });

  it("(a) outbox self-save stores locally, skips the share write, requests a flush", async () => {
    m.getAnswerSubmitMode.mockReturnValue("outbox");
    m.submitAnswerLocalFirst.mockResolvedValue({ stored: true });
    const { handler, entry, setAnswers, setStatusMsg } = setup();
    const out = await handler(entry, []);
    expect(out).toEqual({ ok: true });
    expect(m.upsertItemAnswer).not.toHaveBeenCalled();
    expect(setAnswers).toHaveBeenCalledTimes(1);
    expect(setStatusMsg).toHaveBeenCalledWith({ type: "ok", text: getLabels().ew_answer_saved_locally });
    expect(m.requestAnswerFlush).toHaveBeenCalledTimes(1);
  });

  it("(b) storage unavailable falls back to the synchronous share write", async () => {
    m.getAnswerSubmitMode.mockReturnValue("outbox");
    m.submitAnswerLocalFirst.mockResolvedValue({ stored: false });
    const { handler, entry, setStatusMsg } = setup();
    const out = await handler(entry, []);
    expect(out).toEqual({ ok: true });
    expect(m.upsertItemAnswer).toHaveBeenCalledTimes(1);
    expect(m.requestAnswerFlush).not.toHaveBeenCalled();
    expect(setStatusMsg).toHaveBeenCalledWith({ type: "ok", text: "تم التقديم." });
  });

  it("(c) sync mode keeps the old behaviour", async () => {
    m.getAnswerSubmitMode.mockReturnValue("sync");
    const { handler, entry } = setup();
    const out = await handler(entry, []);
    expect(out).toEqual({ ok: true });
    expect(m.submitAnswerLocalFirst).not.toHaveBeenCalled();
    expect(m.upsertItemAnswer).toHaveBeenCalledTimes(1);
  });

  it("(d) answering on behalf never goes local-first", async () => {
    m.getAnswerSubmitMode.mockReturnValue("outbox");
    const { handler, entry } = setup("bob");
    const out = await handler(entry, []);
    expect(out).toEqual({ ok: true });
    expect(m.submitAnswerLocalFirst).not.toHaveBeenCalled();
    expect(m.upsertItemAnswerOnBehalf).toHaveBeenCalledTimes(1);
    expect(m.upsertItemAnswer).not.toHaveBeenCalled();
  });
});
