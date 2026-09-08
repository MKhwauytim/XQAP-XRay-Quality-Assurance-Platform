/**
 * Local, per-viewer persistence for an answer the employee has typed but not
 * yet saved to the workspace folder.
 *
 * WHY. `InspectionPanel` seeds its answer state once, at mount, and holds it in
 * React state from there. That is fine while the panel stays mounted, and it is
 * exactly the wrong place for it when a save fails: employees reported roughly
 * one submission in ten hanging for about a minute and then failing (share
 * contention — XQ-IO-032, 55 rows of it in one exported production log), and
 * then having to "fill the information and study it again". The failed save
 * does not itself clear the panel, but everything a person does NEXT does:
 * navigating to another sample and back, the tab-mount LRU evicting the tab,
 * or — the likeliest after a minute-long hang — reloading the page.
 *
 * So the draft belongs somewhere that outlives the component. This is the
 * cheapest thing that is actually durable for one viewer.
 *
 * NOT a substitute for saving. Nothing here ever reaches the workspace folder,
 * no other user can see it, and it is not a queue of pending writes: the answer
 * is only real once `upsertItemAnswer` has appended its event. This exists so a
 * failed save costs a retry instead of the work.
 *
 * Registered in `storageRegistry.ts` (prefix entry) like every other browser
 * storage location this app owns.
 */
import { logError } from "../storage/errorLogger";

export const ANSWER_DRAFT_KEY_PREFIX = "xray_answer_draft_v1:";

/**
 * How long an untouched draft is kept.
 *
 * Long enough to cover a weekend plus a holiday — the point is that a person
 * who hit the failure on Thursday still has their work on Monday. Short enough
 * that a browser bucket does not accumulate a year of abandoned drafts for
 * months that have long since closed.
 */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AnswerDraftValues = Record<string, string | number | boolean>;

type StoredDraft = { savedAt: number; values: AnswerDraftValues };

/**
 * One draft per (month, sample, answering employee).
 *
 * The employee is in the key because a supervisor answering ON BEHALF of
 * someone is a different draft for the same row, and merging the two would put
 * one person's half-typed answers into the other's form.
 */
export function answerDraftKey(
  monthFolderName: string,
  xrayImageId: string,
  answeredBy: string
): string {
  return `${ANSWER_DRAFT_KEY_PREFIX}${monthFolderName}::${xrayImageId}::${answeredBy}`;
}

function readStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Accessing `localStorage` itself throws in some embedded/blocked contexts.
    return null;
  }
}

/** The saved draft, or `null` when there is nothing worth restoring. */
export function loadAnswerDraft(key: string): AnswerDraftValues | null {
  const store = readStore();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.values !== "object") {
      return null;
    }
    if (Date.now() - (parsed.savedAt ?? 0) > DRAFT_TTL_MS) return null;
    // An empty draft is not a draft: restoring `{}` over a saved answer would
    // silently blank a form the employee never touched.
    return Object.keys(parsed.values).length > 0 ? parsed.values : null;
  } catch {
    // Unparseable content must never stop a panel from mounting.
    return null;
  }
}

/**
 * Persist the current values. Deliberately silent on failure: a browser that
 * refuses storage (private mode, a full quota, a cleared `file://` bucket) must
 * degrade to the old behaviour, never break the form the employee is typing in.
 */
export function saveAnswerDraft(key: string, values: AnswerDraftValues): void {
  const store = readStore();
  if (!store) return;
  try {
    if (Object.keys(values).length === 0) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify({ savedAt: Date.now(), values } satisfies StoredDraft));
  } catch {
    // Intentionally swallowed — see the docblock.
  }
}

/** Drop the draft. Called when the answer is genuinely on disk. */
export function clearAnswerDraft(key: string): void {
  const store = readStore();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do; a stale draft expires on its own via DRAFT_TTL_MS.
  }
}

/**
 * Remove every expired draft. Called once at sign-in rather than on each write,
 * so an employee typing never pays for a full storage scan.
 */
export function pruneAnswerDrafts(): void {
  const store = readStore();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === null || !key.startsWith(ANSWER_DRAFT_KEY_PREFIX)) continue;
      const raw = store.getItem(key);
      if (raw === null) continue;
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(raw) as StoredDraft).savedAt ?? 0;
      } catch {
        // Unparseable: it can never be restored, so it is only taking up space.
      }
      if (Date.now() - savedAt > DRAFT_TTL_MS) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch (error) {
    logError("answerDraft:prune", error instanceof Error ? error : new Error(String(error)));
  }
}
