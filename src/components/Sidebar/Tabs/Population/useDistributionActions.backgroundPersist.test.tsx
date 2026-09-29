/* @vitest-environment jsdom */
// R1 (lane R, reassign click-path performance): the DERIVED files are persisted
// off the click path.
//
// `refreshDistribution` used to `await saveDistributionCurrent` — the whole
// `distribution.current.json` + fold-checkpoint sidecar + every employee mirror
// rewrite — before a single-row reassign returned. Those are all rebuildable
// (the immutable events are the source of truth and are still committed before
// the click resolves), so they now go on a per-month serialized, coalescing
// background chain. This file pins the three contracts that make that safe:
//
//  1. the click does not wait for them;
//  2. once the chain has been flushed, every file on disk is byte-equal to what
//     the synchronous version wrote (`toMatchSnapshot`, captured BEFORE the
//     change — see the .snap file);
//  3. a reader that arrives mid-window still gets a correct answer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../../../../data/storage/fileSystemAccess";
import { registerDirectoryPath } from "../../../../data/storage/webLocks";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import * as DS from "../../../../data/distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../../../../data/distribution/distributionLog";
import { formatMonthFolderName } from "../../../../data/population/monthFolder";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { loadEmployeeSampleMirror, isMirrorTrustedForEvents } from "../../../../data/samples/sampleMirrorStorage";
import { useDistributionActions } from "./useDistributionActions";

const MONTH = formatMonthFolderName(5, 2026);
const OWNERS = ["jalgahamdi", "hihaloraini", "saalhijji"];
const ROW_IDS = Array.from({ length: 12 }, (_, i) => `A${String(i + 1).padStart(3, "0")}`);

async function flushPersist(): Promise<void> {
  await DS.flushPendingDistributionProjectionWrites();
  await DS.flushPendingDistributionPersist();
}

beforeEach(() => {
  DS.__clearDeriveMemoForTests();
});
afterEach(async () => {
  gate?.release(); // a failed test must not leave writes held for the next one
  await flushPersist();
  cleanup();
});


// ── a share whose DERIVED-file writes can be held open, and that logs them ──
/** Names of the DERIVED files a click may not wait on. */
const DERIVED = /^(distribution\.current\.json|distribution\.checkpoint\.json|_index\.json|.+\.samples\.json)$/;
type Gate = { writes: string[]; hold: boolean; waiters: Array<() => void>; release(): void };
function makeGate(): Gate {
  const gate: Gate = {
    writes: [],
    hold: false,
    waiters: [],
    release() {
      gate.hold = false;
      for (const w of gate.waiters.splice(0)) w();
    },
  };
  return gate;
}
function gatedFile(fh: FileHandleLike, gate: Gate): FileHandleLike {
  const out: FileHandleLike = { kind: "file", name: fh.name, getFile: () => fh.getFile() };
  if (fh.createWritable) {
    const create = fh.createWritable.bind(fh);
    out.createWritable = async () => {
      if (DERIVED.test(fh.name)) {
        gate.writes.push(fh.name);
        if (gate.hold) await new Promise<void>((resolve) => gate.waiters.push(resolve));
      }
      return create();
    };
  }
  return out;
}
function gatedDir(dir: DirectoryHandleLike, gate: Gate, path: string): DirectoryHandleLike {
  const inner = dir as DirectoryHandleLike & { values(): AsyncIterable<{ kind: string; name: string }> };
  const out = {
    kind: "directory" as const,
    name: dir.name,
    getFileHandle: async (name: string, o?: { create?: boolean }) => gatedFile(await dir.getFileHandle(name, o), gate),
    getDirectoryHandle: async (name: string, o?: { create?: boolean }) =>
      gatedDir(await dir.getDirectoryHandle(name, o), gate, `${path}/${name}`),
    removeEntry: (name: string, o?: { recursive?: boolean }) => dir.removeEntry!(name, o),
    queryPermission: dir.queryPermission?.bind(dir),
    requestPermission: dir.requestPermission?.bind(dir),
    values: async function* () {
      for await (const entry of inner.values()) {
        const e = entry as { kind: string; name: string };
        if (e.kind === "file") yield gatedFile(e as unknown as FileHandleLike, gate);
        else yield gatedDir(e as unknown as DirectoryHandleLike, gate, `${path}/${e.name}`);
      }
    },
  };
  registerDirectoryPath(out as DirectoryHandleLike, path);
  return out as DirectoryHandleLike;
}
let gate: Gate;

