import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Megaphone, Search, Undo2, X } from "lucide-react";

import { PageHeader } from "../../../../../PageHeader/PageHeader";
import { ErrorState, LoadingState } from "../../../../../StateViews/StateViews";
import Pagination from "../../../../../Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../../utils/paginationUtils";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { usePermissions } from "../../../../../../auth/usePermissions";
import { getManagedLoginUsers, subscribeToUserManagementChanges } from "../../../../../../auth/userManagement";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import { useLabels } from "../../../../../../data/labels/useLabels";
import { logError } from "../../../../../../data/storage/errorLogger";
import { recordAction } from "../../../../../../data/audit/actionLog";
import {
  deleteNotification,
  loadNotifications,
  postNotification,
  restoreNotification,
  updateNotificationMessage,
} from "../../../../../../data/notifications/notificationStorage";
import {
  isNotificationAudienceRole,
  notificationTarget,
  type AppNotification,
  type NotificationTarget,
} from "../../../../../../data/notifications/notificationTypes";
import { subscribeToDataRefresh } from "../../../../../../data/workspace/dataRefreshSignal";
import NotificationComposer from "./NotificationComposer";
import NotificationList from "./NotificationList";
import NotificationDetail from "./NotificationDetail";
import { ackStats, matchesSearch, type AudienceUser } from "./notificationPresentation";
import "./NotificationManager.css";

type Props = { directoryHandle: DirectoryHandleLike };
type PostStatus = { type: "ok" | "error"; text: string } | null;
type LoadState = "loading" | "ready" | "error";
type ListFilter = "all" | "pending" | "complete";

/** How long the delete toast — and with it the undo affordance — stays up. */
const TOAST_MS = 12_000;

type Toast = { text: string; restore?: AppNotification };

