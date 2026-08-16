/**
 * Stable, human-quotable error codes.
 *
 * A user who hits a failure should be able to read one short token off the
 * screen — "XQ-WS-006" — and have us land on the exact line that produced it.
 * That only works if a code means the same thing forever, so:
 *
 * **THE CATALOG IS APPEND-ONLY. NEVER RENUMBER, NEVER REUSE, NEVER REPURPOSE.**
 *
 * - Adding a failure site? Take the next free number in its area.
 * - Deleting a failure site? Leave the entry in place (mark it retired in its
 *   `meaning`). A gap is free; a recycled code makes every historical support
 *   report lie about what happened.
 * - Renaming an area or resequencing "to tidy up" is the same defect.
 *
 * `errorCodes.test.ts` pins the whole code → meaning map, so any renumbering,
 * reuse or silent redefinition fails CI rather than shipping.
 *
 * Shape: `XQ-<AREA>-<NNN>`.
 *
 * | Area   | Scope                                                       |
 * |--------|-------------------------------------------------------------|
 * | `WS`   | Workspace open / create / reconnect (`WorkspaceProvider`)    |
 * | `FS`   | File System Access primitives (`fileSystemAccess.ts`)       |
 * | `IO`   | safeWrite / safeRead / compressed envelope / columnar        |
 * | `AUTH` | Login, session, permissions                                  |
 * | `POP`  | Population import / processing / save                        |
 * | `DIST` | Distribution and its event log                               |
 * | `SMP`  | Sampling and the draw                                        |
 *
 * Each entry carries an English **meaning** (for us, in the log and in this
 * file) and a **labelKey** pointing at the Arabic user-facing sentence in
 * `DEFAULT_LABELS` (so it stays overridable from Settings like every other
 * string in the app).
 */

import { getLabels, type LabelKey } from "../labels/labelsStore";
import { logError } from "./errorLogger";

export type ErrorArea = "WS" | "FS" | "IO" | "AUTH" | "POP" | "DIST" | "SMP";

export type ErrorCodeEntry = {
  /** English technical meaning — for the error log and for us. Never shown raw. */
  readonly meaning: string;
  /** Key of the Arabic user-facing sentence in `DEFAULT_LABELS`. */
  readonly labelKey: LabelKey;
};

