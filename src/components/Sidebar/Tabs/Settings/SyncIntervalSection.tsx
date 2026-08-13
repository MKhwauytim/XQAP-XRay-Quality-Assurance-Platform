import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";

import { readRealSession } from "../../../../auth/authSession";
import { usePermissions } from "../../../../auth/usePermissions";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import {
  MAX_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  isSyncIntervalInRange,
  saveSyncIntervalMs,
} from "../../../../data/workspace/syncSettings";
import {
  getSyncIntervalMs,
  refreshSyncIntervalFromDisk,
  subscribeToSyncInterval,
} from "../../../../data/workspace/workspaceSync";
// Deliberately reuses AdminAccountSection's stylesheet rather than cloning it:
// this is the same collapsible admin-settings card, and a second copy of those
// rules would only drift.
import "./AdminAccountSection.css";

const SYNC_INTERVAL_FEATURE = "settings.syncInterval";
const MIN_SECONDS = MIN_SYNC_INTERVAL_MS / 1000;
const MAX_SECONDS = MAX_SYNC_INTERVAL_MS / 1000;

type Feedback = { type: "ok" | "error"; text: string } | null;

/**
 * Admin-only editor for the workspace-wide automatic sync cadence
 * (`src/data/workspace/syncSettings.ts`).
 *
 * Gated exactly like `AdminAccountSection`: on the REAL session, so an admin
 * previewing another role cannot change a workspace-wide setting from inside
 * that preview. On top of that, the persistent action itself goes through the
 * centralized `canMutate` capability at BOTH boundaries — the input and button
 * are disabled when it denies, and `handleSave` re-checks before touching disk,
 * so a stale render can never be the thing that authorizes a write.
 *
 * The value shown is the EFFECTIVE one the sync path is actually using, not a
 * local guess: it is seeded from `getSyncIntervalMs()`, refreshed from disk on
 * mount, and kept live by `subscribeToSyncInterval` — so another admin's change
 * arriving on the next sync run updates this panel too.
 */
export function SyncIntervalSection() {
  const labels = useLabels();
  const realSession = readRealSession();
  const isRealAdmin = realSession?.role === "admin" && realSession.mode !== "demo";

  const { directoryHandle } = useWorkspace();
  const { canMutate } = usePermissions();

  const [isOpen, setIsOpen] = useState(false);
  const [effectiveMs, setEffectiveMs] = useState(getSyncIntervalMs);
  /**
   * `null` means "not edited — mirror the effective value". Storing the draft
   * this way (rather than copying `effectiveMs` into it via an effect) is what
   * keeps a sync run landing mid-edit from overwriting a half-typed number:
   * once the admin types, the draft stops following disk entirely. Clobbering
   * unsaved draft state on refresh is a bug this repo has already shipped once.
   */
  const [draftSeconds, setDraftSeconds] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!isRealAdmin) return;
    const unsubscribe = subscribeToSyncInterval(setEffectiveMs);
    void refreshSyncIntervalFromDisk(directoryHandle);
    return unsubscribe;
  }, [isRealAdmin, directoryHandle]);

  if (!isRealAdmin) return null;

  const inputValue = draftSeconds ?? String(effectiveMs / 1000);

  const canEdit = canMutate(SYNC_INTERVAL_FEATURE);
  const rangeHint = labels.settings_sync_range_hint
    .replace("{min}", String(MIN_SECONDS))
    .replace("{max}", String(MAX_SECONDS));

  async function handleSave(): Promise<void> {
    if (isSaving) return;
    // Handler-boundary capability check (the render-boundary one only disables
    // the controls).
    if (!canMutate(SYNC_INTERVAL_FEATURE)) {
      setFeedback({ type: "error", text: labels.settings_sync_no_permission });
      return;
    }
    setFeedback(null);

    const typed = inputValue.trim();
    const seconds = Number(typed);
    const candidateMs = seconds * 1000;
    // Whole seconds only. `isSyncIntervalInRange` alone would accept 20.5s
    // (20500ms is a perfectly legal integer millisecond count), but the field
    // is a seconds field with step=1 and a fractional cadence is noise, not a
    // feature — reject it here rather than silently storing it.
    if (
      typed === "" ||
      !Number.isInteger(seconds) ||
      !isSyncIntervalInRange(candidateMs)
    ) {
      setFeedback({
        type: "error",
        text: labels.settings_sync_invalid
          .replace("{min}", String(MIN_SECONDS))
          .replace("{max}", String(MAX_SECONDS)),
      });
      return;
    }

    if (!directoryHandle) {
      setFeedback({ type: "error", text: labels.settings_sync_no_workspace });
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveSyncIntervalMs(
        directoryHandle,
        candidateMs,
        realSession?.username ?? "admin"
      );
      if (!result.ok) {
        setFeedback({ type: "error", text: result.error || labels.settings_sync_save_failed });
        return;
      }
      // Publish immediately so THIS client re-arms without waiting for its own
      // next run; other clients pick it up on their next sync tick.
      await refreshSyncIntervalFromDisk(directoryHandle);
      // The draft is now what is on disk, so let it follow the effective value
      // again (e.g. if another admin changes it later).
      setDraftSeconds(null);
      setFeedback({ type: "ok", text: labels.settings_sync_saved });
    } catch (error) {
      logError("settings.syncInterval.save", error);
      setFeedback({ type: "error", text: labels.settings_sync_save_failed });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-account-section" dir="rtl">
      <button
        type="button"
        className={`admin-account-header${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="admin-account-icon"><RefreshCw size={16} /></span>
        <span className="admin-account-title">{labels.settings_sync_title}</span>
        <span className={`admin-account-chevron${isOpen ? " open" : ""}`}>
          <ChevronRight size={14} />
        </span>
      </button>

      {isOpen && (
        <div className="admin-account-body">
          <p className="admin-account-note">{labels.settings_sync_note}</p>
          <p className="admin-account-note">
            {labels.settings_sync_current.replace("{seconds}", String(effectiveMs / 1000))}
          </p>

          <div className="admin-account-password-fields">
            <label>
              <span>{labels.settings_sync_field}</span>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_SECONDS}
                max={MAX_SECONDS}
                step={1}
                value={inputValue}
                disabled={isSaving || !canEdit}
                onChange={(event) => setDraftSeconds(event.target.value)}
              />
            </label>
          </div>
          <p className="admin-account-hint">{rangeHint}</p>
          <p className="admin-account-hint">{labels.settings_sync_manual_note}</p>

          <button
            type="button"
            className="admin-account-save-btn"
            onClick={() => void handleSave()}
            disabled={isSaving || !canEdit}
            title={!canEdit ? labels.settings_sync_no_permission : undefined}
          >
            {isSaving ? labels.settings_sync_saving : labels.settings_sync_save}
          </button>

          {feedback && (
            <p
              className={`admin-account-feedback ${feedback.type}`}
              role={feedback.type === "error" ? "alert" : "status"}
            >
              {feedback.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
