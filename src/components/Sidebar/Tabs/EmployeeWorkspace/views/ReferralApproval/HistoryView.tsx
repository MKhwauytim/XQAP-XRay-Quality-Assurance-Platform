import { useEffect, useState } from "react";
import DataTable, { type DataTableCol } from "../../../../../../components/DataTable";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import { listMonthFolders } from "../../../../../../data/population/populationStorage";
import { loadReferralLog, loadReplacementLog } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import RequestTimeline from "./RequestTimeline";

type HistoryRow = {
  key: string;
  kind: "referral" | "replacement";
  monthFolderName: string;
  requester: string;
  details: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  requestedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  history: ReferralRequest["history"];
};

type Props = {
  directoryHandle: DirectoryHandleLike;
  username: string;
  canApproveReferrals: boolean;
  canApproveReplacements: boolean;
  userDisplayMap: Record<string, string>;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "denied", label: "مرفوض" },
];

const STATUS_BADGE_LABEL: Record<HistoryRow["status"], string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
const STATUS_BADGE_CLASS: Record<HistoryRow["status"], string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };

export default function HistoryView({ directoryHandle, username, canApproveReferrals, canApproveReplacements, userDisplayMap }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [skippedMonths, setSkippedMonths] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      setState("loading");
      try {
        const months = await listMonthFolders(directoryHandle);
        const collected: HistoryRow[] = [];
        const skipped: string[] = [];
        for (const month of months) {
          // Each month is loaded independently — one unreadable month must not
          // blank out every other month's history.
          try {
            const [refLog, repLog] = await Promise.all([
              loadReferralLog(directoryHandle, month.folderName),
              loadReplacementLog(directoryHandle, month.folderName),
            ]);
            for (const r of refLog.requests) {
              if (!canApproveReferrals && r.fromEmployee !== username) continue;
              collected.push({
                key: `referral-${r.requestId}`, kind: "referral", monthFolderName: month.folderName,
                requester: userDisplayMap[r.fromEmployee] ?? r.fromEmployee,
                details: `${r.xrayImageIds.length} عينة → ${userDisplayMap[r.toEmployee] ?? r.toEmployee}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
              });
            }
            for (const r of repLog.requests) {
              if (!canApproveReplacements && r.employeeUsername !== username) continue;
              collected.push({
                key: `replacement-${r.requestId}`, kind: "replacement", monthFolderName: month.folderName,
                requester: userDisplayMap[r.employeeUsername] ?? r.employeeUsername,
                details: `${r.originalXrayImageId} → ${r.replacementXrayImageId}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
              });
            }
          } catch {
            skipped.push(month.folderName);
          }
        }
        if (!cancelled) { setRows(collected); setSkippedMonths(skipped); setState("ready"); }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [directoryHandle, username, canApproveReferrals, canApproveReplacements, userDisplayMap]);

  const columns: DataTableCol<HistoryRow>[] = [
    { id: "monthFolderName", label: "الشهر", widthFr: 1.2, accessor: (r) => r.monthFolderName },
    { id: "kind", label: "النوع", widthFr: 1, accessor: (r) => (r.kind === "referral" ? "إحالة" : "استبدال") },
    { id: "requester", label: "مقدّم الطلب", widthFr: 1.4, accessor: (r) => r.requester },
    { id: "details", label: "التفاصيل", widthFr: 2, accessor: (r) => r.details },
    { id: "status", label: "الحالة", widthFr: 1, filterKind: "status", statusOptions: STATUS_OPTIONS, accessor: (r) => r.status },
    { id: "requestedAt", label: "تاريخ الطلب", widthFr: 1.4, isDate: true, accessor: (r) => r.requestedAt },
    { id: "reviewedBy", label: "راجعه", widthFr: 1.2, accessor: (r) => (r.reviewedBy ? userDisplayMap[r.reviewedBy] ?? r.reviewedBy : null) },
    { id: "reviewedAt", label: "تاريخ المراجعة", widthFr: 1.4, isDate: true, accessor: (r) => r.reviewedAt ?? null },
  ];

  if (state === "loading") return <LoadingState />;
  if (state === "error") return <ErrorState description="تعذر تحميل سجل الطلبات." />;
  if (rows.length === 0 && skippedMonths.length === 0) {
    return <EmptyState title="لا يوجد سجل طلبات بعد" description="ستظهر هنا كل طلبات الإحالة والاستبدال من جميع الأشهر." />;
  }

  return (
    <>
      {skippedMonths.length > 0 && (
        <div className="ew-msg-error" role="alert" style={{ marginBottom: 12 }}>
          تعذر قراءة سجل الأشهر التالية، تم تخطيها: {skippedMonths.join("، ")}
        </div>
      )}
      <DataTable<HistoryRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.key}
        renderCell={(col, row) =>
          col.id === "status"
            ? <span className={`ew-ref-badge ${STATUS_BADGE_CLASS[row.status]}`}>{STATUS_BADGE_LABEL[row.status]}</span>
            : (col.accessor(row) ?? "—")
        }
        storageKey="ra-history-table"
        exportFileName="سجل-طلبات-الاعتماد"
        expandedKey={expandedKey}
        onRowClick={(row) => setExpandedKey((cur) => (cur === row.key ? null : row.key))}
        renderExpanded={(row) => (
          <div style={{ padding: "10px 16px" }}>
            {row.reason && <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>السبب: {row.reason}</p>}
            <RequestTimeline requestedAt={row.requestedAt} requestedBy={row.requestedBy} history={row.history} userDisplayMap={userDisplayMap} />
          </div>
        )}
      />
    </>
  );
}
