import type { AuthActivityCloseReason, AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import { useMemo, useState } from "react";
import type { ManagedLoginUser } from "../../../../auth/userManagement";
import {
  ALL_ACTION_TYPES,
  HIGH_VOLUME_ACTION_TYPES,
  type WorkspaceActionEntry,
  type WorkspaceActionType,
} from "../../../../data/audit/actionLog";
import { getLabels } from "../../../../data/labels/labelsStore";
import { RoleBadge } from "./UserManagementShared";
import { formatDateTime, formatDuration } from "./userManagementFormatters";
import Pagination from "../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../utils/paginationUtils";
import {
  ACTION_TYPE_GROUPS,
  ACTION_TYPE_LABEL_KEYS,
  actorsInLog,
  filterActionEntries,
  isFilterActive,
  type ActionLogFilter,
} from "./actionCatalog";

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
  hasWorkspace: boolean;
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
  // B9: no label key exists for this yet (see edit log) -- hardcoded Arabic
  // strings distinguishing "no workspace connected" (only this session's
  // in-memory entries are visible, nothing durable was read) from a genuinely
  // empty saved log.
  const emptyMessage = props.hasWorkspace
    ? "لا توجد سجلات نشاط محفوظة بعد."
    : "لا يوجد مجلد عمل متصل — تُعرض بيانات الجلسة الحالية فقط، وليس سجل الأنشطة الكامل المحفوظ على القرص.";

  return <div className="um-section">
    <div className="um-matrix-desc">{getLabels().um_activity_desc}<strong> {getLabels().um_activity_path}</strong></div>
    <div className="um-activity-toolbar"><button type="button" className="um-add-btn" onClick={props.onRefresh}>تحديث السجل</button><span>{props.isLoading ? "جاري تحميل الأنشطة..." : `${props.entries.length.toLocaleString("ar-SA-u-nu-latn")} سجل`}</span></div>
    <div className="um-activity-summary-grid">
      {summaries.map(({ user, todayMs, weekMs, signIns, latest }) => <article key={user.id} className="um-activity-card"><div><strong>{user.displayName}</strong><span>{user.username}</span></div><dl><div><dt>اليوم</dt><dd>{formatDuration(todayMs)}</dd></div><div><dt>هذا الأسبوع</dt><dd>{formatDuration(weekMs)}</dd></div><div><dt>مرات الدخول</dt><dd>{signIns.toLocaleString("ar-SA-u-nu-latn")}</dd></div><div><dt>آخر حالة</dt><dd>{getCloseReasonLabel(latest?.closeReason ?? null)}</dd></div></dl></article>)}
    </div>
    {latestEntries.length === 0 ? <div className="um-empty">{emptyMessage}</div> : <><div className="um-activity-table-wrap"><table className="um-activity-table"><thead><tr><th>المستخدم</th><th>الدور</th><th>دخول</th><th>آخر ظهور</th><th>خروج / إغلاق</th><th>المدة</th><th>السبب</th></tr></thead><tbody>{latestEntries.map((entry) => {
      const user = userMap.get(entry.username);
      return <tr key={entry.id}><td><strong>{user?.displayName ?? entry.username}</strong><span>{entry.username}</span></td><td>{user ? <RoleBadge role={user.role} /> : entry.role}</td><td>{formatDateTime(entry.signedInAt)}</td><td>{formatDateTime(entry.lastSeenAt)}</td><td>{formatDateTime(entry.signedOutAt)}</td><td>{formatDuration(entry.durationMs)}</td><td>{getCloseReasonLabel(entry.closeReason)}</td></tr>;
    })}</tbody></table></div><Pagination page={page} totalItems={sortedEntries.length} onPageChange={(nextPage) => setPageState({ entriesKey: entriesPageKey, page: nextPage })} itemLabel="سجل" /></>}
  </div>;
}

/** Everything except the high-volume types — the picker's first-render state. */
function defaultSelectedTypes(): Set<WorkspaceActionType> {
  return new Set(ALL_ACTION_TYPES.filter((type) => !HIGH_VOLUME_ACTION_TYPES.includes(type)));
}

