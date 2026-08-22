/**
 * Presentation catalogue for the workspace action log, plus the pure filter the
 * Actions viewer runs.
 *
 * Kept out of `AuditSections.tsx` on purpose. The filter is the part with real
 * behaviour (four independent predicates that must compose, a date range that
 * has to survive an unparseable `at`, a free-text pass over a `details` object
 * of mixed primitives), and a `node`-environment unit test over a plain
 * function is a far cheaper and sharper way to pin that than driving it through
 * a rendered table. The component keeps only the controls.
 *
 * `ACTION_TYPE_LABEL_KEYS` and `ACTION_TYPE_GROUPS` are both exhaustive over
 * `WorkspaceActionType` — the first by its `Record<...>` type, the second by a
 * test that flattens the groups and compares them to the label map's keys. A
 * new action type therefore cannot ship without a label AND a group: it would
 * otherwise render its raw English id to an Arabic-only reader, or silently
 * vanish from the type picker (and, because the picker drives the filter, from
 * the log itself).
 */

import {
  ALL_ACTION_TYPES,
  type WorkspaceActionEntry,
  type WorkspaceActionType,
} from "../../../../data/audit/actionLog";
import type { LabelKey } from "../../../../data/labels/labelsStore";

export const ACTION_TYPE_LABEL_KEYS: Record<WorkspaceActionType, LabelKey> = {
  "user-deleted": "um_action_type_user_deleted",
  "user-created": "um_action_type_user_created",
  "user-updated": "um_action_type_user_updated",
  "user-password-reset": "um_action_type_user_password_reset",
  "permission-changed": "um_action_type_permission_changed",
  "feature-permission-changed": "um_action_type_feature_permission_changed",
  "population-saved": "um_action_type_population_saved",
  "sample-drawn": "um_action_type_sample_drawn",
  "distribution-bulk-assigned": "um_action_type_distribution_bulk_assigned",
  "distribution-row-changed": "um_action_type_distribution_row_changed",
  "referral-requested": "um_action_type_referral_requested",
  "referral-approved": "um_action_type_referral_approved",
  "referral-denied": "um_action_type_referral_denied",
  "replacement-requested": "um_action_type_replacement_requested",
  "replacement-applied": "um_action_type_replacement_applied",
  "replacement-approved": "um_action_type_replacement_approved",
  "replacement-denied": "um_action_type_replacement_denied",
  "reopen-requested": "um_action_type_reopen_requested",
  "reopen-approved": "um_action_type_reopen_approved",
  "reopen-denied": "um_action_type_reopen_denied",
  "decision-reverted": "um_action_type_decision_reverted",
  "answer-submitted": "um_action_type_answer_submitted",
  "answer-submitted-on-behalf": "um_action_type_answer_submitted_on_behalf",
  "answer-quality-note-set": "um_action_type_answer_quality_note_set",
  "answer-reopened": "um_action_type_answer_reopened",
  "adhoc-import-created": "um_action_type_adhoc_import_created",
  "adhoc-rows-assigned": "um_action_type_adhoc_rows_assigned",
  "adhoc-historical-imported": "um_action_type_adhoc_historical_imported",
  "adhoc-import-closed": "um_action_type_adhoc_import_closed",
  "adhoc-import-reopened": "um_action_type_adhoc_import_reopened",
  "template-created": "um_action_type_template_created",
  "template-updated": "um_action_type_template_updated",
  "template-deleted": "um_action_type_template_deleted",
  "inspection-template-selected": "um_action_type_inspection_template_selected",
  "notification-posted": "um_action_type_notification_posted",
  "notification-edited": "um_action_type_notification_edited",
  "notification-deleted": "um_action_type_notification_deleted",
  "notification-restored": "um_action_type_notification_restored",
  "month-closed": "um_action_type_month_closed",
  "month-reopened": "um_action_type_month_reopened",
  "backup-created": "um_action_type_backup_created",
  "backup-restored": "um_action_type_backup_restored",
  "backup-settings-changed": "um_action_type_backup_settings_changed",
  "label-override-changed": "um_action_type_label_override_changed",
  "sync-interval-changed": "um_action_type_sync_interval_changed",
  "admin-account-changed": "um_action_type_admin_account_changed",
  "report-generated": "um_action_type_report_generated",
};

export type ActionTypeGroup = {
  titleKey: LabelKey;
  types: readonly WorkspaceActionType[];
};

/**
 * Grouped by the part of the app the action came from, which is how a reader
 * actually asks the question ("what happened to the templates?", "what did the
 * reviewers do?") — not by severity, which nothing in this domain ranks.
 */
