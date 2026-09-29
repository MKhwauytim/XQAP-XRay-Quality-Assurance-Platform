/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";

import { readSession } from "../../../../auth/authSession";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { ModalShell } from "../../../../components/ModalShell/ModalShell";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { formatMonthFolderShortLabel, type MonthFolderInfo } from "../../../../data/population/monthFolder";
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
import { monthFoldersQueryOptions, invalidateMonthFolders } from "../../../../data/query/monthFoldersQuery";
import { closeMonth, reopenMonth } from "../../../../data/population/monthLock";
import { appendWorkspaceAction, recordAction } from "../../../../data/audit/actionLog";
import { syncUsersFromDisk } from "../../../../auth/userManagement";
import { getLabels } from "../../../../data/labels/labelsStore";
import { runMonthIntegrityScan } from "../../../../data/integrity/orphanScanLoader";
import type { OrphanScanResult } from "../../../../data/integrity/orphanScan";
import { LoadingState } from "../../../StateViews/StateViews";
import { importLabelsSnapshot } from "../../../../data/workspace/labelsSnapshot";
import { readJsonFile, type DirectoryHandleLike, type ReadJsonResult } from "../../../../data/storage/fileSystemAccess";
import { WORKSPACE_FILE_NAMES } from "../../../../data/workspace/workspaceDefaults";
import { getUserDataRoot } from "../../../../data/workspace/workspacePaths";
import type { UsersPermissionsFile } from "../../../../data/workspace/workspaceTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import { formatDateTime, formatNumber } from "../../../../utils/formatting";
import type { SidebarTabModule } from "../tabTypes";
import "./Archive.css";
import type { RestoreScope } from "../../../../data/backup/restoreScope";
import { runSelectiveRestore } from "../../../../data/backup/selectiveRestore";
import SelectiveRestorePanel, { type SelectiveRestoreSelection } from "./SelectiveRestorePanel";
import { describeSelectiveRestoreSuccess, fillTemplate } from "./selectiveRestoreText";
import {
  describeDerivedWarning,
  describeRestoreFailure,
  integrityNeedsAttention,
} from "../../../../data/backup/restoreMessages";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "archive",
  label: "إدارة الأرشيف",
  order: 30,
  allowedRoles: tabAllowedRoles("archive"),
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
  if (status === "closed") return getLabels().archive_month_closed_badge;
  return STATUS_LABELS[status] ?? status;
}

function modeLabel(mode: BackupHistoryItem["mode"]): string {
  if (mode === "automatic") return "تلقائي";
  if (mode === "pre-restore") return "قبل الاستعادة";
  return "يدوي";
}

