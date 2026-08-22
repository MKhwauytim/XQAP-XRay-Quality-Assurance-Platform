/**
 * DEV-ONLY — a deterministic workspace ACTION LOG for the simulated workspace.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `?sim=1` seeds a population, a sample, assignments, answers, a template and a
 * user roster, but nothing ever wrote a single `WorkspaceActionEntry`. The
 * admin Actions viewer (`user-management/actions`) therefore rendered
 * `0 من 0 سجل` in the simulation: its filter bar (actor / date range /
 * free-text / grouped type picker) drew fine and had literally nothing to
 * filter, so none of it was exercisable in a browser.
 *
 * ── Why this does NOT go through `appendWorkspaceAction` ───────────────────
 * The real writer is the right default and it is what every production call
 * site uses — but it stamps two fields ITSELF, from the wall clock and from
 * `crypto.randomUUID()`:
 *
 *     const fullEntry = { ...entry, id: createActionId(), at: new Date()… };
 *
 * A seed cannot supply either. `at` is the fatal one: the whole point of the
 * seed is a log spread across ~three weeks so the date-range filter narrows
 * meaningfully, and the writer can only ever produce "now". `id` is the same
 * problem one layer down — a random id makes "the log is identical across two
 * builds" unassertable, which is the determinism contract this whole simulated
 * workspace is built on (see `docs/development/SIMULATED_WORKSPACE.md`).
 *
 * So the ENTRIES are built here and the FILES are still written by the real
 * layer: the same `getAuditActionsDir` root, the same `actionsFileName` stem,
 * the same `WorkspaceActionUserLogFile` shape, the same `safeWriteJson` (no
 * envelope wrap — `appendWorkspaceAction` does not wrap either). Nothing about
 * the on-disk layout is re-derived here, so it cannot drift from the reader;
 * `simWorkspace.test.ts` proves the round trip through the real
 * `readWorkspaceActions`. A subsequent real `appendWorkspaceAction` picks these
 * files up as ordinary history and appends to them.
 *
 * ── Coherence ──────────────────────────────────────────────────────────────
 * Every `xrayImageId` an entry names is read back out of the seeded month, so
 * it exists in the population AND in the drawn sample AND is assigned to the
 * employee the entry attributes it to. Every username is a seeded managed
 * account (or the bootstrap admin). The only deliberate exceptions are the
 * subjects of `user-deleted` / `template-deleted`, which are absent BECAUSE
 * they were deleted — they are enumerated in `SIM_ACTION_RETIRED_SUBJECTS` so
 * the coherence test can allow exactly those and nothing else.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 * No `Math.random()`, no `Date.now()`, no `crypto.randomUUID()`. Ids are
 * `sim-act-NNNN` in emission order and every `at` is derived arithmetically
 * from `SIM_ACTION_LOG_FIRST_DAY`.
 */

import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { safeWriteJson } from "../data/storage/safeWrite";
import { getAuditActionsDir } from "../data/workspace/workspacePaths";
import { actionsFileName } from "../data/audit/auditPaths";
import type {
  WorkspaceActionEntry,
  WorkspaceActionType,
  WorkspaceActionUserLogFile,
} from "../data/audit/actionLog";
import { loadSampleMaster } from "../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../data/distribution/distributionStorage";
import { loadEmployeeAnswers } from "../data/answers/answerStorage";
import { loadMonthPopulationFinal } from "../data/population/populationStorage";
import type { PreparedPopulationRow } from "../data/population/populationTypes";

// ─── The clock ─────────────────────────────────────────────────────────────

/** First calendar day the seeded log covers (UTC). */
export const SIM_ACTION_LOG_FIRST_DAY = "2026-06-25";

/**
 * How many consecutive days the log spans: 2026-06-25 … 2026-07-15.
 *
 * Chosen so a test can pick an obviously "inner" window — `2026-07-01` …
 * `2026-07-07` is the natural one — and have real entries fall on BOTH sides of
 * it. A log that fits inside every plausible range cannot demonstrate that the
 * date filter narrows anything.
 */
export const SIM_ACTION_LOG_DAY_SPAN = 21;

const DAY_MS = 86_400_000;
/** Fixed literal, parsed once. Never `Date.now()`. */
const FIRST_SLOT_MS = Date.parse(`${SIM_ACTION_LOG_FIRST_DAY}T07:05:00.000Z`);
/** Gap between two entries on the same day; 21 slots stay inside the workday. */
const SLOT_MS = 11 * 60_000;

