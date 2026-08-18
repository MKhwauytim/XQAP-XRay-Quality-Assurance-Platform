import { Check, LockOpen } from "lucide-react";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import type { DistributionCurrentData } from "../../../../../data/distribution/distributionTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationAggregateLoadResult } from "../../../../../data/population/populationAggregate";
import type { MonthManifestData } from "../../../../../data/population/monthTypes";
import { SYSTEM_AUTO_LOCK_ACTOR } from "../../../../../data/population/monthLock";
import { getLabels } from "../../../../../data/labels/labelsStore";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import { PHASES } from "../populationWorkflowHelpers";
import { getPhaseStatus } from "./helpers";

/**
 * Owner requirement (2026-08-07): the closed-month banner distinguishes a
 * SYSTEM auto-lock (post-distribution, see `useDistributionActions.ts`'s
 * `autoLockWhenFullyDistributed`) from a PERSON manually closing the month,
 * and offers an admin unlock affordance right here (calls the pre-existing,
 * unmodified `reopenMonth` via the caller's `onUnlock`). Pulled out of
 * `PopulationTab` itself purely to stay under `check:complexity`'s
 * per-function complexity budget.
 */
export function ClosedMonthBanner({
  visible,
  manifest,
  canUnlock,
  isUnlocking,
  onUnlock
}: {
  visible: boolean;
  manifest: MonthManifestData | null;
  canUnlock: boolean;
  isUnlocking: boolean;
  onUnlock: () => void;
}) {
  if (!visible) return null;
  const labels = getLabels();
  const closedBy = manifest?.closedBy;
  const lockNote = closedBy === SYSTEM_AUTO_LOCK_ACTOR
    ? labels.msg_month_closed_note_auto_lock
    : closedBy
      ? labels.msg_month_closed_note_closed_by.replace("{user}", closedBy)
      : "";
  return (
    <div className="upload-warning" role="status">
      <span>{labels.msg_month_closed_banner} {lockNote}</span>
      {canUnlock && (
        <button
          type="button"
          className="header-settings-btn"
          style={{ marginInlineStart: 10 }}
          onClick={onUnlock}
          disabled={isUnlocking}
        >
          <LockOpen size={13} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
          {isUnlocking ? labels.archive_reopen_month_in_progress : labels.archive_reopen_month_btn}
        </button>
      )}
    </div>
  );
}

/**
 * Page header for the wizard. The 2026-08 handoff (section 2) makes the H1 the
 * CURRENT PHASE rather than a constant page name, with the page name demoted to
 * the eyebrow — so the header tells you where you are, not just what app you are
 * in. The settings buttons demote to the compact 34px treatment.
 */
