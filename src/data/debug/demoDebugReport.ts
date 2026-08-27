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
 * (a stack trace can embed file/user paths), so this report omits them —
 * everything else (`message`, `context`, `page`, `action`, `errorCode`,
 * `errorName`, `at`/`timestamp`, `restored`) stays, since none of those are
 * populated with free text that names a person; see `ErrorEntry` in
 * `errorLogger.ts` for the field contracts this relies on.
 */
export type DemoDebugErrorEntry = Omit<ErrorEntry, "username" | "role" | "stack">;

function toDemoDebugErrorEntry(entry: ErrorEntry): DemoDebugErrorEntry {
  return {
    context: entry.context,
    message: entry.message,
    timestamp: entry.timestamp,
    ...(entry.errorName !== undefined ? { errorName: entry.errorName } : {}),
    ...(entry.page !== undefined ? { page: entry.page } : {}),
    ...(entry.action !== undefined ? { action: entry.action } : {}),
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