/** Days 0 and 1 are reserved for the month's setup actions. */
const ROTATION_FIRST_DAY = 2;
const ROTATION_DAYS = SIM_ACTION_LOG_DAY_SPAN - ROTATION_FIRST_DAY;
/**
 * Stride used to scatter the operational entries over the rotation window.
 * Coprime with `ROTATION_DAYS` (5 vs 19) so the cycle visits every day before
 * repeating — an in-order assignment would put every `answer-submitted` on the
 * same three days and leave the type picker and the date picker correlated.
 */
const ROTATION_STRIDE = 5;

// ─── Actors ────────────────────────────────────────────────────────────────

/**
 * The actors the seeded log attributes actions to, with the role stamped on
 * each entry. Every one is a seeded managed account except `admin`, which is
 * the bootstrap superuser.
 */
export const SIM_ACTION_ACTOR_ROLES: Readonly<Record<string, string>> = {
  admin: "admin",
  amonem: "manager",
  mkhuwaytim: "manager",
  malrogi: "supervisor",
  jalgahamdi: "employee",
  hihaloraini: "employee",
  saalhijji: "employee",
};

/**
 * Subjects that are deliberately NOT present in the seeded workspace.
 *
 * A `user-deleted` entry whose target still exists in the roster, or a
 * `template-deleted` entry whose target is still on disk, would be the
 * incoherent thing — the log records their removal. Enumerated so the
 * coherence test can allow exactly these two and keep failing on anything else.
 */
export const SIM_ACTION_RETIRED_SUBJECTS: readonly string[] = [
  "smubarak",
  "sim-inspection-template-legacy",
];

// ─── Spec → entry ──────────────────────────────────────────────────────────

type SimActionSpec = {
  actor: string;
  action: WorkspaceActionType;
  target?: string | null;
  details?: Record<string, string | number | boolean | null>;
  /** Workspace-wide action (users, backups, settings) — carries no month. */
  noMonth?: boolean;
  /** Pin to a specific day offset instead of taking a rotation slot. */
  day?: number;
};

/**
 * Per-employee row pools, all read back out of the seeded month so nothing here
 * can name a row that does not exist.
 */
type RowPools = {
  /** Assigned to this employee AND already submitted. */
  submitted: ReadonlyMap<string, readonly string[]>;
  /** Assigned AND saved as a draft. */
  draft: ReadonlyMap<string, readonly string[]>;
  /** Assigned with no answer record at all. */
  pending: ReadonlyMap<string, readonly string[]>;
  /** Population rows that the draw did NOT select — valid replacement rows. */
  offSample: readonly string[];
};

/** Cyclic pick — a pool is never empty here, and modulo keeps it that way. */
function pick(pool: readonly string[], index: number): string {
  return pool[index % pool.length];
}

function reviewersOf(pools: RowPools): string[] {
  return [...pools.submitted.keys()];
}

/**
 * Stamp ids and timestamps onto the ordered specs.
 *
 * Day assignment: an explicit `day`, or the next rotation slot. Within a day,
 * entries are 11 minutes apart in the order they were emitted, so every `at` in
 * the log is unique and the merge sort in `readWorkspaceActions` is total.
 */
function stampEntries(specs: readonly SimActionSpec[], monthFolderName: string): WorkspaceActionEntry[] {
  const usedSlots = new Map<number, number>();
  let rotation = 0;
  return specs.map((spec, index) => {
    let day = spec.day;
    if (day === undefined) {
      day = ROTATION_FIRST_DAY + ((rotation * ROTATION_STRIDE) % ROTATION_DAYS);
      rotation += 1;
    }
    const slot = usedSlots.get(day) ?? 0;
    usedSlots.set(day, slot + 1);
    return {
      id: `sim-act-${String(index + 1).padStart(4, "0")}`,
      at: new Date(FIRST_SLOT_MS + day * DAY_MS + slot * SLOT_MS).toISOString(),
      actor: spec.actor,
      actorRole: SIM_ACTION_ACTOR_ROLES[spec.actor] ?? "unknown",
      action: spec.action,
      monthFolderName: spec.noMonth ? null : monthFolderName,
      target: spec.target ?? null,
      ...(spec.details ? { details: spec.details } : {}),
    };
  });
}

