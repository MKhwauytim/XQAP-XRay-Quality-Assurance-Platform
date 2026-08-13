import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { clearErrors } from "../storage/errorLogger";
import { getSystemRoot } from "./workspacePaths";
import {
  clampSyncIntervalMs,
  DEFAULT_SYNC_INTERVAL_MS,
  isSyncIntervalInRange,
  MAX_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  readSyncIntervalMs,
  saveSyncIntervalMs,
  WORKSPACE_SETTINGS_FILE,
} from "./syncSettings";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";

function makeRoot(name = "settings-root"): DirectoryHandleLike {
  return createMemoryDirectory(name) as unknown as DirectoryHandleLike;
}

/** Write bytes straight into the workspace, bypassing the envelope — this is
 *  what a hand-edited or truncated file looks like. */
async function writeRawSettings(root: DirectoryHandleLike, content: string): Promise<void> {
  const dir = await getSystemRoot(root, true);
  const handle: FileHandleLike = await dir.getFileHandle(WORKSPACE_SETTINGS_FILE, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

/** Write a well-formed envelope carrying an arbitrary (possibly illegal)
 *  stored value — the "someone edited the JSON on the shared folder" case. */
async function seedStoredInterval(root: DirectoryHandleLike, value: unknown): Promise<void> {
  const dir = await getSystemRoot(root, true);
  await safeWriteJson(dir, WORKSPACE_SETTINGS_FILE, {
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "someone",
    syncIntervalMs: value,
  });
}

describe("syncSettings — clamping", () => {
  it("clamps at the floor and the ceiling", () => {
    expect(clampSyncIntervalMs(MIN_SYNC_INTERVAL_MS - 1)).toBe(MIN_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(1)).toBe(MIN_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(0)).toBe(MIN_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(MAX_SYNC_INTERVAL_MS + 1)).toBe(MAX_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(999_999_999)).toBe(MAX_SYNC_INTERVAL_MS);
  });

  it("passes in-range values through, rounding non-integers to whole milliseconds", () => {
    expect(clampSyncIntervalMs(MIN_SYNC_INTERVAL_MS)).toBe(MIN_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(MAX_SYNC_INTERVAL_MS)).toBe(MAX_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(60_000)).toBe(60_000);
    expect(clampSyncIntervalMs(60_000.4)).toBe(60_000);
    expect(clampSyncIntervalMs(60_000.6)).toBe(60_001);
  });

  it("falls back to the default for NaN, negatives, absent and non-numeric values", () => {
    expect(clampSyncIntervalMs(Number.NaN)).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(undefined)).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs(null)).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs("30000")).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(clampSyncIntervalMs({})).toBe(DEFAULT_SYNC_INTERVAL_MS);
    // A negative number is a number, so it clamps to the floor rather than
    // silently becoming the default — either way it can never reach the timer.
    expect(clampSyncIntervalMs(-5_000)).toBe(MIN_SYNC_INTERVAL_MS);
  });

  it("isSyncIntervalInRange rejects exactly what the editor must refuse", () => {
    expect(isSyncIntervalInRange(MIN_SYNC_INTERVAL_MS)).toBe(true);
    expect(isSyncIntervalInRange(MAX_SYNC_INTERVAL_MS)).toBe(true);
    expect(isSyncIntervalInRange(MIN_SYNC_INTERVAL_MS - 1)).toBe(false);
    expect(isSyncIntervalInRange(MAX_SYNC_INTERVAL_MS + 1)).toBe(false);
    expect(isSyncIntervalInRange(20_000.5)).toBe(false);
    expect(isSyncIntervalInRange(Number.NaN)).toBe(false);
    expect(isSyncIntervalInRange("20000")).toBe(false);
    expect(isSyncIntervalInRange(undefined)).toBe(false);
  });
});

