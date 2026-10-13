/**
 * Session memory of segment files that are LISTED by the directory but cannot be
 * OPENED, scan after scan. Field evidence (2026-10-11/12): five segments from two
 * other devices stayed unopenable for >24 h; every reader re-probed them on every
 * scan (~30 s), and every STRICT reader — the pending-answer replay above all —
 * threw on them, so that user's queued answers never landed.
 *
 * "Dead" is deliberately slow to declare: `DEAD_SEGMENT_MIN_SCANS` failed opens
 * spanning at least `DEAD_SEGMENT_MIN_AGE_MS`. A share that has not caught up with
 * a colleague's new file clears in seconds, never minutes.
 *
 * A successful open resets the entry. A manual refresh clears everything so a
 * user can force a re-check. Nothing here touches disk.
 */
export const DEAD_SEGMENT_MIN_SCANS = 3;
export const DEAD_SEGMENT_MIN_AGE_MS = 5 * 60_000;

type Entry = { failures: number; firstFailedAtMs: number; lastFailedAtMs: number; logged: boolean };
const registry = new Map<string, Map<string, Entry>>();

function bucket(scopeKey: string): Map<string, Entry> {
  let m = registry.get(scopeKey);
  if (!m) {
    m = new Map();
    registry.set(scopeKey, m);
  }
  return m;
}

export function recordUnopenableSegment(scopeKey: string, name: string, nowMs: number = Date.now()): void {
  const m = bucket(scopeKey);
  const e = m.get(name);
  if (!e) {
    m.set(name, { failures: 1, firstFailedAtMs: nowMs, lastFailedAtMs: nowMs, logged: false });
    return;
  }
  e.failures += 1;
  e.lastFailedAtMs = nowMs;
}

export function recordOpenableSegment(scopeKey: string, name: string): void {
  registry.get(scopeKey)?.delete(name);
}

export function isConfirmedDead(scopeKey: string, name: string, nowMs: number = Date.now()): boolean {
  const e = registry.get(scopeKey)?.get(name);
  if (!e) return false;
  return e.failures >= DEAD_SEGMENT_MIN_SCANS && nowMs - e.firstFailedAtMs >= DEAD_SEGMENT_MIN_AGE_MS;
}

export function confirmedDeadNames(scopeKey: string, nowMs: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const [name] of registry.get(scopeKey) ?? []) if (isConfirmedDead(scopeKey, name, nowMs)) out.add(name);
  return out;
}

/** True exactly once per (scope, name): the caller logs on true. */
export function markDeadLoggedOnce(scopeKey: string, name: string): boolean {
  const e = registry.get(scopeKey)?.get(name);
  if (!e || e.logged) return false;
  e.logged = true;
  return true;
}

export function clearDeadSegmentRegistry(scopeKey?: string): void {
  if (scopeKey === undefined) registry.clear();
  else registry.delete(scopeKey);
}
