/**
 * Per-tab memory of segment files that are LISTED by the directory but cannot be
 * OPENED, scan after scan. Field evidence (2026-10-11/12): five segments from two
 * other devices stayed unopenable for >24 h; every reader re-probed them on every
 * scan (~30 s), and every STRICT reader — the pending-answer replay above all —
 * threw on them, so that user's queued answers never landed.
 *
 * "Dead" is deliberately slow to declare: `DEAD_SEGMENT_MIN_SCANS` failed opens
 * spanning at least `DEAD_SEGMENT_MIN_AGE_MS`. A share that has not caught up with
 * a colleague's new file clears in seconds, never minutes.
 *
 * The evidence is written through to sessionStorage (`DEAD_SEGMENTS_KEY_PREFIX`,
 * registered in storageRegistry.ts) and hydrated lazily per scope: a page reload
 * must not restart the 5-minute window, or a user who reloads more often than
 * that never gets past the gate (field cause, 2026-10-13). For the same reason a
 * manual refresh no longer clears it: `requestDeadSegmentRecheck` makes the next
 * scan of each scope re-open its dead names ONCE, and only a successful open
 * (`recordOpenableSegment`) drops an entry.
 *
 * Scope keys are workspace-relative directory paths (`directoryResourceKey`), not
 * workspace-qualified: no stable workspace identity exists without a disk read.
 * Two workspaces opened in ONE tab can therefore share a bucket for the same
 * month path. That is harmless in practice: an entry only matters for a name the
 * current workspace lists, segment names carry a device id and time prefix, and a
 * name that opens is dropped at once.
 */
export const DEAD_SEGMENT_MIN_SCANS = 3;
export const DEAD_SEGMENT_MIN_AGE_MS = 5 * 60_000;
export const DEAD_SEGMENTS_KEY_PREFIX = "xray_dead_segments_v1:";

/** Bounds on what one tab persists: names per scope, and an idle age after which an entry is forgotten. */
const MAX_NAMES_PER_SCOPE = 64;
const STALE_ENTRY_MS = 24 * 60 * 60_000;

type Entry = { failures: number; firstFailedAtMs: number; lastFailedAtMs: number; logged: boolean };
type Bucket = { entries: Map<string, Entry>; recheckGeneration: number };
type Persisted = Record<string, [failures: number, firstFailedAtMs: number, lastFailedAtMs: number]>;

const registry = new Map<string, Bucket>();
let recheckGeneration = 0;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hydrate(scopeKey: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const store = sessionStore();
  if (!store) return entries;
  try {
    const raw = store.getItem(`${DEAD_SEGMENTS_KEY_PREFIX}${scopeKey}`);
    if (!raw) return entries;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return entries;
    for (const [name, value] of Object.entries(parsed as Persisted)) {
      if (!Array.isArray(value) || !value.every(isFiniteNumber)) continue;
      const [failures, firstFailedAtMs, lastFailedAtMs] = value;
      entries.set(name, { failures, firstFailedAtMs, lastFailedAtMs, logged: false });
    }
  } catch {
    // Unreadable or corrupt: start this scope fresh, exactly as before persistence.
  }
  return entries;
}

function persist(scopeKey: string, entries: Map<string, Entry>, nowMs: number): void {
  const store = sessionStore();
  if (!store) return;
  const key = `${DEAD_SEGMENTS_KEY_PREFIX}${scopeKey}`;
  try {
    const kept = [...entries]
      .filter(([, e]) => nowMs - e.lastFailedAtMs < STALE_ENTRY_MS)
      .sort((a, b) => b[1].lastFailedAtMs - a[1].lastFailedAtMs)
      .slice(0, MAX_NAMES_PER_SCOPE);
    if (kept.length === 0) {
      store.removeItem(key);
      return;
    }
    const out: Persisted = {};
    for (const [name, e] of kept) out[name] = [e.failures, e.firstFailedAtMs, e.lastFailedAtMs];
    store.setItem(key, JSON.stringify(out));
  } catch {
    // Quota or blocked storage: the in-memory evidence still works for this page load.
  }
}

function bucket(scopeKey: string): Bucket {
  let b = registry.get(scopeKey);
  if (!b) {
    // Generation 0: a scope first touched after a recheck request is re-checked too.
    b = { entries: hydrate(scopeKey), recheckGeneration: 0 };
    registry.set(scopeKey, b);
  }
  return b;
}

export function recordUnopenableSegment(scopeKey: string, name: string, nowMs: number = Date.now()): void {
  const { entries } = bucket(scopeKey);
  const e = entries.get(name);
  if (!e) {
    entries.set(name, { failures: 1, firstFailedAtMs: nowMs, lastFailedAtMs: nowMs, logged: false });
  } else {
    e.failures += 1;
    e.lastFailedAtMs = nowMs;
  }
  persist(scopeKey, entries, nowMs);
}

export function recordOpenableSegment(scopeKey: string, name: string): void {
  const { entries } = bucket(scopeKey);
  if (!entries.delete(name)) return;
  persist(scopeKey, entries, Date.now());
}

export function isConfirmedDead(scopeKey: string, name: string, nowMs: number = Date.now()): boolean {
  const e = bucket(scopeKey).entries.get(name);
  if (!e) return false;
  return e.failures >= DEAD_SEGMENT_MIN_SCANS && nowMs - e.firstFailedAtMs >= DEAD_SEGMENT_MIN_AGE_MS;
}

/**
 * The names a scan of this scope must not open. Empty ONCE per scope after a
 * `requestDeadSegmentRecheck`, so that scan re-opens them; their evidence is kept,
 * so a name that still fails is dead again immediately.
 */
export function confirmedDeadNames(scopeKey: string, nowMs: number = Date.now()): Set<string> {
  const b = bucket(scopeKey);
  if (b.recheckGeneration !== recheckGeneration) {
    b.recheckGeneration = recheckGeneration;
    return new Set();
  }
  const out = new Set<string>();
  for (const [name] of b.entries) if (isConfirmedDead(scopeKey, name, nowMs)) out.add(name);
  return out;
}

/** True exactly once per (scope, name) per page load: the caller logs on true. */
export function markDeadLoggedOnce(scopeKey: string, name: string): boolean {
  const e = bucket(scopeKey).entries.get(name);
  if (!e || e.logged) return false;
  e.logged = true;
  return true;
}

/** A user-initiated refresh: the next scan of every scope re-opens its dead names once. Evidence is kept. */
export function requestDeadSegmentRecheck(): void {
  recheckGeneration += 1;
}

/** Forget evidence (memory AND this tab's sessionStorage) for one scope, or for all. */
export function clearDeadSegmentRegistry(scopeKey?: string): void {
  const store = sessionStore();
  if (scopeKey !== undefined) {
    registry.delete(scopeKey);
    try {
      store?.removeItem(`${DEAD_SEGMENTS_KEY_PREFIX}${scopeKey}`);
    } catch {
      // ignore
    }
    return;
  }
  registry.clear();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(DEAD_SEGMENTS_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // ignore
  }
}

/** TEST-ONLY: a page reload — module memory gone, sessionStorage kept. */
export function __resetDeadSegmentRegistryMemoryForTests(): void {
  registry.clear();
  recheckGeneration = 0;
}

/** TEST-ONLY: the scope keys holding evidence in this page load. */
export function __deadSegmentScopesForTests(): string[] {
  return [...registry].filter(([, b]) => b.entries.size > 0).map(([key]) => key);
}
