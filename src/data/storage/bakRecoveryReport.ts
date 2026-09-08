/**
 * Records that a read was served from a `{file}.bak` / `{file}.tmp` fallback
 * instead of the live file.
 *
 * WHY THIS EXISTS. The recovery itself has worked for a long time: `safeReadJson`
 * and `fileSystemAccess.readJsonFile` both fall through to the snapshot copies
 * rather than let a torn write brick workspace entry, and the user gets a banner.
 * What neither of them did was WRITE IT DOWN — the only output was a
 * `window` CustomEvent consumed by `App.tsx`. So the durable per-user error log,
 * and the admin XLSX export built on it, contained no trace of it at all.
 *
 * That gap was found the hard way. A deployment reported a
 * "backup/tmp file" warning on every single sign-in, for every user including
 * the admin — which says a SHARED bootstrap file is damaged. A 1,707-row
 * exported error log from that same workspace could not name the file, because
 * the app had never recorded it. The banner names the file to whoever happens to
 * be looking at the screen, and to nobody afterwards.
 *
 * A recovery is a real, durable, workspace-level fact: some file's live copy is
 * damaged and every reader is limping along on a snapshot until someone rewrites
 * it. It belongs in the log the admin can export.
 *
 * ONE ENTRY PER FILE PER SESSION. `users.permissions.json` alone is re-read by
 * the 45 s sync tick, so logging every recovery would put ~80 entries per user
 * per hour into a file on the same contended share this app is trying not to
 * hammer. The condition is a property of the file, not of the read, so the
 * first read to notice it is the one worth recording. Same reasoning as
 * `directoryScan.ts`'s `logVanishedEntries` ("one log line per call, not per
 * entry").
 */
import { logError } from "./errorLogger";

/** Which snapshot answered the read. */
export type BakRecoverySource = ".bak" | ".tmp";

const reported = new Set<string>();

/** @internal — test-only. Forget which recoveries have already been reported. */
export function __resetBakRecoveryReportsForTests(): void {
  reported.clear();
}

/**
 * Report one recovery: durably (deduped), and to the UI banner (every time, so
 * a user who dismissed it still learns about a second damaged file).
 */
export function reportBakRecovery(
  directoryName: string,
  fileName: string,
  source: BakRecoverySource
): void {
  const key = `${directoryName}/${fileName}${source}`;
  if (!reported.has(key)) {
    reported.add(key);
    logError(
      "storage:bak-recovery",
      new Error(
        `"${fileName}" in "${directoryName}" could not be read from its live copy and was served from ${fileName}${source} instead. ` +
          `The live file is damaged and every reader is falling back until something rewrites it.`
      ),
      { action: fileName }
    );
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("data:recovered-from-bak", { detail: { fileName, source } })
    );
  }
}
