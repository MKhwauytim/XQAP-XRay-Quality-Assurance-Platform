import type { AuthActivityCloseReason, AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import { useState } from "react";
import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { WorkspaceActionEntry, WorkspaceActionType } from "../../../../data/audit/actionLog";
import { getLabels, type LabelKey } from "../../../../data/labels/labelsStore";
import { RoleBadge } from "./UserManagementShared";
import { formatDateTime, formatDuration } from "./userManagementFormatters";
import Pagination from "../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../components/Pagination/paginationUtils";

const ACTION_TYPE_LABEL_KEYS: Record<WorkspaceActionType, LabelKey> = {
  "user-deleted": "um_action_type_user_deleted",
  "user-created": "um_action_type_user_created",
  "permission-changed": "um_action_type_permission_changed",
  "feature-permission-changed": "um_action_type_feature_permission_changed",
  "sample-drawn": "um_action_type_sample_drawn",
  "distribution-bulk-assigned": "um_action_type_distribution_bulk_assigned",
  "referral-approved": "um_action_type_referral_approved",
  "referral-denied": "um_action_type_referral_denied",
  "replacement-approved": "um_action_type_replacement_approved",
  "replacement-denied": "um_action_type_replacement_denied",
  "reopen-approved": "um_action_type_reopen_approved",
  "reopen-denied": "um_action_type_reopen_denied",
  "answer-reopened": "um_action_type_answer_reopened",
  "month-closed": "um_action_type_month_closed",
  "month-reopened": "um_action_type_month_reopened",
  "backup-restored": "um_action_type_backup_restored",
};

function getDateKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function getWeekStartKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - date.getDay());
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function getCloseReasonLabel(reason: AuthActivityCloseReason | null): string {
  if (reason === "logout") return "تسجيل خروج";
  if (reason === "expired") return "انتهت الجلسة";
  if (reason === "session-replaced") return "دخول جديد";
  if (reason === "page-closed") return "إغلاق التطبيق/المتصفح";
  return "نشط";
}

