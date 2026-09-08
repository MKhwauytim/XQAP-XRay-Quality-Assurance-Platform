// A `.bak` / `.tmp` recovery must be written down, not only shown once.
//
// Found from a deployment where every user — admin included — got a
// "backup/tmp file" warning on every sign-in, and the 1,707-row exported error
// log from that same workspace could not name the file, because the recovery
// only ever fired a window event that `App.tsx` rendered as a banner.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { clearErrors, getRecentErrors } from "./errorLogger";
import { __resetBakRecoveryReportsForTests } from "./bakRecoveryReport";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { wrap } from "./jsonEnvelope";

const FILE = "users.permissions.json";

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

let dir: DirectoryHandleLike;

beforeEach(async () => {
  dir = createMemoryDirectory("3-user-data") as unknown as DirectoryHandleLike;
  clearErrors();
  __resetBakRecoveryReportsForTests();
});

describe("bak/tmp recovery reporting", () => {
  it("names the file and the copy it was served from", async () => {
    // Two writes so a `.bak` snapshot exists, then damage the live file.
    await safeWriteJson(dir, FILE, wrap({ users: ["a"] }));
    await safeWriteJson(dir, FILE, wrap({ users: ["a", "b"] }));
    await writeRaw(dir, FILE, "{ torn write");

    const read = await safeReadJson<{ users: string[] }>(dir, FILE);
    expect(read.ok).toBe(true);
    expect(read.ok && read.recoveredFromBak).toBe(true);

    const entry = getRecentErrors().find((e) => e.context === "storage:bak-recovery");
    expect(entry).toBeDefined();
    expect(entry!.message).toContain(FILE);
    expect(entry!.message).toContain(`${FILE}.bak`);
    expect(entry!.message).toContain("3-user-data");
  });

  it("records it once per file per session, not once per read", async () => {
    await safeWriteJson(dir, FILE, wrap({ users: ["a"] }));
    await safeWriteJson(dir, FILE, wrap({ users: ["a", "b"] }));
    await writeRaw(dir, FILE, "{ torn write");

    // The sync tick re-reads this file every 45 s; logging each one would put
    // ~80 entries per user per hour onto the same contended share.
    for (let i = 0; i < 5; i++) await safeReadJson(dir, FILE);

    expect(getRecentErrors().filter((e) => e.context === "storage:bak-recovery")).toHaveLength(1);
  });

  it("says .tmp when the staged copy is the survivor", async () => {
    await safeWriteJson(dir, FILE, wrap({ users: ["a"] }));
    // A failed commit's documented outcome: a verified `.tmp` and no usable live
    // file or `.bak`.
    const good = await (await (await dir.getFileHandle(FILE)).getFile()).text();
    await writeRaw(dir, `${FILE}.tmp`, good);
    await writeRaw(dir, FILE, "{ torn");
    await writeRaw(dir, `${FILE}.bak`, "{ also torn");

    const read = await safeReadJson<{ users: string[] }>(dir, FILE);
    expect(read.ok).toBe(true);

    const entry = getRecentErrors().find((e) => e.context === "storage:bak-recovery");
    expect(entry!.message).toContain(`${FILE}.tmp`);
  });

  it("says nothing at all when the live file reads fine", async () => {
    await safeWriteJson(dir, FILE, wrap({ users: ["a"] }));
    const read = await safeReadJson<{ users: string[] }>(dir, FILE);
    expect(read.ok && read.recoveredFromBak).toBe(false);
    expect(getRecentErrors().filter((e) => e.context === "storage:bak-recovery")).toHaveLength(0);
  });
});
