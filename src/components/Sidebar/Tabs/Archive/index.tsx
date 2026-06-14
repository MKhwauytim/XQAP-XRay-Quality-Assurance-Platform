/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { SidebarTabModule } from "../tabTypes";
import { readSession } from "../../../../auth/authSession";
import {
  createBackup,
  loadArchiveStatus,
  type MonthArchiveStatus
} from "../../../../data/backup/backupStorage";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./Archive.css";

function ArchiveIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M3 3h18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 5h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm6 3v2h2v-2H10Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "archive",
  label: "الأرشيف",
  order: 30,
  allowedRoles: ["supervisor", "admin"],
  icon: <ArchiveIcon />
};

const STATUS_LABELS: Record<string, string> = {
  "raw-saved": "خام",
  "processed-saved": "معالج",
  sampled: "مسحوب",
  distributed: "موزع"
};

function statusBadge(status: string | null): string {
  if (!status) return '<span class="arc-badge arc-badge-none">—</span>';
  const label = STATUS_LABELS[status] ?? status;
  return `<span class="arc-badge arc-badge-${status}">${label}</span>`;
}

export default function ArchiveTab() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const username = session?.username ?? "unknown";

  const [statuses, setStatuses] = useState<MonthArchiveStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setIsLoading(true);
    const months = await listMonthFolders(directoryHandle);
    const list = await loadArchiveStatus(directoryHandle, months);
    setStatuses(list);
    setIsLoading(false);
  }, [directoryHandle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleBackup(): Promise<void> {
    if (!directoryHandle) return;
    setIsBackingUp(true);
    setMessage(null);
    const months = await listMonthFolders(directoryHandle);
    const result = await createBackup(directoryHandle, months, username);
    if (result.ok) {
      setMessage({
        type: "ok",
        text: `تم الحفظ الاحتياطي بنجاح في .system/backups/${result.folderName}`
      });
      await refresh();
    } else {
      setMessage({ type: "error", text: `فشل الحفظ الاحتياطي: ${result.error}` });
    }
    setIsBackingUp(false);
  }

  if (!directoryHandle) {
    return (
      <section className="arc-page">
        <p className="arc-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return (
    <section className="arc-page" dir="rtl">
      <header className="arc-header">
        <div>
          <p className="arc-eyebrow">Archive</p>
          <h1>الأرشيف</h1>
          <p>استعرض حالة الأشهر المعالجة وقم بإجراء نسخ احتياطية.</p>
        </div>
        <button
          type="button"
          className="arc-btn-primary"
          disabled={isBackingUp}
          onClick={() => { void handleBackup(); }}
        >
          {isBackingUp ? "جاري النسخ..." : "نسخ احتياطي الآن"}
        </button>
      </header>

      {message ? (
        <div
          className={message.type === "ok" ? "arc-msg-ok" : "arc-msg-error"}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      {isLoading ? (
        <p className="arc-empty">جاري التحميل...</p>
      ) : statuses.length === 0 ? (
        <div className="arc-empty">
          لا توجد أشهر معالجة في مساحة العمل.
        </div>
      ) : (
        <div className="arc-table-wrapper">
          <table className="arc-table">
            <thead>
              <tr>
                <th>الشهر</th>
                <th>حالة المعالجة</th>
                <th>بيانات خام</th>
                <th>عينة</th>
                <th>توزيع</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.folderName}>
                  <td className="arc-month-name">{s.folderName}</td>
                  <td
                    dangerouslySetInnerHTML={{
                      __html: statusBadge(s.manifestStatus)
                    }}
                  />
                  <td>
                    {s.hasManifest ? (
                      <span className="arc-check">✓</span>
                    ) : (
                      <span className="arc-miss">—</span>
                    )}
                  </td>
                  <td>
                    {s.hasSample ? (
                      <span className="arc-check">✓</span>
                    ) : (
                      <span className="arc-miss">—</span>
                    )}
                  </td>
                  <td>
                    {s.hasDistribution ? (
                      <span className="arc-check">✓</span>
                    ) : (
                      <span className="arc-miss">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="arc-info-panel">
        <h2>معلومات النسخ الاحتياطي</h2>
        <p>
          يقوم النسخ الاحتياطي بحفظ الملفات الرئيسية لكل شهر (البيان، العينة،
          سجل التوزيع) داخل مجلد{" "}
          <code>.system/backups/</code> بتوقيت تشغيل العملية.
        </p>
      </div>
    </section>
  );
}
