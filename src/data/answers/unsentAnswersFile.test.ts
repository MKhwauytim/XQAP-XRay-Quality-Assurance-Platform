/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { countUnsentAnswers, loadPendingAnswerRecords, queueAnswerForLanding } from "./answerLocalMirror";
import {
  buildUnsentAnswersFile, exportUnsentAnswers, importIdentityFor, importUnsentAnswers, parseUnsentAnswersFile,
} from "./unsentAnswersFile";

const item = (id: string, at = "2026-10-13T10:00:00.000Z") => ({
  xrayImageId: id, templateId: "t", templateVersion: 1, answers: [], lastSavedAt: at,
  submittedAt: at, answeredBy: "emp1", status: "submitted" as const,
});
const identity = { eventId: "e-1", eventAt: "2026-10-13T10:00:01.000Z" };

describe("unsentAnswersFile", () => {
  beforeEach(() => { installFreshIndexedDb(); });

  it("round-trips: export on one browser, import on another, then they are pending there", async () => {
    await queueAnswerForLanding("12-December-2025", "emp1", item("A"), identity);
    const file = await exportUnsentAnswers("emp1");
    expect(file.answers).toHaveLength(1);

    installFreshIndexedDb(); // the colleague's PC
    const parsed = parseUnsentAnswersFile(JSON.stringify(file), "emp1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(await importUnsentAnswers("emp1", parsed.answers)).toBe(1);
    expect(await countUnsentAnswers("emp1")).toBe(1);
    expect(await loadPendingAnswerRecords("emp1")).toEqual([{ month: "12-December-2025", item: item("A"), identity }]);
  });

  it("refuses another user's file and malformed files", () => {
    const file = buildUnsentAnswersFile("emp2", [{ month: "m", item: item("A") }]);
    expect(parseUnsentAnswersFile(JSON.stringify(file), "emp1")).toEqual({ ok: false, reason: "other-user", fileUser: "emp2" });
    expect(parseUnsentAnswersFile("not json", "emp1")).toEqual({ ok: false, reason: "invalid" });
    expect(parseUnsentAnswersFile(JSON.stringify({ ...file, kind: "x" }), "emp2")).toEqual({ ok: false, reason: "invalid" });
    const broken = { ...file, answers: [{ month: "m", item: { xrayImageId: 5 } }] };
    expect(parseUnsentAnswersFile(JSON.stringify(broken), "emp2")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps an existing identity and gives a legacy record its own save time as eventAt", () => {
    expect(importIdentityFor({ month: "m", item: item("A"), identity })).toBe(identity);
    expect(importIdentityFor({ month: "m", item: item("A", "2026-01-02T03:04:05.000Z") }, () => "fresh"))
      .toEqual({ eventId: "fresh", eventAt: "2026-01-02T03:04:05.000Z" });
  });
});
