import { getManagedLoginUsers, subscribeToUserManagementChanges } from "../../../../../auth/userManagement";
import { AlertTriangle, CheckCircle2, ChevronDown, FilePen, Search, Settings2, XCircle } from "lucide-react";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { DistributionCurrentData, DistributionEvent } from "../../../../../data/distribution/distributionTypes";
import type { PopulationConfig, EmployeeStageAllocation } from "../../../../../data/population/populationConfig";
import DistributionRow from "./DistributionRow";
import { useState, useMemo, useCallback, useEffect } from "react";
import { getStageKey, formatNumber } from "./helpers";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { calculateBulkAssignment, isAssignableSampleRole } from "../../../../../data/distribution/bulkAssignment";
import "./PhaseFourDistribution.css";
import { hamiltonApportionment } from "../../../../../data/sampling/apportionment";

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type PhaseFourDistributionProps = {
  sampleDrawResult: SampleMasterData | null;
  distributionCurrent: DistributionCurrentData | null;
  distributionMessage: SaveMessage;
  isDistributing: boolean;
  distributionProgress: { percent: number; message: string } | null;
  canConfigure: boolean;
  canDistribute: boolean;
  /**
   * B13: gates the bulk-assignment action specifically. Distinct from canDistribute
   * (per-row assign/reassign/complete/replace) because the two features have
   * independent role defaults — e.g. shipped supervisor defaults grant bulk-assign
   * but not distribute-samples.
   */
  canBulkAssign: boolean;
  config: PopulationConfig;
  operatorUsername: string;
  saveMonth: number;
  saveYear: number;
  onConfigChange: (config: PopulationConfig) => void;
  onAssign: (xrayImageId: string, assignedTo: string) => Promise<void>;
  onReassign: (xrayImageId: string, reassignedTo: string) => Promise<void>;
  onMarkComplete: (xrayImageId: string) => Promise<void>;
  onRequestReplacement: (xrayImageId: string) => Promise<void>;
  onApplyBulkAssignment: (events: DistributionEvent[]) => Promise<void>;
};

const STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
type StageKey = (typeof STAGE_KEYS)[number];

const STAGE_LABELS: Record<StageKey, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع"
};

const STATUS_LABELS: Record<string, string> = {
  unassigned: "غير معين",
  pending: "قيد الانتظار",
  completed: "مكتمل",
  "replacement-requested": "طلب استبدال",
  replaced: "مستبدل"
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}

