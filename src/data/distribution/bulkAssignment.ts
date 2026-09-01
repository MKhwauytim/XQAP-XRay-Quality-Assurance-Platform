import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation, EmployeePortRestriction, StageAliasMappings } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { DistributionEntry, DistributionEvent } from "./distributionTypes";
import { getStageKey } from "../population/stageHelpers";
import { hamiltonApportionment } from "../sampling/apportionment";
import { buildAssignEvent, computeDaysRemainingForDeadline } from "./distributionLog";
import { hasAnyPortRestriction, isPortEligible, normalizePortName } from "./portEligibility";

export function isAssignableSampleRole(user: ManagedLoginUser): boolean {
  return user.role === "employee" || user.role === "supervisor";
}

/**
 * Resolves `username` against the live managed-user roster and requires it to
 * be an active, sample-assignable account (employee/supervisor). Used at
 * assignment-handler time (not just at render time, where the picker's option
 * list already excludes anything else) so a stale dropdown snapshot, a
 * hand-crafted call, or a race with a user being deactivated mid-session can
 * never durably assign a sample to an account that cannot log in and work it
 * -- the exact failure mode audit finding 6 documents (adhoc-import's
 * `useMemo(...,[])` roster and PhaseFourDistribution's manual-assign dropdown).
 */
export function findAssignableEmployee(
  username: string,
  employees: ManagedLoginUser[]
): ManagedLoginUser | null {
  const user = employees.find((e) => e.username === username);
  if (!user || !user.isActive || !isAssignableSampleRole(user)) return null;
  return user;
}

/**
 * Same re-validation as `findAssignableEmployee`, plus the port-restriction
 * check: `username` must be eligible for `portName` per the live
 * `portRestrictions`. Used at manual assign/reassign time so a restricted
 * employee can never be durably assigned a row outside their allowed ports,
 * even from a stale dropdown or a hand-crafted call.
 */
export function findAssignableEmployeeForPort(
  username: string,
  employees: ManagedLoginUser[],
  portName: string,
  portRestrictions: EmployeePortRestriction[]
): ManagedLoginUser | null {
  const user = findAssignableEmployee(username, employees);
  if (!user) return null;
  if (!isPortEligible(username, portName, portRestrictions)) return null;
  return user;
}

/**
 * Rows the stage loop below can never reach (T-14).
 *
 * `calculateBulkAssignment` walks the four KNOWN stage keys. A row whose stage
 * label no longer resolves through the workspace-global stage mappings answers
 * `"unknown"` from `getStageKey` and therefore matches none of them — it is
 * simply never apportioned, never assigned, and (before this) never mentioned.
 * The operator saw "توزيع ناجح" and believed the month was fully assigned while
 * those rows sat unowned for the rest of the cycle.
 *
 * This is REPORTING ONLY. Which rows get assigned is unchanged: the loop still
 * covers exactly first/second/third/fourth, and no event is added or removed
 * because of anything here.
 */
export type UnmappedStageReport = {
  /** Assignable rows whose stage resolved to "unknown". */
  count: number;
  /** The distinct raw stage labels involved, for the operator's warning text. */
  stages: string[];
};

export type BulkAssignmentResult = {
  events: DistributionEvent[];
  errors: string[];
  skipped: number;
  unmapped: UnmappedStageReport;
};

/** How many distinct stage labels a warning names before it stops listing them. */
const UNMAPPED_STAGE_SAMPLE_LIMIT = 5;

type EmpInfo = {
  username: string;
  quotaWeight: number; // raw weight for Hamilton
  hasCertLicense: boolean;
};

/**
 * Smart CertScan-first distribution over ONE group of rows (a whole stage, or
 * — once a port restriction is active — one port's rows within a stage):
 *
 * 1. Apportion total quota (cert+normal) among the group's active employees.
 * 2. For CertScan-licensed employees:
 *    - If total cert rows ≤ sum of their quotas → fill their quota with cert first, rest normal.
 *    - If total cert rows > sum of their quotas → distribute ALL cert equally among licensed
 *      employees (ignoring percentage), replacing normal slots they would have received.
 * 3. Non-licensed employees only receive normal rows.
 * 4. Any leftover rows (due to rounding) are distributed proportionally.
 *
 * A group with CertScan rows but no licensed employee abandons the WHOLE
 * group (cert AND normal rows) rather than assigning the normal rows alone —
 * this is pre-existing behavior, preserved verbatim by this extraction.
 */
