import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { flushAnswersNow } from "../../../../../../data/answers/answerOutbox";
import { discardPendingAnswers } from "../../../../../../data/answers/answerLocalMirror";
import { ConfirmDialog } from "../../../../../ConfirmDialog/ConfirmDialog";
import {
  exportUnsentAnswers,
  importUnsentAnswers,
  parseUnsentAnswersFile,
  unsentAnswersFileName,
} from "../../../../../../data/answers/unsentAnswersFile";
import { usePendingAnswerCount } from "../../../../../../data/answers/usePendingAnswerCount";
import { notifyLocalDataChange } from "../../../../../../data/workspace/dataRefreshSignal";
import { logError } from "../../../../../../data/storage/errorLogger";
import { ensureDirectoryPermission, type DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { useLabels } from "../../../../../../data/labels/useLabels";
import { downloadJson } from "../../../../../../utils/downloadFile";
import { SEND_NOW_SLOW_MS, describeFlushResult, flushLeftAnswersBehind } from "./sendNowResult";

type SendState = "idle" | "sending" | "slow" | "done";

function errorText(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}

/**
 * «N answers not yet sent» notice. «إرسال الآن» first asks the browser for
 * write access to the workspace (the click is the user gesture that request
 * needs; a background pass cannot ask), then sends and reports each outcome.
 * «تنزيل نسخة» saves every unsent answer to a file, and «استيراد» queues such a
 * file on this PC — so answers a broken PC cannot send can be sent from
 * another one, signed in as the same employee. With nothing pending only the
 * import is shown.
 */
export default function PendingAnswersBanner({ directoryHandle, username }: {
  directoryHandle: DirectoryHandleLike; username: string;
}): ReactElement {
  const L = useLabels();
  // Every folder, not just the selected month: ad-hoc rows queue under their own `adhoc-*` store.
  const unsent = usePendingAnswerCount({ username });
  const [state, setState] = useState<SendState>("idle");
  const [result, setResult] = useState<string[]>([]);
  const [offerBackup, setOfferBackup] = useState(false);
  // Months the last send found no folder for (deleted from the workspace):
  // their answers can never land, so the employee may discard them (after a copy).
  const [missingMonths, setMissingMonths] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  const finish = (lines: string[], backup = false): void => {
    if (!mounted.current) return;
    setResult(lines);
    setOfferBackup(backup);
    setState("done");
  };

  const sendNow = async (before: string[] = []): Promise<void> => {
    setState("sending");
    setResult([]);
    const granted = await ensureDirectoryPermission(directoryHandle, "readwrite").catch(() => false);
    if (!granted) { finish([...before, L.ew_answers_send_permission], true); return; }
    const slowTimer = setTimeout(() => { if (mounted.current) setState("slow"); }, SEND_NOW_SLOW_MS);
    try {
      const summary = await flushAnswersNow(directoryHandle, username);
      if (mounted.current) setMissingMonths(summary.blocked?.["folder-missing"]?.months ?? []);
      finish([...before, ...describeFlushResult(summary, L)], flushLeftAnswersBehind(summary));
    } catch (error) {
      logError("answers:send-now", error);
      finish([...before, L.ew_answers_send_failed.replace("{count}", String(unsent)).replace("{error}", errorText(error))], true);
    } finally {
      clearTimeout(slowTimer);
    }
  };

  const downloadBackup = async (): Promise<void> => {
    try {
      const file = await exportUnsentAnswers(username);
      downloadJson(file, unsentAnswersFileName(username));
    } catch (error) {
      logError("answers:export-unsent", error);
      finish([L.ew_answers_backup_failed], true);
    }
  };

  const discardMissing = async (): Promise<void> => {
    setConfirmDiscard(false);
    const months = missingMonths;
    if (months.length === 0) return;
    setState("sending");
    try {
      // A copy of every unsent answer first, so a folder that was only
      // mistaken for deleted (the wrong workspace folder open) loses nothing.
      downloadJson(await exportUnsentAnswers(username), unsentAnswersFileName(username));
      const discarded = await discardPendingAnswers(username, months);
      notifyLocalDataChange(["answers"]);
      setMissingMonths([]);
      finish([L.ew_answers_discard_done.replace("{count}", String(discarded)).replace("{months}", months.join("، "))]);
    } catch (error) {
      logError("answers:discard-missing-months", error);
      finish([L.ew_answers_backup_failed], true);
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseUnsentAnswersFile(await file.text(), username);
      if (!parsed.ok) {
        finish([parsed.reason === "other-user"
          ? L.ew_answers_import_other_user.replace("{user}", parsed.fileUser)
          : L.ew_answers_import_invalid]);
        return;
      }
      const stored = await importUnsentAnswers(username, parsed.answers);
      notifyLocalDataChange(["answers"]);
      const done = L.ew_answers_import_done.replace("{count}", String(stored));
      if (stored > 0) await sendNow([done]);
      else finish([done]);
    } catch (error) {
      logError("answers:import-unsent", error);
      finish([L.ew_answers_import_invalid]);
    }
  };

  const busy = state === "sending" || state === "slow";
  const importControl = (
    <>
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>{L.ew_answers_import}</button>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importBackup(e)} />
    </>
  );

  if (unsent <= 0 && state !== "done") {
    return <p className="ew-import-unsent" dir="rtl">{importControl}</p>;
  }
  return (
    <div className="ew-msg-warn ew-pending-sync" role="status" dir="rtl">
      {unsent > 0 && (
        <p>
          {L.ew_answers_pending_sync.replace("{count}", String(unsent))}
          <button type="button" onClick={() => void sendNow()} disabled={busy}>
            {busy ? L.ew_answers_sending : L.ew_answers_send_now}
          </button>
          {(offerBackup || state === "done") && (
            <button type="button" onClick={() => void downloadBackup()} disabled={busy}>{L.ew_answers_backup}</button>
          )}
          {importControl}
        </p>
      )}
      {state === "slow" && <p>{L.ew_answers_send_slow}</p>}
      {state === "done" && result.map((line) => <p key={line}>{line}</p>)}
      {state === "done" && offerBackup && unsent > 0 && <p>{L.ew_answers_backup_hint}</p>}
      {state === "done" && missingMonths.length > 0 && unsent > 0 && (
        <p>
          <button type="button" onClick={() => setConfirmDiscard(true)}>
            {L.ew_answers_discard_missing.replace("{months}", missingMonths.join("، "))}
          </button>
        </p>
      )}
      <ConfirmDialog
        open={confirmDiscard}
        danger
        title={L.ew_answers_discard_missing.replace("{months}", missingMonths.join("، "))}
        message={<p>{L.ew_answers_discard_confirm.replace("{months}", missingMonths.join("، "))}</p>}
        onConfirm={() => void discardMissing()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