export default function ArchiveTab() {
  const { directoryHandle } = useWorkspace();
  const { refreshMonths } = useGlobalMonth();
  const queryClient = useQueryClient();
  const session = readSession();
  const { canMutate } = usePermissions();
  const username = session?.username ?? "unknown";
  const canCreateBackup = canMutate("archive.createBackup");
  const canRestoreBackup = canMutate("archive.restoreBackup");
  const canCloseMonth = canMutate("archive.closeMonth");
  const mutationDeniedTitle = "يتطلب هذا الإجراء صلاحية التعديل ومساحة عمل قابلة للكتابة.";
  // wire-orphan-scan: read-only, so gated on role alone (no canMutate check —
  // there is nothing here to mutate) rather than a feature-permission entry.
  const isSupervisorPlus =
    session?.role === "supervisor" || session?.role === "manager" || session?.role === "admin";
  // Selective restore is admin-only (Workstream D), on top of canRestoreBackup.
  const isAdmin = session?.role === "admin";

  const [statuses, setStatuses] = useState<MonthArchiveStatus[]>([]);
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [autoState, setAutoState] = useState<AutoBackupState | null>(null);
  const [autoSettings, setAutoSettings] = useState<AutoBackupSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [includeXlsxExports, setIncludeXlsxExports] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupHistoryItem | null>(null);
  // Set right after a successful restore — offers the opt-in Item F import step.
  const [justRestored, setJustRestored] = useState(false);
  const [isImportingUsersLabels, setIsImportingUsersLabels] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "warn" | "error"; text: string } | null>(null);
  const [lockTarget, setLockTarget] = useState<{ folderName: string; mode: "close" | "reopen"; pendingCount: number } | null>(null);
  const [isLocking, setIsLocking] = useState(false);
  // Modal-scoped failure text for RestoreDialog/MonthLockDialog (item 1): kept
  // separate from `message` (which can hold unrelated, stale text from an
  // earlier action) so a dialog never shows another operation's leftover error.
  const [dialogError, setDialogError] = useState<string | null>(null);

  // wire-orphan-scan: on-demand, per-month, strictly read-only. `scanMonthOverride`
  // stays null until the admin explicitly picks a month, so the select's default
  // (latest processed month) is a plain derived value below — no effect needed to
  // seed it, which sidesteps this file's documented history of effect-timing bugs.
  const [scanMonthOverride, setScanMonthOverride] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<OrphanScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // refresh() fires from the mount effect, the manual "تحديث" button, and after
  // every mutating action (backup/restore/close/reopen) — those can overlap
  // (e.g. a manual refresh click while a backup's own post-success refresh is
  // still in flight). isLoadingRef is a synchronous re-entry guard (a ref, not
  // the isLoading STATE, so checking it can't itself trigger the effect below to
  // re-fire and loop); refreshTokenRef additionally makes sure that if two calls
  // ever do overlap, only the LATEST one's result is ever committed — mirrors
  // Population/index.tsx's loadMonthTokenRef pattern.
  const isLoadingRef = useRef(false);
  const refreshTokenRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!directoryHandle || isLoadingRef.current) return;
    isLoadingRef.current = true;
    const token = ++refreshTokenRef.current;
    setIsLoading(true);
    try {
      // Archive's refresh() is always a deliberate "show me the current
      // state" moment (mount, manual تحديث button, or right after this tab's
      // own backup/restore/close/reopen mutation) — invalidate before
      // fetching so `staleTime: Infinity` never serves another consumer's
      // (or this component's own earlier) cached month list here.
      await invalidateMonthFolders(queryClient, directoryHandle);
      const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
      const [statusList, backupHistory, state, settings] = await Promise.all([
        loadArchiveStatus(directoryHandle, months),
        loadBackupHistory(directoryHandle),
        loadAutoBackupState(directoryHandle),
        loadAutoBackupSettings(directoryHandle),
      ]);
      if (token !== refreshTokenRef.current) return; // superseded by a newer refresh
      setStatuses(statusList);
      setHistory(backupHistory);
      setAutoState(state);
      setAutoSettings(settings);
    } catch (error) {
      if (token !== refreshTokenRef.current) return;
      setMessage({
        type: "error",
        text: `تعذر تحميل بيانات الأرشيف: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      });
    } finally {
      if (token === refreshTokenRef.current) {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    }
  }, [directoryHandle, queryClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function handleBackup(): Promise<void> {
    if (!directoryHandle || !canCreateBackup) return;
    setIsBackingUp(true);
    setMessage(null);
    try {
      const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
      const result = await createBackup(directoryHandle, months, username, "manual", {
        includeXlsxExports,
      });
      if (result.ok) {
        // A snapshot that could not verify every copy is NOT a recovery point,
        // and saying "تم إنشاء النسخة الاحتياطية" for it is the exact
        // false assurance STO-5 was about. Name the files instead.
        const failed = result.manifest.filesFailedVerification ?? [];
        const partialText =
          failed.length > 0
            ? `${getLabels().backup_partial_warning}: ${failed.map((failure) => failure.path).join("، ")}`
            : null;
        // A snapshot with unverified files is still a real, logged event — the
        // entry records that it was partial rather than pretending it did not
        // happen, which is the same distinction the message below draws.
        recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-created", {
          target: result.folderName,
          details: { months: months.length, failedVerification: failed.length, includeXlsxExports },
        });
        setMessage({
          type: result.xlsxWarning || partialText ? "error" : "ok",
          text: partialText
            ? `${partialText} (${result.folderName})`
            : result.xlsxWarning
              ? `تم إنشاء نسخة JSON في .system/backups/${result.folderName}. ${result.xlsxWarning}`
              : `تم إنشاء النسخة الاحتياطية في .system/backups/${result.folderName}`,
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
    if (!directoryHandle || !canCreateBackup) return;
    setIsSavingSettings(true);
    setMessage(null);
    try {
      const result = await saveAutoBackupSettings(directoryHandle, frequency, username);
      if (result.ok) {
        setAutoSettings(result.settings);
        recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-settings-changed", {
          details: { frequency },
        });
        setMessage({ type: "ok", text: "تم تحديث فترة النسخ الاحتياطي التلقائي." });
      } else {
        setMessage({ type: "error", text: `تعذر حفظ إعدادات النسخ: ${result.error}` });
      }
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleMonthLockConfirm(note: string): Promise<void> {
    if (!directoryHandle || !canCloseMonth || !lockTarget) return;
    setIsLocking(true);
    setMessage(null);
    setDialogError(null);
    try {
      const { folderName, mode } = lockTarget;
      const result =
        mode === "close"
          ? await closeMonth(directoryHandle, folderName, username, note.trim() || undefined)
          : await reopenMonth(directoryHandle, folderName, username);
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: session?.role ?? "unknown",
          action: mode === "close" ? "month-closed" : "month-reopened",
          monthFolderName: folderName,
          details: note.trim() ? { note: note.trim() } : undefined,
        });
        void refreshMonths();
        setLockTarget(null);
        setMessage({
          type: "ok",
          text: mode === "close"
            ? `تم إقفال الشهر ${folderName}.`
            : `تمت إعادة فتح الشهر ${folderName}.`,
        });
        await refresh();
      } else {
        // Item 1: the dialog stays open on failure (only the success branch
        // above clears lockTarget) — its z-index:10020 backdrop fully covers
        // this top-level banner, so without dialogError the failure was
        // invisible. Set both: dialogError renders live inside the modal card,
        // message keeps the reason visible if the user then closes the dialog.
        setMessage({ type: "error", text: result.error });
        setDialogError(result.error);
      }
    } finally {
      setIsLocking(false);
    }
  }

  async function applySelectiveRestore(
    folderName: string,
    scope: RestoreScope,
    months: MonthFolderInfo[]
  ): Promise<void> {
    if (!directoryHandle) return;
    const outcome = await runSelectiveRestore({ directoryHandle, months, backupFolderName: folderName, username, scope });
    if (!outcome.ok) {
      const reason = outcome.reason === "plan-rejected" ? getLabels().archive_restore_plan_rejected : outcome.error;
      const started = outcome.reason === "restore-failed" ? outcome.rollbackFolderName : undefined;
      const text = describeRestoreFailure(getLabels(), reason, started);
      setMessage({ type: "error", text });
      setDialogError(text);
      if (started) {
        // The walk had begun: live data may have changed, so other views must re-read it.
        await refresh();
        broadcastDataRefresh("manual");
      }
      return;
    }
    recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-restored", {
      target: folderName,
      details: {
        rollbackFolderName: outcome.rollbackFolderName,
        selective: true,
        elements: scope.elements.join(","),
        months: scope.months.join(","),
        restoredFiles: outcome.restoredFiles.length,
      },
    });
    setRestoreTarget(null);
    // The users/labels import offer only makes sense when 3-user-data came back.
    setJustRestored(scope.elements.includes("usersPermissions"));
    const success = describeSelectiveRestoreSuccess(getLabels(), {
      folderName,
      restoredCount: outcome.restoredFiles.length,
      rollbackFolderName: outcome.rollbackFolderName,
      integrity: outcome.integrity,
    });
    const derived = outcome.derivedWarnings.map((warning) => describeDerivedWarning(getLabels(), warning));
    setMessage({
      type: derived.length > 0 || integrityNeedsAttention(outcome.integrity) ? "warn" : "ok",
      text: [success, ...derived].join(" "),
    });
    await refresh();
    // Same reasoning as the full restore below: a restore bypasses every normal write path.
    broadcastDataRefresh("manual");
  }

  async function handleRestore(folderName: string, scope: RestoreScope | null): Promise<void> {
    if (!directoryHandle || !canRestoreBackup) return;
    // Re-checked here, not only by hiding the mode switch (canMutate at both boundaries).
    if (scope && !isAdmin) return;
    setIsBackingUp(true);
    setMessage(null);
    setDialogError(null);
    try {
      const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
      if (scope) {
        await applySelectiveRestore(folderName, scope, months);
        return;
      }
      const result = await restoreBackupSnapshot({
        directoryHandle,
        months,
        backupFolderName: folderName,
        username,
      });
      if (result.ok) {
        // `backup-restored` has been a declared WorkspaceActionType with no call
        // site since it was introduced — the single most consequential
        // operation in the app (it overwrites live months from a snapshot) left
        // no trace in the very log meant to record it.
        recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-restored", {
          target: folderName,
          details: { rollbackFolderName: result.rollbackFolderName, months: months.length },
        });
        setRestoreTarget(null);
        setJustRestored(true);
        setMessage({
          type: "ok",
          text: `تمت الاستعادة من ${folderName}. تم إنشاء نسخة رجوع قبل الاستعادة: ${result.rollbackFolderName}`,
        });
        await refresh();
        // A restore overwrites live months directly on disk, bypassing every
        // normal write path (no writer bumps its epoch, no notifyLocalDataChange
        // fires) — so every OTHER mounted view (distribution, referrals,
        // answers, ...) would otherwise keep showing pre-restore state until
        // the next 45s sync tick, and even that tick's bounded-signature probe
        // is not guaranteed to catch every family a restore can touch (e.g.
        // answers.events, which has no persisted checkpoint of its own — see
        // backupStorage.ts's restore-scope comment). "manual" is the same
        // full-cache-discard signal the admin toolbar's refresh button sends,
        // which is the correct scope for the single most consequential
        // operation in the app.
        broadcastDataRefresh("manual");
      } else {
        // Item 1: see the matching comment in handleMonthLockConfirm — the
        // restore dialog also stays open on failure and sits under the same
        // modal backdrop, so the failure needs its own in-modal rendering.
        const text = `${getLabels().archive_restore_failed_prefix}: ${result.error}`;
        setMessage({ type: "error", text });
        setDialogError(text);
      }
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handleImportUsersLabels(): Promise<void> {
    if (!directoryHandle || !canRestoreBackup) return;
    setIsImportingUsersLabels(true);
    setMessage(null);
    try {
      // getUserDataRoot(..., false) throws on a legacy workspace with no
      // 3-user-data/ folder (no legacy-root fallback for it — see
      // workspacePaths.getRoot). Isolate that from the labels import below: a
      // missing users file must not also skip the (independently readable)
      // labels snapshot, and either way the failure must surface instead of
      // becoming a silent unhandled rejection behind `void handleImportUsersLabels()`.
      let usersResult: ReadJsonResult<UsersPermissionsFile> | null = null;
      let usersError: string | null = null;
      try {
        const userDataDir = await getUserDataRoot(directoryHandle, false);
        usersResult = await readJsonFile<UsersPermissionsFile>(userDataDir, WORKSPACE_FILE_NAMES.usersPermissions);
      } catch (error) {
        usersError = error instanceof Error ? error.message : "خطأ غير معروف";
      }

      const labelsAppliedCount = await importLabelsSnapshot(directoryHandle);

      if (usersResult?.ok) {
        syncUsersFromDisk(
          usersResult.file.data.users.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            passwordHash: u.passwordHash,
            role: u.role,
            isActive: u.isActive,
            hasCertScanLicense: u.hasCertScanLicense,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          })),
          usersResult.file.data.permissions,
          usersResult.file.data.featurePermissions,
          // Restore the admin passcode / sign-in setting from the backup too;
          // omitting it would silently reset the admin account to its defaults.
          usersResult.file.data.adminAccount
        );
        setJustRestored(false);
        setMessage({
          type: "ok",
          text: `${getLabels().backup_import_users_labels_done} (${formatNumber(labelsAppliedCount)} تسمية مخصصة مطبّقة)`,
        });
      } else {
        // Only the "ok" success message claims users/permissions were imported —
        // a missing/corrupt/unreadable users file must not report success.
        setMessage({
          type: "error",
          text: usersError
            ? `تعذر استيراد المستخدمين والصلاحيات: ${usersError} (تم تطبيق ${formatNumber(labelsAppliedCount)} تسمية مخصصة فقط).`
            : `تعذر قراءة ملف المستخدمين والصلاحيات من النسخة (تم تطبيق ${formatNumber(labelsAppliedCount)} تسمية مخصصة فقط).`,
        });
      }
    } catch (error) {
      // Safety net for anything unexpected outside the inner getUserDataRoot/
      // readJsonFile guard above (importLabelsSnapshot/syncUsersFromDisk are not
      // expected to throw, but a silent unhandled rejection behind
      // `void handleImportUsersLabels()` must never be the failure mode here).
      setMessage({
        type: "error",
        text: `تعذر استيراد المستخدمين والتسميات: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      });
    } finally {
      setIsImportingUsersLabels(false);
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

  // wire-orphan-scan: default to the most recently processed month (statuses
  // is index-addressed in listMonthFolders' chronological order — see
  // loadArchiveStatus above), until the admin picks a different one.
  const scanMonth = scanMonthOverride ?? statuses[statuses.length - 1]?.folderName ?? "";

  async function handleRunIntegrityScan(): Promise<void> {
    if (!directoryHandle || !scanMonth) return;
    setIsScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const result = await runMonthIntegrityScan(directoryHandle, scanMonth);
      setScanResult(result);
    } catch (error) {
      setScanError(
        `${getLabels().archive_integrity_error_prefix}: ${error instanceof Error ? error.message : "خطأ غير معروف"}`
      );
    } finally {
      setIsScanning(false);
    }
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
      <PageHeader
        eyebrow="حفظ السجلات"
        title="الأرشيف"
        subtitle="نسخ احتياطي سريع وموثوق للمدير، مع حفظ ملفات JSON الكاملة القابلة للاستعادة."
      >
        <button
            type="button"
            className="arc-btn-primary"
            disabled={isBackingUp || !canCreateBackup}
            title={!canCreateBackup ? mutationDeniedTitle : undefined}
            onClick={() => { void handleBackup(); }}
          >
            {isBackingUp ? "جاري إنشاء النسخة..." : "نسخ احتياطي الآن"}
          </button>
      </PageHeader>

      {canCreateBackup ? (
        <label className="arc-backup-export-option">
          <input
            type="checkbox"
            checked={includeXlsxExports}
            disabled={isBackingUp}
            onChange={(event) => setIncludeXlsxExports(event.target.checked)}
          />
          <span>
            <strong>{getLabels().backup_include_xlsx_option}</strong>
            <small>{getLabels().backup_include_xlsx_hint}</small>
          </span>
        </label>
      ) : null}

      {message ? (
        <div className={message.type === "ok" ? "arc-msg-ok" : message.type === "warn" ? "arc-msg-warn" : "arc-msg-error"} role="status">
          {message.text}
        </div>
      ) : null}

      {justRestored ? (
        <div className="arc-msg-ok" role="status">
          <button
            type="button"
            className="arc-btn-secondary"
            disabled={isImportingUsersLabels || !canRestoreBackup}
            title={!canRestoreBackup ? mutationDeniedTitle : undefined}
            onClick={() => { void handleImportUsersLabels(); }}
          >
            {isImportingUsersLabels ? "جاري الاستيراد..." : getLabels().backup_import_users_labels_btn}
          </button>
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
              <span className="arc-panel-kicker">النسخ التلقائي</span>
              <h2>النسخ الاحتياطي التلقائي</h2>
            </div>
            <span className={autoState ? "arc-state-ok" : "arc-state-waiting"}>
              {autoState ? "مفعّل" : "بانتظار أول نسخة"}
            </span>
          </div>
          <p>
            {/* Wave 1 extended the createDailyAdminBackupIfDue trigger (App.tsx) from
                admin-only to admin || manager — this copy is updated to match. */}
            عند دخول المدير أو المسؤول وبعد جاهزية مساحة العمل، يتم إنشاء نسخة تلقائياً حسب الفترة المحددة داخل
            <code>.system/backups</code>.
          </p>
          {canCreateBackup ? (
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
              <span className="arc-panel-kicker">سياسة التصدير</span>
              <h2>محتويات النسخة</h2>
            </div>
          </div>
          <ul className="arc-feature-list">
            <li>نسخ JSON كاملة لكل ملفات النظام والقوالب والأشهر، مع تجاهل مجلد النسخ القديمة.</li>
            <li>تحتوي ملفات JSON على جميع البيانات اللازمة للاستعادة دون إنشاء نسخ XLSX مكررة وبطيئة.</li>
            <li>يمكن تصدير البيانات للعرض والتحليل من أدوات التقارير المخصصة بشكل مستقل.</li>
          </ul>
        </section>
      </div>

      <section className="arc-panel">
        <div className="arc-panel-header">
          <div>
            <span className="arc-panel-kicker">الأشهر المعالجة</span>
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
                  {canCloseMonth ? <th>الإجراءات</th> : null}
                </tr>
              </thead>
              <tbody>
                {statuses.map((item) => (
                  <tr key={item.folderName}>
                    <td className="arc-month-name">{formatMonthFolderShortLabel(item.folderName)}</td>
                    <td>
                      <span className={`arc-badge arc-badge-${item.manifestStatus ?? "none"}`}>
                        {statusLabel(item.manifestStatus)}
                      </span>
                    </td>
                    <td>{item.hasPopulation ? formatNumber(item.totalProcessedRows) : <span className="arc-miss">—</span>}</td>
                    <td>
                      {item.hasRawRisk || item.hasRawBi ? (
                        <span className="arc-compact">
                          {item.hasRawRisk ? "المخاطر" : ""}
                          {item.hasRawRisk && item.hasRawBi ? " / " : ""}
                          {item.hasRawBi ? "BI" : ""}
                        </span>
                      ) : (
                        <span className="arc-miss">—</span>
                      )}
                    </td>
                    <td>{item.hasSample ? formatNumber(item.sampleRows) : <span className="arc-miss">—</span>}</td>
                    <td>
                      {item.hasDistribution ? (
                        <>
                          {formatNumber(item.distributionRows)}
                          <span className="arc-compact arc-distribution-breakdown">
                            {getLabels().archive_distribution_completed_label} {formatNumber(item.distributionCompleted)}
                            {" · "}
                            {getLabels().archive_distribution_pending_label} {formatNumber(item.distributionPending)}
                          </span>
                        </>
                      ) : (
                        <span className="arc-miss">—</span>
                      )}
                    </td>
                    <td>
                      {item.hasAnswers ? (
                        <span>{formatNumber(item.answerItems)} / {formatNumber(item.answerFiles)} ملف</span>
                      ) : (
                        <span className="arc-miss">—</span>
                      )}
                    </td>
                    {canCloseMonth ? (
                      <td>
                        {item.manifestStatus === "closed" ? (
                          <button
                            type="button"
                            className="arc-btn-secondary"
                            disabled={isLocking}
                            onClick={() => { setDialogError(null); setLockTarget({ folderName: item.folderName, mode: "reopen", pendingCount: item.distributionPending }); }}
                          >
                            {getLabels().archive_reopen_month_btn}
                          </button>
                        ) : item.hasManifest ? (
                          <button
                            type="button"
                            className="arc-btn-secondary"
                            disabled={isLocking}
                            onClick={() => { setDialogError(null); setLockTarget({ folderName: item.folderName, mode: "close", pendingCount: item.distributionPending }); }}
                          >
                            {getLabels().archive_close_month_btn}
                          </button>
                        ) : (
                          <span className="arc-miss">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isSupervisorPlus ? (
        <section className="arc-panel">
          <div className="arc-panel-header">
            <div>
              <span className="arc-panel-kicker">{getLabels().archive_integrity_kicker}</span>
              <h2>{getLabels().archive_integrity_title}</h2>
            </div>
          </div>
          <p>{getLabels().archive_integrity_subtitle}</p>

          {statuses.length === 0 ? (
            <div className="arc-empty">{getLabels().archive_integrity_no_months}</div>
          ) : (
            <>
              <div className="arc-integrity-controls">
                <label className="arc-setting-row" htmlFor="integrity-scan-month">
                  <span>{getLabels().archive_integrity_month_label}</span>
                  <select
                    id="integrity-scan-month"
                    value={scanMonth}
                    disabled={isScanning}
                    onChange={(event) => setScanMonthOverride(event.target.value)}
                  >
                    {statuses.map((item) => (
                      <option key={item.folderName} value={item.folderName}>
                        {formatMonthFolderShortLabel(item.folderName)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="arc-btn-secondary"
                  disabled={isScanning || !scanMonth}
                  onClick={() => { void handleRunIntegrityScan(); }}
                >
                  {isScanning ? getLabels().archive_integrity_running : getLabels().archive_integrity_run_btn}
                </button>
              </div>

              {isScanning ? <LoadingState bare label={getLabels().archive_integrity_running} /> : null}

              {!isScanning && scanError ? (
                <div className="arc-msg-error" role="alert">
                  {scanError}
                </div>
              ) : null}

              {!isScanning && scanResult ? (
                scanResult.clean ? (
                  <div className="arc-msg-ok" role="status">
                    {getLabels().archive_integrity_clean}
                  </div>
                ) : (
                  <div className="arc-integrity-results">
                    <OrphanCategoryList label={getLabels().archive_integrity_category_sample} ids={scanResult.sampleOrphans} />
                    <OrphanCategoryList label={getLabels().archive_integrity_category_distribution} ids={scanResult.distributionOrphans} />
                    <OrphanCategoryList label={getLabels().archive_integrity_category_answers} ids={scanResult.answersOrphans} />
                    <OrphanCategoryList label={getLabels().archive_integrity_category_approvals} ids={scanResult.approvalsOrphans} />
                  </div>
                )
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section className="arc-panel">
        <div className="arc-panel-header">
          <div>
            <span className="arc-panel-kicker">سجل النسخ الاحتياطية</span>
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
                  <span>
                    {formatDateTime(item.createdAt)} · {item.createdBy} · {modeLabel(item.mode)}
                    {item.status === "partial"
                      ? ` · ${getLabels().backup_partial_badge} (${formatNumber(item.failedFilesCount)})`
                      : ""}
                  </span>
                </div>
                <div className="arc-history-stats">
                  <span>{formatNumber(item.monthsCount)} شهر</span>
                  <span>{formatNumber(item.jsonFilesCount)} JSON</span>
                  <span>{formatNumber(item.xlsxFilesCount)} XLSX</span>
                  <span>{formatNumber(item.totalRows)} صف</span>
                  <button
                      type="button"
                      className="arc-restore-btn"
                      disabled={isBackingUp || !canRestoreBackup}
                      title={!canRestoreBackup ? mutationDeniedTitle : undefined}
                      onClick={() => { setDialogError(null); setRestoreTarget(item); }}
                    >
                      استعادة
                    </button>
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
          error={dialogError}
          allowSelective={isAdmin}
          directoryHandle={directoryHandle}
          onClose={() => setRestoreTarget(null)}
          onConfirm={(scope) => { void handleRestore(restoreTarget.folderName, scope); }}
        />
      ) : null}

      {lockTarget ? (
        <MonthLockDialog
          folderName={lockTarget.folderName}
          mode={lockTarget.mode}
          pendingCount={lockTarget.pendingCount}
          busy={isLocking}
          error={dialogError}
          onClose={() => setLockTarget(null)}
          onConfirm={(note) => { void handleMonthLockConfirm(note); }}
        />
      ) : null}
    </section>
  );
}

function MonthLockDialog({
  folderName,
  mode,
  pendingCount,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  folderName: string;
  mode: "close" | "reopen";
  pendingCount: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const L = getLabels();
  const isClose = mode === "close";
  // Close note is optional; reopen reason is mandatory.
  const canConfirm = !busy && (isClose || note.trim().length > 0);

  return (
    <ModalShell
      variant="arc"
      eyebrow={L.archive_month_action_kicker}
      title={isClose ? L.archive_close_month_btn : L.archive_reopen_month_btn}
      onClose={onClose}
    >
        {error ? (
        <div className="arc-modal-error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Scroll body: `.arc-restore-modal` sets no height bound at all, so a
          long confirmation body (the close-month warning plus the pending-count
          line, at large text sizes or on a short/landscape viewport) grew the
          panel past the viewport and carried the action row off-screen with it.
          Bounding the body and scrolling it keeps the actions reachable —
          ConfirmDialog does the same thing one level up, on the panel. */}
      <div style={{ maxHeight: "min(52vh, 420px)", overflowY: "auto" }} data-testid="month-lock-scroll">
        <div className={`arc-restore-warning${isClose ? " is-danger" : ""}`}>
          <strong>{folderName}</strong>
          <p>{isClose ? L.archive_close_month_confirm : L.archive_reopen_month_confirm}</p>
          {isClose && pendingCount > 0 ? (
            <p>{fillTemplate(L.archive_close_month_confirm_pending, { pending: formatNumber(pendingCount) })}</p>
          ) : null}
        </div>

        <input
          className="arc-restore-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={isClose ? L.archive_close_note_placeholder : L.archive_reopen_reason_placeholder}
        />
      </div>

      <div className="arc-restore-actions">
        <button type="button" className="arc-btn-secondary" onClick={onClose} disabled={busy}>
          إلغاء
        </button>
        <button
          type="button"
          className={`arc-btn-primary${isClose ? " arc-btn-danger" : ""}`}
          disabled={!canConfirm}
          onClick={() => onConfirm(note)}
        >
          {busy
            ? "جاري التنفيذ..."
            : isClose
              ? L.archive_close_month_btn
              : L.archive_reopen_month_btn}
        </button>
      </div>
    </ModalShell>
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

/** wire-orphan-scan: one collapsible category row — id list capped at 100
 *  shown, with the remainder summarized rather than dumping an unbounded list
 *  into the DOM. Strictly a display of `scanReferentialIntegrity`'s output —
 *  no action, no mutation. */
const ORPHAN_IDS_SHOWN_CAP = 100;

function OrphanCategoryList({ label, ids }: { label: string; ids: string[] }) {
  const hasOrphans = ids.length > 0;
  const shown = ids.slice(0, ORPHAN_IDS_SHOWN_CAP);
  const remaining = ids.length - shown.length;
  return (
    <details className="arc-integrity-category" open={hasOrphans}>
      <summary>
        <span>{label}</span>
        <span className={hasOrphans ? "arc-integrity-count-bad" : "arc-integrity-count-ok"}>
          {formatNumber(ids.length)}
        </span>
      </summary>
      {hasOrphans ? (
        <ul className="arc-integrity-id-list">
          {shown.map((id) => (
            <li key={id}>{id}</li>
          ))}
          {remaining > 0 ? (
            <li className="arc-integrity-more">
              {fillTemplate(getLabels().archive_integrity_show_more, { count: formatNumber(remaining) })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </details>
  );
}

function RestoreDialog({
  target,
  busy,
  error,
  allowSelective,
  directoryHandle,
  onClose,
  onConfirm,
}: {
  target: BackupHistoryItem;
  busy: boolean;
  error: string | null;
  /** Selective restore is admin-only (Workstream D). */
  allowSelective: boolean;
  directoryHandle: DirectoryHandleLike | null;
  onClose: () => void;
  onConfirm: (scope: RestoreScope | null) => void;
}) {
  const L = getLabels();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"full" | "selective">("full");
  const [selection, setSelection] = useState<SelectiveRestoreSelection | null>(null);
  const [typedName, setTypedName] = useState("");
  const [checked, setChecked] = useState(false);
  const canChooseMode = allowSelective && directoryHandle !== null;
  const selective = canChooseMode && mode === "selective";
  const canContinue = checked && (!selective || selection !== null);
  const canRestore = typedName.trim() === target.folderName && !busy && (!selective || selection !== null);

  function chooseMode(next: "full" | "selective"): void {
    setMode(next);
    setSelection(null);
  }

  return (
    <ModalShell
      variant="arc"
      eyebrow="استعادة النسخة"
      title="استعادة نسخة احتياطية"
      onClose={onClose}
    >
      {error ? (
        <div className="arc-modal-error" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <>
          {canChooseMode ? (
            <fieldset className="arc-restore-mode">
              <legend>{L.archive_restore_mode_label}</legend>
              <label className="arc-restore-option">
                <input
                  type="radio"
                  name="arc-restore-mode"
                  checked={mode === "full"}
                  onChange={() => chooseMode("full")}
                />
                <span>{L.archive_restore_mode_full}</span>
              </label>
              <label className="arc-restore-option">
                <input
                  type="radio"
                  name="arc-restore-mode"
                  checked={mode === "selective"}
                  onChange={() => chooseMode("selective")}
                />
                <span>{L.archive_restore_mode_selective}</span>
              </label>
            </fieldset>
          ) : null}
          <div className="arc-restore-warning">
            <strong>{target.folderName}</strong>
            <p>
              سيتم إنشاء نسخة رجوع من النظام الحالي أولاً، ثم استعادة ملفات JSON من النسخة المحددة.
              يمكنك الرجوع لاحقاً من نسخة الرجوع التي ستظهر في السجل باسم قبل الاستعادة.
            </p>
            <p>{L.backup_restore_merge_notice}</p>
          </div>
        </>
      ) : null}

      {/* Kept mounted (just hidden) across step 2 so "رجوع" returns to the same selection. */}
      {selective && directoryHandle ? (
        <div hidden={step !== 1}>
          <SelectiveRestorePanel
            directoryHandle={directoryHandle}
            backupFolderName={target.folderName}
            onSelectionChange={setSelection}
          />
        </div>
      ) : null}

      {step === 1 ? (
        <>
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
              onClick={() => onConfirm(selective ? selection?.scope ?? null : null)}
            >
              {busy ? "جاري الاستعادة..." : "استعادة الآن"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