function emptyFilter(): ActionLogFilter {
  return { types: defaultSelectedTypes(), actor: "", from: "", to: "", search: "" };
}

/**
 * The grouped action-type multi-select.
 *
 * Split out of `ActionsSection` so the section body stays readable, and because
 * this is the only part of the filter bar with structure: eight groups, a
 * per-group toggle, and a global select-all/none that must operate on the full
 * catalogue rather than on whatever types happen to appear in the current log.
 * The latter matters — an action type with no entries yet still has to be
 * un-checkable, or a reader could never tell "nothing happened" apart from
 * "this type is filtered out".
 */
function ActionTypePicker({ selected, onChange }: {
  selected: ReadonlySet<WorkspaceActionType>;
  onChange: (next: Set<WorkspaceActionType>) => void;
}) {
  const labels = getLabels();
  function toggle(type: WorkspaceActionType): void {
    const next = new Set(selected);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange(next);
  }
  return <div className="um-actions-typepicker">
    <div className="um-actions-typepicker-head">
      <strong>{labels.um_actions_filter_types}</strong>
      <button type="button" className="um-actions-filter-link" onClick={() => onChange(new Set(ALL_ACTION_TYPES))}>{labels.um_actions_filter_select_all}</button>
      <button type="button" className="um-actions-filter-link" onClick={() => onChange(new Set())}>{labels.um_actions_filter_select_none}</button>
      <span className="um-actions-filter-hint">{labels.um_actions_filter_high_volume_hint}</span>
    </div>
    <div className="um-actions-typepicker-groups">
      {ACTION_TYPE_GROUPS.map((group) => <fieldset key={group.titleKey} className="um-actions-typegroup">
        <legend>{labels[group.titleKey]}</legend>
        {group.types.map((type) => <label key={type} className="um-actions-typeopt">
          <input
            type="checkbox"
            checked={selected.has(type)}
            onChange={() => toggle(type)}
          />
          <span>{labels[ACTION_TYPE_LABEL_KEYS[type]] ?? type}</span>
        </label>)}
      </fieldset>)}
    </div>
  </div>;
}

/**
 * The workspace action log.
 *
 * Deliberately NOT a `DataTable`. `DataTable` already filters, and reusing it
 * was the first thing considered — but it derives each column's multi-select
 * options from the rows actually present and exposes no way to seed a filter,
 * and seeding one is the whole point here: `answer-submitted` alone is ~6,500
 * entries a month, so it has to arrive UNCHECKED or every governance action is
 * buried on first paint. Adding an `initialFilters` prop to a table used by a
 * dozen other views to serve this one is a worse trade than the ~90 lines of
 * purpose-built controls below, which also get to group the type list by area
 * of the app (`DataTable`'s multi-select is a flat list) and to show a
 * shown/total count that a per-column filter popover has no place for.
 *
 * What IS reused is the shape: same `um-activity-table` markup, same
 * `Pagination`, same `clampPage`/`pageSlice` helpers, and the filtering itself
 * lives in `actionCatalog.ts` as a pure function so it is unit-tested rather
 * than render-tested.
 */