// ─── The spec blocks ───────────────────────────────────────────────────────
// Split by area of the app — the same grouping the viewer's type picker uses —
// so it is visible at a glance that every group has entries to show.

/** Users & permissions. Workspace-wide: none of it belongs to a month. */
function userSpecs(): SimActionSpec[] {
  return [
    { actor: "admin", action: "user-created", target: "simguest", noMonth: true, day: 0,
      details: { role: "guest", displayName: "زائر المحاكاة", certScanLicense: false } },
    { actor: "admin", action: "user-updated", target: "malrogi", noMonth: true,
      details: { field: "hasCertScanLicense", enabled: true } },
    { actor: "admin", action: "user-updated", target: "jalgahamdi", noMonth: true,
      details: { field: "hasCertScanLicense", enabled: true } },
    { actor: "admin", action: "user-updated", target: "hihaloraini", noMonth: true,
      details: { field: "displayName", displayName: "حاتم العريني" } },
    { actor: "admin", action: "user-password-reset", target: "saalhijji", noMonth: true,
      details: { reason: "طلب المستخدم" } },
    { actor: "admin", action: "user-password-reset", target: "hihaloraini", noMonth: true,
      details: { reason: "نسيان كلمة المرور" } },
    // The subject is absent from the roster BECAUSE of this entry — see
    // SIM_ACTION_RETIRED_SUBJECTS.
    { actor: "admin", action: "user-deleted", target: "smubarak", noMonth: true,
      details: { role: "employee", reason: "انتهاء التكليف" } },
    { actor: "admin", action: "permission-changed", target: "reports", noMonth: true, day: 1,
      details: { role: "supervisor", access: "edit" } },
    { actor: "admin", action: "permission-changed", target: "archive", noMonth: true,
      details: { role: "guest", access: "view" } },
    { actor: "admin", action: "permission-changed", target: "reports/kpi", noMonth: true,
      details: { role: "manager", access: "edit" } },
    { actor: "admin", action: "permission-changed", target: "population", noMonth: true,
      details: { role: "employee", access: "view" } },
    { actor: "admin", action: "feature-permission-changed", target: "answer-on-behalf", noMonth: true, day: 1,
      details: { role: "supervisor", enabled: true } },
    { actor: "admin", action: "feature-permission-changed", target: "approve-referrals", noMonth: true,
      details: { role: "manager", enabled: true } },
    { actor: "admin", action: "feature-permission-changed", target: "export-reports", noMonth: true,
      details: { role: "supervisor", enabled: true } },
    { actor: "admin", action: "feature-permission-changed", target: "ew.reopenAnswer", noMonth: true,
      details: { role: "supervisor", enabled: false } },
  ];
}

/** Population → sample → distribution: the month's own setup trail. */
function pipelineSpecs(pools: RowPools, rngSeed: string): SimActionSpec[] {
  const reviewers = reviewersOf(pools);
  const specs: SimActionSpec[] = [
    { actor: "admin", action: "population-saved", day: 0,
      details: { rows: 320, removed: 0, duplicates: 0, overwrote: false } },
    { actor: "admin", action: "sample-drawn", day: 0,
      details: { seed: rngSeed, totalActual: 96 } },
    { actor: "admin", action: "distribution-bulk-assigned", day: 1,
      details: { events: 96, staleSkipped: 0 } },
  ];
  // A reassignment is recorded as the change that PRODUCED the current owner:
  // `to` is the employee the row is assigned to in the seeded distribution.
  reviewers.forEach((reviewer, i) => {
    const previous = reviewers[(i + 1) % reviewers.length];
    const rows = pools.pending.get(reviewer) ?? [];
    for (let n = 0; n < 2; n++) {
      specs.push({
        actor: n === 0 ? "admin" : "malrogi",
        action: "distribution-row-changed",
        target: pick(rows, n),
        details: { from: previous, to: reviewer, kind: "reassign" },
      });
    }
  });
  return specs;
}

