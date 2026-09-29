import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation, EmployeePortRestriction, StageAliasMappings } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { DistributionEntry, DistributionEvent } from "./distributionTypes";
import { getStageKey } from "../population/stageHelpers";
import { hamiltonApportionment } from "../sampling/apportionment";
import { buildAssignEvent, computeWorkingDaysForDeadline } from "./distributionLog";
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

/**
 * A3: an employee whose FINAL total (rows already owned + new events, after the
 * rebalance) is below their month target — the only way totals stay unequal.
 */
export type EmployeeTargetShortfall = { username: string; target: number; achieved: number };

export type BulkAssignmentResult = {
  events: DistributionEvent[];
  errors: string[];
  skipped: number;
  unmapped: UnmappedStageReport;
  /** Empty when no port restriction is active (the unrestricted path is unchanged). */
  targetShortfalls: EmployeeTargetShortfall[];
};

/** How many distinct stage labels a warning names before it stops listing them. */
const UNMAPPED_STAGE_SAMPLE_LIMIT = 5;

type EmpInfo = {
  username: string;
  quotaWeight: number; // raw weight for Hamilton
  hasCertLicense: boolean;
};

/** An allocation's raw Hamilton weight: percentage scaled up for apportionment accuracy, or the exact count as-is. */
function allocWeight(alloc: EmployeeStageAllocation): number {
  return Math.max(0, alloc.method === "percentage" ? Math.round(alloc.value * 100) : alloc.value);
}

/**
 * A3 (owner decision 2026-09-28): move NEW events from employees above their
 * month target to employees below it, where the receiver may take the row.
 * Deterministic: receivers by largest shortfall then username; events from the
 * last generated backwards, so the make-up comes from the latest stage the
 * receiver can work and earlier stages keep what the stage pass gave them.
 * Events carrying the donor's daily-quota stamp never move.
 */
function rebalanceTowardMonthTargets(params: {
  events: DistributionEvent[];
  targets: ReadonlyMap<string, number>;
  owned: ReadonlyMap<string, number>;
  canTake: (username: string, xrayImageId: string) => boolean;
}): DistributionEvent[] {
  const events = [...params.events];
  const totals = new Map<string, number>(params.owned);
  for (const event of events) totals.set(event.assignedTo, (totals.get(event.assignedTo) ?? 0) + 1);
  const shortfall = (username: string): number => (params.targets.get(username) ?? 0) - (totals.get(username) ?? 0);
  const receivers = [...params.targets.keys()]
    .filter((username) => shortfall(username) > 0)
    .sort((a, b) => shortfall(b) - shortfall(a) || a.localeCompare(b));
  for (const receiver of receivers) {
    for (let index = events.length - 1; index >= 0 && shortfall(receiver) > 0; index -= 1) {
      const event = events[index]!;
      const donor = event.assignedTo;
      if (donor === receiver || shortfall(donor) >= 0) continue;
      if (event.dailyQuota !== undefined || event.daysRemainingAtAssignment !== undefined) continue;
      if (!params.canTake(receiver, event.xrayImageId)) continue;
      events[index] = { ...event, assignedTo: receiver };
      totals.set(donor, (totals.get(donor) ?? 0) - 1);
      totals.set(receiver, (totals.get(receiver) ?? 0) + 1);
    }
  }
  return events;
}

/**
 * A3: live rows each employee already owns, per stage and in total. Owned =
 * `existingEntries` not `replaced`, located in a stage through the full
 * `rows` list (the assignable list no longer contains them). Rows in an
 * unmapped stage are ignored — no target exists for them.
 */
