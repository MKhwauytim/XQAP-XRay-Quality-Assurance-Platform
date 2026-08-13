import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MessageCircle, X } from "lucide-react";
import { readSession } from "../../auth/authSession";
import type { AuthRole } from "../../auth/authTypes";
import {
  loadFeedback,
  replyToFeedback,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackMessage,
} from "../../data/feedback/feedbackStorage";
import { useWorkspace } from "../../data/workspace/useWorkspace";
import Pagination from "../Pagination/Pagination";
import { clampPage, pageSlice } from "../../utils/paginationUtils";
import { getLabels } from "../../data/labels/labelsStore";
import "./FeedbackWidget.css";

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  suggestion: getLabels().fb_category_suggestion,
  issue: getLabels().fb_category_issue,
  inquiry: getLabels().fb_category_inquiry,
};

const CAN_MANAGE: AuthRole[] = ["manager", "admin"];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedbackWidget() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<"new" | "all">("new");
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [myPage, setMyPage] = useState(1);
  const [adminPage, setAdminPage] = useState(1);

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

  const panelRef = useRef<HTMLDivElement>(null);
  const isManager = session ? CAN_MANAGE.includes(session.role) : false;

  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    const msgs = await loadFeedback(directoryHandle);
    setMessages(msgs);
    setLoading(false);
  }, [directoryHandle]);

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
  }, [open]);

  async function handleSubmit() {
    if (!directoryHandle || !session || !text.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitFeedback(directoryHandle, {
        from: session.username,
        role: session.role,
        category,
        text: text.trim(),
      });
      setSubmitted(true);
      setText("");
      void refresh();
    } catch (err) {
      // B6: never fail silently — a CAS conflict surfaces its Arabic message.
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
    try {
      await replyToFeedback(
        directoryHandle,
        msgId,
        {
          from: session.username,
          role: session.role,
          text: replyText ?? "",
          timestamp: new Date().toISOString(),
        },
        resolve
      );
      setReplyTexts((prev) => ({ ...prev, [msgId]: "" }));
      void refresh();
    } catch (err) {
      // B6: surface a CAS conflict instead of an unhandled rejection.
      setSubmitError(err instanceof Error ? err.message : getLabels().fb_reply_error_generic);
    } finally {
      setReplying(null);
    }
  }

  const openCount = messages.filter((m) => m.status === "open").length;
  const myMessages = session
    ? messages.filter((m) => m.from === session.username)
    : [];
  const filteredMessages = messages.filter((m) =>
    filter === "all" ? true : m.status === filter
  );
  const safeMyPage = clampPage(myPage, myMessages.length);
  const safeAdminPage = clampPage(adminPage, filteredMessages.length);

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
          aria-label={getLabels().toolbar_feedback_label}
          title={getLabels().toolbar_feedback_label}
          onClick={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))}
        >
          <MessageCircle size={22} aria-hidden />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fb-panel" ref={panelRef}>
          {/* Header */}
          <div className="fb-header">
            <div className="fb-header-text">
              <h3>{getLabels().toolbar_feedback_label}</h3>
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
                            {CATEGORY_LABELS[c]}
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
                {!submitted && myMessages.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <span className="fb-label">{getLabels().fb_my_messages_label}</span>
                    <div className="fb-msg-list" style={{ marginTop: 8 }}>
                      {pageSlice(myMessages, safeMyPage).map((msg) => (
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
                      ))}
                    </div>
                    <Pagination page={safeMyPage} totalItems={myMessages.length} onPageChange={setMyPage} itemLabel="رسالة" />
                  </div>
                )}
              </>
            )}

            {/* ── Admin all-messages view ── */}
            {isManager && adminTab === "all" && (
              <>
                {loading ? (
                  <p className="fb-empty">{getLabels().fb_loading}</p>
                ) : filteredMessages.length === 0 ? (
                  <p className="fb-empty">{getLabels().fb_empty}</p>
                ) : (
                  <>
                    <div className="fb-msg-list">
                      {pageSlice(filteredMessages, safeAdminPage).map((msg) => (
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
                      ))}
                    </div>
                    <Pagination page={safeAdminPage} totalItems={filteredMessages.length} onPageChange={setAdminPage} itemLabel="رسالة" />
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
  const badgeClass =
    msg.category === "issue" ? "issue" : msg.category === "inquiry" ? "inquiry" : "";

  return (
    <div className={`fb-msg-card${msg.status === "resolved" ? " resolved" : ""}`}>
      <div className="fb-msg-head">
        {isAdmin && <span className="fb-msg-author">{msg.from}</span>}
        <span className={`fb-msg-badge ${badgeClass}`}>
          {CATEGORY_LABELS[msg.category]}
        </span>
        {msg.status === "resolved" && (
          <span className="fb-msg-badge resolved-badge">{getLabels().fb_resolved_badge}</span>
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
