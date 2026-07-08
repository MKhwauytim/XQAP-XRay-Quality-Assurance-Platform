import { useState } from "react";
import { CalendarOff, X } from "lucide-react";
import { PageHeader } from "../../../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { isReferral } from "./RequestCard";
import RequestList from "./RequestList";
import ReviewModal from "./ReviewModal";
import HistoryView from "./HistoryView";
import SummaryBar from "./SummaryBar";
import { useApprovalData } from "./useApprovalData";

type StatusMsg = { type: "ok" | "error"; text: string } | null;
type RequestSection = "referral" | "replacement";
type ViewTab = "review" | "history";
type StatusFilter = "all" | "pending" | "approved" | "denied";
type CardRequest = ReferralRequest | ReplacementRequest;
type ReviewDialog = { request: CardRequest; action: "approve" | "deny" } | null;

type Props = { directoryHandle: DirectoryHandleLike };

export default function ReferralApproval({ directoryHandle }: Props) {
  const {
    username, canApproveReferrals, canApproveReplacements,
    userDisplayMap, months, selMonth, setSelMonth,
    referrals, replacements, sampleDetails, loadState, reload,
    approveReferral, denyReferral, approveReplacement, denyReplacement,
    bulkReferralDecision, bulkReplacementDecision,
  } = useApprovalData(directoryHandle);

  const canReview = canApproveReferrals || canApproveReplacements;

  const [view, setView] = useState<ViewTab>("review");
  const [section, setSection] = useState<RequestSection>("referral");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [statusMsg, setStatusMsg] = useState<StatusMsg>(null);
  const [dialog, setDialog] = useState<ReviewDialog>(null);

  function switchSection(next: RequestSection): void {
    setSection(next);
    setStatusFilter("pending");
    setStatusMsg(null);
  }

  const requestsForSection = section === "referral" ? referrals : replacements;
  const counts: Record<StatusFilter, number> = {
    all: requestsForSection.length,
    pending: requestsForSection.filter((r) => r.status === "pending").length,
    approved: requestsForSection.filter((r) => r.status === "approved").length,
    denied: requestsForSection.filter((r) => r.status === "denied").length,
  };
  const filtered = requestsForSection.filter((r) => statusFilter === "all" || r.status === statusFilter);

  async function handleApprove(request: CardRequest, notes: string): Promise<void> {
    const result = isReferral(request) ? await approveReferral(request, notes) : await approveReplacement(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تمت الموافقة على الطلب." } : { type: "error", text: result.error });
  }

  async function handleDeny(request: CardRequest, notes: string): Promise<void> {
    const result = isReferral(request) ? await denyReferral(request, notes) : await denyReplacement(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تم رفض الطلب." } : { type: "error", text: result.error });
  }

  async function handleBulk(requests: CardRequest[], action: "approve" | "deny", notes: string) {
    const outcomes = section === "referral"
      ? await bulkReferralDecision(requests as ReferralRequest[], action, notes)
      : await bulkReplacementDecision(requests as ReplacementRequest[], action, notes);
    const failed = outcomes.filter((o) => !o.ok).length;
    setStatusMsg(failed === 0
      ? { type: "ok", text: `تمت معالجة ${outcomes.length} طلب بنجاح.` }
      : { type: "error", text: `نجح ${outcomes.length - failed} من ${outcomes.length}. فشل ${failed}.` });
    return outcomes;
  }

  function describeDialog(request: CardRequest, action: "approve" | "deny"): string {
    const name = (u: string) => userDisplayMap[u] ?? u;
    if (isReferral(request)) {
      return action === "approve"
        ? `ستتم إحالة ${request.xrayImageIds.length} عينة من ${name(request.fromEmployee)} إلى ${name(request.toEmployee)} بشكل دائم.`
        : `سيتم رفض الطلب وستبقى العينات مع ${name(request.fromEmployee)}.`;
    }
    return action === "approve"
      ? `سيتم استبدال ${request.originalXrayImageId} بـ ${request.replacementXrayImageId} للموظف ${name(request.employeeUsername)}.`
      : `سيتم رفض الطلب وتبقى العينة الأصلية ${request.originalXrayImageId} مع الموظف.`;
  }

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Request Approval"
        title="اعتماد الطلبات"
        subtitle={canReview ? "مراجعة طلبات الإحالة والاستبدال." : "الطلبات التي أرسلتها."}
      />

      <div className="ew-approval-view-tabs">
        <button type="button" className={`ew-approval-view-tab${view === "review" ? " active" : ""}`} onClick={() => setView("review")}>المراجعة</button>
        <button type="button" className={`ew-approval-view-tab${view === "history" ? " active" : ""}`} onClick={() => setView("history")}>السجل</button>
      </div>

      {statusMsg && (
        <div className={statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {statusMsg.text}
          <button type="button" style={{ float: "left", background: "none", border: "none", cursor: "pointer" }} onClick={() => setStatusMsg(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === "history" ? (
        <HistoryView
          directoryHandle={directoryHandle}
          username={username}
          canApproveReferrals={canApproveReferrals}
          canApproveReplacements={canApproveReplacements}
          userDisplayMap={userDisplayMap}
        />
      ) : (
        <>
          <div className="ew-referral-toolbar">
            <label className="ew-label" htmlFor="ra-month">
              الشهر
              <select id="ra-month" className="ew-select" value={selMonth} onChange={(e) => setSelMonth(e.target.value)}>
                {months.map((m) => <option key={m.folderName} value={m.folderName}>{m.folderName}</option>)}
              </select>
            </label>

            <div className="ew-referral-status-tabs" style={{ gap: 4 }}>
              <button type="button" className={`ew-referral-status-tab${section === "referral" ? " active" : ""}`} onClick={() => switchSection("referral")}>
                الإحالة{referrals.length > 0 && <span className="ew-status-count">{referrals.length}</span>}
              </button>
              <button type="button" className={`ew-referral-status-tab${section === "replacement" ? " active" : ""}`} onClick={() => switchSection("replacement")}>
                الاستبدال{replacements.length > 0 && <span className="ew-status-count">{replacements.length}</span>}
              </button>
            </div>

            <SummaryBar counts={counts} active={statusFilter} onSelect={setStatusFilter} />
          </div>

          {loadState === "loading" && <LoadingState />}
          {loadState === "error" && (
            <ErrorState
              description="تعذر تحميل بيانات الطلبات. أعد المحاولة أو تحقق من مساحة العمل."
              actions={<button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => void reload()}>إعادة المحاولة</button>}
            />
          )}

          {loadState === "ready" && months.length === 0 && (
            <EmptyState icon={<CalendarOff />} title="لا توجد أشهر معالجة بعد"
              description="اعتماد الطلبات يعتمد على شهر معالج — ابدأ بمعالجة شهر من تبويب معالجة المجتمع." />
          )}

          {loadState === "ready" && months.length > 0 && filtered.length === 0 && (
            <EmptyState title={`لا توجد طلبات ${section === "referral" ? "إحالة" : "استبدال"} لهذا التصنيف`}
              description="ستظهر الطلبات هنا فور إرسالها من مساحة عمل الموظفين." />
          )}

          {loadState === "ready" && filtered.length > 0 && (
            <RequestList
              requests={filtered}
              bulkEnabled={statusFilter === "pending"}
              userDisplayMap={userDisplayMap}
              sampleDetails={sampleDetails}
              canReview={section === "referral" ? canApproveReferrals : canApproveReplacements}
              onApprove={(request) => setDialog({ request, action: "approve" })}
              onDeny={(request) => setDialog({ request, action: "deny" })}
              onBulk={handleBulk}
            />
          )}
        </>
      )}

      {dialog && (
        <ReviewModal
          title={dialog.action === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
          description={describeDialog(dialog.request, dialog.action)}
          isApprove={dialog.action === "approve"}
          onClose={() => setDialog(null)}
          onConfirm={(notes) => void (dialog.action === "approve" ? handleApprove(dialog.request, notes) : handleDeny(dialog.request, notes))}
        />
      )}
    </section>
  );
}
