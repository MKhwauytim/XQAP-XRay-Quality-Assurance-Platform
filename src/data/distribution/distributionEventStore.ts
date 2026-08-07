import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { readJsonDirectory, readSegmentTails } from "../storage/directoryScan";
import { withResourceLock } from "../storage/webLocks";
import type { DistributionEvent } from "./distributionTypes";

export const DISTRIBUTION_EVENTS_DIR = "distribution.events";
/** Per-writer-session append-only segment file suffix (perf: replaces one-file-per-event durability). */
export const DISTRIBUTION_EVENT_SEGMENT_SUFFIX = ".ndjson";

const DEVICE_ID_STORAGE_KEY = "xray_distribution_device_id_v1";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Cached fallback for the no-localStorage branch below (private browsing, a
// non-browser test environment, a throwing storage quota, ...). Without this,
// every call that can't reach localStorage would mint a brand-new random id,
// which would fragment every single write into its own segment file within
// ONE app session -- silently defeating the entire point of this change (one
// file per writer SESSION, not per event) for exactly the users this is
// least safe for (already-degraded storage).
let ephemeralDeviceId: string | null = null;

/**
 * Stable per-machine id, persisted in localStorage. Combined with a fresh
 * per-app-session id (below), this is the unit of write uniqueness that
 * replaces per-event ids: two machines -- or two tabs on the same machine --
 * never share a segment file, so concurrent writers still never target the
 * same file (see module doc on appendDistributionEventSegment).
 */
export function getDistributionDeviceId(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    ephemeralDeviceId ??= `ephemeral-${randomId()}`;
    return ephemeralDeviceId;
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = randomId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    ephemeralDeviceId ??= `ephemeral-${randomId()}`;
    return ephemeralDeviceId;
  }
}

/** @internal test-only — forces a fresh ephemeral fallback id on the next getDistributionDeviceId() call (only affects the no-localStorage branch). */
export function __resetDistributionDeviceIdForTests(): void {
  ephemeralDeviceId = null;
}

let currentSessionId: string | null = null;

/** Fresh per app session (module load) — never persisted, so a page reload always starts a new segment file. */
export function getDistributionSessionId(): string {
  if (!currentSessionId) currentSessionId = randomId();
  return currentSessionId;
}

/** @internal test-only — forces a fresh session id on the next getDistributionSessionId() call. */
export function __resetDistributionSessionIdForTests(): void {
  currentSessionId = null;
}

function segmentIdPart(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error(`Invalid distribution writer id component: ${value}`);
  }
  return value;
}

export function distributionEventSegmentFileName(deviceId: string, sessionId: string): string {
  return `${segmentIdPart(deviceId)}-${segmentIdPart(sessionId)}${DISTRIBUTION_EVENT_SEGMENT_SUFFIX}`;
}

function encodeEventLine(event: DistributionEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function decodeEventLines(text: string, segmentName: string): DistributionEvent[] {
  const events: DistributionEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as DistributionEvent);
    } catch {
      throw new Error(`Cannot parse distribution event segment: ${segmentName}`);
    }
  }
  return events;
}

/**
 * Append a whole batch of events to the CURRENT writer session's own NDJSON
 * segment file (distribution.events/{deviceId}-{sessionId}.ndjson) in ONE
 * write, replacing the old one-file-per-event durability path
 * (writeImmutableDistributionEvent below, still kept for reading legacy
 * files — see loadImmutableDistributionEvents). deviceId+sessionId is unique
 * per running app instance, so this file is never written by any other
 * concurrent writer — uniqueness moved from per-event to per-writer-session.
 *
 * The Like-handle contract in fileSystemAccess.ts (intentionally, per its own
 * scope) exposes no positional/append write primitive, so a full-content
 * rewrite (read existing text, concatenate, write back) is the only way to
 * add lines through it. That is still the intended win: ONE write call for
 * the whole batch instead of one per event — see CLAUDE.md's task brief.
 */
