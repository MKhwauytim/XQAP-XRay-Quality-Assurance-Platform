import { getManagedLoginUsers } from "../../../../../auth/userManagement";
import { AlertTriangle, CheckCircle2, Settings2, XCircle, FilePen, Search } from "lucide-react";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { DistributionCurrentData, DistributionEvent } from "../../../../../data/distribution/distributionTypes";
import type { PopulationConfig, EmployeeStageAllocation } from "../../../../../data/population/populationConfig";
import SummaryCard from "./SummaryCard";
import DistributionRow from "./DistributionRow";
import { useState, useMemo } from "react";
import { getStageKey, formatNumber } from "./helpers";
import { calculateBulkAssignment } from "../../../../../data/distribution/bulkAssignment";

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type PhaseFourDistributionProps = {
  sampleDrawResult: SampleMasterData | null;
  distributionCurrent: DistributionCurrentData | null;
  distributionMessage: SaveMessage;
  isDistributing: boolean;
  canConfigure: boolean;
  canDistribute: boolean;
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

const STAGE_LABELS: Record<string, string> = {
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

export default function PhaseFourDistribution({
  sampleDrawResult,
  distributionCurrent,
  distributionMessage,
  isDistributing,
  canConfigure,
  canDistribute,
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
  const [activeTab, setActiveTab] = useState<"bulk" | "manual">("bulk");
  const [selectedStageTab, setSelectedStageTab] = useState<"first" | "second" | "third" | "fourth">("first");
  const [bulkError, setBulkError] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [manualStatusFilter, setManualStatusFilter] = useState("all");
  const [manualCertFilter, setManualCertFilter] = useState("all");
  const [manualEmployeeFilter, setManualEmployeeFilter] = useState("all");

  const employees = useMemo(
    () =>
      getManagedLoginUsers()
        .filter((u) => u.isActive && (u.role === "employee" || u.role === "supervisor"))
        .map((u) => ({
          username: u.username,
          displayName: u.displayName,
          hasCertScanLicense: u.hasCertScanLicense
        })),
    []
  );

  const sampleRows = useMemo(() => sampleDrawResult?.rows ?? [], [sampleDrawResult]);

  const stageSampleCounts = useMemo(
    () => ({
      first:  sampleRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "first"),
      second: sampleRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "second"),
      third:  sampleRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "third"),
      fourth: sampleRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "fourth")
    }),
    [sampleRows, config.stageMappings]
  );

  const activeAllocations = useMemo(() => {
    const list: EmployeeStageAllocation[] = [];
    const stageKeys = ["first", "second", "third", "fourth"] as const;
    for (const sKey of stageKeys) {
      for (const emp of employees) {
        const existing = config.employeeAllocations.find(
          (a) => a.username === emp.username && a.stageKey === sKey
        );
        list.push({
          username: emp.username,
          stageKey: sKey,
          method: existing?.method || "percentage",
          value: existing?.value !== undefined ? existing.value : 0,
          isActive: existing?.isActive || false,
          maxWorkload: existing?.maxWorkload
        });
      }
    }
    return list;
  }, [config.employeeAllocations, employees]);

  const handleAllocationChange = (
    username: string,
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof EmployeeStageAllocation,
    val: EmployeeStageAllocation[keyof EmployeeStageAllocation]
  ) => {
    const updated = activeAllocations.map((alloc) =>
      alloc.username === username && alloc.stageKey === stageKey
        ? { ...alloc, [field]: val }
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
      stageMappings: config.stageMappings,
      month: saveMonth,
      year: saveYear,
      existingEntries: distributionCurrent?.entries,
    });

    const summaryMap: Record<string, { cert: number; normal: number; total: number }> = {};
    for (const emp of employees) {
      summaryMap[emp.username] = { cert: 0, normal: 0, total: 0 };
    }

    for (const evt of events) {
      const row = sampleRows.find((r) => r.xrayImageId === evt.xrayImageId);
      const data = summaryMap[evt.assignedTo];
      if (data && row) {
        data.total += 1;
        if (row.certScanStatus === "Certscan") data.cert += 1;
        else data.normal += 1;
      }
    }

    return { summaryMap, errors, skipped };
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings, saveMonth, saveYear, distributionCurrent]);

  const entryMap = useMemo(
    () => new Map((distributionCurrent?.entries ?? []).map((e) => [e.xrayImageId, e])),
    [distributionCurrent]
  );

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
      if (manualCertFilter !== "all" && row.certScanStatus !== manualCertFilter) return false;
      if (manualEmployeeFilter === "unassigned" && assignedTo) return false;
      if (
        manualEmployeeFilter !== "all" &&
        manualEmployeeFilter !== "unassigned" &&
        assignedTo !== manualEmployeeFilter
      ) return false;
      return true;
    });
  }, [entryMap, manualCertFilter, manualEmployeeFilter, manualSearch, manualStatusFilter, sampleRows]);

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
    manualCertFilter !== "all" ||
    manualEmployeeFilter !== "all";

  const clearManualFilters = () => {
    setManualSearch("");
    setManualStatusFilter("all");
    setManualCertFilter("all");
    setManualEmployeeFilter("all");
  };

  const manualResultSummary = `${formatNumber(filteredManualRows.length)} / ${formatNumber(sampleRows.length)}`;

  const certScanOptions = Array.from(
    new Set(sampleRows.map((row) => row.certScanStatus).filter(Boolean))
  );

  const handleRunBulkAssignment = async () => {
    setBulkError("");
    const { events, errors, skipped } = calculateBulkAssignment({
      rows: sampleRows,
      allocations: activeAllocations,
      employees: getManagedLoginUsers(),
      operatorUsername,
      stageMappings: config.stageMappings,
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
    if (messages.length > 0) {
      setBulkError(messages.join(" "));
    }

    if (events.length === 0) {
      if (skipped > 0 && errors.length === 0) {
        setBulkError(`جميع الصفوف (${formatNumber(skipped)}) معينة مسبقاً — لا يوجد ما يُوزّع.`);
      }
      return;
    }

    await onApplyBulkAssignment(events);
  };

  return (
    <section className="distribution-phase" aria-label="توزيع العينة">
      <div className="phase-panel-header compact">
        <div>
          <h2>المرحلة 4: توزيع العينة</h2>
          <p>
            توزيع العينة الكلية على الموظفين الفعالين. يدعم التوزيع الجماعي
            الذكي حسب كوتا كل مستوى والتوزيع اليدوي لكل صف.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {distributionCurrent && (
        <div className="processing-summary-grid">
          <SummaryCard label="إجمالي المعينة" value={distributionCurrent.totalAssigned} />
          <SummaryCard label="قيد الانتظار"   value={distributionCurrent.totalPending} />
          <SummaryCard label="مكتملة"          value={distributionCurrent.totalCompleted} />
          <SummaryCard label="مستبدلة"         value={distributionCurrent.totalReplaced} />
        </div>
      )}

      {distributionMessage && (
        <div
          className={distributionMessage.type === "ok" ? "msg-success" : "msg-error"}
          role="status"
        >
          {distributionMessage.text}
        </div>
      )}

      {/* Tab bar */}
      <div className="dist-tab-bar" role="tablist">
        <button
          role="tab"
          type="button"
          className={`dist-tab-btn${activeTab === "bulk" ? " active" : ""}`}
          aria-selected={activeTab === "bulk"}
          onClick={() => setActiveTab("bulk")}
        >
          <Settings2 size={15} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> التوزيع الجماعي الذكي
        </button>
        <button
          role="tab"
          type="button"
          className={`dist-tab-btn${activeTab === "manual" ? " active" : ""}`}
          aria-selected={activeTab === "manual"}
          onClick={() => setActiveTab("manual")}
        >
          <FilePen size={15} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> المراجعة اليدوية
        </button>
      </div>

      {activeTab === "bulk" ? (
        <div className="distribution-phase">
          {/* Stage selector */}
          <div className="dist-stage-bar" role="tablist" aria-label="اختيار المستوى">
            {(["first", "second", "third", "fourth"] as const).map((sk) => (
              <button
                key={sk}
                role="tab"
                type="button"
                className={`dist-stage-btn${selectedStageTab === sk ? " active" : ""}`}
                aria-selected={selectedStageTab === sk}
                onClick={() => setSelectedStageTab(sk)}
              >
                {STAGE_LABELS[sk]} ({formatNumber(stageSampleCounts[sk].length)})
              </button>
            ))}
          </div>

          {/* Allocation config */}
          <div className="dist-config-card">
            <h3>إعدادات توزيع موظفي {STAGE_LABELS[selectedStageTab]}</h3>
            <div className="dist-alloc-table report-sheet-table" role="table">
              <div className="dist-alloc-header" role="row">
                <span>الموظف</span>
                <span>تفعيل بالمستوى</span>
                <span>طريقة التوزيع</span>
                <span>الحصة / النسبة</span>
                <span>ترخيص CertScan</span>
              </div>

              {employees.map((emp) => {
                const alloc = activeAllocations.find(
                  (a) => a.username === emp.username && a.stageKey === selectedStageTab
                )!;
                return (
                  <div key={emp.username} className="dist-alloc-row" role="row">
                    <span>
                      {emp.displayName}{" "}
                      <code style={{ fontSize: "11px", color: "var(--p-muted)" }}>
                        ({emp.username})
                      </code>
                    </span>

                    <span>
                      <input
                        type="checkbox"
                        checked={alloc.isActive}
                        disabled={!canConfigure}
                        aria-label={`تفعيل ${emp.displayName} في ${STAGE_LABELS[selectedStageTab]}`}
                        onChange={(e) =>
                          handleAllocationChange(emp.username, selectedStageTab, "isActive", e.target.checked)
                        }
                      />
                    </span>

                    <span>
                      <select
                        className="save-disk-input"
                        disabled={!canConfigure || !alloc.isActive}
                        value={alloc.method}
                        onChange={(e) =>
                          handleAllocationChange(emp.username, selectedStageTab, "method", e.target.value)
                        }
                      >
                        <option value="percentage">نسبة مئوية (%)</option>
                        <option value="exact">عدد محدد</option>
                      </select>
                    </span>

                    <span>
                      <input
                        type="number"
                        className="save-disk-input"
                        disabled={!canConfigure || !alloc.isActive}
                        min={0}
                        value={alloc.value}
                        onChange={(e) =>
                          handleAllocationChange(
                            emp.username,
                            selectedStageTab,
                            "value",
                            parseInt(e.target.value, 10) || 0
                          )
                        }
                      />
                    </span>

                    <span>
                      {emp.hasCertScanLicense ? (
                        <span className="report-status ok"><CheckCircle2 size={13} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> مرخص</span>
                      ) : (
                        <span className="report-status muted"><XCircle size={13} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> غير مرخص</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          {previewData && (
            <div className="dist-preview-card">
              <h3>معاينة حصص الموظفين الناتجة (الحجم الكلي)</h3>
              <div className="dist-alloc-table report-sheet-table" role="table">
                <div className="dist-preview-header" role="row">
                  <span>الموظف</span>
                  <span>عادية</span>
                  <span>CertScan</span>
                  <span>المجموع المتوقع</span>
                </div>

                {employees.map((emp) => {
                  const counts = previewData.summaryMap[emp.username] || { cert: 0, normal: 0, total: 0 };
                  return (
                    <div key={emp.username} className="dist-preview-row" role="row">
                      <span>{emp.displayName}</span>
                      <span>{counts.normal}</span>
                      <span>{counts.cert}</span>
                      <strong>{counts.total}</strong>
                    </div>
                  );
                })}
              </div>

              {previewData.skipped > 0 && (
                <div className="dist-skip-note" role="status" style={{ marginTop: 8 }}>
                  سيتم تخطي {formatNumber(previewData.skipped)} صفاً معيناً مسبقاً — التوزيع يشمل الصفوف غير المعينة فقط.
                </div>
              )}

              {previewData.errors.length > 0 && (
                <div className="dist-err-block" role="alert">
                  <AlertTriangle size={14} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> {previewData.errors.join(" | ")}
                </div>
              )}
            </div>
          )}

          {bulkError && (
            <div className="msg-error" role="alert">
              {bulkError}
            </div>
          )}

          <div className="dist-footer-row">
            <button
              type="button"
              className="primary-action"
              onClick={handleRunBulkAssignment}
              disabled={!canDistribute || isDistributing}
              title={!canDistribute ? "لا تملك صلاحية حفظ التوزيع، أو أن مساحة العمل للقراءة فقط." : undefined}
            >
              {isDistributing ? "جاري توزيع وحفظ التعيينات..." : "تطبيق وحفظ التوزيع التلقائي"}
            </button>
          </div>
        </div>
      ) : (
        <div className="distribution-manual-panel">
          <div className="distribution-manual-toolbar">
            <label className="dist-search-box" htmlFor="manual-xray-search">
              <Search size={15} aria-hidden="true" />
              <input
                id="manual-xray-search"
                type="search"
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                placeholder="بحث بمعرف الأشعة..."
              />
            </label>

            <label className="dist-filter-field" htmlFor="manual-status-filter">
              الحالة
              <select
                id="manual-status-filter"
                value={manualStatusFilter}
                onChange={(e) => setManualStatusFilter(e.target.value)}
              >
                <option value="all">الكل</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="dist-filter-field" htmlFor="manual-cert-filter">
              CertScan
              <select
                id="manual-cert-filter"
                value={manualCertFilter}
                onChange={(e) => setManualCertFilter(e.target.value)}
              >
                <option value="all">الكل</option>
                {certScanOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label className="dist-filter-field" htmlFor="manual-employee-filter">
              الخبير
              <select
                id="manual-employee-filter"
                value={manualEmployeeFilter}
                onChange={(e) => setManualEmployeeFilter(e.target.value)}
              >
                <option value="all">الكل</option>
                <option value="unassigned">غير معين</option>
                {assignedEmployeeOptions.map((employee) => (
                  <option key={employee.username} value={employee.username}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            </label>

            <strong className="dist-filter-count">{manualResultSummary}</strong>

            {hasManualFilter && (
              <button type="button" className="dist-clear-filters-btn" onClick={clearManualFilters}>
                مسح الفلاتر
              </button>
            )}
          </div>

          <div className="distribution-table-wrapper">
            <div className="distribution-table" role="table">
              <div className="distribution-header" role="row">
                <span>معرف الأشعة</span>
                <span>المنفذ</span>
                <span>CertScan</span>
                <span>الحالة</span>
                <span>خبير جودة الأشعة</span>
                <span>الإجراء</span>
              </div>

              {filteredManualRows.length === 0 ? (
                <div className="distribution-empty-row" role="row">
                  لا توجد نتائج مطابقة للفلاتر الحالية.
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
    </section>
  );
}
