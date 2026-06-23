const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

// Matches "5-May-2026", "12-December-2025", etc.
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
  return `${month}-${monthName}-${year}`;
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

export function currentMonthFolderInfo(): MonthFolderInfo {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return { month, year, folderName: formatMonthFolderName(month, year) };
}