/** Inspection templates. */
function templateSpecs(templateId: string): SimActionSpec[] {
  return [
    { actor: "admin", action: "template-created", target: templateId, noMonth: true, day: 0,
      details: { templateName: "نموذج فحص الجودة (محاكاة)", version: 1 } },
    { actor: "admin", action: "inspection-template-selected", target: templateId, noMonth: true, day: 0 },
    { actor: "admin", action: "template-updated", target: templateId, noMonth: true,
      details: { templateName: "نموذج فحص الجودة (محاكاة)", version: 1, field: "qualityImageResult" } },
    { actor: "malrogi", action: "template-updated", target: templateId, noMonth: true,
      details: { templateName: "نموذج فحص الجودة (محاكاة)", version: 1, field: "notes" } },
    { actor: "admin", action: "template-updated", target: templateId, noMonth: true,
      details: { templateName: "نموذج فحص الجودة (محاكاة)", version: 1, field: "result" } },
    // Retired subject: the id is gone from disk because of this entry.
    { actor: "admin", action: "template-deleted", target: "sim-inspection-template-legacy", noMonth: true },
    { actor: "malrogi", action: "inspection-template-selected", target: templateId, noMonth: true },
  ];
}

/**
 * Notifications. Every seeded notification id ends its trail DELETED, because
 * the seeded workspace holds no notification records — a `notification-posted`
 * for an id that is neither on disk nor accounted for would be a dangling
 * claim, and the log is what explains the absence.
 */
function notificationSpecs(): SimActionSpec[] {
  return [
    { actor: "amonem", action: "notification-posted", target: "sim-notif-001", noMonth: true,
      details: { target: "role", audience: 4, chars: 96 } },
    { actor: "amonem", action: "notification-edited", target: "sim-notif-001", noMonth: true,
      details: { target: "role", audience: 4, chars: 121 } },
    { actor: "mkhuwaytim", action: "notification-posted", noMonth: true,
      details: { reminderFor: "sim-notif-001", recipients: 3 } },
    { actor: "amonem", action: "notification-deleted", target: "sim-notif-001", noMonth: true },
    { actor: "mkhuwaytim", action: "notification-posted", target: "sim-notif-002", noMonth: true,
      details: { target: "users", audience: 2, chars: 58 } },
    { actor: "mkhuwaytim", action: "notification-deleted", target: "sim-notif-002", noMonth: true },
    { actor: "mkhuwaytim", action: "notification-restored", target: "sim-notif-002", noMonth: true },
    { actor: "admin", action: "notification-deleted", target: "sim-notif-002", noMonth: true },
    { actor: "amonem", action: "notification-posted", target: "sim-notif-003", noMonth: true,
      details: { target: "all", audience: 7, chars: 143 } },
    { actor: "mkhuwaytim", action: "notification-edited", target: "sim-notif-003", noMonth: true,
      details: { target: "all", audience: 7, chars: 150 } },
    { actor: "admin", action: "notification-deleted", target: "sim-notif-003", noMonth: true },
  ];
}

/**
 * Ad-hoc / exceptional-case imports. Same rule as notifications: each importId
 * runs created → … → closed, so nothing dangles as an open import the
 * workspace does not contain.
 */
function adhocSpecs(): SimActionSpec[] {
  return [
    { actor: "admin", action: "adhoc-import-created", target: "sim-adhoc-001", noMonth: true,
      details: { rows: 24, fileName: "حالات-استثنائية-يونيو.xlsx", kind: "assignable" } },
    { actor: "admin", action: "adhoc-rows-assigned", target: "sim-adhoc-001", noMonth: true,
      details: { assigned: 20, skipped: 4, leftover: 0 } },
    { actor: "admin", action: "adhoc-import-closed", target: "sim-adhoc-001", noMonth: true,
      details: { rows: 24 } },
    { actor: "admin", action: "adhoc-import-created", target: "sim-adhoc-002", noMonth: true,
      details: { rows: 11, fileName: "حالات-تاريخية.xlsx", kind: "historical" } },
    { actor: "admin", action: "adhoc-historical-imported", target: "sim-adhoc-002", noMonth: true,
      details: { imported: 9, skipped: 2 } },
    { actor: "admin", action: "adhoc-import-closed", target: "sim-adhoc-002", noMonth: true,
      details: { rows: 11 } },
    { actor: "admin", action: "adhoc-import-reopened", target: "sim-adhoc-002", noMonth: true,
      details: { rows: 11 } },
    { actor: "admin", action: "adhoc-rows-assigned", target: "sim-adhoc-002", noMonth: true,
      details: { assigned: 2, skipped: 0, leftover: 0 } },
    { actor: "admin", action: "adhoc-import-closed", target: "sim-adhoc-002", noMonth: true,
      details: { rows: 11 } },
  ];
}