export const ACTION_TYPE_GROUPS: readonly ActionTypeGroup[] = [
  {
    titleKey: "um_actions_group_users",
    types: [
      "user-created",
      "user-updated",
      "user-password-reset",
      "user-deleted",
      "permission-changed",
      "feature-permission-changed",
    ],
  },
  {
    titleKey: "um_actions_group_population",
    types: ["population-saved", "sample-drawn", "distribution-bulk-assigned", "distribution-row-changed"],
  },
  {
    titleKey: "um_actions_group_workflow",
    types: [
      "referral-requested",
      "referral-approved",
      "referral-denied",
      "replacement-requested",
      "replacement-applied",
      "replacement-approved",
      "replacement-denied",
      "reopen-requested",
      "reopen-approved",
      "reopen-denied",
      "decision-reverted",
    ],
  },
  {
    titleKey: "um_actions_group_answers",
    types: [
      "answer-submitted",
      "answer-submitted-on-behalf",
      "answer-quality-note-set",
      "answer-reopened",
    ],
  },
  {
    titleKey: "um_actions_group_adhoc",
    types: [
      "adhoc-import-created",
      "adhoc-rows-assigned",
      "adhoc-historical-imported",
      "adhoc-import-closed",
      "adhoc-import-reopened",
    ],
  },
  {
    titleKey: "um_actions_group_templates",
    types: [
      "template-created",
      "template-updated",
      "template-deleted",
      "inspection-template-selected",
    ],
  },
  {
    titleKey: "um_actions_group_notifications",
    types: [
      "notification-posted",
      "notification-edited",
      "notification-deleted",
      "notification-restored",
    ],
  },
  {
    titleKey: "um_actions_group_system",
    types: [
      "month-closed",
      "month-reopened",
      "backup-created",
      "backup-restored",
      "backup-settings-changed",
      "label-override-changed",
      "sync-interval-changed",
      "admin-account-changed",
      "report-generated",
    ],
  },
];

export type ActionLogFilter = {
  /** Selected action types. An empty set matches NOTHING (every box unchecked). */
  types: ReadonlySet<WorkspaceActionType>;
  /** Exact actor match, or "" for every actor. */
  actor: string;
  /** Inclusive `YYYY-MM-DD` bounds; "" disables that end. */
  from: string;
  to: string;
  /** Case-insensitive substring over target + details + month folder. */
  search: string;
};

/** The day an entry belongs to, as `YYYY-MM-DD`, or "" when `at` is unusable. */
function entryDay(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * The haystack the free-text box searches: target, month folder, and every
 * key AND value of `details`.
 *
 * Keys are included deliberately — `details` is the only place an entry records
 * what it is about ("employee", "samples", "seed"), and a reader hunting for
 * "seed" has no other handle on it. Values are stringified rather than
 * JSON-encoded so a search for `sara` matches `{ employee: "sara" }` without
 * the reader having to know about quoting.
 */
function searchHaystack(entry: WorkspaceActionEntry): string {
  const parts: string[] = [entry.target ?? "", entry.monthFolderName ?? ""];
  if (entry.details) {
    for (const [key, value] of Object.entries(entry.details)) {
      parts.push(key, value === null ? "" : String(value));
    }
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Apply every filter dimension at once. The dimensions compose by AND: an entry
 * survives only if it passes all four, so narrowing one never widens another.
 *
 * Input order is preserved — the caller sorts.
 */
export function filterActionEntries(
  entries: readonly WorkspaceActionEntry[],
  filter: ActionLogFilter
): WorkspaceActionEntry[] {
  const search = filter.search.trim().toLowerCase();
  const actor = filter.actor.trim();
  return entries.filter((entry) => {
    if (!filter.types.has(entry.action)) return false;
    if (actor !== "" && entry.actor !== actor) return false;
    if (filter.from !== "" || filter.to !== "") {
      const day = entryDay(entry.at);
      // An entry with an unparseable timestamp cannot be placed on the
      // timeline, so it is excluded from a date-bounded view rather than
      // silently kept — a reader who asked for "this week" must not be handed a
      // row that may belong to any week at all.
      if (day === "") return false;
      if (filter.from !== "" && day < filter.from) return false;
      if (filter.to !== "" && day > filter.to) return false;
    }
    if (search !== "" && !searchHaystack(entry).includes(search)) return false;
    return true;
  });
}

/** Distinct actors present in the log, sorted for a stable picker. */
export function actorsInLog(entries: readonly WorkspaceActionEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.actor).filter((a) => a !== ""))].sort((a, b) =>
    a.localeCompare(b, "ar")
  );
}

/** True when the filter is narrower than "everything" — drives the active badge. */
export function isFilterActive(filter: ActionLogFilter): boolean {
  return (
    filter.types.size !== ALL_ACTION_TYPES.length ||
    filter.actor.trim() !== "" ||
    filter.from !== "" ||
    filter.to !== "" ||
    filter.search.trim() !== ""
  );
}