export default function PhaseFourDistribution({
  sampleDrawResult,
  distributionCurrent,
  distributionMessage,
  isDistributing,
  distributionProgress,
  canConfigure,
  canDistribute,
  canBulkAssign,
  config,
  operatorUsername,
  saveMonth,
  saveYear,
  onConfigChange,
  onAssign,
  onReassign,
  onMarkComplete,
  onRequestReplacement,
  onApplyBulkAssignment
}: PhaseFourDistributionProps) {
  // `5c`: the two panels are no longer mutually exclusive tab bodies — the bulk
  // panel is always in place and المراجعة اليدوية is an in-place disclosure below
  // it. `activeTab` survives as the single source of truth for the header pill
  // switch AND for whether that disclosure is open; it defaults to "bulk", so the
  // manual review starts collapsed. (`selectedStageTab` is gone: the per-stage
  // tabs collapsed into the employees × stages matrix.)
  const [activeTab, setActiveTab] = useState<"bulk" | "manual">("bulk");
  const [bulkError, setBulkError] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [manualStatusFilter, setManualStatusFilter] = useState("all");
  const [manualEmployeeFilter, setManualEmployeeFilter] = useState("all");

  const L = getLabels();

  // Audit finding 6: this was a mount-time-only snapshot (`useMemo(...,[])`), so a
  // user added/deactivated after this phase mounted never showed up (or never
  // disappeared) from the allocation matrix or the manual-assign dropdown.
  const computeAssignableEmployees = useCallback(
    () =>
      getManagedLoginUsers()
        .filter((u) => u.isActive && isAssignableSampleRole(u))
        .map((u) => ({
          username: u.username,
          displayName: u.displayName,
          hasCertScanLicense: u.hasCertScanLicense
        })),
    []
  );
  const [employees, setEmployees] = useState(computeAssignableEmployees);
  useEffect(
    () => subscribeToUserManagementChanges(() => setEmployees(computeAssignableEmployees())),
    [computeAssignableEmployees]
  );

  const sampleRows = useMemo(() => sampleDrawResult?.rows ?? [], [sampleDrawResult]);

  // One classification pass instead of four `.filter()` sweeps.
  //
  // Uses the same snapshot-first mappings as the bulk-assignment calls below,
  // and must keep doing so: these are the per-stage counts shown next to the
  // employee allocation inputs. Classifying them under live config while the
  // assignment classifies under the draw's snapshot would show the operator one
  // split and assign another the moment an admin edits the aliases mid-month.
  const stageSampleCounts = useMemo(() => {
    const buckets: Record<StageKey, typeof sampleRows> = { first: [], second: [], third: [], fourth: [] };
    const mappings = sampleDrawResult?.stageMappingsSnapshot ?? config.stageMappings;
    for (const row of sampleRows) {
      const stageKey = getStageKey(row.stage, mappings);
      if (stageKey !== "unknown") buckets[stageKey].push(row);
    }
    return buckets;
  }, [sampleRows, sampleDrawResult, config.stageMappings]);

  const activeAllocations = useMemo(() => {
    const list: EmployeeStageAllocation[] = [];
    for (const sKey of STAGE_KEYS) {
      // An UNCONFIGURED level splits evenly across its employees — four
      // employees get 25% each, three get 34/33/33. Previously every unsaved
      // share defaulted to 0, so a fresh workspace showed a level totalling 0%
      // and distributed nothing until an admin typed every share by hand; an
      // even split is what that admin was going to type anyway.
      //
      // Only a level NO ONE has configured is defaulted. The moment any
      // allocation is saved for a level, the unsaved employees there stay at 0
      // rather than having invented shares pushed under the admin's numbers —
      // silently inflating a level past 100% would be worse than showing a gap
      // the existing ok/warn total verdict already flags.
      //
      // Hamilton (the same helper the draw uses) hands out the 100 so the
      // shares always sum to exactly 100 instead of three 33s leaving 1% dark.
      const configuredHere = config.employeeAllocations.some(
        (a) => a.stageKey === sKey && a.value !== undefined
      );
      const eligible = employees.filter((emp) => {
        const existing = config.employeeAllocations.find(
          (a) => a.username === emp.username && a.stageKey === sKey
        );
        return existing?.isActive ?? true;
      });
      const evenShares = new Map<string, number>();
      if (!configuredHere && eligible.length > 0) {
        for (const seat of hamiltonApportionment(
          eligible.map((emp) => ({ key: emp.username, size: 1 })),
          100
        )) {
          evenShares.set(seat.key, seat.allocated);
        }
      }
      for (const emp of employees) {
        const existing = config.employeeAllocations.find(
          (a) => a.username === emp.username && a.stageKey === sKey
        );
        list.push({
          username: emp.username,
          stageKey: sKey,
          method: existing?.method || "percentage",
          value:
            existing?.value !== undefined
              ? existing.value
              : evenShares.get(emp.username) ?? 0,
          // Default to enabled at every level until an admin explicitly turns
          // an employee off for a given level.
          isActive: existing?.isActive ?? true,
          maxWorkload: existing?.maxWorkload
        });
      }
    }
    return list;
  }, [config.employeeAllocations, employees]);

  const allocationOf = useCallback(
    (username: string, stageKey: StageKey) =>
      activeAllocations.find((a) => a.username === username && a.stageKey === stageKey),
    [activeAllocations]
  );

  /**
   * `5c` dropped the per-stage "تفعيل بالمستوى" checkbox: the matrix expresses
   * exclusion as a zero share ("صفر يستبعد الخبير من ذلك المستوى"). So the two
   * flags are kept consistent here — a nonzero share re-activates the pairing,
   * zero deactivates it — instead of leaving an unreachable `isActive: false`
   * that the matrix could no longer clear. Nothing downstream changes: a zero
   * weight already apportioned to zero rows in calculateBulkAssignment.
   */
  const handleShareChange = (username: string, stageKey: StageKey, rawValue: number) => {
    const value = Math.max(0, rawValue);
    const updated = activeAllocations.map((alloc) =>
      alloc.username === username && alloc.stageKey === stageKey
        ? { ...alloc, value, isActive: value > 0 }
        : alloc
    );
    onConfigChange({ ...config, employeeAllocations: updated });
  };

  const previewData = useMemo(() => {
    if (!sampleDrawResult) return null;
    const { events, errors, skipped } = calculateBulkAssignment({
      rows: sampleRows,
      allocations: activeAllocations,
      employees: getManagedLoginUsers(),
      operatorUsername,
      // Bucket the sample's rows under the aliases the DRAW used, not whatever
      // live config now holds: a mid-month alias edit would otherwise move rows
      // into different stage buckets than the ones their per-stage employee
      // allocations were computed against. Falls back to live config for a
      // month drawn before the snapshot existed.
      stageMappings: sampleDrawResult.stageMappingsSnapshot ?? config.stageMappings,
      month: saveMonth,
      year: saveYear,
      existingEntries: distributionCurrent?.entries,
    });

    const summaryMap: Record<string, { cert: number; normal: number; total: number }> = {};
    for (const emp of employees) {
      summaryMap[emp.username] = { cert: 0, normal: 0, total: 0 };
    }

    // Index once: this was a linear `sampleRows.find` per event.
    const rowById = new Map<string, (typeof sampleRows)[number]>();
    for (const row of sampleRows) {
      if (!rowById.has(row.xrayImageId)) rowById.set(row.xrayImageId, row);
    }

    for (const evt of events) {
      const row = rowById.get(evt.xrayImageId);
      const data = summaryMap[evt.assignedTo];
      if (data && row) {
        data.total += 1;
        if (row.certScanStatus === "Certscan") data.cert += 1;
        else data.normal += 1;
      }
    }

    return { summaryMap, errors, skipped, newAssignments: events.length };
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings, saveMonth, saveYear, distributionCurrent]);
  // `sampleDrawResult` is already a dependency above, so the snapshot it carries
  // is covered without adding a second entry for the same object.

  const entryMap = useMemo(
    () => new Map((distributionCurrent?.entries ?? []).map((e) => [e.xrayImageId, e])),
    [distributionCurrent]
  );

  /** Per-status tallies over the sample itself, so the four segments always sum to the sample size. */
  const statusCounts = useMemo(() => {
    const counts = { unassigned: 0, pending: 0, completed: 0, replaced: 0, "replacement-requested": 0 };
    for (const row of sampleRows) {
      const status = entryMap.get(row.xrayImageId)?.status ?? "unassigned";
      if (status in counts) counts[status as keyof typeof counts] += 1;
      else counts.pending += 1;
    }
    return counts;
  }, [entryMap, sampleRows]);

  const totalRows = sampleRows.length;
  const unassignedCount = statusCounts.unassigned;
  const assignedCount = totalRows - unassignedCount;
  const replacedSegment = statusCounts.replaced + statusCounts["replacement-requested"];
  const assignedPercent = totalRows > 0 ? Math.round((assignedCount / totalRows) * 100) : 0;

  const assignedEmployeeOptions = useMemo(() => {
    const assigned = new Set(
      (distributionCurrent?.entries ?? [])
        .map((entry) => entry.assignedTo)
        .filter(Boolean)
    );
    return employees.filter((employee) => assigned.has(employee.username));
  }, [distributionCurrent, employees]);

  const filteredManualRows = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    return sampleRows.filter((row) => {
      const entry = entryMap.get(row.xrayImageId);
      const status = entry?.status ?? "unassigned";
      const assignedTo = entry?.assignedTo ?? "";
      if (q && !row.xrayImageId.toLowerCase().includes(q)) return false;
      if (manualStatusFilter !== "all" && status !== manualStatusFilter) return false;
      if (manualEmployeeFilter === "unassigned" && assignedTo) return false;
      if (
        manualEmployeeFilter !== "all" &&
        manualEmployeeFilter !== "unassigned" &&
        assignedTo !== manualEmployeeFilter
      ) return false;
      return true;
    });
  }, [entryMap, manualEmployeeFilter, manualSearch, manualStatusFilter, sampleRows]);

  if (!sampleDrawResult) {
    return (
      <section className="placeholder-phase">
        <h2>توزيع العينة</h2>
        <p>يجب إتمام سحب العينة في المرحلة السابقة أولاً.</p>
      </section>
    );
  }

  const hasManualFilter =
    manualSearch.trim() !== "" ||
    manualStatusFilter !== "all" ||
    manualEmployeeFilter !== "all";

  const clearManualFilters = () => {
    setManualSearch("");
    setManualStatusFilter("all");
    setManualEmployeeFilter("all");
  };

  const unlicensedWithShare = employees.filter(
    (emp) => !emp.hasCertScanLicense && STAGE_KEYS.some((sk) => (allocationOf(emp.username, sk)?.value ?? 0) > 0)
  );

  const stageShareTotals = STAGE_KEYS.map((sk) =>
    employees.reduce((sum, emp) => sum + (allocationOf(emp.username, sk)?.value ?? 0), 0)
  );
  // Fix (population, 2026-08-18): the matrix has one input per cell now, but a
  // legacy `exact`-method allocation (row COUNT, not a percentage) can still
  // sit in the same stage as `percentage` allocations -- summing the two and
  // comparing to 100 would misreport a correctly configured stage as short or
  // over, or coincidentally read "ok" by accident. A stage with any active
  // exact-method share renders the sum without an ok/warn verdict instead.
  const stageHasMixedMethod = STAGE_KEYS.map((sk) =>
    employees.some((emp) => {
      const alloc = allocationOf(emp.username, sk);
      return alloc?.method === "exact" && alloc.value > 0;
    })
  );

  const previewTotals = employees.reduce(
    (acc, emp) => {
      const counts = previewData?.summaryMap[emp.username] ?? { cert: 0, normal: 0, total: 0 };
      acc.normal += counts.normal;
      acc.cert += counts.cert;
      acc.total += counts.total;
      return acc;
    },
    { normal: 0, cert: 0, total: 0 }
  );

  const experts = employees.filter(
    (emp) => (previewData?.summaryMap[emp.username]?.total ?? 0) > 0
  ).length;

  const handleRunBulkAssignment = async () => {
    if (!canBulkAssign) {
      setBulkError("لا تملك صلاحية التوزيع الجماعي.");
      return;
    }
    setBulkError("");
    const { events, errors, skipped, unmapped } = calculateBulkAssignment({
      rows: sampleRows,
      allocations: activeAllocations,
      employees: getManagedLoginUsers(),
      operatorUsername,
      // Same snapshot preference as the preview above — the two must agree, or
      // the run would assign a different split than the operator was shown.
      stageMappings: sampleDrawResult?.stageMappingsSnapshot ?? config.stageMappings,
      month: saveMonth,
      year: saveYear,
      existingEntries: distributionCurrent?.entries,
    });

    const messages: string[] = [];
    if (errors.length > 0) {
      messages.push(`تحذير: ${errors.join(" | ")} — الصفوف المتأثرة ستبقى غير معينة ويمكن تعيينها يدوياً.`);
    }
    if (skipped > 0) {
      messages.push(`تم تخطي ${formatNumber(skipped)} صفاً معيناً مسبقاً (لن يُعاد تعيينها).`);
    }
    // T-14: rows whose stage no longer resolves are dropped by the stage loop.
    // Reporting only — the assignment itself is unchanged — but without it the
    // operator reads a successful run as "the month is fully assigned".
    if (unmapped.count > 0) {
      const template = unmapped.stages.length > 0
        ? L.p4_bulk_unmapped_warning_stages.replace("{stages}", unmapped.stages.join("، "))
        : L.p4_bulk_unmapped_warning;
      messages.push(template.replace("{count}", formatNumber(unmapped.count)));
    }
    if (messages.length > 0) {
      setBulkError(messages.join(" "));
    }

    if (events.length === 0) {
      // Not "everything was already assigned" when rows were dropped for an
      // unresolvable stage — that would overwrite the only notice of them.
      if (skipped > 0 && errors.length === 0 && unmapped.count === 0) {
        setBulkError(`جميع الصفوف (${formatNumber(skipped)}) معينة مسبقاً — لا يوجد ما يُوزّع.`);
      }
      return;
    }

    await onApplyBulkAssignment(events);
  };

  const manualOpen = activeTab === "manual";

  return (
    <section className="distribution-phase p4" aria-label="توزيع العينة">
      <div className="phase-panel-header compact">
        <div>
          <h2>المرحلة 4: توزيع العينة</h2>
          <p>
            توزيع العينة الكلية على الموظفين الفعالين. يدعم التوزيع الجماعي
            الذكي حسب كوتا كل مستوى والتوزيع اليدوي لكل صف.
          </p>
        </div>
        <div className="p4-pill-switch" role="group" aria-label={L.p4_manual_title}>
          <button
            type="button"
            className={`p4-pill${activeTab === "bulk" ? " active" : ""}`}
            aria-pressed={activeTab === "bulk"}
            onClick={() => setActiveTab("bulk")}
          >
            <Settings2 size={14} aria-hidden /> {L.p4_tab_bulk}
          </button>
          <button
            type="button"
            className={`p4-pill${manualOpen ? " active" : ""}`}
            aria-pressed={manualOpen}
            aria-expanded={manualOpen}
            aria-controls="p4-manual-section"
            onClick={() => setActiveTab(manualOpen ? "bulk" : "manual")}
          >
            <FilePen size={14} aria-hidden /> {L.p4_tab_manual}
          </button>
        </div>
      </div>

      {distributionMessage && (
        <div
          className={distributionMessage.type === "ok" ? "msg-success" : "msg-error"}
          role="status"
        >
          {distributionMessage.text}
        </div>
      )}

      <div className="p4-top-row">
        {/* حالة التوزيع */}
        <div className="p4-state-card" role="status">
          <span className="p4-state-title">{L.p4_state_title}</span>
          <div className="p4-state-headline">
            <strong className="p4-state-percent num">{formatNumber(assignedPercent)}%</strong>
            <span className="p4-state-sub num">
              {fillTemplate(L.p4_state_headline_sub, {
                assigned: formatNumber(assignedCount),
                total: formatNumber(totalRows),
              })}
            </span>
          </div>
          <div className="p4-state-bar" aria-hidden="true">
            <span className="seg completed" style={{ width: `${pct(statusCounts.completed, totalRows)}%` }} />
            <span className="seg pending" style={{ width: `${pct(statusCounts.pending, totalRows)}%` }} />
            <span className="seg replaced" style={{ width: `${pct(replacedSegment, totalRows)}%` }} />
            <span className="seg unassigned" style={{ width: `${pct(unassignedCount, totalRows)}%` }} />
          </div>
          <div className="p4-state-legend">
            <span><span className="dot completed" aria-hidden />{L.p4_state_completed}<strong className="num">{formatNumber(statusCounts.completed)}</strong></span>
            <span><span className="dot pending" aria-hidden />{L.p4_state_pending}<strong className="num">{formatNumber(statusCounts.pending)}</strong></span>
            <span><span className="dot replaced" aria-hidden />{L.p4_state_replaced}<strong className="num">{formatNumber(replacedSegment)}</strong></span>
            <span><span className="dot unassigned" aria-hidden />{L.p4_state_unassigned}<strong className="num">{formatNumber(unassignedCount)}</strong></span>
          </div>
        </div>

        {/* التوزيع الجماعي */}
        <div className="p4-bulk-card">
          <div className="p4-bulk-head">
            <div>
              <h3>{L.p4_bulk_title}</h3>
              <p className="p4-bulk-desc">
                {fillTemplate(L.p4_bulk_description, { count: formatNumber(unassignedCount) })}
              </p>
            </div>
            <button
              type="button"
              className="primary-action"
              onClick={handleRunBulkAssignment}
              disabled={!canBulkAssign || isDistributing}
              title={!canBulkAssign ? "لا تملك صلاحية التوزيع الجماعي، أو أن مساحة العمل للقراءة فقط." : undefined}
            >
              {isDistributing ? L.p4_bulk_applying : L.p4_bulk_apply}
            </button>
          </div>

          {previewData && (
            <div className="p4-info-strip">
              <CheckCircle2 size={14} aria-hidden />
              <span>
                {fillTemplate(L.p4_bulk_preview_info, {
                  count: formatNumber(previewData.newAssignments),
                  experts: formatNumber(experts),
                })}
              </span>
            </div>
          )}

          {unlicensedWithShare.length > 0 && (
            <div className="p4-alert warn" role="alert">
              <span className="p4-alert-tag">{L.p4_bulk_license_tag}</span>
              <span>
                {fillTemplate(L.p4_bulk_license_warning, {
                  names: unlicensedWithShare.map((e) => e.displayName).join("، "),
                })}
              </span>
            </div>
          )}

          {previewData && previewData.skipped > 0 && (
            <div className="p4-info-strip muted dist-skip-note" role="status">
              سيتم تخطي {formatNumber(previewData.skipped)} صفاً معيناً مسبقاً — التوزيع يشمل الصفوف غير المعينة فقط.
            </div>
          )}

          {previewData && previewData.errors.length > 0 && (
            <div className="p4-alert warn dist-err-block" role="alert">
              <AlertTriangle size={14} aria-hidden /> {previewData.errors.join(" | ")}
            </div>
          )}

          {bulkError && (
            <div className="msg-error" role="alert">
              {bulkError}
            </div>
          )}

          {isDistributing && distributionProgress && (
            <div className="distribution-save-progress">
              <div
                className="progress-bar-bg"
                role="progressbar"
                aria-label="تقدم حفظ التوزيع"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={distributionProgress.percent}
                aria-valuetext={distributionProgress.message}
              >
                <div className="progress-bar-fill" style={{ width: `${distributionProgress.percent}%` }} />
              </div>
              <div className="distribution-save-progress-label">
                <span>{distributionProgress.message}</span>
                <strong>{distributionProgress.percent.toLocaleString("ar-SA-u-nu-latn")}٪</strong>
              </div>
              <p>يمكن أن يستغرق الحفظ وقتاً أطول عند توزيع عدد كبير من العينات. لا تغلق الصفحة أو مجلد مساحة العمل.</p>
            </div>
          )}
        </div>
      </div>

      {/* حصص الخبراء عبر المستويات — one matrix replacing the per-stage tabs AND the
          separate preview table. Editing a cell recomputes عادية / CertScan / الجديد
          and the totals row through the same calculateBulkAssignment preview. */}
      <div className="p4-matrix-card">
        <div className="p4-matrix-head">
          <h3>{L.p4_matrix_title}</h3>
          <span className="p4-matrix-caption">{L.p4_matrix_caption}</span>
          <span className="p4-matrix-stage-counts">
            {STAGE_KEYS.map((sk) => (
              <span key={sk}>
                {STAGE_LABELS[sk]} <strong className="num">{formatNumber(stageSampleCounts[sk].length)}</strong>
              </span>
            ))}
          </span>
        </div>

        <div className="p4-matrix-table" role="table" aria-label={L.p4_matrix_title}>
          <div className="p4-matrix-row p4-matrix-header" role="row">
            <span role="columnheader">{L.p4_matrix_col_expert}</span>
            {STAGE_KEYS.map((sk) => (
              <span key={sk} role="columnheader" className="num">{STAGE_LABELS[sk]}</span>
            ))}
            <span role="columnheader">{L.p4_matrix_col_license}</span>
            <span role="columnheader" className="num">{L.p4_matrix_col_normal}</span>
            <span role="columnheader" className="num">{L.p4_matrix_col_certscan}</span>
            <span role="columnheader" className="num">{L.p4_matrix_col_new}</span>
          </div>

          {employees.map((emp) => {
            const counts = previewData?.summaryMap[emp.username] ?? { cert: 0, normal: 0, total: 0 };
            const excluded = STAGE_KEYS.every((sk) => {
              const alloc = allocationOf(emp.username, sk);
              return !alloc || !alloc.isActive || alloc.value <= 0;
            });
            return (
              <div
                key={emp.username}
                className={`p4-matrix-row${excluded ? " excluded" : ""}`}
                role="row"
              >
                <span className="p4-expert">
                  <strong>{emp.displayName}</strong>
                  <code>{emp.username}</code>
                </span>

                {STAGE_KEYS.map((sk) => {
                  const alloc = allocationOf(emp.username, sk);
                  // A leftover from the pre-matrix per-stage checkbox: a
                  // disabled allocation that still carries its old nonzero
                  // value. It renders like any other cell but contributes
                  // nothing until edited (see handleShareChange).
                  const inactiveWithValue = Boolean(alloc && !alloc.isActive && alloc.value > 0);
                  return (
                    <input
                      key={sk}
                      type="number"
                      className={`p4-matrix-input num${inactiveWithValue ? " is-inactive-legacy" : ""}`}
                      aria-label={fillTemplate(L.p4_matrix_field_aria, {
                        expert: emp.displayName,
                        stage: STAGE_LABELS[sk],
                      })}
                      title={inactiveWithValue ? L.p4_matrix_cell_inactive_note : undefined}
                      min={0}
                      value={alloc?.value ?? 0}
                      disabled={!canConfigure}
                      onChange={(e) =>
                        handleShareChange(emp.username, sk, parseInt(e.target.value, 10) || 0)
                      }
                    />
                  );
                })}

                <span>
                  {emp.hasCertScanLicense ? (
                    <span className="p4-status-pill ok report-status ok">
                      <CheckCircle2 size={12} aria-hidden /> {L.p4_matrix_license_yes}
                    </span>
                  ) : (
                    <span className="p4-status-pill muted report-status muted">
                      <XCircle size={12} aria-hidden /> {L.p4_matrix_license_no}
                    </span>
                  )}
                </span>

                <span className="num">{formatNumber(counts.normal)}</span>
                <span className="num">{formatNumber(counts.cert)}</span>
                {excluded ? (
                  <span className="p4-excluded-tag">{L.p4_matrix_row_excluded}</span>
                ) : (
                  <strong className="num p4-matrix-new">{formatNumber(counts.total)}</strong>
                )}
              </div>
            );
          })}

          <div className="p4-matrix-row p4-matrix-totals" role="row">
            <span>{L.p4_matrix_totals_label}</span>
            {STAGE_KEYS.map((sk, i) => {
              const sum = stageShareTotals[i];
              const mixed = stageHasMixedMethod[i];
              const ok = sum === 100;
              return (
                <span
                  key={sk}
                  className={`num p4-total-share${mixed ? " mixed" : ok ? " ok" : " warn"}`}
                  title={fillTemplate(
                    mixed
                      ? L.p4_matrix_totals_stage_mixed
                      : ok ? L.p4_matrix_totals_stage_ok : L.p4_matrix_totals_stage_warn,
                    { stage: STAGE_LABELS[sk], sum: formatNumber(sum) }
                  )}
                >
                  {formatNumber(sum)}
                </span>
              );
            })}
            <span />
            <span className="num">{formatNumber(previewTotals.normal)}</span>
            <span className="num">{formatNumber(previewTotals.cert)}</span>
            <strong className="num">{formatNumber(previewTotals.total)}</strong>
          </div>
        </div>
      </div>

      {/* المراجعة اليدوية — in place, collapsed by default (activeTab === "bulk"). */}
      <div className={`p4-manual-card${manualOpen ? " open" : ""}`}>
        <button
          type="button"
          className="p4-manual-summary"
          aria-expanded={manualOpen}
          aria-controls="p4-manual-section"
          onClick={() => setActiveTab(manualOpen ? "bulk" : "manual")}
        >
          <span className="p4-manual-chevron" aria-hidden>
            <ChevronDown size={16} />
          </span>
          <h3>{L.p4_manual_title}</h3>
          <span className="p4-manual-caption">
            {fillTemplate(L.p4_manual_caption, {
              unassigned: formatNumber(unassignedCount),
              replacement: formatNumber(statusCounts["replacement-requested"]),
            })}
          </span>
          <span className="p4-manual-hint">
            {manualOpen ? L.p4_manual_collapse_hint : L.p4_manual_expand_hint}
          </span>
        </button>

        {manualOpen && (
          <div id="p4-manual-section" className="distribution-manual-panel">
            <div className="p4-manual-toolbar distribution-manual-toolbar">
              <label className="dist-search-box" htmlFor="manual-xray-search">
                <Search size={15} aria-hidden="true" />
                <input
                  id="manual-xray-search"
                  type="search"
                  aria-label="بحث بمعرف الأشعة"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder={L.p4_manual_search_placeholder}
                />
              </label>

              <div className="p4-status-chips" role="group" aria-label={L.p4_manual_col_status}>
                {(["unassigned", "pending", "replacement-requested", "completed"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`p4-chip${manualStatusFilter === status ? " active" : ""}`}
                    aria-pressed={manualStatusFilter === status}
                    onClick={() =>
                      setManualStatusFilter(manualStatusFilter === status ? "all" : status)
                    }
                  >
                    {STATUS_LABELS[status]}
                    <strong className="num">{formatNumber(statusCounts[status])}</strong>
                  </button>
                ))}
              </div>

              <label className="dist-filter-field" htmlFor="manual-employee-filter">
                {L.p4_matrix_col_expert}
                <select
                  id="manual-employee-filter"
                  value={manualEmployeeFilter}
                  onChange={(e) => setManualEmployeeFilter(e.target.value)}
                >
                  <option value="all">{L.p4_manual_all_experts}</option>
                  <option value="unassigned">{L.p4_manual_unassigned_option}</option>
                  {assignedEmployeeOptions.map((employee) => (
                    <option key={employee.username} value={employee.username}>
                      {employee.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <strong className="dist-filter-count num">
                {formatNumber(filteredManualRows.length)} / {formatNumber(totalRows)}
              </strong>

              {hasManualFilter && (
                <button type="button" className="dist-clear-filters-btn" onClick={clearManualFilters}>
                  {L.p4_manual_clear_filters}
                </button>
              )}
            </div>

            <div className="p4-manual-table distribution-table-wrapper">
              <div className="distribution-table" role="table">
                <div className="p4-manual-row p4-manual-header distribution-header" role="row">
                  <span role="columnheader">{L.p4_manual_col_xray}</span>
                  <span role="columnheader">{L.p4_manual_col_port}</span>
                  <span role="columnheader">{L.p4_manual_col_certscan}</span>
                  <span role="columnheader">{L.p4_manual_col_status}</span>
                  <span role="columnheader">{L.p4_manual_col_expert}</span>
                  <span role="columnheader">{L.p4_manual_col_action}</span>
                </div>

                {filteredManualRows.length === 0 ? (
                  <div className="distribution-empty-row" role="row">
                    {L.p4_manual_empty}
                  </div>
                ) : filteredManualRows.map((row) => {
                  const entry = entryMap.get(row.xrayImageId);
                  return (
                    <DistributionRow
                      key={row.xrayImageId}
                      row={row}
                      entry={entry ?? null}
                      employees={employees}
                      isDisabled={!canDistribute || isDistributing}
                      onAssign={onAssign}
                      onReassign={onReassign}
                      onMarkComplete={onMarkComplete}
                      onRequestReplacement={onRequestReplacement}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
