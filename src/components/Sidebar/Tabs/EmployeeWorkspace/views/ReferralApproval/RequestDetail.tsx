import { Check, X } from "lucide-react";
import { useLabels } from "../../../../../../data/labels/useLabels";
import RequestTimeline from "./RequestTimeline";
import {
  KIND_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_BADGE_LABEL,
  requestKind,
  type CardRequest,
} from "./requestKind";
import {
  affectedEmployee,
  detailSampleRows,
  formatDate,
  formatDateTime,
  requestTitle,
  waitBadge,
  type SampleDetailMap,
} from "./requestPresentation";

type Props = {
  request: CardRequest;
  userDisplayMap: Record<string, string>;
  sampleDetails: SampleDetailMap;
  /** Whether this reviewer may still decide this request (capability + pending). */
  actionable: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
};

export default function RequestDetail(props: Props) {
  const { request, userDisplayMap, sampleDetails, actionable, note, onNoteChange, busy } = props;
  const L = useLabels();
  const displayName = (username: string) => userDisplayMap[username] ?? username;

  const kind = requestKind(request);
  const wait = waitBadge(request.requestedAt);
  const rows = detailSampleRows(request, sampleDetails);

  return (
    <div className="ew-approval-detail">
      <div className="ew-approval-detail-head">
        <div className="ew-approval-detail-headings">
          <div className="ew-approval-detail-badges">
            <span className={`ew-req-kind-badge ew-req-kind-${kind}`}>{KIND_LABELS[kind]}</span>
            <span className={`ew-ref-badge ${STATUS_BADGE_CLASS[request.status]}`}>
              {STATUS_BADGE_LABEL[request.status]}
            </span>
            <span className={`ew-approval-wait ew-approval-wait--${wait.tone}`}>{wait.label}</span>
          </div>
          <h2 className="ew-approval-detail-title">{requestTitle(request, displayName)}</h2>
          <p className="ew-approval-detail-meta">
            {L.approval_detail_requested_by
              .replace("{name}", displayName(request.requestedBy))
              .replace("{date}", formatDateTime(request.requestedAt))}
          </p>
        </div>
        {actionable && (
          <div className="ew-approval-detail-actions">
            <button type="button" className="ew-btn-primary ew-approval-decide" onClick={props.onApprove} disabled={busy}>
              <Check size={15} aria-hidden />
              {L.approval_approve}
            </button>
            <button type="button" className="ew-btn-deny ew-approval-decide" onClick={props.onDeny} disabled={busy}>
              <X size={15} aria-hidden />
              {L.approval_deny}
            </button>
          </div>
        )}
      </div>

      <div className="ew-approval-detail-body">
        <section>
          <p className="ew-approval-section-label">{L.approval_detail_samples}</p>
          {/* Identifiers must never wrap mid-token, so the table keeps real
              minimum column widths and scrolls horizontally inside its own
              container instead of compressing the cells. */}
          <div className="ew-approval-table">
            <div className="ew-approval-table-head">
              <span>{L.approval_col_image_id}</span>
              <span>{L.approval_col_port}</span>
              <span>{L.approval_col_stage}</span>
              <span>{L.approval_col_plate}</span>
            </div>
            {rows.map((row) => (
              <div key={`${row.role ?? ""}-${row.xrayImageId}`} className="ew-approval-table-row">
                <span className="ew-approval-table-id">
                  {row.role && <span className={`ew-approval-role ew-approval-role--${row.roleTone}`}>{row.role}</span>}
                  <strong className="dt-mono">{row.xrayImageId}</strong>
                </span>
                <span>{row.portName}</span>
                <span>{row.stage}</span>
                <span className="dt-mono">{row.plate}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="ew-approval-detail-cards">
          <div className="ew-approval-detail-card">
            <p>{L.approval_card_request_date}</p>
            <strong>{formatDate(request.requestedAt)}</strong>
          </div>
          <div className="ew-approval-detail-card">
            <p>{L.approval_card_wait}</p>
            <strong className={`ew-approval-wait-text ew-approval-wait-text--${wait.tone}`}>{wait.label}</strong>
          </div>
          <div className="ew-approval-detail-card">
            <p>{L.approval_card_employee}</p>
            <strong>{displayName(affectedEmployee(request))}</strong>
          </div>
        </div>

        <section>
          <p className="ew-approval-section-label">{L.approval_detail_reason}</p>
          <p className="ew-approval-reason">{request.reason}</p>
        </section>

        <section>
          <p className="ew-approval-section-label">{L.approval_detail_timeline}</p>
          <RequestTimeline
            requestedAt={request.requestedAt}
            requestedBy={request.requestedBy}
            history={request.history}
            userDisplayMap={userDisplayMap}
          />
        </section>

        {actionable && (
          <div className="ew-approval-note">
            <label className="ew-field-label" htmlFor="approval-note">
              {L.approval_note_label}
            </label>
            <textarea
              id="approval-note"
              className="ew-input ew-textarea"
              rows={2}
              placeholder={L.approval_note_placeholder}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