export const ERROR_CODES = {
  // ── WS: workspace open / create / reconnect ──────────────────────────────
  "XQ-WS-001": {
    meaning: "selectWorkspace: File System Access API unsupported in this browser",
    labelKey: "err_ws_001_unsupported_browser",
  },
  "XQ-WS-002": {
    meaning: "selectWorkspace: directory picker dismissed by the user (AbortError)",
    labelKey: "err_ws_002_picker_dismissed",
  },
  "XQ-WS-003": {
    meaning: "selectWorkspace: showDirectoryPicker or the structure check threw",
    labelKey: "err_ws_003_select_failed",
  },
  "XQ-WS-004": {
    meaning: "createInitialStructure: invoked with no directory handle selected",
    labelKey: "err_ws_004_no_handle_for_create",
  },
  "XQ-WS-005": {
    meaning: "createInitialStructure step 1/3: createWorkspaceStructure threw",
    labelKey: "err_ws_005_create_structure_step",
  },
  "XQ-WS-006": {
    meaning: "createInitialStructure step 2/3: checkWorkspaceStructure threw",
    labelKey: "err_ws_006_check_structure_step",
  },
  "XQ-WS-007": {
    meaning: "createInitialStructure step 3/3: loadWorkspaceFiles threw",
    labelKey: "err_ws_007_load_files_step",
  },
  "XQ-WS-008": {
    meaning: "reconnectWorkspace: no remembered workspace on record",
    labelKey: "err_ws_008_no_remembered_workspace",
  },
  "XQ-WS-009": {
    meaning: "reconnectWorkspace: readwrite permission was not granted",
    labelKey: "wsgate_picker_reconnect_msg",
  },
  "XQ-WS-010": {
    meaning: "reconnectWorkspace: reconnect threw",
    labelKey: "wsgate_picker_reconnect_msg",
  },
  "XQ-WS-011": {
    meaning: "reloadWorkspace: no directory handle mounted",
    labelKey: "err_ws_011_no_handle_for_reload",
  },
  "XQ-WS-012": {
    meaning: "reloadWorkspace: re-check or file load threw",
    labelKey: "err_ws_012_reload_failed",
  },
  "XQ-WS-013": {
    meaning: "refreshPermissions: loadWorkspaceFiles threw",
    labelKey: "err_ws_013_refresh_permissions_failed",
  },
  "XQ-WS-014": {
    meaning: "restore-on-mount: reading or restoring the remembered workspace threw",
    labelKey: "err_ws_014_restore_failed",
  },
  "XQ-WS-015": {
    meaning: "restore-on-mount: remembered handle's readwrite grant is not 'granted'",
    labelKey: "wsgate_picker_reconnect_msg",
  },
  "XQ-WS-016": {
    meaning: "enterDemoWorkspace: building the in-memory demo workspace threw",
    labelKey: "err_ws_016_demo_failed",
  },
  "XQ-WS-017": {
    meaning: "runtime: workspace write permission was lost after mount",
    labelKey: "err_ws_017_permission_lost",
  },
  "XQ-WS-018": {
    meaning: "createInitialStructure: failed outside the three instrumented steps",
    labelKey: "err_ws_018_create_unclassified",
  },

  // ── FS: File System Access primitives ────────────────────────────────────
  "XQ-FS-001": {
    meaning: "selectWorkspaceDirectory: window.showDirectoryPicker is unavailable",
    labelKey: "err_fs_001_picker_unavailable",
  },
  "XQ-FS-002": {
    meaning: "checkWorkspaceStructure: read permission on the folder was denied",
    labelKey: "err_fs_002_read_permission_denied",
  },
  "XQ-FS-003": {
    meaning: "checkWorkspaceStructure: required folders/files are missing",
    labelKey: "err_fs_003_missing_structure",
  },
  "XQ-FS-004": {
    meaning: "checkWorkspaceStructure: files present but invalid or schema-incompatible",
    labelKey: "err_fs_004_invalid_structure",
  },
  "XQ-FS-005": {
    meaning: "createWorkspaceStructure: readwrite permission was not granted",
    labelKey: "err_fs_005_write_permission_denied",
  },
  "XQ-FS-006": {
    meaning: "createWorkspaceStructure: creating a top-level workspace folder failed",
    labelKey: "err_fs_006_create_top_folders",
  },
  "XQ-FS-007": {
    meaning: "createWorkspaceStructure: creating a system subfolder (locks/audit/backups) failed",
    labelKey: "err_fs_007_create_system_folders",
  },
  "XQ-FS-008": {
    meaning: "createWorkspaceStructure: writing workspace.manifest.json failed",
    labelKey: "err_fs_008_write_manifest",
  },
  "XQ-FS-009": {
    meaning: "createWorkspaceStructure: writing users.permissions.json failed",
    labelKey: "err_fs_009_write_users_permissions",
  },
  "XQ-FS-010": {
    meaning: "createWorkspaceStructure: schema detection or stamping workspace.schema.json failed",
    labelKey: "err_fs_010_schema_stamp",
  },
  "XQ-FS-011": {
    meaning: "readJsonFile: file not found",
    labelKey: "err_fs_011_file_missing",
  },
  "XQ-FS-012": {
    meaning: "readJsonFile: file content is not valid JSON",
    labelKey: "err_fs_012_invalid_json",
  },
  "XQ-FS-013": {
    meaning: "readJsonFile: permission denied while reading the file",
    labelKey: "err_fs_013_read_permission_denied",
  },
  "XQ-FS-014": {
    meaning: "readJsonFile: read failed for an unclassified reason",
    labelKey: "err_fs_014_read_failed",
  },

  // ── IO: safeWrite / compressed envelope ──────────────────────────────────
  "XQ-IO-001": {
    meaning: "writeText: file handle exposes no createWritable (read-only handle or unsupported browser)",
    labelKey: "err_io_001_no_createwritable",
  },
  "XQ-IO-002": {
    meaning: "streamToFile: file handle exposes no createWritable",
    labelKey: "err_io_002_no_createwritable_stream",
  },
  "XQ-IO-003": {
    meaning: "openBinaryWritable: file handle exposes no createWritable",
    labelKey: "err_io_003_no_createwritable_binary",
  },
  "XQ-IO-004": {
    meaning: "copyFileStreamed: the source file disappeared before it could be copied",
    labelKey: "err_io_004_copy_source_missing",
  },
  "XQ-IO-005": {
    meaning: "copyFileBytes: the source file disappeared before it could be copied",
    labelKey: "err_io_005_copy_bytes_source_missing",
  },
  "XQ-IO-006": {
    meaning: "safeWriteJson (small path): staged .tmp did not match the bytes we wrote",
    labelKey: "err_io_006_staging_failed",
  },
  "XQ-IO-007": {
    meaning: "safeWriteJson (streamed path): staged .tmp failed byte-exact verification",
    labelKey: "err_io_007_staging_failed_streamed",
  },
  "XQ-IO-008": {
    meaning: "safeWriteJson (compressed path): staged .tmp failed byte-exact verification",
    labelKey: "err_io_008_staging_failed_compressed",
  },
  "XQ-IO-009": {
    meaning: "safeWriteJson: commit verification failed; rolled back to the .bak snapshot",
    labelKey: "err_io_009_commit_rolled_back",
  },
  "XQ-IO-010": {
    meaning: "safeWriteJson: commit verification failed with no usable .bak; staged copy kept as .tmp",
    labelKey: "err_io_010_commit_tmp_kept",
  },
  "XQ-IO-011": {
    meaning: "safeWriteJson (compressed): commit verification failed; rolled back to the .bak snapshot",
    labelKey: "err_io_011_commit_rolled_back_compressed",
  },
  "XQ-IO-012": {
    meaning: "safeWriteJson (compressed): commit verification failed with no usable .bak; staged copy kept as .tmp",
    labelKey: "err_io_012_commit_tmp_kept_compressed",
  },
  "XQ-IO-013": {
    meaning: "safeWriteJsonText: the restore payload is not a valid JSON envelope",
    labelKey: "err_io_013_restore_invalid_json",
  },
  "XQ-IO-014": {
    meaning: "safeWriteJsonText: staged .tmp failed verification",
    labelKey: "err_io_014_restore_staging_failed",
  },
  "XQ-IO-015": {
    meaning: "safeWriteJsonText: commit verification failed",
    labelKey: "err_io_015_restore_commit_failed",
  },
  "XQ-IO-016": {
    meaning: "write blocked: the app is in read-only viewer/demo mode",
    labelKey: "err_io_016_read_only_mode",
  },
  "XQ-IO-017": {
    meaning: "write blocked: workspace write permission is unavailable or was revoked (NotAllowedError/SecurityError)",
    labelKey: "err_io_017_write_permission_unavailable",
  },
  "XQ-IO-018": {
    meaning: "read failed: NotReadableError survived the bounded retry budget (share went away mid-read)",
    labelKey: "err_io_018_not_readable",
  },
  "XQ-IO-019": {
    meaning: "payload exceeded the engine's max string length; the streamed write path was taken (observability only)",
    labelKey: "err_io_019_string_length_ceiling",
  },
  "XQ-IO-020": {
    meaning: "write failed: storage quota exceeded (QuotaExceededError)",
    labelKey: "err_io_020_quota_exceeded",
  },
  "XQ-IO-021": {
    meaning: "compressed file damaged: the gzip body failed to decompress (truncation, flipped byte, CRC32/ISIZE mismatch)",
    labelKey: "err_io_021_compressed_damaged",
  },
  "XQ-IO-022": {
    meaning: "compressed file truncated: it ends at its head line and has no gzip body",
    labelKey: "err_io_022_compressed_no_body",
  },
  "XQ-IO-023": {
    meaning: "compressed write rejected: the head line contains a raw newline (frame delimiter)",
    labelKey: "err_io_023_compressed_head_newline",
  },
  "XQ-IO-024": {
    meaning: "compressed write rejected: the head line is larger than the head probe window",
    labelKey: "err_io_024_compressed_head_too_large",
  },
  "XQ-IO-025": {
    meaning: "compression unsupported: CompressionStream/DecompressionStream unavailable in this runtime",
    labelKey: "err_io_025_compression_unsupported",
  },
  "XQ-IO-026": {
    meaning: "compressed write: file handle exposes no createWritable",
    labelKey: "err_io_026_no_createwritable_compressed",
  },
  "XQ-IO-027": {
    meaning: "file system reported NotFoundError for a path that should exist",
    labelKey: "err_io_027_not_found",
  },
  "XQ-IO-028": {
    meaning: "unclassified write/read failure surfaced through the generic Arabic write-error message",
    labelKey: "msg_unexpected_write_error",
  },
  "XQ-IO-029": {
    meaning: "readOptionalJson: the file exists but could not be read, so no empty default was substituted",
    labelKey: "err_io_029_unreadable_not_absent",
  },

  // ── AUTH: login / session / permissions ──────────────────────────────────
  "XQ-AUTH-001": {
    meaning: "login rejected: unknown username or wrong password",
    labelKey: "auth_msg_invalid_credentials",
  },
  "XQ-AUTH-002": {
    meaning: "login rejected: the account is deactivated",
    labelKey: "auth_msg_user_inactive",
  },
  "XQ-AUTH-003": {
    meaning: "login rejected: the bootstrap admin passcode was wrong",
    labelKey: "auth_msg_bad_admin_passcode",
  },
  "XQ-AUTH-004": {
    meaning: "session dropped: the stored session expired (TTL guard on read-back)",
    labelKey: "auth_msg_session_expired",
  },
  "XQ-AUTH-005": {
    meaning: "forced logout: the signed-in user's role or permissions changed on disk",
    labelKey: "auth_msg_permissions_updated",
  },
  "XQ-AUTH-006": {
    meaning: "password-hash upgrade to Argon2id failed; the existing hash was kept (non-fatal)",
    labelKey: "err_auth_006_rehash_failed",
  },
  "XQ-AUTH-007": {
    meaning: "persisting the upgraded password hash to the workspace failed (non-fatal)",
    labelKey: "err_auth_007_rehash_persist_failed",
  },

  // ── POP: population import / processing / save ───────────────────────────
  "XQ-POP-001": {
    meaning: "the native file picker could not be opened; the plain upload input was used instead",
    labelKey: "err_pop_001_picker_fallback",
  },
  "XQ-POP-002": {
    meaning: "the workbook parsing Web Worker was not initialised",
    labelKey: "err_pop_002_worker_unavailable",
  },
  "XQ-POP-003": {
    meaning: "the risk-agency workbook could not be parsed (worker returned an error or crashed)",
    labelKey: "err_pop_003_workbook_parse_failed",
  },
  "XQ-POP-004": {
    meaning: "processPopulation threw while building the processed population",
    labelKey: "err_pop_004_processing_failed",
  },
  "XQ-POP-005": {
    meaning: "saving the processed population to disk returned a failure result",
    labelKey: "err_pop_005_save_returned_error",
  },
  "XQ-POP-006": {
    meaning: "saving the processed population to disk threw",
    labelKey: "err_pop_006_save_threw",
  },

  // ── DIST: distribution and its event log ─────────────────────────────────
  "XQ-DIST-001": {
    meaning: "a distribution action threw; the raw detail went to the error log",
    labelKey: "msg_unexpected_write_error",
  },
  "XQ-DIST-002": {
    meaning: "appendDistributionEvents rejected a duplicate event id",
    labelKey: "err_dist_002_duplicate_event_id",
  },
  "XQ-DIST-003": {
    meaning: "appendDistributionEvents threw while writing the durable event files",
    labelKey: "err_dist_003_append_threw",
  },
  "XQ-DIST-004": {
    meaning: "replacement rejected: the row is already replaced or completed",
    labelKey: "err_dist_004_replacement_bad_state",
  },
  "XQ-DIST-005": {
    meaning: "replacement row was added to the sample but writing the distribution events failed",
    labelKey: "err_dist_005_replacement_partial",
  },
  "XQ-DIST-006": {
    meaning: "distribution event file write: file handle exposes no createWritable",
    labelKey: "err_dist_006_no_createwritable",
  },

  // ── SMP: sampling and the draw ───────────────────────────────────────────
  "XQ-SMP-001": {
    meaning: "RESERVED (not wired): drawSample: there are no population rows to draw from",
    labelKey: "err_smp_001_no_population_rows",
  },
  "XQ-SMP-002": {
    meaning: "RESERVED (not wired): drawSample: the configured total sample size is not greater than zero",
    labelKey: "err_smp_002_sample_size_zero",
  },
  "XQ-SMP-003": {
    meaning: "RESERVED (not wired): drawSample: no row matched any of the four configured levels (stage mapping)",
    labelKey: "err_smp_003_no_stage_match",
  },
  "XQ-SMP-004": {
    meaning: "the sample was drawn but writing sample.master.json failed",
    labelKey: "err_smp_004_draw_saved_failed",
  },
  "XQ-SMP-005": {
    meaning: "the sample draw threw unexpectedly",
    labelKey: "err_smp_005_draw_threw",
  },
  "XQ-SMP-006": {
    meaning: "no sample data exists for the selected month",
    labelKey: "err_smp_006_no_sample_for_month",
  },
  "XQ-SMP-007": {
    meaning: "saveSampleMaster: writing sample.master.json threw",
    labelKey: "err_smp_007_save_master_threw",
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Every code in the catalog, in declaration order. */
export function allErrorCodes(): ErrorCode[] {
  return Object.keys(ERROR_CODES) as ErrorCode[];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CODES;
}

export function errorCodeArea(code: ErrorCode): ErrorArea {
  return code.split("-")[1] as ErrorArea;
}

/** English technical meaning — for the error log and for us, never shown raw. */
export function errorCodeMeaning(code: ErrorCode): string {
  return ERROR_CODES[code].meaning;
}

/**
 * The Arabic user-facing sentence for `code`, with `{name}` placeholders filled
 * from `params`. Reads through `getLabels()` so a Settings override wins.
 */
export function errorCodeMessage(
  code: ErrorCode,
  params?: Readonly<Record<string, string>>
): string {
  let text = getLabels()[ERROR_CODES[code].labelKey];
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      text = text.split(`{${key}}`).join(value);
    }
  }
  return text;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (error === undefined || error === null) return "";
  return String(error);
}

