import { ArrowDownUp, Inbox, User } from "lucide-react";
import { useLabels } from "../../../../../../data/labels/useLabels";
import Pagination from "../../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../../utils/paginationUtils";
import {
  KIND_LABELS,
  STATUS_BADGE_LABEL,
  requestKind,
  type CardRequest,
} from "./requestKind";
import { formatDate, requestTitle, sampleSummary, waitBadge } from "./requestPresentation";

type Props = {
  requests: CardRequest[];
  userDisplayMap: Record<string, string>;
  selectedId: string | null;
  onSelect: (request: CardRequest) => void;
  /** Oldest-first on the pending queue so nothing waits unseen; newest-first elsewhere. */
  oldestFirst: boolean;
  selectable: (request: CardRequest) => boolean;
  checked: Set<string>;
  onToggleCheck: (requestId: string) => void;
  page: number;
  onPageChange: (page: number) => void;
};

export default function RequestQueue(props: Props) {
  const { requests, userDisplayMap, selectedId, onSelect, oldestFirst, selectable, checked, onToggleCheck } = props;
  const L = useLabels();
  const displayName = (username: string) => userDisplayMap[username] ?? username;

  const page = clampPage(props.page, requests.length);
  const paged = pageSlice(requests, page);

  return (
    <div className="ew-approval-queue">
      <div className="ew-sort-indicator">
        <ArrowDownUp size={13} aria-hidden />
        <span>{oldestFirst ? L.approval_sort_oldest_first : L.approval_sort_newest_first}</span>
        <span className="ew-approval-queue-count">
          {L.approval_queue_count.replace("{count}", String(requests.length))}
        </span>
      </div>

      {requests.length === 0 && (
        <div className="ew-approval-queue-empty">
          <span className="ew-approval-queue-empty-icon" aria-hidden>
            <Inbox size={26} />
          </span>
          <h3>لا توجد طلبات لهذا التصنيف</h3>
          <p>ستظهر طلبات الإحالة والاستبدال وإعادة فتح الحالة هنا فور إرسالها من مساحة عمل الموظفين.</p>
        </div>
      )}

      {paged.map((request) => {
        const kind = requestKind(request);
        const wait = waitBadge(request.requestedAt);
        const decided = request.status !== "pending";
        const canCheck = selectable(request);
        return (
          <article
            key={request.requestId}
            className={`ew-approval-qcard${selectedId === request.requestId ? " selected" : ""}`}
            onClick={() => onSelect(request)}
            /* The card is the selection target; the checkbox inside it keeps its
               own handler and stops propagation so ticking never also re-selects. */
            role="button"
            tabIndex={0}
            aria-pressed={selectedId === request.requestId}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(request);
              }
            }}
          >
            {canCheck && (
              <input
                type="checkbox"
                className="ew-request-checkbox"
                checked={checked.has(request.requestId)}
                onChange={() => onToggleCheck(request.requestId)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`تحديد الطلب ${requestTitle(request, displayName)}`}
              />
            )}
            <div className="ew-approval-qcard-body">
              <div className="ew-approval-qcard-top">
                <span className={`ew-req-kind-badge ew-req-kind-${kind}`}>{KIND_LABELS[kind]}</span>
                <span className={`ew-approval-wait ew-approval-wait--${wait.tone}`}>{wait.label}</span>
                <span className="ew-approval-qcard-date">{formatDate(request.requestedAt)}</span>
              </div>
              <div className="ew-approval-qcard-title">{requestTitle(request, displayName)}</div>
              <div className="ew-approval-qcard-sub">
                <User size={12} aria-hidden />
                <span>{displayName(request.requestedBy)}</span>
                <span>·</span>
                <span>{sampleSummary(request)}</span>
              </div>
              <div className="ew-approval-qcard-reason">{request.reason}</div>
              {decided && (
                <div className={`ew-approval-qcard-decided ew-approval-qcard-decided--${request.status}`}>
                  <span className="ew-approval-decided-dot" aria-hidden />
                  <span>
                    {STATUS_BADGE_LABEL[request.status]}
                    {request.reviewedBy ? ` — ${displayName(request.reviewedBy)}` : ""}
                  </span>
                </div>
              )}
            </div>
          </article>
        );
      })}

      <Pagination
        page={page}
        totalItems={requests.length}
        onPageChange={props.onPageChange}
        itemLabel="طلب"
      />
    </div>
  );
}