function makeSample(): SampleMasterData {
  return {
    drawnAt: "2026-05-05T08:00:00.000Z",
    drawnBy: "admin",
    rngSeed: "seed",
    portAllocations: [],
    stageAllocations: [],
    totalRequested: ROW_IDS.length,
    totalActual: ROW_IDS.length,
    certScanRequested: 0,
    nonCertScanRequested: ROW_IDS.length,
    certScanActual: 0,
    nonCertScanActual: ROW_IDS.length,
    rows: ROW_IDS.map((id) => ({ xrayImageId: id }) as SampleMasterData["rows"][number]),
  };
}

async function setupWorkspace() {
  gate = makeGate();
  const dir = gatedDir(createMemoryDirectory("root"), gate, "root");
  await saveMonthRun({
    directoryHandle: dir,
    month: 5,
    year: 2026,
    username: "admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    riskRawRows: ROW_IDS.map((id) => ({ id })),
    biRawRows: [],
    processedRows: ROW_IDS.map((id) => ({ xrayImageId: id, certScanStatus: "NonCertscan" })),
    certScanRows: 0,
    nonCertScanRows: ROW_IDS.length,
  });
  await saveSampleMaster(dir, MONTH, makeSample());
  return dir;
}

function renderActions(dir: DirectoryHandleLike) {
  const sample = makeSample();
  return renderHook(() =>
    useDistributionActions({
      directoryHandle: dir,
      sampleDrawResult: sample,
      saveMonth: 5,
      saveYear: 2026,
      canDistributeSamples: true,
      canBulkAssign: true,
      currentUsername: "admin",
      currentRole: "admin",
      onDistributionChanged: () => {},
    })
  );
}

async function distribute(hook: ReturnType<typeof renderActions>): Promise<void> {
  await act(async () => {
    await hook.result.current.handleApplyBulkAssignment(
      ROW_IDS.map((id, i) => buildAssignEvent({ xrayImageId: id, assignedTo: OWNERS[i % OWNERS.length]!, eventBy: "admin" }))
    );
  });
  await flushPersist();
}

// ── deterministic dump of everything the month owns on disk ─────────────────
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;
function normalize(text: string): string {
  const ids = new Map<string, string>();
  return text
    .replace(UUID, (id) => {
      if (!ids.has(id)) ids.set(id, `<uuid${ids.size + 1}>`);
      return ids.get(id)!;
    })
    .replace(ISO, "<ts>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{6}\.ndjson/g, "<segment>.ndjson")
    .replace(/"(contentHash|eventSetId|_writeToken|writtenAt)":\s*"[^"]*"/g, '"$1":"<x>"')
    .replace(/"legacyFilesDigest":\s*"[^"]*"/g, '"legacyFilesDigest":"<x>"');
}
async function dump(dir: DirectoryHandleLike, path: string, out: Record<string, string>): Promise<void> {
  const entries: Array<{ kind: string; name: string; handle: unknown }> = [];
  for await (const entry of (dir as unknown as { values(): AsyncIterable<{ kind: string; name: string }> }).values()) {
    entries.push({ kind: entry.kind, name: entry.name, handle: entry });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = `${path}/${entry.name}`;
    if (entry.kind === "directory") {
      await dump(entry.handle as DirectoryHandleLike, full, out);
    } else if (!/\.(tmp|bak|xlsx)$/.test(entry.name)) {
      const file = await (entry.handle as { getFile(): Promise<Blob> }).getFile();
      out[normalize(full)] = normalize(await file.text());
    }
  }
}
async function snapshotMonth(dir: DirectoryHandleLike): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const samples = await dir.getDirectoryHandle("2-samples");
  await dump(await samples.getDirectoryHandle(MONTH), "2-samples", out);
  return out;
}

/** Run one click with every derived-file write held open; resolves false if the click itself blocks on them. */
async function clickWithDerivedWritesHeld(click: () => Promise<void>): Promise<boolean> {
  gate.hold = true;
  let resolved = false;
  await act(async () => {
    resolved = await Promise.race([
      click().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_500)),
    ]);
  });
  return resolved;
}

