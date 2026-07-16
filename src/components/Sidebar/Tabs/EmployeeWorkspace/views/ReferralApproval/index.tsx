import { useState } from "react";
import { CalendarOff, X } from "lucide-react";
import { PageHeader } from "../../../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { isReferral, isReplacement, type CardRequest } from "./requestKind";
import RequestList from "./RequestList";
import ReviewModal from "./ReviewModal";
import HistoryView from "./HistoryView";
import SummaryBar from "./SummaryBar";
import { useApprovalData } from "./useApprovalData";

type StatusMsg = { type: "ok" | "error"; text: string } | null;
type ViewTab = "review" | "history";
type StatusFilter = "all" | "pending" | "approved" | "denied";
type ReviewDialog = { request: CardRequest; action: "approve" | "deny" } | null;

type Props = { directoryHandle: DirectoryHandleLike };

export default function ReferralApproval({ directoryHandle }: Props) {
  const {
    username, canApproveReferrals, canApproveReplacements, canApproveReopens,
    userDisplayMap, months,
    requests, sampleDetails, loadState, reload,
    approve, deny, canReviewRequest, bulkDecision,
  } = useApprovalData(directoryHandle);

  const canReview = canApproveReferrals || canApproveReplacements || canApproveReopens;

  const [view, setView] = useState<ViewTab>("review");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [statusMsg, setStatusMsg] = useState<StatusMsg>(null);
  const [dialog, setDialog] = useState<ReviewDialog>(null);

  const counts: Record<StatusFilter, number> = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    denied: requests.filter((r) => r.status === "denied").length,
  };
  const filtered = requests.filter((r) => statusFilter === "all" || r.status === statusFilter);

  async function handleApprove(request: CardRequest, notes: string): Promise<void> {
    const result = await approve(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تمت الموافقة على الطلب." } : { type: "error", text: result.error });
  }

  async function handleDeny(request: CardRequest, notes: string): Promise<void> {
    const result = await deny(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تم رفض الطلب." } : { type: "error", text: result.error });
  }

  async function handleBulk(selected: CardRequest[], action: "approve" | "deny", notes: string) {
    return bulkDecision(selected, action, notes);
  }

  function describeDialog(request: CardRequest, action: "approve" | "deny"): string {
    const name = (u: string) => userDisplayMap[u] ?? u;
    if (isReferral(request)) {
      return action === "approve"
        ? `ستتم إحالة ${request.xrayImageIds.length} عينة من ${name(request.fromEmployee)} إلى ${name(request.toEmployee)} بشكل دائم.`
        : `سيتم رفض الطلب وستبقى العينات مع ${name(request.fromEmployee)}.`;
    }
    if (isReplacement(request)) {
      return action === "approve"
        ? `سيتم استبدال ${request.originalXrayImageId} بـ ${request.replacementXrayImageId} للموظف ${name(request.employeeUsername)}.`
        : `سيتم رفض الطلب وتبقى العينة الأصلية ${request.originalXrayImageId} مع الموظف.`;
    }
    return action === "approve"
      ? `ستتم إعادة فتح الحالة ${request.xrayImageId} للموظف ${name(request.employeeUsername)} ليتمكن من تصحيح إجابته.`
      : `سيتم رفض طلب إعادة فتح الحالة ${request.xrayImageId} وتبقى الإجابة مقدمة كما هي.`;
  }

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Request Approval"
        title="اعتماد الطلبات"
        subtitle={canReview ? "مراجعة طلبات الإحالة والاستبدال وإعادة فتح الحالة." : "الطلبات التي أرسلتها."}
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
          canApproveReopens={canApproveReopens}
          userDisplayMap={userDisplayMap}
        />
      ) : (
        <>
          <div className="ew-referral-toolbar">
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
            <EmptyState title="لا توجد طلبات لهذا التصنيف"
              description="ستظهر طلبات الإحالة والاستبدال وإعادة فتح الحالة هنا فور إرسالها من مساحة عمل الموظفين." />
          )}

          {loadState === "ready" && filtered.length > 0 && (
            <RequestList
              requests={filtered}
              bulkEnabled={statusFilter === "pending"}
              userDisplayMap={userDisplayMap}
              sampleDetails={sampleDetails}
              canReview={canReviewRequest}
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
