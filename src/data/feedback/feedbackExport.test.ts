import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { formatExportTimestamp } from "../../utils/formatting";
import { getLabels, type Labels } from "../labels/labelsStore";
import type { FeedbackThread } from "./feedbackStorage";
import {
  buildFeedbackExportSheets,
  buildFeedbackMessageRows,
  buildFeedbackThreadRows,
  buildFeedbackWorkbook,
  feedbackMessageHeaders,
  feedbackThreadHeaders,
} from "./feedbackExport";

const L: Labels = getLabels();
// The export writes LOCAL time. Pin the zone (before any Date is used) so the
// literals and the snapshot never depend on the machine running the tests.
process.env.TZ = "Asia/Riyadh";

const d = (iso: string) => formatExportTimestamp(iso, { zone: "local" });

const RESOLVED_WITH_FIELDS: FeedbackThread = {
  id: "t20260920100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-09-20T10:00:00.000Z",
  status: "resolved",
  replies: [
    { from: "admin", role: "admin", text: "نراجع", timestamp: "2026-09-21T09:00:00.000Z" },
    { from: "manager1", role: "manager", text: "تم الحل", timestamp: "2026-09-22T11:30:00.000Z" },
  ],
  resolvedAt: "2026-09-22T11:30:00.000Z",
  resolvedBy: "manager1",
  revision: 3,
};

// Resolved before `resolvedAt`/`resolvedBy` existed.
const LEGACY_RESOLVED: FeedbackThread = {
  id: "t20260101100000-bbbbbbbb",
  from: "omar",
  role: "supervisor",
  category: "inquiry",
  text: "سؤال قديم",
  timestamp: "2026-01-01T10:00:00.000Z",
  status: "resolved",
  replies: [{ from: "admin", role: "admin", text: "أُجيب", timestamp: "2026-01-02T08:15:00.000Z" }],
  revision: 2,
};

