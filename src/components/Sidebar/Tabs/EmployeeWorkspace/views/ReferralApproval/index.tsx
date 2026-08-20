import { useEffect, useRef, useState } from "react";
import { CalendarOff, Clock, Undo2, X } from "lucide-react";
import { PageHeader } from "../../../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { useLabels } from "../../../../../../data/labels/useLabels";
import { undoAvailability } from "../../../../../../data/referral/undoDecision";
import { KIND_LABELS, requestKind, type CardRequest, type RequestKind } from "./requestKind";
import { waitingDays } from "./requestPresentation";
import RequestQueue from "./RequestQueue";
import RequestDetail from "./RequestDetail";
import HistoryView from "./HistoryView";
import SummaryBar from "./SummaryBar";
import { useApprovalData, type BulkOutcome } from "./useApprovalData";

type StatusMsg = { type: "ok" | "error"; text: string } | null;
type ViewTab = "review" | "history";
type StatusFilter = "all" | "pending" | "approved" | "denied";
type KindFilter = "all" | RequestKind;

/** How long the decision toast — and with it the undo affordance — stays up. */
const TOAST_MS = 12_000;

type Toast = {
  /** Identity, so a replacement toast restarts the dismiss timer. */
  id: number;
  text: string;
  status: "approved" | "denied";
  /** The decided requests whose decision can still be taken back. Empty when the
   *  decision is one the domain cannot reverse (an approved replacement or
   *  reopen) — the toast then reports the outcome without offering undo. */
  undoable: CardRequest[];
  /** Why undo is not offered, when it is not. */
  blockedReason?: string;
};

const KIND_ORDER: KindFilter[] = ["all", "referral", "replacement", "reopen"];

type Props = { directoryHandle: DirectoryHandleLike };

