import RequestTimeline from "./RequestTimeline";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import {
  isReferral,
  isReopen,
  isReplacement,
  requestKind,
  KIND_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_BADGE_LABEL,
  type CardRequest,
} from "./requestKind";

type SampleDetail = DistributionEntry | PreparedPopulationRow;

type Props = {
  request: CardRequest;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, SampleDetail>;
  expanded: boolean;
  onToggleExpand: () => void;
  canReview: boolean;
  onApprove: () => void;
  onDeny: () => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
};

function getDetailRow(detail: SampleDetail | undefined): PreparedPopulationRow | undefined {
  if (!detail) return undefined;
  return "row" in detail ? detail.row : detail;
}

function SampleDetailChip({ id, detail, prefix, tone = "neutral" }: {
  id: string; detail: SampleDetail | undefined; prefix?: string; tone?: "neutral" | "danger" | "success";
}) {
  const row = getDetailRow(detail);
  const bg = tone === "danger" ? "#fee2e2" : tone === "success" ? "#dcfce7" : "#f8fafc";
  const color = tone === "danger" ? "#7f1d1d" : tone === "success" ? "#14532d" : "#334155";
  return (
    <span className="ew-referral-id-chip" style={{ background: bg, color, display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      <span className="dt-mono">{prefix ? `${prefix}: ${id}` : id}</span>
      {row && (
        <span style={{ fontSize: 11, color }}>
          {[row.portName, row.stage, row.plateOrContainerNumber].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
}

export default function RequestCard(props: Props) {
  const { request, userDisplayMap, sampleDetails, expanded, onToggleExpand, canReview, onApprove, onDeny, selectable, selected, onToggleSelect } = props;
  const showActions = canReview && request.status === "pending";
  const kind = requestKind(request);
  const name = (u: string) => userDisplayMap[u] ?? u;

  return (
    <article className={`ew-referral-card${selected ? " ew-referral-card--selected" : ""}`}>
      <div className="ew-referral-card-header">
        {selectable && (
          <input
            type="checkbox"
            className="ew-request-checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label="تحديد الطلب"
          />
        )}
        <div className="ew-referral-card-meta">
          {isReferral(request) ? (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp">{name(request.fromEmployee)}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp">{name(request.toEmployee)}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>{request.xrayImageIds.length} عينة</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          ) : isReplacement(request) ? (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>أصلي</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.originalXrayImageId}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>بديل</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.replacementXrayImageId}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>موظف: {name(request.employeeUsername)}</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp">{name(request.employeeUsername)}</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.xrayImageId}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>إعادة فتح الحالة للتصحيح</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          )}
          <p className="ew-referral-reason">السبب: {request.reason}</p>
          <RequestTimeline requestedAt={request.requestedAt} requestedBy={request.requestedBy} history={request.history} userDisplayMap={userDisplayMap} />
        </div>
        <div className="ew-referral-card-actions">
          <span className={`ew-req-kind-badge ew-req-kind-${kind}`}>{KIND_LABELS[kind]}</span>
          <span className={`ew-ref-badge ${STATUS_BADGE_CLASS[request.status]}`}>{STATUS_BADGE_LABEL[request.status]}</span>
          {showActions && (
            <>
              <button type="button" className="ew-btn-primary ew-btn-sm" onClick={onApprove}>موافقة</button>
              <button type="button" className="ew-btn-deny ew-btn-sm" onClick={onDeny}>رفض</button>
            </>
          )}
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onToggleExpand}>
            {expanded ? "إخفاء العينات" : "عرض العينات"}
          </button>
        </div>
      </div>
      {expanded && isReferral(request) && (
        <div className="ew-referral-ids-list">
          {request.xrayImageIds.map((id) => (
            <SampleDetailChip key={id} id={id} detail={sampleDetails[id]} />
          ))}
        </div>
      )}
      {expanded && isReplacement(request) && (
        <div className="ew-referral-ids-list" style={{ flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SampleDetailChip id={request.originalXrayImageId} detail={sampleDetails[request.originalXrayImageId]} prefix="أصلي" tone="danger" />
            <SampleDetailChip
              id={request.replacementXrayImageId}
              detail={sampleDetails[request.replacementXrayImageId] ?? (request.replacementRowData as PreparedPopulationRow | undefined)}
              prefix="بديل" tone="success"
            />
          </div>
        </div>
      )}
      {expanded && isReopen(request) && (
        <div className="ew-referral-ids-list">
          <SampleDetailChip id={request.xrayImageId} detail={sampleDetails[request.xrayImageId]} />
        </div>
      )}
    </article>
  );
}
