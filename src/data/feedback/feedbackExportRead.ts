/**
 * The read half of the admin feedback export (Workstream B, 2026-09-28).
 *
 * Runs ONLY when the admin clicks "export" -- never on panel open, so it does
 * not bring back the full read the panel dropped. It lists the thread ids (one
 * index read + one names-only listing), then reads the bodies in bounded
 * chunks with a `yieldToMain()` between them, so a long history neither blocks
 * input nor is read in one giant burst on the share. `onProgress` lets the UI
 * show "done / total".
 *
 * `loadThreads` deliberately SKIPS an unreadable file (one corrupt thread must
 * not blank a page). For an export that would be a silent omission from a file
 * people treat as complete, so the shortfall is returned by id.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { yieldToMain } from "../storage/yieldToMain";
import {
  listThreadSummaries,
  loadFeedback,
  loadThreads,
  type FeedbackMessage,
} from "./feedbackStorage";

const DEFAULT_CHUNK_SIZE = 100;

export type ExportReadOptions = {
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
};

export type ExportReadResult = {
  threads: FeedbackMessage[];
  /** Ids of listed threads whose file could not be read (the caller may hold a copy). */
  skippedIds: string[];
};

export async function readAllThreadsForExport(
  dir: DirectoryHandleLike,
  options: ExportReadOptions
): Promise<ExportReadResult> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const summaries = await listThreadSummaries(dir);
  if (summaries.length === 0) {
    // No per-thread files: an empty workspace, or a legacy-only one that
    // `loadFeedback` reads from `messages.json`.
    const legacy = await loadFeedback(dir);
    options.onProgress?.(legacy.length, legacy.length);
    return { threads: legacy, skippedIds: [] };
  }

  const ids = summaries.map((summary) => summary.threadId);
  const threads: FeedbackMessage[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    threads.push(...(await loadThreads(dir, ids.slice(i, i + chunkSize))));
    options.onProgress?.(Math.min(i + chunkSize, ids.length), ids.length);
    if (i + chunkSize < ids.length) await yieldToMain();
  }
  const read = new Set(threads.map((thread) => thread.id));
  return { threads, skippedIds: ids.filter((id) => !read.has(id)) };
}
