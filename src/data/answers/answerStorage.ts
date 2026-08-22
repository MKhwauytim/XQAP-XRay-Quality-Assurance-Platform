import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { logError } from "../storage/errorLogger";
import { readJsonDirectory } from "../storage/directoryScan";
import { ensureMonthWritable } from "../population/monthLock";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import type {
  EmployeeAnswerFile,
  ItemAnswer,
  ItemAnswerHistoryEntry,
  ItemValueHistoryEntry,
} from "./answerTypes";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../referral/referralTypes";
import { getPopulationMonthDir, getSampleEmployeeDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";

const ANSWERS_FOLDER = "employee-answers";

async function getAnswersDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getSampleEmployeeDir(directoryHandle, monthFolderName, true);
}

async function getLegacyAnswersDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle(ANSWERS_FOLDER, { create: false });
}

function answerFileName(username: string): string {
  // Strip path-dangerous characters so a crafted username can't escape the
  // answers folder (path traversal / separators). Usernames are otherwise
  // admin-controlled and normalized lowercase.
  const safe = safeWorkspaceFilePart(username);
  return `${safe}.answers.json`;
}

function emptyAnswerFile(username: string, monthFolderName: string): EmployeeAnswerFile {
  return { username, monthFolderName, revision: 0, items: [] };
}

/**
 * Per-item value-history cap (A4). A documented retention decision, not silent
 * loss: on overflow the first/original entry is always preserved and only the
 * middle is pruned, so the earliest recorded state and the most recent
 * VALUE_HISTORY_CAP-1 changes are always available.
 */
export const VALUE_HISTORY_CAP = 20;

function appendValueHistory(
  existing: ItemValueHistoryEntry[] | undefined,
  entry: ItemValueHistoryEntry
): ItemValueHistoryEntry[] {
  const list = [...(existing ?? []), entry];
  if (list.length <= VALUE_HISTORY_CAP) return list;
  // Keep the original (index 0) plus the most recent VALUE_HISTORY_CAP-1 entries.
  const first = list[0]!;
  const tail = list.slice(list.length - (VALUE_HISTORY_CAP - 1));
  return [first, ...tail];
}

/** A save onto a previously-reopened draft is a correction; otherwise a plain save. */
function changeReason(previous: ItemAnswer): ItemValueHistoryEntry["reason"] {
  const wasReopened =
    previous.status === "draft" &&
    (previous.history?.some((h) => h.action === "reopened") ?? false);
  return wasReopened ? "reopen-correction" : "save";
}

/**
 * Return `next` with an A4 value-history entry appended when it overwrites an
 * existing item (`previous`). A first insert (no previous) records nothing.
 * The incoming item's own `valueHistory` is ignored; history is always folded
 * from the stored `previous` so a client cannot rewrite the trail.
 */
function withValueHistory(previous: ItemAnswer | undefined, next: ItemAnswer): ItemAnswer {
  if (!previous) {
    // First insert of this item — no prior state to snapshot.
    return { ...next, valueHistory: undefined };
  }
  const entry: ItemValueHistoryEntry = {
    changedAt: new Date().toISOString(),
    // The real author, not the file owner. `answeredBy` is pinned to the
    // assignee (see `answeredOnBehalfBy` in answerTypes.ts), so on an on-behalf
    // write it would attribute the supervisor's edit to the assignee.
    changedBy: next.answeredOnBehalfBy ?? next.answeredBy,
    reason: changeReason(previous),
    previous: {
      answers: previous.answers,
      status: previous.status,
      submittedAt: previous.submittedAt,
      lastSavedAt: previous.lastSavedAt,
    },
  };
  return { ...next, valueHistory: appendValueHistory(previous.valueHistory, entry) };
}

/**
 * The employee's answer file, or an empty shell when they genuinely have none
 * yet.
 *
 * **Throws when the file exists but could not be read.** This is the base read
 * of `updateEmployeeAnswerFile`'s read-modify-write, and the empty shell is a
 * whole-file replacement: substituting it for an unreadable file rewrote twenty
 * answers as one — and took the referral / replacement / reopen requests stored
 * in the same file with them — while returning `{ ok: true }`. Absence is the
 * only condition that may produce the shell, so the two legacy locations below
 * are probed for absence individually (a legacy folder that is genuinely not
 * there is still `absent`) while any inconclusive outcome propagates.
 *
 * `fallThroughOnMissingFile: false` preserves the historical shape: the primary
 * directory is opened with `{ create: true }`, so once it resolves, "no file
 * here" is conclusive and the legacy probe would only add round trips per call.
 * The legacy location is still consulted when the primary could not be opened.
 */