describe("R1: cache, sidecar and mirrors persist off the click path", () => {
  it("a single-row reassign resolves while every derived-file write is still held open, and the events are already durable", async () => {
    const dir = await setupWorkspace();
    const hook = renderActions(dir);
    await distribute(hook);

    const resolved = await clickWithDerivedWritesHeld(() => hook.result.current.handleReassign(ROW_IDS[0]!, "hihaloraini"));
    expect(resolved).toBe(true);
    // Source of truth first: the reassign is already in the event store.
    const log = await DS.loadDistributionLog(dir, MONTH);
    const fold = deriveCurrentDistribution(log, makeSample().rows);
    expect(fold.entries.find((e) => e.xrayImageId === ROW_IDS[0])?.assignedTo).toBe("hihaloraini");
    // The tab still paints from the in-memory derive.
    expect(hook.result.current.distributionCurrent?.entries.find((e) => e.xrayImageId === ROW_IDS[0])?.assignedTo).toBe(
      "hihaloraini"
    );
    gate.release();
  });

  it("after the flush every file the month owns is byte-equal to the synchronous version", async () => {
    const dir = await setupWorkspace();
    const hook = renderActions(dir);
    await distribute(hook);
    await act(async () => {
      await hook.result.current.handleReassign(ROW_IDS[0]!, "hihaloraini");
    });
    await flushPersist();
    await act(async () => {
      await hook.result.current.handleReassign(ROW_IDS[3]!, "saalhijji");
    });
    await flushPersist();
    expect(await snapshotMonth(dir)).toMatchSnapshot();
  });

  it("coalesces a burst of reassigns into fewer background persists and converges on the last state", async () => {
    const dir = await setupWorkspace();
    const hook = renderActions(dir);
    await distribute(hook);
    gate.writes = [];
    gate.hold = true;
    for (const [i, owner] of [[0, "hihaloraini"], [3, "saalhijji"], [1, "saalhijji"]] as const) {
      await act(async () => {
        await hook.result.current.handleReassign(ROW_IDS[i]!, owner);
      });
    }
    gate.release();
    await flushPersist();

    // Three clicks, one running persist (held) plus at most one coalesced follow-up.
    const currentWrites = gate.writes.filter((n) => n === "distribution.current.json").length;
    expect(currentWrites).toBeGreaterThanOrEqual(1);
    expect(currentWrites).toBeLessThan(3);
    const master = await loadSampleMaster(dir, MONTH);
    const truth = deriveCurrentDistribution(await DS.loadDistributionLog(dir, MONTH), master!.rows);
    for (const owner of OWNERS) {
      const mirror = await loadEmployeeSampleMirror(dir, MONTH, owner);
      expect(mirror?.entries.map((e) => `${e.xrayImageId}:${e.status}`).sort()).toEqual(
        truth.entries.filter((e) => e.assignedTo === owner).map((e) => `${e.xrayImageId}:${e.status}`).sort()
      );
    }
  });

  it("a reader arriving mid-window gets a correct answer: the stale mirror is untrusted and the fold is right", async () => {
    const dir = await setupWorkspace();
    const hook = renderActions(dir);
    await distribute(hook);
    expect(await clickWithDerivedWritesHeld(() => hook.result.current.handleReassign(ROW_IDS[0]!, "hihaloraini"))).toBe(true);

    // Window open: the persist has not landed, so the on-disk mirror is pre-reassign.
    const master = await loadSampleMaster(dir, MONTH);
    const mirror = await loadEmployeeSampleMirror(dir, MONTH, "jalgahamdi");
    const stamp = await DS.readDistributionLogStamp(dir, MONTH);
    expect(mirror).not.toBeNull();
    expect(mirror!.entries.some((e) => e.xrayImageId === ROW_IDS[0])).toBe(true);
    expect(await isMirrorTrustedForEvents(dir, MONTH, mirror!, stamp.revision)).toBe(false);

    const read = await DS.loadOrDeriveDistributionCurrentForRead(dir, MONTH, master!.rows);
    expect(read?.entries.find((e) => e.xrayImageId === ROW_IDS[0])?.assignedTo).toBe("hihaloraini");
    expect(read?.entries.filter((e) => e.assignedTo === "jalgahamdi")).toHaveLength(3);

    // Window closed: the mirror is current and trusted again.
    gate.release();
    await flushPersist();
    const after = await loadEmployeeSampleMirror(dir, MONTH, "jalgahamdi");
    const stampAfter = await DS.readDistributionLogStamp(dir, MONTH);
    expect(await isMirrorTrustedForEvents(dir, MONTH, after!, stampAfter.revision)).toBe(true);
    expect(after!.entries.some((e) => e.xrayImageId === ROW_IDS[0])).toBe(false);
  });

  it("reports a pending persist so the delete-user guard never reads a stale zero", async () => {
    const dir = await setupWorkspace();
    const hook = renderActions(dir);
    await distribute(hook);
    expect(await clickWithDerivedWritesHeld(() => hook.result.current.handleReassign(ROW_IDS[0]!, "hihaloraini"))).toBe(true);
    expect(DS.isDistributionPersistPending(dir, MONTH)).toBe(true);
    gate.release();
    await flushPersist();
    expect(DS.isDistributionPersistPending(dir, MONTH)).toBe(false);
  });
});
