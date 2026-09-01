import { useEffect, useState, useSyncExternalStore } from "react";
import { Activity, Download, X } from "lucide-react";
import { useLabels } from "../../data/labels/useLabels";
import { getRecentErrors, type ErrorEntry } from "../../data/storage/errorLogger";
import {
  startResponsivenessMonitor,
  stopResponsivenessMonitor,
  getFrameSamples,
  subscribeFrameSamples,
  getClickLatencySamples,
  subscribeClickLatencySamples,
} from "../../data/debug/responsivenessMonitor";
import { getSyncSamples, subscribeSyncSamples } from "../../data/debug/syncMetrics";
import { getSyncIntervalMs, getLastSyncStartedAt } from "../../data/workspace/workspaceSync";
import {
  getEnvironmentSnapshot,
  getStorageEstimate,
  type EnvironmentSnapshot,
  type StorageEstimateInfo,
} from "../../data/debug/environmentInfo";
import { summarizeMs } from "../../data/debug/debugStats";
import { exportDemoDebugReport } from "../../data/debug/demoDebugReport";
import "./DemoDebugPanel.css";

// Live-view refresh cadences — all local UI polling of already-computed state
// (never a new sync trigger), matching ErrorLogSection's existing convention
// of a plain setInterval for a badge/list that nothing else re-renders.
const ENVIRONMENT_REFRESH_MS = 5000;
const ERRORS_REFRESH_MS = 3000;
const CLOCK_TICK_MS = 1000;

type DemoDebugPanelProps = {
  onClose: () => void;
};

