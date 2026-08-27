/**
 * "Everything needed to debug the demo in one file" — assembled from every
 * other demo-debug module and downloaded as a single JSON document, so a
 * report from a user's machine can be attached to a bug report without
 * screen-sharing a live session.
 */
import { getRecentErrors, type ErrorEntry } from "../storage/errorLogger";
import { getSyncIntervalMs, getLastSyncStartedAt } from "../workspace/workspaceSync";
import { getEnvironmentSnapshot, getStorageEstimate, type EnvironmentSnapshot, type StorageEstimateInfo } from "./environmentInfo";
import { getSyncSamples, type SyncSample } from "./syncMetrics";
import { getFrameSamples, getClickLatencySamples, type FrameSample, type ClickLatencySample } from "./responsivenessMonitor";
import { summarizeMs, type MsStats } from "./debugStats";

/**
 * The ring buffer this report reads from (`errorLogger.ts`'s `entries`) is
 * module-scoped and outlives login/logout — it is never cleared on sign-out.
 * A prior real user's session can therefore still be sitting in it when a
 * demo session is later opened in the same tab. `username`, `role`, and
 * `stack` are the fields on `ErrorEntry` that can identify that real person
 * outright (a stack trace can embed file/user paths), so this report omits
 * them entirely.
 *
 * That is NOT sufficient on its own: `message`, `context`, and `action` are
 * free text and can still carry a real username. Per-user workspace files are
 * named `{username}.answers.json` / `{username}.samples.json`
 * (`safeWorkspaceFilePart`, `answerStorage.ts`/`sampleMirrorStorage.ts`) and
 * `{username}-{hash}.errors.json` / `.activity.json` / `.actions.json`
 * (`auditUserStem`, `auditPaths.ts`/`errorLogPaths.ts`). When a write to one
 * of those files fails, `safeWrite.ts` throws raw messages like
 * `` `Safe-write staging failed for ${fileName}.` `` that embed the full
 * filename — and call sites such as `answerStorage.ts`'s `onExhausted` pass
 * that raw cause straight into `logError`, landing verbatim on
 * `ErrorEntry.message`. So a real user's identity can reach this report
 * through `message` (and, defensively, `context`/`action`, in case a similar
 * embedded-filename pattern ever appears there) even though the entry's own
 * `username` field was stripped. `redactUserFilenames` below finds any
 * substring shaped like one of those per-user filenames and replaces the
 * identifying part with a fixed `[user]` placeholder — keeping which file
 * TYPE failed (and the rest of the diagnostic text) intact — before those
 * three fields go into the report. `page`, `errorCode`, `errorName`,
 * `at`/`timestamp`, and `restored` are left as-is: they are drawn from fixed
 * enumerations or structured values, never free text a caller composes with a
 * username. See `ErrorEntry` in `errorLogger.ts` for the field contracts this
 * relies on.
 */
export type DemoDebugErrorEntry = Omit<ErrorEntry, "username" | "role" | "stack">;

/**
 * Matches a per-user workspace filename embedded in a message/context/action
 * string — `{identifier}.answers.json`, `{identifier}.samples.json`, or
 * `{identifier}-{hash}.errors[.{year}].json` / `.activity.json` /
 * `.actions.json` — and captures the suffix so the replacement can say which
 * file type it was without keeping the identifying part. `\S+` (rather than a
 * fixed character class) deliberately makes no assumption about what
 * characters a username may contain — this app allows Arabic names — and
 * relies on greedy backtracking to land on the rightmost occurrence of the
 * known suffix within the run of non-whitespace characters.
 */
const USER_FILENAME_PATTERN =
  /\S+\.(answers|samples|errors|activity|actions)(?:\.\d{4})?\.json/g;

function redactUserFilenames(value: string): string {
  return value.replace(USER_FILENAME_PATTERN, (_match, suffix: string) => `[user].${suffix}.json`);
}

function toDemoDebugErrorEntry(entry: ErrorEntry): DemoDebugErrorEntry {
  return {
    context: redactUserFilenames(entry.context),
    message: redactUserFilenames(entry.message),
    timestamp: entry.timestamp,
    ...(entry.errorName !== undefined ? { errorName: entry.errorName } : {}),
    ...(entry.page !== undefined ? { page: entry.page } : {}),
    ...(entry.action !== undefined ? { action: redactUserFilenames(entry.action) } : {}),
    ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
    ...(entry.restored !== undefined ? { restored: entry.restored } : {}),
  };
}

export type DemoDebugReport = {
  generatedAt: string;
  environment: EnvironmentSnapshot & { storage: StorageEstimateInfo };
  sync: {
    intervalMs: number;
    lastSyncStartedAt: number;
    manualSamples: SyncSample[];
  };
  responsiveness: {
    frameSamples: FrameSample[];
    frameStats: MsStats;
    clickSamples: ClickLatencySample[];
    clickStats: MsStats;
  };
  errors: DemoDebugErrorEntry[];
};

export async function buildDemoDebugReport(): Promise<DemoDebugReport> {
  const storage = await getStorageEstimate();
  const frameSamples = getFrameSamples();
  const clickSamples = getClickLatencySamples();

  return {
    generatedAt: new Date().toISOString(),
    environment: { ...getEnvironmentSnapshot(), storage },
    sync: {
      intervalMs: getSyncIntervalMs(),
      lastSyncStartedAt: getLastSyncStartedAt(),
      manualSamples: getSyncSamples(),
    },
    responsiveness: {
      frameSamples,
      frameStats: summarizeMs(frameSamples.map((s) => s.deltaMs)),
      clickSamples,
      clickStats: summarizeMs(clickSamples.map((s) => s.latencyMs)),
    },
    errors: getRecentErrors().map(toDemoDebugErrorEntry),
  };
}

/** Same blob+anchor download pattern as `reporting/htmlReport.ts`'s `downloadHtml`. */
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function exportDemoDebugReport(): Promise<DemoDebugReport> {
  const report = await buildDemoDebugReport();
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  downloadJson(report, `xqap-demo-debug-report-${stamp}.json`);
  return report;
}
