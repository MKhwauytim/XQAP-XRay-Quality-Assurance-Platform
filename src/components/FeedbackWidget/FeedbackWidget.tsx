import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, MessageCircle, X } from "lucide-react";
import { readSession } from "../../auth/authSession";
import {
  finalizeLegacyMigration,
  listThreadSummaries,
  loadThreads,
  replyToFeedback,
  submitFeedback,
  summarizeFeedbackThread,
  type FeedbackCategory,
  type FeedbackMessage,
  type FeedbackThread,
  type FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import { canManageFeedback } from "../../data/feedback/feedbackUnread";
import {
  indexThreadsById,
  mergeSummariesWithLocalThreads,
  missingThreadIds,
  pickFresherThread,
} from "../../data/feedback/feedbackThreadMerge";
import { useFeedbackUnread } from "../../data/feedback/useFeedbackUnread";
import { logError } from "../../data/storage/errorLogger";
import { useWorkspace } from "../../data/workspace/useWorkspace";
import { useFeedbackExport } from "./useFeedbackExport";
import Pagination from "../Pagination/Pagination";
import { clampPage, pageSlice } from "../../utils/paginationUtils";
import { getLabels } from "../../data/labels/labelsStore";
import { useLabels, type Labels } from "../../data/labels/useLabels";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import "./FeedbackWidget.css";

// Finding 16: this used to be a module-scope constant, evaluated once via
// `getLabels()` at import time and then frozen for the lifetime of the tab —
// an admin's Settings-tab label override could never reach it, unlike every
// other string in this file (all read fresh via `getLabels()` inside render).
// Recomputed per-render from `useLabels()` (below, in both FeedbackWidget and
// MessageCard) so an override is picked up immediately, same as the rest of
// this file's strings.
function categoryLabel(labels: Labels, category: FeedbackCategory): string {
  if (category === "issue") return labels.fb_category_issue;
  if (category === "inquiry") return labels.fb_category_inquiry;
  return labels.fb_category_suggestion;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Independent of `status` (open/resolved is a manual admin action) — this is
 *  purely "did anyone reply yet", the thing a ticket opener actually wants to
 *  scan for. */
function hasReply(msg: FeedbackMessage): boolean {
  return msg.replies.length > 0;
}

/** Newest timestamp touching this thread — its own message or any reply. */
function latestActivity(msg: FeedbackMessage): string {
  let latest = msg.timestamp;
  for (const reply of msg.replies) {
    if (reply.timestamp > latest) latest = reply.timestamp;
  }
  return latest;
}

type ReplyFilter = "all" | "awaiting" | "answered";

function matchesReplyFilter(msg: FeedbackMessage | undefined, filter: ReplyFilter): boolean {
  // A row whose thread body has not loaded yet is never hidden by the filter —
  // it would otherwise flicker out of the list the instant a filter is picked
  // and back in once the body arrives.
  if (!msg || filter === "all") return true;
  return filter === "answered" ? hasReply(msg) : !hasReply(msg);
}

export function FeedbackWidget() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  // Shared with AdminToolbar's trigger (see FeedbackUnreadProvider): one poll,
  // one count, so both dots agree and opening the panel clears both.
  const {
    unreadCount,
    markSeen,
    reload: reloadUnread,
    messages: polledMessages,
  } = useFeedbackUnread();
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  // The list view holds SUMMARIES only (one index read + one names-only
  // listing). Thread bodies and replies are loaded for the current page alone
  // -- opening the panel no longer reads every conversation on the share.
  const [summaries, setSummaries] = useState<FeedbackThreadSummary[]>([]);
  const [threadsById, setThreadsById] = useState<Record<string, FeedbackThread>>({});
  // What this tab holds, readable from inside an async `refresh()` that must not
  // close over a stale render's copy. Layout effect, not a passive one: it runs
  // before any promise continuation can observe the just-committed map.
  const threadsByIdRef = useRef(threadsById);
  useLayoutEffect(() => {
    threadsByIdRef.current = threadsById;
  }, [threadsById]);
  // Threads THIS tab created (submit), each stamped with a sequence number, and
  // the sequence a refresh started at: only a thread created AFTER a refresh
  // began can legitimately be absent from that refresh's read. Anything else the
  // tab holds but the read lacks is gone from disk and must not be resurrected.
  const createdSeqRef = useRef(new Map<string, number>());
  const seqRef = useRef(0);
  // The workspace this tab currently shows; an async read for another one is
  // dropped on arrival.
  const currentHandleRef = useRef(directoryHandle);
  useLayoutEffect(() => {
    currentHandleRef.current = directoryHandle;
    createdSeqRef.current = new Map();
  }, [directoryHandle]);
  // A different workspace shares no thread with the previous one: drop every
  // held thread and summary (state adjusted during render, the documented
  // pattern for resetting state when an input changes).
  const [shownHandle, setShownHandle] = useState(directoryHandle);
  if (shownHandle !== directoryHandle) {
    setShownHandle(directoryHandle);
    setSummaries([]);
    setThreadsById({});
  }
  const [loading, setLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<"new" | "all">("new");
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [myReplyFilter, setMyReplyFilter] = useState<ReplyFilter>("all");
  const [adminReplyFilter, setAdminReplyFilter] = useState<ReplyFilter>("all");
  const [myPage, setMyPage] = useState(1);
  const [adminPage, setAdminPage] = useState(1);

  // Admin-only, one-time "finish the legacy migration" action (see
  // finalizeLegacyMigration's own doc). Not part of the regular refresh cycle.
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);

  // Submit form state
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // B6: surface a CAS write conflict (submit/reply throw on exhausted retries).
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reply state per message
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState<string | null>(null);

  // Finding 11: the floating feedback panel was the only overlay surface (of
  // ~20 in the app) with no focus trap and no Escape-to-close — mirrors
  // GlobalMonthSelector's popoverFocusTrapRef call site exactly.
  const panelRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setOpen(false),
    enabled: open,
  });
  const isManager = session ? canManageFeedback(session.role) : false;
  // The legacy-migration finalize action is destructive-adjacent (it removes
  // `messages.json` once archived) and workspace-wide, not per-conversation —
  // gated to the REAL admin only, same split AdminToolbar uses for its own
  // admin-only controls: a demo session reports role "admin" purely to unlock
  // tab visibility and must never see this button.
  const isRealAdmin = session?.role === "admin" && session?.mode !== "demo";
  const { isExporting, exportProgress, exportNotice, startExport } = useFeedbackExport({
    directoryHandle,
    isRealAdmin,
    currentHandleRef,
    threadsByIdRef,
  });

  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    const startedAtSeq = seqRef.current;
    const handle = directoryHandle;
    // INDEX FIRST, full read in the BACKGROUND (Workstream B, 2026-09-28).
    // This used to `await reloadUnread()` before anything else -- and that is
    // `loadFeedback`, which opens EVERY thread file in the workspace. So the
    // panel showed its spinner for as long as the whole ticket history took to
    // read, and the cost grew with every ticket ever filed.
    //
    // The list view needs only the summaries (one index read + one names-only
    // listing), so it renders from those immediately. The provider's full read
    // still runs -- the unread dot needs every reply's author and timestamp --
    // but only AFTER the summaries landed, so the two walks of the feedback
    // directory stay SEQUENCED (never two overlapping reconciles of the same
    // shared file from one tab), and it no longer gates the first render.
    //
    // `repairIndex` ONLY here: this runs when a user opens or refreshes the
    // feedback panel, a deliberate action at human rate. The background poll in
    // FeedbackUnreadProvider must never ask for it -- see listThreadSummaries'
    // doc for what that cost.
    try {
      const list = await listThreadSummaries(handle, { repairIndex: true });
      if (currentHandleRef.current !== handle) return; // workspace switched meanwhile
      // MERGE with what this tab already applied: a submit/reply/resolve made
      // while this read was in flight is durable but absent from `list`.
      setSummaries(
        mergeSummariesWithLocalThreads(list, threadsByIdRef.current, (id) =>
          (createdSeqRef.current.get(id) ?? 0) > startedAtSeq
        )
      );
    } catch (err) {
      // Leave the last-known list in place; the background reload below still
      // runs and the page effect reads whatever it can. Logged rather than
      // swallowed so a failing index read is visible in the durable error log.
      logError("feedbackWidget:listThreadSummaries", err);
    } finally {
      // A read dropped because the workspace changed must not end the spinner
      // of the NEW workspace's refresh, which is still in flight.
      if (currentHandleRef.current === handle) setLoading(false);
    }
    markSeen();
    void reloadUnread().then(() => markSeen());
  }, [directoryHandle, markSeen, reloadUnread]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh; setState fires inside the async callback, not synchronously in the effect body
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    function handler() {
      setOpen((current) => !current);
    }

    window.addEventListener("feedback:toggle", handler);
    return () => window.removeEventListener("feedback:toggle", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, panelRef]);

  async function handleSubmit() {
    if (!directoryHandle || !session || !text.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    // The workspace this write belongs to. If the user switches workspace while
    // it is in flight the write still lands in THIS one; its result must not be
    // applied to the other workspace's list.
    const handle = directoryHandle;
    try {
      const created = await submitFeedback(handle, {
        from: session.username,
        role: session.role,
        category,
        text: text.trim(),
      });
      if (currentHandleRef.current !== handle) return;
      setSubmitted(true);
      setText("");
      // Apply the thread the write returned -- no re-read. This used to run
      // `refresh()` AND `reloadUnread()`, i.e. the index + listing plus TWO
      // full reads of every thread file, for a change this tab already holds
      // in full. One provider reload remains, for the unread dot.
      createdSeqRef.current.set(created.id, (seqRef.current += 1));
      setThreadsById((prev) => ({ ...prev, [created.id]: created }));
      setSummaries((prev) => [
        summarizeFeedbackThread(created),
        ...prev.filter((summary) => summary.threadId !== created.id),
      ]);
      void reloadUnread();
    } catch (err) {
      // B6: never fail silently — a CAS conflict surfaces its Arabic message.
      if (currentHandleRef.current !== handle) return; // not this workspace's banner
      setSubmitError(err instanceof Error ? err.message : getLabels().fb_submit_error_generic);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(msgId: string, resolve = false) {
    if (!directoryHandle || !session) return;
    const replyText = replyTexts[msgId]?.trim();
    if (!replyText && !resolve) return;
    setReplying(msgId);
    setSubmitError(null);
    const handle = directoryHandle; // see handleSubmit
    try {
      const updated = await replyToFeedback(
        handle,
        msgId,
        {
          from: session.username,
          role: session.role,
          text: replyText ?? "",
          timestamp: new Date().toISOString(),
        },
        resolve
      );
      if (currentHandleRef.current !== handle) return;
      setReplyTexts((prev) => ({ ...prev, [msgId]: "" }));
      // Apply the verified thread the write returned. The old code DELETED the
      // card's body here and relied on a refresh to bring it back -- but the
      // page effect did not re-run for an unchanged page, so the card sat on
      // the loading line until the panel was reopened. Applying the write's
      // own thread (its bumped revision) also means `pickFresherThread` keeps
      // preferring it over the provider's next poll until that poll catches up.
      setThreadsById((prev) => ({ ...prev, [updated.id]: updated }));
      setSummaries((prev) =>
        prev.map((summary) =>
          summary.threadId === updated.id ? { ...summary, status: updated.status } : summary
        )
      );
      void reloadUnread();
    } catch (err) {
      // B6: surface a CAS conflict instead of an unhandled rejection.
      if (currentHandleRef.current !== handle) return;
      setSubmitError(err instanceof Error ? err.message : getLabels().fb_reply_error_generic);
    } finally {
      setReplying(null);
    }
  }

  async function handleFinalizeLegacyMigration() {
    if (!directoryHandle) return;
    setFinalizing(true);
    setFinalizeMessage(null);
    try {
      const result = await finalizeLegacyMigration(directoryHandle);
      const l = getLabels();
      if (result.reason === "no-legacy-data") {
        setFinalizeMessage(l.fb_finalize_legacy_result_none);
      } else if (result.reason === "verification-failed") {
        setFinalizeMessage(
          l.fb_finalize_legacy_result_failed
            .replace("{verified}", String(result.verifiedCount))
            .replace("{total}", String(result.totalLegacyCount))
        );
      } else if (result.reason === "remove-unsupported") {
        setFinalizeMessage(l.fb_finalize_legacy_result_archive_failed);
      } else if (result.migratedNow > 0) {
        setFinalizeMessage(
          l.fb_finalize_legacy_result_migrated
            .replace("{migrated}", String(result.migratedNow))
            .replace("{verified}", String(result.verifiedCount))
        );
      } else {
        setFinalizeMessage(
          l.fb_finalize_legacy_result_verified.replace("{verified}", String(result.verifiedCount))
        );
      }
    } catch {
      setFinalizeMessage(getLabels().fb_finalize_legacy_error);
    } finally {
      setFinalizing(false);
    }
  }

  // A thread body can come from two places: the provider's polled aggregate
  // (already in memory -- reading it again from disk is pure waste) or this
  // widget's own page-scoped copy. `threadFor` resolves each id to the fresher
  // of the two; see feedbackThreadMerge.ts.
  const polledById = useMemo(() => indexThreadsById(polledMessages), [polledMessages]);
  const threadFor = (threadId: string): FeedbackMessage | undefined =>
    pickFresherThread(threadsById[threadId], polledById.get(threadId));

  // All three run on SUMMARIES -- status, author and count are index fields, so
  // filtering and paginating costs no thread reads at all.
  const openCount = summaries.filter((s) => s.status === "open").length;
  const mySummaries = session
    ? summaries.filter((s) => s.from === session.username)
    : [];
  const filteredSummaries = summaries.filter((s) =>
    filter === "all" ? true : s.status === filter
  );

  // Sorted by LATEST ACTIVITY, not createdAt: this is specifically what makes
  // "which of my tickets just got a reply" findable at a glance. The index
  // deliberately carries no reply-recency field (a plain reply must never
  // write the shared index -- see appendReply's doc and the regression test
  // pinning it), so this reads it from whichever thread bodies happen to be
  // loaded already (`threadFor` -- the provider's polled copy or this page's
  // own read) and falls back
  // to `createdAt` for a row not loaded yet. Rows re-sort slightly as bodies
  // stream in -- the same "fills in progressively" shape the reply list itself
  // already has, not a new pattern for this panel.
  //
  // Crucially, this reorders WITHOUT changing which ids get fetched: fetching
  // stays bounded to the current page either way (see the loadThreads effect
  // below), so a mailbox with far more than one page of tickets still opens
  // only that page's thread files, never the whole history.
  const myByActivity = [...mySummaries].sort((a, b) => {
    const ta = threadFor(a.threadId);
    const tb = threadFor(b.threadId);
    const la = ta ? latestActivity(ta) : a.createdAt;
    const lb = tb ? latestActivity(tb) : b.createdAt;
    return lb.localeCompare(la);
  });
  const myFilteredSummaries = myByActivity.filter((s) =>
    matchesReplyFilter(threadFor(s.threadId), myReplyFilter)
  );
  const adminFilteredSummaries = filteredSummaries.filter((s) =>
    matchesReplyFilter(threadFor(s.threadId), adminReplyFilter)
  );

  const safeMyPage = clampPage(myPage, myFilteredSummaries.length);
  const safeAdminPage = clampPage(adminPage, adminFilteredSummaries.length);

  // Plain consts, not useMemo: these are cheap filters/sorts over already-small
  // summary arrays, and the React Compiler already memoizes this component --
  // wrapping a derived value in a manual useMemo whose own inputs are
  // unmemoized plain consts is what the compiler flags as "existing
  // memoization could not be preserved". Every other derived value in this
  // component is the same plain-const shape.
  const visibleSummaries =
    isManager && adminTab === "all"
      ? pageSlice(adminFilteredSummaries, safeAdminPage)
      : pageSlice(myFilteredSummaries, safeMyPage);

  const visibleIds = visibleSummaries.map((summary) => summary.threadId);
  // Only the ids NEITHER source holds are read from disk, and the effect keys on
  // that SORTED set -- not on the ordered visible ids. The old ordered key
  // changed every time the "my messages" list re-sorted by latest activity as
  // bodies streamed in, which re-read the same page. A submit or reply used to
  // also DELETE that thread from `threadsById` and lean on a refresh to bring
  // it back, which left the card stuck on the loading line whenever the page
  // itself didn't change; submit/reply now apply the write's own returned
  // thread instead, so a thread id never goes missing from `threadsById` once
  // this tab has written it. A set key still matters for the re-order case:
  // re-ordering never changes it, so it does not re-trigger the read effect.
  //
  // An id whose file cannot be read stays in the set, so the key does not
  // change and the read is not retried in a loop; the card keeps its loading
  // line until the next open or refresh, as before.
  const missingIdsKey = missingThreadIds(visibleIds, threadsById, polledById).join("|");

  useEffect(() => {
    if (!directoryHandle || !open || missingIdsKey === "") return;
    let cancelled = false;
    loadThreads(directoryHandle, missingIdsKey.split("|"))
      .then((threads) => {
        if (cancelled) return;
        setThreadsById((prev) => {
          const next = { ...prev };
          for (const thread of threads) next[thread.id] = thread;
          return next;
        });
      })
      .catch(() => {
        // A page that cannot be read leaves the previously-loaded threads in
        // place; the cards fall back to their summary rows.
      });
    return () => {
      cancelled = true;
    };
  }, [directoryHandle, open, missingIdsKey]);

  // The read-only demo/viewer session reports role "admin" purely to unlock
  // full tab visibility (see AdminToolbar's own isDemo/isRealAdmin split) — it
  // is NOT a real admin. AdminToolbar's inline feedback button is gated on
  // `isRealAdmin` (role "admin" AND NOT demo), so a plain `role !== "admin"`
  // check here excluded demo sessions from the floating trigger too, leaving
  // them with no way at all to open feedback. Only the REAL admin — who has
  // AdminToolbar's own button — is excluded, to avoid a duplicate trigger.
  const isDemoSession = session?.mode === "demo";
  const showFloatingTrigger =
    Boolean(session) && (session?.role !== "admin" || isDemoSession);

  return (
    <>
      {/* Floating trigger (non-admin roles only) */}
      {showFloatingTrigger && !open && (
        <button
          type="button"
          className="fb-fab"
          aria-label={
            unreadCount > 0
              ? `${getLabels().toolbar_feedback_label} — ${getLabels().fb_unread_dot_aria.replace("{count}", unreadCount.toLocaleString("ar-SA-u-nu-latn"))}`
              : getLabels().toolbar_feedback_label
          }
          title={getLabels().toolbar_feedback_label}
          onClick={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))}
        >
          <MessageCircle size={22} aria-hidden />
          {/* Unread dot: a message or reply from someone else that this user
              has not opened the panel on yet. Purely decorative — the count it
              stands for is spelled out in the button's own aria-label. */}
          {unreadCount > 0 && <span className="fb-fab-dot" aria-hidden="true" />}
        </button>
      )}

      {/* Panel.
          Deliberately NOT `aria-modal="true"`: this is a floating, non-modal
          panel — no backdrop, no portal, and the whole app behind it stays
          fully interactive by design (you open it *while* working, to report
          what you are looking at). Claiming modality told assistive tech the
          rest of the page was inert when it was not, which is worse than
          claiming nothing. Making it genuinely modal would mean adding a
          backdrop and blocking the app, i.e. changing the product, not fixing
          an a11y bug. Escape still closes it. */}
      {open && (
        <div
          className="fb-panel"
          ref={panelRef}
          role="dialog"
          aria-labelledby="fbPanelTitle"
        >
          {/* Header */}
          <div className="fb-header">
            <div className="fb-header-text">
              <h3 id="fbPanelTitle">{getLabels().toolbar_feedback_label}</h3>
              <p>{isManager ? getLabels().fb_subtitle_manager : getLabels().fb_subtitle_user}</p>
            </div>
            <button className="fb-close" onClick={() => setOpen(false)} aria-label={getLabels().fb_close_aria}><X size={16} /></button>
          </div>

          {/* Admin tabs */}
          {isManager && (
            <div className="fb-tabs">
              <button
                className={`fb-tab${adminTab === "new" ? " active" : ""}`}
                onClick={() => setAdminTab("new")}
              >
                {getLabels().fb_tab_new}
              </button>
              <button
                className={`fb-tab${adminTab === "all" ? " active" : ""}`}
                onClick={() => setAdminTab("all")}
              >
                {getLabels().fb_tab_all} {openCount > 0 && `(${openCount})`}
              </button>
            </div>
          )}

          {/* Filter bar (admin, all-messages view) */}
          {isManager && adminTab === "all" && (
            <>
              <div className="fb-filter-bar">
                {(["open", "resolved", "all"] as const).map((f) => (
                  <button
                    key={f}
                    className={`fb-filter-btn${filter === f ? " active" : ""}`}
                    onClick={() => { setFilter(f); setAdminPage(1); }}
                  >
                    {f === "open" ? getLabels().fb_filter_open : f === "resolved" ? getLabels().fb_filter_resolved : getLabels().fb_filter_all}
                  </button>
                ))}
              </div>
              {/* Reply-status filter: separate axis from open/resolved -- a
                  ticket can be open AND already answered (waiting on the
                  requester), which the status filter alone cannot say. */}
              <div className="fb-filter-bar">
                {(["all", "awaiting", "answered"] as const).map((f) => (
                  <button
                    key={f}
                    className={`fb-filter-btn${adminReplyFilter === f ? " active" : ""}`}
                    onClick={() => { setAdminReplyFilter(f); setAdminPage(1); }}
                  >
                    {f === "all"
                      ? getLabels().fb_reply_filter_all
                      : f === "awaiting"
                        ? getLabels().fb_reply_filter_awaiting
                        : getLabels().fb_reply_filter_answered}
                  </button>
                ))}
              </div>
              {isRealAdmin && (
                <div className="fb-export">
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary ui-btn--sm fb-export-btn"
                    disabled={isExporting}
                    onClick={() => { void startExport(); }}
                  >
                    {exportProgress
                      ? getLabels()
                          .fb_export_progress.replace("{done}", String(exportProgress.done))
                          .replace("{total}", String(exportProgress.total))
                      : isExporting
                        ? getLabels().fb_exporting
                        : getLabels().fb_export_btn}
                  </button>
                  {exportNotice && (
                    <p
                      className={`fb-export-notice is-${exportNotice.kind}`}
                      role={exportNotice.kind === "empty" ? "status" : "alert"}
                    >
                      {exportNotice.text}
                    </p>
                  )}
                </div>
              )}
              {isRealAdmin && (
                <div className="fb-finalize-legacy">
                  <button
                    type="button"
                    className="fb-finalize-legacy-btn"
                    disabled={finalizing}
                    onClick={() => { void handleFinalizeLegacyMigration(); }}
                  >
                    {finalizing ? getLabels().fb_finalize_legacy_running : getLabels().fb_finalize_legacy_btn}
                  </button>
                  {finalizeMessage && <p className="fb-finalize-legacy-msg">{finalizeMessage}</p>}
                </div>
              )}
            </>
          )}

          {/* Body */}
          <div className="fb-body">
            {/* ── Submit form (everyone, or admin "new" tab) ── */}
            {(!isManager || adminTab === "new") && (
              <>
                {submitted ? (
                  <div className="fb-success">
                    <div className="fb-success-icon"><Check size={28} /></div>
                    <h4>{getLabels().fb_success_title}</h4>
                    <p>{getLabels().fb_success_body}</p>
                    <button
                      className="fb-success-back"
                      onClick={() => setSubmitted(false)}
                    >
                      {getLabels().fb_success_send_another}
                    </button>
                  </div>
                ) : (
                  <div className="fb-form">
                    <div>
                      <span className="fb-label">{getLabels().fb_message_type_label}</span>
                      <div className="fb-category-row">
                        {(["suggestion", "issue", "inquiry"] as FeedbackCategory[]).map((c) => (
                          <button
                            key={c}
                            className={`fb-cat-btn${category === c ? " active" : ""}`}
                            onClick={() => setCategory(c)}
                          >
                            {categoryLabel(labels, c)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="fb-label" htmlFor="fb-text">{getLabels().fb_message_label}</label>
                      <textarea
                        id="fb-text"
                        className="fb-textarea"
                        placeholder={getLabels().fb_message_placeholder}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                    <button
                      className="fb-submit-btn"
                      disabled={!text.trim() || submitting}
                      onClick={() => { void handleSubmit(); }}
                    >
                      {submitting ? getLabels().fb_submitting : getLabels().fb_submit_btn}
                    </button>
                    {submitError && (
                      <p className="fb-error" role="alert" style={{ color: "#dc2626", marginTop: 8, fontSize: 13 }}>
                        {submitError}
                      </p>
                    )}
                  </div>
                )}

                {/* User's own message history */}
                {!submitted && mySummaries.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <span className="fb-label">{getLabels().fb_my_messages_label}</span>
                    {/* Sorted newest-activity-first (see myByActivity above) --
                        this filter narrows it further to just what needs a
                        look, or just what has already been handled. */}
                    <div className="fb-filter-bar" style={{ padding: "6px 0 0" }}>
                      {(["all", "awaiting", "answered"] as const).map((f) => (
                        <button
                          key={f}
                          className={`fb-filter-btn${myReplyFilter === f ? " active" : ""}`}
                          onClick={() => { setMyReplyFilter(f); setMyPage(1); }}
                        >
                          {f === "all"
                            ? getLabels().fb_reply_filter_all
                            : f === "awaiting"
                              ? getLabels().fb_reply_filter_awaiting
                              : getLabels().fb_reply_filter_answered}
                        </button>
                      ))}
                    </div>
                    <div className="fb-msg-list" style={{ marginTop: 8 }}>
                      {visibleSummaries.map((s) => {
                        const msg = threadFor(s.threadId);
                        // The thread file for this row has not arrived yet.
                        if (!msg) return <p key={s.threadId} className="fb-empty">{getLabels().fb_loading}</p>;
                        return (
                          <MessageCard
                            key={msg.id}
                            msg={msg}
                            isAdmin={false}
                            canReply={msg.status === "open"}
                            replyText={replyTexts[msg.id] ?? ""}
                            onReplyChange={(v) =>
                              setReplyTexts((prev) => ({ ...prev, [msg.id]: v }))
                            }
                            onReply={() => { void handleReply(msg.id, false); }}
                            isSending={replying === msg.id}
                          />
                        );
                      })}
                    </div>
                    <Pagination page={safeMyPage} totalItems={myFilteredSummaries.length} onPageChange={setMyPage} itemLabel="رسالة" />
                  </div>
                )}
              </>
            )}

            {/* ── Admin all-messages view ── */}
            {isManager && adminTab === "all" && (
              <>
                {loading ? (
                  <p className="fb-empty">{getLabels().fb_loading}</p>
                ) : adminFilteredSummaries.length === 0 ? (
                  <p className="fb-empty">{getLabels().fb_empty}</p>
                ) : (
                  <>
                    <div className="fb-msg-list">
                      {visibleSummaries.map((s) => {
                        const msg = threadFor(s.threadId);
                        if (!msg) return <p key={s.threadId} className="fb-empty">{getLabels().fb_loading}</p>;
                        return (
                          <MessageCard
                            key={msg.id}
                            msg={msg}
                            isAdmin
                            replyText={replyTexts[msg.id] ?? ""}
                            onReplyChange={(v) =>
                              setReplyTexts((prev) => ({ ...prev, [msg.id]: v }))
                            }
                            onReply={() => { void handleReply(msg.id, false); }}
                            onResolve={() => { void handleReply(msg.id, true); }}
                            isSending={replying === msg.id}
                          />
                        );
                      })}
                    </div>
                    <Pagination page={safeAdminPage} totalItems={adminFilteredSummaries.length} onPageChange={setAdminPage} itemLabel="رسالة" />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Message card sub-component ─────────────────────────── */
function MessageCard({
  msg,
  isAdmin,
  canReply = false,
  replyText = "",
  onReplyChange,
  onReply,
  onResolve,
  isSending = false,
}: {
  msg: FeedbackMessage;
  isAdmin: boolean;
  canReply?: boolean;
  replyText?: string;
  onReplyChange?: (v: string) => void;
  onReply?: () => void;
  onResolve?: () => void;
  isSending?: boolean;
}) {
  const labels = useLabels();
  const badgeClass =
    msg.category === "issue" ? "issue" : msg.category === "inquiry" ? "inquiry" : "";

  return (
    <div className={`fb-msg-card${msg.status === "resolved" ? " resolved" : ""}`}>
      <div className="fb-msg-head">
        {isAdmin && <span className="fb-msg-author">{msg.from}</span>}
        <span className={`fb-msg-badge ${badgeClass}`}>
          {categoryLabel(labels, msg.category)}
        </span>
        {msg.status === "resolved" && (
          <span className="fb-msg-badge resolved-badge">{getLabels().fb_resolved_badge}</span>
        )}
        {/* Independent of the resolved badge above: "resolved" is a manual
            admin action, "answered" is just "did anyone reply" -- an open
            ticket can already have a reply and still be waiting on the
            requester, which is exactly what this badge is for. */}
        {hasReply(msg) ? (
          <span className="fb-msg-badge answered-badge">{getLabels().fb_answered_badge}</span>
        ) : (
          <span className="fb-msg-badge awaiting-badge">{getLabels().fb_awaiting_badge}</span>
        )}
        <span className="fb-msg-time">{formatTime(msg.timestamp)}</span>
      </div>
      <div className="fb-msg-body">{msg.text}</div>

      {msg.replies.length > 0 && (
        <div className="fb-replies">
          {msg.replies.map((r, i) => (
            <div key={i} className="fb-reply">
              <div className="fb-reply-meta">{r.from} · {formatTime(r.timestamp)}</div>
              {r.text && <div className="fb-reply-text">{r.text}</div>}
            </div>
          ))}
        </div>
      )}

      {msg.status === "open" && (isAdmin || canReply) && onReplyChange && onReply && (
        <div className="fb-reply-form">
          <textarea
            className="fb-reply-input"
            placeholder={getLabels().fb_reply_placeholder}
            value={replyText}
            onChange={(e) => onReplyChange(e.target.value)}
            rows={1}
          />
          <div className="fb-reply-actions">
            <button
              className="fb-reply-send"
              disabled={!replyText.trim() || isSending}
              onClick={onReply}
            >
              {isSending ? getLabels().fb_reply_sending : getLabels().fb_reply_btn}
            </button>
            {isAdmin && onResolve && (
              <button className="fb-resolve-btn" onClick={onResolve} disabled={isSending}>
                {getLabels().fb_resolve_btn}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