export async function loadEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeAnswerFile> {
  const fileName = answerFileName(username);
  const read = await readOptionalJson<EmployeeAnswerFile>(
    `answers:${monthFolderName}/${username}`,
    [
      { directory: () => getAnswersDir(directoryHandle, monthFolderName), fileName },
      { directory: () => getLegacyAnswersDir(directoryHandle, monthFolderName), fileName },
    ],
    { fallThroughOnMissingFile: false }
  );
  return read.kind === "found" ? read.value : emptyAnswerFile(username, monthFolderName);
}

/**
 * What an updater returns: the next file, or a refusal that aborts the write.
 *
 * A refusal exists so a precondition that depends on the file's CURRENT content
 * (e.g. "this item has not been submitted yet") can be evaluated against the
 * very bytes the write would overwrite, inside the same read-modify-write.
 * Checking before calling and writing afterwards leaves a window where two
 * clients both pass the check and the second silently clobbers the first.
 */
type AnswerFileUpdate = EmployeeAnswerFile | { refuse: string };

function isRefusal(update: AnswerFileUpdate): update is { refuse: string } {
  return "refuse" in update;
}

async function updateEmployeeAnswerFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  updater: (file: EmployeeAnswerFile) => AnswerFileUpdate
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — single choke point for every employee-file write
  // (answers, referral/replacement requests, reopen). Rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getAnswersDir(directoryHandle, monthFolderName);
      // ABORT, never truncate: an unreadable existing file throws out of
      // loadEmployeeAnswers, casLoop catches it, retries the whole attempt (a
      // NotReadableError is usually transient) and finally returns
      // `{ ok: false, error }`. Nothing is written on that path — the old
      // behaviour substituted an empty base here and reported success.
      const existing = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
      // Preconditions are evaluated here, against the state this attempt just
      // read and is about to overwrite — not by the caller beforehand. A refusal
      // is terminal (no retry: a losing precondition does not become winnable)
      // and writes nothing at all.
      const update = updater(existing);
      if (isRefusal(update)) {
        return { done: true, result: { ok: false as const, error: update.refuse } };
      }
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: EmployeeAnswerFile = {
        ...update,
        username,
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        lastUpdatedAt: new Date().toISOString(),
      };
      await safeWriteJson(dir, answerFileName(username), updated);
      const verify = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        bumpWorkspaceEpoch(directoryHandle, monthFolderName);
        return {
          done: true,
          result: { ok: true as const },
          verify: async () => {
            const recheck = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
            return recheck.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ ملف الموظف بعد عدة محاولات." }
  );
}

/**
 * Same normalization `normalizeUsername` (auth/userManagement) applies, inlined
 * so the answer-storage layer keeps no dependency on the auth module. Used only
 * to compare two usernames for equality, never to build a file name — that is
 * `answerFileName`/`safeWorkspaceFilePart`'s job.
 */
function sameUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Drop any `answeredOnBehalfBy` an incoming item carries.
 *
 * Every write path except `upsertItemAnswerOnBehalf` funnels through here, so
 * the field can only ever be set together with its `"answered-on-behalf"`
 * history entry — a caller cannot forge attribution by hand-setting the field,
 * and, more importantly for real use, cannot accidentally *keep* it: when the
 * assignee later re-answers their own item the client is re-saving an object it
 * read from disk, which still carries the supervisor's name. Stripping makes
 * the field always describe the answers currently stored, while the permanent
 * record of the supervisor's authorship survives in `history` (and their actual
 * answers in `valueHistory`).
 */
function stripOnBehalf(item: ItemAnswer): ItemAnswer {
  if (item.answeredOnBehalfBy === undefined) return item;
  return { ...item, answeredOnBehalfBy: undefined };
}

/**
 * Take `history` from the STORED predecessor, never from the incoming item —
 * the same rule `withValueHistory` already applies to `valueHistory`, and for
 * the same reason: the oversight trail is append-only and a client must not be
 * able to rewrite it.
 *
 * This also makes the trail durable. Callers build a whole fresh `ItemAnswer`
 * per save (see `XrayReferrals.handleSave`) with no `history` on it, so before
 * this fold every ordinary re-save silently erased the item's `"reopened"` /
 * `"answered-on-behalf"` entries — the answers survived in `valueHistory` but
 * the record of WHO acted did not. A first insert has no predecessor, so a
 * client-supplied trail is dropped rather than trusted.
 */