/**
 * Months, backups and workspace settings.
 *
 * `month-closed` / `month-reopened` are pinned to the last two days: the seeded
 * month is left OPEN (`seedWorkspaceMonth` stops at `"distributed"`), so the
 * trail has to end on the reopen or it would claim a lock the workspace does
 * not have.
 */
function systemSpecs(): SimActionSpec[] {
  const kinds = ["sample", "distribution", "executive", "powerbi", "kpi", "designer"];
  const specs: SimActionSpec[] = [
    { actor: "admin", action: "backup-created", target: "backup-2026-06-28-0700", noMonth: true,
      details: { months: 1, failedVerification: 0, includeXlsxExports: true } },
    { actor: "admin", action: "backup-created", target: "backup-2026-07-05-0700", noMonth: true,
      details: { months: 1, failedVerification: 0, includeXlsxExports: false } },
    { actor: "amonem", action: "backup-created", target: "backup-2026-07-12-0700", noMonth: true,
      details: { months: 1, failedVerification: 1, includeXlsxExports: true } },
    { actor: "admin", action: "backup-restored", target: "backup-2026-06-28-0700", noMonth: true,
      details: { rollbackFolderName: "rollback-2026-07-06-0900", months: 1 } },
    { actor: "admin", action: "backup-settings-changed", noMonth: true, details: { frequency: "weekly" } },
    { actor: "amonem", action: "backup-settings-changed", noMonth: true, details: { frequency: "daily" } },
    { actor: "admin", action: "sync-interval-changed", noMonth: true, details: { seconds: 45 } },
    { actor: "admin", action: "sync-interval-changed", noMonth: true, details: { seconds: 90 } },
    { actor: "admin", action: "admin-account-changed", noMonth: true,
      details: { change: "allowUsernameLogin", sessionOnly: false } },
    { actor: "admin", action: "admin-account-changed", noMonth: true,
      details: { change: "passwordHash", sessionOnly: false } },
    { actor: "admin", action: "month-closed", day: SIM_ACTION_LOG_DAY_SPAN - 2,
      details: { note: "إقفال مؤقت للمراجعة" } },
    { actor: "admin", action: "month-reopened", day: SIM_ACTION_LOG_DAY_SPAN - 1 },
  ];
  kinds.forEach((kind, i) => {
    specs.push({
      actor: i % 2 === 0 ? "amonem" : "mkhuwaytim",
      action: "report-generated",
      details: { kind },
    });
  });
  return specs;
}

/**
 * Interface-label overrides — the second `HIGH_VOLUME_ACTION_TYPES` member, and
 * the cheap proof that the picker's default really does hide more than just
 * `answer-submitted`.
 */
function labelOverrideSpecs(): SimActionSpec[] {
  const keys = [
    "um_actions_tab_label",
    "um_actions_desc",
    "um_actions_refresh_btn",
    "um_actions_empty",
    "um_actions_no_match",
    "um_activity_desc",
    "um_activity_path",
    "um_actions_filter_reset",
  ];
  return keys.map((labelKey, i) => ({
    actor: "admin",
    action: "label-override-changed" as const,
    target: labelKey,
    noMonth: true,
    details: { mode: i % 3 === 2 ? "reset" : "set" },
  }));
}

/**
 * Answers.
 *
 * `answer-submitted` is emitted once per answer the seed actually submitted —
 * same actor, same row — so the highest-volume type in the log is also the most
 * verifiable one: every entry has a matching `ItemAnswer` on disk.
 */
function answerSpecs(pools: RowPools, templateId: string): SimActionSpec[] {
  const reviewers = reviewersOf(pools);
  const specs: SimActionSpec[] = [];
  for (const reviewer of reviewers) {
    for (const xrayImageId of pools.submitted.get(reviewer) ?? []) {
      specs.push({ actor: reviewer, action: "answer-submitted", target: xrayImageId, details: { templateId } });
    }
  }
  // A supervisor authoring someone else's assignment — deliberately NOT a
  // high-volume type, and the assignee it names owns the row it names.
  for (const reviewer of reviewers) {
    if (reviewer === "malrogi") continue;
    specs.push({
      actor: "malrogi",
      action: "answer-submitted-on-behalf",
      target: pick(pools.draft.get(reviewer) ?? [], 0),
      details: { assignee: reviewer, templateId },
    });
  }
  reviewers.forEach((reviewer, i) => {
    const submitted = pools.submitted.get(reviewer) ?? [];
    specs.push({
      actor: i % 3 === 2 ? "mkhuwaytim" : "malrogi",
      action: "answer-quality-note-set",
      target: pick(submitted, 2),
      details: { employee: reviewer, cleared: false },
    });
    specs.push({
      actor: "malrogi",
      action: "answer-quality-note-set",
      target: pick(submitted, 3),
      details: { employee: reviewer, cleared: i % 2 === 1 },
    });
    specs.push({
      actor: i === 3 ? "amonem" : "malrogi",
      action: "answer-reopened",
      target: pick(submitted, 1),
      details: { employee: reviewer, reason: "الصورة غير واضحة، يرجى إعادة التقييم" },
    });
  });
  return specs;
}