/**
 * The user-facing string: the Arabic sentence, then the quotable code and (when
 * we have one) the raw exception detail.
 *
 *   formatUserError("XQ-WS-006", err)  →  «…» (XQ-WS-006: NotAllowedError: …)
 *   formatUserError("XQ-WS-004")       →  «…» (XQ-WS-004)
 */
export function formatUserError(
  code: ErrorCode,
  error?: unknown,
  params?: Readonly<Record<string, string>>
): string {
  const detail = describe(error);
  const suffix = detail ? `${code}: ${detail}` : code;
  return `«${errorCodeMessage(code, params)}» (${suffix})`;
}

/** Arabic sentence plus the bare code, with no raw exception text. */
export function codedMessage(
  code: ErrorCode,
  params?: Readonly<Record<string, string>>
): string {
  return formatUserError(code, undefined, params);
}

// ── Carrying a code on a thrown value ───────────────────────────────────────

const CODE_PROPERTY = "xqErrorCode";

type CodeCarrier = { [CODE_PROPERTY]?: ErrorCode };

/**
 * Attach `code` to an EXISTING error and return the same object.
 *
 * Deliberately mutates rather than wrapping: callers all over the data layer
 * classify failures by `error.name` (`NotReadableError`, `AbortError`,
 * `MonthClosedError`, …) and by `instanceof`. Wrapping would silently change
 * those verdicts — this is instrumentation, so identity, name, message, stack
 * and cause must all survive untouched.
 */