export function DemoDebugPanel({ onClose }: DemoDebugPanelProps) {
  const L = useLabels();
  const frameSamples = useSyncExternalStore(subscribeFrameSamples, getFrameSamples);
  const clickSamples = useSyncExternalStore(subscribeClickLatencySamples, getClickLatencySamples);
  const syncSamples = useSyncExternalStore(subscribeSyncSamples, getSyncSamples);

  const [errors, setErrors] = useState<ErrorEntry[]>(() => getRecentErrors());
  const [environment, setEnvironment] = useState<EnvironmentSnapshot>(() => getEnvironmentSnapshot());
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo>(null);
  // Read once per render via a ticking interval below, never inline — reading
  // `Date.now()` directly in the render body makes the render impure.
  const [now, setNow] = useState(() => Date.now());
  const [isExporting, setIsExporting] = useState(false);

  // Owns the responsiveness sampler's lifetime: it only runs while this panel
  // is mounted, so opening/closing the debug toggle is the only thing that
  // ever turns rAF/click sampling on or off.
  useEffect(() => {
    startResponsivenessMonitor();
    return () => stopResponsivenessMonitor();
  }, []);

  useEffect(() => {
    void getStorageEstimate().then(setStorageEstimate);
    const environmentId = window.setInterval(() => setEnvironment(getEnvironmentSnapshot()), ENVIRONMENT_REFRESH_MS);
    const errorsId = window.setInterval(() => setErrors(getRecentErrors()), ERRORS_REFRESH_MS);
    const clockId = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      window.clearInterval(environmentId);
      window.clearInterval(errorsId);
      window.clearInterval(clockId);
    };
  }, []);

  const frameStats = summarizeMs(frameSamples.map((s) => s.deltaMs));
  const clickStats = summarizeMs(clickSamples.map((s) => s.latencyMs));
  const lastManualSample = syncSamples.length > 0 ? syncSamples[syncSamples.length - 1] : null;
  const lastSyncStartedAt = getLastSyncStartedAt();
  const secondsSinceLastSync =
    lastSyncStartedAt > 0 ? Math.round((now - lastSyncStartedAt) / 1000) : null;

  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportDemoDebugReport();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="demo-debug-panel" dir="ltr" role="region" aria-label={L.demo_debug_panel_title}>
      <div className="demo-debug-panel-header">
        <span className="demo-debug-panel-title">
          <Activity size={14} aria-hidden />
          {L.demo_debug_panel_title}
        </span>
        <button type="button" className="demo-debug-panel-close" onClick={onClose} aria-label={L.demo_debug_close}>
          <X size={14} aria-hidden />
        </button>
      </div>

      <div className="demo-debug-panel-body">
        <section className="demo-debug-section">
          <h4>{L.demo_debug_section_connection}</h4>
          <ul>
            <li>{environment.network.online ? L.demo_debug_online : L.demo_debug_offline}</li>
            {environment.network.effectiveType !== undefined && (
              <li>{L.demo_debug_effective_type}: {environment.network.effectiveType}</li>
            )}
            {environment.network.downlinkMbps !== undefined && (
              <li>{L.demo_debug_downlink}: {environment.network.downlinkMbps} Mbps</li>
            )}
            {environment.network.rttMs !== undefined && (
              <li>{L.demo_debug_rtt}: {environment.network.rttMs} ms</li>
            )}
            {environment.network.effectiveType === undefined && (
              <li className="demo-debug-muted">{L.demo_debug_connection_unavailable}</li>
            )}
          </ul>
        </section>

        <section className="demo-debug-section">
          <h4>{L.demo_debug_section_sync}</h4>
          <ul>
            <li>{L.demo_debug_sync_interval}: {Math.round(getSyncIntervalMs() / 1000)}s</li>
            <li>
              {L.demo_debug_last_sync}: {secondsSinceLastSync === null ? L.demo_debug_last_sync_never : `${secondsSinceLastSync}s`}
            </li>
            <li>{L.demo_debug_manual_syncs}: {syncSamples.length}</li>
            {lastManualSample && (
              <li>
                {L.demo_debug_last_manual_duration}: {Math.round(lastManualSample.durationMs)}ms (
                {lastManualSample.ok ? L.demo_debug_ok : L.demo_debug_failed})
              </li>
            )}
          </ul>
        </section>

        <section className="demo-debug-section">
          <h4>{L.demo_debug_section_responsiveness}</h4>
          <ul>
            <li>
              {L.demo_debug_frame_avg}: {frameStats.avgMs}ms ({L.demo_debug_frame_max}: {frameStats.maxMs}ms,{" "}
              {L.demo_debug_samples_count}: {frameStats.sampleCount})
            </li>
            <li>
              {L.demo_debug_click_avg}: {clickStats.avgMs}ms ({L.demo_debug_frame_max}: {clickStats.maxMs}ms,{" "}
              {L.demo_debug_samples_count}: {clickStats.sampleCount})
            </li>
          </ul>
        </section>

        <section className="demo-debug-section">
          <h4>{L.demo_debug_section_memory}</h4>
          <ul>
            {environment.memory ? (
              <li>{L.demo_debug_memory_usage}: {environment.memory.usedMB}MB / {environment.memory.limitMB}MB</li>
            ) : (
              <li className="demo-debug-muted">{L.demo_debug_unavailable}</li>
            )}
            {storageEstimate && (
              <li>{L.demo_debug_storage_usage}: {storageEstimate.usageMB}MB / {storageEstimate.quotaMB}MB</li>
            )}
          </ul>
        </section>

        <section className="demo-debug-section">
          <h4>{L.demo_debug_section_errors} ({errors.length})</h4>
          {errors.length === 0 ? (
            <p className="demo-debug-muted">{L.demo_debug_no_errors}</p>
          ) : (
            <ul className="demo-debug-error-list">
              {errors
                .slice(-5)
                .reverse()
                .map((entry, index) => (
                  <li key={index}>
                    <span className="demo-debug-error-ts">{entry.timestamp.slice(11, 19)}</span>
                    <span className="demo-debug-error-ctx">[{entry.context}]</span>
                    <span className="demo-debug-error-msg">{entry.message}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <div className="demo-debug-panel-footer">
        <button
          type="button"
          className="ui-btn ui-btn--primary ui-btn--sm demo-debug-export-btn"
          onClick={() => { void handleExport(); }}
          disabled={isExporting}
        >
          <Download size={14} aria-hidden />
          {isExporting ? L.demo_debug_exporting : L.demo_debug_export_btn}
        </button>
      </div>
    </div>
  );
}
