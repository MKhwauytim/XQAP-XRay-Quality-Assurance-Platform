import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../../../../../../hooks/useFocusTrap";
import RequestCard, { isReferral } from "./RequestCard";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import type { BulkOutcome } from "./useApprovalData";

type CardRequest = ReferralRequest | ReplacementRequest;
type SampleDetail = DistributionEntry | PreparedPopulationRow;

type Props = {
  requests: CardRequest[];
  bulkEnabled: boolean;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, SampleDetail>;
  canReview: boolean;
  onApprove: (request: CardRequest) => void;
  onDeny: (request: CardRequest) => void;
  onBulk: (requests: CardRequest[], action: "approve" | "deny", notes: string) => Promise<BulkOutcome[]>;
};

export default function RequestList({ requests, bulkEnabled, userDisplayMap, sampleDetails, canReview, onApprove, onDeny, onBulk }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "deny" | null>(null);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkOutcome[] | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // Focus-trap for the inline bulk-confirm modal (gated on bulkAction).
  const bulkDialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setBulkAction(null),
    enabled: bulkAction !== null,
  });

  // Bug #4: selection only makes sense on the pending queue — drop it whenever
  // the view switches to a decided (non-bulk) filter.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- selection only makes sense on the pending queue; sync reset when the view switches to a decided (non-bulk) filter
  useEffect(() => { setSelected(new Set()); }, [bulkEnabled]);

  const sorted = requests.slice().sort((a, b) =>
    bulkEnabled ? a.requestedAt.localeCompare(b.requestedAt) : b.requestedAt.localeCompare(a.requestedAt)
  );
  const selectedRequests = sorted.filter((r) => selected.has(r.requestId));

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function describeSelected(request: CardRequest): string {
    if (isReferral(request)) {
      return `${userDisplayMap[request.fromEmployee] ?? request.fromEmployee} ← ${userDisplayMap[request.toEmployee] ?? request.toEmployee}`;
    }
    return `${request.originalXrayImageId} → ${request.replacementXrayImageId}`;
  }

  async function confirmBulk(): Promise<void> {
    if (!bulkAction) return;
    setBulkRunning(true);
    const outcomes = await onBulk(selectedRequests, bulkAction, bulkNotes);
    setBulkRunning(false);
    setBulkResult(outcomes);
    setSelected(new Set());
    setBulkAction(null);
    setBulkNotes("");
  }

  return (
    <div className="ew-referral-list">
      {bulkEnabled && canReview && selected.size > 0 && (
        <div className="ew-bulk-bar">
          <span className="ew-bulk-bar-count">تم تحديد {selected.size} طلب</span>
          <button type="button" className="ew-btn-primary ew-btn-sm" onClick={() => setBulkAction("approve")}>موافقة على المحدد</button>
          <button type="button" className="ew-btn-deny ew-btn-sm" onClick={() => setBulkAction("deny")}>رفض المحدد</button>
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => setSelected(new Set())}>إلغاء التحديد</button>
        </div>
      )}

      {bulkResult && (
        <div className={bulkResult.every((o) => o.ok) ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {bulkResult.filter((o) => o.ok).length} نجحت، {bulkResult.filter((o) => !o.ok).length} فشلت
          {bulkResult.some((o) => !o.ok) && `: ${bulkResult.filter((o) => !o.ok).map((o) => o.error).join(" — ")}`}
          <button type="button" aria-label="إغلاق" style={{ float: "left", background: "none", border: "none", cursor: "pointer" }} onClick={() => setBulkResult(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {sorted.map((request) => (
        <RequestCard
          key={request.requestId}
          request={request}
          userDisplayMap={userDisplayMap}
          sampleDetails={sampleDetails}
          expanded={expandedId === request.requestId}
          onToggleExpand={() => setExpandedId((cur) => (cur === request.requestId ? null : request.requestId))}
          canReview={canReview}
          onApprove={() => onApprove(request)}
          onDeny={() => onDeny(request)}
          selectable={bulkEnabled && canReview && request.status === "pending"}
          selected={selected.has(request.requestId)}
          onToggleSelect={() => toggleSelect(request.requestId)}
        />
      ))}

      {bulkAction && (
        <div ref={bulkDialogRef} className="ew-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ew-replace-modal">
            <div className="ew-replace-header">
              <h3>{bulkAction === "approve" ? `تأكيد الموافقة على ${selectedRequests.length} طلب` : `تأكيد رفض ${selectedRequests.length} طلب`}</h3>
              <button type="button" className="ew-modal-close" onClick={() => setBulkAction(null)} aria-label="إغلاق"><X size={16} /></button>
            </div>
            <div className="ew-replace-reason">
              <ul style={{ margin: "0 0 8px", paddingInlineStart: 18 }}>
                {selectedRequests.map((r) => <li key={r.requestId}>{describeSelected(r)}</li>)}
              </ul>
              <label className="ew-field-label" htmlFor="bulk-notes">ملاحظة (اختياري، تُطبَّق على الكل)</label>
              <textarea id="bulk-notes" className="ew-input ew-textarea" rows={2} value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} />
            </div>
            <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
              <button type="button" className="ew-btn-secondary" onClick={() => setBulkAction(null)} disabled={bulkRunning}>إلغاء</button>
              <button
                type="button"
                className={bulkAction === "approve" ? "ew-btn-primary" : "ew-btn-deny"}
                onClick={() => void confirmBulk()}
                disabled={bulkRunning}
              >
                {bulkRunning ? "جارٍ التنفيذ…" : bulkAction === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
