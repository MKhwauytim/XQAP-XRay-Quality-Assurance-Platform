// A1: this tab's own submissions, protected against a background reload that
// started before the write and commits after it. Pure rule + one tiny hook, out
// of XrayReferrals.tsx for its `max-lines-per-function` budget.
import { useCallback, useMemo, useRef } from "react";

import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";

export type LocalSubmission = { generation: number; item: ItemAnswer };

export function localSubmissionKey(item: Pick<ItemAnswer, "xrayImageId" | "answeredBy">): string {
  return `${item.xrayImageId}::${item.answeredBy}`;
}

/**
 * The loaded answers, with every local submission recorded at a generation
 * NEWER than the load's start put back over a loaded copy that is missing or
 * older. Returns `loaded` itself when nothing applies.
 */
export function mergeLocalSubmissions(
  loaded: ItemAnswer[],
  local: ReadonlyMap<string, LocalSubmission>,
  loadGeneration: number
): ItemAnswer[] {
  const newer = [...local.values()].filter((submission) => submission.generation > loadGeneration);
  if (newer.length === 0) return loaded;
  const byKey = new Map(loaded.map((answer) => [localSubmissionKey(answer), answer]));
  let changed = false;
  for (const { item } of newer) {
    const key = localSubmissionKey(item);
    const onDisk = byKey.get(key);
    if (!onDisk || onDisk.lastSavedAt < item.lastSavedAt) {
      byKey.set(key, item);
      changed = true;
    }
  }
  return changed ? [...byKey.values()] : loaded;
}

/** Forget submissions a load that started after them has already seen on disk. */
export function pruneLocalSubmissions(local: Map<string, LocalSubmission>, loadGeneration: number): void {
  for (const [key, submission] of local) {
    if (submission.generation <= loadGeneration) local.delete(key);
  }
}

export type LocalSubmissionGuard = {
  /** Called by the submit handler after a successful write. */
  record: (item: ItemAnswer) => void;
  /** Called at the start of a load; pass the result to `settle`. */
  beginLoad: () => number;
  /** Called with the loaded answers right before they are committed. */
  settle: (loaded: ItemAnswer[], loadGeneration: number) => ItemAnswer[];
};

export function useLocalSubmissionGuard(): LocalSubmissionGuard {
  const generationRef = useRef(0);
  const submissionsRef = useRef(new Map<string, LocalSubmission>());
  const record = useCallback((item: ItemAnswer): void => {
    generationRef.current += 1;
    submissionsRef.current.set(localSubmissionKey(item), { generation: generationRef.current, item });
  }, []);
  const beginLoad = useCallback((): number => generationRef.current, []);
  const settle = useCallback((loaded: ItemAnswer[], loadGeneration: number): ItemAnswer[] => {
    const merged = mergeLocalSubmissions(loaded, submissionsRef.current, loadGeneration);
    pruneLocalSubmissions(submissionsRef.current, loadGeneration);
    return merged;
  }, []);
  return useMemo(() => ({ record, beginLoad, settle }), [record, beginLoad, settle]);
}
