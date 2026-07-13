import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../../data/sampling/samplingPlanStorage";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
import { formatNumber, getStageKey } from "./helpers";
import SummaryCard from "./SummaryCard";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock, ShieldCheck, Unlock } from "lucide-react";
import { hasFeature, readUserManagementState } from "../../../../../auth/userManagement";
import type { AuthRole } from "../../../../../auth/authTypes";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../../data/population/monthFolder";
import { evaluateApprovalEligibility, isSelfApproval } from "../../../../../data/sampling/sampleApprovalRules";

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type PhaseThreeSamplingProps = {
  populationRows: PreparedPopulationRow[];
  sampleSeed: string;
  isDrawingSample: boolean;
  sampleDrawResult: SampleMasterData | null;
  sampleSaveMessage: SaveMessage;
  config: PopulationConfig;
  userRole: string;
  currentUsername: string;
  priorMonthAdvisory: SamplingPlanPriorMonthAdvisory | null;
  sampleNeedsApproval: boolean;
  isApprovingSample: boolean;
  onApproveSample: () => void;
  onConfigChange: (config: PopulationConfig) => void;
  onSampleSeedChange: (seed: string) => void;
  onDrawSample: () => void;
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}

/** B4: prior-month switching-rule advisory banner. Renders nothing when there is no signal. */
function SwitchingAdvisory({ advisory }: { advisory: SamplingPlanPriorMonthAdvisory | null }) {
  if (!advisory || advisory.priorMonthSuspicionRate === null || !advisory.inspectionRecommendation) {
    return null;
  }
  const L = getLabels();
  const tightened = advisory.inspectionRecommendation === "tightened-review";
  const monthLabel = advisory.priorMonthFolderName
    ? formatMonthFolderShortLabel(advisory.priorMonthFolderName)
    : "";
  const ratePct = `${(advisory.priorMonthSuspicionRate * 100).toFixed(1)}%`;
  return (
    <div
      className={`switching-advisory${tightened ? " tightened" : ""}`}
      role="status"
      style={{
        margin: "12px 0",
        padding: "12px 16px",
        borderRadius: 10,
        border: `1px solid ${tightened ? "#d97706" : "#0ea5e9"}`,
        background: tightened ? "rgba(217,119,6,.08)" : "rgba(14,165,233,.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
        <Info size={16} aria-hidden />
        {L.switching_advisory_title}
      </div>
      <p style={{ margin: "6px 0 0" }}>
        {fillTemplate(L.switching_advisory_rate, { month: monthLabel, rate: ratePct })}
      </p>
      <p style={{ margin: "4px 0 0" }}>
        {tightened ? L.switching_advisory_tightened : L.switching_advisory_normal}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--p-muted)" }}>
        {L.switching_advisory_disclaimer}
      </p>
    </div>
  );
}

/** B1: four-eyes approval panel — shown after a sample is drawn. */
function SampleApprovalPanel({
  sample,
  userRole,
  currentUsername,
  needsApproval,
  isApproving,
  onApprove,
}: {
  sample: SampleMasterData;
  userRole: string;
  currentUsername: string;
  needsApproval: boolean;
  isApproving: boolean;
  onApprove: () => void;
}) {
  const L = getLabels();
  const isSelf = isSelfApproval(currentUsername, sample.drawnBy);
  const eligibility = evaluateApprovalEligibility(userRole, currentUsername, sample.drawnBy);
  const canApproveNow = eligibility.allowed;
  const canApproveRole = eligibility.allowed || eligibility.reason === "self-approval-blocked";

  if (sample.approval) {
    const a = sample.approval;
    return (
      <div className="sample-approval-panel approved" role="status" style={approvalBoxStyle("#059669")}>
        <div style={approvalTitleStyle}>
          <ShieldCheck size={16} aria-hidden /> {L.sample_approval_section_title}
        </div>
        <p style={{ margin: "6px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={15} style={{ color: "#059669" }} aria-hidden />
          {fillTemplate(L.sample_approval_state, {
            user: a.approvedBy,
            role: a.role,
            date: new Date(a.approvedAt).toLocaleString("ar-SA-u-nu-latn"),
          })}
        </p>
        {a.note ? (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--p-muted)" }}>
            {L.sample_approval_note_label}: {a.note}
          </p>
        ) : null}
      </div>
    );
  }

  // No approval recorded. If this is a legacy/previous-session sample (needsApproval
  // false) show the legacy note; otherwise show the pending-approval gate + action.
  if (!needsApproval) {
    return (
      <div className="sample-approval-panel legacy" role="status" style={approvalBoxStyle("#64748b")}>
        <div style={approvalTitleStyle}>
          <ShieldCheck size={16} aria-hidden /> {L.sample_approval_section_title}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--p-muted)" }}>
          {L.sample_approval_legacy_note}
        </p>
      </div>
    );
  }

  return (
    <div className="sample-approval-panel pending" role="status" style={approvalBoxStyle("#d97706")}>
      <div style={approvalTitleStyle}>
        <AlertTriangle size={16} aria-hidden /> {L.sample_approval_section_title}
      </div>
      <p style={{ margin: "6px 0 0" }}>{L.sample_approval_intro}</p>
      <p style={{ margin: "4px 0 8px", fontWeight: 700, color: "#b45309" }}>
        {L.sample_approval_pending}
      </p>
      <button
        type="button"
        className="primary-action"
        onClick={onApprove}
        disabled={isApproving || !canApproveNow}
        title={!canApproveNow
          ? (isSelf ? L.sample_approve_self_blocked : L.sample_approve_no_permission)
          : ""}
      >
        {isApproving ? L.sample_approving : L.sample_approve_btn}
      </button>
      {!canApproveNow ? (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b45309" }}>
          {isSelf && canApproveRole ? L.sample_approve_self_blocked : L.sample_approve_no_permission}
        </p>
      ) : null}
    </div>
  );
}

const approvalTitleStyle = { display: "flex", alignItems: "center", gap: 8, fontWeight: 700 } as const;
function approvalBoxStyle(color: string) {
  return {
    margin: "14px 0",
    padding: "12px 16px",
    borderRadius: 10,
    border: `1px solid ${color}`,
    background: `${color}14`,
  } as const;
}

const STAGE_LABELS: Record<string, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع"
};

