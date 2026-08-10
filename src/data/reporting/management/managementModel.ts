// Management report model (تقرير الإدارة) — R3 restructure (2026-08-07).
//
// The previous management editions (document/deck/workbook) all reused the
// EXECUTIVE `ReportModel` verbatim — an accuracy/QA-shaped model (overall
// accuracy, missed-suspicion rate, reviewer accuracy profiles). The owner's
// actual R3 requirement is assignment-PROGRESS-shaped, not accuracy-shaped:
// per-employee completion progress ("this employee finished 50% of the
// sample in port A"), replacement counts WITH REASONS, and reassignment
// counts — none of which the accuracy model carries. Per the owner's
// standing directive (prefer enhancing, but rewrite when preserving would be
// heavier/slower), this is a full model swap, not a bolt-on.
//
// Section ordering mirrors the distribution report (R2) per the owner's
// revision ("make section 1 per stage and 2 per port" applies to both):
// section 1 groups by stage/level, section 2 groups by port.
//
// SECURITY: every interpolated model/user value must be routed through the
// hardened `esc` primitive by the renderers that consume this model — the
// model itself only produces plain data.

import type { DistributionCurrentData, DistributionEvent } from "../../distribution/distributionTypes";
import { formatMonthLabel } from "../shared/reportChrome";

/** Percentage of n over d, or null when the denominator is empty (renders "—"). */
function ratePct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

export type ManagementEmployeeProgress = {
  username: string;
  displayName: string;
  assigned: number;
  completed: number;
  /** "This employee finished X% of the sample in this bucket" (owner's own example). */
  completionRate: number | null;
};

/** A grouping bucket — either a stage/level (section 1) or a port (section 2). */
export type ManagementBucket = {
  key: string;
  label: string;
  totalAssigned: number;
  totalCompleted: number;
  completionRate: number | null;
  employees: ManagementEmployeeProgress[];
};

export type ManagementReplacementRecord = {
  xrayImageId: string;
  /** The employee the image was replaced FROM (its assignee at replacement time). */
  username: string;
  displayName: string;
  portName: string;
  /** null when no matching approved replacement/referral request reason was found. */
  reason: string | null;
  replacedById: string | null;
  lastEventAt: string;
};

export type ManagementModel = {
  monthFolderName: string;
  monthLabel: string;
  derivedAt: string;
  totals: {
    assigned: number;
    completed: number;
    pending: number;
    replaced: number;
    requested: number;
    completionRate: number | null;
  };
  /** Section 1 — per stage/level. */
  byStage: ManagementBucket[];
  /** Section 2 — per port. */
  byPort: ManagementBucket[];
  replacements: {
    total: number;
    records: ManagementReplacementRecord[];
    /** Reasons grouped and counted, most-frequent first (ties → reason text ascending). */
    byReason: Array<{ reason: string; count: number }>;
  };
  reassignments: {
    /**
     * Total "reassigned" events found in the raw event history (best-effort:
     * counts every reassigned event seen, including ones a stricter fold
     * would treat as illegal/dropped — acceptable for a management summary
     * count, since it is a directional signal, not an audit reconciliation).
     * Zero (not null) when `events` was not supplied.
     */
    total: number;
  };
};

function groupProgress(
  entries: DistributionCurrentData["entries"],
  keyOf: (e: DistributionCurrentData["entries"][number]) => string,
  nameOf: (u: string) => string,
): ManagementBucket[] {
  const buckets = new Map<string, Map<string, ManagementEmployeeProgress>>();
  for (const e of entries) {
    // A replaced image is no longer "in progress" for its original assignee —
    // exclude it from progress buckets (it's reported separately, in
    // `replacements`). Everything else (pending/completed/requested) counts.
    if (e.status === "replaced") continue;
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

export function computeManagementModel(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  events: DistributionEvent[] = [],
  replacementReasons: Record<string, string> = {},
): ManagementModel {
  const nameOf = (u: string): string => employeeDisplayNames[u] ?? u;

  const requested = data.entries.filter((e) => e.status === "replacement-requested").length;

  const replacementRecords: ManagementReplacementRecord[] = data.entries
    .filter((e) => e.status === "replaced")
    .map((e) => ({
      xrayImageId: e.xrayImageId,
      username: e.assignedTo,
      displayName: nameOf(e.assignedTo),
      portName: e.row.portName ?? "—",
      reason: replacementReasons[e.xrayImageId] ?? null,
      replacedById: e.replacedById,
      lastEventAt: e.lastEventAt,
    }))
    .sort((a, b) => a.lastEventAt.localeCompare(b.lastEventAt));

  const reasonCounts = new Map<string, number>();
  for (const r of replacementRecords) {
    if (!r.reason) continue;
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  }
  const byReason = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const reassignedTotal = events.filter((e) => e.eventType === "reassigned").length;

  return {
    monthFolderName,
    monthLabel: formatMonthLabel(monthFolderName),
    derivedAt: data.derivedAt,
    totals: {
      assigned: data.totalAssigned,
      completed: data.totalCompleted,
      pending: data.totalPending,
      replaced: data.totalReplaced,
      requested,
      completionRate: ratePct(data.totalCompleted, data.totalAssigned),
    },
    byStage: groupProgress(data.entries, (e) => e.row.stage ?? "غير محدد", nameOf),
    byPort: groupProgress(data.entries, (e) => e.row.portName ?? "غير محدد", nameOf),
    replacements: {
      total: replacementRecords.length,
      records: replacementRecords,
      byReason,
    },
    reassignments: {
      total: reassignedTotal,
    },
  };
}
