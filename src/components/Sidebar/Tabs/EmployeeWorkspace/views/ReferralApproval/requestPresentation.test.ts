import { describe, expect, it } from "vitest";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { affectedEmployee, detailSampleRows, requestTitle, waitBadge, waitingDays } from "./requestPresentation";

const NOW = Date.parse("2026-05-10T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const referral: ReferralRequest = {
  requestId: "ref-1",
  monthFolderName: "5-may-2026",
  fromEmployee: "alice",
  toEmployee: "bob",
  xrayImageIds: ["IMG-R1", "IMG-R2"],
  reason: "مراجعة ثانية",
  requestedAt: daysAgo(1),
  requestedBy: "alice",
  status: "pending",
};

const replacement: ReplacementRequest = {
  requestId: "rep-1",
  monthFolderName: "5-may-2026",
  employeeUsername: "carol",
  originalXrayImageId: "IMG-ORIG",
  replacementXrayImageId: "IMG-REPL",
  reason: "صورة غير واضحة",
  requestedAt: daysAgo(4),
  requestedBy: "carol",
  status: "pending",
};

const reopen: ReopenRequest = {
  requestId: "reo-1",
  monthFolderName: "5-may-2026",
  employeeUsername: "dave",
  xrayImageId: "IMG-REOPEN",
  reason: "خطأ في الإدخال",
  requestedAt: daysAgo(7),
  requestedBy: "dave",
  status: "pending",
};

describe("waitingDays", () => {
  it("counts whole days waited", () => {
    expect(waitingDays(daysAgo(3), NOW)).toBe(3);
  });

  it("floors a clock-skewed future timestamp at zero rather than reporting a negative wait", () => {
    expect(waitingDays(new Date(NOW + 86_400_000).toISOString(), NOW)).toBe(0);
  });
});

describe("waitBadge", () => {
  it("tones by how long the request has sat: 5+ late, 3+ warn, otherwise ok", () => {
    expect(waitBadge(daysAgo(0), NOW).tone).toBe("ok");
    expect(waitBadge(daysAgo(2), NOW).tone).toBe("ok");
    expect(waitBadge(daysAgo(3), NOW).tone).toBe("warn");
    expect(waitBadge(daysAgo(4), NOW).tone).toBe("warn");
    expect(waitBadge(daysAgo(5), NOW).tone).toBe("late");
    expect(waitBadge(daysAgo(12), NOW).tone).toBe("late");
  });

  it("uses the singular wording for exactly one day", () => {
    expect(waitBadge(daysAgo(1), NOW).label).toBe("يوم واحد انتظار");
    expect(waitBadge(daysAgo(4), NOW).label).toBe("4 أيام انتظار");
  });
});

describe("requestTitle", () => {
  const display = (username: string) => ({ alice: "أليس", bob: "بوب" })[username] ?? username;

  it("reads as the routing for a referral", () => {
    expect(requestTitle(referral, display)).toBe("أليس ← بوب");
  });

  it("names both ids for a replacement", () => {
    expect(requestTitle(replacement, display)).toBe("استبدال IMG-ORIG بـ IMG-REPL");
  });

  it("names the case for a reopen", () => {
    expect(requestTitle(reopen, display)).toBe("إعادة فتح الحالة IMG-REOPEN");
  });
});

describe("affectedEmployee", () => {
  it("is the receiving employee for a referral and the requester for the other kinds", () => {
    expect(affectedEmployee(referral)).toBe("bob");
    expect(affectedEmployee(replacement)).toBe("carol");
    expect(affectedEmployee(reopen)).toBe("dave");
  });
});

describe("detailSampleRows", () => {
  it("lists every referred sample", () => {
    expect(detailSampleRows(referral, {}).map((row) => row.xrayImageId)).toEqual(["IMG-R1", "IMG-R2"]);
  });

  it("labels the original and the replacement so the swap direction is unambiguous", () => {
    const rows = detailSampleRows(replacement, {});
    expect(rows.map((row) => [row.xrayImageId, row.roleTone])).toEqual([
      ["IMG-ORIG", "original"],
      ["IMG-REPL", "replacement"],
    ]);
  });

  it("falls back to a dash for fields the workspace could not resolve", () => {
    const [row] = detailSampleRows(reopen, {});
    expect([row.portName, row.stage, row.plate]).toEqual(["—", "—", "—"]);
  });
});
