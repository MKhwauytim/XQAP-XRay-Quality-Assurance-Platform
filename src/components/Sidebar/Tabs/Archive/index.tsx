/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, X } from "lucide-react";

import { readSession } from "../../../../auth/authSession";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import {
  createBackup,
  loadArchiveStatus,
  loadAutoBackupSettings,
  loadAutoBackupState,
  loadBackupHistory,
  restoreBackupSnapshot,
  saveAutoBackupSettings,
  type AutoBackupFrequency,
  type AutoBackupSettings,
  type AutoBackupState,
  type BackupHistoryItem,
  type MonthArchiveStatus,
} from "../../../../data/backup/backupStorage";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { formatDateTime, formatNumber } from "../../../../utils/formatting";
import type { SidebarTabModule } from "../tabTypes";
import "./Archive.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "archive",
  label: "إدارة الأرشيف",
  order: 30,
  allowedRoles: ["guest", "supervisor", "manager", "admin"],
  icon: <Archive size={20} strokeWidth={1.8} aria-hidden />,
};

const STATUS_LABELS: Record<string, string> = {
  "raw-saved": "خام",
  "processed-saved": "معالج",
  sampled: "مسحوب",
  distributed: "موزع",
};

function statusLabel(status: string | null): string {
  if (!status) return "غير مكتمل";
  return STATUS_LABELS[status] ?? status;
}

function modeLabel(mode: BackupHistoryItem["mode"]): string {
  if (mode === "automatic") return "تلقائي";
  if (mode === "pre-restore") return "قبل الاستعادة";
  return "يدوي";
}

