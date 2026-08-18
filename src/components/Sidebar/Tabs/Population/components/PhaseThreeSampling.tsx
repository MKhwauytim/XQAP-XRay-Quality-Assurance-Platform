import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { CertScanShortfall, SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../../data/sampling/samplingPlanStorage";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
import { formatNumber, getStageKey } from "./helpers";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock, RefreshCw, Unlock } from "lucide-react";
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
import "./PhaseThreeSampling.css";

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

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "0";
  return ((part / whole) * 100).toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

const STAGE_LABELS: Record<string, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع"
};

/**
 * B4: prior-month switching-rule advisory. Since the 2026-08 redesign (`4b`) this is
 * no longer a standalone banner — it is one row of the grouped "تنبيهات قبل السحب"
 * card. The signal itself is unchanged: renders nothing when there is none.
 */
function buildSwitchingAdvisoryText(advisory: SamplingPlanPriorMonthAdvisory | null): string | null {
  if (!advisory || advisory.priorMonthSuspicionRate === null || !advisory.inspectionRecommendation) {
    return null;
  }
  const L = getLabels();
  const tightened = advisory.inspectionRecommendation === "tightened-review";
  const monthLabel = advisory.priorMonthFolderName
    ? formatMonthFolderShortLabel(advisory.priorMonthFolderName)
    : "";
  const ratePct = `${(advisory.priorMonthSuspicionRate * 100).toFixed(1)}%`;
  return [
    fillTemplate(L.switching_advisory_rate, { month: monthLabel, rate: ratePct }),
    tightened ? L.switching_advisory_tightened : L.switching_advisory_normal,
    L.switching_advisory_disclaimer,
  ].join(" ");
}

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

  // One pass over the population classifies every row once and tallies both the
  // stage totals and the per-stage CertScan pool. This used to be eight separate
  // `.filter()` passes recomputed on EVERY render, which on a real 117k-row month
  // cost ~10 s of blocked main thread on mount alone.
  //
  // `certScanAvailableByStage` is used only for the pre-draw shortfall estimate
  // below, never to change what the draw itself does.
  const { stageCounts, certScanAvailableByStage } = useMemo(() => {
    const counts = { first: 0, second: 0, third: 0, fourth: 0 };
    const certCounts = { first: 0, second: 0, third: 0, fourth: 0 };
    for (const row of populationRows) {
      const stageKey = getStageKey(row.stage, config.stageMappings);
      if (stageKey === "unknown") continue;
      counts[stageKey] += 1;
      if (row.certScanStatus === "Certscan") certCounts[stageKey] += 1;
    }
    return { stageCounts: counts, certScanAvailableByStage: certCounts };
  }, [populationRows, config.stageMappings]);

  const L = getLabels();

  // Precompute each stage's effective target (mirrors configuredTarget, the
  // exact function drawStageSample uses) BEFORE rendering the plan table, so the
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
  const populationTotal = stageComputations.reduce((sum, c) => sum + c.size, 0);
  const overriddenStages = stageComputations.filter((c) => c.floorOverridden);
  const insufficientStages = stageComputations.filter((c) => c.insufficientPopulation);
  const certScanShortfallStages = stageComputations.filter((c) => c.certScanShortfallEstimate);
  const certScanRequestedTotal = stageComputations.reduce((sum, c) => sum + c.certScanRequested, 0);
  const certScanAvailableTotal = stageComputations.reduce((sum, c) => sum + c.certScanAvailable, 0);
  const advisoryText = buildSwitchingAdvisoryText(priorMonthAdvisory);

  // Grouped alert stack (`4b`): the same three already-computed sources — floor
  // override, CertScan availability, and the prior-month switching advisory —
  // regrouped into one card. The CertScan row is the only one that also has a
  // *satisfied* state, and that state is deliberately NOT counted as an alert
  // and does NOT carry role="alert".
  const alertCount =
    overriddenStages.length + insufficientStages.length + certScanShortfallStages.length + (advisoryText ? 1 : 0);
  const alertsTitle =
    alertCount === 0 ? L.p3_alerts_title_none
      : alertCount === 1 ? L.p3_alerts_title_one
      : alertCount === 2 ? L.p3_alerts_title_two
      : fillTemplate(L.p3_alerts_title_many, { count: formatNumber(alertCount) });

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

  const fieldAria = (field: string, stageKey: string) =>
    fillTemplate(L.p3_plan_field_aria, { field, stage: STAGE_LABELS[stageKey] ?? stageKey });

  return (
    <section className="sampling-phase p3" aria-label="اختيار العينة">
      <div className="phase-panel-header compact">
        <div>
          <h2>المرحلة 3: اختيار العينة (حسب المستويات)</h2>
          <p>
            تخصيص قواعد السحب لكل مستوى بشكل منفصل. يدعم النظام التحكم بنسب
            السحب وحجم العينات ونسب سحب CertScan الخاصة.
          </p>
        </div>
      </div>

      <div className="p3-top-row">
        {/* Running total across all stages, visible BEFORE the draw is triggered
            (previously the summed total first appeared in SampleResultReport, i.e.
            after the draw already ran — B task 1, owner-reported "requested 7,000, got
            ~9,000"). Reflects each stage's *effective* target (after any floor
            override), matching what drawStageSample will actually draw. */}
        <div className="p3-total-card" role="status">
          <span className="p3-total-title">{L.sampling_running_total_label}</span>
          <div className="p3-total-value-row">
            <strong className="p3-total-value" aria-label={L.sampling_running_total_label}>
              {formatNumber(runningTotal)}
            </strong>
            <span className="p3-total-share">
              {fillTemplate(L.p3_total_share_of_population, {
                percent: formatPercent(runningTotal, populationTotal),
              })}
            </span>
          </div>
          <p className="p3-total-note">{L.sampling_running_total_note}</p>
          <div className="p3-total-stages">
            {stageComputations.map(({ rule, finalCount }) => (
              <span key={rule.stageKey} className="p3-total-stage-row">
                <span className="p3-total-stage-name">{STAGE_LABELS[rule.stageKey]}</span>
                <span className={`p3-share-track stage-${rule.stageKey}`} aria-hidden="true">
                  <span
                    className="p3-share-fill"
                    style={{ width: `${runningTotal > 0 ? (finalCount / runningTotal) * 100 : 0}%` }}
                  />
                </span>
                <strong className="p3-total-stage-value">{formatNumber(finalCount)}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className={`p3-alerts-card${alertCount > 0 ? " has-alerts" : ""}`}>
          <div className="p3-alerts-head">
            <span className="p3-alerts-icon" aria-hidden="true">
              {alertCount > 0 ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            </span>
            <h3 className="p3-alerts-title">{alertsTitle}</h3>
            <span className="p3-alerts-caption">{L.p3_alerts_caption}</span>
          </div>

          {overriddenStages.map(({ rule, calculatedCount, finalCount }) => (
            <div key={`floor-${rule.stageKey}`} className="p3-alert warn" role="alert">
              <span className="p3-alert-tag">{L.p3_alert_tag_floor}</span>
              <span className="p3-alert-text">
                {fillTemplate(L.sampling_floor_override_warning, {
                  stage: STAGE_LABELS[rule.stageKey],
                  entered: String(calculatedCount),
                  effective: String(finalCount),
                  minRequired: String(rule.minRequiredCount),
                })}
              </span>
              <a className="p3-alert-edit" href={`#p3-plan-row-${rule.stageKey}`}>
                {L.p3_alerts_edit_link}
              </a>
            </div>
          ))}

          {insufficientStages.map(({ rule, size }) => (
            <div key={`pop-${rule.stageKey}`} className="p3-alert warn" role="alert">
              <span className="p3-alert-tag">{L.p3_alert_tag_population}</span>
              <span className="p3-alert-text">
                {fillTemplate(L.p3_alert_population_insufficient, {
                  stage: STAGE_LABELS[rule.stageKey],
                  size: String(size),
                  minRequired: String(rule.minRequiredCount),
                })}
              </span>
              <a className="p3-alert-edit" href={`#p3-plan-row-${rule.stageKey}`}>
                {L.p3_alerts_edit_link}
              </a>
            </div>
          ))}

          {/* CertScan shortfall estimate, visible BEFORE the draw runs (owner decision,
              2026-08): a stratum short on CertScan under-fills rather than silently
              backfilling from NonCertscan — this warns as early as possible instead of
              the operator only discovering it after the draw, in SampleResultReport. */}
          {certScanShortfallStages.length > 0 ? (
            certScanShortfallStages.map(({ rule, certScanRequested, certScanAvailable }) => (
              <div key={`cert-${rule.stageKey}`} className="p3-alert warn" role="alert">
                <span className="p3-alert-tag">{L.p3_alert_tag_certscan}</span>
                <span className="p3-alert-text">
                  {fillTemplate(L.sampling_certscan_shortfall_predraw_row, {
                    stage: STAGE_LABELS[rule.stageKey],
                    requested: String(certScanRequested),
                    available: String(certScanAvailable),
                  })}
                </span>
                <a className="p3-alert-edit" href={`#p3-plan-row-${rule.stageKey}`}>
                  {L.p3_alerts_edit_link}
                </a>
              </div>
            ))
          ) : (
            <div className="p3-alert ok">
              <span className="p3-alert-tag">{L.p3_alert_tag_certscan}</span>
              <span className="p3-alert-text">
                {fillTemplate(L.p3_alert_certscan_satisfied, {
                  available: formatNumber(certScanAvailableTotal),
                  requested: formatNumber(certScanRequestedTotal),
                })}
              </span>
            </div>
          )}

          {advisoryText && (
            <div className="p3-alert info switching-advisory" role="status">
              <span className="p3-alert-tag">{L.p3_alert_tag_advisory}</span>
              <span className="p3-alert-text">
                <Info size={13} aria-hidden style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
                {advisoryText}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="p3-plan-card">
        <div className="p3-plan-head">
          <h3>{L.p3_plan_title}</h3>
          <span className="p3-plan-caption">{L.p3_plan_caption}</span>
        </div>

        <div className="p3-plan-table" role="table" aria-label={L.p3_plan_title}>
          <div className="p3-plan-row p3-plan-header" role="row">
            <span role="columnheader">{L.p3_plan_col_stage}</span>
            <span role="columnheader" className="num">{L.p3_plan_col_population}</span>
            <span role="columnheader">{L.p3_plan_col_method}</span>
            <span role="columnheader" className="num">{L.p3_plan_col_value}</span>
            <span role="columnheader">{L.p3_plan_col_certscan_method}</span>
            <span role="columnheader" className="num">{L.p3_plan_col_certscan_value}</span>
            <span role="columnheader" className="num">{L.p3_plan_col_expected}</span>
            <span role="columnheader">{L.p3_plan_col_status}</span>
          </div>

          {stageComputations.map(({ rule, size, calculatedCount, finalCount, insufficientPopulation, floorOverridden }) => {
            const isAutoLocked = rule.stageKey === "first" || insufficientPopulation;
            const isLockedState = (rule.isLocked || isAutoLocked) && !isAdminUnlocked;
            const fieldsDisabled = isLockedState || !canConfigureSample;
            return (
              <div
                key={rule.stageKey}
                id={`p3-plan-row-${rule.stageKey}`}
                className={`p3-plan-row${isLockedState ? " locked" : ""}`}
                role="row"
              >
                <span className="p3-plan-stage">{STAGE_LABELS[rule.stageKey]}</span>
                <span className="num p3-plan-population">{formatNumber(size)}</span>

                <select
                  className="p3-plan-input"
                  aria-label={fieldAria(L.p3_plan_col_method, rule.stageKey)}
                  value={rule.method}
                  disabled={fieldsDisabled}
                  onChange={(e) =>
                    handleRuleChange(rule.stageKey, "method", e.target.value as StageSamplingRule[keyof StageSamplingRule])
                  }
                >
                  <option value="percentage">{L.p3_plan_method_percentage}</option>
                  <option value="exact">{L.p3_plan_method_exact}</option>
                </select>

                <input
                  type="number"
                  className="p3-plan-input num"
                  aria-label={fieldAria(L.p3_plan_col_value, rule.stageKey)}
                  value={rule.value}
                  min={0}
                  max={rule.method === "percentage" ? 100 : undefined}
                  disabled={fieldsDisabled}
                  onChange={(e) => {
                    // min/max are spinner hints, not enforcement — a typed
                    // value out of range reaches the config unclamped
                    // otherwise. A percentage-method target above 100 has no
                    // meaning (configuredTarget already clamps it silently to
                    // the population size), so this fix makes the input match
                    // what the field can actually mean instead of accepting
                    // 150% with no explanation.
                    const raw = Math.max(0, parseInt(e.target.value, 10) || 0);
                    const v = rule.method === "percentage" ? Math.min(100, raw) : raw;
                    handleRuleChange(rule.stageKey, "value", v);
                  }}
                />

                <select
                  className="p3-plan-input"
                  aria-label={fieldAria(L.p3_plan_col_certscan_method, rule.stageKey)}
                  value={rule.certScanMethod}
                  disabled={fieldsDisabled}
                  onChange={(e) =>
                    handleRuleChange(rule.stageKey, "certScanMethod", e.target.value as StageSamplingRule[keyof StageSamplingRule])
                  }
                >
                  <option value="percentage">{L.p3_plan_method_percentage}</option>
                  <option value="exact">{L.p3_plan_method_exact}</option>
                </select>

                <input
                  type="number"
                  className="p3-plan-input num"
                  aria-label={fieldAria(L.p3_plan_col_certscan_value, rule.stageKey)}
                  value={
                    rule.certScanMethod === "percentage"
                      ? rule.certScanPercentage
                      : rule.certScanExactCount
                  }
                  min={0}
                  max={rule.certScanMethod === "percentage" ? 100 : undefined}
                  disabled={fieldsDisabled}
                  onChange={(e) => {
                    // Clamp: a typed negative percentage reached
                    // stagePortDraw as a negative cert target, and
                    // drawWithoutReplacement's `slice(0, negative)` then
                    // drew ALL BUT the last N cert rows — a massive
                    // silent overdraw with no shortfall recorded. Pure
                    // input sanitation: every config valid today draws
                    // byte-identically, so no algorithm-version bump. The
                    // upper clamp on the percentage method is the same fix
                    // applied to the value input above (Fix, 2026-08-18).
                    const raw = Math.max(0, parseInt(e.target.value, 10) || 0);
                    if (rule.certScanMethod === "percentage") {
                      handleRuleChange(rule.stageKey, "certScanPercentage", Math.min(100, raw));
                    } else {
                      handleRuleChange(rule.stageKey, "certScanExactCount", raw);
                    }
                  }}
                />

                <span className="num p3-plan-expected">
                  <strong>{formatNumber(finalCount)}</strong>
                  {floorOverridden && (
                    <span className="p3-plan-instead">
                      {fillTemplate(L.p3_plan_expected_instead_of, { entered: formatNumber(calculatedCount) })}
                    </span>
                  )}
                </span>

                <span className="p3-plan-status">
                  {(rule.isLocked || isAutoLocked) ? (
                    <button
                      type="button"
                      className={`p3-lock-pill${isAutoLocked ? " auto" : ""}${isAdminUnlocked ? " open" : ""}`}
                      // Render-time gate matching the handler check: this button previously
                      // always rendered enabled regardless of canUnlock and only rejected via
                      // alert() on click (audit: cluster A). Disabled state now reflects
                      // canUnlock, and the denial is explained via `title`.
                      disabled={!canUnlock}
                      title={
                        !canUnlock
                          ? "لا تملك صلاحية إلغاء قفل مراحل العينة."
                          : isAutoLocked
                          ? "مقفل تلقائياً — يتطلب صلاحية إلغاء القفل"
                          : ""
                      }
                      onClick={() => {
                        if (!canUnlock) return;
                        setIsAdminUnlocked(!isAdminUnlocked);
                      }}
                    >
                      {isAdminUnlocked
                        ? <><Unlock size={12} aria-hidden /> {L.p3_plan_status_unlocked}</>
                        : <><Lock size={12} aria-hidden /> {L.p3_plan_status_locked}</>}
                    </button>
                  ) : floorOverridden ? (
                    <span className="p3-status-pill warn">
                      {fillTemplate(L.p3_plan_status_floor, { minRequired: formatNumber(rule.minRequiredCount) })}
                    </span>
                  ) : (
                    <span className="p3-status-pill ok">{L.p3_plan_status_ok}</span>
                  )}
                  {insufficientPopulation && (
                    <span className="p3-status-pill warn">{L.p3_plan_status_insufficient}</span>
                  )}
                </span>
              </div>
            );
          })}

          <div className="p3-plan-row p3-plan-totals" role="row">
            <span>{L.p3_plan_totals_label}</span>
            <span className="num">{formatNumber(populationTotal)}</span>
            <span /><span /><span /><span />
            <strong className="num">{formatNumber(runningTotal)}</strong>
            <span />
          </div>
        </div>
      </div>

      <div className="p3-draw-row">
        {/* W14: the RNG seed edit control moved to إعدادات المعالجة (MappingSettingsModal,
            mode="processing") — this still drives the draw below via the sampleSeed prop,
            only its edit UI relocated. A compact read-only chip stays here so the
            operator can see which seed a draw will use / did use without leaving the page. */}
        <span className="p3-seed-chip">
          {L.p3_result_seed_label}: <code>{sampleSeed}</code>
          <span className="p3-seed-hint">{L.p3_result_seed_hint}</span>
        </span>

        <button
          type="button"
          className="primary-action"
          onClick={onDrawSample}
          // Not gated on populationRows.length === 0: under Phase A demand-gated loading,
          // an empty array here can mean "genuinely no population" OR "not loaded in this
          // view's scope yet" (see index.tsx's ensurePopulationLoaded) -- those look
          // identical from this component's props alone.
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

      {sampleDrawResult && (
        <SampleResultReport
          data={sampleDrawResult}
          canRedraw={canDrawSample && !isDrawingSample}
          onRedraw={onDrawSample}
        />
      )}
    </section>
  );
}

/**
 * Prominent post-draw shortfall banner (owner decision, 2026-08). The owner's
 * original experience was seeing "20" and "10" in the result with no
 * explanation — this names each affected stratum, what was requested vs. what
 * was actually drawn, and why (insufficient CertScan rows available), so that
 * gap can never again pass unnoticed.
 *
 * KEPT deliberately through the 2026-08 redesign: the handoff's "do not design
 * for a CertScan shortfall" note governs the MOCK's chosen state, not the
 * runtime. A real shortfall must still be reported — only the styling changed.
 */
function CertScanShortfallReport({ shortfalls }: { shortfalls: CertScanShortfall[] }) {
  if (shortfalls.length === 0) return null;
  const L = getLabels();
  return (
    <div className="p3-result-banner warn sample-certscan-shortfall-report" role="alert">
      <div className="p3-result-banner-title">
        <AlertTriangle size={15} aria-hidden />
        {L.sampling_certscan_shortfall_result_title}
      </div>
      <p className="p3-result-banner-note">{L.sampling_certscan_shortfall_result_intro}</p>
      {shortfalls.map((s, i) => (
        <p key={`${s.stageKey}-${s.portName ?? "stage"}-${i}`} className="p3-result-banner-row" role="alert">
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
 * all — they used to vanish with zero diagnostic on the success path.
 */
function UnmappedStageWarning({ data }: { data: SampleMasterData }) {
  const count = data.unmappedStageRowCount ?? 0;
  if (count <= 0) return null;
  const L = getLabels();
  return (
    <div className="p3-result-banner warn sampling-unmapped-stage-warning" role="alert">
      <div className="p3-result-banner-title">
        <AlertTriangle size={15} aria-hidden />
        {L.sampling_unmapped_stage_warning_title}
      </div>
      <p className="p3-result-banner-note">
        {fillTemplate(L.sampling_unmapped_stage_warning_intro, { count: formatNumber(count) })}
      </p>
      {(data.unmappedStageRawValues ?? []).length > 0 && (
        <p className="p3-result-banner-row">
          {L.sampling_unmapped_stage_warning_values_label}{" "}
          {(data.unmappedStageRawValues ?? []).join("، ")}
        </p>
      )}
    </div>
  );
}

function SampleResultReport({
  data,
  canRedraw,
  onRedraw,
}: {
  data: SampleMasterData;
  canRedraw: boolean;
  onRedraw: () => void;
}) {
  const L = getLabels();
  const shortfall = data.totalRequested - data.totalActual;
  return (
    <section className="p3-result-card sample-result-section" aria-label="نتائج العينة">
      <div className="p3-result-head">
        <h3>{L.p3_result_title}</h3>
        <span className="p3-status-pill ok">
          <CheckCircle2 size={12} aria-hidden /> {L.p3_result_saved_pill}
        </span>
        <span className="p3-result-meta">
          {new Date(data.drawnAt).toLocaleString("ar-SA-u-nu-latn")} · <code>{data.rngSeed}</code>
        </span>
        <button type="button" className="p3-redraw-btn" onClick={onRedraw} disabled={!canRedraw}>
          <RefreshCw size={13} aria-hidden /> {L.p3_result_redraw}
        </button>
      </div>

      <UnmappedStageWarning data={data} />
      <CertScanShortfallReport shortfalls={data.certScanShortfalls ?? []} />

      <div className="p3-result-tiles">
        <div className="p3-result-tile">
          <span className="p3-tile-label">{L.p3_result_tile_actual}</span>
          <strong className="p3-tile-value num">{formatNumber(data.totalActual)}</strong>
          <span className="p3-tile-note">
            {shortfall > 0
              ? fillTemplate(L.p3_result_tile_actual_note_short, { diff: formatNumber(shortfall) })
              : L.p3_result_tile_actual_note_match}
          </span>
        </div>
        <div className="p3-result-tile">
          <span className="p3-tile-label">{L.p3_result_tile_target}</span>
          <strong className="p3-tile-value num">{formatNumber(data.totalRequested)}</strong>
          <span className="p3-tile-note">{L.p3_result_tile_target_note}</span>
        </div>
        <div className="p3-result-tile">
          <span className="p3-tile-label">{L.p3_result_tile_certscan}</span>
          <strong className="p3-tile-value num">{formatNumber(data.certScanActual)}</strong>
          <span className="p3-tile-note">
            {fillTemplate(L.p3_result_tile_share_note, {
              percent: formatPercent(data.certScanActual, data.totalActual),
            })}
          </span>
        </div>
        <div className="p3-result-tile">
          <span className="p3-tile-label">{L.p3_result_tile_normal}</span>
          <strong className="p3-tile-value num">{formatNumber(data.nonCertScanActual)}</strong>
          <span className="p3-tile-note">
            {fillTemplate(L.p3_result_tile_share_note, {
              percent: formatPercent(data.nonCertScanActual, data.totalActual),
            })}
          </span>
        </div>
      </div>

      {(data.stageAllocations ?? []).length > 0 && (
        <div className="p3-result-table" role="table">
          <div className="p3-result-row p3-result-table-header" role="row">
            <span role="columnheader">{L.p3_plan_col_stage}</span>
            <span role="columnheader" className="num">{L.p3_plan_col_population}</span>
            <span role="columnheader" className="num">{L.p3_result_tile_target}</span>
            <span role="columnheader" className="num">{L.p3_result_tile_certscan}</span>
            <span role="columnheader" className="num">{L.p3_result_tile_normal}</span>
            <span role="columnheader" className="num">{L.p3_result_tile_actual}</span>
            <span role="columnheader">{L.p3_result_col_diff}</span>
          </div>
          {data.stageAllocations.map(s => {
            const diff = s.targetQuota - s.actualDrawn;
            return (
              <div key={s.stageKey} className="p3-result-row" role="row">
                <span>{s.stageLabel}</span>
                <span className="num">{formatNumber(s.populationSize)}</span>
                <span className="num">{formatNumber(s.targetQuota)}</span>
                <span className="num">{formatNumber(s.certScanDrawn)}</span>
                <span className="num">{formatNumber(s.nonCertScanDrawn)}</span>
                <strong className="num">{formatNumber(s.actualDrawn)}</strong>
                <span className={diff > 0 ? "p3-result-diff short" : "p3-result-diff done"}>
                  {diff > 0
                    ? fillTemplate(L.p3_result_diff_short, { diff: formatNumber(diff) })
                    : L.p3_result_diff_complete}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
