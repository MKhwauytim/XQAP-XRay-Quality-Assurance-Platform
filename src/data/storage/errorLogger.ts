export type ErrorEntry = {
  context: string;
  message: string;
  timestamp: string;
};

const MAX_ENTRIES = 50;
const entries: ErrorEntry[] = [];

export function logError(context: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  entries.push({ context, message, timestamp: new Date().toISOString() });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function getRecentErrors(): ErrorEntry[] {
  return entries.slice();
}

export function clearErrors(): void {
  entries.length = 0;
}
