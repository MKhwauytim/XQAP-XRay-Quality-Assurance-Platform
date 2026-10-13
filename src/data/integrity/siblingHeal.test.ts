import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision, safeReadJson } from "../storage/safeWrite";
import { wrap } from "../storage/jsonEnvelope";
import { setReadOnlyMode } from "../storage/readOnlyMode";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { readWorkspaceActions } from "../audit/actionLog";
import { getFeedbackThreadsDir, invalidateWorkspaceDirCache } from "../workspace/workspacePaths";
import {
  __resetSiblingHealMemoForTests,
  FRESH_TMP_WINDOW_MS,
  healFileFromSibling,
} from "./siblingHeal";
import {
  pickSiblingHealCandidates,
  runBootIntegrityScan,
  shouldRunBootIntegrityScan,
} from "./bootIntegrityScan";

const THREAD = "thread-1700000000000-abc123.json";
let workspaceCounter = 0;
const BROKEN ="{ \"metadata\": { \"schemaVersion\": 1, \"revi";
const AGED = () => Date.now() + 10 * FRESH_TMP_WINDOW_MS;

// Feedback-thread-shaped payload (the file the owner's banner named).
function thread(messages: string[]) {
  return {
    threadId: "thread-1700000000000-abc123",
    subject: "مشكلة في الشاشة",
    status: "open",
    messages: messages.map((text, index) => ({
      id: `m${index}`,
      author: "employee1",
      text,
      at: "2026-10-13T08:00:00.000Z",
    })),
  };
}

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function readRaw(dir: DirectoryHandleLike, name: string): Promise<string> {
  return (await (await dir.getFileHandle(name)).getFile()).text();
}

async function names(dir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(dir)).map((entry) => entry.name);
}

function healLogs() {
  return getRecentErrors().filter((entry) => entry.context === "integrity:sibling-heal");
}

beforeEach(() => {
  clearErrors();
  __resetSiblingHealMemoForTests();
  invalidateWorkspaceDirCache();
  setReadOnlyMode(false);
});

afterEach(() => setReadOnlyMode(false));

