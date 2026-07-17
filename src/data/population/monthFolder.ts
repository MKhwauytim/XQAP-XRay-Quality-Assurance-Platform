const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

// Matches "5-may-2026", "12-december-2025", etc.
const MONTH_FOLDER_PATTERN = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/;

export type MonthFolderInfo = {
  month: number;
  year: number;
  folderName: string;
};

export function formatMonthFolderName(month: number, year: number): string {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be 1–12, got ${month}`);
  }
  const monthName = MONTH_NAMES_EN[month - 1];
  return `${month}-${monthName.toLowerCase()}-${year}`;
}

export function parseMonthFolderName(name: string): MonthFolderInfo | null {
  const match = MONTH_FOLDER_PATTERN.exec(name);
  if (!match) {
    return null;
  }
  const month = parseInt(match[1], 10);
  const year = parseInt(match[3], 10);
  const monthName = MONTH_NAMES_EN[month - 1];
  // Validate: parsed month name must match what we would generate
  if (!monthName || match[2].toLowerCase() !== monthName.toLowerCase()) {
    return null;
  }
  return { month, year, folderName: name };
}

const MONTH_NAMES_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
] as const;

/**
 * Arabic display label for a month/year pair, e.g. "مايو 2026".
 * Display-only: never use this to derive or compare a folder name.
 */
export function formatMonthShortLabel(month: number, year: number): string {
  const name = MONTH_NAMES_AR[month - 1];
  return name ? `${name} ${year}` : `${month}/${year}`;
}

/** Same as `formatMonthShortLabel`, but takes a folder name directly (e.g. "5-may-2026" to "مايو 2026").
 * Falls back to the raw folder name if it cannot be parsed. */
export function formatMonthFolderShortLabel(folderName: string): string {
  const info = parseMonthFolderName(folderName);
  return info ? formatMonthShortLabel(info.month, info.year) : folderName;
}

export function currentMonthFolderInfo(): MonthFolderInfo {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return { month, year, folderName: formatMonthFolderName(month, year) };
}
