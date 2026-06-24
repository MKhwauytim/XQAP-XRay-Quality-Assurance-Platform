import { useCallback, useEffect, useState } from "react";
import { readSession } from "../../../../../auth/authSession";
import { hasFeature, readUserManagementState } from "../../../../../auth/userManagement";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
} from "../../../../../data/distribution/distributionStorage";
import {
  buildReassignEvent,
} from "../../../../../data/distribution/distributionLog";
import {
  executeReplacement,
} from "../../../../../data/distribution/replacement";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import {
  loadReferralLog,
  updateReferralStatus,
  loadReplacementLog,
  updateReplacementStatus,
} from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { loadMonthPopulationFinal } from "../../../../../data/population/populationStorage";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";

type LoadState = "idle" | "loading" | "ready" | "error";
type StatusMsg = { type: "ok" | "error"; text: string } | null;
type RequestSection = "referral" | "replacement";

type ReferralReviewDialog = { request: ReferralRequest; action: "approve" | "deny" } | null;
type ReplacementReviewDialog = { request: ReplacementRequest; action: "approve" | "deny" } | null;

type Props = { directoryHandle: DirectoryHandleLike };

export default function ReferralApproval({ directoryHandle }: Props) {
  const session  = readSession();
  const username = session?.username ?? "";
  const role     = session?.role ?? "employee";
  const userManagementState = readUserManagementState();
  const canApproveReferrals = hasFeature(userManagementState.featurePermissions, role, "approve-referrals");
  const canApproveReplacements = hasFeature(userManagementState.featurePermissions, role, "approve-replacements");
  const canReview = canApproveReferrals || canApproveReplacements;

  const [months, setMonths]       = useState<Array<{ folderName: string }>>([]);
  const [selMonth, setSelMonth]   = useState("");
  const [section, setSection]     = useState<RequestSection>("referral");
  const [referrals, setReferrals] = useState<ReferralRequest[]>([]);
  const [replacements, setReplacements] = useState<ReplacementRequest[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "denied">("all");
  const [statusMsg, setStatusMsg] = useState<StatusMsg>(null);
  const [referralDialog, setReferralDialog]       = useState<ReferralReviewDialog>(null);
  const [replacementDialog, setReplacementDialog] = useState<ReplacementReviewDialog>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sampleDetails, setSampleDetails] = useState<Record<string, DistributionEntry | PreparedPopulationRow>>({});

  const userDisplayMap = (() => {
    const m: Record<string, string> = {};
    for (const u of userManagementState.users) {
      m[u.username] = u.displayName;
    }
    return m;
  })();

  useEffect(() => {
    void listMonthFolders(directoryHandle).then((ms) => {
      setMonths(ms);
      if (ms.length > 0) setSelMonth(ms[ms.length - 1]!.folderName);
    });
  }, [directoryHandle]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const loadData = useCallback(async () => {
    if (!selMonth) return;
    setLoadState("loading");
    try {
      const [refLog, repLog] = await Promise.all([
        loadReferralLog(directoryHandle, selMonth),
        loadReplacementLog(directoryHandle, selMonth),
      ]);
      const sample = await loadSampleMaster(directoryHandle, selMonth);
      if (sample) {
        const distribution = await loadOrDeriveDistributionCurrent(directoryHandle, selMonth, sample.rows);
        const detailMap: Record<string, DistributionEntry | PreparedPopulationRow> = {};
        for (const row of sample.rows) detailMap[row.xrayImageId] = row;
        for (const entry of distribution?.entries ?? []) detailMap[entry.xrayImageId] = entry;
        setSampleDetails(detailMap);
      } else {
        setSampleDetails({});
      }
      const visibleReferrals = canApproveReferrals
        ? refLog.requests
        : refLog.requests.filter((r) => r.fromEmployee === username);
      const visibleReplacements = canApproveReplacements
        ? repLog.requests
        : repLog.requests.filter((r) => r.employeeUsername === username);
      setReferrals(visibleReferrals);
      setReplacements(visibleReplacements);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canApproveReferrals, canApproveReplacements]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  // ── Referral approve / deny ──────────────────────────────────────────────────

  async function handleApproveReferral(request: ReferralRequest, reviewNotes: string): Promise<void> {
    const now = new Date().toISOString();
    const events = request.xrayImageIds.map((id) =>
      buildReassignEvent({
        xrayImageId: id,
        assignedTo:  request.fromEmployee,
        reassignedTo: request.toEmployee,
        eventBy: username,
        notes: `إحالة من ${request.fromEmployee} — ${request.reason}`,
      })
    );
    const distResult = await appendDistributionEvents(directoryHandle, selMonth, events);
    if (!distResult.ok) { setStatusMsg({ type: "error", text: distResult.error }); return; }

    const sample = await loadSampleMaster(directoryHandle, selMonth);
    if (sample) {
      await loadOrDeriveDistributionCurrent(directoryHandle, selMonth, sample.rows);
    }

    const updateResult = await updateReferralStatus(directoryHandle, selMonth, request.requestId, {
      status: "approved", reviewedBy: username, reviewedAt: now,
      reviewNotes: reviewNotes.trim() || undefined,
    });
    setReferralDialog(null);
    if (updateResult.ok) {
      setReferrals((prev) => prev.map((item) =>
        item.requestId === request.requestId
          ? { ...item, status: "approved", reviewedBy: username, reviewedAt: now, reviewNotes: reviewNotes.trim() || undefined }
          : item
      ));
    }
    setStatusMsg(updateResult.ok
      ? { type: "ok", text: `تمت الموافقة — تم نقل ${request.xrayImageIds.length} عينة إلى ${userDisplayMap[request.toEmployee] ?? request.toEmployee}.` }
      : { type: "error", text: updateResult.error }
    );
    await loadData();
  }

  async function handleDenyReferral(request: ReferralRequest, reviewNotes: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await updateReferralStatus(directoryHandle, selMonth, request.requestId, {
      status: "denied", reviewedBy: username, reviewedAt: now,
      reviewNotes: reviewNotes.trim() || undefined,
    });
    setReferralDialog(null);
    if (result.ok) {
      setReferrals((prev) => prev.map((item) =>
        item.requestId === request.requestId
          ? { ...item, status: "denied", reviewedBy: username, reviewedAt: now, reviewNotes: reviewNotes.trim() || undefined }
          : item
      ));
    }
    setStatusMsg(result.ok
      ? { type: "ok", text: "تم رفض طلب الإحالة — ستعود العينات إلى الموظف الأصلي." }
      : { type: "error", text: result.error }
    );
    await loadData();
  }

  // ── Replacement approve / deny ───────────────────────────────────────────────

  async function handleApproveReplacement(request: ReplacementRequest, reviewNotes: string): Promise<void> {
    const now = new Date().toISOString();

    // Resolve replacement row from the current population (reference-not-copy).
    // Falls back to the stored replacementRowData for legacy requests that pre-date this change.
    let replacementRow: PreparedPopulationRow | null = null;
    try {
      const population = await loadMonthPopulationFinal(directoryHandle, request.monthFolderName);
      replacementRow = (population?.rows ?? []).find(
        (r) => (r as PreparedPopulationRow).xrayImageId === request.replacementXrayImageId
      ) as PreparedPopulationRow ?? null;
    } catch { /* fall through to legacy path */ }

    if (!replacementRow) {
      // Legacy fallback: use the stored row data if present.
      if (request.replacementRowData) {
        replacementRow = request.replacementRowData as unknown as PreparedPopulationRow;
      } else {
        setStatusMsg({ type: "error", text: "تعذر إيجاد بيانات سطر البديل في مجتمع الشهر." });
        return;
      }
    }

    const sample = await loadSampleMaster(directoryHandle, request.monthFolderName);
    if (!sample) {
      setStatusMsg({ type: "error", text: "تعذر تحميل ملف العينة للتحقق من الاستبدال." });
      return;
    }

    const distribution = await loadOrDeriveDistributionCurrent(
      directoryHandle,
      request.monthFolderName,
      sample.rows
    );
    const deadEntry = distribution?.entries.find(
      (entry) =>
        entry.xrayImageId === request.originalXrayImageId &&
        entry.assignedTo === request.employeeUsername
    );
    if (!deadEntry) {
      setStatusMsg({ type: "error", text: "تعذر إيجاد العينة الأصلية في التوزيع الحالي." });
      return;
    }

    const result = await executeReplacement({
      directoryHandle,
      monthFolderName: request.monthFolderName,
      deadEntry,
      replacementRow,
      reason: `استبدال معتمد — ${request.reason}`,
      eventBy: username,
    });
    if (!result.ok) { setStatusMsg({ type: "error", text: result.error }); return; }

    await loadOrDeriveDistributionCurrent(
      directoryHandle,
      request.monthFolderName,
      result.updatedSample.rows
    );

    const updateResult = await updateReplacementStatus(directoryHandle, selMonth, request.requestId, {
      status: "approved", reviewedBy: username, reviewedAt: now,
      reviewNotes: reviewNotes.trim() || undefined,
    });
    setReplacementDialog(null);
    if (updateResult.ok) {
      setReplacements((prev) => prev.map((item) =>
        item.requestId === request.requestId
          ? { ...item, status: "approved", reviewedBy: username, reviewedAt: now, reviewNotes: reviewNotes.trim() || undefined }
          : item
      ));
    }
    setStatusMsg(updateResult.ok
      ? { type: "ok", text: `تمت الموافقة — تم استبدال ${request.originalXrayImageId} بـ ${request.replacementXrayImageId}.` }
      : { type: "error", text: updateResult.error }
    );
    await loadData();
  }

  async function handleDenyReplacement(request: ReplacementRequest, reviewNotes: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await updateReplacementStatus(directoryHandle, selMonth, request.requestId, {
      status: "denied", reviewedBy: username, reviewedAt: now,
      reviewNotes: reviewNotes.trim() || undefined,
    });
    setReplacementDialog(null);
    if (result.ok) {
      setReplacements((prev) => prev.map((item) =>
        item.requestId === request.requestId
          ? { ...item, status: "denied", reviewedBy: username, reviewedAt: now, reviewNotes: reviewNotes.trim() || undefined }
          : item
      ));
    }
    setStatusMsg(result.ok
      ? { type: "ok", text: "تم رفض طلب الاستبدال — تبقى العينة الأصلية مع الموظف." }
      : { type: "error", text: result.error }
    );
    await loadData();
  }

  // ── Derived lists ────────────────────────────────────────────────────────────

  const filteredReferrals    = referrals.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const filteredReplacements = replacements.filter((r) => statusFilter === "all" || r.status === statusFilter);

  const pendingReferralCount    = referrals.filter((r) => r.status === "pending").length;
  const pendingReplacementCount = replacements.filter((r) => r.status === "pending").length;

  const activeList = section === "referral" ? filteredReferrals : filteredReplacements;

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Request Approval"
        title="اعتماد الطلبات"
        subtitle={canReview ? "مراجعة طلبات الإحالة والاستبدال." : "الطلبات التي أرسلتها."}
      />

      {statusMsg && (
        <div className={statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {statusMsg.text}
          <button
            type="button"
            style={{ float: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
            onClick={() => setStatusMsg(null)}
          >✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="ew-referral-toolbar">
        <label className="ew-label" htmlFor="ra-month">
          الشهر
          <select
            id="ra-month"
            className="ew-select"
            value={selMonth}
            onChange={(e) => setSelMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m.folderName} value={m.folderName}>{m.folderName}</option>
            ))}
          </select>
        </label>

        {/* Request-type section tabs */}
        <div className="ew-referral-status-tabs" style={{ gap: 4 }}>
          <button
            type="button"
            className={`ew-referral-status-tab${section === "referral" ? " active" : ""}${pendingReferralCount > 0 ? " has-badge" : ""}`}
            onClick={() => setSection("referral")}
          >
            الإحالة
            {referrals.length > 0 && <span className="ew-status-count">{referrals.length}</span>}
          </button>
          <button
            type="button"
            className={`ew-referral-status-tab${section === "replacement" ? " active" : ""}${pendingReplacementCount > 0 ? " has-badge" : ""}`}
            onClick={() => setSection("replacement")}
          >
            الاستبدال
            {replacements.length > 0 && <span className="ew-status-count">{replacements.length}</span>}
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="ew-referral-status-tabs">
          {(["pending", "approved", "denied", "all"] as const).map((s) => {
            const labels = { pending: "معلق", approved: "مقبول", denied: "مرفوض", all: "الكل" };
            const src    = section === "referral" ? referrals : replacements;
            const count  = s === "all" ? src.length : src.filter((r) => r.status === s).length;
            return (
              <button
                key={s}
                type="button"
                className={`ew-referral-status-tab${statusFilter === s ? " active" : ""}${s === "pending" && count > 0 ? " has-badge" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {labels[s]}
                {count > 0 && <span className="ew-status-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {loadState === "loading" && <p className="ew-empty">جاري التحميل...</p>}
      {loadState === "error"   && <p className="ew-empty">تعذر تحميل البيانات.</p>}

      {loadState === "ready" && activeList.length === 0 && (
        <div className="ew-referral-empty">
          <p>لا توجد طلبات {section === "referral" ? "إحالة" : "استبدال"}{" "}
            {statusFilter === "pending" ? "معلقة" : statusFilter === "approved" ? "مقبولة" : statusFilter === "denied" ? "مرفوضة" : ""} لهذا الشهر.
          </p>
        </div>
      )}

      {loadState === "ready" && activeList.length > 0 && (
        <div className="ew-referral-list">
          {section === "referral"
            ? filteredReferrals
                .slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
                .map((req) => (
                  <ReferralCard
                    key={req.requestId}
                    request={req}
                    userDisplayMap={userDisplayMap}
                    sampleDetails={sampleDetails}
                    expanded={expandedId === req.requestId}
                    onToggleExpand={() => setExpandedId((cur) => (cur === req.requestId ? null : req.requestId))}
                    canReview={canApproveReferrals}
                    onApprove={() => setReferralDialog({ request: req, action: "approve" })}
                    onDeny={() => setReferralDialog({ request: req, action: "deny" })}
                  />
                ))
            : filteredReplacements
                .slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
                .map((req) => (
                  <ReplacementCard
                    key={req.requestId}
                    request={req}
                    userDisplayMap={userDisplayMap}
                    sampleDetails={sampleDetails}
                    expanded={expandedId === req.requestId}
                    onToggleExpand={() => setExpandedId((cur) => (cur === req.requestId ? null : req.requestId))}
                    canReview={canApproveReplacements}
                    onApprove={() => setReplacementDialog({ request: req, action: "approve" })}
                    onDeny={() => setReplacementDialog({ request: req, action: "deny" })}
                  />
                ))
          }
        </div>
      )}

      {referralDialog && (
        <ReviewModal
          title={referralDialog.action === "approve" ? "تأكيد الموافقة على الإحالة" : "تأكيد رفض الإحالة"}
          description={
            referralDialog.action === "approve"
              ? `ستتم إحالة ${referralDialog.request.xrayImageIds.length} عينة من ${userDisplayMap[referralDialog.request.fromEmployee] ?? referralDialog.request.fromEmployee} إلى ${userDisplayMap[referralDialog.request.toEmployee] ?? referralDialog.request.toEmployee} بشكل دائم.`
              : `سيتم رفض الطلب وستبقى العينات مع ${userDisplayMap[referralDialog.request.fromEmployee] ?? referralDialog.request.fromEmployee}.`
          }
          isApprove={referralDialog.action === "approve"}
          onClose={() => setReferralDialog(null)}
          onConfirm={(notes) =>
            referralDialog.action === "approve"
              ? void handleApproveReferral(referralDialog.request, notes)
              : void handleDenyReferral(referralDialog.request, notes)
          }
        />
      )}

      {replacementDialog && (
        <ReviewModal
          title={replacementDialog.action === "approve" ? "تأكيد الموافقة على الاستبدال" : "تأكيد رفض الاستبدال"}
          description={
            replacementDialog.action === "approve"
              ? `سيتم استبدال ${replacementDialog.request.originalXrayImageId} بـ ${replacementDialog.request.replacementXrayImageId} للموظف ${userDisplayMap[replacementDialog.request.employeeUsername] ?? replacementDialog.request.employeeUsername}.`
              : `سيتم رفض الطلب وتبقى العينة الأصلية ${replacementDialog.request.originalXrayImageId} مع الموظف.`
          }
          isApprove={replacementDialog.action === "approve"}
          onClose={() => setReplacementDialog(null)}
          onConfirm={(notes) =>
            replacementDialog.action === "approve"
              ? void handleApproveReplacement(replacementDialog.request, notes)
              : void handleDenyReplacement(replacementDialog.request, notes)
          }
        />
      )}
    </section>
  );
}

// ── ReferralCard ──────────────────────────────────────────────────────────────

function ReferralCard({
  request, userDisplayMap, sampleDetails, expanded, onToggleExpand, canReview, onApprove, onDeny,
}: {
  request: ReferralRequest;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, DistributionEntry | PreparedPopulationRow>;
  expanded: boolean;
  onToggleExpand: () => void;
  canReview: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const statusLabels: Record<string, string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
  const statusClasses: Record<string, string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };
  const fromName = userDisplayMap[request.fromEmployee] ?? request.fromEmployee;
  const toName   = userDisplayMap[request.toEmployee]   ?? request.toEmployee;
  const dateStr  = new Date(request.requestedAt).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

  return (
    <article className="ew-referral-card">
      <div className="ew-referral-card-header">
        <div className="ew-referral-card-meta">
          <div className="ew-referral-route">
            <span className="ew-referral-emp">{fromName}</span>
            <span className="ew-referral-arrow">←</span>
            <span className="ew-referral-emp">{toName}</span>
          </div>
          <div className="ew-referral-card-sub">
            <span>{request.xrayImageIds.length} عينة</span>
            <span>·</span>
            <span>{dateStr}</span>
            {request.reviewedBy && <><span>·</span><span>راجع: {userDisplayMap[request.reviewedBy] ?? request.reviewedBy}</span></>}
          </div>
          <p className="ew-referral-reason">السبب: {request.reason}</p>
          {request.reviewNotes && <p className="ew-referral-review-note">ملاحظة: {request.reviewNotes}</p>}
        </div>
        <div className="ew-referral-card-actions">
          <span className={`ew-ref-badge ${statusClasses[request.status] ?? ""}`}>
            {statusLabels[request.status] ?? request.status}
          </span>
          {canReview && request.status === "pending" && (
            <>
              <button type="button" className="ew-btn-primary ew-btn-sm" onClick={onApprove}>موافقة</button>
              <button type="button" className="ew-btn-deny ew-btn-sm" onClick={onDeny}>رفض</button>
            </>
          )}
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onToggleExpand}>
            {expanded ? "إخفاء العينات" : `عرض العينات (${request.xrayImageIds.length})`}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="ew-referral-ids-list">
          {request.xrayImageIds.map((id) => (
            <SampleDetailChip key={id} id={id} detail={sampleDetails[id]} />
          ))}
        </div>
      )}
    </article>
  );
}

// ── ReplacementCard ───────────────────────────────────────────────────────────

function ReplacementCard({
  request, userDisplayMap, sampleDetails, expanded, onToggleExpand, canReview, onApprove, onDeny,
}: {
  request: ReplacementRequest;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, DistributionEntry | PreparedPopulationRow>;
  expanded: boolean;
  onToggleExpand: () => void;
  canReview: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const statusLabels: Record<string, string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
  const statusClasses: Record<string, string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };
  const empName  = userDisplayMap[request.employeeUsername] ?? request.employeeUsername;
  const dateStr  = new Date(request.requestedAt).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
  const originalDetail = sampleDetails[request.originalXrayImageId];
  const replacementDetail = sampleDetails[request.replacementXrayImageId] ?? request.replacementRowData as PreparedPopulationRow | undefined;
  const replacementRow = getDetailRow(replacementDetail);

  return (
    <article className="ew-referral-card">
      <div className="ew-referral-card-header">
        <div className="ew-referral-card-meta">
          <div className="ew-referral-route">
            <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>أصلي</span>
            <span className="dt-mono" style={{ fontSize: 13 }}>{request.originalXrayImageId}</span>
            <span className="ew-referral-arrow">←</span>
            <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>بديل</span>
            <span className="dt-mono" style={{ fontSize: 13 }}>{request.replacementXrayImageId}</span>
          </div>
          <div className="ew-referral-card-sub">
            <span>موظف: {empName}</span>
            <span>·</span>
            <span>{dateStr}</span>
            {request.reviewedBy && <><span>·</span><span>راجع: {userDisplayMap[request.reviewedBy] ?? request.reviewedBy}</span></>}
          </div>
          <p className="ew-referral-reason">السبب: {request.reason}</p>
          {request.reviewNotes && <p className="ew-referral-review-note">ملاحظة: {request.reviewNotes}</p>}
        </div>
        <div className="ew-referral-card-actions">
          <span className={`ew-ref-badge ${statusClasses[request.status] ?? ""}`}>
            {statusLabels[request.status] ?? request.status}
          </span>
          {canReview && request.status === "pending" && (
            <>
              <button type="button" className="ew-btn-primary ew-btn-sm" onClick={onApprove}>موافقة</button>
              <button type="button" className="ew-btn-deny ew-btn-sm" onClick={onDeny}>رفض</button>
            </>
          )}
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onToggleExpand}>
            {expanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="ew-referral-ids-list" style={{ flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SampleDetailChip id={request.originalXrayImageId} detail={originalDetail} prefix="أصلي" tone="danger" />
            <SampleDetailChip id={request.replacementXrayImageId} detail={replacementDetail} prefix="بديل" tone="success" />
          </div>
          {replacementRow?.portName && <span style={{ fontSize: 12, color: "#475569" }}>منفذ البديل: {replacementRow.portName}</span>}
          {replacementRow?.stage    && <span style={{ fontSize: 12, color: "#475569" }}>مستوى البديل: {replacementRow.stage}</span>}
          {replacementRow?.plateOrContainerNumber && <span style={{ fontSize: 12, color: "#475569" }}>اللوحة/الحاوية: {replacementRow.plateOrContainerNumber}</span>}
        </div>
      )}
    </article>
  );
}

function getDetailRow(detail: DistributionEntry | PreparedPopulationRow | undefined): PreparedPopulationRow | undefined {
  if (!detail) return undefined;
  return "row" in detail ? detail.row : detail;
}

function SampleDetailChip({
  id,
  detail,
  prefix,
  tone = "neutral",
}: {
  id: string;
  detail: DistributionEntry | PreparedPopulationRow | undefined;
  prefix?: string;
  tone?: "neutral" | "danger" | "success";
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

// ── ReviewModal ───────────────────────────────────────────────────────────────

function ReviewModal({
  title, description, isApprove, onClose, onConfirm,
}: {
  title: string;
  description: string;
  isApprove: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

  return (
    <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        <div className="ew-replace-reason">
          <p style={{ margin: 0, color: "#475569" }}>{description}</p>
          <label className="ew-field-label" htmlFor="review-notes" style={{ marginTop: 12 }}>
            ملاحظة (اختياري)
          </label>
          <textarea
            id="review-notes"
            className="ew-input ew-textarea"
            rows={2}
            placeholder="أضف ملاحظة للموظف..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
          <button type="button" className="ew-btn-secondary" onClick={onClose}>إلغاء</button>
          <button
            type="button"
            className={isApprove ? "ew-btn-primary" : "ew-btn-deny"}
            onClick={() => onConfirm(notes)}
          >
            {isApprove ? "تأكيد الموافقة" : "تأكيد الرفض"}
          </button>
        </div>
      </div>
    </div>
  );
}
