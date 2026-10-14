import { compareSavedAt } from "./savedAt";
import type { ItemAnswer } from "./answerTypes";

/**
 * Merge this employee's still-unsent items over what the share holds, one entry
 * per `xrayImageId`. A pending item wins only when it is strictly newer than the
 * on-disk one (`compareSavedAt`), so a later landing by another device is never
 * hidden by an older local copy. Pure: neither input is mutated.
 */
export function overlayPendingAnswers(disk: readonly ItemAnswer[], pending: readonly ItemAnswer[]): ItemAnswer[] {
  const byId = new Map(disk.map((i) => [i.xrayImageId, i] as const));
  for (const p of pending) {
    const d = byId.get(p.xrayImageId);
    if (!d || compareSavedAt(p.lastSavedAt, d.lastSavedAt) > 0) byId.set(p.xrayImageId, p);
  }
  return [...byId.values()];
}
