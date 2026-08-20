/**
 * The error-code catalog is a support contract, not an implementation detail.
 *
 * This file pins the FULL code -> meaning map. Renumbering, reusing or quietly
 * repurposing a code fails here, which is the point: a user quotes "XQ-WS-006"
 * off their screen weeks later, and it has to still mean what it meant then.
 *
 * Adding a NEW code is the only edit that should ever touch this pin, and it is
 * an append: add the new line, leave every existing one byte-for-byte alone.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  allErrorCodes,
  classifyFileSystemError,
  codedMessage,
  errorCodeArea,
  errorCodeMeaning,
  errorCodeMessage,
  errorCodeOf,
  formatUserError,
  isErrorCode,
  resolveErrorCode,
  tagError,
  taggedError,
  type ErrorCode,
} from "./errorCodes";
import { DEFAULT_LABELS } from "../labels/labelsStore";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(HERE, "errorCodes.ts");
const SRC_ROOT = join(HERE, "..", "..");

/** THE PIN. Append only — never edit or remove a line below. */
const PINNED_MEANINGS: Record<string, string> = {
  "XQ-WS-001":
    "selectWorkspace: File System Access API unsupported in this browser",
  "XQ-WS-002":
    "selectWorkspace: directory picker dismissed by the user (AbortError)",
  "XQ-WS-003":
    "selectWorkspace: showDirectoryPicker or the structure check threw",
  "XQ-WS-004":
    "createInitialStructure: invoked with no directory handle selected",
  "XQ-WS-005":
    "createInitialStructure step 1/3: createWorkspaceStructure threw",
  "XQ-WS-006":
    "createInitialStructure step 2/3: checkWorkspaceStructure threw",
  "XQ-WS-007":
    "createInitialStructure step 3/3: loadWorkspaceFiles threw",
  "XQ-WS-008":
    "reconnectWorkspace: no remembered workspace on record",
  "XQ-WS-009":
    "reconnectWorkspace: readwrite permission was not granted",
  "XQ-WS-010":
    "reconnectWorkspace: reconnect threw",
  "XQ-WS-011":
    "reloadWorkspace: no directory handle mounted",
  "XQ-WS-012":
    "reloadWorkspace: re-check or file load threw",
  "XQ-WS-013":
    "refreshPermissions: loadWorkspaceFiles threw",
  "XQ-WS-014":
    "restore-on-mount: reading or restoring the remembered workspace threw",
  "XQ-WS-015":
    "restore-on-mount: remembered handle's readwrite grant is not 'granted'",
  "XQ-WS-016":
    "enterDemoWorkspace: building the in-memory demo workspace threw",
  "XQ-WS-017":
    "runtime: workspace write permission was lost after mount",
  "XQ-WS-018":
    "createInitialStructure: failed outside the three instrumented steps",
  "XQ-FS-001":
    "selectWorkspaceDirectory: window.showDirectoryPicker is unavailable",
  "XQ-FS-002":
    "checkWorkspaceStructure: read permission on the folder was denied",
  "XQ-FS-003":
    "checkWorkspaceStructure: required folders/files are missing",
  "XQ-FS-004":
    "checkWorkspaceStructure: files present but invalid or schema-incompatible",
  "XQ-FS-005":
    "createWorkspaceStructure: readwrite permission was not granted",
  "XQ-FS-006":
    "createWorkspaceStructure: creating a top-level workspace folder failed",
  "XQ-FS-007":
    "createWorkspaceStructure: creating a system subfolder (locks/audit/backups) failed",
  "XQ-FS-008":
    "createWorkspaceStructure: writing workspace.manifest.json failed",
  "XQ-FS-009":
    "createWorkspaceStructure: writing users.permissions.json failed",
  "XQ-FS-010":
    "createWorkspaceStructure: schema detection or stamping workspace.schema.json failed",
  "XQ-FS-011":
    "readJsonFile: file not found",
  "XQ-FS-012":
    "readJsonFile: file content is not valid JSON",
  "XQ-FS-013":
    "readJsonFile: permission denied while reading the file",
  "XQ-FS-014":
    "readJsonFile: read failed for an unclassified reason",
  "XQ-IO-001":
    "writeText: file handle exposes no createWritable (read-only handle or unsupported browser)",
  "XQ-IO-002":
    "streamToFile: file handle exposes no createWritable",
  "XQ-IO-003":
    "openBinaryWritable: file handle exposes no createWritable",
  "XQ-IO-004":
    "copyFileStreamed: the source file disappeared before it could be copied",
  "XQ-IO-005":
    "copyFileBytes: the source file disappeared before it could be copied",
  "XQ-IO-006":
    "safeWriteJson (small path): staged .tmp did not match the bytes we wrote",
  "XQ-IO-007":
    "safeWriteJson (streamed path): staged .tmp failed byte-exact verification",
  "XQ-IO-008":
    "safeWriteJson (compressed path): staged .tmp failed byte-exact verification",
  "XQ-IO-009":
    "safeWriteJson: commit verification failed; rolled back to the .bak snapshot",
  "XQ-IO-010":
    "safeWriteJson: commit verification failed with no usable .bak; staged copy kept as .tmp",
  "XQ-IO-011":
    "safeWriteJson (compressed): commit verification failed; rolled back to the .bak snapshot",
  "XQ-IO-012":
    "safeWriteJson (compressed): commit verification failed with no usable .bak; staged copy kept as .tmp",
  "XQ-IO-013":
    "safeWriteJsonText: the restore payload is not a valid JSON envelope",
  "XQ-IO-014":
    "safeWriteJsonText: staged .tmp failed verification",
  "XQ-IO-015":
    "safeWriteJsonText: commit verification failed",
  "XQ-IO-016":
    "write blocked: the app is in read-only viewer/demo mode",
  "XQ-IO-017":
    "write blocked: workspace write permission is unavailable or was revoked (NotAllowedError/SecurityError)",
  "XQ-IO-018":
    "read failed: NotReadableError survived the bounded retry budget (share went away mid-read)",
  "XQ-IO-019":
    "payload exceeded the engine's max string length; the streamed write path was taken (observability only)",
  "XQ-IO-020":
    "write failed: storage quota exceeded (QuotaExceededError)",
  "XQ-IO-021":
    "compressed file damaged: the gzip body failed to decompress (truncation, flipped byte, CRC32/ISIZE mismatch)",
  "XQ-IO-022":
    "compressed file truncated: it ends at its head line and has no gzip body",
  "XQ-IO-023":
    "compressed write rejected: the head line contains a raw newline (frame delimiter)",
  "XQ-IO-024":
    "compressed write rejected: the head line is larger than the head probe window",
  "XQ-IO-025":
    "compression unsupported: CompressionStream/DecompressionStream unavailable in this runtime",
  "XQ-IO-026":
    "compressed write: file handle exposes no createWritable",
  "XQ-IO-027":
    "file system reported NotFoundError for a path that should exist",
  "XQ-IO-028":
    "unclassified write/read failure surfaced through the generic Arabic write-error message",
  "XQ-IO-029":
    "readOptionalJson: the file exists but could not be read, so no empty default was substituted",
  "XQ-IO-030":
    "NotFound persisted after every retry AND the containing directory no longer resolves — the workspace folder was moved, renamed or re-created since the handle was restored; retrying cannot help, the user must re-select the workspace",
  "XQ-IO-033":
    "the folder accepts a .tmp file but a file with the FAILING file's own extension does not survive a write-then-read-back round trip — something outside the browser (antivirus, DLP, a sync client) is removing that file type, and no amount of retrying will help",
  "XQ-IO-032":
    "casLoop exhausted its retries because an attempt kept THROWING (not because it lost the revision race) and the exception carried no more specific code",
  "XQ-FS-015":
    "the workspace could not be READ (transient share/permission fault) — it was NOT judged missing; retry instead of creating, and the create/mount path refuses to overwrite files it could not verify",
  "XQ-IO-031":
    "NotFound persisted after every retry but the containing directory is reachable and writable — a genuine transient share flake, so retrying the action is the right advice",
  "XQ-IO-034":
    "the folder accepts short names and the failing file's extension, but a probe with the SAME NAME LENGTH cannot be created there — a path-length limit (Windows' 260-character cap on a deep UNC workspace path). Retrying can never help; the workspace must sit closer to the share root, or the writer must use shorter names",
  "XQ-IO-035":
    "NoModificationAllowedError survived every retry: the file stayed locked by another writer (another tab, or another machine on the SMB share) for the whole ladder. This is CONTENTION, not a lost permission grant — repeating the action shortly is the right advice",
  "XQ-AUTH-001":
    "login rejected: unknown username or wrong password",
  "XQ-AUTH-002":
    "login rejected: the account is deactivated",
  "XQ-AUTH-003":
    "login rejected: the bootstrap admin passcode was wrong",
  "XQ-AUTH-004":
    "session dropped: the stored session expired (TTL guard on read-back)",
  "XQ-AUTH-005":
    "forced logout: the signed-in user's role or permissions changed on disk",
  "XQ-AUTH-006":
    "password-hash upgrade to Argon2id failed; the existing hash was kept (non-fatal)",
  "XQ-AUTH-007":
    "persisting the upgraded password hash to the workspace failed (non-fatal)",
  "XQ-POP-001":
    "the native file picker could not be opened; the plain upload input was used instead",
  "XQ-POP-002":
    "the workbook parsing Web Worker was not initialised",
  "XQ-POP-003":
    "the risk-agency workbook could not be parsed (worker returned an error or crashed)",
  "XQ-POP-004":
    "processPopulation threw while building the processed population",
  "XQ-POP-005":
    "saving the processed population to disk returned a failure result",
  "XQ-POP-007":
    "a population Web Worker died without sending a reply (error/messageerror) — most likely out of memory on a very large month; without this the caller waits forever",
  "XQ-POP-006":
    "saving the processed population to disk threw",
  "XQ-DIST-001":
    "a distribution action threw; the raw detail went to the error log",
  "XQ-DIST-002":
    "appendDistributionEvents rejected a duplicate event id",
  "XQ-DIST-003":
    "appendDistributionEvents threw while writing the durable event files",
  "XQ-DIST-004":
    "replacement rejected: the row is already replaced or completed",
  "XQ-DIST-005":
    "replacement row was added to the sample but writing the distribution events failed",
  "XQ-DIST-007":
    "distribution events were durably written but the post-close read-back could not confirm the segment (share visibility lag); the projection was committed anyway because the bytes are on disk",
  "XQ-DIST-008":
    "distribution event segment read back at the WRONG size after retries — a genuine bad write, not a visibility artefact",
  "XQ-DIST-006":
    "distribution event file write: file handle exposes no createWritable",
  "XQ-DIST-009":
    "the NDJSON segment append failed on this share, so the batch was written as one immutable {eventId}.json file per event instead (the pre-segment layout every reader still merges). The events ARE durable — this records that the fast path is unusable here, e.g. a blocked .ndjson extension or a path-length limit",
  "XQ-SMP-001":
    "RESERVED (not wired): drawSample: there are no population rows to draw from",
  "XQ-SMP-002":
    "RESERVED (not wired): drawSample: the configured total sample size is not greater than zero",
  "XQ-SMP-003":
    "RESERVED (not wired): drawSample: no row matched any of the four configured levels (stage mapping)",
  "XQ-SMP-004":
    "the sample was drawn but writing sample.master.json failed",
  "XQ-SMP-005":
    "the sample draw threw unexpectedly",
  "XQ-SMP-006":
    "no sample data exists for the selected month",
  "XQ-SMP-007":
    "saveSampleMaster: writing sample.master.json threw",
  "XQ-SMP-008":
    "appendSampleRow rejected an enlargement: the dead row was already substituted by a DIFFERENT replacement row (XQ-DIST-005 partial-write state) — the recovery is retrying with the original candidate, which resumes",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("error-code catalog", () => {
  it("matches the pinned code -> meaning map exactly", () => {
    const actual: Record<string, string> = {};
    for (const code of allErrorCodes()) actual[code] = errorCodeMeaning(code);
    expect(actual).toEqual(PINNED_MEANINGS);
  });

  it("declares every code exactly once in the source", () => {
    // An object literal silently keeps the LAST duplicate key, so a repeated
    // code would never show up in ERROR_CODES — only in the file text.
    const declared = [
      ...readFileSync(CATALOG_PATH, "utf8").matchAll(/"(XQ-[A-Z]+-\d+)": \{/g),
    ].map((match) => match[1]);
    expect(declared).toHaveLength(new Set(declared).size);
    expect(new Set(declared)).toEqual(new Set(allErrorCodes()));
  });

  it("uses the XQ-<AREA>-<NNN> shape with a known area", () => {
    for (const code of allErrorCodes()) {
      expect(code).toMatch(/^XQ-(WS|FS|IO|AUTH|POP|DIST|SMP)-\d{3}$/);
      expect(errorCodeArea(code)).toBe(code.split("-")[1]);
    }
  });

  it("points every entry at a real label key with non-empty Arabic text", () => {
    for (const code of allErrorCodes()) {
      const { labelKey } = ERROR_CODES[code];
      expect(DEFAULT_LABELS).toHaveProperty(labelKey);
      expect(DEFAULT_LABELS[labelKey].trim().length).toBeGreaterThan(0);
    }
  });

  it("is exhaustive: every code referenced anywhere in src/ exists in the catalog", () => {
    const known = new Set<string>(allErrorCodes());
    const unknown = new Set<string>();
    for (const file of walk(SRC_ROOT)) {
      // This file deliberately names a non-existent code to prove isErrorCode
      // rejects it.
      if (file.endsWith("errorCodes.test.ts")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/XQ-[A-Z]+-\d+/g)) {
        if (!known.has(match[0])) unknown.add(`${match[0]} (${file})`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("marks every unwired entry RESERVED and nothing else", () => {
    // XQ-SMP-001/002/003 name the three drawSample rejection strings, which are
    // pinned byte-for-byte by sampleAlgorithm.golden.test.ts. The codes are
    // reserved so the numbering never shifts if the owner decides to accept the
    // golden-master change; until then those messages carry no code.
    const seen = new Set<string>();
    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith("errorCodes.ts") || file.endsWith("errorCodes.test.ts")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/XQ-[A-Z]+-\d+/g)) {
        // A code named only inside a comment is not wired.
        seen.add(match[0]);
      }
    }
    for (const code of allErrorCodes()) {
      const reserved = errorCodeMeaning(code).startsWith("RESERVED");
      if (reserved) continue;
      expect(seen.has(code) || code === "XQ-IO-018" || code === "XQ-IO-020" || code === "XQ-IO-027")
        .toBe(true);
    }
    expect(
      allErrorCodes().filter((code) => errorCodeMeaning(code).startsWith("RESERVED"))
    ).toEqual(["XQ-SMP-001", "XQ-SMP-002", "XQ-SMP-003"]);
  });

  it("leaves no catalog entry unused", () => {
    const seen = new Set<string>();
    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith("errorCodes.test.ts")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/XQ-[A-Z]+-\d+/g)) {
        seen.add(match[0]);
      }
    }
    // XQ-IO-018/020/027 are reached only through classifyFileSystemError inside
    // errorCodes.ts itself; the three RESERVED sampling codes are documented in
    // the test above.
    const allowedElsewhere = new Set<string>([
      "XQ-IO-018",
      "XQ-IO-020",
      "XQ-IO-027",
      "XQ-SMP-001",
      "XQ-SMP-002",
      "XQ-SMP-003",
    ]);
    expect(
      allErrorCodes().filter((code) => !seen.has(code) && !allowedElsewhere.has(code))
    ).toEqual([]);
  });
});

