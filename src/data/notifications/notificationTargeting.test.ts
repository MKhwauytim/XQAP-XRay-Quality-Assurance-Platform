// Targeting semantics for broadcast notifications (`NotificationTarget`).
//
// Two invariants carry the whole feature and are asserted from several angles
// here:
//  1. A notification written BEFORE targeting existed has no `target` field, and
//     must keep reaching the entire must-accept audience. Everything reads the
//     target through `notificationTarget`, never `notification.target`, exactly
//     so that a legacy record cannot silently become unaddressed.
//  2. Role gates before target: admin/manager post and monitor acknowledgements
//     but are never themselves an audience, so no target value — not even a
//     `custom` list that names them — puts a notification in front of them.
import { describe, expect, it } from "vitest";

import type { AuthRole } from "../../auth/authTypes";
import {
  audienceFor,
  getUnacceptedFor,
  isTargetedAt,
  notificationTarget,
  shouldShowBanner,
  type AppNotification,
  type NotificationTarget,
} from "./notificationTypes";

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

const ROSTER: { username: string; role: AuthRole }[] = [
  { username: "emp1", role: "employee" },
  { username: "emp2", role: "employee" },
  { username: "sup1", role: "supervisor" },
  { username: "sup2", role: "supervisor" },
  // Never an audience for any target — they post, they do not acknowledge.
  { username: "mgr1", role: "manager" },
  { username: "adm1", role: "admin" },
  { username: "gst1", role: "guest" },
];

describe("notificationTarget", () => {
  it("defaults a legacy notification with no target field to \"all\"", () => {
    expect(notificationTarget(makeNotification())).toBe("all");
  });

  it("returns the stored target verbatim for every explicit value", () => {
    const targets: NotificationTarget[] = ["all", "employees", "supervisors", "custom"];
    for (const target of targets) {
      expect(notificationTarget(makeNotification({ target }))).toBe(target);
    }
  });
});

describe("isTargetedAt", () => {
  it("reaches the whole must-accept audience for a legacy (untargeted) notification", () => {
    const legacy = makeNotification();
    expect(isTargetedAt(legacy, "emp1", "employee")).toBe(true);
    expect(isTargetedAt(legacy, "sup1", "supervisor")).toBe(true);
  });

  it("reaches the whole must-accept audience for target \"all\"", () => {
    const all = makeNotification({ target: "all" });
    expect(isTargetedAt(all, "emp1", "employee")).toBe(true);
    expect(isTargetedAt(all, "sup1", "supervisor")).toBe(true);
  });

  it("restricts \"employees\" to the employee role only", () => {
    const employees = makeNotification({ target: "employees" });
    expect(isTargetedAt(employees, "emp1", "employee")).toBe(true);
    expect(isTargetedAt(employees, "sup1", "supervisor")).toBe(false);
  });

  it("restricts \"supervisors\" to the supervisor role only", () => {
    const supervisors = makeNotification({ target: "supervisors" });
    expect(isTargetedAt(supervisors, "sup1", "supervisor")).toBe(true);
    expect(isTargetedAt(supervisors, "emp1", "employee")).toBe(false);
  });

  it("restricts \"custom\" to the named usernames, across both audience roles", () => {
    const custom = makeNotification({ target: "custom", audience: ["emp2", "sup1"] });
    expect(isTargetedAt(custom, "emp2", "employee")).toBe(true);
    expect(isTargetedAt(custom, "sup1", "supervisor")).toBe(true);
    expect(isTargetedAt(custom, "emp1", "employee")).toBe(false);
    expect(isTargetedAt(custom, "sup2", "supervisor")).toBe(false);
  });

  it("treats a \"custom\" notification with a missing audience list as addressed to nobody", () => {
    const custom = makeNotification({ target: "custom" });
    expect(isTargetedAt(custom, "emp1", "employee")).toBe(false);
    expect(isTargetedAt(custom, "sup1", "supervisor")).toBe(false);
  });

  it("never addresses admin/manager/guest, whatever the target says", () => {
    const nonAudience: AuthRole[] = ["manager", "admin", "guest"];
    const notifications = [
      makeNotification(),
      makeNotification({ target: "all" }),
      makeNotification({ target: "employees" }),
      makeNotification({ target: "supervisors" }),
      // Even explicitly named: the role gate runs first, on purpose.
      makeNotification({ target: "custom", audience: ["mgr1", "adm1", "gst1"] }),
    ];
    for (const notification of notifications) {
      for (const role of nonAudience) {
        expect(isTargetedAt(notification, `${role}-user`, role)).toBe(false);
      }
      expect(isTargetedAt(notification, "mgr1", "manager")).toBe(false);
      expect(isTargetedAt(notification, "adm1", "admin")).toBe(false);
      expect(isTargetedAt(notification, "gst1", "guest")).toBe(false);
    }
  });
});

