import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { requestStoragePersistence } from "../storage/storageRegistry";
import { queueAnswerForLanding } from "./answerLocalMirror";
import { mintAnswerEventIdentity } from "./answerStorage";
import { timeAnswerStep } from "./answerTimings";
import { replayPendingAnswers, type PendingReplaySummary } from "./pendingAnswerReplay";
import type { ItemAnswer } from "./answerTypes";

export type AnswerSubmitMode = "outbox" | "sync";
export const ANSWER_SUBMIT_MODE_KEY = "xray_answer_submit_mode_v1";
export const FLUSH_DEBOUNCE_MS = 5_000;

export function getAnswerSubmitMode(): AnswerSubmitMode {
  try {
    return localStorage.getItem(ANSWER_SUBMIT_MODE_KEY) === "sync" ? "sync" : "outbox";
  } catch {
    return "outbox";
  }
}

export function setAnswerSubmitMode(mode: AnswerSubmitMode): void {
  try {
    localStorage.setItem(ANSWER_SUBMIT_MODE_KEY, mode);
  } catch {
    // storage unavailable: the default (outbox) stays in force
  }
}

export type LocalFirstOutcome = { stored: boolean };

/** Durable in this browser, nothing awaited on the share. `stored:false` ⇒ caller must use the synchronous write. */
export async function submitAnswerLocalFirst(month: string, username: string, item: ItemAnswer): Promise<LocalFirstOutcome> {
  const stored = await timeAnswerStep("submit.localWrite", () => queueAnswerForLanding(month, username, item, mintAnswerEventIdentity()));
  if (stored) void requestStoragePersistence();
  return { stored };
}

type FlushOptions = { immediate?: boolean; replay?: typeof replayPendingAnswers; debounceMs?: number };

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestAnswerFlush(directoryHandle: DirectoryHandleLike, username: string, opts: FlushOptions = {}): void {
  const replay = opts.replay ?? replayPendingAnswers;
  const run = (): void => {
    timer = null;
    if (running) { again = true; return; }
    running = true;
    void (async () => {
      try {
        do {
          again = false;
          try {
            await replay(directoryHandle, username);
          } catch (error) {
            logError("answers:outbox-flush", error);
          }
        } while (again);
      } finally {
        running = false;
      }
    })();
  };
  if (opts.immediate) { if (timer) clearTimeout(timer); run(); return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, opts.debounceMs ?? FLUSH_DEBOUNCE_MS);
}

/**
 * The «إرسال الآن» button's flush: runs one replay pass NOW and resolves with
 * its summary, so the button can say what happened. `requestAnswerFlush` is
 * fire-and-forget and, when a pass is already running, only flags a re-run —
 * from the button that looked like nothing happened at all. Joins an
 * in-flight pass in this tab (`replayPendingAnswers`'s own dedupe) rather
 * than starting a second one.
 */
export async function flushAnswersNow(
  directoryHandle: DirectoryHandleLike,
  username: string,
  replay: typeof replayPendingAnswers = replayPendingAnswers
): Promise<PendingReplaySummary> {
  if (timer) { clearTimeout(timer); timer = null; }
  return replay(directoryHandle, username);
}

export function __resetAnswerOutboxForTests(): void {
  running = false;
  again = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
