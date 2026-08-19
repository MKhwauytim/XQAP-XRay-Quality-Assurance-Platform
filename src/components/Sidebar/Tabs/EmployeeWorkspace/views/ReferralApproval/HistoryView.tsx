import { useEffect, useState } from "react";
import DataTable, { type DataTableCol } from "../../../../../../components/DataTable";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import { listAdhocSampleFolders } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import { listMonthFolders } from "../../../../../../data/population/populationStorage";
import { loadReferralLog, loadReopenLog, loadReplacementLog } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { KIND_LABELS, STATUS_BADGE_CLASS, STATUS_BADGE_LABEL } from "./requestKind";
import RequestTimeline from "./RequestTimeline";

type HistoryRow = {
  key: string;
  kind: "referral" | "replacement" | "reopen";
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
  /** Every sample the request covers. The `details` column can only carry a
   *  count for a multi-sample request, so the ids themselves are listed in the
   *  expanded row — a reassignment of 1,500+ samples is unauditable without
   *  being able to see exactly which ones moved. */
  xrayImageIds: string[];
};

type Props = {
  directoryHandle: DirectoryHandleLike;
  username: string;
  canApproveReferrals: boolean;
  canApproveReplacements: boolean;
  canApproveReopens: boolean;
  userDisplayMap: Record<string, string>;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "denied", label: "مرفوض" },
];

/** How many ids are rendered before the "show all" affordance. A bulk
 *  reassignment can cover thousands of samples; rendering every chip up front
 *  would stall the row expansion for a list nobody reads in full by default. */
const ID_PREVIEW_LIMIT = 200;

function SampleIdList({ ids }: { ids: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  if (ids.length === 0) return null;
  const shown = showAll ? ids : ids.slice(0, ID_PREVIEW_LIMIT);

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(ids.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard access can be denied or unavailable; the ids stay on screen,
      // so a failed copy is not worth an error banner.
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <strong style={{ fontSize: 13, color: "#334155" }}>
          العينات ({ids.length.toLocaleString("ar-SA-u-nu-latn")})
        </strong>
        <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => { void copyAll(); }}>
          {copied ? "تم النسخ" : "نسخ كل المعرفات"}
        </button>
        {ids.length > ID_PREVIEW_LIMIT && (
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "عرض أول 200 فقط"
              : `عرض كل ${ids.length.toLocaleString("ar-SA-u-nu-latn")}`}
          </button>
        )}
      </div>
      <div className="ew-referral-ids-list" style={{ maxHeight: 220, overflowY: "auto" }}>
        {shown.map((id) => (
          <span key={id} className="ew-referral-id-chip dt-mono">{id}</span>
        ))}
      </div>
      {!showAll && ids.length > ID_PREVIEW_LIMIT && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
          {`معروض ${ID_PREVIEW_LIMIT.toLocaleString("ar-SA-u-nu-latn")} من ${ids.length.toLocaleString("ar-SA-u-nu-latn")}.`}
        </p>
      )}
    </div>
  );
}

export default function HistoryView({ directoryHandle, username, canApproveReferrals, canApproveReplacements, canApproveReopens, userDisplayMap }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [skippedMonths, setSkippedMonths] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      setState("loading");
      try {
        // Ad-hoc imports keep their requests in a synthetic
        // `2-samples/adhoc-{importId}/` store that `listMonthFolders` cannot
        // return (it only reports month-shaped folders under `1-population/`),
        // so without this the "all months" history silently omitted every
        // request filed against an ad-hoc row — the same blind spot the review
        // queue had in useApprovalData.
        const [monthFolders, adhocFolders] = await Promise.all([
          listMonthFolders(directoryHandle),
          listAdhocSampleFolders(directoryHandle),
        ]);
        const months = [
          ...monthFolders.map((m) => ({ folderName: m.folderName })),
          ...adhocFolders.map((folderName) => ({ folderName })),
        ];
        const collected: HistoryRow[] = [];
        const skipped: string[] = [];
        for (const month of months) {
          // Each month is loaded independently — one unreadable month must not
          // blank out every other month's history.
          try {
            const [refLog, repLog, reoLog] = await Promise.all([
              loadReferralLog(directoryHandle, month.folderName),
              loadReplacementLog(directoryHandle, month.folderName),
              loadReopenLog(directoryHandle, month.folderName),
            ]);
            for (const r of refLog.requests) {
              if (!canApproveReferrals && r.fromEmployee !== username) continue;
              collected.push({
                key: `referral-${r.requestId}`, kind: "referral", monthFolderName: month.folderName,
                requester: userDisplayMap[r.fromEmployee] ?? r.fromEmployee,
                details: `${r.xrayImageIds.length} عينة → ${userDisplayMap[r.toEmployee] ?? r.toEmployee}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
                xrayImageIds: r.xrayImageIds,
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
                xrayImageIds: [r.originalXrayImageId, r.replacementXrayImageId],
              });
            }
            for (const r of reoLog.requests) {
              if (!canApproveReopens && r.employeeUsername !== username && r.requestedBy !== username) continue;
              collected.push({
                key: `reopen-${r.requestId}`, kind: "reopen", monthFolderName: month.folderName,
                requester: userDisplayMap[r.employeeUsername] ?? r.employeeUsername,
                details: `إعادة فتح: ${r.xrayImageId}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
                xrayImageIds: [r.xrayImageId],
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
  }, [directoryHandle, username, canApproveReferrals, canApproveReplacements, canApproveReopens, userDisplayMap]);

  const columns: DataTableCol<HistoryRow>[] = [
    { id: "monthFolderName", label: "الشهر", widthFr: 1.2, accessor: (r) => r.monthFolderName },
    { id: "kind", label: "النوع", widthFr: 1, accessor: (r) => KIND_LABELS[r.kind] },
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
        // No resetToken on purpose: this log spans every month and has no
        // context the user can switch, so nothing here should ever move the page
        // but the user (or a shrink, which DataTable clamps).
        exportFileName="سجل-طلبات-الاعتماد"
        expandedKey={expandedKey}
        onRowClick={(row) => setExpandedKey((cur) => (cur === row.key ? null : row.key))}
        renderExpanded={(row) => (
          <div style={{ padding: "10px 16px" }}>
            {row.reason && <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>السبب: {row.reason}</p>}
            <RequestTimeline requestedAt={row.requestedAt} requestedBy={row.requestedBy} history={row.history} userDisplayMap={userDisplayMap} />
            <SampleIdList ids={row.xrayImageIds} />
          </div>
        )}
      />
    </>
  );
}