function sortNewestFirst(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

// The must-accept audience: active employee + supervisor managed users. A plain
// module-level function (not a hook) so it can be used both as useState's lazy
// initializer and as the subscribeToUserManagementChanges callback below without
// re-deriving on every render — keeps its identity stable across renders that
// don't touch the roster (e.g. typing in the post composer).
function computeAudienceUsers(): AudienceUser[] {
  return getManagedLoginUsers()
    .filter((u) => u.isActive && isNotificationAudienceRole(u.role))
    .map((u) => ({ username: u.username, displayName: u.displayName, role: u.role }));
}

export default function NotificationManager({ directoryHandle }: Props) {
  const L = useLabels();
  const { can, canMutate, role, username } = usePermissions();
  const canSeePost = can("post-notification");
  const canPost = canMutate("post-notification");

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<NotificationTarget>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PostStatus>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // Lazy-initialized once on mount, then only re-derived when the managed-user
  // roster actually changes (via the subscription below) — never on unrelated
  // renders (e.g. every keystroke in the post composer).
  const [audienceUsers, setAudienceUsers] = useState<AudienceUser[]>(computeAudienceUsers);
  const busyRef = useRef(false);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    // `silent` is set only by the background/manual data-refresh signal below,
    // never by a real mount/workspace change. Flipping loadState to "loading"
    // unmounts the whole notification list (see the `loadState === "ready"`
    // render gate further down) -- a silent refresh must re-fetch and swap
    // the underlying rows in place instead. Mirrors XrayReferrals.tsx's
    // silent-refresh pattern.
    const silent = opts?.silent ?? false;
    if (!silent) setLoadState("loading");
    try {
      const list = await loadNotifications(directoryHandle);
      setNotifications(sortNewestFirst(list));
      setLoadState("ready");
    } catch (error) {
      logError("notificationManager:loadNotifications", error);
      // A silent background refresh must not blank a previously rendered
      // notification list on a transient read hiccup -- it's already logged
      // above for observability; leave the current state exactly as it was.
      if (silent) return;
      setLoadState("error");
    }
  }, [directoryHandle]);

  // Load on mount / workspace change.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside reload's async callback, not synchronously in the effect body
  useEffect(() => { void reload(); }, [reload]);

  // Re-fetch on the app-wide refresh signal (manual toolbar button + periodic
  // auto-refresh) so a notification posted from another session shows up here
  // without waiting for a remount. Passed silently so it never blanks the
  // list mid-refresh (see the `silent` handling inside `reload` above).
  // Rewritten as an explicit lambda rather than `subscribeToDataRefresh(reload)`:
  // the subscription invokes its callback with the bare `DataRefreshSource`
  // string as its first argument, which would otherwise land in `opts` and
  // make `opts?.silent` undefined -- silently defeating the silent refresh.
  useEffect(() => subscribeToDataRefresh(() => { void reload({ silent: true }); }), [reload]);

  // Re-derive the must-accept audience whenever the managed-user roster changes
  // (a user added/deactivated elsewhere) instead of freezing it at first mount.
  useEffect(
    () => subscribeToUserManagementChanges(() => setAudienceUsers(computeAudienceUsers())),
    []
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const statsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof ackStats>>();
    for (const notification of notifications) map.set(notification.id, ackStats(notification, audienceUsers));
    return map;
  }, [notifications, audienceUsers]);

  const counts = useMemo(() => {
    let pending = 0;
    for (const notification of notifications) {
      if (!statsById.get(notification.id)?.complete) pending += 1;
    }
    return { all: notifications.length, pending, complete: notifications.length - pending };
  }, [notifications, statsById]);

  const filtered = useMemo(
    () =>
      notifications.filter((notification) => {
        if (!matchesSearch(notification, search)) return false;
        const complete = statsById.get(notification.id)?.complete ?? false;
        if (filter === "pending") return !complete;
        if (filter === "complete") return complete;
        return true;
      }),
    [notifications, search, filter, statsById]
  );

  // Derived, not stateful: the selection follows the filtered list, so a search
  // or filter change that drops the selected notification falls back to the head
  // of the list instead of leaving an empty detail pane.
  const selected = filtered.find((n) => n.id === selectedId) ?? filtered[0] ?? null;
  const selectedStats = selected ? statsById.get(selected.id) : undefined;

  const safePage = clampPage(page, filtered.length);
  const paged = useMemo(() => pageSlice(filtered, safePage), [filtered, safePage]);

  function resetComposer(): void {
    setMessage("");
    setTarget("all");
    setPicked([]);
    setPreviewOpen(false);
    setEditingId(null);
  }

  async function withBusy(run: () => Promise<void>): Promise<void> {
    // The ref closes the same-render double-click window before React commits
    // the disabled state, so a slow filesystem write cannot post twice.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!canPost) {
      setStatus({ type: "error", text: "لا تملك صلاحية النشر، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
    const text = message.trim();
    if (!text) return;
    await withBusy(async () => {
      setStatus(null);
      const result = editingId
        ? await updateNotificationMessage(directoryHandle, editingId, { message: text, target, audience: picked })
        : await postNotification(directoryHandle, { message: text, postedBy: username, target, audience: picked });
      if (!result.ok) {
        setStatus({ type: "error", text: result.error });
        return;
      }
      const wasEditing = editingId !== null;
      recordAction(directoryHandle, username, role, wasEditing ? "notification-edited" : "notification-posted", {
        target: editingId,
        details: { target, audience: picked.length, chars: text.length },
      });
      // Only clear the composer if it still holds exactly the text that was
      // submitted — guards against clobbering a draft the user started typing
      // the instant the write settled.
      setMessage((current) => (current.trim() === text ? "" : current));
      // Everything BUT the message resets either way. Deliberately not
      // `resetComposer()` on the editing path: its unconditional
      // `setMessage("")` queues after the guarded update above and would undo
      // it, so a draft typed while an edit was being saved was discarded —
      // exactly the loss the guard exists to prevent.
      setTarget("all");
      setPicked([]);
      setPreviewOpen(false);
      if (wasEditing) setEditingId(null);
      setStatus({ type: "ok", text: wasEditing ? getLabels().notif_edit_success : getLabels().notif_mgr_post_success });
      await reload({ silent: true });
    });
  }, [canPost, message, editingId, directoryHandle, target, picked, role, username, reload]);

  function startEdit(notification: AppNotification): void {
    setEditingId(notification.id);
    setMessage(notification.message);
    setTarget(notificationTarget(notification));
    setPicked(notification.audience ?? []);
    setPreviewOpen(false);
    setStatus(null);
  }

  async function handleRemind(notification: AppNotification): Promise<void> {
    const stats = statsById.get(notification.id);
    const pendingUsers = (stats?.roster ?? []).filter((user) => !user.accepted).map((user) => user.username);
    if (pendingUsers.length === 0) {
      setStatus({ type: "ok", text: L.notif_remind_none });
      return;
    }
    await withBusy(async () => {
      setStatus(null);
      // A reminder is its own notification addressed to exactly the people who
      // have not acknowledged yet. It cannot be an edit of the original: the
      // original is already acknowledged by everyone else, and re-issuing it
      // would ask them all again.
      const result = await postNotification(directoryHandle, {
        message: L.notif_remind_prefix.replace("{message}", notification.message),
        postedBy: username,
        target: "custom",
        audience: pendingUsers,
      });
      // A reminder IS a post (see the comment above) and is logged as one, with
      // `reminderFor` naming the original so the pair reads as a thread.
      if (result.ok) {
        recordAction(directoryHandle, username, role, "notification-posted", {
          details: { reminderFor: notification.id, recipients: pendingUsers.length },
        });
      }
      setStatus(
        result.ok
          ? { type: "ok", text: L.notif_remind_success.replace("{count}", String(pendingUsers.length)) }
          : { type: "error", text: result.error }
      );
      if (result.ok) await reload({ silent: true });
    });
  }

  async function handleDelete(notification: AppNotification): Promise<void> {
    await withBusy(async () => {
      setStatus(null);
      const result = await deleteNotification(directoryHandle, notification.id);
      if (!result.ok) {
        setStatus({ type: "error", text: result.error });
        return;
      }
      recordAction(directoryHandle, username, role, "notification-deleted", { target: notification.id });
      if (editingId === notification.id) resetComposer();
      // Keep the deleted record in hand so the toast can put it back under its
      // original id — acknowledgements live in per-employee ack files keyed by
      // that id, so a restore re-attaches every one of them.
      setToast({ text: L.notif_delete_success, restore: notification });
      await reload({ silent: true });
    });
  }

  async function handleUndoDelete(): Promise<void> {
    const restore = toast?.restore;
    if (!restore) return;
    setToast(null);
    await withBusy(async () => {
      const result = await restoreNotification(directoryHandle, restore);
      if (result.ok) recordAction(directoryHandle, username, role, "notification-restored", { target: restore.id });
      setStatus(
        result.ok
          ? { type: "ok", text: L.notif_delete_undone }
          : { type: "error", text: result.error }
      );
      if (result.ok) await reload({ silent: true });
    });
  }

  const FILTERS: { key: ListFilter; label: string; count: number }[] = [
    { key: "all", label: L.notif_filter_all, count: counts.all },
    { key: "pending", label: L.notif_filter_pending, count: counts.pending },
    { key: "complete", label: L.notif_filter_complete, count: counts.complete },
  ];

  return (
    <section className="ntf-page" dir="rtl">
      <div className="ntf-header">
        <PageHeader
          eyebrow={L.notif_mgr_eyebrow}
          title={L.notif_mgr_title}
          subtitle={L.notif_mgr_subtitle_targeted}
        />
        <div className="ntf-stats">
          <div className="ntf-stat">
            <span>{L.notif_stat_total}</span>
            <strong>{counts.all}</strong>
          </div>
          <div className="ntf-stat ntf-stat--pending">
            <span>{L.notif_stat_pending}</span>
            <strong>{counts.pending}</strong>
          </div>
        </div>
      </div>

      {canSeePost && (
        <NotificationComposer
          message={message}
          onMessageChange={setMessage}
          target={target}
          onTargetChange={(next) => { setTarget(next); if (next !== "custom") setPicked([]); }}
          picked={picked}
          onTogglePicked={(user) =>
            setPicked((prev) => (prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]))
          }
          audienceUsers={audienceUsers}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((open) => !open)}
          editing={editingId !== null}
          onCancelEdit={resetComposer}
          onSubmit={() => void handleSubmit()}
          busy={busy}
          canPost={canPost}
          status={status}
        />
      )}

      <div className="ntf-toolbar">
        <label className="ntf-search">
          <Search size={15} aria-hidden />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder={L.notif_search_placeholder}
            aria-label={L.notif_search_placeholder}
          />
        </label>
        <div className="ntf-filter-chips" role="tablist" aria-label={L.notif_filter_aria}>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={filter === entry.key}
              className={`ntf-chip${filter === entry.key ? " active" : ""}`}
              onClick={() => { setFilter(entry.key); setPage(1); }}
            >
              {entry.label}
              <span className="ntf-chip-count">{entry.count}</span>
            </button>
          ))}
        </div>
      </div>

      {loadState === "loading" && <LoadingState />}

      {loadState === "error" && (
        <ErrorState
          description="تعذر تحميل الإشعارات."
          actions={
            <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => void reload()}>
              إعادة المحاولة
            </button>
          }
        />
      )}

      {loadState === "ready" && (
        <div className="ntf-split">
          <div className="ntf-column">
            <div className="ntf-sort">
              <ArrowDownUp size={13} aria-hidden />
              <span>{L.approval_sort_newest_first}</span>
              <span className="ntf-column-count">{L.notif_list_count.replace("{count}", String(filtered.length))}</span>
            </div>

            {filtered.length === 0 ? (
              <div className="ntf-list-empty">
                <span className="ntf-list-empty-icon" aria-hidden><Megaphone size={26} /></span>
                <h3>{L.notif_list_empty_title}</h3>
                <p>{L.notif_list_empty_desc}</p>
              </div>
            ) : (
              <NotificationList
                notifications={paged}
                statsById={statsById}
                selectedId={selected?.id ?? null}
                onSelect={(notification) => setSelectedId(notification.id)}
              />
            )}

            <Pagination page={safePage} totalItems={filtered.length} onPageChange={setPage} itemLabel="إشعار" />
          </div>

          {selected && selectedStats ? (
            <NotificationDetail
              notification={selected}
              stats={selectedStats}
              canPost={canPost}
              busy={busy}
              onEdit={() => startEdit(selected)}
              onRemind={() => void handleRemind(selected)}
              onDelete={() => void handleDelete(selected)}
            />
          ) : (
            <div className="ntf-detail ntf-detail--empty">
              <h3>{L.notif_detail_prompt_title}</h3>
              <p>{L.notif_detail_prompt_body}</p>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="ntf-toast" role="status">
          <span>{toast.text}</span>
          {toast.restore && (
            <button type="button" className="ntf-toast-undo" disabled={busy} onClick={() => void handleUndoDelete()}>
              <Undo2 size={14} aria-hidden />
              {L.notif_undo}
            </button>
          )}
          <button type="button" className="ntf-toast-close" aria-label="إغلاق" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