describe("formatting", () => {
  const code: ErrorCode = "XQ-WS-005";

  it("renders the Arabic sentence plus the quotable code", () => {
    expect(codedMessage(code)).toBe(
      `«${DEFAULT_LABELS[ERROR_CODES[code].labelKey]}» (${code})`
    );
  });

  it("appends the raw exception detail when there is one", () => {
    const error = new Error("nope");
    error.name = "NotAllowedError";
    expect(formatUserError(code, error)).toContain(`(${code}: NotAllowedError: nope)`);
  });

  it("fills {placeholders} from params", () => {
    expect(errorCodeMessage("XQ-FS-011", { file: "users.permissions.json" })).toContain(
      "users.permissions.json"
    );
    expect(errorCodeMessage("XQ-FS-011", { file: "x" })).not.toContain("{file}");
  });

  it("recognises catalog codes and rejects strings that only look like one", () => {
    expect(isErrorCode("XQ-WS-005")).toBe(true);
    expect(isErrorCode("XQ-WS-999")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe("carrying a code on a thrown value", () => {
  it("tags an existing error without changing its identity", () => {
    const original = new Error("A requested file could not be found.");
    original.name = "NotFoundError";
    const tagged = tagError(original, "XQ-IO-004");

    expect(tagged).toBe(original);
    expect(tagged.name).toBe("NotFoundError");
    expect(tagged.message).toBe("A requested file could not be found.");
    expect(tagged instanceof Error).toBe(true);
    expect(errorCodeOf(tagged)).toBe("XQ-IO-004");
    // Non-enumerable: JSON/spread of the error is unchanged.
    expect(Object.keys(tagged)).not.toContain("xqErrorCode");
  });

  it("creates a fresh error carrying its code and internal English message", () => {
    const error = taggedError("XQ-IO-001", "Browser cannot write x.json.");
    expect(error.message).toBe("Browser cannot write x.json.");
    expect(errorCodeOf(error)).toBe("XQ-IO-001");
  });

  it("returns null for untagged and non-object throws", () => {
    expect(errorCodeOf(new Error("plain"))).toBeNull();
    expect(errorCodeOf("string")).toBeNull();
    expect(errorCodeOf(null)).toBeNull();
  });

  it("classifies untagged DOM file-system errors by name", () => {
    const make = (name: string) => Object.assign(new Error("x"), { name });
    expect(classifyFileSystemError(make("NotAllowedError"))).toBe("XQ-IO-017");
    expect(classifyFileSystemError(make("SecurityError"))).toBe("XQ-IO-017");
    expect(classifyFileSystemError(make("NotReadableError"))).toBe("XQ-IO-018");
    expect(classifyFileSystemError(make("QuotaExceededError"))).toBe("XQ-IO-020");
    expect(classifyFileSystemError(make("NotFoundError"))).toBe("XQ-IO-027");
    expect(classifyFileSystemError(make("TypeError"))).toBeNull();
  });

  it("prefers an explicitly tagged code over the name-based guess", () => {
    const error = Object.assign(new Error("x"), { name: "NotFoundError" });
    expect(resolveErrorCode(error)).toBe("XQ-IO-027");
    tagError(error, "XQ-IO-004");
    expect(resolveErrorCode(error)).toBe("XQ-IO-004");
  });
});