function withStoredHistory(previous: ItemAnswer | undefined, next: ItemAnswer): ItemAnswer {
  if (previous?.history === next.history) return next;
  return { ...next, history: previous?.history };
}

export async function saveEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  items: ItemAnswer[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    // A4: fold each incoming item against its stored predecessor so an
    // overwriting bulk save snapshots the prior answers/status into valueHistory.
    const prevById = new Map(file.items.map((i) => [i.xrayImageId, i]));
    return {
      ...file,
      items: items.map((item) => {
        const previous = prevById.get(item.xrayImageId);
        return withValueHistory(previous, withStoredHistory(previous, stripOnBehalf(item)));
      }),
    };
  });
}

/**
 * Replace one item in the file, folding A4 value history against its
 * predecessor. `item` is expected to have been through `stripOnBehalf` /
 * `withStoredHistory` already (or, for the on-behalf path, to carry the
 * deliberately-appended trail).
 */
function upsertItemInFile(file: EmployeeAnswerFile, item: ItemAnswer): EmployeeAnswerFile {
  const previous = file.items.find((i) => i.xrayImageId === item.xrayImageId);
  const others = file.items.filter((i) => i.xrayImageId !== item.xrayImageId);
  // A4: record the overwritten snapshot before replacing the item.
  return { ...file, items: [...others, withValueHistory(previous, item)] };
}

export async function upsertItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  item: ItemAnswer
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const previous = file.items.find((i) => i.xrayImageId === item.xrayImageId);
    return upsertItemInFile(file, withStoredHistory(previous, stripOnBehalf(item)));
  });
}

/**
 * Write an answer that a user OTHER than the assignee authored — the
 * `answer-on-behalf` feature ("supervisor answers a sample assigned to someone
 * else"). Gated at the call site by `canMutate("answer-on-behalf")`; this
 * function is the storage half only.
 *
 * Everything the on-behalf case needs lands in ONE `updateEmployeeAnswerFile`
 * pass — the same CAS/lock/verify cycle as any other answer write — so the
 * author can never be recorded without the answer, nor the answer without the
 * author:
 *
 * 1. the answers themselves, in **`assigneeUsername`'s** file, exactly where a
 *    self-answer would have gone;
 * 2. `answeredBy` forced to `assigneeUsername`, defensively — this is precisely
 *    the call site most likely to pass the acting user, and doing so would
 *    break the `${xrayImageId}::${assignedTo}` join (see `answeredOnBehalfBy`
 *    in answerTypes.ts);
 * 3. `answeredOnBehalfBy` = the real author;
 * 4. an appended `"answered-on-behalf"` history entry naming author, assignee,
 *    timestamp and the `submittedAt` it replaced.
 *
 * **Only an UNANSWERED item may be answered on behalf.** If the item already
 * exists with `status === "submitted"`, this refuses with `{ ok: false, error }`
 * and writes nothing: one person's submitted work is never overwritten by
 * someone else through this path. The test is the STATUS, not mere existence —
 * an item `reopenItemAnswer` flipped back to `"draft"` is by definition no
 * longer submitted and becomes answerable on behalf again, which is exactly the
 * correction route. The check runs inside `updateEmployeeAnswerFile`'s fold, on
 * the same file state the write would overwrite, so two supervisors racing
 * cannot both pass it.
 *
 * The restriction is specific to this path. An assignee overwriting their OWN
 * submitted answer keeps today's behaviour untouched, `withValueHistory`
 * snapshot included — `upsertItemAnswer` is not tightened.
 *
 * Refuses rather than degrades when `authorUsername` is blank: a caller that
 * declares an on-behalf write must name the author, and silently writing an
 * unattributed answer into someone else's file is the exact failure this
 * feature exists to prevent. Nothing is written on that path.
 *
 * `authorUsername === assigneeUsername` is NOT an error — it is a self-answer
 * that happened to arrive through the supervisor UI, so it is recorded as one:
 * no attribution field, no history entry, identical bytes to
 * `upsertItemAnswer`. Attribution stays meaningful because it only ever appears
 * when it is actually true.
 */