export function tagError<T>(error: T, code: ErrorCode): T {
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      Object.defineProperty(error, CODE_PROPERTY, {
        value: code,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      // Frozen or exotic object — the code simply isn't carried. Never fatal.
    }
  }
  return error;
}

/** A fresh `Error` carrying `code`. `message` stays the internal English text. */
export function taggedError(
  code: ErrorCode,
  message: string,
  options?: { cause?: unknown }
): Error {
  const error = options && "cause" in options
    ? new Error(message, { cause: options.cause })
    : new Error(message);
  return tagError(error, code);
}

/** The code a throw site attached, or `null`. */
export function errorCodeOf(error: unknown): ErrorCode | null {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return null;
  }
  const carried = (error as CodeCarrier)[CODE_PROPERTY];
  return isErrorCode(carried) ? carried : null;
}

/**
 * Best-effort classification of an untagged file-system exception by its DOM
 * error name. Used only to enrich reporting — it never changes what counts as
 * an error or how one is handled.
 */
export function classifyFileSystemError(error: unknown): ErrorCode | null {
  const name =
    error && typeof error === "object"
      ? (error as { name?: unknown }).name
      : undefined;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "XQ-IO-017";
    case "NotReadableError":
      return "XQ-IO-018";
    case "QuotaExceededError":
      return "XQ-IO-020";
    case "NotFoundError":
      return "XQ-IO-027";
    default:
      return null;
  }
}

/** The code carried by `error`, else the one implied by its DOM error name. */
export function resolveErrorCode(error: unknown): ErrorCode | null {
  return errorCodeOf(error) ?? classifyFileSystemError(error);
}

/**
 * Ring-buffer entry that shows the code in Settings → error log, next to the
 * same code the user is reading off their screen.
 */
export function logCodedError(
  context: string,
  code: ErrorCode,
  error?: unknown
): void {
  logError(
    `${context} [${code}]`,
    error === undefined ? new Error(errorCodeMeaning(code)) : error
  );
}
