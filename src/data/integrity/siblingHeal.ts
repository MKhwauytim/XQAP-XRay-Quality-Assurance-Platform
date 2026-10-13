import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { wrap } from "../storage/jsonEnvelope";
import { isReadOnlyMode } from "../storage/readOnlyMode";
import { directoryResourceKey, withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import {
  copyFileBytes,
  inspectJsonFile,
  readEnvelopeRevision,
  safeWriteJson,
} from "../storage/safeWrite";

/**
 * Heal ONE live workspace JSON file whose bytes fail integrity while a verified
 * `{file}.tmp` / `{file}.bak` sits beside it.
 *
 * WHY. `safeReadJson` already serves such a file from the sibling and raises the
 * yellow `data:recovered-from-bak` banner, but nothing rewrites the live file
 * until the next write to it — for a feedback thread that may be never, so every
 * reader limps along (and the banner repeats) indefinitely. The owner's rule
 * (2026-10-13): the repair happens ONLY at an admin's sign-in, from the boot
 * integrity scan, and is logged. This module is that repair for one file; it is
 * never called from a read path.
 *
 * THE SAFETY RULES (each one has a test):
 *  - Proceed only when the live file is STILL invalid after one delayed re-read —
 *    a stale SMB snapshot is not damage.
 *  - A share that does not answer is not damage either: a throwing read is
 *    "skipped (live-unavailable)", never a repair.
 *  - The sibling must pass the same envelope / content-hash validation as a read
 *    (`inspectJsonFile`, which is `safeReadJson`'s own validator). No duplicate
 *    validation logic lives here.
 *  - Never regress: a sibling whose revision is OLDER than anything readable
 *    from the live name (or its `.bak`) is refused.
 *  - A `.tmp` modified within {@link FRESH_TMP_WINDOW_MS} may be another
 *    machine's in-progress write; the whole file is left alone.
 *  - The damaged live bytes are copied to `{file}.unreadable-{UTC ts}` BEFORE
 *    anything is replaced; nothing is ever deleted. (If the in-place rewrite is
 *    refused by the share, the live entry is removed only after that archive
 *    exists — the `decisionFileRecovery.ts` precedent.)
 *  - Write lock held; read-only mode writes nothing; once per file per session.
 *
 * `.bak` is the snapshot taken BEFORE the last commit, so healing from it can
 * lose the most recent edit; the result says which sibling was used so the
 * caller can report that honestly.
 */

/** A `.tmp` touched more recently than this may be a live write on another machine. */
export const FRESH_TMP_WINDOW_MS = 2 * 60 * 1000;

/** Delay before the confirming second read of a live file that looked invalid. */
export const LIVE_RECHECK_DELAY_MS = 250;

export type SiblingHealSkipReason =
  /** Already examined this session (memo). */
  | "already-checked"
  | "read-only"
  | "live-valid"
  | "live-missing"
  /** The live read threw: the share did not answer, which proves nothing. */
  | "live-unavailable"
  | "tmp-too-fresh"
  | "no-valid-sibling"
  | "sibling-older";

/**
 * Skips that are the ordinary "nothing to do" outcome of a healthy file. Every
 * OTHER skip means a damaged file was left damaged and is worth a durable
 * log line, so it is logged; these are not (a healthy workspace must not write
 * an error-log entry per file per sign-in).
 */
const SILENT_SKIPS: ReadonlySet<SiblingHealSkipReason> = new Set([
  "already-checked",
  "live-valid",
  "live-missing",
]);

export type SiblingHealResult =
  | {
      status: "healed";
      fileName: string;
      source: ".tmp" | ".bak";
      archivedAs: string;
      revision: number;
    }
  | { status: "skipped"; fileName: string; reason: SiblingHealSkipReason; detail?: string }
  | { status: "failed"; fileName: string; error: string; archivedAs?: string };

export type SiblingHealOptions = {
  /** Directory label for log lines, e.g. `5-system/feedback/threads`. */
  location?: string;
  /** Injected clock (epoch ms) so freshness and archive names are assertable. */
  nowMs?: number;
  /** Override of {@link LIVE_RECHECK_DELAY_MS} (tests use 0). */
  recheckDelayMs?: number;
};

const attempted = new Set<string>();

/** @internal — test-only. Forget which files this session has already examined. */
export function __resetSiblingHealMemoForTests(): void {
  attempted.clear();
}

type Candidate = {
  source: ".tmp" | ".bak";
  value: unknown;
  revision: number | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function modifiedAt(dir: DirectoryHandleLike, name: string): Promise<number | null> {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    return (await handle.getFile()).lastModified;
  } catch {
    return null;
  }
}

/**
 * The revision a file's envelope header CLAIMS, even when the file fails its
 * content-hash check (which makes `readEnvelopeRevision` return null). Not
 * validation — only a floor for the never-go-backwards rule. Bounded to small
 * files; anything else simply contributes no floor.
 */
const PEEK_MAX_BYTES = 8 * 1024 * 1024;
async function peekHeaderRevision(dir: DirectoryHandleLike, name: string): Promise<number | null> {
  try {
    const file = await (await dir.getFileHandle(name, { create: false })).getFile();
    if (file.size > PEEK_MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(await file.text());
    const revision = (parsed as { metadata?: { revision?: unknown } } | null)?.metadata?.revision;
    return typeof revision === "number" ? revision : null;
  } catch {
    return null;
  }
}

async function loadCandidate(
  dir: DirectoryHandleLike,
  fileName: string,
  source: ".tmp" | ".bak"
): Promise<Candidate | null> {
  const name = `${fileName}${source}`;
  const inspected = await inspectJsonFile<unknown>(dir, name);
  if (!inspected.valid) return null;
  return { source, value: inspected.value, revision: await readEnvelopeRevision(dir, name) };
}

function chooseCandidate(tmp: Candidate | null, bak: Candidate | null): Candidate | null {
  if (!tmp) return bak;
  if (!bak) return tmp;
  // `.tmp` wins a tie: it was byte-verified before a commit that may never have
  // landed, so when revisions agree it is the same or newer content.
  return (bak.revision ?? -1) > (tmp.revision ?? -1) ? bak : tmp;
}

function logOutcome(location: string, result: SiblingHealResult): void {
  const where = `${location}/${result.fileName}`;
  if (result.status === "healed") {
    logError(
      "integrity:sibling-heal",
      new Error(
        `Healed ${where} from ${result.fileName}${result.source} (revision ${result.revision}); ` +
          `damaged original kept as ${result.archivedAs}.`
      ),
      { action: result.fileName }
    );
  } else if (result.status === "skipped") {
    if (SILENT_SKIPS.has(result.reason)) return;
    logError(
      "integrity:sibling-heal",
      new Error(
        `Left ${where} damaged: ${result.reason}${result.detail ? ` (${result.detail})` : ""}.`
      ),
      { action: result.fileName }
    );
  } else {
    logError(
      "integrity:sibling-heal",
      new Error(
        `Could not heal ${where}: ${result.error}` +
          (result.archivedAs ? ` — damaged original kept as ${result.archivedAs}` : "")
      ),
      { action: result.fileName }
    );
  }
}

export async function healFileFromSibling(
  dir: DirectoryHandleLike,
  fileName: string,
  options: SiblingHealOptions = {}
): Promise<SiblingHealResult> {
  const location = options.location ?? dir.name;
  const nowMs = options.nowMs ?? Date.now();
  const skipped = (reason: SiblingHealSkipReason, detail?: string): SiblingHealResult => ({
    status: "skipped",
    fileName,
    reason,
    ...(detail !== undefined ? { detail } : {}),
  });

  const memoKey = directoryResourceKey(dir, fileName);
  if (attempted.has(memoKey)) return skipped("already-checked");
  attempted.add(memoKey);

  let result: SiblingHealResult;
  try {
    result = await heal(dir, fileName, nowMs, options.recheckDelayMs, skipped);
  } catch (error) {
    result = { status: "failed", fileName, error: messageOf(error) };
  }
  logOutcome(location, result);
  return result;
}

async function heal(
  dir: DirectoryHandleLike,
  fileName: string,
  nowMs: number,
  recheckDelayMs: number | undefined,
  skipped: (reason: SiblingHealSkipReason, detail?: string) => SiblingHealResult
): Promise<SiblingHealResult> {
  if (isReadOnlyMode()) return skipped("read-only");

  // Live must be invalid TWICE, a beat apart: a stale snapshot is not damage.
  let live;
  try {
    live = await inspectJsonFile<unknown>(dir, fileName);
    if (live.valid) return skipped("live-valid");
    if (!live.found) return skipped("live-missing");
    await delay(recheckDelayMs ?? LIVE_RECHECK_DELAY_MS);
    live = await inspectJsonFile<unknown>(dir, fileName);
    if (live.valid) return skipped("live-valid", "valid on re-read");
    if (!live.found) return skipped("live-missing");
  } catch (error) {
    return skipped("live-unavailable", messageOf(error));
  }

  const tmpModified = await modifiedAt(dir, `${fileName}.tmp`);
  if (tmpModified !== null && nowMs - tmpModified < FRESH_TMP_WINDOW_MS) {
    return skipped("tmp-too-fresh", `${Math.round((nowMs - tmpModified) / 1000)}s old`);
  }

  const candidate = chooseCandidate(
    await loadCandidate(dir, fileName, ".tmp"),
    await loadCandidate(dir, fileName, ".bak")
  );
  if (!candidate) return skipped("no-valid-sibling");

  // Anything readable from the live name (a parseable header with a bad hash) or
  // its `.bak` is the floor: healing must never move the file backwards.
  const floor = Math.max(
    (await readEnvelopeRevision(dir, fileName)) ?? -1,
    (await peekHeaderRevision(dir, fileName)) ?? -1
  );
  if (floor >= 0 && candidate.revision !== null && candidate.revision < floor) {
    return skipped("sibling-older", `sibling r${candidate.revision} < r${floor}`);
  }

  const revision = candidate.revision ?? 0;
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  const archivedAs = `${fileName}.unreadable-${stamp}`;

  return withWorkspaceWriteAccess(dir, () =>
    // `:sibling-heal` keeps this lock distinct from safeWriteJson's own
    // per-file lock (withResourceLock is not reentrant).
    withResourceLock(`${directoryResourceKey(dir, fileName)}:sibling-heal`, async () => {
      const again = await inspectJsonFile<unknown>(dir, fileName);
      if (again.valid) return skipped("live-valid", "repaired by another writer");

      // Archive FIRST. If this throws nothing has changed.
      await copyFileBytes(dir, fileName, dir, archivedAs);

      // wrap(value, revision) continues the sibling's revision (+1) rather than
      // restarting at 1, so a casLoop reader never sees the file go backwards.
      const envelope = wrap(candidate.value, revision);
      try {
        await safeWriteJson(dir, fileName, envelope);
      } catch (firstError) {
        // The share may refuse an in-place replace of the damaged entry (the
        // trigger for this feature). The bytes are archived, so removing the
        // entry is now safe.
        if (typeof dir.removeEntry !== "function") {
          return { status: "failed", fileName, error: messageOf(firstError), archivedAs };
        }
        try {
          // Deliberately NOT safeRemoveJson: that would also delete the verified
          // `.tmp`/`.bak` we are about to write back from. Removes the damaged
          // LIVE entry only, after its bytes are archived above (the same
          // reasoning as the allowlisted decisionFileRecovery.ts).
          // eslint-disable-next-line no-restricted-syntax
          await dir.removeEntry(fileName);
          await safeWriteJson(dir, fileName, envelope);
        } catch (secondError) {
          return { status: "failed", fileName, error: messageOf(secondError), archivedAs };
        }
      }

      const verified = await inspectJsonFile<unknown>(dir, fileName);
      if (!verified.valid) {
        return {
          status: "failed",
          fileName,
          error: "live file still invalid after rewrite",
          archivedAs,
        };
      }
      return {
        status: "healed",
        fileName,
        source: candidate.source,
        archivedAs,
        revision: revision + 1,
      } as SiblingHealResult;
    })
  );
}
