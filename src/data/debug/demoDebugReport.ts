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
  errors: ErrorEntry[];
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
    errors: getRecentErrors(),
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
