import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { DistributionEvent } from "./distributionTypes";

export const DISTRIBUTION_EVENTS_DIR = "distribution.events";

type DirectoryEntryLike = { kind: "file" | "directory"; name: string };

function getDirectoryEntries(dir: DirectoryHandleLike): AsyncIterable<DirectoryEntryLike> | null {
  const candidate = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };
  if (candidate.values) return candidate.values();
  if (candidate.entries) {
    const entries = candidate.entries();
    return (async function* () {
      for await (const [, entry] of entries) yield entry;
    })();
  }
  if (candidate[Symbol.asyncIterator]) return candidate as AsyncIterable<DirectoryEntryLike>;
  return null;
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

  const entries = getDirectoryEntries(eventsDir);
  if (!entries) return [];
  const events: DistributionEvent[] = [];
  for await (const entry of entries) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const result = await safeReadJson<DistributionEvent>(eventsDir, entry.name);
    if (!result.ok) {
      throw new Error(`Cannot read immutable distribution event: ${entry.name}`);
    }
    events.push(result.value);
  }
  return events.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
}

export function distributionEventSetId(events: DistributionEvent[]): string {
  const ids = [...new Set(events.map((event) => event.eventId))].sort();
  // Exact length-prefixed identity, not a short non-cryptographic hash: cache
  // correctness must not depend on accepting a collision probability.
  return `${ids.length}:${ids.map((id) => `${id.length}:${id}`).join("")}`;
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
