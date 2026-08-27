/**
 * Environment/connection snapshot for the demo debug panel and its exported
 * report. Every field is best-effort and optional: the Network Information
 * API, `performance.memory` and `navigator.storage.estimate()` are all
 * Chromium-only (this app already requires Chromium for the File System
 * Access API — see CLAUDE.md), and even there a field can be absent.
 */

/** Minimal shape of the (Chromium-only, not in lib.dom.d.ts) NetworkInformation API. */
interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

/** Minimal shape of the (Chromium-only, non-standard) `performance.memory`. */
interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

export type NetworkInfo = {
  online: boolean;
  effectiveType?: string;
  downlinkMbps?: number;
  rttMs?: number;
  saveData?: boolean;
};

export function getNetworkInfo(): NetworkInfo {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const connection =
    typeof navigator !== "undefined" ? (navigator as NavigatorWithConnection).connection : undefined;
  if (!connection) return { online };
  return {
    online,
    effectiveType: connection.effectiveType,
    downlinkMbps: connection.downlink,
    rttMs: connection.rtt,
    saveData: connection.saveData,
  };
}

export type MemoryInfo = { usedMB: number; totalMB: number; limitMB: number } | null;

function toMB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

export function getMemoryInfo(): MemoryInfo {
  const memory = typeof performance !== "undefined" ? (performance as PerformanceWithMemory).memory : undefined;
  if (!memory) return null;
  return {
    usedMB: toMB(memory.usedJSHeapSize),
    totalMB: toMB(memory.totalJSHeapSize),
    limitMB: toMB(memory.jsHeapSizeLimit),
  };
}

export type StorageEstimateInfo = { usageMB: number; quotaMB: number } | null;

export async function getStorageEstimate(): Promise<StorageEstimateInfo> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") return null;
  try {
    const estimate = await navigator.storage.estimate();
    if (estimate.usage === undefined || estimate.quota === undefined) return null;
    return { usageMB: toMB(estimate.usage), quotaMB: toMB(estimate.quota) };
  } catch {
    return null;
  }
}

export type EnvironmentSnapshot = {
  userAgent: string;
  viewport: { width: number; height: number } | null;
  appVersion: string;
  network: NetworkInfo;
  memory: MemoryInfo;
};

export function getEnvironmentSnapshot(): EnvironmentSnapshot {
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport:
      typeof window !== "undefined" ? { width: window.innerWidth, height: window.innerHeight } : null,
    appVersion: __APP_VERSION__,
    network: getNetworkInfo(),
    memory: getMemoryInfo(),
  };
}
