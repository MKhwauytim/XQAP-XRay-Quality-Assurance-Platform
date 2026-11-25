import { useState } from "react";
import { ConfirmDialog } from "../../../../../ConfirmDialog/ConfirmDialog";
import { recordAction } from "../../../../../../data/audit/actionLog";
import { useLabels } from "../../../../../../data/labels/useLabels";
import { submitReopenRequests, type BulkReopenCase } from "../../../../../../data/referral/requestReopen";
import { logError } from "../../../../../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/**
 * «طلب إعادة فتح الكل المطابق للتصفية» (see `submitReopenRequests`): the bulk
 * form of the inspection panel's «طلب إعادة فتح الحالة». `cases` are the
 * employee's own submitted cases among the rows the queue currently shows, so
 * the number on the button is the number of cases the click acts on.
 */
export function ReopenFilteredButton({
  directoryHandle,
  cases,
  username,
  role,
  instant,
  onDone,
}: {
  directoryHandle: DirectoryHandleLike;
  cases: readonly BulkReopenCase[];
  username: string;
  role: string;
  /** The role's `employee-reopen-instant` feature: reopen at once, no approval. */
  instant: boolean;
  onDone: (instant: boolean) => void;
}) {
  const L = useLabels();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const count = cases.length.toLocaleString("ar-SA-u-nu-latn");

  async function run(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) return;
    setOpen(false);
    setBusy(true);
    setNotice("");
    try {
      const result = await submitReopenRequests({
        directoryHandle, cases, requestedBy: username, requestedByRole: role, reason: trimmed, instant,
      });
      // Instant reopens are already logged one by one as `answer-reopened`.
      if (result.requested > 0) {
        recordAction(directoryHandle, username, role, "reopen-requested", {
          details: { kind: "queue-bulk-reopen-request", requested: result.requested, skippedPending: result.skippedPending, failed: result.failed, reason: trimmed },
        });
      }
      setNotice(
        fill(instant ? L.ew_reopen_filtered_done_instant : L.ew_reopen_filtered_done, { ...result, firstError: "" }) +
          (result.failed > 0 ? fill(L.ew_reopen_filtered_failed, { failed: result.failed, error: result.firstError ?? "" }) : "")
      );
      setReason("");
      onDone(instant);
    } catch (error) {
      logError("referrals:bulk-reopen-request", error);
      setNotice(fill(L.ew_reopen_filtered_failed, { failed: cases.length, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ew-btn-secondary ew-btn-sm"
        title={cases.length === 0 ? L.ew_reopen_filtered_none : L.ew_reopen_filtered_title}
        disabled={busy || cases.length === 0}
        aria-busy={busy}
        onClick={() => setOpen(true)}
      >
        {fill(L.ew_reopen_filtered_btn, { n: count })}
      </button>
      {notice && <span role="status" className="ew-move-notice">{notice}</span>}
      <ConfirmDialog
        open={open}
        title={fill(L.ew_reopen_filtered_btn, { n: count })}
        message={
          <>
            <p>{fill(instant ? L.ew_reopen_filtered_confirm_instant : L.ew_reopen_filtered_confirm, { n: count })}</p>
            <textarea
              className="ip-input ip-textarea"
              rows={2}
              aria-label={L.ip_reopen_reason_placeholder}
              placeholder={L.ip_reopen_reason_placeholder}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </>
        }
        confirmLabel={L.ew_reopen_request_btn}
        onConfirm={() => void run()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
