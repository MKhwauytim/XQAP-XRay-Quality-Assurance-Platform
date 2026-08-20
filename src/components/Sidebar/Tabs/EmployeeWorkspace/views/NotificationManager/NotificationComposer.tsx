import { Check, Eye, Megaphone, Pin, Send } from "lucide-react";
import { useLabels } from "../../../../../../data/labels/useLabels";
import type { NotificationTarget } from "../../../../../../data/notifications/notificationTypes";
import {
  TARGET_ORDER,
  previewAudience,
  roleLabel,
  targetLabel,
  type AudienceUser,
} from "./notificationPresentation";

type Props = {
  message: string;
  onMessageChange: (message: string) => void;
  target: NotificationTarget;
  onTargetChange: (target: NotificationTarget) => void;
  picked: string[];
  onTogglePicked: (username: string) => void;
  audienceUsers: AudienceUser[];
  previewOpen: boolean;
  onTogglePreview: () => void;
  editing: boolean;
  onCancelEdit: () => void;
  onSubmit: () => void;
  busy: boolean;
  canPost: boolean;
  status: { type: "ok" | "error"; text: string } | null;
};

export default function NotificationComposer(props: Props) {
  const { message, target, picked, audienceUsers, previewOpen, editing, busy, canPost, status } = props;
  const L = useLabels();

  const reach = previewAudience(target, picked, audienceUsers);
  const audienceText = L.notif_audience_count.replace("{count}", String(reach.length));
  const submitDisabled = busy || message.trim().length === 0 || !canPost;

  return (
    <div className="ntf-post-card">
      <div className="ntf-post-head">
        <span className="ntf-card-icon" aria-hidden><Megaphone size={15} /></span>
        <label className="ntf-post-label" htmlFor="ntf-post-input">
          {editing ? L.notif_edit_title : L.notif_compose_title}
        </label>
        {editing && (
          <button type="button" className="ntf-post-cancel" onClick={props.onCancelEdit}>
            {L.notif_edit_cancel}
          </button>
        )}
      </div>

      <textarea
        id="ntf-post-input"
        className="ntf-post-input"
        value={message}
        onChange={(event) => props.onMessageChange(event.target.value)}
        placeholder={L.notif_mgr_post_placeholder}
        rows={3}
        dir="rtl"
        disabled={busy}
      />

      <div className="ntf-target-row">
        <span className="ntf-target-label">{L.notif_target_label}</span>
        <div className="ntf-target-group" role="tablist" aria-label={L.notif_target_label}>
          {TARGET_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={target === option}
              className={`ntf-target-chip${target === option ? " active" : ""}`}
              onClick={() => props.onTargetChange(option)}
            >
              {targetLabel(option)}
            </button>
          ))}
        </div>
        <span className="ntf-audience-count">{audienceText}</span>
      </div>

      {target === "custom" && (
        <div className="ntf-picker">
          {audienceUsers.length === 0 ? (
            <p className="ntf-audience-empty">{L.notif_mgr_audience_none}</p>
          ) : (
            audienceUsers.map((user) => (
              <button
                key={user.username}
                type="button"
                aria-pressed={picked.includes(user.username)}
                className={`ntf-picker-chip${picked.includes(user.username) ? " active" : ""}`}
                onClick={() => props.onTogglePicked(user.username)}
              >
                {user.displayName || user.username}
                <span className="ntf-picker-role">{roleLabel(user.role)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {previewOpen && (
        <div className="ntf-preview">
          <p className="ntf-preview-label">{L.notif_preview_title}</p>
          {/* Deliberately a static replica of NotificationBanner rather than the
              component itself: the banner reads the session and writes an
              acknowledgement on click, neither of which a preview may do. */}
          <div className="ntf-preview-banner">
            <span className="ntf-card-icon" aria-hidden><Pin size={15} /></span>
            <span className="ntf-preview-text">{message}</span>
            <span className="ntf-preview-accept" aria-hidden>
              <Check size={14} />
              {L.notif_accept_btn}
            </span>
          </div>
          <p className="ntf-preview-audience">{audienceText}</p>
        </div>
      )}

      <div className="ntf-post-actions">
        {status && (
          <span className={`ntf-post-status ntf-post-status--${status.type}`}>{status.text}</span>
        )}
        <button type="button" className="ntf-preview-btn" onClick={props.onTogglePreview}>
          <Eye size={15} aria-hidden />
          {previewOpen ? L.notif_preview_hide : L.notif_preview_show}
        </button>
        <button
          type="button"
          className="ntf-post-btn"
          onClick={props.onSubmit}
          disabled={submitDisabled}
          title={!canPost ? "يتطلب النشر صلاحية التعديل ومساحة عمل قابلة للكتابة." : undefined}
        >
          <Send size={15} aria-hidden />
          {busy ? L.notif_mgr_posting : editing ? L.notif_edit_save : L.notif_mgr_post_btn}
        </button>
      </div>
    </div>
  );
}