export default function ReferralApproval({ directoryHandle }: Props) {
  const {
    username, canApproveReferrals, canApproveReplacements, canApproveReopens,
    userDisplayMap, months,
    requests, sampleDetails, loadState, reload,
    approve, deny, canReviewRequest, bulkDecision, undoDecisions,
  } = useApprovalData(directoryHandle);

  const L = useLabels();
  const canReview = canApproveReferrals || canApproveReplacements || canApproveReopens;

  const [view, setView] = useState<ViewTab>("review");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [statusMsg, setStatusMsg] = useState<StatusMsg>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  // Closes the same-render double-click window before React commits `busy` —
  // slow filesystem writes must not be able to record two decisions.
  const busyRef = useRef(false);
  const toastSeq = useRef(0);

  const counts: Record<StatusFilter, number> = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    denied: requests.filter((r) => r.status === "denied").length,
  };

  const pendingOnly = statusFilter === "pending";
  const filtered = requests
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) => kindFilter === "all" || requestKind(r) === kindFilter)
    .slice()
    .sort((a, b) =>
      pendingOnly ? a.requestedAt.localeCompare(b.requestedAt) : b.requestedAt.localeCompare(a.requestedAt)
    );

  // Derived rather than stateful: the selection follows the filtered queue, so a
  // filter change or a background refresh that drops the selected request falls
  // back to the head of the queue instead of leaving an empty detail pane.
  const selected = filtered.find((r) => r.requestId === selectedId) ?? filtered[0] ?? null;

  const oldestPendingDays = requests
    .filter((r) => r.status === "pending")
    .reduce((oldest, r) => Math.max(oldest, waitingDays(r.requestedAt)), 0);

  const selectable = (request: CardRequest) =>
    pendingOnly && request.status === "pending" && canReviewRequest(request);
  const checkedRequests = filtered.filter((r) => checked.has(r.requestId) && selectable(r));

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Selection only makes sense on the pending queue; drop it whenever the view
  // switches to a decided (non-bulk) filter or another kind.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset of a selection that cannot survive the filter change
  useEffect(() => { setChecked(new Set()); setPage(1); }, [statusFilter, kindFilter, view]);

  function toastFor(decided: CardRequest[], status: "approved" | "denied"): Toast {
    const many = decided.length > 1;
    const text = status === "approved"
      ? (many ? L.approval_toast_approved_many.replace("{count}", String(decided.length)) : L.approval_toast_approved_one)
      : (many ? L.approval_toast_denied_many.replace("{count}", String(decided.length)) : L.approval_toast_denied_one);
    const undoable = decided.filter((request) => undoAvailability(requestKind(request), status).undoable);
    const blocked = decided.find((request) => !undoAvailability(requestKind(request), status).undoable);
    const blockedAvailability = blocked ? undoAvailability(requestKind(blocked), status) : undefined;
    return {
      id: ++toastSeq.current,
      text,
      status,
      undoable,
      blockedReason:
        blockedAvailability && !blockedAvailability.undoable ? blockedAvailability.reason : undefined,
    };
  }

  async function runDecision(targets: CardRequest[], action: "approve" | "deny"): Promise<void> {
    if (busyRef.current || targets.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setStatusMsg(null);
    try {
      let outcomes: BulkOutcome[];
      if (targets.length === 1) {
        const single = targets[0];
        const result = action === "approve" ? await approve(single, note) : await deny(single, note);
        outcomes = [{
          requestId: single.requestId,
          label: single.requestId,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
        }];
      } else {
        outcomes = await bulkDecision(targets, action, note);
      }
      const succeededIds = new Set(outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.requestId));
      const succeeded = targets.filter((request) => succeededIds.has(request.requestId));
      const failures = outcomes.filter((outcome) => !outcome.ok);
      if (succeeded.length > 0) {
        setToast(toastFor(succeeded, action === "approve" ? "approved" : "denied"));
        setNote("");
        setChecked(new Set());
      }
      if (failures.length > 0) {
        setStatusMsg({
          type: "error",
          text: failures.map((failure) => failure.error ?? "").filter(Boolean).join(" — "),
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleUndo(): Promise<void> {
    if (!toast || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const targets = toast.undoable;
    setToast(null);
    try {
      const outcomes = await undoDecisions(targets);
      const failed = outcomes.filter((outcome) => !outcome.ok);
      setStatusMsg(
        failed.length === 0
          ? { type: "ok", text: L.approval_undo_done }
          : {
              type: "error",
              text: L.approval_undo_partial.replace(
                "{errors}",
                failed.map((outcome) => outcome.error ?? "").filter(Boolean).join(" — ")
              ),
            }
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function toggleCheck(requestId: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) next.delete(requestId); else next.add(requestId);
      return next;
    });
  }

  return (
    <section className="ew-page" dir="rtl">
      <div className="ew-approval-header">
        <PageHeader
          eyebrow="اعتماد الطلبات"
          title="اعتماد الطلبات"
          subtitle={canReview ? L.approval_subtitle_reviewer : "الطلبات التي أرسلتها."}
        />
        {counts.pending > 0 && (
          <div className="ew-approval-oldest">
            <Clock size={16} aria-hidden />
            <span>{L.approval_oldest_wait}</span>
            <strong>{oldestPendingDays}</strong>
          </div>
        )}
      </div>

      <div className="ew-approval-view-tabs">
        <button type="button" className={`ew-approval-view-tab${view === "review" ? " active" : ""}`} onClick={() => setView("review")}>المراجعة</button>
        <button type="button" className={`ew-approval-view-tab${view === "history" ? " active" : ""}`} onClick={() => setView("history")}>السجل</button>
      </div>

      {statusMsg && (
        <div className={`${statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} ew-msg-dismissible`} role="status">
          <span>{statusMsg.text}</span>
          <button type="button" className="ew-msg-dismiss-btn" aria-label="إغلاق" onClick={() => setStatusMsg(null)}>
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
            <div className="ew-approval-kind-filter" role="tablist" aria-label="تصفية حسب نوع الطلب">
              {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === kind}
                  className={`ew-approval-kind-chip${kindFilter === kind ? " active" : ""}`}
                  onClick={() => setKindFilter(kind)}
                >
                  {kind === "all" ? L.approval_kind_all : KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>

          {checkedRequests.length > 0 && (
            <div className="ew-bulk-bar">
              <span className="ew-bulk-bar-count">
                {L.approval_bulk_selected.replace("{count}", String(checkedRequests.length))}
              </span>
              <button type="button" className="ew-btn-primary ew-btn-sm" disabled={busy} onClick={() => void runDecision(checkedRequests, "approve")}>
                {L.approval_bulk_approve}
              </button>
              <button type="button" className="ew-btn-deny ew-btn-sm" disabled={busy} onClick={() => void runDecision(checkedRequests, "deny")}>
                {L.approval_bulk_deny}
              </button>
              <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => setChecked(new Set())}>
                {L.approval_bulk_clear}
              </button>
            </div>
          )}

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

          {loadState === "ready" && months.length > 0 && (
            <div className="ew-approval-split">
              <RequestQueue
                requests={filtered}
                userDisplayMap={userDisplayMap}
                selectedId={selected?.requestId ?? null}
                onSelect={(request) => setSelectedId(request.requestId)}
                oldestFirst={pendingOnly}
                selectable={selectable}
                checked={checked}
                onToggleCheck={toggleCheck}
                page={page}
                onPageChange={setPage}
              />
              {selected ? (
                <RequestDetail
                  request={selected}
                  userDisplayMap={userDisplayMap}
                  sampleDetails={sampleDetails}
                  actionable={selected.status === "pending" && canReviewRequest(selected)}
                  note={note}
                  onNoteChange={setNote}
                  busy={busy}
                  onApprove={() => void runDecision([selected], "approve")}
                  onDeny={() => void runDecision([selected], "deny")}
                />
              ) : (
                <div className="ew-approval-detail ew-approval-detail--empty">
                  <h3>{L.approval_select_prompt_title}</h3>
                  <p>{L.approval_select_prompt_body}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {toast && (
        <div className={`ew-approval-toast ew-approval-toast--${toast.status}`} role="status">
          <span>{toast.text}</span>
          {toast.blockedReason && <span className="ew-approval-toast-note">{toast.blockedReason}</span>}
          {toast.undoable.length > 0 && (
            <button type="button" className="ew-approval-toast-undo" disabled={busy} onClick={() => void handleUndo()}>
              <Undo2 size={14} aria-hidden />
              {L.approval_undo}
            </button>
          )}
          <button type="button" className="ew-approval-toast-close" aria-label="إغلاق" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