describe("audienceFor", () => {
  it("returns the whole must-accept roster for a legacy notification and for \"all\"", () => {
    const expected = ["emp1", "emp2", "sup1", "sup2"];
    expect(audienceFor(makeNotification(), ROSTER).map((u) => u.username)).toEqual(expected);
    expect(audienceFor(makeNotification({ target: "all" }), ROSTER).map((u) => u.username)).toEqual(
      expected
    );
  });

  it("returns only the addressed role subset", () => {
    expect(
      audienceFor(makeNotification({ target: "employees" }), ROSTER).map((u) => u.username)
    ).toEqual(["emp1", "emp2"]);
    expect(
      audienceFor(makeNotification({ target: "supervisors" }), ROSTER).map((u) => u.username)
    ).toEqual(["sup1", "sup2"]);
  });

  it("returns only the named users for \"custom\", in roster order, ignoring unknown names", () => {
    const custom = makeNotification({
      target: "custom",
      audience: ["sup1", "emp1", "someone-who-left", "mgr1"],
    });
    // Roster order, not audience order — the picker's chip order is not a
    // promise about how the roster renders.
    expect(audienceFor(custom, ROSTER).map((u) => u.username)).toEqual(["emp1", "sup1"]);
  });

  it("returns an empty roster for a custom notification addressed to nobody reachable", () => {
    const custom = makeNotification({ target: "custom", audience: ["ghost"] });
    expect(audienceFor(custom, ROSTER)).toEqual([]);
  });

  it("carries the caller's own user shape through untouched", () => {
    const users = [{ username: "emp1", role: "employee" as AuthRole, displayName: "جميلة" }];
    expect(audienceFor(makeNotification(), users)).toEqual([
      { username: "emp1", role: "employee", displayName: "جميلة" },
    ]);
  });
});

describe("getUnacceptedFor", () => {
  const older = makeNotification({ id: "old", postedAt: "2026-08-01T08:00:00.000Z" });
  const newer = makeNotification({ id: "new", postedAt: "2026-08-02T08:00:00.000Z" });

  it("ignores targeting entirely when no role is passed (the pre-targeting call shape)", () => {
    const supervisorsOnly = makeNotification({ id: "sup-only", target: "supervisors" });
    expect(getUnacceptedFor([supervisorsOnly], "emp1").map((n) => n.id)).toEqual(["sup-only"]);
  });

  it("applies targeting when a role is passed", () => {
    const supervisorsOnly = makeNotification({ id: "sup-only", target: "supervisors" });
    const employeesOnly = makeNotification({ id: "emp-only", target: "employees" });
    const custom = makeNotification({ id: "custom", target: "custom", audience: ["emp2"] });
    const list = [supervisorsOnly, employeesOnly, custom];

    expect(getUnacceptedFor(list, "emp1", "employee").map((n) => n.id)).toEqual(["emp-only"]);
    expect(getUnacceptedFor(list, "emp2", "employee").map((n) => n.id).sort()).toEqual([
      "custom",
      "emp-only",
    ]);
    expect(getUnacceptedFor(list, "sup1", "supervisor").map((n) => n.id)).toEqual(["sup-only"]);
    // A non-audience role is addressed by nothing at all.
    expect(getUnacceptedFor(list, "mgr1", "manager")).toEqual([]);
  });

  it("drops notifications this user already accepted, and sorts the rest oldest first", () => {
    const accepted = makeNotification({
      id: "accepted",
      postedAt: "2026-07-30T08:00:00.000Z",
      acceptances: [{ username: "emp1", acceptedAt: "2026-07-31T08:00:00.000Z" }],
    });
    const list = [newer, accepted, older];
    expect(getUnacceptedFor(list, "emp1", "employee").map((n) => n.id)).toEqual(["old", "new"]);
    // Another user has accepted nothing, so he still sees all three.
    expect(getUnacceptedFor(list, "emp2", "employee").map((n) => n.id)).toEqual([
      "accepted",
      "old",
      "new",
    ]);
  });
});

describe("shouldShowBanner", () => {
  it("honours targeting: a supervisors-only broadcast raises no banner for an employee", () => {
    const list = [makeNotification({ target: "supervisors" })];
    expect(shouldShowBanner("supervisor", "sup1", list)).toBe(true);
    expect(shouldShowBanner("employee", "emp1", list)).toBe(false);
  });

  it("honours a custom audience", () => {
    const list = [makeNotification({ target: "custom", audience: ["emp2"] })];
    expect(shouldShowBanner("employee", "emp2", list)).toBe(true);
    expect(shouldShowBanner("employee", "emp1", list)).toBe(false);
  });

  it("still raises for everyone in the must-accept audience on a legacy notification", () => {
    const list = [makeNotification()];
    expect(shouldShowBanner("employee", "emp1", list)).toBe(true);
    expect(shouldShowBanner("supervisor", "sup1", list)).toBe(true);
  });

  it("never raises for admin/manager/guest", () => {
    const list = [makeNotification({ target: "custom", audience: ["mgr1", "adm1", "gst1"] })];
    expect(shouldShowBanner("manager", "mgr1", list)).toBe(false);
    expect(shouldShowBanner("admin", "adm1", list)).toBe(false);
    expect(shouldShowBanner("guest", "gst1", list)).toBe(false);
  });

  it("hides once the addressed user has accepted, while an untargeted peer keeps seeing it", () => {
    const list = [
      makeNotification({
        target: "employees",
        acceptances: [{ username: "emp1", acceptedAt: "2026-08-02T08:00:00.000Z" }],
      }),
    ];
    expect(shouldShowBanner("employee", "emp1", list)).toBe(false);
    expect(shouldShowBanner("employee", "emp2", list)).toBe(true);
  });
});
