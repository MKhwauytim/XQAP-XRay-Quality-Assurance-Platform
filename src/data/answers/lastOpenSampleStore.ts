/**
 * A1: which sample the employee last had open, per (user, month), for THIS tab
 * (sessionStorage — survives a reload, not a new tab). After a reload the queue
 * reopens it, so the draft restored for that sample is the one on screen.
 * Registered in storageRegistry.ts. Every access is guarded: storage that
 * throws or is absent degrades to "open the first row", the old behaviour.
 */
export const LAST_OPEN_SAMPLE_KEY_PREFIX = "xray_last_open_sample_v1:";

type Stored = { month: string; xrayImageId: string };

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberLastOpenSample(username: string, monthFolderName: string, xrayImageId: string): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(
      `${LAST_OPEN_SAMPLE_KEY_PREFIX}${username}`,
      JSON.stringify({ month: monthFolderName, xrayImageId } satisfies Stored)
    );
  } catch {
    // Convenience only.
  }
}

export function readLastOpenSample(username: string, monthFolderName: string): string | null {
  const store = sessionStore();
  if (!store) return null;
  try {
    const raw = store.getItem(`${LAST_OPEN_SAMPLE_KEY_PREFIX}${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return parsed.month === monthFolderName && typeof parsed.xrayImageId === "string" ? parsed.xrayImageId : null;
  } catch {
    return null;
  }
}

/** The remembered sample while it is still in the list, else the first row. */
export function pickAutoSelectId(
  displayEntries: readonly { xrayImageId: string }[],
  remembered: string | null
): string | null {
  if (remembered && displayEntries.some((entry) => entry.xrayImageId === remembered)) return remembered;
  return displayEntries[0]?.xrayImageId ?? null;
}
