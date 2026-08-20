import { User } from "lucide-react";
import { useLabels } from "../../../../../../data/labels/useLabels";
import type { AppNotification } from "../../../../../../data/notifications/notificationTypes";
import { formatDateTime, targetLabel, type AckStats } from "./notificationPresentation";

type Props = {
  notifications: AppNotification[];
  statsById: Map<string, AckStats>;
  selectedId: string | null;
  onSelect: (notification: AppNotification) => void;
};

export default function NotificationList({ notifications, statsById, selectedId, onSelect }: Props) {
  const L = useLabels();

  return (
    <ul className="ntf-list">
      {notifications.map((notification) => {
        const stats = statsById.get(notification.id);
        const percent = stats?.percent ?? 0;
        const tone = stats?.complete ? "complete" : "pending";
        return (
          <li key={notification.id}>
            <article
              className={`ntf-card${selectedId === notification.id ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === notification.id}
              onClick={() => onSelect(notification)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(notification);
                }
              }}
            >
              <div className="ntf-card-top">
                <span className={`ntf-target-badge ntf-target-badge--${stats?.target ?? "all"}`}>
                  {targetLabel(stats?.target ?? "all")}
                </span>
                {stats?.complete && <span className="ntf-complete-badge">{L.notif_filter_complete}</span>}
                <span className="ntf-card-date">{formatDateTime(notification.postedAt)}</span>
              </div>

              <p className="ntf-card-message">{notification.message}</p>

              <div className="ntf-card-progress">
                <span className="ntf-bar" aria-hidden>
                  <span className={`ntf-bar-fill ntf-bar-fill--${tone}`} style={{ width: `${percent}%` }} />
                </span>
                <span className={`ntf-ratio ntf-ratio--${tone}`}>
                  {stats ? `${stats.accepted}/${stats.total}` : "—"}
                </span>
              </div>

              <div className="ntf-card-by">
                <User size={12} aria-hidden />
                <span>{L.notif_mgr_posted_by.replace("{user}", notification.postedBy)}</span>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