function assignWithinGroup(params: {
  rows: PreparedPopulationRow[];
  stageAllocs: EmployeeStageAllocation[];
  assignableEmployees: ManagedLoginUser[];
  /** Named in error messages — a stage key, or "{stageKey} - {portName}". */
  contextLabel: string;
  operatorUsername: string;
  month?: number;
  year?: number;
}): { events: DistributionEvent[]; errors: string[] } {
  const { rows: groupRows, stageAllocs, assignableEmployees, contextLabel, operatorUsername, month, year } = params;
  const events: DistributionEvent[] = [];
  const errors: string[] = [];

  const certRows = groupRows.filter((r) => r.certScanStatus === "Certscan");
  const normalRows = groupRows.filter((r) => r.certScanStatus !== "Certscan");
  const totalRows = groupRows.length;

  const empInfos: EmpInfo[] = stageAllocs.map((alloc) => {
    const emp = assignableEmployees.find((e) => e.username === alloc.username);
    const weight =
      alloc.method === "percentage"
        ? Math.round(alloc.value * 100) // scale up for Hamilton accuracy
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
        `خطأ: توجد سجلات CertScan ولا يوجد موظف مرخص CertScan نشط في المستوى ${contextLabel}. ` +
        `لا يمكن توزيع ${certRows.length} سجل CertScan.`
      );
      return { events, errors };
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
      events.push(buildAssignEvent({
        xrayImageId: certRows[certIdx].xrayImageId,
        assignedTo: emp.username,
        eventBy: operatorUsername,
        notes: "تعيين تلقائي (CertScan)",
        dailyQuota: i === 0 ? dailyQuota : undefined,
        daysRemainingAtAssignment: i === 0 && daysRemaining != null ? daysRemaining : undefined,
        eventAt: now.toISOString(),
      }));
    }

    for (let i = 0; i < normCount && normIdx < normalRows.length; i++, normIdx++) {
      events.push(buildAssignEvent({
        xrayImageId: normalRows[normIdx].xrayImageId,
        assignedTo: emp.username,
        eventBy: operatorUsername,
        notes: "تعيين تلقائي",
        // Only attach quota to first normal event if no cert events carried it
        dailyQuota: (certCount === 0 && i === 0) ? dailyQuota : undefined,
        daysRemainingAtAssignment: (certCount === 0 && i === 0 && daysRemaining != null) ? daysRemaining : undefined,
        eventAt: now.toISOString(),
      }));
    }
  }

  return { events, errors };
}

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
  /**
   * Per-employee port restrictions. When NO entry has `restricted: true`,
   * every stage is assigned exactly as before this feature existed (the
   * common/default case). Once any employee is restricted, each stage's rows
   * are additionally partitioned by port, and an employee is only considered
   * for a port group when eligible for that port (see `isPortEligible`).
   */
  portRestrictions?: EmployeePortRestriction[];
}): BulkAssignmentResult {
  const { rows, allocations, employees, operatorUsername, stageMappings, month, year, existingEntries } = params;
  const portRestrictions = params.portRestrictions ?? [];
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

  // Counted BEFORE the stage loop, over exactly the rows that loop will walk,
  // so the tally cannot drift from what actually happens below.
  const unmappedStages = new Set<string>();
  let unmappedCount = 0;
  for (const row of assignableRows) {
    if (getStageKey(row.stage, stageMappings) !== "unknown") continue;
    unmappedCount += 1;
    // A blank stage is counted but contributes no name to the warning — there
    // is nothing for the operator to look up in the mappings table.
    const label = String(row.stage ?? "").trim();
    if (label !== "") unmappedStages.add(label);
  }
  const unmapped: UnmappedStageReport = {
    count: unmappedCount,
    stages: [...unmappedStages].slice(0, UNMAPPED_STAGE_SAMPLE_LIMIT),
  };

  const assignableEmployees = employees.filter(isAssignableSampleRole);
  const assignableUsernames = new Set(assignableEmployees.map((employee) => employee.username));

  const stageKeys: Array<"first" | "second" | "third" | "fourth"> = [
    "first", "second", "third", "fourth"
  ];

  const anyPortRestricted = hasAnyPortRestriction(portRestrictions);

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

    // Common/default case — behavior is byte-for-byte what this function did
    // before port restrictions existed: one group covering the whole stage.
    if (!anyPortRestricted) {
      const group = assignWithinGroup({
        rows: stageRows,
        stageAllocs,
        assignableEmployees,
        contextLabel: stageKey,
        operatorUsername,
        month,
        year,
      });
      events.push(...group.events);
      errors.push(...group.errors);
      continue;
    }

    // A restriction is active somewhere in the workspace: partition this
    // stage's rows by port, and only consider employees eligible for each
    // port group. A port with nobody eligible reports an error and its rows
    // stay unassigned (same shape as the no-licensed-employee CertScan error
    // below, just scoped to one port instead of the whole stage).
    const rowsByPort = new Map<string, PreparedPopulationRow[]>();
    for (const row of stageRows) {
      const portKey = normalizePortName(row.portName);
      const group = rowsByPort.get(portKey);
      if (group) group.push(row);
      else rowsByPort.set(portKey, [row]);
    }

    for (const [portKey, portRows] of rowsByPort) {
      const eligibleAllocs = stageAllocs.filter((a) => isPortEligible(a.username, portKey, portRestrictions));
      if (eligibleAllocs.length === 0) {
        errors.push(
          `لا يوجد موظف مؤهل لاستلام منفذ "${portKey}" في المستوى ${stageKey}. ` +
          `سيبقى ${portRows.length} سجل غير معين.`
        );
        continue;
      }

      const group = assignWithinGroup({
        rows: portRows,
        stageAllocs: eligibleAllocs,
        assignableEmployees,
        contextLabel: `${stageKey} - ${portKey}`,
        operatorUsername,
        month,
        year,
      });
      events.push(...group.events);
      errors.push(...group.errors);
    }
  }

  return { events, errors, skipped, unmapped };
}
