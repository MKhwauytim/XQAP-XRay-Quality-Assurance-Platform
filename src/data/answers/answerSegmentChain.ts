/**
 * A1: one answer-segment chain per (browser, month, answering user), kept
 * across page loads.
 *
 * The chain used to be keyed on the per-page-load session id, and the segment
 * name also carries a creation-minute prefix fixed at module load — so every
 * reload started a new segment file, and because each save reads every segment
 * of the month, every reload made every later save slower. Here the chain id
 * is derived from (month, user) and the prefix is the chain's persisted
 * creation minute; the device part stays `getDistributionDeviceId()` (already
 * persisted per browser), so two browsers never share a segment.
 *
 * Losing the stored minute (cleared site data, private window) only starts a
 * new chain — every reader folds every segment, so nothing is lost.
 */
import { segmentFileName, type AppendOnlyEventLogConfig } from "../storage/appendOnlyEventLog";
import { getDistributionDeviceId } from "../distribution/distributionEventStore";
import { buildAnswerEventLogConfig } from "./answerEventStore";

export const ANSWER_SEGMENT_CHAIN_STORAGE_KEY = "xray_answer_segment_chain_v1";

export type AnswerSegmentChain = { chainId: string; config: AppendOnlyEventLogConfig };

/** In-page memo; also the fallback when localStorage is unavailable. */
const createdAtByChain = new Map<string, number>();

function readStoredChains(): Record<string, number> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(ANSWER_SEGMENT_CHAIN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeStoredChains(chains: Record<string, number>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ANSWER_SEGMENT_CHAIN_STORAGE_KEY, JSON.stringify(chains));
    }
  } catch {
    // The in-page memo still keeps the chain stable for this page load.
  }
}

export function stableAnswerChain(
  monthFolderName: string,
  actor: string,
  nowMs: number = Date.now()
): AnswerSegmentChain {
  const key = `${monthFolderName}|${actor}`;
  let createdAtMs = createdAtByChain.get(key);
  if (createdAtMs === undefined) {
    const stored = readStoredChains();
    const candidate = stored[key];
    createdAtMs = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : nowMs;
    if (candidate !== createdAtMs) writeStoredChains({ ...stored, [key]: createdAtMs });
    createdAtByChain.set(key, createdAtMs);
  }
  return { chainId: `chain|${key}`, config: buildAnswerEventLogConfig(createdAtMs) };
}

/** @internal test-only — forget the in-page memo (a page reload does the same). */
export function __resetAnswerSegmentChainMemoForTests(): void {
  createdAtByChain.clear();
}

/**
 * F11: this browser's current stable-chain segment name for (month, actor) —
 * the seq-0 file its own writes land in — so the sync probe (Task 11) can
 * exclude its OWN appends by name instead of a per-session heuristic. Reuses
 * the same `deviceId`/`buildSegmentBaseName` logic the writer itself uses
 * (`segmentFileName`), so this can never drift from what actually gets
 * written. Rotation (`-1`, `-2`, …) is rare and each rotated name is still
 * globbed as "this chain's" by any caller matching on the returned base, so a
 * single seq-0 name is enough for identity purposes.
 */
export function stableAnswerChainSegmentName(monthFolderName: string, actor: string, nowMs?: number): string {
  const chain = stableAnswerChain(monthFolderName, actor, nowMs);
  return segmentFileName(chain.config, { deviceId: getDistributionDeviceId(), sessionId: chain.chainId }, 0);
}
