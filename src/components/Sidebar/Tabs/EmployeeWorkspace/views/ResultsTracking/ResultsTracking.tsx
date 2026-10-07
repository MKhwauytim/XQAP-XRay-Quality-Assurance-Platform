import { useEffect, useMemo, useState } from "react";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { useLabels } from "../../../../../../data/labels/useLabels";
import { parseMonthFolderName, formatMonthFolderShortLabel } from "../../../../../../data/population/monthFolder";
import {
  buildTracking,
  dayTotals,
  finishedThroughDay,
  isWorkDay,
  monthTotals,
  quotaOnDay,
  type EmployeeTracking,
  type TrackingRow,
} from "../../../../../../data/tracking/deadlineTracking";
import {
  clearMonthDeadline,
  formatDeadlineDate,
  isDeadlineInMonth,
  loadMonthDeadline,
  resolveDeadline,
  saveMonthDeadline,
  type MonthDeadlineOverride,
} from "../../../../../../data/tracking/monthDeadlineStorage";
import { defaultQuotaDeadline } from "../../../../../../utils/workingDays";
import "./ResultsTracking.css";

type Props = {
  monthFolder: string;
  rows: readonly TrackingRow[];
  /** username → ISO time of their first assignment (EmployeeQuota.assignedAt). */
  assignedAtByUser: Readonly<Record<string, string>>;
  directoryHandle: DirectoryHandleLike;
  /** Only an admin may change the deadline. */
  canEditDeadline: boolean;
  username: string;
  /** Test seam; defaults to the real clock. */
  now?: Date;
};

const LOCALE = "ar-SA-u-ca-gregory-nu-latn";
const fullDate = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayDate = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long" });
const weekdayName = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

type Tile = { label: string; value: string; note: string; tone?: "completed" | "hold" | "accent" };

type TableRow = {
  username: string;
  assigned: number;
  completed: string;
  hold: string;
  pct: number;
  quota: number;
  avgAll: string;
  avgCompleted: string;
  ok: boolean;
  span: string;
};