export async function upsertItemAnswerOnBehalf(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assigneeUsername: string,
  item: ItemAnswer,
  authorUsername: string,
  reason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  const author = authorUsername.trim();
  if (author === "") {
    return {
      ok: false,
      error: "تعذر حفظ الإجابة نيابةً عن الموظف: لم يُحدَّد المستخدم الذي قام بالإجابة.",
    };
  }
  if (sameUser(author, assigneeUsername)) {
    // Not on behalf of anyone — the assignee answering their own sample.
    return upsertItemAnswer(directoryHandle, monthFolderName, assigneeUsername, item);
  }
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, assigneeUsername, (file) => {
    const previous = file.items.find((i) => i.xrayImageId === item.xrayImageId);
    if (previous?.status === "submitted") {
      return {
        refuse:
          "لا يمكن الإجابة نيابةً عن الموظف: تم تقديم إجابة لهذه العينة بالفعل. أعد فتح الإجابة أولاً إذا لزم تصحيحها.",
      };
    }
    const historyEntry: ItemAnswerHistoryEntry = {
      action: "answered-on-behalf",
      at: new Date().toISOString(),
      by: author,
      reason,
      previousSubmittedAt: previous?.submittedAt ?? null,
      onBehalfOf: assigneeUsername,
    };
    const next: ItemAnswer = {
      ...item,
      answeredBy: assigneeUsername,
      answeredOnBehalfBy: author,
      // Folded from the STORED predecessor, never from the incoming item, so a
      // client cannot rewrite the trail (same rule as withValueHistory).
      history: [...(previous?.history ?? []), historyEntry],
    };
    return upsertItemInFile(file, next);
  });
}

/**
 * Reopen a submitted answer for correction (Tier-1 Item D).
 * Idempotent: if the item is missing or not "submitted", this is a no-op.
 * The previous answers are preserved — only the status flips to "draft" and a
 * history entry records who reopened it, when, why, and the prior submittedAt.
 */
export async function reopenItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  reopenedBy: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const item = file.items.find((i) => i.xrayImageId === xrayImageId);
    if (!item || item.status !== "submitted") {
      return file; // idempotent no-op
    }
    const historyEntry: ItemAnswerHistoryEntry = {
      action: "reopened",
      at: new Date().toISOString(),
      by: reopenedBy,
      reason,
      previousSubmittedAt: item.submittedAt,
    };
    const reopened: ItemAnswer = {
      ...item,
      status: "draft",
      submittedAt: null,
      history: [...(item.history ?? []), historyEntry],
    };
    return {
      ...file,
      items: file.items.map((i) => (i.xrayImageId === xrayImageId ? reopened : i)),
    };
  });
}

/**
 * Set (or clear, on an empty/whitespace-only string) a supervisor coaching
 * note on one item (P2-2). Independent of the referral/replacement/reopen
 * `reviewNotes`/`DecisionEvent` trail — never touches those files or types.
 * Idempotent no-op when the item doesn't exist yet (mirrors reopenItemAnswer):
 * a note can only attach to an item the employee has already saved/submitted.
 */
export async function setItemQualityNote(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  qualityNote: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const item = file.items.find((i) => i.xrayImageId === xrayImageId);
    if (!item) return file; // idempotent no-op — no saved answer to annotate yet
    const trimmed = qualityNote.trim();
    const updated: ItemAnswer = { ...item, qualityNote: trimmed.length > 0 ? trimmed : undefined };
    return {
      ...file,
      items: file.items.map((i) => (i.xrayImageId === xrayImageId ? updated : i)),
    };
  });
}

/** Idempotently append a referral request to the originating employee's personal file. */
export async function appendReferralToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReferralRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.fromEmployee;
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.referralRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, referralRequests: [...(file.referralRequests ?? []), request] };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Idempotently append a replacement request to the requesting employee's personal file. */
export async function appendReplacementToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReplacementRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.employeeUsername;
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.replacementRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, replacementRequests: [...(file.replacementRequests ?? []), request] };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Idempotently append a reopen-case request to the requesting employee's personal file. */
export async function appendReopenToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReopenRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.employeeUsername;
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.reopenRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, reopenRequests: [...(file.reopenRequests ?? []), request] };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Read all employee files for the month (used by supervisor/admin aggregation). */
export async function loadAllEmployeeFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeAnswerFile[]> {
  try {
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const { values } = await readJsonDirectory<EmployeeAnswerFile>(dir, {
      suffix: ".answers.json",
      onUnreadable: "skip",
    });
    return values;
  } catch (err) {
    logError("answerStorage:loadAllEmployeeFiles", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}