function collectOwnedRowsByStage(
  rows: PreparedPopulationRow[],
  existingEntries: DistributionEntry[] | undefined,
  stageMappings: StageAliasMappings | undefined
): { ownedByStage: Map<string, Map<string, number>>; ownedTotals: Map<string, number> } {
  const ownedByStage = new Map<string, Map<string, number>>();
  const ownedTotals = new Map<string, number>();
  if (!existingEntries || existingEntries.length === 0) return { ownedByStage, ownedTotals };
  const stageOfRow = new Map(rows.map((r) => [r.xrayImageId, getStageKey(r.stage, stageMappings)]));
  for (const entry of existingEntries) {
    if (entry.status === "replaced") continue;
    const stage = stageOfRow.get(entry.xrayImageId);
    if (!stage || stage === "unknown") continue;
    const perStage = ownedByStage.get(stage) ?? new Map<string, number>();
    perStage.set(entry.assignedTo, (perStage.get(entry.assignedTo) ?? 0) + 1);
    ownedByStage.set(stage, perStage);
    ownedTotals.set(entry.assignedTo, (ownedTotals.get(entry.assignedTo) ?? 0) + 1);
  }
  return { ownedByStage, ownedTotals };
}

/**
 * F10 (controller ruling 2026-09-28): the stage/port loop below stamps
 * `dailyQuota` on one event per employee per group (a stage, or a
 * stage-port pair once a restriction is active) — see `assignWithinGroup`
 * step 4. That stamp is computed from the group's own employee counts at
 * generation time. `rebalanceTowardMonthTargets` never moves a stamped
 * event itself (see above), but it can move an employee's OTHER events
 * into or out of that same group, which makes the group count the stamp
 * was computed from stale. This restamps every already-stamped event with
 * its owner's POST-rebalance count within that same group — nothing else
 * changes. `eventGroupKey` (eventId → group key) is recorded once per
 * event at generation time, before any rebalance can touch assignment.
 *
 * A receiver can end up owning rows in a group it never had its own
 * `assignWithinGroup` call for (e.g. a cross-stage make-up moves a row into
 * a stage/port pair the receiver wasn't allocated in at generation time).
 * Those moved-in rows are always unstamped (see `rebalanceTowardMonthTargets`
 * above — a stamped event never moves), so this function has nothing to
 * restamp for the receiver in that group: no event there carries `dailyQuota`
 * either before or after. `dailyQuota` is a per-group pacing hint, not an
 * authoritative per-employee total (the event/entry counts are that), so a
 * consumer reading it must already tolerate an employee holding rows in a
 * group with no dailyQuota-carrying event at all — this is not a regression
 * A3 introduces, just a case F10 does not need to (and does not) paper over.
 */