export async function appendDistributionEventSegment(
  distributionDir: DirectoryHandleLike,
  events: DistributionEvent[],
  writer: { deviceId: string; sessionId: string } = {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
  }
): Promise<void> {
  if (events.length === 0) return;
  const eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  const fileName = distributionEventSegmentFileName(writer.deviceId, writer.sessionId);

  // A read-modify-write full-file rewrite is only race-free against OTHER
  // writer sessions (different deviceId/sessionId, hence a different file).
  // Within THIS session, two overlapping batch calls (e.g. two independent
  // UI actions firing close together) would otherwise both read the same
  // "existing" content and the second write would silently clobber the
  // first's lines. Lock per file name -- same mechanism safeWriteJson already
  // uses for its own files -- to serialize same-segment writes; distinct
  // segment files (distinct sessions/devices) never contend on this lock.
  await withResourceLock(`${DISTRIBUTION_EVENTS_DIR}/${fileName}`, async () => {
    let existing = "";
    try {
      const existingHandle = await eventsDir.getFileHandle(fileName, { create: false });
      existing = await (await existingHandle.getFile()).text();
    } catch {
      // No prior content for this writer session yet — start from empty.
    }
    const appended = existing + events.map(encodeEventLine).join("");

    const handle = await eventsDir.getFileHandle(fileName, { create: true });
    if (!handle.createWritable) {
      throw new Error(`Browser cannot write ${fileName}.`);
    }
    const writable = await handle.createWritable();
    await writable.write(appended);
    await writable.close();

    // Chrome's close() already finalizes the write (swap-file + verification
    // pipeline — see CLAUDE.md's task brief on Chromium bug 40899722). Replace
    // the old read-and-parse verification with a cheap existence/size check
    // that still catches silent truncation on a flaky network share, without
    // paying to re-read and re-parse the whole (now much larger) segment file.
    const verifyHandle = await eventsDir.getFileHandle(fileName, { create: false });
    const verifyFile = await verifyHandle.getFile();
    const expectedBytes = new TextEncoder().encode(appended).length;
    if (verifyFile.size !== expectedBytes) {
      throw new Error(`Distribution event segment write verification failed: ${fileName}`);
    }
  });
}

export type SegmentEventsDelta = {
  /** Newly-read events since `knownOffsets` (not globally sorted — callers sort). */
  events: DistributionEvent[];
  /** Updated byte offset per segment file name (== current file size); persist this as the next call's knownOffsets. */
  offsets: Record<string, number>;
  /** Every segment file name seen in this listing. */
  segmentNames: string[];
};

/**
 * Read only the event lines appended past each segment's previously-known
 * byte offset (perf: fold-checkpoint). Passing `{}` reads every segment from
 * the start — the same function serves both a cold (full) read and a warm
 * (incremental) one.
 */
export async function readDistributionEventSegmentDelta(
  distributionDir: DirectoryHandleLike,
  knownOffsets: Record<string, number>
): Promise<SegmentEventsDelta> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch {
    return { events: [], offsets: { ...knownOffsets }, segmentNames: [] };
  }

  const { tailTextByName, sizeByName, matchedNames } = await readSegmentTails(eventsDir, {
    suffix: DISTRIBUTION_EVENT_SEGMENT_SUFFIX,
    knownOffsets,
  });

  const events: DistributionEvent[] = [];
  for (const name of matchedNames) {
    const tailText = tailTextByName.get(name);
    if (tailText) events.push(...decodeEventLines(tailText, name));
  }

  const offsets: Record<string, number> = { ...knownOffsets };
  for (const [name, size] of sizeByName) offsets[name] = size;

  return { events, offsets, segmentNames: matchedNames };
}

/** Full cold read of every segment file — for callers (loadDistributionLog) that need the complete raw merged event list rather than a checkpoint delta. */
export async function loadDistributionEventSegments(
  distributionDir: DirectoryHandleLike
): Promise<DistributionEvent[]> {
  const { events } = await readDistributionEventSegmentDelta(distributionDir, {});
  return events;
}

function eventFileName(eventId: string): string {
  // Generated event ids are UUID-based. Rejecting instead of sanitizing avoids
  // two distinct ids mapping to one file and silently overwriting each other.
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(eventId)) {
    throw new Error(`Invalid distribution event id: ${eventId}`);
  }
  return `${eventId}.json`;
}

