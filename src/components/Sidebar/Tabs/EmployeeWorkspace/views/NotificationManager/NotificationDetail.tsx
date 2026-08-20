import { useState } from "react";
import { BellRing, Check, Clock, Pencil, Search, Trash2 } from "lucide-react";
import { useLabels } from "../../../../../../data/labels/useLabels";
import type { AppNotification } from "../../../../../../data/notifications/notificationTypes";
import { formatDateTime, roleLabel, targetLabel, type AckStats } from "./notificationPresentation";

type RosterFilter = "all" | "pending" | "accepted";

type Props = {
  notification: AppNotification;
  stats: AckStats;
  canPost: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemind: () => void;
  onDelete: () => void;
};

export default function NotificationDetail({ notification, stats, canPost, busy, onEdit, onRemind, onDelete }: Props) {
  const L = useLabels();
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("all");
  const [rosterSearch, setRosterSearch] = useState("");

  const needle = rosterSearch.trim().toLowerCase();
  const roster = stats.roster.filter((user) => {
    if (rosterFilter === "pending" && user.accepted) return false;
    if (rosterFilter === "accepted" && !user.accepted) return false;
    if (!needle) return true;
    return (
      (user.displayName || "").toLowerCase().includes(needle) ||
      user.username.toLowerCase().includes(needle)
    );
  });

  const tone = stats.complete ? "complete" : "pending";
  const ROSTER_TABS: { key: RosterFilter; label: string }[] = [
    { key: "all", label: L.notif_roster_all },
    { key: "pending", label: L.notif_roster_pending },
    { key: "accepted", label: L.notif_roster_accepted },
  ];

  return (
    <div className="ntf-detail">
      <div className="ntf-detail-head">
        <div className="ntf-detail-headings">
          <div className="ntf-detail-badges">
            <span className={`ntf-target-badge ntf-target-badge--${stats.target}`}>{targetLabel(stats.target)}</span>
            <span className="ntf-detail-meta">
              {L.notif_mgr_posted_by.replace("{user}", notification.postedBy)} · {formatDateTime(notification.postedAt)}
            </span>
            {notification.editedAt && (
              <span className="ntf-detail-edited">
                {L.notif_detail_edited.replace("{date}", formatDateTime(notification.editedAt))}
              </span>
            )}
          </div>
          <p className="ntf-detail-message">{notification.message}</p>
        </div>
        {canPost && (
          <div className="ntf-detail-actions">
            <button type="button" className="ntf-action ntf-action--edit" onClick={onEdit} disabled={busy}>
              <Pencil size={14} aria-hidden />
              {L.notif_action_edit}
            </button>
            <button type="button" className="ntf-action ntf-action--remind" onClick={onRemind} disabled={busy}>
              <BellRing size={14} aria-hidden />
              {L.notif_action_remind}
            </button>
            <button type="button" className="ntf-action ntf-action--delete" onClick={onDelete} disabled={busy}>
              <Trash2 size={14} aria-hidden />
              {L.notif_action_delete}
            </button>
          </div>
        )}
      </div>

      <div className="ntf-detail-body">
        <div className="ntf-ack-summary">
          <div className="ntf-ack-percent">
            <span>{L.notif_ack_percent_label}</span>
            <strong className={`ntf-ratio--${tone}`}>{stats.percent}%</strong>
          </div>
          <div className="ntf-ack-bar-wrap">
            <span className="ntf-bar ntf-bar--lg" aria-hidden>
              <span className={`ntf-bar-fill ntf-bar-fill--${tone}`} style={{ width: `${stats.percent}%` }} />
            </span>
            <p>
              {L.notif_ack_ratio
                .replace("{accepted}", String(stats.accepted))
                .replace("{total}", String(stats.total))}
            </p>
          </div>
        </div>

        <div>
          <div className="ntf-roster-head">
            <p className="ntf-section-label">{L.notif_roster_title}</p>
            <div className="ntf-roster-tabs" role="tablist" aria-label={L.notif_roster_title}>
              {ROSTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={rosterFilter === tab.key}
                  className={`ntf-roster-tab${rosterFilter === tab.key ? " active" : ""}`}
                  onClick={() => setRosterFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <label className="ntf-search ntf-search--sm">
              <Search size={14} aria-hidden />
              <input
                value={rosterSearch}
                onChange={(event) => setRosterSearch(event.target.value)}
                placeholder={L.notif_roster_search}
                aria-label={L.notif_roster_search}
              />
            </label>
          </div>

          {stats.roster.length === 0 ? (
            <p className="ntf-audience-empty">{L.notif_mgr_audience_none}</p>
          ) : roster.length === 0 ? (
            <p className="ntf-audience-empty">{L.notif_roster_empty}</p>
          ) : (
            <ul className="ntf-audience">
              {roster.map((user) => (
                <li
                  key={user.username}
                  className={`ntf-audience-item ${user.accepted ? "is-accepted" : "is-pending"}`}
                >
                  <span className="ntf-audience-status" aria-hidden>
                    {user.accepted ? <Check size={13} /> : <Clock size={13} />}
                  </span>
                  <span className="ntf-audience-identity">
                    <span className="ntf-audience-name">{user.displayName || user.username}</span>
                    <span className="ntf-audience-role">{roleLabel(user.role)}</span>
                  </span>
                  <span className="ntf-audience-tag">
                    {user.accepted ? L.notif_mgr_accepted : L.notif_mgr_pending}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