export default function ArchiveTab() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const username = session?.username ?? "unknown";
  const isAdmin = session?.role === "admin";

  const [statuses, setStatuses] = useState<MonthArchiveStatus[]>([]);
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [autoState, setAutoState] = useState<AutoBackupState | null>(null);
  const [autoSettings, setAutoSettings] = useState<AutoBackupSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupHistoryItem | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setIsLoading(true);
    try {
      const months = await listMonthFolders(directoryHandle);
      const [statusList, backupHistory, state, settings] = await Promise.all([
        loadArchiveStatus(directoryHandle, months),
        loadBackupHistory(directoryHandle),
        loadAutoBackupState(directoryHandle),
        loadAutoBackupSettings(directoryHandle),
      ]);
      setStatuses(statusList);
      setHistory(backupHistory);
      setAutoState(state);
      setAutoSettings(settings);
    } catch (error) {
      setMessage({
        type: "error",
        text: `تعذر تحميل بيانات الأرشيف: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [directoryHandle]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function handleBackup(): Promise<void> {
    if (!directoryHandle || !isAdmin) return;
    setIsBackingUp(true);
    setMessage(null);
    try {
      const months = await listMonthFolders(directoryHandle);
      const result = await createBackup(directoryHandle, months, username, "manual");
      if (result.ok) {
        setMessage({
          type: "ok",
          text: `تم إنشاء النسخة الاحتياطية في .system/backups/${result.folderName}`,
        });
        await refresh();
      } else {
        setMessage({ type: "error", text: `فشل النسخ الاحتياطي: ${result.error}` });
      }
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handleFrequencyChange(frequency: AutoBackupFrequency): Promise<void> {
    if (!directoryHandle || !isAdmin) return;
    setIsSavingSettings(true);
    setMessage(null);
    try {
      const result = await saveAutoBackupSettings(directoryHandle, frequency, username);
      if (result.ok) {
        setAutoSettings(result.settings);
        setMessage({ type: "ok", text: "تم تحديث فترة النسخ الاحتياطي التلقائي." });
      } else {
        setMessage({ type: "error", text: `تعذر حفظ إعدادات النسخ: ${result.error}` });
      }
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleRestore(folderName: string): Promise<void> {
    if (!directoryHandle || !isAdmin) return;
    setIsBackingUp(true);
    setMessage(null);
    try {
      const months = await listMonthFolders(directoryHandle);
      const result = await restoreBackupSnapshot({
        directoryHandle,
        months,
        backupFolderName: folderName,
        username,
      });
      if (result.ok) {
        setRestoreTarget(null);
        setMessage({
          type: "ok",
          text: `تمت الاستعادة من ${folderName}. تم إنشاء نسخة رجوع قبل الاستعادة: ${result.rollbackFolderName}`,
        });
        await refresh();
      } else {
        setMessage({ type: "error", text: `فشلت الاستعادة: ${result.error}` });
      }
    } finally {
      setIsBackingUp(false);
    }
  }

  const totals = useMemo(() => {
    return statuses.reduce(
      (acc, item) => ({
        months: acc.months + 1,
        populationRows: acc.populationRows + item.totalProcessedRows,
        sampleRows: acc.sampleRows + item.sampleRows,
        distributionRows: acc.distributionRows + item.distributionRows,
        answerItems: acc.answerItems + item.answerItems,
      }),
      { months: 0, populationRows: 0, sampleRows: 0, distributionRows: 0, answerItems: 0 }
    );
  }, [statuses]);

  if (!directoryHandle) {
    return (
      <section className="arc-page">
        <p className="arc-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return (
    <section className="arc-page" dir="rtl">
      <PageHeader
        eyebrow="Archive"
        title="الأرشيف"
        subtitle="نسخ احتياطي تلقائي للمدير، مع نسخ JSON كاملة وتصدير XLSX مجزأ للبيانات الكبيرة."
      >
        {isAdmin ? (
          <button
            type="button"
            className="arc-btn-primary"
            disabled={isBackingUp}
            onClick={() => { void handleBackup(); }}
          >
            {isBackingUp ? "جاري إنشاء النسخة..." : "نسخ احتياطي الآن"}
          </button>
        ) : null}
      </PageHeader>

      {message ? (
        <div className={message.type === "ok" ? "arc-msg-ok" : "arc-msg-error"} role="status">
          {message.text}
        </div>
      ) : null}

      <div className="arc-summary-grid">
        <SummaryTile label="الأشهر" value={formatNumber(totals.months)} />
        <SummaryTile label="صفوف المجتمع" value={formatNumber(totals.populationRows)} />
        <SummaryTile label="العينات" value={formatNumber(totals.sampleRows)} />
        <SummaryTile label="صفوف التوزيع" value={formatNumber(totals.distributionRows)} />
        <SummaryTile label="إجابات الفحص" value={formatNumber(totals.answerItems)} />
      </div>

      <div className="arc-layout">
        <section className="arc-panel arc-auto-panel">
          <div className="arc-panel-header">
            <div>
              <span className="arc-panel-kicker">Automatic Backup</span>
              <h2>النسخ الاحتياطي التلقائي</h2>
            </div>
            <span className={autoState ? "arc-state-ok" : "arc-state-waiting"}>
              {autoState ? "مفعّل" : "بانتظار أول نسخة"}
            </span>
          </div>
          <p>
            عند دخول المدير وبعد جاهزية مساحة العمل، يتم إنشاء نسخة تلقائياً حسب الفترة المحددة داخل
            <code>.system/backups</code>.
          </p>
          {isAdmin ? (
            <label className="arc-setting-row" htmlFor="backup-frequency">
              <span>فترة النسخ</span>
              <select
                id="backup-frequency"
                value={autoSettings?.frequency ?? "daily"}
                disabled={isSavingSettings}
                onChange={(event) => { void handleFrequencyChange(event.target.value as AutoBackupFrequency); }}
              >
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
              </select>
            </label>
          ) : (
            <div className="arc-setting-readonly">
              فترة النسخ: {autoSettings?.frequency === "weekly" ? "أسبوعي" : "يومي"}
            </div>
          )}
          <dl className="arc-meta-list">
            <div>
              <dt>الفترة الحالية</dt>
              <dd>{autoSettings?.frequency === "weekly" ? "أسبوعي" : "يومي"}</dd>
            </div>
            <div>
              <dt>آخر نسخة تلقائية</dt>
              <dd>{formatDateTime(autoState?.lastBackupAt)}</dd>
            </div>
            <div>
              <dt>المجلد</dt>
              <dd>{autoState?.lastBackupFolderName ?? "—"}</dd>
            </div>
            <div>
              <dt>بواسطة</dt>
              <dd>{autoState?.lastBackupBy ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="arc-panel">
          <div className="arc-panel-header">
            <div>
              <span className="arc-panel-kicker">Export Strategy</span>
              <h2>محتويات النسخة</h2>
            </div>
          </div>
          <ul className="arc-feature-list">
            <li>نسخ JSON كاملة لكل ملفات النظام والقوالب والأشهر، مع تجاهل مجلد النسخ القديمة.</li>
            <li>ملفات XLSX لكل شهر: المجتمع، الخام، العينة، التوزيع، سجل التوزيع، وإجابات الموظفين.</li>
            <li>تقسيم XLSX تلقائياً إلى أجزاء عند البيانات الكبيرة حتى لا يتجاوز أي ملف حد Excel.</li>
          </ul>
        </section>
      </div>

      <section className="arc-panel">
        <div className="arc-panel-header">
          <div>
            <span className="arc-panel-kicker">Processed Months</span>
            <h2>حالة الأشهر المعالجة</h2>
          </div>
          <button type="button" className="arc-btn-secondary" onClick={() => { void refresh(); }} disabled={isLoading}>
            {isLoading ? "جاري التحديث..." : "تحديث"}
          </button>
        </div>

        {isLoading ? (
          <p className="arc-empty">جاري التحميل...</p>
        ) : statuses.length === 0 ? (
          <div className="arc-empty">لا توجد أشهر معالجة في مساحة العمل.</div>
        ) : (
          <div className="arc-table-wrapper">
            <table className="arc-table">
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>الحالة</th>
                  <th>المجتمع</th>
                  <th>الخام</th>
                  <th>العينة</th>
                  <th>التوزيع</th>
                  <th>الإجابات</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((item) => (
                  <tr key={item.folderName}>
                    <td className="arc-month-name">{item.folderName}</td>
                    <td>
                      <span className={`arc-badge arc-badge-${item.manifestStatus ?? "none"}`}>
                        {statusLabel(item.manifestStatus)}
                      </span>
                    </td>
                    <td>{item.hasPopulation ? formatNumber(item.totalProcessedRows) : <span className="arc-miss">—</span>}</td>
                    <td>
                      {item.hasRawRisk || item.hasRawBi ? (
                        <span className="arc-compact">
                          {item.hasRawRisk ? "Risk" : ""}
                          {item.hasRawRisk && item.hasRawBi ? " / " : ""}
                          {item.hasRawBi ? "BI" : ""}
                        </span>
                      ) : (
                        <span className="arc-miss">—</span>
                      )}
                    </td>
                    <td>{item.hasSample ? formatNumber(item.sampleRows) : <span className="arc-miss">—</span>}</td>
                    <td>{item.hasDistribution ? formatNumber(item.distributionRows) : <span className="arc-miss">—</span>}</td>
                    <td>
                      {item.hasAnswers ? (
                        <span>{formatNumber(item.answerItems)} / {formatNumber(item.answerFiles)} ملف</span>
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
      </section>

      <section className="arc-panel">
        <div className="arc-panel-header">
          <div>
            <span className="arc-panel-kicker">Backup History</span>
            <h2>آخر النسخ الاحتياطية</h2>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="arc-empty">لا توجد نسخ احتياطية محفوظة بعد.</div>
        ) : (
          <div className="arc-history-list">
            {history.slice(0, 8).map((item) => (
              <article key={item.folderName} className="arc-history-item">
                <div>
                  <strong>{item.folderName}</strong>
                  <span>{formatDateTime(item.createdAt)} · {item.createdBy} · {modeLabel(item.mode)}</span>
                </div>
                <div className="arc-history-stats">
                  <span>{formatNumber(item.monthsCount)} شهر</span>
                  <span>{formatNumber(item.jsonFilesCount)} JSON</span>
                  <span>{formatNumber(item.xlsxFilesCount)} XLSX</span>
                  <span>{formatNumber(item.totalRows)} صف</span>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="arc-restore-btn"
                      disabled={isBackingUp}
                      onClick={() => setRestoreTarget(item)}
                    >
                      استعادة
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {restoreTarget ? (
        <RestoreDialog
          target={restoreTarget}
          busy={isBackingUp}
          onClose={() => setRestoreTarget(null)}
          onConfirm={() => { void handleRestore(restoreTarget.folderName); }}
        />
      ) : null}
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="arc-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RestoreDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: BackupHistoryItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typedName, setTypedName] = useState("");
  const [checked, setChecked] = useState(false);
  const canContinue = checked;
  const canRestore = typedName.trim() === target.folderName && !busy;

  return (
    <div className="arc-modal-backdrop" role="dialog" aria-modal="true">
      <div className="arc-restore-modal">
        <div className="arc-restore-header">
          <div>
            <span className="arc-panel-kicker">Restore Backup</span>
            <h2>استعادة نسخة احتياطية</h2>
          </div>
          <button type="button" className="arc-modal-close" onClick={onClose} aria-label="إغلاق">
            <X size={16} />
          </button>
        </div>

        {step === 1 ? (
          <>
            <div className="arc-restore-warning">
              <strong>{target.folderName}</strong>
              <p>
                سيتم إنشاء نسخة رجوع من النظام الحالي أولاً، ثم استعادة ملفات JSON من النسخة المحددة.
                يمكنك الرجوع لاحقاً من نسخة الرجوع التي ستظهر في السجل باسم قبل الاستعادة.
              </p>
            </div>
            <label className="arc-restore-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />
              <span>أفهم أن الاستعادة ستستبدل ملفات النظام الحالية بالقيم الموجودة في هذه النسخة.</span>
            </label>
            <div className="arc-restore-actions">
              <button type="button" className="arc-btn-secondary" onClick={onClose}>إلغاء</button>
              <button
                type="button"
                className="arc-btn-primary"
                disabled={!canContinue}
                onClick={() => setStep(2)}
              >
                متابعة التحقق
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="arc-restore-warning is-danger">
              <p>للتأكيد النهائي، اكتب اسم مجلد النسخة كما هو:</p>
              <code>{target.folderName}</code>
            </div>
            <input
              className="arc-restore-input"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={target.folderName}
              dir="ltr"
              autoFocus
            />
            <div className="arc-restore-actions">
              <button type="button" className="arc-btn-secondary" onClick={() => setStep(1)} disabled={busy}>
                رجوع
              </button>
              <button
                type="button"
                className="arc-btn-primary arc-btn-danger"
                disabled={!canRestore}
                onClick={onConfirm}
              >
                {busy ? "جاري الاستعادة..." : "استعادة الآن"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