export function PopulationHeader({
  currentPhase,
  canConfigure,
  onOpenSettings
}: {
  currentPhase: number;
  canConfigure: boolean;
  onOpenSettings: (mode: "mapping" | "processing") => void;
}) {
  const labels = getLabels();
  const phase = PHASES.find((entry) => entry.id === currentPhase) ?? PHASES[0]!;
  return (
    <PageHeader
      eyebrow={labels.pop_header_eyebrow}
      title={phase.title}
      subtitle={phase.description}
    >
      <div className="header-settings-stack">
        <button
          type="button"
          className="header-settings-btn"
          onClick={() => onOpenSettings("mapping")}
          aria-label={labels.pop_header_settings_mapping}
          disabled={!canConfigure}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          {labels.pop_header_settings_mapping}
        </button>
        <button
          type="button"
          className="header-settings-btn"
          onClick={() => onOpenSettings("processing")}
          aria-label={labels.pop_header_settings_processing}
          disabled={!canConfigure}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3v4"/><path d="M18 3v4"/><path d="M3 9h18"/><path d="M8 14h8"/><path d="M8 18h5"/><rect x="3" y="5" width="18" height="16" rx="2"/>
          </svg>
          {labels.pop_header_settings_processing}
        </button>
      </div>
    </PageHeader>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2026-08 handoff, section 2 — shared page chrome

   `PopulationReadinessRail` replaces the old `PopulationStatusBar` +
   `PopulationStepper` pair with ONE card: a facts strip on top, the four-node
   progress row beneath. `PhaseActionBar` replaces `PopulationPhaseFooter` with
   a sticky bar that also names the next step.

   Both read exactly the same inputs their predecessors did — this is a
   relayout, not a change to what the wizard knows or when it lets you advance.
   ═══════════════════════════════════════════════════════════════════════════ */

function formatCount(value: number): string {
  return value.toLocaleString("ar-SA-u-nu-latn");
}

type ReadinessFact = {
  key: string;
  label: string;
  value: string;
  /** Present = a real figure was found; absent = nothing there yet. */
  present: boolean;
};

function buildReadinessFacts(input: {
  month: number;
  year: number;
  population: PopulationProcessingResult | null;
  populationAggregate: PopulationAggregateLoadResult | null;
  sample: SampleMasterData | null;
  distribution: DistributionCurrentData | null;
  biWorkbook: BiWorkbookResult | null;
}): ReadinessFact[] {
  const labels = getLabels();
  const { month, year, population, populationAggregate, sample, distribution, biWorkbook } = input;

  // Same fallback the status bar used: on a locked month `population` is
  // deliberately never row-populated, so the aggregate summary is the source.
  const populationRowCount = population
    ? population.preparedRows.length
    : populationAggregate?.status === "ok"
      ? populationAggregate.aggregate.summary.finalPreparedPopulationRows
      : null;

  const assigned = distribution && distribution.totalAssigned > 0 ? distribution.totalAssigned : null;

  return [
    {
      key: "month",
      label: labels.pop_readiness_month,
      value: `${month}/${year}`,
      present: true,
    },
    {
      key: "population",
      label: labels.pop_readiness_population,
      value: populationRowCount !== null
        ? labels.pop_readiness_rows.replace("{count}", formatCount(populationRowCount))
        : labels.pop_readiness_absent,
      present: populationRowCount !== null,
    },
    {
      key: "sample",
      label: labels.pop_readiness_sample,
      value: sample
        ? labels.pop_readiness_items.replace("{count}", formatCount(sample.totalActual))
        : labels.pop_readiness_absent,
      present: Boolean(sample),
    },
    {
      key: "distribution",
      label: labels.pop_readiness_distribution,
      value: assigned !== null
        ? labels.pop_readiness_assigned.replace("{count}", formatCount(assigned))
        : labels.pop_readiness_absent,
      present: assigned !== null,
    },
    {
      key: "bi",
      label: labels.pop_readiness_bi,
      value: biWorkbook
        ? labels.pop_readiness_rows.replace("{count}", formatCount(biWorkbook.totalNormalizedRows))
        : labels.pop_readiness_bi_absent,
      present: Boolean(biWorkbook),
    },
  ];
}

export function PopulationReadinessRail({
  month,
  year,
  population,
  populationAggregate = null,
  sample,
  distribution,
  biWorkbook,
  isMonthClosed,
  currentPhase,
  completedPhaseIds,
  onSelectPhase
}: {
  month: number;
  year: number;
  population: PopulationProcessingResult | null;
  populationAggregate?: PopulationAggregateLoadResult | null;
  sample: SampleMasterData | null;
  distribution: DistributionCurrentData | null;
  biWorkbook: BiWorkbookResult | null;
  isMonthClosed: boolean;
  currentPhase: number;
  completedPhaseIds: number[];
  onSelectPhase: (phase: number) => void;
}) {
  const labels = getLabels();
  const facts = buildReadinessFacts({
    month, year, population, populationAggregate, sample, distribution, biWorkbook,
  });

  // The connector fills up to the node BEFORE the current one, so phase 1 shows
  // an empty track and phase 4 shows three quarters — progress made, not the
  // phase you are standing on.
  const progressPercent = ((currentPhase - 1) / PHASES.length) * 100;

  return (
    <section className="pop-readiness" aria-label={labels.pop_readiness_aria}>
      <div className="pop-readiness-strip">
        <span className="pop-readiness-strip-label">{labels.pop_readiness_title}</span>
        <div className="pop-readiness-facts">
          {facts.map((fact) => (
            <span key={fact.key} className="pop-readiness-fact">
              {fact.label}
              <strong className={`pop-readiness-fact-value${fact.present ? " is-present" : ""}`}>
                {fact.value}
              </strong>
            </span>
          ))}
        </div>
        <span className={`pop-readiness-month-pill${isMonthClosed ? " is-closed" : ""}`}>
          {isMonthClosed ? labels.pop_readiness_month_closed : labels.pop_readiness_month_open}
        </span>
      </div>

      <nav className="pop-readiness-steps" aria-label={labels.pop_stepper_aria}>
        <span className="pop-readiness-connector" aria-hidden="true">
          <span className="pop-readiness-connector-fill" style={{ width: `${progressPercent}%` }} />
        </span>
        {PHASES.map((phase) => {
          const status = getPhaseStatus(phase.id, currentPhase, completedPhaseIds);
          const clickable = status === "completed" || status === "active";
          const stateLine =
            status === "completed" ? labels.pop_step_state_done
            : status === "active" ? labels.pop_step_state_current
            : labels.pop_step_state_future;
          return (
            <button
              key={phase.id}
              type="button"
              className={`pop-readiness-step is-${status}`}
              aria-current={status === "active" ? "step" : undefined}
              // A locked phase renders as a real disabled button rather than a
              // click-swallowing div: it stays announced, and is never focusable
              // while inert.
              disabled={!clickable}
              onClick={() => onSelectPhase(phase.id)}
            >
              <span className="pop-readiness-node" aria-hidden="true">
                {status === "completed" ? <Check size={15} /> : phase.id}
              </span>
              <span className="pop-readiness-step-text">
                <strong className="pop-readiness-step-title">{phase.title}</strong>
                <span className="pop-readiness-step-state">{stateLine}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}

export function PhaseActionBar({
  currentPhase,
  hint,
  busy,
  reading,
  nextDisabled,
  onPrevious,
  onNext
}: {
  currentPhase: number;
  hint: string;
  busy: boolean;
  reading: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const labels = getLabels();
  const isFinalPhase = currentPhase >= PHASES.length;
  return (
    <footer className="pop-action-bar" aria-label={labels.pop_action_bar_aria}>
      <span className="pop-action-bubble" aria-hidden="true">
        {isFinalPhase ? <Check size={14} /> : currentPhase + 1}
      </span>
      <p className="pop-action-next">
        <strong>{isFinalPhase ? labels.pop_action_all_done : labels.pop_action_next_step_label}</strong>
        {!isFinalPhase && <span>{hint}</span>}
      </p>
      <button
        type="button"
        className="pop-action-secondary"
        onClick={onPrevious}
        disabled={currentPhase === 1 || busy}
      >
        {labels.pop_action_previous}
      </button>
      {!isFinalPhase && (
        <button type="button" className="pop-action-primary" onClick={onNext} disabled={nextDisabled}>
          {reading ? labels.pop_action_reading : labels.pop_action_next}
        </button>
      )}
    </footer>
  );
}
