import { describe, it, expect } from "vitest";
import {
  ERRORS_FILE_SUFFIX,
  errorsArchiveFileName,
  errorsFileName,
  isErrorsArchiveFileName,
} from "./errorLogPaths";

describe("errorLogPaths", () => {
  it("gives each user a distinct stem", () => {
    expect(errorsFileName("alice")).not.toBe(errorsFileName("bob"));
  });

  it("is stable for the same name", () => {
    expect(errorsFileName("alice")).toBe(errorsFileName("alice"));
  });

  it("separates two names that sanitize identically", () => {
    // safeWorkspaceFilePart maps both `a/b` and `a\b` to `a_b`; the hashed
    // suffix is what keeps them in different files. Same reasoning as
    // auditPaths.ts:34-41 — a collision here silently restores the
    // two-writers-one-file contention this whole layout exists to remove.
    expect(errorsFileName("a/b")).not.toBe(errorsFileName("a\\b"));
  });

  it("keeps the live suffix and the archive suffix disjoint", () => {
    // The year sits between `.errors` and `.json`, so an archive filename does
    // NOT end with the live suffix — which is what lets one readJsonDirectory
    // call list live files without a second predicate. A `.includes()` here
    // would fold every archive into the live log. Same trap as
    // auditPaths.ts:57-65.
    const archive = errorsArchiveFileName("alice", 2026);
    expect(archive.endsWith(ERRORS_FILE_SUFFIX)).toBe(false);
    expect(errorsFileName("alice").endsWith(ERRORS_FILE_SUFFIX)).toBe(true);
    expect(isErrorsArchiveFileName(archive, 2026)).toBe(true);
    expect(isErrorsArchiveFileName(archive, 2025)).toBe(false);
    expect(isErrorsArchiveFileName(errorsFileName("alice"), 2026)).toBe(false);
  });
});
