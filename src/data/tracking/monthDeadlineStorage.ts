// Admin override of a sample month's deadline (the default is the distribution
// deadline: last day of the month − 3). One small shared file at the workspace
// system root, outside every month folder so a closed month never blocks it.
// Same CAS contract as `templateSelectionStorage.ts`: revision + _writeToken,
// verified on read-back, under an outer lock for same-tab writers.
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getSystemRoot } from "../workspace/workspacePaths";
import { parseMonthFolderName } from "../population/monthFolder";
import { defaultQuotaDeadline } from "../../utils/workingDays";

export const MONTH_DEADLINES_FILE = "month-deadlines.json";

export type MonthDeadlineOverride = {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  updatedAt: string;
  updatedBy: string;
};

export type MonthDeadlinesFile = {
  deadlines: Record<string, MonthDeadlineOverride>;
  /** Monotonic CAS revision for this shared, multi-admin file. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};

export type ResolvedDeadline = {
  date: Date;
  source: "default" | "override";
  override: MonthDeadlineOverride | null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD` to a local date; null for a malformed or impossible day. */
export function parseDeadlineDate(value: string): Date | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function formatDeadlineDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when `value` is a real day inside the given month folder's month. */
export function isDeadlineInMonth(monthFolderName: string, value: string): boolean {
  const info = parseMonthFolderName(monthFolderName);
  const date = parseDeadlineDate(value);
  return !!info && !!date && date.getFullYear() === info.year && date.getMonth() === info.month - 1;
}

/** The deadline in force for a month: the admin override when valid, else the distribution default. */
export function resolveDeadline(
  year: number,
  month: number,
  override: MonthDeadlineOverride | null | undefined,
): ResolvedDeadline {
  const parsed = override ? parseDeadlineDate(override.date) : null;
  if (override && parsed && parsed.getFullYear() === year && parsed.getMonth() === month - 1) {
    return { date: parsed, source: "override", override };
  }
  return { date: defaultQuotaDeadline(year, month), source: "default", override: null };
}

export async function loadMonthDeadline(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
): Promise<MonthDeadlineOverride | null> {
  try {
    const dir = await getSystemRoot(directoryHandle, true);
    const result = await safeReadJson<MonthDeadlinesFile>(dir, MONTH_DEADLINES_FILE);
    return result.ok ? result.value.deadlines?.[monthFolderName] ?? null : null;
  } catch {
    return null;
  }
}

async function casUpdate(
  directoryHandle: DirectoryHandleLike,
  apply: (deadlines: Record<string, MonthDeadlineOverride>) => Record<string, MonthDeadlineOverride>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getSystemRoot(directoryHandle, true);
    const outcome = await withResourceLock(`${dir.name}/month-deadlines:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<MonthDeadlinesFile>(dir, MONTH_DEADLINES_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: MonthDeadlinesFile = {
            deadlines: apply(existing.ok ? { ...(existing.value.deadlines ?? {}) } : {}),
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, MONTH_DEADLINES_FILE, updated);
          const stillMine = async () => {
            const r = await safeReadJson<MonthDeadlinesFile>(dir, MONTH_DEADLINES_FILE);
            return r.ok && r.value.revision === nextRevision && r.value._writeToken === writeToken;
          };
          if (await stillMine()) return { done: true, result: { ok: true as const }, verify: stillMine };
          return { done: false };
        },
        {
          context: "tracking:monthDeadline",
          conflictError: "تعذّر حفظ الموعد النهائي: تعارض في الكتابة بعد عدة محاولات.",
        },
      ),
    );
    return "error" in outcome ? { ok: false, error: outcome.error } : { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function saveMonthDeadline(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  date: string,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDeadlineInMonth(monthFolderName, date)) {
    return { ok: false, error: "يجب أن يقع الموعد داخل الشهر المحدد." };
  }
  return casUpdate(directoryHandle, (deadlines) => ({
    ...deadlines,
    [monthFolderName]: { date, updatedAt: new Date().toISOString(), updatedBy },
  }));
}

/** Back to the distribution default for that month. */
export function clearMonthDeadline(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return casUpdate(directoryHandle, (deadlines) => {
    const next = { ...deadlines };
    delete next[monthFolderName];
    return next;
  });
}
