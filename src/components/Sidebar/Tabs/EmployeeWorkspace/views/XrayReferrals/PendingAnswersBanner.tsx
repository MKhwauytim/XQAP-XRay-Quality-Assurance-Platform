import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { flushAnswersNow } from "../../../../../../data/answers/answerOutbox";
import { usePendingAnswerCount } from "../../../../../../data/answers/usePendingAnswerCount";
import { logError } from "../../../../../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { SEND_NOW_SLOW_MS, describeFlushResult } from "./sendNowResult";
import { useLabels } from "../../../../../../data/labels/useLabels";

/** «N answers not yet sent» notice with a "send now" action that reports its outcome; renders nothing at 0. */
type SendState = "idle" | "sending" | "slow" | "done";

export default function PendingAnswersBanner({ directoryHandle, username }: {
  directoryHandle: DirectoryHandleLike; username: string;
}): ReactElement | null {
  const L = useLabels();
  // Every folder, not just the selected month: ad-hoc rows queue under their own `adhoc-*` store.
  const unsent = usePendingAnswerCount({ username });
  const [state, setState] = useState<SendState>("idle");
  const [result, setResult] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  if (unsent <= 0 && state !== "done") return null;

  const sendNow = (): void => {
    setState("sending");
    setResult([]);
    const slowTimer = setTimeout(() => { if (mounted.current) setState("slow"); }, SEND_NOW_SLOW_MS);
    void flushAnswersNow(directoryHandle, username)
      .then((summary) => describeFlushResult(summary, L))
      .catch((error: unknown) => {
        logError("answers:send-now", error);
        return [L.ew_answers_send_failed.replace("{count}", String(unsent)).replace("{error}", error instanceof Error ? error.name : String(error))];
      })
      .then((lines) => {
        clearTimeout(slowTimer);
        if (!mounted.current) return;
        setResult(lines);
        setState("done");
      });
  };

  const busy = state === "sending" || state === "slow";
  return (
    <div className="ew-msg-warn" role="status" dir="rtl">
      {unsent > 0 && (
        <p>
          {L.ew_answers_pending_sync.replace("{count}", String(unsent))}{" "}
          <button type="button" onClick={sendNow} disabled={busy}>
            {busy ? L.ew_answers_sending : L.ew_answers_send_now}
          </button>
        </p>
      )}
      {state === "slow" && <p>{L.ew_answers_send_slow}</p>}
      {state === "done" && result.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
}