function sameEvent(left: DistributionEvent, right: DistributionEvent): boolean {
  return left.eventId === right.eventId
    && left.eventType === right.eventType
    && (left.eventSchemaVersion ?? 1) === (right.eventSchemaVersion ?? 1)
    && left.xrayImageId === right.xrayImageId
    && left.assignedTo === right.assignedTo
    && left.replacedById === right.replacedById
    && left.reassignedTo === right.reassignedTo
    && left.eventAt === right.eventAt
    && left.eventBy === right.eventBy
    && left.notes === right.notes
    && left.dailyQuota === right.dailyQuota
    && left.daysRemainingAtAssignment === right.daysRemainingAtAssignment
    && left.sourceRequestId === right.sourceRequestId;
}

/**
 * Persist an event as an immutable, uniquely named file.
 *
 * This removes the shared mutable log from the durability path: writers using
 * different event ids never target the same file. File System Access still has
 * no distributed transaction primitive, so a duplicate id with different
 * content is rejected rather than pretending an exactly-once guarantee.
 */
export async function writeImmutableDistributionEvent(
  distributionDir: DirectoryHandleLike,
  event: DistributionEvent
): Promise<void> {
  const eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  const fileName = eventFileName(event.eventId);
  const existing = await safeReadJson<DistributionEvent>(eventsDir, fileName);
  if (existing.ok) {
    if (sameEvent(existing.value, event)) return;
    throw new Error(`Distribution event id collision: ${event.eventId}`);
  }
  if (existing.reason === "corrupt") {
    throw new Error(`Distribution event file is corrupt: ${fileName}`);
  }

  await safeWriteJson(eventsDir, fileName, event);
  const verify = await safeReadJson<DistributionEvent>(eventsDir, fileName);
  if (!verify.ok || !sameEvent(verify.value, event)) {
    throw new Error(`Distribution event verification failed: ${event.eventId}`);
  }
}

export async function loadImmutableDistributionEvents(
  distributionDir: DirectoryHandleLike
): Promise<DistributionEvent[]> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch {
    return [];
  }

  const { values } = await readJsonDirectory<DistributionEvent>(eventsDir, {
    suffix: ".json",
    onUnreadable: "throw",
    unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
  });
  return values.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
}

/**
 * Same identity as distributionEventSetId, computed directly from ids so a
 * checkpoint holding `knownEventIds` (already-folded ids, small in-memory
 * array manipulation) can extend it without re-reading every event file.
 */
export function distributionEventSetIdFromIds(ids: Iterable<string>): string {
  const sorted = [...new Set(ids)].sort();
  // Exact length-prefixed identity, not a short non-cryptographic hash: cache
  // correctness must not depend on accepting a collision probability.
  return `${sorted.length}:${sorted.map((id) => `${id.length}:${id}`).join("")}`;
}

export function distributionEventSetId(events: DistributionEvent[]): string {
  return distributionEventSetIdFromIds(events.map((event) => event.eventId));
}

export function mergeDistributionEvents(
  compatibilityEvents: DistributionEvent[],
  immutableEvents: DistributionEvent[]
): DistributionEvent[] {
  const byId = new Map<string, DistributionEvent>();
  const orderedBase: DistributionEvent[] = [];
  for (const event of compatibilityEvents) {
    const existing = byId.get(event.eventId);
    if (existing && !sameEvent(existing, event)) {
      throw new Error(`Distribution event id has conflicting content: ${event.eventId}`);
    }
    if (!existing) orderedBase.push(event);
    byId.set(event.eventId, event);
  }
  for (const event of immutableEvents) {
    const existing = byId.get(event.eventId);
    if (existing && !sameEvent(existing, event)) {
      throw new Error(`Distribution event id has conflicting content: ${event.eventId}`);
    }
    byId.set(event.eventId, event);
  }

  // Preserve the historical log order. Events missing from that projection are
  // concurrent/new immutable writes and get a deterministic timestamp/id order.
  const compatibilityIds = new Set(compatibilityEvents.map((event) => event.eventId));
  const additionIds = new Set<string>();
  const additions = immutableEvents
    .filter((event) => {
      if (compatibilityIds.has(event.eventId) || additionIds.has(event.eventId)) return false;
      additionIds.add(event.eventId);
      return true;
    })
    .sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
  return [...orderedBase, ...additions];
}