const OPEN_NO_REPLY: FeedbackThread = {
  id: "t20260925100000-cccccccc",
  from: "lina",
  role: "custom-role",
  category: "suggestion",
  text: "اقتراح",
  timestamp: "2026-09-25T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

describe("feedbackExport — conversations sheet", () => {
  it("emits one row per thread, aligned with the label-driven header row", () => {
    const rows = buildFeedbackThreadRows([RESOLVED_WITH_FIELDS], L);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(feedbackThreadHeaders(L).length);
    expect(rows[0]).toEqual([
      "t20260920100000-aaaaaaaa",
      "sara",
      L.toolbar_role_employee,
      L.fb_category_issue,
      L.fb_resolved_badge,
      d("2026-09-20T10:00:00.000Z"),
      d("2026-09-22T11:30:00.000Z"),
      2,
      d("2026-09-22T11:30:00.000Z"),
      "manager1",
      L.fb_export_no,
      "الجهاز لا يعمل",
    ]);
  });

  it("writes sortable local-time timestamps (Riyadh = UTC+3), not locale text", () => {
    const [row] = buildFeedbackThreadRows([RESOLVED_WITH_FIELDS], L);
    expect(row![5]).toBe("2026-09-20 13:00:00");
    expect(row![6]).toBe("2026-09-22 14:30:00");
    expect(row![8]).toBe("2026-09-22 14:30:00");
  });

  it("approximates a legacy thread's resolution from its last reply and flags it in its own column", () => {
    const [row] = buildFeedbackThreadRows([LEGACY_RESOLVED], L);
    expect(row![8]).toBe("2026-01-02 11:15:00");
    expect(row![9]).toBe("admin");
    expect(row![10]).toBe(L.fb_export_yes);
    expect(row![2]).toBe(L.toolbar_role_supervisor);
  });

  it("leaves the resolution cells empty for an open thread and keeps an unknown role verbatim", () => {
    const [row] = buildFeedbackThreadRows([OPEN_NO_REPLY], L);
    expect(row![4]).toBe(L.fb_filter_open);
    expect(row![6]).toBe(d("2026-09-25T10:00:00.000Z"));
    expect(row![7]).toBe(0);
    expect(row![8]).toBe("");
    expect(row![9]).toBe("");
    expect(row![10]).toBe("");
    expect(row![2]).toBe("custom-role");
  });

  it("takes its headers from labels, so an admin override reaches the file", () => {
    const custom: Labels = { ...L, fb_export_col_from: "صاحب الرسالة" };
    expect(feedbackThreadHeaders(custom)[1]).toBe("صاحب الرسالة");
  });
});

describe("feedbackExport — messages sheet", () => {
  it("emits the original message then each reply, numbered from 1", () => {
    const rows = buildFeedbackMessageRows([RESOLVED_WITH_FIELDS], L);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(feedbackMessageHeaders(L).length);
    expect(rows[0]).toEqual([
      "t20260920100000-aaaaaaaa",
      L.fb_category_issue,
      L.fb_resolved_badge,
      1,
      "sara",
      L.toolbar_role_employee,
      d("2026-09-20T10:00:00.000Z"),
      "الجهاز لا يعمل",
    ]);
    expect(rows[2]).toEqual([
      "t20260920100000-aaaaaaaa",
      L.fb_category_issue,
      L.fb_resolved_badge,
      3,
      "manager1",
      L.toolbar_role_manager,
      d("2026-09-22T11:30:00.000Z"),
      "تم الحل",
    ]);
  });

  it("gives a thread with no replies exactly one row", () => {
    expect(buildFeedbackMessageRows([OPEN_NO_REPLY], L)).toHaveLength(1);
  });
});

describe("feedbackExport — chunked build and workbook", () => {
  it("the chunked builder matches the plain builders across several chunks", async () => {
    const many: FeedbackThread[] = Array.from({ length: 1200 }, (_, i) => ({
      ...OPEN_NO_REPLY,
      id: `t20260925${String(100000 + i)}-cccccccc`,
      replies: i % 2 === 0 ? [] : [{ from: "admin", role: "admin", text: "رد", timestamp: "2026-09-26T10:00:00.000Z" }],
    }));
    const sheets = await buildFeedbackExportSheets(many, L);
    expect(sheets.threadRows).toEqual(buildFeedbackThreadRows(many, L));
    expect(sheets.messageRows).toEqual(buildFeedbackMessageRows(many, L));
    expect(sheets.threadHeaders).toEqual(feedbackThreadHeaders(L));
    expect(sheets.messageHeaders).toEqual(feedbackMessageHeaders(L));
  });

  it("builds a two-sheet workbook named by labels, headers first", async () => {
    const sheets = await buildFeedbackExportSheets([RESOLVED_WITH_FIELDS, LEGACY_RESOLVED], L);
    const workbook = buildFeedbackWorkbook(sheets, L);
    expect(workbook.SheetNames).toEqual([L.fb_export_sheet_threads, L.fb_export_sheet_messages]);

    const threadSheet = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[L.fb_export_sheet_threads]!, { header: 1 });
    expect(threadSheet[0]).toEqual(feedbackThreadHeaders(L));
    expect(threadSheet).toHaveLength(3);

    const messageSheet = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[L.fb_export_sheet_messages]!, { header: 1 });
    expect(messageSheet[0]).toEqual(feedbackMessageHeaders(L));
    expect(messageSheet).toHaveLength(1 + 3 + 2);
  });
});

describe("feedbackExport — snapshot (deterministic by contract)", () => {
  it("pins both sheets for resolved-with-fields, legacy-resolved and open threads", async () => {
    const sheets = await buildFeedbackExportSheets([RESOLVED_WITH_FIELDS, LEGACY_RESOLVED, OPEN_NO_REPLY], L);
    expect(sheets).toMatchSnapshot();
  });
});
