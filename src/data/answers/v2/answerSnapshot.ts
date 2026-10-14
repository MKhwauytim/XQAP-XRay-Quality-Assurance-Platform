// src/data/answers/v2/answerSnapshot.ts
//
// Layout v2 (spec 2026-10-13 §4/§5): the per-assignee snapshot and the PURE
// fold that resumes it with the live delta. No I/O here.
import {
  ANSWER_DERIVE_VERSION,
  answerEventSetIdFromIds,
  compareAnswerEventsForFold,
  foldAnswerEvents,
  type AnswerEvent,
  type AnswerFoldMarker,
  type AnswerFoldResult,
  type AnswerLegacySeed,
  type FoldAnswerEventsOptions,
} from "../answerEventStore";
import type { ItemAnswer } from "../answerTypes";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";

export const ANSWER_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * `{assignee}/snapshot.json`'s payload (wrapped in a JsonEnvelope on disk).
 *
 * Spec §4's fields, plus three it implies but does not name, without which the
 * snapshot is not RESUMABLE by `foldAnswerEvents`: `seeded` (§8's migration
 * marker state), `markers` (late-event guard), `foldedEventIds` (dedup of a
 * retried append whose copy lands in a later segment).
 */
export type AnswerSnapshot = {
  schemaVersion: typeof ANSWER_SNAPSHOT_SCHEMA_VERSION;
  assignee: string;
  monthFolderName: string;
  items: ItemAnswer[];
  legacySeed: AnswerLegacySeed;
  /** Bytes already inside `items`, per segment. Bare key = a segment in `{assignee}/` or `{assignee}/archive/`; `_archive-v1/{name}` = a v1 flat segment. */
  foldedOffsets: Record<string, number>;
  foldedEventCount: number;
  revision: number;
  compactedAt: string;
  compactedBy: string;
  seeded: boolean;
  markers: Record<string, AnswerFoldMarker>;
  foldedEventIds: string[];
  _writeToken?: string;
};

export type AnswerSnapshotDraft = Omit<AnswerSnapshot, "revision" | "_writeToken">;

export type SnapshotProvenance = {
  assignee: string;
  monthFolderName: string;
  legacySeed: AnswerLegacySeed;
  foldedOffsets: Record<string, number>;
  compactedAt: string;
  compactedBy: string;
};

export type FoldFn = (events: readonly AnswerEvent[], options: FoldAnswerEventsOptions) => AnswerFoldResult;

export function v1OffsetKey(segmentName: string): string {
  return `${ANSWER_EVENTS_FOLDERS.archiveV1}/${segmentName}`;
}

export function isV1OffsetKey(key: string): boolean {
  return key.startsWith(`${ANSWER_EVENTS_FOLDERS.archiveV1}/`);
}

export function snapshotDraftFromFold(fold: AnswerFoldResult, provenance: SnapshotProvenance): AnswerSnapshotDraft {
  return {
    schemaVersion: ANSWER_SNAPSHOT_SCHEMA_VERSION,
    assignee: provenance.assignee,
    monthFolderName: provenance.monthFolderName,
    items: fold.file.items,
    legacySeed: { contentHash: provenance.legacySeed.contentHash, items: [...provenance.legacySeed.items] },
    foldedOffsets: { ...provenance.foldedOffsets },
    foldedEventCount: fold.foldedEventIds.length,
    compactedAt: provenance.compactedAt,
    compactedBy: provenance.compactedBy,
    seeded: fold.seeded,
    markers: { ...fold.markers },
    foldedEventIds: [...fold.foldedEventIds],
  };
}

export function snapshotAsResume(snapshot: AnswerSnapshotDraft): AnswerFoldResult {
  return {
    file: {
      username: snapshot.assignee,
      monthFolderName: snapshot.monthFolderName,
      items: snapshot.items.map((item) => ({ ...item })),
    },
    markers: { ...snapshot.markers },
    seeded: snapshot.seeded,
    foldedEventIds: [...snapshot.foldedEventIds],
    eventSetId: answerEventSetIdFromIds(snapshot.foldedEventIds),
    deriveVersion: ANSWER_DERIVE_VERSION,
    refusals: [],
    dropped: [],
  };
}

/** The greatest fold key already folded, as a probe event; "unknown" for a marker missing its order fields. */
function lastFoldedProbe(markers: Readonly<Record<string, AnswerFoldMarker>>): AnswerEvent | null | "unknown" {
  let last: AnswerEvent | null = null;
  for (const [xrayImageId, marker] of Object.entries(markers)) {
    if (!marker.lastEventId || !marker.lastAuthority) return "unknown";
    const probe: AnswerEvent = {
      eventId: marker.lastEventId,
      eventType: "item-saved",
      eventAt: marker.lastEventAt,
      eventBy: "",
      authority: marker.lastAuthority,
      xrayImageId,
    };
    if (last === null || compareAnswerEventsForFold(probe, last) > 0) last = probe;
  }
  return last;
}

export type SnapshotDeltaFold =
  | { kind: "resumed"; result: AnswerFoldResult }
  | { kind: "late"; lateEventId: string };

export function foldSnapshotPlusDelta(
  snapshot: AnswerSnapshotDraft | null,
  delta: readonly AnswerEvent[],
  options: { legacySeed: AnswerLegacySeed; username: string; monthFolderName: string; foldFn?: FoldFn }
): SnapshotDeltaFold {
  const fold = options.foldFn ?? foldAnswerEvents;
  const base = {
    legacySeed: snapshot?.legacySeed ?? options.legacySeed,
    username: options.username,
    monthFolderName: options.monthFolderName,
  };
  if (!snapshot || snapshot.foldedEventIds.length === 0) return { kind: "resumed", result: fold(delta, base) };
  const known = new Set(snapshot.foldedEventIds);
  const last = lastFoldedProbe(snapshot.markers);
  for (const event of delta) {
    if (known.has(event.eventId)) continue;
    if (event.eventType === "migration-seed") {
      // Applied as the BASELINE by a full fold; only harmless when it seeds nothing or the chain is already seeded.
      if (!snapshot.seeded && (event.legacyContentHash ?? "") !== "") return { kind: "late", lateEventId: event.eventId };
      continue;
    }
    if (last === "unknown" || (last !== null && compareAnswerEventsForFold(event, last) < 0)) {
      return { kind: "late", lateEventId: event.eventId };
    }
  }
  return { kind: "resumed", result: fold(delta, { ...base, resume: snapshotAsResume(snapshot) }) };
}
