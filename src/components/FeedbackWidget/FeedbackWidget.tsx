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
import "./FeedbackWidget.css";

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  suggestion: "اقتراح",
  issue: "مشكلة",
  inquiry: "استفسار",
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
      setSubmitError(err instanceof Error ? err.message : "تعذّر حفظ الملاحظة — أعد المحاولة.");
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
      setSubmitError(err instanceof Error ? err.message : "تعذّر حفظ الرد — أعد المحاولة.");
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

  // Non-admin authenticated roles have no toolbar feedback button (that trigger
  // is admin-only in AdminToolbar). Give them a self-contained floating trigger so
  // everyone can reach the feedback panel. Admins/demo (role "admin") are excluded
  // to avoid a duplicate trigger.
  const showFloatingTrigger = Boolean(session) && session?.role !== "admin";

  return (
    <>
      {/* Floating trigger (non-admin roles only) */}
      {showFloatingTrigger && !open && (
        <button
          type="button"
          className="fb-fab"
          aria-label="التواصل والاقتراحات"
          title="التواصل والاقتراحات"
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
              <h3>التواصل والاقتراحات</h3>
              <p>{isManager ? "إدارة الرسائل والردود" : "أرسل ملاحظاتك للإدارة"}</p>
            </div>
            <button className="fb-close" onClick={() => setOpen(false)} aria-label="إغلاق"><X size={16} /></button>
          </div>

          {/* Admin tabs */}
          {isManager && (
            <div className="fb-tabs">
              <button
                className={`fb-tab${adminTab === "new" ? " active" : ""}`}
                onClick={() => setAdminTab("new")}
              >
                إرسال رسالة
              </button>
              <button
                className={`fb-tab${adminTab === "all" ? " active" : ""}`}
                onClick={() => setAdminTab("all")}
              >
                كل الرسائل {openCount > 0 && `(${openCount})`}
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
                  onClick={() => setFilter(f)}
                >
                  {f === "open" ? "مفتوحة" : f === "resolved" ? "مغلقة" : "الكل"}
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
                    <h4>تم الإرسال بنجاح</h4>
                    <p>سيتم مراجعة رسالتك من قبل الإدارة</p>
                    <button
                      className="fb-success-back"
                      onClick={() => setSubmitted(false)}
                    >
                      إرسال رسالة أخرى
                    </button>
                  </div>
                ) : (
                  <div className="fb-form">
                    <div>
                      <span className="fb-label">نوع الرسالة</span>
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
                      <label className="fb-label" htmlFor="fb-text">الرسالة</label>
                      <textarea
                        id="fb-text"
                        className="fb-textarea"
                        placeholder="اكتب رسالتك هنا..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                    <button
                      className="fb-submit-btn"
                      disabled={!text.trim() || submitting}
                      onClick={() => { void handleSubmit(); }}
                    >
                      {submitting ? "جاري الإرسال..." : "إرسال"}
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
                    <span className="fb-label">رسائلي السابقة</span>
                    <div className="fb-msg-list" style={{ marginTop: 8 }}>
                      {myMessages.map((msg) => (
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
                  </div>
                )}
              </>
            )}

            {/* ── Admin all-messages view ── */}
            {isManager && adminTab === "all" && (
              <>
                {loading ? (
                  <p className="fb-empty">جاري التحميل...</p>
                ) : filteredMessages.length === 0 ? (
                  <p className="fb-empty">لا توجد رسائل</p>
                ) : (
                  <div className="fb-msg-list">
                    {filteredMessages.map((msg) => (
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
          <span className="fb-msg-badge resolved-badge">مغلقة</span>
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
            placeholder="رد..."
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
              {isSending ? "..." : "رد"}
            </button>
            {isAdmin && onResolve && (
              <button className="fb-resolve-btn" onClick={onResolve} disabled={isSending}>
                إغلاق
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