export default function PhaseThreeSampling({
  populationRows,
  sampleSeed,
  isDrawingSample,
  sampleDrawResult,
  sampleSaveMessage,
  config,
  userRole,
  currentUsername,
  priorMonthAdvisory,
  sampleNeedsApproval,
  isApprovingSample,
  onApproveSample,
  onConfigChange,
  onSampleSeedChange,
  onDrawSample
}: PhaseThreeSamplingProps) {
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  const stageCounts = {
    first:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "first").length,
    second: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "second").length,
    third:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "third").length,
    fourth: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "fourth").length
  };

  const handleRuleChange = (
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof StageSamplingRule,
    value: StageSamplingRule[keyof StageSamplingRule]
  ) => {
    const updatedRules = config.samplingRules.map((rule) =>
      rule.stageKey === stageKey ? { ...rule, [field]: value } : rule
    );
    onConfigChange({ ...config, samplingRules: updatedRules });
  };

  return (
    <section className="sampling-phase" aria-label="اختيار العينة">
      <div className="phase-panel-header compact">
        <div>
          <h2>المرحلة 3: اختيار العينة (حسب المستويات)</h2>
          <p>
            تخصيص قواعد السحب لكل مستوى بشكل منفصل. يدعم النظام التحكم بنسب
            السحب وحجم العينات ونسب سحب CertScan الخاصة.
          </p>
        </div>
      </div>

      <SwitchingAdvisory advisory={priorMonthAdvisory} />

      <div className="sampling-config-panel">
        <div className="sampling-stage-rules">
          {config.samplingRules.map((rule) => {
            const size = stageCounts[rule.stageKey];
            const calculatedCount =
              rule.method === "percentage"
                ? Math.round((rule.value / 100) * size)
                : rule.value;

            let warnMessage = "";
            let finalCount = calculatedCount;
            if (rule.minRequiredCount > 0) {
              if (size < rule.minRequiredCount) {
                finalCount = size;
                warnMessage = `تنبيه: المجتمع المتاح (${size}) أقل من الحد الأدنى (${rule.minRequiredCount}). سيتم سحب 100%.`;
              } else if (calculatedCount < rule.minRequiredCount) {
                finalCount = rule.minRequiredCount;
                warnMessage = `تم تطبيق الحد الأدنى (${rule.minRequiredCount}) بدلاً من القيمة المدخلة.`;
              }
            }

            const isAutoLocked = rule.stageKey === "first" || (rule.minRequiredCount > 0 && size < rule.minRequiredCount);
            const isLockedState = (rule.isLocked || isAutoLocked) && !isAdminUnlocked;
            const canUnlock = hasFeature(
              readUserManagementState().featurePermissions,
              userRole as AuthRole,
              "unlock-sampling-stage"
            );

            return (
              <div
                key={rule.stageKey}
                className={`sampling-stage-card${isLockedState ? " locked" : ""}`}
              >
                <div className="sampling-stage-card-header">
                  <h3>{STAGE_LABELS[rule.stageKey]}</h3>
                  <div className="sampling-stage-meta">
                    <span>
                      المجتمع المتوفر:{" "}
                      <strong>{formatNumber(size)}</strong>
                    </span>
                    {(rule.isLocked || isAutoLocked) && (
                      <button
                        type="button"
                        className={`lock-toggle-btn${isAutoLocked ? " auto" : ""}`}
                        title={isAutoLocked ? "مقفل تلقائياً — يتطلب صلاحية إلغاء القفل" : ""}
                        onClick={() => {
                          if (canUnlock) {
                            setIsAdminUnlocked(!isAdminUnlocked);
                          } else {
                            alert("لا تملك صلاحية إلغاء قفل مراحل العينة.");
                          }
                        }}
                      >
                        {isAdminUnlocked
                          ? <><Unlock size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> مفتوح</>
                          : isAutoLocked
                          ? <><AlertTriangle size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> مقفل تلقائياً</>
                          : <><Lock size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> مغلق</>}
                      </button>
                    )}
                  </div>
                </div>

                <div className="sampling-rule-row">
                  <label className="sampling-rule-field flex-grow save-disk-label">
                    طريقة السحب
                    <select
                      className="save-disk-input"
                      value={rule.method}
                      disabled={isLockedState}
                      onChange={(e) =>
                        handleRuleChange(rule.stageKey, "method", e.target.value as StageSamplingRule[keyof StageSamplingRule])
                      }
                    >
                      <option value="percentage">نسبة مئوية (%)</option>
                      <option value="exact">عدد محدد</option>
                    </select>
                  </label>

                  <label className="sampling-rule-field narrow save-disk-label">
                    القيمة المطلوبة
                    <input
                      type="number"
                      className="save-disk-input"
                      value={rule.value}
                      min={0}
                      disabled={isLockedState}
                      onChange={(e) =>
                        handleRuleChange(
                          rule.stageKey,
                          "value",
                          parseInt(e.target.value, 10) || 0
                        )
                      }
                    />
                  </label>

                  <div className="sampling-expected">
                    <span>حجم العينة المتوقع:</span>
                    <strong>{formatNumber(finalCount)}</strong>
                  </div>
                </div>

                <div className="sampling-certscan-section">
                  <h4>تخصيص CertScan للمستوى</h4>
                  <div className="sampling-rule-row">
                    <label className="sampling-rule-field flex-grow save-disk-label">
                      نوع كوتا CertScan
                      <select
                        className="save-disk-input"
                        value={rule.certScanMethod}
                        onChange={(e) =>
                          handleRuleChange(rule.stageKey, "certScanMethod", e.target.value as StageSamplingRule[keyof StageSamplingRule])
                        }
                      >
                        <option value="percentage">نسبة مئوية (%)</option>
                        <option value="exact">عدد محدد</option>
                      </select>
                    </label>

                    <label className="sampling-rule-field narrow save-disk-label">
                      القيمة
                      <input
                        type="number"
                        className="save-disk-input"
                        value={
                          rule.certScanMethod === "percentage"
                            ? rule.certScanPercentage
                            : rule.certScanExactCount
                        }
                        min={0}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10) || 0;
                          if (rule.certScanMethod === "percentage") {
                            handleRuleChange(rule.stageKey, "certScanPercentage", v);
                          } else {
                            handleRuleChange(rule.stageKey, "certScanExactCount", v);
                          }
                        }}
                      />
                    </label>

                  </div>
                </div>

                {warnMessage && (
                  <p className="sampling-warn" role="alert">
                    {warnMessage}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* RNG Seed + trigger */}
        <div className="sampling-rng-row">
          <label className="save-disk-label" style={{ flex: 1 }}>
            رمز التوزيع العشوائي - يمكن تعديله لإعادة إنتاج نفس العينة
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                id="sample-seed"
                type="text"
                value={sampleSeed}
                className="sampling-rng-input"
                style={{ flex: 1 }}
                disabled={isDrawingSample}
                onChange={(e) => onSampleSeedChange(e.target.value)}
              />
            </div>
          </label>

          <button
            type="button"
            className="primary-action"
            onClick={onDrawSample}
            disabled={isDrawingSample || populationRows.length === 0}
          >
            {isDrawingSample ? "جاري سحب العينات..." : "سحب العينات وحفظها"}
          </button>
        </div>

        {sampleSaveMessage && (
          <div
            className={sampleSaveMessage.type === "ok" ? "msg-success" : "msg-error"}
            role="status"
          >
            {sampleSaveMessage.text}
          </div>
        )}
      </div>

      {sampleDrawResult && (
        <SampleApprovalPanel
          sample={sampleDrawResult}
          userRole={userRole}
          currentUsername={currentUsername}
          needsApproval={sampleNeedsApproval}
          isApproving={isApprovingSample}
          onApprove={onApproveSample}
        />
      )}

      {sampleDrawResult && <SampleResultReport data={sampleDrawResult} />}
    </section>
  );
}

function SampleResultReport({ data }: { data: SampleMasterData }) {
  return (
    <section className="sample-result-section" aria-label="نتائج العينة">
      <h3>نتائج سحب عينة المستويات المشتركة</h3>

      <div className="sample-kpi-grid">
        <SummaryCard label="المستهدف الكلي"       value={data.totalRequested} />
        <SummaryCard label="المسحوب الكلي فعلياً"  value={data.totalActual} />
        <SummaryCard label="سجلات CertScan"        value={data.certScanActual} />
        <SummaryCard label="سجلات عادية"           value={data.nonCertScanActual} />
      </div>

      {(data.stageAllocations ?? []).length > 0 && (
        <div className="report-sheet-table" role="table" style={{ marginTop: "16px" }}>
          <div className="report-sheet-header sample-stage-row" role="row">
            <span>المستوى</span>
            <span>المجتمع</span>
            <span>المستهدف</span>
            <span>CertScan</span>
            <span>NonCertScan</span>
            <span>المسحوب</span>
          </div>
          {data.stageAllocations.map(s => (
            <div key={s.stageKey} className="report-sheet-row sample-stage-row" role="row">
              <span>{s.stageLabel}</span>
              <span>{formatNumber(s.populationSize)}</span>
              <span>{formatNumber(s.targetQuota)}</span>
              <span>{formatNumber(s.certScanDrawn)}</span>
              <span>{formatNumber(s.nonCertScanDrawn)}</span>
              <span>{formatNumber(s.actualDrawn)}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: "10px", fontSize: "12px", color: "var(--p-muted)" }}>
        رمز التوزيع العشوائي: <code>{data.rngSeed}</code> — تم السحب:{" "}
        {new Date(data.drawnAt).toLocaleString("ar-SA-u-nu-latn")}
      </p>
    </section>
  );
}
