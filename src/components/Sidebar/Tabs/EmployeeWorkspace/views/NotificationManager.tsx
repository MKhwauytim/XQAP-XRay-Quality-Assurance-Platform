import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Megaphone, Pin, Send } from "lucide-react";

import { PageHeader } from "../../../../PageHeader/PageHeader";
import { EmptyState } from "../../../../StateViews/StateViews";
import Pagination from "../../../../Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../Pagination/paginationUtils";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { usePermissions } from "../../../../../auth/usePermissions";
import { getManagedLoginUsers } from "../../../../../auth/userManagement";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { useLabels } from "../../../../../data/labels/useLabels";
import {
  loadNotifications,
  postNotification,
} from "../../../../../data/notifications/notificationStorage";
import {
  hasAccepted,
  isNotificationAudienceRole,
  type AppNotification,
} from "../../../../../data/notifications/notificationTypes";
import "./NotificationManager.css";

type Props = { directoryHandle: DirectoryHandleLike };

type AudienceUser = { username: string; displayName: string };

type PostStatus = { type: "ok" | "error"; text: string } | null;

// Local, Latin-numeral date-time (the app forces Latin numerals everywhere).
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sortNewestFirst(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

export default function NotificationManager({ directoryHandle }: Props) {
  useLabels();
  const { can, canMutate, username } = usePermissions();
  const canSeePost = can("post-notification");
  const canPost = canMutate("post-notification");

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PostStatus>(null);

  const reload = useCallback(async () => {
    const list = await loadNotifications(directoryHandle);
    setNotifications(sortNewestFirst(list));
  }, [directoryHandle]);

  // Load on mount / workspace change. Promise-chain (not `void reload()`) so the
  // setState lands in a `.then` callback, not synchronously in the effect body.
  useEffect(() => {
    loadNotifications(directoryHandle)
      .then((list) => setNotifications(sortNewestFirst(list)))
      .catch(() => {});
  }, [directoryHandle]);

  // The must-accept audience: active employee + supervisor managed users.
  const audienceUsers = useMemo<AudienceUser[]>(
    () =>
      getManagedLoginUsers()
        .filter((u) => u.isActive && isNotificationAudienceRole(u.role))
        .map((u) => ({ username: u.username, displayName: u.displayName })),
    []
  );

  const handlePost = useCallback(async () => {
    if (!canPost) {
      setStatus({ type: "error", text: "لا تملك صلاحية النشر، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setStatus(null);
    const result = await postNotification(directoryHandle, { message: text, postedBy: username });
    setBusy(false);
    if (result.ok) {
      setMessage("");
      setStatus({ type: "ok", text: getLabels().notif_mgr_post_success });
      await reload();
    } else {
      setStatus({ type: "error", text: result.error });
    }
  }, [message, busy, canPost, directoryHandle, username, reload]);

  const labels = getLabels();

  const safePage = clampPage(page, notifications.length);
  const pagedNotifications = pageSlice(notifications, safePage);

  return (
    <section className="ntf-page" dir="rtl">
      <PageHeader
        eyebrow={labels.notif_mgr_eyebrow}
        title={labels.notif_mgr_title}
        subtitle={labels.notif_mgr_subtitle}
      />

      {canSeePost && (
        <div className="ntf-post-card">
          <label className="ntf-post-label" htmlFor="ntf-post-input">
            {labels.notif_mgr_post_label}
          </label>
          <textarea
            id="ntf-post-input"
            className="ntf-post-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={labels.notif_mgr_post_placeholder}
            rows={3}
            dir="rtl"
          />
          <div className="ntf-post-actions">
            {status && (
              <span className={`ntf-post-status ntf-post-status--${status.type}`}>
                {status.text}
              </span>
            )}
            <button
              type="button"
              className="ntf-post-btn"
              onClick={handlePost}
            disabled={busy || message.trim().length === 0 || !canPost}
            title={!canPost ? "يتطلب النشر صلاحية التعديل ومساحة عمل قابلة للكتابة." : undefined}
            >
              <Send size={15} aria-hidden />{" "}
              {busy ? labels.notif_mgr_posting : labels.notif_mgr_post_btn}
            </button>
          </div>
        </div>
      )}

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title={labels.notif_mgr_empty_title}
          description={labels.notif_mgr_empty_desc}
        />
      ) : (
        <ul className="ntf-list">
          {pagedNotifications.map((n) => {
            const acceptedCount = audienceUsers.filter((u) =>
              hasAccepted(n, u.username)
            ).length;
            return (
              <li key={n.id} className="ntf-card">
                <div className="ntf-card-head">
                  <span className="ntf-card-icon">
                    <Pin size={15} aria-hidden />
                  </span>
                  <p className="ntf-card-message">{n.message}</p>
                </div>
                <div className="ntf-card-meta">
                  <span>{labels.notif_mgr_posted_by.replace("{user}", n.postedBy)}</span>
                  <span>{formatDateTime(n.postedAt)}</span>
                  <span className="ntf-card-summary">
                    {labels.notif_mgr_accepted_summary
                      .replace("{accepted}", String(acceptedCount))
                      .replace("{total}", String(audienceUsers.length))}
                  </span>
                </div>
                {audienceUsers.length === 0 ? (
                  <p className="ntf-audience-empty">{labels.notif_mgr_audience_none}</p>
                ) : (
                  <ul className="ntf-audience">
                    {audienceUsers.map((u) => {
                      const accepted = hasAccepted(n, u.username);
                      return (
                        <li
                          key={u.username}
                          className={`ntf-audience-item ${accepted ? "is-accepted" : "is-pending"}`}
                        >
                          <span className="ntf-audience-status" aria-hidden>
                            {accepted ? <Check size={13} /> : <Clock size={13} />}
                          </span>
                          <span className="ntf-audience-name">
                            {u.displayName || u.username}
                          </span>
                          <span className="ntf-audience-tag">
                            {accepted ? labels.notif_mgr_accepted : labels.notif_mgr_pending}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={safePage} totalItems={notifications.length} onPageChange={setPage} itemLabel="إشعار" />
    </section>
  );
}