function restampDailyQuota(
  events: DistributionEvent[],
  eventGroupKey: ReadonlyMap<string, string>
): DistributionEvent[] {
  const countByEmployeeGroup = new Map<string, number>();
  for (const event of events) {
    const groupKey = eventGroupKey.get(event.eventId);
    if (groupKey === undefined) continue;
    const key = `${event.assignedTo}\u0000${groupKey}`;
    countByEmployeeGroup.set(key, (countByEmployeeGroup.get(key) ?? 0) + 1);
  }
  return events.map((event) => {
    if (event.dailyQuota === undefined) return event;
    const groupKey = eventGroupKey.get(event.eventId);
    if (groupKey === undefined) return event;
    const totalForEmployee = countByEmployeeGroup.get(`${event.assignedTo}\u0000${groupKey}`) ?? 0;
    const daysRemaining = event.daysRemainingAtAssignment;
    const dailyQuota = (daysRemaining != null && daysRemaining > 0)
      ? Math.ceil(totalForEmployee / daysRemaining)
      : undefined;
    return { ...event, dailyQuota };
  });
}

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
    return {
      username: alloc.username,
      quotaWeight: allocWeight(alloc),
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
    ? computeWorkingDaysForDeadline(month, year, now)
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

  // A3: month target per employee (sum of their per-stage targets) and who is
  // allocated in each stage — filled by the restricted branch below only.
  const monthTargets = new Map<string, number>();
  const stageUsernames = new Map<string, Set<string>>();
  // A3: live rows each employee already owns (per stage and overall) —
  // restricted mode only, so an unrestricted run stays byte-identical.
  const { ownedByStage, ownedTotals } = anyPortRestricted
    ? collectOwnedRowsByStage(rows, existingEntries, stageMappings)
    : { ownedByStage: new Map<string, Map<string, number>>(), ownedTotals: new Map<string, number>() };
  // A3/F10: eventId → group key ("stageKey" or "stageKey - portKey"), recorded
  // at generation time for every event so a post-rebalance restamp can find
  // each stamped event's original group even after ownership moves.
  const eventGroupKey = new Map<string, string>();

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
      for (const event of group.events) eventGroupKey.set(event.eventId, stageKey);
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

    // Each employee's overall target for the WHOLE stage, from their
    // configured percentage/exact allocation applied to every row in the
    // stage — not just the rows of one port. Re-apportioning each port
    // independently at 100% of its eligible employees (the old behavior)
    // let a restricted employee's excluded share simply vanish from the
    // total instead of being picked up elsewhere, and let employees who
    // happened to share fewer ports with others end up over-quota — e.g. a
    // restricted employee at 25% could land at 3x their target while an
    // unrestricted colleague fell to a fraction of theirs. Tracking a
    // shared remaining-need pool across ports keeps every employee's final
    // total anchored to their configured percentage regardless of how the
    // stage happens to be split into ports. A3: these per-stage targets are
    // also summed into `monthTargets` for the cross-stage rebalance after
    // the loop.
    // A3: the target is over unassigned + already-owned rows of the stage, so
    // a re-run aims at the same equal totals a first run would have.
    const ownedInStage = ownedByStage.get(stageKey) ?? new Map<string, number>();
    const ownedInStageCount = [...ownedInStage.values()].reduce((sum, n) => sum + n, 0);
    const stageTarget = new Map(
      hamiltonApportionment(
        stageAllocs.map((a) => ({ key: a.username, size: allocWeight(a) })),
        stageRows.length + ownedInStageCount
      ).map((q) => [q.key, q.allocated])
    );
    for (const [username, target] of stageTarget) {
      monthTargets.set(username, (monthTargets.get(username) ?? 0) + target);
    }
    stageUsernames.set(stageKey, new Set(stageAllocs.map((a) => a.username)));
    const remainingNeed = new Map(
      [...stageTarget].map(([username, target]) => [username, Math.max(0, target - (ownedInStage.get(username) ?? 0))])
    );

    // Ports are visited most-constrained-first (fewest eligible employees),
    // purely to fix processing order deterministically — the fairness work
    // itself is done by the forced/elastic split below, not by this order.
    const portGroups = [...rowsByPort.entries()]
      .map(([portKey, portRows]) => ({
        portKey,
        portRows,
        eligibleAllocs: stageAllocs.filter((a) => isPortEligible(a.username, portKey, portRestrictions)),
      }))
      .sort((a, b) =>
        a.eligibleAllocs.length !== b.eligibleAllocs.length
          ? a.eligibleAllocs.length - b.eligibleAllocs.length
          : a.portKey < b.portKey ? -1 : a.portKey > b.portKey ? 1 : 0
      );

    for (let i = 0; i < portGroups.length; i++) {
      const { portKey, portRows, eligibleAllocs } = portGroups[i]!;
      if (eligibleAllocs.length === 0) {
        errors.push(
          `لا يوجد موظف مؤهل لاستلام منفذ "${portKey}" في المستوى ${stageKey}. ` +
          `سيبقى ${portRows.length} سجل غير معين.`
        );
        continue;
      }

      // How many rows each eligible employee could still draw from PORTS
      // NOT YET VISITED (their remaining alternatives to this one). An
      // employee whose remaining need exceeds that alternative capacity is
      // "forced" here — this port is their only remaining chance at some
      // or all of their target, so they must be guaranteed that amount now
      // rather than sharing this port equally/proportionally with employees
      // who have plenty of capacity left elsewhere. Without this, weighting
      // purely by remaining need (as before) can starve an employee who has
      // few reachable ports: e.g. a big port shared with colleagues who have
      // other options, plus one small port that is this employee's ONLY
      // option, splits that small port "fairly" by need and leaves the
      // employee well under target while the others make it up easily on
      // the big port.
      const laterPorts = portGroups.slice(i + 1);
      const forced = new Map<string, number>();
      for (const alloc of eligibleAllocs) {
        const need = remainingNeed.get(alloc.username) ?? 0;
        const otherCapacity = laterPorts.reduce(
          (sum, later) => sum + (isPortEligible(alloc.username, later.portKey, portRestrictions) ? later.portRows.length : 0),
          0
        );
        forced.set(alloc.username, Math.max(0, need - otherCapacity));
      }
      const totalForced = [...forced.values()].reduce((a, b) => a + b, 0);

      let portAllocs: EmployeeStageAllocation[];
      if (totalForced >= portRows.length) {
        // Not even everyone's forced (nowhere-else-to-get-it) need fits in
        // this port — scale down proportionally to forced urgency.
        portAllocs = eligibleAllocs.map((a) => ({
          ...a,
          method: "exact",
          value: forced.get(a.username) ?? 0,
        }));
      } else {
        // Guarantee each employee's forced amount, then apportion the rest
        // of the port by whatever need is left over (need beyond forced).
        const elasticRows = portRows.length - totalForced;
        const elasticAlloc = hamiltonApportionment(
          eligibleAllocs.map((a) => ({
            key: a.username,
            size: Math.max(0, (remainingNeed.get(a.username) ?? 0) - (forced.get(a.username) ?? 0)),
          })),
          elasticRows
        );
        const elasticMap = new Map(elasticAlloc.map((q) => [q.key, q.allocated]));
        portAllocs = eligibleAllocs.map((a) => ({
          ...a,
          method: "exact",
          value: (forced.get(a.username) ?? 0) + (elasticMap.get(a.username) ?? 0),
        }));
      }

      const group = assignWithinGroup({
        rows: portRows,
        stageAllocs: portAllocs,
        assignableEmployees,
        contextLabel: `${stageKey} - ${portKey}`,
        operatorUsername,
        month,
        year,
      });
      events.push(...group.events);
      errors.push(...group.errors);

      for (const event of group.events) {
        remainingNeed.set(event.assignedTo, Math.max(0, (remainingNeed.get(event.assignedTo) ?? 0) - 1));
        eventGroupKey.set(event.eventId, `${stageKey} - ${portKey}`);
      }
    }
  }

  if (!anyPortRestricted) return { events, errors, skipped, unmapped, targetShortfalls: [] };

  // A3: bring every employee to their equal month target by moving NEW
  // events from whoever is above it to whoever is below, restricted to rows
  // the receiver may actually take (allocated in that stage, port-eligible,
  // and licensed for a CertScan row).
  const rowById = new Map(assignableRows.map((r) => [r.xrayImageId, r]));
  const licensed = new Set(assignableEmployees.filter((e) => e.hasCertScanLicense).map((e) => e.username));
  const canTake = (username: string, xrayImageId: string): boolean => {
    const target = rowById.get(xrayImageId);
    if (!target) return false;
    if (!stageUsernames.get(getStageKey(target.stage, stageMappings))?.has(username)) return false;
    if (!isPortEligible(username, normalizePortName(target.portName), portRestrictions)) return false;
    return target.certScanStatus !== "Certscan" || licensed.has(username);
  };
  const balanced = rebalanceTowardMonthTargets({ events, targets: monthTargets, owned: ownedTotals, canTake });
  const restamped = restampDailyQuota(balanced, eventGroupKey);
  // Measured on the OUTCOME, not on per-employee capacity: that also catches
  // an employee who already owned more than their target, restricted employees
  // sharing one small port, and stamped events the rebalance cannot move.
  const finalTotals = new Map<string, number>(ownedTotals);
  for (const event of restamped) finalTotals.set(event.assignedTo, (finalTotals.get(event.assignedTo) ?? 0) + 1);
  const targetShortfalls: EmployeeTargetShortfall[] = [];
  for (const username of [...monthTargets.keys()].sort((a, c) => a.localeCompare(c))) {
    const target = monthTargets.get(username) ?? 0;
    const achieved = finalTotals.get(username) ?? 0;
    if (achieved < target) targetShortfalls.push({ username, target, achieved });
  }
  return { events: restamped, errors, skipped, unmapped, targetShortfalls };
}