/** Referral / replacement / reopen — the approval-gated workflow. */
function workflowSpecs(pools: RowPools): SimActionSpec[] {
  const reviewers = reviewersOf(pools);
  const specs: SimActionSpec[] = [];
  const approvers = ["amonem", "mkhuwaytim"];

  // Referrals: the request's target is the receiving EMPLOYEE (that is what the
  // real call site records); the decision's target is the request id.
  reviewers.forEach((reviewer, i) => {
    const toEmployee = reviewers[(i + 1) % reviewers.length];
    for (let n = 0; n < 2; n++) {
      const requestId = `sim-ref-${i}${n}`;
      specs.push({
        actor: reviewer,
        action: "referral-requested",
        target: toEmployee,
        details: { requestId, samples: 3 + n, requests: 1, skipped: n, source: "referrals" },
      });
      const approved = (i + n) % 8 !== 3;
      specs.push({
        actor: approvers[(i + n) % approvers.length],
        action: approved ? "referral-approved" : "referral-denied",
        target: requestId,
        details: { samples: 3 + n, toEmployee, ...(approved ? {} : { reason: "خارج نطاق التكليف" }) },
      });
    }
  });

  // Replacements: `original` is a row the employee actually holds, `replacement`
  // a real population row the draw did not select.
  reviewers.forEach((reviewer, i) => {
    const pending = pools.pending.get(reviewer) ?? [];
    const requestId = `sim-rep-${i}`;
    specs.push({
      actor: reviewer,
      action: "replacement-requested",
      target: requestId,
      details: {
        original: pick(pending, 2),
        replacement: pick(pools.offSample, i),
        employee: reviewer,
      },
    });
    specs.push({
      actor: approvers[i % approvers.length],
      action: i === 2 ? "replacement-denied" : "replacement-approved",
      target: requestId,
      details: { employee: reviewer, ...(i === 2 ? { reason: "الصف الأصلي قابل للفحص" } : {}) },
    });
    if (i !== 2) {
      specs.push({
        actor: reviewer,
        action: "replacement-applied",
        target: pick(pending, 2),
        details: {
          replacement: pick(pools.offSample, i),
          employee: reviewer,
          reason: "الصورة مفقودة في الأرشيف",
        },
      });
    }
  });

  // Reopens: the request names the row, the decision names the request.
  reviewers.forEach((reviewer, i) => {
    const submitted = pools.submitted.get(reviewer) ?? [];
    const requestId = `sim-reo-${i}`;
    specs.push({
      actor: reviewer,
      action: "reopen-requested",
      target: pick(submitted, 4),
      details: { requestId, employee: reviewer, reason: "إدخال نتيجة خاطئة" },
    });
    specs.push({
      actor: approvers[i % approvers.length],
      action: i === 1 ? "reopen-denied" : "reopen-approved",
      target: requestId,
      details: { xrayImageId: pick(submitted, 4), employee: reviewer },
    });
  });

  specs.push({ actor: "amonem", action: "decision-reverted", target: "sim-ref-00", details: { kind: "referral" } });
  specs.push({ actor: "mkhuwaytim", action: "decision-reverted", target: "sim-reo-3", details: { kind: "reopen" } });
  return specs;
}

// ─── Reading the seeded month back ─────────────────────────────────────────

/**
 * Build the row pools from what the month seed actually wrote.
 *
 * Reading back rather than recomputing is the coherence guarantee: an id can
 * only reach the log if the population, the draw and the distribution fold all
 * agree it exists and belongs to the employee it is attributed to.
 */
