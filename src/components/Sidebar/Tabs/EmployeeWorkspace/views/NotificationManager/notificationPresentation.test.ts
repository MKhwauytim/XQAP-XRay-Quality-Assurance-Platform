// Pure presentation helpers behind the notification centre: the acknowledgement
// arithmetic every card, the detail bar and the filter chips read from, plus the
// composer's live "who would this reach" preview.
import { describe, expect, it } from "vitest";

import type { AuthRole } from "../../../../../../auth/authTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import type { AppNotification } from "../../../../../../data/notifications/notificationTypes";
import {
  TARGET_ORDER,
  ackStats,
  formatDateTime,
  matchesSearch,
  previewAudience,
  roleLabel,
  targetLabel,
  type AudienceUser,
} from "./notificationPresentation";

const USERS: AudienceUser[] = [
  { username: "emp1", displayName: "جميلة الغامدي", role: "employee" },
  { username: "emp2", displayName: "حاتم العريني", role: "employee" },
  { username: "emp3", displayName: "سلمان الحجي", role: "employee" },
  { username: "sup1", displayName: "محمد العتيبي", role: "supervisor" },
];

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    message: "تعميم",
    postedBy: "mgr-1",
    postedAt: "2026-08-01T08:00:00.000Z",
    acceptances: [],
    ...overrides,
  };
}

function accepted(...usernames: string[]) {
  return usernames.map((username) => ({ username, acceptedAt: "2026-08-02T08:00:00.000Z" }));
}

describe("ackStats", () => {
  it("counts the whole must-accept roster for a legacy (untargeted) notification", () => {
    const stats = ackStats(makeNotification({ acceptances: accepted("emp1") }), USERS);
    expect(stats.target).toBe("all");
    expect(stats.total).toBe(4);
    expect(stats.accepted).toBe(1);
    expect(stats.percent).toBe(25);
    expect(stats.complete).toBe(false);
    expect(stats.roster.map((u) => [u.username, u.accepted])).toEqual([
      ["emp1", true],
      ["emp2", false],
      ["emp3", false],
      ["sup1", false],
    ]);
  });

  it("counts only the addressed subset for a role target", () => {
    const stats = ackStats(
      makeNotification({ target: "supervisors", acceptances: accepted("emp1", "emp2") }),
      USERS
    );
    // The two employees acknowledged something not addressed to them; the
    // percentage must not be inflated by them.
    expect(stats.total).toBe(1);
    expect(stats.accepted).toBe(0);
    expect(stats.percent).toBe(0);
    expect(stats.complete).toBe(false);
  });

  it("counts only the named users for a custom target", () => {
    const stats = ackStats(
      makeNotification({
        target: "custom",
        audience: ["emp2", "sup1"],
        acceptances: accepted("emp2"),
      }),
      USERS
    );
    expect(stats.roster.map((u) => u.username)).toEqual(["emp2", "sup1"]);
    expect(stats.accepted).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.percent).toBe(50);
  });

  it("rounds the percentage", () => {
    const stats = ackStats(makeNotification({ acceptances: accepted("emp1", "emp2") }), [
      ...USERS.slice(0, 3),
    ]);
    // 2/3 = 66.66… → 67
    expect(stats.percent).toBe(67);
  });

  it("reads an empty roster as complete at 100%, never as 0% acknowledged", () => {
    const stats = ackStats(makeNotification({ target: "custom", audience: ["who-left"] }), USERS);
    expect(stats.total).toBe(0);
    expect(stats.percent).toBe(100);
    expect(stats.complete).toBe(true);
    expect(stats.roster).toEqual([]);
  });

  it("marks a fully-acknowledged notification complete", () => {
    const stats = ackStats(
      makeNotification({ target: "employees", acceptances: accepted("emp1", "emp2", "emp3") }),
      USERS
    );
    expect(stats.complete).toBe(true);
    expect(stats.percent).toBe(100);
  });
});

describe("previewAudience", () => {
  it("mirrors what each composer target would reach", () => {
    expect(previewAudience("all", [], USERS)).toHaveLength(4);
    expect(previewAudience("employees", [], USERS).map((u) => u.username)).toEqual([
      "emp1",
      "emp2",
      "emp3",
    ]);
    expect(previewAudience("supervisors", [], USERS).map((u) => u.username)).toEqual(["sup1"]);
  });

  it("reaches nobody for a custom target with nothing picked yet", () => {
    expect(previewAudience("custom", [], USERS)).toEqual([]);
  });

  it("reaches exactly the picked usernames for a custom target", () => {
    expect(previewAudience("custom", ["sup1", "emp3"], USERS).map((u) => u.username)).toEqual([
      "emp3",
      "sup1",
    ]);
  });
});

describe("matchesSearch", () => {
  const notification = makeNotification({ message: "اجتماع الجودة", postedBy: "Manager1" });

  it("matches everything on an empty or whitespace term", () => {
    expect(matchesSearch(notification, "")).toBe(true);
    expect(matchesSearch(notification, "   ")).toBe(true);
  });

  it("matches on the message body and on the poster's username, case-insensitively", () => {
    expect(matchesSearch(notification, "الجودة")).toBe(true);
    expect(matchesSearch(notification, "manager1")).toBe(true);
    expect(matchesSearch(notification, "  MANAGER1  ")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesSearch(notification, "تقرير")).toBe(false);
  });
});

describe("formatDateTime", () => {
  it("renders local date and time in Latin numerals, zero-padded", () => {
    // Built from local parts so the assertion is timezone-independent.
    const local = new Date(2026, 7, 20, 9, 5);
    expect(formatDateTime(local.toISOString())).toBe("2026-08-20 09:05");
  });

  it("returns the raw input rather than \"Invalid Date\" when it cannot be parsed", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("labels", () => {
  it("offers the four targets in composer order", () => {
    expect(TARGET_ORDER).toEqual(["all", "employees", "supervisors", "custom"]);
  });

  it("labels every target and both audience roles from the label store", () => {
    const L = getLabels();
    expect(targetLabel("all")).toBe(L.notif_target_all);
    expect(targetLabel("employees")).toBe(L.notif_target_employees);
    expect(targetLabel("supervisors")).toBe(L.notif_target_supervisors);
    expect(targetLabel("custom")).toBe(L.notif_target_custom);
    expect(roleLabel("supervisor" as AuthRole)).toBe(L.notif_role_supervisor);
    expect(roleLabel("employee" as AuthRole)).toBe(L.notif_role_employee);
  });
});
