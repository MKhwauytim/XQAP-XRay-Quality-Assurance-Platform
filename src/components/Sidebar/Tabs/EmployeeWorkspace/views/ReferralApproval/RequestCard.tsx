import RequestTimeline from "./RequestTimeline";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";

type CardRequest = ReferralRequest | ReplacementRequest;
type SampleDetail = DistributionEntry | PreparedPopulationRow;

// eslint-disable-next-line react-refresh/only-export-components -- type-guard export, not a component; imported elsewhere to discriminate referral vs. replacement requests
export function isReferral(request: CardRequest): request is ReferralRequest {
  return "toEmployee" in request;
}

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

const STATUS_LABELS: Record<string, string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
const STATUS_CLASSES: Record<string, string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };

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
  const referral = isReferral(request);

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
          {referral ? (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp">{userDisplayMap[request.fromEmployee] ?? request.fromEmployee}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp">{userDisplayMap[request.toEmployee] ?? request.toEmployee}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>{request.xrayImageIds.length} عينة</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>أصلي</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.originalXrayImageId}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>بديل</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.replacementXrayImageId}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>موظف: {userDisplayMap[request.employeeUsername] ?? request.employeeUsername}</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          )}
          <p className="ew-referral-reason">السبب: {request.reason}</p>
          <RequestTimeline requestedAt={request.requestedAt} requestedBy={request.requestedBy} history={request.history} userDisplayMap={userDisplayMap} />
        </div>
        <div className="ew-referral-card-actions">
          <span className={`ew-ref-badge ${STATUS_CLASSES[request.status] ?? ""}`}>{STATUS_LABELS[request.status] ?? request.status}</span>
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
      {expanded && referral && (
        <div className="ew-referral-ids-list">
          {request.xrayImageIds.map((id) => (
            <SampleDetailChip key={id} id={id} detail={sampleDetails[id]} />
          ))}
        </div>
      )}
      {expanded && !referral && (
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
    </article>
  );
}