export function ActionsSection(props: {
  entries: WorkspaceActionEntry[];
  isLoading: boolean;
  hasWorkspace: boolean;
  onRefresh: () => void;
}) {
  const labels = getLabels();
  const [filter, setFilter] = useState<ActionLogFilter>(emptyFilter);
  const sortedEntries = useMemo(
    () => filterActionEntries(props.entries, filter).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [props.entries, filter]
  );
  const actors = useMemo(() => actorsInLog(props.entries), [props.entries]);
  // The page resets when the filter changes (a page-7 view of a set that just
  // shrank to two rows is not a view of anything) but NOT when `entries` is
  // merely re-read by the 45s sync — same rule DataTable's `resetToken` encodes.
  const pageKey = `${filter.types.size}:${filter.actor}:${filter.from}:${filter.to}:${filter.search}`;
  const [pageState, setPageState] = useState<{ key: string; page: number }>(() => ({ key: pageKey, page: 1 }));
  const page = clampPage(pageState.key === pageKey ? pageState.page : 1, sortedEntries.length);
  const entries = pageSlice(sortedEntries, page);
  const active = isFilterActive(filter);
  // Shown-vs-total, not a bare count: with the high-volume types filtered out by
  // default, a single number would quietly under-report the log. The existing
  // `um_actions_count_suffix` is still the word that follows it, so an admin who
  // has already overridden that keeps their wording.
  const countText = `${labels.um_actions_count_filtered
    .replace("{shown}", sortedEntries.length.toLocaleString("ar-SA-u-nu-latn"))
    .replace("{total}", props.entries.length.toLocaleString("ar-SA-u-nu-latn"))} ${labels.um_actions_count_suffix}`;
  // B9: no label key exists for this yet (see edit log) -- hardcoded Arabic
  // string distinguishing "no workspace connected" (the log could not be read
  // at all) from a genuinely empty saved log. A THIRD case is now possible and
  // must not be confused with either: the log has entries but none survive the
  // filter, which is the reader's own doing and is fixed by widening it.
  const emptyMessage = !props.hasWorkspace
    ? "لا يوجد مجلد عمل متصل — تعذر قراءة سجل الإجراءات."
    : props.entries.length > 0
      ? labels.um_actions_no_match
      : labels.um_actions_empty;
  return <div className="um-section">
    <h3 className="um-add-form-title">{labels.um_actions_tab_label}</h3>
    <div className="um-matrix-desc">{labels.um_actions_desc}<strong> {labels.um_actions_path}</strong></div>
    <div className="um-activity-toolbar">
      <button type="button" className="um-add-btn" onClick={props.onRefresh}>{labels.um_actions_refresh_btn}</button>
      <span>{props.isLoading ? labels.um_actions_loading : countText}</span>
      {active && <span className="um-actions-filter-badge">{labels.um_actions_filter_active}</span>}
    </div>
    <div className="um-actions-filters" role="group" aria-label={labels.um_actions_filters_title}>
      <div className="um-actions-filter-row">
        <label className="um-actions-filter-field">
          <span>{labels.um_actions_filter_actor}</span>
          <select value={filter.actor} onChange={(e) => setFilter((f) => ({ ...f, actor: e.target.value }))}>
            <option value="">{labels.um_actions_filter_actor_all}</option>
            {actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </select>
        </label>
        <label className="um-actions-filter-field">
          <span>{labels.um_actions_filter_from}</span>
          <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="um-actions-filter-field">
          <span>{labels.um_actions_filter_to}</span>
          <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
        </label>
        <label className="um-actions-filter-field um-actions-filter-search">
          <span>{labels.um_actions_filter_search}</span>
          <input
            type="search"
            value={filter.search}
            placeholder={labels.um_actions_filter_search_ph}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
        </label>
        <button type="button" className="um-actions-filter-reset" onClick={() => setFilter(emptyFilter())}>{labels.um_actions_filter_reset}</button>
      </div>
      <ActionTypePicker selected={filter.types} onChange={(types) => setFilter((f) => ({ ...f, types }))} />
    </div>
    {entries.length === 0 ? <div className="um-empty">{emptyMessage}</div> : <><div className="um-activity-table-wrap"><table className="um-activity-table"><thead><tr><th>{labels.um_actions_col_time}</th><th>{labels.um_actions_col_actor}</th><th>{labels.um_actions_col_role}</th><th>{labels.um_actions_col_action}</th><th>{labels.um_actions_col_target}</th><th>{labels.um_actions_col_month}</th><th>{labels.um_actions_col_details}</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{formatDateTime(entry.at)}</td><td>{entry.actor}</td><td>{entry.actorRole}</td><td>{labels[ACTION_TYPE_LABEL_KEYS[entry.action]] ?? entry.action}</td><td>{entry.target ?? "—"}</td><td>{entry.monthFolderName ?? "—"}</td><td>{entry.details ? JSON.stringify(entry.details) : "—"}</td></tr>)}</tbody></table></div><Pagination page={page} totalItems={sortedEntries.length} onPageChange={(nextPage) => setPageState({ key: pageKey, page: nextPage })} itemLabel="سجل" /></>}
  </div>;
}
