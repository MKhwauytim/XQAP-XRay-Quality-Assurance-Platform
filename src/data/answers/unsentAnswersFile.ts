/**
 * Unsent-answers file: a portable copy of the answers this browser could not
 * land on the shared folder, so a machine-specific fault (a Windows account
 * without write access to the share, a broken browser profile, a PC that keeps
 * timing out) never leaves an employee's work trapped in one browser.
 *
 * Export writes every pending record of the signed-in user. Import, signed in
 * as that SAME user on any working PC, puts them back into that browser's
 * outbox; the normal replay then lands them through `upsertItemAnswer`, the
 * same conflict-safe path a real save uses. Import never writes the share
 * directly and never imports another user's answers.
 */
import { loadPendingAnswerRecords, queueAnswerForLanding, type OutboxIdentity } from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

export const UNSENT_ANSWERS_FILE_KIND = "xqap-unsent-answers";
export const UNSENT_ANSWERS_FILE_VERSION = 1;

export type UnsentAnswerRecord = { month: string; item: ItemAnswer; identity?: OutboxIdentity };

export type UnsentAnswersFile = {
  kind: typeof UNSENT_ANSWERS_FILE_KIND;
  version: typeof UNSENT_ANSWERS_FILE_VERSION;
  exportedAt: string;
  username: string;
  answers: UnsentAnswerRecord[];
};

export function buildUnsentAnswersFile(username: string, answers: UnsentAnswerRecord[], now = new Date()): UnsentAnswersFile {
  return { kind: UNSENT_ANSWERS_FILE_KIND, version: UNSENT_ANSWERS_FILE_VERSION, exportedAt: now.toISOString(), username, answers };
}

export async function exportUnsentAnswers(username: string): Promise<UnsentAnswersFile> {
  return buildUnsentAnswersFile(username, await loadPendingAnswerRecords(username));
}

export function unsentAnswersFileName(username: string, now = new Date()): string {
  return `unsent-answers-${username}-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
}

export type ParsedUnsentAnswers =
  | { ok: true; answers: UnsentAnswerRecord[] }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "other-user"; fileUser: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsentAnswerRecord(value: unknown): value is UnsentAnswerRecord {
  if (!isRecord(value) || typeof value.month !== "string" || !value.month || !isRecord(value.item)) return false;
  const { item, identity } = value;
  if (typeof item.xrayImageId !== "string" || !item.xrayImageId || typeof item.lastSavedAt !== "string") return false;
  if (identity === undefined) return true;
  return isRecord(identity) && typeof identity.eventId === "string" && typeof identity.eventAt === "string";
}

/** Validate an exported file for `username`; refuses malformed files and other users' answers. */
export function parseUnsentAnswersFile(text: string, username: string): ParsedUnsentAnswers {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !isRecord(data) ||
    data.kind !== UNSENT_ANSWERS_FILE_KIND ||
    data.version !== UNSENT_ANSWERS_FILE_VERSION ||
    typeof data.username !== "string" ||
    !Array.isArray(data.answers) ||
    !data.answers.every(isUnsentAnswerRecord)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (data.username !== username) return { ok: false, reason: "other-user", fileUser: data.username };
  return { ok: true, answers: data.answers };
}

/**
 * The identity an imported record is queued under. A record that already had
 * one keeps it, so a copy that also lands from the original PC folds once. A
 * legacy record (queued before the outbox existed) gets a fresh event id but
 * keeps its own save time as `eventAt`: the fold then orders it where it
 * really happened, so a newer answer already on disk still wins over it.
 */
export function importIdentityFor(record: UnsentAnswerRecord, newEventId: () => string = () => crypto.randomUUID()): OutboxIdentity {
  return record.identity ?? { eventId: newEventId(), eventAt: record.item.lastSavedAt };
}

/** Queue every record for `username`'s background landing; resolves with how many were stored. */
export async function importUnsentAnswers(username: string, answers: UnsentAnswerRecord[]): Promise<number> {
  let stored = 0;
  for (const record of answers) {
    if (await queueAnswerForLanding(record.month, username, record.item, importIdentityFor(record))) stored += 1;
  }
  return stored;
}