export function ActivitySection(props: {
  users: ManagedLoginUser[];
  entries: AuthActivityLogEntry[];
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const entriesPageKey = `${props.entries.length}:${props.entries[0]?.id ?? ""}:${props.entries.at(-1)?.id ?? ""}`;
  const [pageState, setPageState] = useState<{ entriesKey: string; page: number }>(() => ({ entriesKey: entriesPageKey, page: 1 }));
  const todayKey = getDateKey(new Date().toISOString());
  const weekKey = getWeekStartKey(new Date().toISOString());
  const userMap = new Map(props.users.map((user) => [user.username, user]));
  const summaries = props.users
    .filter((user) => user.role === "employee" || user.role === "supervisor")
    .map((user) => {
      const entries = props.entries.filter((entry) => entry.username === user.username);
      const todayMs = entries.filter((entry) => getDateKey(entry.signedInAt) === todayKey).reduce((sum, entry) => sum + entry.durationMs, 0);
      const weekMs = entries.filter((entry) => getWeekStartKey(entry.signedInAt) === weekKey).reduce((sum, entry) => sum + entry.durationMs, 0);
      const latest = entries.slice().sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ?? null;
      return { user, todayMs, weekMs, signIns: entries.length, latest };
    })
    .sort((a, b) => b.weekMs - a.weekMs || a.user.displayName.localeCompare(b.user.displayName, "ar"));
  const sortedEntries = props.entries.slice().sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const page = clampPage(pageState.entriesKey === entriesPageKey ? pageState.page : 1, sortedEntries.length);
  const latestEntries = pageSlice(sortedEntries, page);

  return <div className="um-section">
    <div className="um-matrix-desc">تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في<strong> 5-system/audit/activity.log.json</strong>.</div>
    <div className="um-activity-toolbar"><button type="button" className="um-add-btn" onClick={props.onRefresh}>تحديث السجل</button><span>{props.isLoading ? "جاري تحميل الأنشطة..." : `${props.entries.length.toLocaleString("ar-SA-u-nu-latn")} سجل`}</span></div>
    <div className="um-activity-summary-grid">
      {summaries.map(({ user, todayMs, weekMs, signIns, latest }) => <article key={user.id} className="um-activity-card"><div><strong>{user.displayName}</strong><span>{user.username}</span></div><dl><div><dt>اليوم</dt><dd>{formatDuration(todayMs)}</dd></div><div><dt>هذا الأسبوع</dt><dd>{formatDuration(weekMs)}</dd></div><div><dt>مرات الدخول</dt><dd>{signIns.toLocaleString("ar-SA-u-nu-latn")}</dd></div><div><dt>آخر حالة</dt><dd>{getCloseReasonLabel(latest?.closeReason ?? null)}</dd></div></dl></article>)}
    </div>
    {latestEntries.length === 0 ? <div className="um-empty">لا توجد سجلات نشاط محفوظة بعد.</div> : <><div className="um-activity-table-wrap"><table className="um-activity-table"><thead><tr><th>المستخدم</th><th>الدور</th><th>دخول</th><th>آخر ظهور</th><th>خروج / إغلاق</th><th>المدة</th><th>السبب</th></tr></thead><tbody>{latestEntries.map((entry) => {
      const user = userMap.get(entry.username);
      return <tr key={entry.id}><td><strong>{user?.displayName ?? entry.username}</strong><span>{entry.username}</span></td><td>{user ? <RoleBadge role={user.role} /> : entry.role}</td><td>{formatDateTime(entry.signedInAt)}</td><td>{formatDateTime(entry.lastSeenAt)}</td><td>{formatDateTime(entry.signedOutAt)}</td><td>{formatDuration(entry.durationMs)}</td><td>{getCloseReasonLabel(entry.closeReason)}</td></tr>;
    })}</tbody></table></div><Pagination page={page} totalItems={sortedEntries.length} onPageChange={(nextPage) => setPageState({ entriesKey: entriesPageKey, page: nextPage })} itemLabel="سجل" /></>}
  </div>;
}

export function ActionsSection(props: {
  entries: WorkspaceActionEntry[];
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const entriesPageKey = `${props.entries.length}:${props.entries[0]?.id ?? ""}:${props.entries.at(-1)?.id ?? ""}`;
  const [pageState, setPageState] = useState<{ entriesKey: string; page: number }>(() => ({ entriesKey: entriesPageKey, page: 1 }));
  const labels = getLabels();
  const sortedEntries = props.entries.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const page = clampPage(pageState.entriesKey === entriesPageKey ? pageState.page : 1, sortedEntries.length);
  const entries = pageSlice(sortedEntries, page);
  return <div className="um-section">
    <h3 className="um-add-form-title">{labels.um_actions_tab_label}</h3>
    <div className="um-matrix-desc">{labels.um_actions_desc}<strong> 5-system/audit/actions.log.json</strong></div>
    <div className="um-activity-toolbar"><button type="button" className="um-add-btn" onClick={props.onRefresh}>{labels.um_actions_refresh_btn}</button><span>{props.isLoading ? labels.um_actions_loading : `${props.entries.length.toLocaleString("ar-SA-u-nu-latn")} ${labels.um_actions_count_suffix}`}</span></div>
    {entries.length === 0 ? <div className="um-empty">{labels.um_actions_empty}</div> : <><div className="um-activity-table-wrap"><table className="um-activity-table"><thead><tr><th>{labels.um_actions_col_time}</th><th>{labels.um_actions_col_actor}</th><th>{labels.um_actions_col_role}</th><th>{labels.um_actions_col_action}</th><th>{labels.um_actions_col_target}</th><th>{labels.um_actions_col_month}</th><th>{labels.um_actions_col_details}</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{formatDateTime(entry.at)}</td><td>{entry.actor}</td><td>{entry.actorRole}</td><td>{labels[ACTION_TYPE_LABEL_KEYS[entry.action]] ?? entry.action}</td><td>{entry.target ?? "—"}</td><td>{entry.monthFolderName ?? "—"}</td><td>{entry.details ? JSON.stringify(entry.details) : "—"}</td></tr>)}</tbody></table></div><Pagination page={page} totalItems={sortedEntries.length} onPageChange={(nextPage) => setPageState({ entriesKey: entriesPageKey, page: nextPage })} itemLabel="سجل" /></>}
  </div>;
}
