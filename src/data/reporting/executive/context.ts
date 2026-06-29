import type { ExecutiveReportInput, ExecutiveKPIs, ExecutiveReportRow } from "../executiveReportTypes";

export type ExecutiveRenderContext = {
  input: ExecutiveReportInput;
  kpis: ExecutiveKPIs;
  /** month name in Arabic e.g. "مايو 2026" */
  monthLabel: string;
  /** issue date e.g. "29 / 06 / 2026" */
  issueDate: string;
  /** resolved display name for a username */
  displayName: (username: string) => string;
  /** anonymize codes stable by accuracy rank */
  anonymizeMap: Map<string, string>;
  /** Phase 4 employee analytics rows */
  rows: ExecutiveReportRow[];
};

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function formatMonthLabel(folderName: string): string {
  const m = /^(\d{1,2})-[A-Za-z]+-(\d{4})$/.exec(folderName.trim());
  if (!m) return folderName;
  const name = ARABIC_MONTHS[Number(m[1]) - 1];
  return name ? `${name} ${m[2]}` : folderName;
}

function formatIssueDate(d = new Date()): string {
  return `${String(d.getDate()).padStart(2,"0")} / ${String(d.getMonth()+1).padStart(2,"0")} / ${d.getFullYear()}`;
}

export function buildContext(
  input: ExecutiveReportInput,
  kpis: ExecutiveKPIs,
  employeeDisplayNames: Record<string, string> = {},
  rows: ExecutiveReportRow[] = [],
): ExecutiveRenderContext {
  const anonymizeMap = new Map<string, string>();

  function displayName(username: string): string {
    if (input.config.showEmployeeNames === false) {
      if (!anonymizeMap.has(username)) {
        const idx = anonymizeMap.size + 1;
        anonymizeMap.set(username, `موظف ${idx}`);
      }
      return anonymizeMap.get(username)!;
    }
    return employeeDisplayNames[username] ?? username;
  }

  return {
    input,
    kpis,
    monthLabel: formatMonthLabel(input.monthFolderName),
    issueDate: formatIssueDate(),
    displayName,
    anonymizeMap,
    rows,
  };
}
