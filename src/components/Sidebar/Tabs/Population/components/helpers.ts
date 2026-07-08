export { formatNumber } from "../../../../../utils/formatting";

// Domain stage helpers live in src/data; imported here for use in UI helpers
// and re-exported so component consumers keep their import paths unchanged.
import {
  getStageKey,
  formatStageLabel,
  createEmptyStageCounts,
} from "../../../../../data/population/stageHelpers";
import type {
  StageCounts,
  StageKey,
  StageAliasMappings,
} from "../../../../../data/population/stageHelpers";

export type { StageCounts, StageKey, StageAliasMappings };
export { getStageKey, formatStageLabel, createEmptyStageCounts };

export type PhaseStatus = "available" | "locked" | "completed" | "active";

export function formatPercentage(value: number): string {
  return `${value.toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} بايت`;
  }

  const sizeInKilobytes = sizeInBytes / 1024;

  if (sizeInKilobytes < 1024) {
    return `${sizeInKilobytes.toFixed(1)} كيلوبايت`;
  }

  const sizeInMegabytes = sizeInKilobytes / 1024;
  return `${sizeInMegabytes.toFixed(2)} ميجابايت`;
}

export function getPhaseStatus(
  phaseId: number,
  currentPhase: number,
  completedPhaseIds: number[]
): PhaseStatus {
  if (completedPhaseIds.includes(phaseId)) {
    return "completed";
  }

  if (phaseId === currentPhase) {
    return "active";
  }

  if (phaseId < currentPhase) {
    return "available";
  }

  return "locked";
}
