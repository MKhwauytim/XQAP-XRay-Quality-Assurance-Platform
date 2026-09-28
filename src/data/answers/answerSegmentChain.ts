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
import {
  buildSegmentBaseName,
  segmentFileNameForSeq,
  type AppendOnlyEventLogConfig,
} from "../storage/appendOnlyEventLog";
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

/** Shared by every F11 accessor below — the writer identity `buildSegmentBaseName` needs. */
function stableChainWriter(chain: AnswerSegmentChain): { deviceId: string; sessionId: string } {
  return { deviceId: getDistributionDeviceId(), sessionId: chain.chainId };
}

/**
 * F11: this browser's current stable-chain segment BASE name for
 * (month, actor) — the prefix shared by every segment this chain has ever
 * written (seq 0, and any `-1`, `-2`, … rotation), so the sync probe (Task 11)
 * can exclude ALL of this chain's own appends by prefix-matching real segment
 * file names against this, instead of a per-session heuristic. Built with the
 * same `buildSegmentBaseName` call the writer itself uses, so this can never
 * drift from what actually gets written. MINTS the chain (persists a fresh
 * creation minute) if none exists yet for this (month, actor) — see
 * `peekStableAnswerChainSegmentBase` for a variant that does not.
 */
export function stableAnswerChainSegmentBase(monthFolderName: string, actor: string, nowMs?: number): string {
  const chain = stableAnswerChain(monthFolderName, actor, nowMs);
  return buildSegmentBaseName(stableChainWriter(chain), chain.config.segmentSuffix, chain.config.baseNamePrefix);
}

/**
 * F11: this browser's current stable-chain segment FILE name (seq 0 only —
 * NOT a prefix; see `stableAnswerChainSegmentBase` for one that also matches
 * rotations) for (month, actor). MINTS the chain if none exists yet, exactly
 * like `stableAnswerChainSegmentBase`.
 */
export function stableAnswerChainSegmentName(monthFolderName: string, actor: string, nowMs?: number): string {
  const chain = stableAnswerChain(monthFolderName, actor, nowMs);
  const base = buildSegmentBaseName(stableChainWriter(chain), chain.config.segmentSuffix, chain.config.baseNamePrefix);
  return segmentFileNameForSeq(base, 0, chain.config.segmentSuffix);
}

/**
 * Read-only counterpart of `stableAnswerChainSegmentBase` — for the sync
 * probe (Task 11), which must be able to ask "what is MY segment prefix for
 * this (month, actor)?" without the side effect of minting and PERSISTING a
 * brand-new chain entry for a (month, actor) this browser may never actually
 * write to. Returns `undefined` when no chain has been created yet (in this
 * page's memo or in `localStorage`) — in that case there is nothing on disk
 * for this browser to have written either, so the caller has nothing to
 * exclude.
 */
export function peekStableAnswerChainSegmentBase(monthFolderName: string, actor: string): string | undefined {
  const key = `${monthFolderName}|${actor}`;
  const createdAtMs = createdAtByChain.get(key) ?? readStoredChains()[key];
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) return undefined;
  const config = buildAnswerEventLogConfig(createdAtMs);
  const chainId = `chain|${key}`;
  return buildSegmentBaseName(
    { deviceId: getDistributionDeviceId(), sessionId: chainId },
    config.segmentSuffix,
    config.baseNamePrefix
  );
}

/**
 * A predicate over segment file names: true for every segment of THIS browser's
 * stable chain for (month, actor) — seq 0 and each `-n` rotation, from this page
 * load or any earlier one. The sync probe (A11) uses it to leave the user's own
 * appends out of the `answers.events` signature: a per-session "written this
 * page load" set starts empty after a reload, so the first own save would then
 * change the signature and come back as a remote change. Read-only (never mints
 * a chain); `undefined` when this browser has no chain for (month, actor), i.e.
 * nothing on disk can be its own.
 */
export function ownStableAnswerSegmentMatcher(
  monthFolderName: string,
  actor: string
): ((name: string) => boolean) | undefined {
  const base = peekStableAnswerChainSegmentBase(monthFolderName, actor);
  if (base === undefined) return undefined;
  const suffix = buildAnswerEventLogConfig(0).segmentSuffix;
  return (name) => {
    if (!name.endsWith(suffix)) return false;
    const stem = name.slice(0, -suffix.length);
    return stem === base || (stem.startsWith(`${base}-`) && /^[1-9][0-9]{0,5}$/.test(stem.slice(base.length + 1)));
  };
}
