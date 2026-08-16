import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { CertScanShortfall, SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../../data/sampling/samplingPlanStorage";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
import { formatNumber, getStageKey } from "./helpers";
import SummaryCard from "./SummaryCard";
import { useState } from "react";
import { AlertTriangle, Info, Lock, Unlock } from "lucide-react";
import { usePermissions } from "../../../../../auth/usePermissions";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../../data/population/monthFolder";
// Reuse the algorithm's own floor/cap logic (single source of truth) so the
// running total shown here before the draw matches what drawStageSample will
// actually use — see B (sampling config UI) task 1: the total must reflect the
// *effective* per-stage target (after minRequiredCount is applied), not the
// raw entered values, or the running total would understate what actually gets drawn.
// certScanConfiguredTarget mirrors the CertScan target math drawStage uses
// internally, so the pre-draw shortfall estimate below can never drift from
// what the real draw will actually request.
import { configuredTarget, certScanConfiguredTarget } from "../../../../../data/sampling/sampleAlgorithmInternals";

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
  /** B13: gates the "سحب العينات وحفظها" (draw sample) button — already combines
   *  permission + closed-month + in-flight-month-load in index.tsx, matching the
   *  canDrawSample used by its own handler-side check (handleDrawSample). */
  canDrawSample: boolean;
  /** B13: gates the stage-rule and CertScan-quota fields (render-time), matching the
   *  canConfigureSample already enforced handler-side in handleConfigChange. */
  canConfigureSample: boolean;
  /**
   * B13: shared wizard status/error text (index.tsx's setProcessingMessage). Phase 3 did
   * not render this previously, so a rejected config edit (e.g. handleConfigChange denying
   * a CertScan quota change for lack of permission) surfaced no visible feedback — the
   * input just silently reverted to its previous value on the next render.
   */
  processingMessage: string;
  onConfigChange: (config: PopulationConfig) => void;
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
  priorMonthAdvisory,
  canDrawSample,
  canConfigureSample,
  processingMessage,
  onConfigChange,
  onDrawSample
}: PhaseThreeSamplingProps) {
  const { canMutate } = usePermissions();
  const canUnlock = canMutate("unlock-sampling-stage");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  const stageCounts = {
    first:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "first").length,
    second: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "second").length,
    third:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "third").length,
    fourth: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "fourth").length
  };

  // CertScan pool available per stage — used only for the pre-draw shortfall
  // estimate below, never to change what the draw itself does.
  const certScanAvailableByStage = {
    first:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "first" && r.certScanStatus === "Certscan").length,
    second: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "second" && r.certScanStatus === "Certscan").length,
    third:  populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "third" && r.certScanStatus === "Certscan").length,
    fourth: populationRows.filter((r) => getStageKey(r.stage, config.stageMappings) === "fourth" && r.certScanStatus === "Certscan").length
  };

  const L = getLabels();

  // Precompute each stage's effective target (mirrors configuredTarget, the
  // exact function drawStageSample uses) BEFORE rendering the cards, so the
  // running total below can sum the numbers that will actually be drawn —
  // not the raw entered values, which is what let the owner's requested total
  // silently balloon before (floor override applied only after the draw ran).
  const stageComputations = config.samplingRules.map((rule) => {
    const size = stageCounts[rule.stageKey];
    const calculatedCount =
      rule.method === "percentage" ? Math.round((rule.value / 100) * size) : rule.value;
    const finalCount = configuredTarget(rule, size);
    const insufficientPopulation = rule.minRequiredCount > 0 && size < rule.minRequiredCount;
    const floorOverridden =
      rule.minRequiredCount > 0 && !insufficientPopulation && calculatedCount < rule.minRequiredCount;
    // CertScan shortfall estimate (owner decision, 2026-08): compares the
    // stage-level CertScan request against the stage-level CertScan pool —
    // the real draw further splits by port, so this can under-count a
    // percentage-method shortfall that only appears once a specific port's
    // quota is apportioned. It exists to catch the common case BEFORE the
    // draw runs, not to replace the authoritative post-draw report.
    const certScanAvailable = certScanAvailableByStage[rule.stageKey];
    const certScanRequested = certScanConfiguredTarget(rule, finalCount);
    const certScanShortfallEstimate = certScanRequested > certScanAvailable;
    return {
      rule, size, calculatedCount, finalCount, insufficientPopulation, floorOverridden,
      certScanAvailable, certScanRequested, certScanShortfallEstimate
    };
  });
  const runningTotal = stageComputations.reduce((sum, c) => sum + c.finalCount, 0);
  const overriddenStages = stageComputations.filter((c) => c.floorOverridden);
  const certScanShortfallStages = stageComputations.filter((c) => c.certScanShortfallEstimate);

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

      {/* Running total across all stage cards, visible BEFORE the draw is triggered
          (previously the summed total first appeared in SampleResultReport, i.e.
          after the draw already ran — B task 1, owner-reported "requested 7,000, got
          ~9,000"). Reflects each stage's *effective* target (after any floor
          override), matching what drawStageSample will actually draw. */}
      <div
        className={`sampling-running-total${overriddenStages.length > 0 ? " has-override" : ""}`}
        role="status"
        style={{
          margin: "12px 0",
          padding: "12px 16px",
          borderRadius: 10,
          border: `1px solid ${overriddenStages.length > 0 ? "#d97706" : "var(--p-border, #cbd5e1)"}`,
          background: overriddenStages.length > 0 ? "rgba(217,119,6,.08)" : "rgba(14,165,233,.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
          {overriddenStages.length > 0 && <AlertTriangle size={16} aria-hidden />}
          {L.sampling_running_total_label}: <strong>{formatNumber(runningTotal)}</strong>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--p-muted)" }}>
          {L.sampling_running_total_note}
        </p>
        {overriddenStages.map(({ rule, calculatedCount, finalCount }) => (
          <p key={rule.stageKey} className="sampling-warn" role="alert" style={{ margin: "6px 0 0" }}>
            {fillTemplate(L.sampling_floor_override_warning, {
              stage: STAGE_LABELS[rule.stageKey],
              entered: String(calculatedCount),
              effective: String(finalCount),
              minRequired: String(rule.minRequiredCount),
            })}
          </p>
        ))}
      </div>

      {/* CertScan shortfall estimate, visible BEFORE the draw runs (owner decision,
          2026-08): a stratum short on CertScan under-fills rather than silently
          backfilling from NonCertscan — this warns as early as possible instead of
          the operator only discovering it after the draw, in SampleResultReport. */}
      {certScanShortfallStages.length > 0 && (
        <div
          className="sampling-certscan-shortfall-warning has-override"
          role="alert"
          style={{
            margin: "12px 0",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #d97706",
            background: "rgba(217,119,6,.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
            <AlertTriangle size={16} aria-hidden />
            {L.sampling_certscan_shortfall_predraw_title}
          </div>
          {certScanShortfallStages.map(({ rule, certScanRequested, certScanAvailable }) => (
            <p key={rule.stageKey} style={{ margin: "6px 0 0" }}>
              {fillTemplate(L.sampling_certscan_shortfall_predraw_row, {
                stage: STAGE_LABELS[rule.stageKey],
                requested: String(certScanRequested),
                available: String(certScanAvailable),
              })}
            </p>
          ))}
        </div>
      )}

      <div className="sampling-config-panel">
        <div className="sampling-stage-rules">
          {stageComputations.map(({ rule, size, finalCount, insufficientPopulation, floorOverridden }) => {
            let warnMessage = "";
            if (insufficientPopulation) {
              warnMessage = `تنبيه: المجتمع المتاح (${size}) أقل من الحد الأدنى (${rule.minRequiredCount}). سيتم سحب 100%.`;
            } else if (floorOverridden) {
              warnMessage = `تم تطبيق الحد الأدنى (${rule.minRequiredCount}) بدلاً من القيمة المدخلة — راجع التنبيه أعلى الصفحة.`;
            }

            const isAutoLocked = rule.stageKey === "first" || insufficientPopulation;
            const isLockedState = (rule.isLocked || isAutoLocked) && !isAdminUnlocked;
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
                        disabled={isLockedState || !canConfigureSample}
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
                        disabled={isLockedState || !canConfigureSample}
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

        {/* W14: the RNG seed edit control moved to إعدادات المعالجة (MappingSettingsModal,
            mode="processing") — this still drives the draw below via the sampleSeed prop,
            only its edit UI relocated. A compact read-only reference stays here so the
            operator can see which seed a draw will use / did use without leaving the page. */}
        <div className="sampling-rng-row">
          <span className="sampling-rng-current" style={{ flex: 1, fontSize: 12, color: "var(--p-muted)" }}>
            رمز التوزيع العشوائي الحالي: <code>{sampleSeed}</code>
            {" — "}يمكن تعديله من إعدادات المعالجة
          </span>

          <button
            type="button"
            className="primary-action"
            onClick={onDrawSample}
            // Not gated on populationRows.length === 0: under Phase A demand-gated loading,
            // an empty array here can mean "genuinely no population" OR "not loaded in this
            // view's scope yet" (see index.tsx's ensurePopulationLoaded) -- those look
            // identical from this component's props alone. onDrawSample's own handler
            // resolves the ambiguity (fetching on demand) and surfaces the same Arabic
            // error message this button used to pre-empt if population turns out missing.
            disabled={isDrawingSample || !canDrawSample}
            title={!canDrawSample ? "لا تملك صلاحية سحب العينة، أو أن الشهر مغلق، أو أن بيانات الشهر قيد التحميل." : undefined}
          >
            {isDrawingSample ? "جاري سحب العينات..." : "سحب العينات وحفظها"}
          </button>
        </div>

        {processingMessage && (
          <div className="upload-warning" role="status">
            {processingMessage}
          </div>
        )}

        {sampleSaveMessage && (
          <div
            className={sampleSaveMessage.type === "ok" ? "msg-success" : "msg-error"}
            role="status"
          >
            {sampleSaveMessage.text}
          </div>
        )}
      </div>

      {sampleDrawResult && <SampleResultReport data={sampleDrawResult} />}
    </section>
  );
}

/**
 * Prominent post-draw shortfall banner (owner decision, 2026-08). The owner's
 * original experience was seeing "20" and "10" in the result with no
 * explanation — this names each affected stratum, what was requested vs. what
 * was actually drawn, and why (insufficient CertScan rows available), so that
 * gap can never again pass unnoticed.
 */
function CertScanShortfallReport({ shortfalls }: { shortfalls: CertScanShortfall[] }) {
  if (shortfalls.length === 0) return null;
  const L = getLabels();
  return (
    <div
      className="sample-certscan-shortfall-report"
      role="alert"
      style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid #d97706",
        background: "rgba(217,119,6,.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
        <AlertTriangle size={16} aria-hidden />
        {L.sampling_certscan_shortfall_result_title}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--p-muted)" }}>
        {L.sampling_certscan_shortfall_result_intro}
      </p>
      {shortfalls.map((s, i) => (
        <p key={`${s.stageKey}-${s.portName ?? "stage"}-${i}`} className="sampling-warn" role="alert" style={{ margin: "6px 0 0" }}>
          {fillTemplate(
            s.portName === null
              ? L.sampling_certscan_shortfall_result_row_stage
              : L.sampling_certscan_shortfall_result_row_port,
            {
              stage: s.stageLabel,
              port: s.portName ?? "",
              requested: String(s.requestedCertScanQuota),
              actual: String(s.actualCertScanDrawn),
              available: String(s.availableCertScanRows),
            }
          )}
        </p>
      ))}
    </div>
  );
}

/**
 * Prominent post-draw exclusion banner (P4, 2026-08). Rows whose raw `stage`
 * value matched none of the four configured aliases never enter the draw at
 * all — they used to vanish with zero diagnostic on the success path. This
 * surfaces the count (and a sample of the offending raw values) so a
 * misconfigured/typo'd stage mapping can never again silently shrink the
 * population a sample is actually drawn from.
 */
function UnmappedStageWarning({ data }: { data: SampleMasterData }) {
  const count = data.unmappedStageRowCount ?? 0;
  if (count <= 0) return null;
  const L = getLabels();
  return (
    <div
      className="sampling-unmapped-stage-warning"
      role="alert"
      style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid #d97706",
        background: "rgba(217,119,6,.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
        <AlertTriangle size={16} aria-hidden />
        {L.sampling_unmapped_stage_warning_title}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--p-muted)" }}>
        {fillTemplate(L.sampling_unmapped_stage_warning_intro, { count: String(count) })}
      </p>
      {(data.unmappedStageRawValues ?? []).length > 0 && (
        <p style={{ margin: "6px 0 0", fontSize: 12 }}>
          {L.sampling_unmapped_stage_warning_values_label}{" "}
          {(data.unmappedStageRawValues ?? []).join("، ")}
        </p>
      )}
    </div>
  );
}

function SampleResultReport({ data }: { data: SampleMasterData }) {
  return (
    <section className="sample-result-section" aria-label="نتائج العينة">
      <h3>نتائج سحب عينة المستويات المشتركة</h3>

      <UnmappedStageWarning data={data} />
      <CertScanShortfallReport shortfalls={data.certScanShortfalls ?? []} />

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
