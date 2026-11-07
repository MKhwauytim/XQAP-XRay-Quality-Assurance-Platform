/**
 * Published design numbers. Append-only: see the lock rule in registry.ts.
 * (A .ts const rather than numbers.lock.json because tsconfig does not enable resolveJsonModule.)
 */
export interface LockEntry {
  nameAr: string;
  slotIds: string[];
}

export const NUMBERS_LOCK: Record<number, LockEntry> = {};