describe("healFileFromSibling", () => {
  it("heals a corrupt live file from a valid, aged .tmp, archiving the damaged bytes first", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a", "b"]), 4)));

    const result = await healFileFromSibling(dir, THREAD, {
      nowMs: AGED(),
      recheckDelayMs: 0,
      location: "5-system/feedback/threads",
    });

    expect(result.status).toBe("healed");
    if (result.status !== "healed") return;
    expect(result.source).toBe(".tmp");
    expect(await readRaw(dir, result.archivedAs)).toBe(BROKEN);
    const read = await safeReadJson<ReturnType<typeof thread>>(dir, THREAD);
    expect(read.ok && read.recoveredFromBak === false).toBe(true);
    expect(read.ok && read.value.messages).toHaveLength(2);
    // The revision continues past the sibling's; it never restarts at 1.
    // wrap(x, 4) is revision 5; the sibling's bytes are promoted unchanged.
    expect(await readEnvelopeRevision(dir, THREAD)).toBe(5);
    expect(result.revision).toBe(5);
    expect(await readRaw(dir, THREAD)).toBe(await readRaw(dir, `${THREAD}.tmp`));
    const logs = healLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toContain(THREAD);
  });

  it("promotes a self-hashed / string-schemaVersion sibling byte-for-byte", async () => {
    const dir = createMemoryDirectory("users");
    const sibling = JSON.stringify({
      metadata: { schemaVersion: "workspace-2", revision: 3, hash: "sha256:abc" },
      data: { users: ["a"] },
    });
    await writeRaw(dir, "users.permissions.json", BROKEN);
    await writeRaw(dir, "users.permissions.json.tmp", sibling);

    const result = await healFileFromSibling(dir, "users.permissions.json", {
      nowMs: AGED(),
      recheckDelayMs: 0,
    });

    expect(result.status).toBe("healed");
    expect(await readRaw(dir, "users.permissions.json")).toBe(sibling);
  });

  it("heals from .bak when there is no .tmp", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.bak`, JSON.stringify(wrap(thread(["only"]), 2)));

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result.status === "healed" && result.source).toBe(".bak");
  });

  it("leaves a .tmp fresher than the freshness window alone (another machine may be mid-write)", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a"]), 4)));
    const before = await names(dir);

    const result = await healFileFromSibling(dir, THREAD, { nowMs: Date.now(), recheckDelayMs: 0 });

    expect(result).toMatchObject({ status: "skipped", reason: "tmp-too-fresh" });
    expect(await readRaw(dir, THREAD)).toBe(BROKEN);
    expect(await names(dir)).toEqual(before);
    expect(healLogs()).toHaveLength(1); // the skip is logged
  });

  it("does not touch a live file that is valid", async () => {
    const dir = createMemoryDirectory("threads");
    const live = JSON.stringify(wrap(thread(["fine"]), 7));
    await writeRaw(dir, THREAD, live);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["older"]), 3)));

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result).toMatchObject({ status: "skipped", reason: "live-valid" });
    expect(await readRaw(dir, THREAD)).toBe(live);
    expect(healLogs()).toHaveLength(0);
  });

  it("refuses when no sibling passes validation", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, "{ also broken");

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result).toMatchObject({ status: "skipped", reason: "no-valid-sibling" });
    expect(await readRaw(dir, THREAD)).toBe(BROKEN);
    expect(await names(dir)).not.toContain(expect.stringContaining(".unreadable-"));
  });

  it("refuses a sibling whose revision is older than what the live header still shows", async () => {
    const dir = createMemoryDirectory("threads");
    // Parseable envelope, revision 9, tampered hash => invalid, but its header is readable.
    const tampered = wrap(thread(["live"]), 8);
    tampered.metadata.contentHash = "deadbeef";
    const liveText = JSON.stringify(tampered);
    await writeRaw(dir, THREAD, liveText);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["old"]), 2)));

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result).toMatchObject({ status: "skipped", reason: "sibling-older" });
    expect(await readRaw(dir, THREAD)).toBe(liveText);
  });

  it("writes nothing in read-only mode", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a"]), 4)));
    const before = await names(dir);
    setReadOnlyMode(true);

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result).toMatchObject({ status: "skipped", reason: "read-only" });
    expect(await readRaw(dir, THREAD)).toBe(BROKEN);
    expect(await names(dir)).toEqual(before);
  });

  it("examines a file once per session", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a"]), 4)));
    const options = { nowMs: AGED(), recheckDelayMs: 0 };

    expect((await healFileFromSibling(dir, THREAD, options)).status).toBe("healed");
    expect(await healFileFromSibling(dir, THREAD, options)).toMatchObject({
      status: "skipped",
      reason: "already-checked",
    });
    expect(healLogs()).toHaveLength(1);
  });

  it("logs a write failure and returns failed without throwing, keeping the archive", async () => {
    const dir = createMemoryDirectory("threads");
    await writeRaw(dir, THREAD, BROKEN);
    await writeRaw(dir, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a"]), 4)));
    setSimulatedFaults(dir, [
      { operation: "createWritable", name: THREAD, errorName: "NoModificationAllowedError", times: Number.POSITIVE_INFINITY },
      { operation: "close", name: THREAD, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await healFileFromSibling(dir, THREAD, { nowMs: AGED(), recheckDelayMs: 0 });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.archivedAs).toBeDefined();
    expect(await readRaw(dir, result.archivedAs!)).toBe(BROKEN);
    expect(healLogs()).toHaveLength(1);
    expect(healLogs()[0]!.message).toContain("Could not heal");
  });
});

describe("boot scan sibling heal", () => {
  async function seededWorkspace() {
    // Unique root name per test: workspace-path caches are keyed by it.
    const root = createMemoryDirectory(`workspace-${++workspaceCounter}`);
    const threads = await getFeedbackThreadsDir(root, true);
    await writeRaw(threads, THREAD, BROKEN);
    await writeRaw(threads, `${THREAD}.tmp`, JSON.stringify(wrap(thread(["a", "b"]), 4)));
    // A rebuildable cache that must never be healed from a sibling.
    await writeRaw(threads, "threads.index.json", BROKEN);
    await writeRaw(threads, "threads.index.json.tmp", JSON.stringify(wrap({ threads: [] }, 9)));
    return { root, threads };
  }

  it("heals, reports, and records the action in the action log — never the excluded cache", async () => {
    const { root, threads } = await seededWorkspace();

    // The .tmp written just now is inside the freshness window, so age the clock.
    const report = await runBootIntegrityScan(root, {
      siblingHeal: { actor: "admin", nowMs: AGED() },
    });

    expect(report.findings.filter((f) => f.outcome === "repaired").map((f) => f.subject)).toEqual([
      THREAD,
    ]);
    expect(await readRaw(threads, "threads.index.json")).toBe(BROKEN);
    const read = await safeReadJson(threads, THREAD, { siblingFallback: false });
    expect(read.ok).toBe(true);

    const actions = await readWorkspaceActions(root);
    const healed = actions.filter((entry) => entry.action === "file-auto-healed");
    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({ actor: "admin", actorRole: "admin", target: THREAD });
    expect(healLogs().length).toBeGreaterThanOrEqual(1);
  });

  it("does not heal twice across two boots in one session", async () => {
    const { root } = await seededWorkspace();
    const siblingHeal = { actor: "admin", nowMs: AGED() };
    await runBootIntegrityScan(root, { siblingHeal });
    const second = await runBootIntegrityScan(root, { siblingHeal });
    expect(second.findings.filter((f) => f.outcome === "repaired")).toHaveLength(0);
    const healed = (await readWorkspaceActions(root)).filter((e) => e.action === "file-auto-healed");
    expect(healed).toHaveLength(1);
  });

  it("repairs nothing unless the caller opts in (the non-admin path never passes it)", async () => {
    const { root, threads } = await seededWorkspace();
    await runBootIntegrityScan(root);
    expect(await readRaw(threads, THREAD)).toBe(BROKEN);
  });

  it("only an admin session on a ready, non-demo workspace runs the scan", () => {
    const base = { mode: "workspace", hasWorkspace: true, workspaceReady: true };
    expect(shouldRunBootIntegrityScan({ ...base, role: "admin" })).toBe(true);
    for (const role of ["manager", "supervisor", "employee", "guest"]) {
      expect(shouldRunBootIntegrityScan({ ...base, role })).toBe(false);
    }
    expect(shouldRunBootIntegrityScan({ ...base, role: "admin", mode: "demo" })).toBe(false);
    expect(shouldRunBootIntegrityScan({ ...base, role: "admin", workspaceReady: false })).toBe(false);
    expect(shouldRunBootIntegrityScan({ ...base, role: "admin", hasWorkspace: false })).toBe(false);
  });

  it("picks only live .json names that have a .tmp/.bak sibling, .tmp holders first", () => {
    expect(
      pickSiblingHealCandidates([
        "a.json",
        "a.json.bak",
        "b.json",
        "b.json.tmp",
        "c.json",
        "threads.index.json",
        "threads.index.json.tmp",
        "d.json.bak",
        "e.txt",
        "e.txt.tmp",
      ])
    ).toEqual(["b.json", "a.json"]);
  });
});
