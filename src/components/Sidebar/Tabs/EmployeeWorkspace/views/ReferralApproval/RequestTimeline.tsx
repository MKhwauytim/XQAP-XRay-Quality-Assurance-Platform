import type { DecisionEvent } from "../../../../../../data/approvals/approvalTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";

type Props = {
  requestedAt: string;
  requestedBy: string;
  history: DecisionEvent[] | undefined;
  userDisplayMap: Record<string, string>;
};

function statusLabel(status: DecisionEvent["status"]): string {
  if (status === "approved") return "تمت الموافقة";
  if (status === "denied") return "تم الرفض";
  // An undo appends a revocation rather than removing the decision it takes
  // back, so both entries stay on the trail — the revocation is what explains
  // why an approved request is sitting in the pending queue again.
  return getLabels().approval_timeline_reverted;
}

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function RequestTimeline({ requestedAt, requestedBy, history, userDisplayMap }: Props) {
  const displayName = (u: string) => userDisplayMap[u] ?? u;
  return (
    <ol className="ew-timeline">
      <li className="ew-timeline-item">
        <span className="ew-timeline-dot" />
        <div className="ew-timeline-body">
          <span className="ew-timeline-meta">أُرسل الطلب — {displayName(requestedBy)} · {formatAt(requestedAt)}</span>
        </div>
      </li>
      {(history ?? []).map((event, i) => (
        <li key={`${event.reviewedAt}-${i}`} className={`ew-timeline-item ew-timeline-item--${event.status}`}>
          <span className="ew-timeline-dot" />
          <div className="ew-timeline-body">
            <span className="ew-timeline-meta">
              {statusLabel(event.status)} — {displayName(event.reviewedBy)} · {formatAt(event.reviewedAt)}
            </span>
            {event.reviewNotes && <p className="ew-timeline-note">{event.reviewNotes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
