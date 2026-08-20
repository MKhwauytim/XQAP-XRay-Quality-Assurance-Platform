import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import { isReferral, isReplacement, type CardRequest } from "./requestKind";

export type SampleDetail = DistributionEntry | PreparedPopulationRow;
export type SampleDetailMap = Record<string, SampleDetail>;

/** Waiting-time tone thresholds (SLA badge). Categorical, not a severity scale on
 *  the request itself — it only says how long a reviewer has left it sitting. */
export type WaitTone = "ok" | "warn" | "late";

export type WaitBadge = { days: number; tone: WaitTone; label: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between `requestedAt` and `now`, floored at 0 — a clock-skewed
 *  future timestamp reads as "today", never as a negative wait. */
export function waitingDays(requestedAt: string, now: number = Date.now()): number {
  const requested = new Date(requestedAt).getTime();
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.floor((now - requested) / MS_PER_DAY));
}

export function waitBadge(requestedAt: string, now: number = Date.now()): WaitBadge {
  const L = getLabels();
  const days = waitingDays(requestedAt, now);
  const tone: WaitTone = days >= 5 ? "late" : days >= 3 ? "warn" : "ok";
  const label =
    days === 0 ? L.approval_wait_today : days === 1 ? L.approval_wait_one_day : L.approval_wait_days.replace("{days}", String(days));
  return { days, tone, label };
}

/** One row of the detail pane's "بيانات العينة" table. */
export type DetailSampleRow = {
  xrayImageId: string;
  role?: string;
  roleTone?: "original" | "replacement";
  portName: string;
  stage: string;
  plate: string;
};

/** DistributionEntry carries the (smaller) employee-mirror stub under `row`;
 *  PreparedPopulationRow is the row itself. Both expose the three fields the
 *  table shows. */
function detailFields(
  detail: SampleDetail | undefined
): Pick<PreparedPopulationRow, "portName" | "stage" | "plateOrContainerNumber"> | undefined {
  if (!detail) return undefined;
  return "row" in detail ? detail.row : detail;
}

function sampleRow(id: string, details: SampleDetailMap, role?: DetailSampleRow["roleTone"]): DetailSampleRow {
  const L = getLabels();
  const fields = detailFields(details[id]);
  return {
    xrayImageId: id,
    role: role === "original" ? L.approval_role_original : role === "replacement" ? L.approval_role_replacement : undefined,
    roleTone: role,
    portName: fields?.portName ?? "—",
    stage: fields?.stage ?? "—",
    plate: fields?.plateOrContainerNumber ?? "—",
  };
}

export function detailSampleRows(request: CardRequest, details: SampleDetailMap): DetailSampleRow[] {
  if (isReferral(request)) return request.xrayImageIds.map((id) => sampleRow(id, details));
  if (isReplacement(request)) {
    return [
      sampleRow(request.originalXrayImageId, details, "original"),
      sampleRow(request.replacementXrayImageId, details, "replacement"),
    ];
  }
  return [sampleRow(request.xrayImageId, details)];
}

/** Headline shown on the queue card and again as the detail pane's title. */
export function requestTitle(request: CardRequest, displayName: (username: string) => string): string {
  if (isReferral(request)) return `${displayName(request.fromEmployee)} ← ${displayName(request.toEmployee)}`;
  if (isReplacement(request)) return `استبدال ${request.originalXrayImageId} بـ ${request.replacementXrayImageId}`;
  return `إعادة فتح الحالة ${request.xrayImageId}`;
}

/** "n عينة" line under the title. */
export function sampleSummary(request: CardRequest): string {
  const L = getLabels();
  if (isReferral(request)) return L.approval_samples_referral.replace("{count}", String(request.xrayImageIds.length));
  if (isReplacement(request)) return L.approval_samples_replacement;
  return L.approval_samples_reopen;
}

/** The employee the request is ABOUT — the receiving employee for a referral,
 *  the requesting employee for a replacement or reopen. */
export function affectedEmployee(request: CardRequest): string {
  if (isReferral(request)) return request.toEmployee;
  return request.employeeUsername;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
