import { describe, expect, it } from "vitest";

import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import {
  ACTIONS_EXPORT_HEADERS,
  ACTIVITY_EXPORT_HEADERS,
  buildActionsExportRows,
  buildActivityExportRows,
} from "./auditLogExport";

const action = (over: Partial<WorkspaceActionEntry>): WorkspaceActionEntry => ({
  id: "a1",
  at: "2026-09-29T10:00:00.000Z",
  actor: "sara",
  actorRole: "supervisor",
  action: "user-created",
  ...over,
});

describe("buildActionsExportRows", () => {
  it("emits one row per entry in header order, newest first, details flattened", () => {
    const rows = buildActionsExportRows([
      action({ id: "old", at: "2026-09-01T08:00:00.000Z", target: "ali", monthFolderName: "9-September-2026", details: { count: 3, ok: true, note: null } }),
      action({ id: "new", at: "2026-09-29T10:00:00.000Z" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(ACTIONS_EXPORT_HEADERS.length);
    expect(rows[0][0]).toBe("2026-09-29 10:00:00");
    expect(rows[0][4]).toBe("");
    expect(rows[1][4]).toBe("ali");
    expect(rows[1][5]).toBe("9-September-2026");
    expect(rows[1][6]).toBe("count: 3 | ok: true | note: ");
  });
});

describe("buildActivityExportRows", () => {
  it("converts duration to whole minutes and labels the close reason", () => {
    const entry: AuthActivityLogEntry = {
      id: "s1", username: "ali", role: "employee",
      signedInAt: "2026-09-29T08:00:00.000Z", lastSeenAt: "2026-09-29T09:30:00.000Z",
      signedOutAt: null, durationMs: 90 * 60_000, closeReason: "logout",
    };
    const [row] = buildActivityExportRows([entry]);
    expect(row).toHaveLength(ACTIVITY_EXPORT_HEADERS.length);
    expect(row[0]).toBe("ali");
    expect(row[5]).toBe(90);
    expect(row[6]).toBe("تسجيل خروج");
    expect(row[4]).toBe("");
  });
});
