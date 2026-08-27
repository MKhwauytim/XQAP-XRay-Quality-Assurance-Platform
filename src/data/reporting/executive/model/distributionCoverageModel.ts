// Relocated from distributionReport.ts (2026-08-27): computeDistributionModel
// and DistributionBucket are consumed by the Executive report family
// (reportModel.ts, deck2's coverage slide, the document's Part 6, and the
// workbook export) independently of the standalone "تقرير التوزيع"
// document/deck/xlsx builder, which is being retired. This module is their
// shared home so retiring that builder doesn't break Executive reporting.

import type { DistributionCurrentData } from "../../../distribution/distributionTypes";
import { formatMonthLabel } from "../../shared/reportChrome";

/** Percentage of n over d, or null when the denominator is empty (renders "—"). */
function ratePct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

// ─── Distribution model (pure) ────────────────────────────────────────────────

type EmployeeStat = {
  username: string;
  displayName: string;
  total: number;
  pending: number;
  completed: number;
  requested: number;
  replaced: number;
  dailyQuota: number | null;
  completionRate: number | null;
};

/** Per-employee counts within one grouping bucket (a stage/level or a port). */
type BucketEmployeeStat = {
  username: string;
  displayName: string;
  assigned: number;
  completed: number;
  completionRate: number | null;
};

/** A grouping bucket (per-stage/level or per-port) listing every employee who
 *  took samples in it and how many (R2: "section 1 per stage, section 2 per port"). */
export type DistributionBucket = {
  key: string;
  label: string;
  totalAssigned: number;
  totalCompleted: number;
  completionRate: number | null;
  employees: BucketEmployeeStat[];
};

export type DistributionModel = {
  monthFolderName: string;
  monthLabel: string;
  derivedAt: string;
  totalAssigned: number;
  totalPending: number;
  totalCompleted: number;
  totalReplaced: number;
  totalRequested: number;
  completionRate: number | null;
  employees: EmployeeStat[];
  /** Section 1 — per stage/level, each listing all employees and their sample counts. */
  byStage: DistributionBucket[];
  /** Section 2 — per port, each listing all employees and their sample counts. */
  byPort: DistributionBucket[];
  /** Replacement/replaced entries surfaced as event-log highlights. */
  highlights: Array<{ xrayImageId: string; assignedTo: string; displayName: string; status: string; portName: string; lastEventAt: string; replacedById: string | null }>;
};

/** Group distribution entries into per-key buckets (stage or port), each with
 *  a per-employee breakdown. Bucket order: highest total first (ties → key
 *  ascending, for deterministic output). Employee order within a bucket:
 *  highest assigned first (ties → username ascending). */
function groupEntries(
  entries: DistributionCurrentData["entries"],
  keyOf: (e: DistributionCurrentData["entries"][number]) => string,
  nameOf: (u: string) => string,
): DistributionBucket[] {
  const buckets = new Map<string, Map<string, BucketEmployeeStat>>();
  for (const e of entries) {
    const key = keyOf(e) || "غير محدد";
    let empMap = buckets.get(key);
    if (!empMap) { empMap = new Map(); buckets.set(key, empMap); }
    let stat = empMap.get(e.assignedTo);
    if (!stat) {
      stat = { username: e.assignedTo, displayName: nameOf(e.assignedTo), assigned: 0, completed: 0, completionRate: null };
      empMap.set(e.assignedTo, stat);
    }
    stat.assigned++;
    if (e.status === "completed") stat.completed++;
  }
  return [...buckets.entries()]
    .map(([key, empMap]) => {
      const employees = [...empMap.values()]
        .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.assigned) }))
        .sort((a, b) => b.assigned - a.assigned || a.username.localeCompare(b.username));
      const totalAssigned = employees.reduce((s, e) => s + e.assigned, 0);
      const totalCompleted = employees.reduce((s, e) => s + e.completed, 0);
      return { key, label: key, totalAssigned, totalCompleted, completionRate: ratePct(totalCompleted, totalAssigned), employees };
    })
    .sort((a, b) => b.totalAssigned - a.totalAssigned || a.key.localeCompare(b.key));
}

export function computeDistributionModel(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
): DistributionModel {
  const nameOf = (u: string): string => employeeDisplayNames[u] ?? u;

  const byEmp = new Map<string, EmployeeStat>();
  for (const e of data.entries) {
    let s = byEmp.get(e.assignedTo);
    if (!s) {
      s = {
        username: e.assignedTo, displayName: nameOf(e.assignedTo),
        total: 0, pending: 0, completed: 0, requested: 0, replaced: 0,
        dailyQuota: data.quotas?.[e.assignedTo]?.dailyQuota ?? null,
        completionRate: null,
      };
      byEmp.set(e.assignedTo, s);
    }
    s.total++;
    if (e.status === "pending") s.pending++;
    else if (e.status === "completed") s.completed++;
    else if (e.status === "replaced") s.replaced++;
    else if (e.status === "replacement-requested") s.requested++;
  }
  const employees = [...byEmp.values()]
    .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.total) }))
    .sort((a, b) => b.total - a.total);

  const totalRequested = data.entries.filter((e) => e.status === "replacement-requested").length;

  const highlights = data.entries
    .filter((e) => e.status === "replacement-requested" || e.status === "replaced")
    .slice(0, 40)
    .map((e) => ({
      xrayImageId: e.xrayImageId,
      assignedTo: e.assignedTo,
      displayName: nameOf(e.assignedTo),
      status: e.status,
      portName: e.row.portName ?? "—",
      lastEventAt: e.lastEventAt,
      replacedById: e.replacedById,
    }));

  return {
    monthFolderName,
    monthLabel: formatMonthLabel(monthFolderName),
    derivedAt: data.derivedAt,
    totalAssigned: data.totalAssigned,
    totalPending: data.totalPending,
    totalCompleted: data.totalCompleted,
    totalReplaced: data.totalReplaced,
    totalRequested,
    completionRate: ratePct(data.totalCompleted, data.totalAssigned),
    employees,
    byStage: groupEntries(data.entries, (e) => e.row.stage ?? "غير محدد", nameOf),
    byPort: groupEntries(data.entries, (e) => e.row.portName ?? "غير محدد", nameOf),
    highlights,
  };
}
