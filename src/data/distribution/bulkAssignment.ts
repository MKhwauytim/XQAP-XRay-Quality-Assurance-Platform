import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation, StageAliasMappings } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { DistributionEntry, DistributionEvent } from "./distributionTypes";
import { getStageKey } from "../population/stageHelpers";
import { hamiltonApportionment } from "../sampling/apportionment";
import { createEventId, computeDaysRemainingForDeadline } from "./distributionLog";

export function isAssignableSampleRole(user: ManagedLoginUser): boolean {
  return user.role === "employee" || user.role === "supervisor";
}

/**
 * Smart CertScan-first distribution:
 *
 * 1. Apportion total quota (cert+normal) among active employees.
 * 2. For CertScan-licensed employees:
 *    - If total cert rows ≤ sum of their quotas → fill their quota with cert first, rest normal.
 *    - If total cert rows > sum of their quotas → distribute ALL cert equally among licensed
 *      employees (ignoring percentage), replacing normal slots they would have received.
 * 3. Non-licensed employees only receive normal rows.
 * 4. Any leftover rows (due to rounding) are distributed proportionally.
 */
export function calculateBulkAssignment(params: {
  rows: PreparedPopulationRow[];
  allocations: EmployeeStageAllocation[];
  employees: ManagedLoginUser[];
  operatorUsername: string;
  stageMappings?: StageAliasMappings;
  /** Month number (1–12) of the sample month — used to compute daily quota deadline. */
  month?: number;
  /** Full year (e.g., 2025) of the sample month. */
  year?: number;
  /**
   * Live distribution entries already present for this month. Any row that
   * already has an entry is skipped so re-running bulk assignment is idempotent
   * (never emits a second `assigned` event for an already-owned/completed row).
   */
  existingEntries?: DistributionEntry[];
}): { events: DistributionEvent[]; errors: string[]; skipped: number } {
  const { rows, allocations, employees, operatorUsername, stageMappings, month, year, existingEntries } = params;
  const events: DistributionEvent[] = [];
  const errors: string[] = [];

  // Idempotency guard: exclude rows that already have a live distribution entry
  // (assigned/pending, completed, replacement-requested, replaced). The
  // assignable set is rows with no entry at all — re-running only distributes
  // the still-unassigned remainder instead of duplicating every assignment.
  const ownedIds = new Set((existingEntries ?? []).map((e) => e.xrayImageId));
  const rowsBeforeFilter = rows.length;
  const assignableRows = ownedIds.size > 0
    ? rows.filter((r) => !ownedIds.has(r.xrayImageId))
    : rows;
  const skipped = rowsBeforeFilter - assignableRows.length;

  const assignableEmployees = employees.filter(isAssignableSampleRole);
  const assignableUsernames = new Set(assignableEmployees.map((employee) => employee.username));

  const stageKeys: Array<"first" | "second" | "third" | "fourth"> = [
    "first", "second", "third", "fourth"
  ];

  for (const stageKey of stageKeys) {
    const stageRows = assignableRows.filter((r) => getStageKey(r.stage, stageMappings) === stageKey);
    if (stageRows.length === 0) continue;

    const stageAllocs = allocations.filter(
      (a) => a.stageKey === stageKey && a.isActive && assignableUsernames.has(a.username)
    );
    if (stageAllocs.length === 0) {
      errors.push(`لم يتم تحديد موظفين نشطين في المستوى ${stageKey}.`);
      continue;
    }

    const certRows    = stageRows.filter((r) => r.certScanStatus === "Certscan");
    const normalRows  = stageRows.filter((r) => r.certScanStatus !== "Certscan");
    const totalRows   = stageRows.length;

    // Build per-employee info with quota weight
    type EmpInfo = {
      username: string;
      quotaWeight: number;    // raw weight for Hamilton
      hasCertLicense: boolean;
    };

    const empInfos: EmpInfo[] = stageAllocs.map((alloc) => {
      const emp = assignableEmployees.find((e) => e.username === alloc.username);
      const weight =
        alloc.method === "percentage"
          ? Math.round(alloc.value * 100)   // scale up for Hamilton accuracy
          : alloc.value;
      return {
        username: alloc.username,
        quotaWeight: Math.max(0, weight),
        hasCertLicense: emp?.hasCertScanLicense ?? false
      };
    });

    // ── Step 1: Total quota apportionment ─────────────────────────────
    const totalQuotas = hamiltonApportionment(
      empInfos.map((e) => ({ key: e.username, size: e.quotaWeight })),
      totalRows
    );
    const quotaMap = new Map(totalQuotas.map((q) => [q.key, q.allocated]));

    const licensedEmps     = empInfos.filter((e) => e.hasCertLicense);
    const totalLicensedQuo = licensedEmps.reduce(
      (sum, e) => sum + (quotaMap.get(e.username) ?? 0), 0
    );

    // ── Step 2: CertScan distribution ────────────────────────────────
    const certAssignMap = new Map<string, number>();   // username → cert rows count

    if (certRows.length > 0) {
      if (licensedEmps.length === 0) {
        errors.push(
          `خطأ: توجد سجلات CertScan ولا يوجد موظف مرخص CertScan نشط في المستوى ${stageKey}. ` +
          `لا يمكن توزيع ${certRows.length} سجل CertScan.`
        );
        continue;
      }

      if (certRows.length <= totalLicensedQuo) {
        // Case A: cert rows fit within licensed employees' quota
        // Distribute proportionally to licensed employees' quotas
        const certAlloc = hamiltonApportionment(
          licensedEmps.map((e) => ({ key: e.username, size: quotaMap.get(e.username) ?? 0 })),
          certRows.length
        );
        for (const a of certAlloc) certAssignMap.set(a.key, a.allocated);
      } else {
        // Case B: more cert rows than total licensed quota
        // Distribute ALL cert equally among licensed employees (ignore %)
        const certAlloc = hamiltonApportionment(
          licensedEmps.map((e) => ({ key: e.username, size: 1 })), // equal weight
          certRows.length
        );
        for (const a of certAlloc) certAssignMap.set(a.key, a.allocated);
      }
    }

    // ── Step 3: Normal rows distribution ─────────────────────────────
    // Each employee's normal need = quota − certAssigned (min 0)
    const normalNeedMap = new Map<string, number>();
    for (const emp of empInfos) {
      const quota   = quotaMap.get(emp.username) ?? 0;
      const certGot = certAssignMap.get(emp.username) ?? 0;
      normalNeedMap.set(emp.username, Math.max(0, quota - certGot));
    }

    const totalNormalNeed = [...normalNeedMap.values()].reduce((a, b) => a + b, 0);
    const normalAssignMap = new Map<string, number>();

    if (normalRows.length > 0) {
      const toAssign = Math.min(normalRows.length, totalNormalNeed);

      if (toAssign > 0) {
        const normalAlloc = hamiltonApportionment(
          empInfos.map((e) => ({ key: e.username, size: normalNeedMap.get(e.username) ?? 0 })),
          toAssign
        );
        for (const a of normalAlloc) normalAssignMap.set(a.key, a.allocated);
      }

      // If there are leftover normal rows beyond expressed needs, distribute proportionally
      const assignedNormal = [...normalAssignMap.values()].reduce((a, b) => a + b, 0);
      const leftover = normalRows.length - assignedNormal;
      if (leftover > 0) {
        const leftoverAlloc = hamiltonApportionment(
          empInfos.map((e) => ({ key: e.username, size: Math.max(1, e.quotaWeight) })),
          leftover
        );
        for (const a of leftoverAlloc) {
          normalAssignMap.set(a.key, (normalAssignMap.get(a.key) ?? 0) + a.allocated);
        }
      }
    }

    // ── Step 4: Generate events ───────────────────────────────────────
    let certIdx = 0;
    let normIdx = 0;
    const now = new Date();
    const daysRemaining = (month != null && year != null)
      ? computeDaysRemainingForDeadline(month, year, now)
      : null;

    for (const emp of empInfos) {
      const certCount = certAssignMap.get(emp.username) ?? 0;
      const normCount = normalAssignMap.get(emp.username) ?? 0;
      const totalForEmployee = certCount + normCount;
      const dailyQuota = (daysRemaining != null && daysRemaining > 0)
        ? Math.ceil(totalForEmployee / daysRemaining)
        : undefined;

      for (let i = 0; i < certCount && certIdx < certRows.length; i++, certIdx++) {
        events.push({
          eventId: createEventId(),
          eventType: "assigned",
          xrayImageId: certRows[certIdx].xrayImageId,
          assignedTo: emp.username,
          eventAt: now.toISOString(),
          eventBy: operatorUsername,
          notes: "تعيين تلقائي (CertScan)",
          dailyQuota: i === 0 ? dailyQuota : undefined,
          daysRemainingAtAssignment: i === 0 && daysRemaining != null ? daysRemaining : undefined,
        });
      }

      for (let i = 0; i < normCount && normIdx < normalRows.length; i++, normIdx++) {
        events.push({
          eventId: createEventId(),
          eventType: "assigned",
          xrayImageId: normalRows[normIdx].xrayImageId,
          assignedTo: emp.username,
          eventAt: now.toISOString(),
          eventBy: operatorUsername,
          notes: "تعيين تلقائي",
          // Only attach quota to first normal event if no cert events carried it
          dailyQuota: (certCount === 0 && i === 0) ? dailyQuota : undefined,
          daysRemainingAtAssignment: (certCount === 0 && i === 0 && daysRemaining != null) ? daysRemaining : undefined,
        });
      }
    }
  }

  return { events, errors, skipped };
}