async function readRowPools(
  handle: DirectoryHandleLike,
  monthFolderName: string,
  reviewers: readonly string[]
): Promise<RowPools | null> {
  const master = await loadSampleMaster(handle, monthFolderName);
  const sampleRows = (master?.rows ?? []) as PreparedPopulationRow[];
  if (sampleRows.length === 0) return null;

  const current = await loadOrDeriveDistributionCurrent(handle, monthFolderName, sampleRows);
  const assigned = new Map<string, string[]>();
  for (const entry of current?.entries ?? []) {
    const list = assigned.get(entry.assignedTo);
    if (list) list.push(entry.xrayImageId);
    else assigned.set(entry.assignedTo, [entry.xrayImageId]);
  }

  const submitted = new Map<string, string[]>();
  const draft = new Map<string, string[]>();
  const pending = new Map<string, string[]>();
  for (const reviewer of reviewers) {
    const own = assigned.get(reviewer) ?? [];
    if (own.length === 0) return null;
    const file = await loadEmployeeAnswers(handle, monthFolderName, reviewer);
    const byStatus = new Map(file.items.map((item) => [item.xrayImageId, item.status]));
    submitted.set(reviewer, own.filter((id) => byStatus.get(id) === "submitted"));
    draft.set(reviewer, own.filter((id) => byStatus.get(id) === "draft"));
    pending.set(reviewer, own.filter((id) => !byStatus.has(id)));
    if (
      submitted.get(reviewer)?.length === 0 ||
      draft.get(reviewer)?.length === 0 ||
      pending.get(reviewer)?.length === 0
    ) {
      return null;
    }
  }

  const population = await loadMonthPopulationFinal(handle, monthFolderName);
  const drawn = new Set(sampleRows.map((row) => row.xrayImageId));
  const offSample = ((population?.rows ?? []) as PreparedPopulationRow[])
    .map((row) => row.xrayImageId)
    .filter((id) => !drawn.has(id));
  if (offSample.length === 0) return null;

  return { submitted, draft, pending, offSample };
}

// ─── Writing ───────────────────────────────────────────────────────────────

/**
 * Write the entries out as per-actor live logs, exactly where and in exactly
 * the shape `appendWorkspaceAction` would have left them: one
 * `{stem}.actions.json` per actor under `5-system/audit/actions/`, ascending by
 * `at`, `revision` equal to the number of appends it represents.
 *
 * `_writeToken` is deliberately absent — it is a per-write casLoop artefact,
 * and the next real append mints its own and verifies that one, not this one.
 */
async function writePerActorLogs(
  handle: DirectoryHandleLike,
  entries: readonly WorkspaceActionEntry[]
): Promise<void> {
  const dir = await getAuditActionsDir(handle, true);
  const byActor = new Map<string, WorkspaceActionEntry[]>();
  for (const entry of entries) {
    const list = byActor.get(entry.actor);
    if (list) list.push(entry);
    else byActor.set(entry.actor, [entry]);
  }
  for (const [actor, list] of byActor) {
    const ordered = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const file: WorkspaceActionUserLogFile = {
      actor,
      revision: ordered.length,
      updatedAt: ordered[ordered.length - 1].at,
      entries: ordered,
    };
    await safeWriteJson(dir, actionsFileName(actor), file);
  }
}

export type SimActionLogOptions = {
  monthFolderName: string;
  /** The employees the month seed assigned rows to, in allocation order. */
  reviewers: readonly string[];
  templateId: string;
  rngSeed: string;
};

/**
 * Seed the simulated workspace's action log. Returns the number of entries
 * written, or 0 when the month seed did not produce the rows this needs (the
 * month seed is itself best-effort, and a partial workspace must not throw
 * here — the log is the least important thing in it).
 */
export async function seedSimulatedActionLog(
  handle: DirectoryHandleLike,
  options: SimActionLogOptions
): Promise<number> {
  const pools = await readRowPools(handle, options.monthFolderName, options.reviewers);
  if (!pools) return 0;

  const specs: SimActionSpec[] = [
    ...userSpecs(),
    ...pipelineSpecs(pools, options.rngSeed),
    ...templateSpecs(options.templateId),
    ...notificationSpecs(),
    ...adhocSpecs(),
    ...systemSpecs(),
    ...answerSpecs(pools, options.templateId),
    ...workflowSpecs(pools),
    ...labelOverrideSpecs(),
  ];

  const entries = stampEntries(specs, options.monthFolderName);
  await writePerActorLogs(handle, entries);
  return entries.length;
}
