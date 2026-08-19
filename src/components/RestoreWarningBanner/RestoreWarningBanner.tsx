import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  isRestoreSentinelStale,
  readRestoreSentinel,
  type RestoreInProgressSentinel,
} from "../../data/backup/restoreSentinel";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { logRejection } from "../../data/storage/errorLogger";
import { useLabels } from "../../data/labels/useLabels";
import "./RestoreWarningBanner.css";

type Props = {
  directoryHandle: DirectoryHandleLike | null;
};

/**
 * Surfaces an INTERRUPTED restore.
 *
 * `restoreBackupSnapshot` writes `5-system/restore.inprogress.json` before its
 * destructive walk and removes it only on success, so a sentinel that is still
 * there means the workspace may be half-old and half-new. Nothing in the app
 * used to read that file: the evidence was written and then ignored, and a
 * mixed-epoch workspace looked exactly like a healthy one.
 *
 * Deliberately NOT wired through `bootProgress` — that area is effect-timing
 * sensitive and has regressed repeatedly (v59.190–v59.197). This is a plain
 * read-once-per-workspace effect that renders a banner, with no ordering
 * relationship to anything else in the shell.
 *
 * A sentinel younger than `RESTORE_SENTINEL_STALE_AFTER_MS` is left alone: a
 * restore running RIGHT NOW (here or on another machine) legitimately holds one
 * open, and warning about it would be wrong.
 */
export function RestoreWarningBanner({ directoryHandle }: Props) {
  const labels = useLabels();
  const [sentinel, setSentinel] = useState<RestoreInProgressSentinel | null>(null);

  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    // Promise-chain rather than an async effect body so setState lands in a
    // `.then` callback (same reason as useWorkspaceNotifications).
    readRestoreSentinel(directoryHandle)
      .then((found) => {
        if (cancelled) return;
        setSentinel(found !== null && isRestoreSentinelStale(found) ? found : null);
      })
      .catch(logRejection("restoreWarningBanner:readRestoreSentinel"));
    return () => {
      cancelled = true;
    };
  }, [directoryHandle]);

  if (!directoryHandle || !sentinel) return null;

  const text = labels.app_restore_interrupted_warning
    .replace("{startedBy}", sentinel.startedBy || labels.app_unknown_error)
    .replace("{startedAt}", sentinel.startedAt || labels.app_unknown_error);

  return (
    <div role="alert" dir="rtl" className="app-restore-warning">
      <span className="app-restore-warning-icon" aria-hidden>
        <AlertTriangle size={16} />
      </span>
      <span className="app-restore-warning-text">{text}</span>
    </div>
  );
}
