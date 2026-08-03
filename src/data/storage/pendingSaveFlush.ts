/**
 * A tiny registry any debounced writer can join so its pending save gets a
 * best-effort flush when the tab is about to go away (close, reload,
 * backgrounding) -- mirrors the pagehide/visibilitychange listener pattern
 * already proven in src/auth/AuthGate.tsx for auth-activity telemetry, but
 * generalized for save-flushing. Each registered flush is called
 * synchronously and defensively (a throw from one never blocks the rest).
 * This does not guarantee the underlying async write completes before the
 * page actually unloads -- browsers give very little time during pagehide --
 * but attempting the write is strictly better than not trying, and it fully
 * covers the more common case of the tab merely being backgrounded/hidden,
 * not closed.
 */
type FlushFn = () => void;

const pendingFlushes = new Set<FlushFn>();

export function registerPendingSaveFlush(flush: FlushFn): () => void {
  pendingFlushes.add(flush);
  return () => {
    pendingFlushes.delete(flush);
  };
}

export function __clearPendingSaveFlushesForTests(): void {
  pendingFlushes.clear();
}

function flushAll(): void {
  for (const flush of pendingFlushes) {
    try {
      flush();
    } catch {
      // Best-effort: one broken registrant must never block the others.
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}