export default function ResultsTracking({
  monthFolder, rows, assignedAtByUser, directoryHandle, canEditDeadline, username, now,
}: Props) {
  const L = useLabels();
  const info = parseMonthFolderName(monthFolder);
  const [override, setOverride] = useState<MonthDeadlineOverride | null>(null);
  const [emp, setEmp] = useState("all");
  const [selectedDay, setSelectedDay] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadMonthDeadline(directoryHandle, monthFolder).then((o) => {
      if (!cancelled) setOverride(o);
    });
    return () => { cancelled = true; };
  }, [directoryHandle, monthFolder]);

  const clock = now ?? new Date();
  const dayStart = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate()).getTime();
  const resolved = useMemo(
    () => (info ? resolveDeadline(info.year, info.month, override) : null),
    [info, override],
  );
  const tracking = useMemo(
    () => (info && resolved
      ? buildTracking({
          rows, assignedAtByUser, year: info.year, month: info.month,
          deadline: resolved.date, today: new Date(dayStart),
        })
      : null),
    [rows, assignedAtByUser, info, resolved, dayStart],
  );

  if (!info || !resolved || !tracking || tracking.employees.length === 0) {
    return <p className="trk-note" role="status">{L.tracking_no_data}</p>;
  }

  const t = tracking;
  const todayDay = clock.getFullYear() === t.year && clock.getMonth() === t.month - 1 ? clock.getDate() : 0;
  const selected: readonly EmployeeTracking[] =
    emp === "all" ? t.employees : t.employees.filter((e) => e.username === emp);
  const dayLabel = (d: number) => dayDate.format(new Date(t.year, t.month - 1, d));
  const hasDay = selectedDay > 0;
  const future = hasDay && selectedDay > t.asOfDay;
  const dash = "—";
  const num = (n: number) => String(n);
  const fmt1 = (n: number) => n.toFixed(1);

  function openEdit(): void {
    setDraft(formatDeadlineDate(resolved!.date));
    setError("");
    setEditing(true);
  }

  async function saveDeadline(): Promise<void> {
    if (!isDeadlineInMonth(monthFolder, draft)) {
      setError(L.tracking_deadline_out_of_month);
      return;
    }
    setBusy(true);
    const isDefault = draft === formatDeadlineDate(defaultQuotaDeadline(info!.year, info!.month));
    const result = isDefault
      ? await clearMonthDeadline(directoryHandle, monthFolder)
      : await saveMonthDeadline(directoryHandle, monthFolder, draft, username || "admin");
    if (result.ok) {
      setOverride(await loadMonthDeadline(directoryHandle, monthFolder));
      setEditing(false);
      setError("");
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  async function resetDeadline(): Promise<void> {
    setBusy(true);
    const result = await clearMonthDeadline(directoryHandle, monthFolder);
    if (result.ok) {
      setOverride(null);
      setEditing(false);
      setError("");
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  const totals = monthTotals(t, selected);
  const pct = totals.assigned > 0 ? Math.round((totals.completed / totals.assigned) * 100) : 0;
  let tiles: Tile[];
  if (!hasDay) {
    tiles = [
      { label: L.tracking_tile_assigned, value: num(totals.assigned), note: L.tracking_note_total_sample },
      { label: L.tracking_tile_completed, value: num(totals.completed), note: fill(L.tracking_note_pct_of_assigned, { pct }), tone: "completed" },
      { label: L.tracking_tile_hold, value: num(totals.hold), note: L.tracking_note_no_image, tone: "hold" },
      { label: L.tracking_tile_remaining, value: num(totals.remaining), note: L.tracking_note_unfinished },
      { label: L.tracking_tile_quota, value: num(totals.quota), note: L.tracking_note_until_deadline },
      { label: L.tracking_days_left, value: num(totals.daysLeft), note: L.tracking_note_until_from_today, tone: "accent" },
    ];
  } else {
    const dt = dayTotals(t, selected, selectedDay);
    const hit = dt.target > 0 && !future ? `${Math.round((dt.completed / dt.target) * 100)}٪` : dash;
    tiles = [
      { label: L.tracking_tile_assigned, value: num(totals.assigned), note: L.tracking_note_total_sample },
      { label: L.tracking_tile_completed_day, value: future ? dash : num(dt.completed), note: dayLabel(selectedDay), tone: "completed" },
      { label: L.tracking_tile_hold_day, value: future ? dash : num(dt.hold), note: L.tracking_note_no_image, tone: "hold" },
      { label: L.tracking_tile_quota_day, value: num(dt.target), note: dt.target > 0 ? L.tracking_note_until_deadline : L.tracking_note_outside_window },
      { label: L.tracking_tile_hit, value: hit, note: L.tracking_note_hit, tone: "accent" },
      { label: L.tracking_tile_remaining_eod, value: future ? dash : num(totals.assigned - finishedThroughDay(selected, selectedDay)), note: L.tracking_note_after_all },
    ];
  }

  const tableRows: TableRow[] = t.employees.map((e) => {
    if (!hasDay) {
      const p = e.assigned > 0 ? Math.round((e.completed / e.assigned) * 100) : 0;
      return {
        username: e.username, assigned: e.assigned, completed: num(e.completed), hold: num(e.hold),
        pct: p, quota: e.quota, avgAll: fmt1(e.avgAll), avgCompleted: fmt1(e.avgCompleted),
        ok: e.avgCompleted >= e.quota, span: num(e.span),
      };
    }
    const c = e.byDay[selectedDay];
    const done = future ? 0 : c?.completed ?? 0;
    const hold = future ? 0 : c?.hold ?? 0;
    const q = quotaOnDay(t, e, selectedDay);
    let cumulative = 0;
    for (const [d, v] of Object.entries(e.byDay)) if (Number(d) <= selectedDay) cumulative += v.completed;
    return {
      username: e.username, assigned: e.assigned,
      completed: future ? dash : num(done), hold: future ? dash : num(hold),
      pct: q > 0 ? Math.min(100, Math.round((done / q) * 100)) : 0, quota: q,
      avgAll: future ? dash : num(done + hold), avgCompleted: future ? dash : num(done),
      ok: q > 0 ? done >= q : done > 0, span: num(cumulative),
    };
  });

  const unplaced = selected.reduce((n, e) => n + e.unplaced, 0);
  const monthLabel = formatMonthFolderShortLabel(monthFolder);
  const deadlineIsCustom = resolved.source === "override" && resolved.override !== null;

  const cells = [];
  for (let i = 0; i < t.leadBlanks; i += 1) {
    cells.push(<div key={`b${i}`} className="trk-cell trk-cell--blank" aria-hidden="true" />);
  }
  for (let d = 1; d <= t.daysInMonth; d += 1) {
    const weekend = !isWorkDay(t, d);
    const dt = dayTotals(t, selected, d);
    // Friday/Saturday are greyed but employees do work them: they show real
    // numbers and can be selected like any other day (their quota target is 0).
    const showCounts = d <= t.asOfDay;
    const targetOnly = !showCounts && !weekend && dt.target > 0;
    const chosen = d === selectedDay;
    const classes = ["trk-cell"];
    if (weekend) classes.push("trk-cell--weekend");
    else if (d > t.deadlineDay) classes.push("trk-cell--after");
    if (d === todayDay) classes.push("trk-cell--today");
    if (d === t.deadlineDay) classes.push("trk-cell--deadline");
    if (chosen) classes.push("trk-cell--selected");
    const label = chosen
      ? fill(L.tracking_cell_aria_selected, { day: dayLabel(d) })
      : weekend
        ? fill(L.tracking_cell_aria_weekend, { day: dayLabel(d) })
        : dayLabel(d);
    cells.push(
      <button
        key={d}
        type="button"
        className={classes.join(" ")}
        aria-pressed={chosen}
        aria-label={label}
        onClick={() => setSelectedDay((cur) => (cur === d ? 0 : d))}
      >
        <span className="trk-cell-top">
          <span className="trk-cell-day">{d}</span>
          <span className="trk-cell-tag">
            {d === t.deadlineDay
              ? L.tracking_cell_deadline
              : d === todayDay
                ? L.tracking_legend_today
                : weekend
                  ? L.tracking_cell_weekend
                  : ""}
          </span>
        </span>
        {showCounts && (
          <span className="trk-cell-counts">
            <span className="trk-cell-line trk-cell-line--completed"><span>{L.tracking_legend_completed}</span><span>{dt.completed}</span></span>
            <span className="trk-cell-line trk-cell-line--hold"><span>{L.tracking_cell_hold}</span><span>{dt.hold}</span></span>
            <span className="trk-cell-line trk-cell-line--target"><span>{L.tracking_cell_target}</span><span>{dt.target}</span></span>
          </span>
        )}
        {targetOnly && (
          <span className="trk-cell-counts">
            <span className="trk-cell-line trk-cell-line--target"><span>{L.tracking_cell_target}</span><span>{dt.target}</span></span>
          </span>
        )}
      </button>,
    );
  }

  const colLabels = hasDay
    ? {
        done: L.tracking_col_completed_day, hold: L.tracking_col_hold_day, avgAll: L.tracking_col_avg_all_day,
        avgCompleted: L.tracking_col_avg_completed_day, span: L.tracking_col_span_day,
      }
    : {
        done: L.tracking_col_completed, hold: L.tracking_col_hold, avgAll: L.tracking_col_avg_all,
        avgCompleted: L.tracking_col_avg_completed, span: L.tracking_col_span,
      };

  return (
    <div className="trk">
      <section className="trk-card trk-deadline">
        <div className="trk-deadline-main">
          <div className="trk-eyebrow">{L.tracking_deadline_title}</div>
          <div className="trk-deadline-date">
            <span>{fullDate.format(resolved.date)}</span>
            <span className={`trk-badge ${deadlineIsCustom ? "trk-badge--custom" : "trk-badge--default"}`}>
              {deadlineIsCustom ? L.tracking_deadline_custom : L.tracking_deadline_default}
            </span>
          </div>
          <div className="trk-note">
            {deadlineIsCustom && resolved.override
              ? fill(L.tracking_deadline_custom_note, {
                  by: resolved.override.updatedBy,
                  at: shortDate.format(new Date(resolved.override.updatedAt)),
                  default: shortDate.format(defaultQuotaDeadline(t.year, t.month)),
                })
              : L.tracking_deadline_default_note}
          </div>
        </div>
        <div className="trk-deadline-side">
          <div className="trk-days-left">
            <span className="trk-eyebrow">{L.tracking_days_left}</span>
            <strong>{totals.daysLeft}</strong>
          </div>
          {canEditDeadline ? (
            <div className="trk-edit">
              {!editing && (
                <button type="button" className="trk-btn trk-btn--primary" onClick={openEdit}>
                  {L.tracking_edit_deadline}
                </button>
              )}
              {editing && (
                <div className="trk-edit-row">
                  <label className="trk-eyebrow" htmlFor="trk-deadline-input">{L.tracking_new_date}</label>
                  <input
                    id="trk-deadline-input"
                    className="trk-input"
                    type="date"
                    min={formatDeadlineDate(new Date(t.year, t.month - 1, 1))}
                    max={formatDeadlineDate(new Date(t.year, t.month - 1, t.daysInMonth))}
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); setError(""); }}
                  />
                  <button type="button" className="trk-btn trk-btn--primary" disabled={busy} onClick={() => { void saveDeadline(); }}>
                    {L.tracking_save}
                  </button>
                  <button type="button" className="trk-btn" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>
                    {L.tracking_cancel}
                  </button>
                </div>
              )}
              {deadlineIsCustom && (
                <button type="button" className="trk-link" disabled={busy} onClick={() => { void resetDeadline(); }}>
                  {L.tracking_reset_default}
                </button>
              )}
              {error && <div className="trk-error" role="alert">{error}</div>}
            </div>
          ) : (
            <div className="trk-readonly">{L.tracking_deadline_admin_only}</div>
          )}
        </div>
      </section>

      <div className="trk-summary-head">
        <div className="trk-summary-title">
          <h2 className="trk-h">{hasDay ? fill(L.tracking_summary_day, { day: dayLabel(selectedDay) }) : L.tracking_summary_title}</h2>
          {hasDay && (
            <button type="button" className="trk-chip" onClick={() => setSelectedDay(0)}>
              {L.tracking_clear_day} ✕
            </button>
          )}
        </div>
        <div className="trk-filter">
          <label htmlFor="trk-emp">{L.tracking_view_label}</label>
          <select id="trk-emp" className="trk-select" value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="all">{L.tracking_all_team}</option>
            {t.employees.map((e) => (
              <option key={e.username} value={e.username}>{e.username}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="trk-tiles">
        {tiles.map((tile) => (
          <div className="trk-tile" key={tile.label}>
            <div className="trk-tile-label">{tile.label}</div>
            <div className={`trk-tile-value${tile.tone ? ` trk-tile-value--${tile.tone}` : ""}`}>{tile.value}</div>
            <div className="trk-tile-note">{tile.note}</div>
          </div>
        ))}
      </div>

      <section className="trk-card">
        <div className="trk-cal-head">
          <h2 className="trk-h">{fill(L.tracking_calendar_title, { month: monthLabel })}</h2>
          <div className="trk-legend">
            <span><i className="trk-swatch trk-swatch--completed" />{L.tracking_legend_completed}</span>
            <span><i className="trk-swatch trk-swatch--hold" />{L.tracking_legend_hold}</span>
            <span><i className="trk-swatch trk-swatch--today" />{L.tracking_legend_today}</span>
            <span><i className="trk-swatch trk-swatch--deadline" />{L.tracking_legend_deadline}</span>
          </div>
        </div>
        <div className="trk-cal-scroll">
          <div className="trk-cal">
            {Array.from({ length: 7 }, (_, i) => (
              // 3 January 2026 is a Saturday; the grid is Saturday-first.
              <div className="trk-weekday" key={i}>{weekdayName.format(new Date(2026, 0, 3 + i))}</div>
            ))}
            {cells}
          </div>
        </div>
        <div className="trk-hint">{L.tracking_calendar_hint}</div>
        {unplaced > 0 && <div className="trk-hint">{fill(L.tracking_unplaced_note, { n: unplaced })}</div>}
      </section>

      <section className="trk-card">
        <h2 className="trk-h">
          {hasDay ? fill(L.tracking_table_title_day, { day: dayLabel(selectedDay) }) : L.tracking_table_title}
        </h2>
        <div className="trk-note">{hasDay ? L.tracking_table_note_day : L.tracking_table_note}</div>
        <div className="trk-table-wrap">
          <table className="trk-table">
            <thead>
              <tr>
                <th>{L.tracking_col_employee}</th>
                <th>{L.tracking_col_assigned}</th>
                <th>{colLabels.done}</th>
                <th>{colLabels.hold}</th>
                <th>{L.tracking_col_quota}</th>
                <th>{colLabels.avgAll}</th>
                <th>{colLabels.avgCompleted}</th>
                <th>{colLabels.span}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.username}>
                  <td className="trk-name">{r.username}</td>
                  <td>{r.assigned}</td>
                  <td>
                    <div className="trk-bar">
                      <span>{r.completed} <span className="trk-muted">({r.pct}٪)</span></span>
                      <span className="trk-bar-track"><span className="trk-bar-fill" style={{ width: `${r.pct}%` }} /></span>
                    </div>
                  </td>
                  <td className="trk-hold">{r.hold}</td>
                  <td>{r.quota}</td>
                  <td>{r.avgAll}</td>
                  <td>
                    <span className={`trk-avg ${r.ok ? "trk-avg--ok" : "trk-avg--low"}`}>
                      <span className="trk-avg-dot" />{r.avgCompleted}
                    </span>
                  </td>
                  <td className="trk-muted">{r.span}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="trk-hint">{L.tracking_table_legend}</div>
      </section>
    </div>
  );
}