describe("syncSettings — reading", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("returns the default when no workspace is mounted", async () => {
    await expect(readSyncIntervalMs(null)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("returns the default for a fresh workspace with no settings file at all", async () => {
    await expect(readSyncIntervalMs(makeRoot())).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("returns the default for a malformed (unparseable) settings file", async () => {
    const root = makeRoot();
    await writeRawSettings(root, "{ this is not json");
    await expect(readSyncIntervalMs(root)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("returns the default when the file is valid JSON but carries no interval", async () => {
    const root = makeRoot();
    await seedStoredInterval(root, undefined);
    await expect(readSyncIntervalMs(root)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("CLAMPS ON READ-BACK — a hand-edited out-of-range value on disk never reaches the timer", async () => {
    const tooSmall = makeRoot("too-small");
    await seedStoredInterval(tooSmall, 250);
    await expect(readSyncIntervalMs(tooSmall)).resolves.toBe(MIN_SYNC_INTERVAL_MS);

    const tooLarge = makeRoot("too-large");
    await seedStoredInterval(tooLarge, 24 * 60 * 60_000);
    await expect(readSyncIntervalMs(tooLarge)).resolves.toBe(MAX_SYNC_INTERVAL_MS);

    const nonsense = makeRoot("nonsense");
    await seedStoredInterval(nonsense, "fast please");
    await expect(readSyncIntervalMs(nonsense)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("returns a stored in-range value unchanged", async () => {
    const root = makeRoot();
    await seedStoredInterval(root, 120_000);
    await expect(readSyncIntervalMs(root)).resolves.toBe(120_000);
  });
});

describe("syncSettings — writing", () => {
  it("round-trips an in-range value", async () => {
    const root = makeRoot();
    const result = await saveSyncIntervalMs(root, 90_000, "admin");
    expect(result.ok).toBe(true);
    await expect(readSyncIntervalMs(root)).resolves.toBe(90_000);
  });

  it("CLAMPS ON WRITE — an out-of-range value is never persisted as given", async () => {
    const root = makeRoot();
    expect((await saveSyncIntervalMs(root, 1_000, "admin")).ok).toBe(true);
    await expect(readSyncIntervalMs(root)).resolves.toBe(MIN_SYNC_INTERVAL_MS);

    expect((await saveSyncIntervalMs(root, 10 * 60 * 60_000, "admin")).ok).toBe(true);
    await expect(readSyncIntervalMs(root)).resolves.toBe(MAX_SYNC_INTERVAL_MS);

    expect((await saveSyncIntervalMs(root, Number.NaN, "admin")).ok).toBe(true);
    await expect(readSyncIntervalMs(root)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("bumps the revision and stamps the actor, so concurrent writers are detectable", async () => {
    const root = makeRoot();
    await saveSyncIntervalMs(root, 60_000, "admin");
    await saveSyncIntervalMs(root, 75_000, "second-admin");

    const dir = await getSystemRoot(root, false);
    const file = await dir.getFileHandle(WORKSPACE_SETTINGS_FILE);
    const parsed = JSON.parse(await (await file.getFile()).text());
    expect(parsed.data.revision).toBe(2);
    expect(parsed.data.updatedBy).toBe("second-admin");
    expect(typeof parsed.data._writeToken).toBe("string");
  });

  it("preserves unrelated fields already in the settings file (why this write goes through casLoop)", async () => {
    const root = makeRoot();
    const dir = await getSystemRoot(root, true);
    await safeWriteJson(dir, WORKSPACE_SETTINGS_FILE, {
      revision: 3,
      updatedAt: new Date().toISOString(),
      syncIntervalMs: 60_000,
      someFutureSetting: "keep me",
    });

    expect((await saveSyncIntervalMs(root, 90_000, "admin")).ok).toBe(true);

    const file = await dir.getFileHandle(WORKSPACE_SETTINGS_FILE);
    const parsed = JSON.parse(await (await file.getFile()).text());
    expect(parsed.data.someFutureSetting).toBe("keep me");
    expect(parsed.data.syncIntervalMs).toBe(90_000);
  });

  it("surfaces a failure instead of throwing when the workspace cannot be written", async () => {
    const root = createMemoryDirectory("read-only-root", {
      initialWritePermission: "denied",
      writePermissionRequestOutcome: "denied",
    }) as unknown as DirectoryHandleLike;

    const result = await saveSyncIntervalMs(root, 60_000, "admin");
    expect(result.ok).toBe(false);
    expect("error" in result && typeof result.error === "string" && result.error.length > 0).toBe(true);
  });

  it("propagates one client's change to another client reading the SAME workspace folder", async () => {
    // Two "clients" are two independent readers of the same directory handle
    // tree — the propagation contract lives entirely in the storage layer, so
    // no second browser is needed to prove it.
    const sharedFolder = makeRoot("shared");
    await expect(readSyncIntervalMs(sharedFolder)).resolves.toBe(DEFAULT_SYNC_INTERVAL_MS);

    // Client A (the admin) saves.
    expect((await saveSyncIntervalMs(sharedFolder, 300_000, "admin")).ok).toBe(true);

    // Client B re-reads the same folder and sees it.
    await expect(readSyncIntervalMs(sharedFolder)).resolves.toBe(300_000);
  });
});
