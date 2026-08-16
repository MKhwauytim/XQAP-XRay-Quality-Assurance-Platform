import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { createSimpleHasher } from "../storage/jsonEnvelope";
import { listDirectoryEntries, readJsonDirectory, readSegmentTails } from "../storage/directoryScan";
import { withResourceLock } from "../storage/webLocks";
import { taggedError } from "../storage/errorCodes";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  isNotFoundError,
  isNotReadableError,
  isTransientWriteError,
  logExhaustedNotFound,
  retryTransientWrite,
  waitFor,
} from "../storage/transientFileErrors";
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

/**
 * BOUNDED SEGMENT ROTATION — thresholds.
 *
 * The open segment is rewritten in full on every append (see
 * `appendDistributionEventSegment` for why the Like-handle contract leaves no
 * cheaper option), so the bytes pushed over the wire per append are
 * `currentSegmentSize + batchSize`. Without a cap that term grows with session
 * length: a 900-event session measured **129,763 bytes written per append**,
 * and it keeps climbing. Rotation caps it instead — a segment lives between 0
 * and MAX bytes, so the long-run average settles at ~MAX/2 no matter how many
 * events the session goes on to write.
 *
 * Why 128 KiB, and not the smaller/larger values also on the table:
 *
 * - The share cost of one append is `fixed round trips + payload`. Chromium's
 *   `createWritable` is swap-file based: open, write, close, atomic rename,
 *   plus this module's own post-close `verifySegmentSize` open — on the order
 *   of 20–40 ms of fixed latency on the UNC/SMB share this app is deployed to.
 *   128 KiB of payload at even a pessimistic 10 MB/s is ~13 ms, i.e. already a
 *   minority of the per-append cost. Halving the cap to 64 KiB would shave only
 *   a few ms off an append while doubling the file count, so the write side has
 *   clearly hit diminishing returns by here.
 * - Every extra segment costs the READ side a `getFile()` round trip per fold
 *   (`readSegmentTails` opens each matched name), and that cost is paid by every
 *   client on every fold, forever — segments are never merged. At ~258 bytes per
 *   event line (measured on a realistic event with an Arabic `notes` field),
 *   128 KiB holds ~500 events, so a 9,000-event month adds ~18 files. Raising
 *   the cap to 256 KiB would halve that but double both the worst-case single
 *   append and the amount of content sitting in one crash-exposed rewrite.
 *
 * The line cap is a second, cheap bound for the degenerate shape the byte cap
 * cannot see: it only binds when the average line is under ~65 bytes, which no
 * real `DistributionEvent` reaches. It is belt-and-braces against a future,
 * much smaller event shape making a segment expensive to parse and dedupe
 * rather than expensive to transfer — not a threshold expected to fire today.
 */
export const MAX_OPEN_SEGMENT_BYTES = 131_072;
export const MAX_OPEN_SEGMENT_LINES = 2_000;

/**
 * Upper bound on the rotation counter. A writer that somehow reached this would
 * have written ~128 GiB in one session; the cap exists so a corrupt/hostile
 * name can never be parsed into an unbounded number, not because it is
 * reachable.
 */
const MAX_SEGMENT_SEQ = 999_999;

function segmentBaseName(deviceId: string, sessionId: string): string {
  return `${segmentIdPart(deviceId)}-${segmentIdPart(sessionId)}`;
}

function segmentFileNameForSeq(base: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEGMENT_SEQ) {
    throw new Error(`Invalid distribution segment sequence: ${seq}`);
  }
  // seq 0 IS the historical unsuffixed name, deliberately. A pre-rotation
  // writer's `{device}-{session}.ndjson` is then not a special case needing its
  // own branch anywhere — it is simply a chain whose first segment never
  // rotated, so it keeps being read AND appended to by the code below with no
  // migration, no rename, and no format flag. (Never renaming also protects the
  // two invariants the compatibility audit rests on: `foldCheckpoint`'s
  // `segmentOffsets` and `readAppendOnlyDirectory`'s sibling invalidation both
  // key on the file NAME, so a rename would read as "old name vanished, new
  // name at offset 0" and re-fold those events.)
  return seq === 0
    ? `${base}${DISTRIBUTION_EVENT_SEGMENT_SUFFIX}`
    : `${base}-${seq}${DISTRIBUTION_EVENT_SEGMENT_SUFFIX}`;
}

export function distributionEventSegmentFileName(
  deviceId: string,
  sessionId: string,
  seq = 0
): string {
  return segmentFileNameForSeq(segmentBaseName(deviceId, sessionId), seq);
}

/**
 * WRITER-SIDE ONLY name introspection: which sequence number, if any, this
 * name carries for THIS writer's own `{deviceId}-{sessionId}` chain.
 *
 * The READ path must never gain a filter like this — every reader discovers
 * segments through a pure `.ndjson` suffix glob (`readSegmentTails` →
 * `directoryScan`'s `entry.name.endsWith(suffix)`), and narrowing that to names
 * matching a `-\d+` shape would make older writers' files invisible and lose
 * their events. This function is deliberately confined to the writer deciding
 * where its OWN next line goes, and returns `null` for anything it does not
 * positively recognize (another writer's file, a stray name, a sequence with
 * leading zeros or out of range) so an unexpected shape can only ever make this
 * writer start a fresh chain, never claim someone else's file.
 */
function parseOwnSegmentSeq(name: string, base: string): number | null {
  if (!name.endsWith(DISTRIBUTION_EVENT_SEGMENT_SUFFIX)) return null;
  const stem = name.slice(0, -DISTRIBUTION_EVENT_SEGMENT_SUFFIX.length);
  if (stem === base) return 0;
  if (!stem.startsWith(`${base}-`)) return null;
  const tail = stem.slice(base.length + 1);
  if (!/^(0|[1-9][0-9]{0,5})$/.test(tail)) return null;
  const seq = Number(tail);
  return seq <= MAX_SEGMENT_SEQ ? seq : null;
}

/**
 * Highest sequence this writer chain already has on disk — how a writer that
 * lost its in-memory position (first append of a session, a workspace switch,
 * a module reload) resumes at the right place instead of overwriting.
 *
 * A listing failure resolves to 0 rather than throwing: the append that follows
 * always re-reads the segment it lands on before writing it (see
 * `appendDistributionEventSegment`), so the worst case of an under-read listing
 * is appending to an already-full segment, never losing a line.
 */
async function discoverHighestOwnSeq(
  eventsDir: DirectoryHandleLike,
  base: string
): Promise<number> {
  try {
    let highest = 0;
    for (const entry of await listDirectoryEntries(eventsDir)) {
      if (entry.kind !== "file") continue;
      const seq = parseOwnSegmentSeq(entry.name, base);
      if (seq !== null && seq > highest) highest = seq;
    }
    return highest;
  } catch {
    return 0;
  }
}

const utf8 = new TextEncoder();

function utf8Length(text: string): number {
  return utf8.encode(text).length;
}

function countLines(text: string): number {
  let lines = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    lines += 1;
  }
  return lines;
}

/**
 * Seal the open segment and start the next one?
 *
 * An EMPTY segment never rotates — otherwise a single batch larger than the cap
 * would rotate forever without ever landing. Oversized batches therefore get
 * their own segment and are allowed to exceed the cap once; the next append
 * rotates away from it.
 *
 * A segment found already at or over the cap on startup takes the same branch:
 * `existingBytes + addedBytes` exceeds the cap, so the first append of the
 * resuming writer rotates to `seq + 1` instead of growing it further.
 */
function shouldRotate(existing: string, existingBytes: number, addedBytes: number, addedLines: number): boolean {
  if (existingBytes === 0) return false;
  if (existingBytes + addedBytes > MAX_OPEN_SEGMENT_BYTES) return true;
  return countLines(existing) + addedLines > MAX_OPEN_SEGMENT_LINES;
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
 * The sequence number this writer chain's OPEN segment currently sits at,
 * per `{scopeId}|{deviceId}-{sessionId}`. Purely a round-trip saver: it lets
 * steady-state appends skip the directory listing that `discoverHighestOwnSeq`
 * would otherwise do. Losing it (a fresh session, a workspace switch, a module
 * reload) costs one listing and produces the same answer, and it is only ever
 * recorded for a segment a write actually landed in — so it can never point
 * ahead of what is on disk.
 */
const openSegmentSeqByWriter = new Map<string, number>();

/**
 * Append a whole batch of events to the CURRENT writer session's own OPEN
 * NDJSON segment, replacing the old one-file-per-event durability path
 * (writeImmutableDistributionEvent below, still kept for reading legacy
 * files — see loadImmutableDistributionEvents). deviceId+sessionId is unique
 * per running app instance, so this chain is never written by any other
 * concurrent writer — uniqueness moved from per-event to per-writer-session.
 *
 * The Like-handle contract in fileSystemAccess.ts (intentionally, per its own
 * scope) exposes no positional/append write primitive, so a full-content
 * rewrite (read existing text, concatenate, write back) is the only way to
 * add lines through it. Neither does the real File System Access API on a
 * user-picked directory: `createWritable({ keepExistingData: true })` is
 * implemented by copying the existing file into a swap file first, so a
 * "positional append" would pay the same O(file size) cost on the share while
 * being harder to verify. Genuinely append-only writes are available only via
 * `FileSystemSyncAccessHandle`, which is OPFS-only and cannot address the
 * workspace folder at all. So the rewrite stays — what changes here is that it
 * is now BOUNDED.
 *
 * BOUNDED SEGMENT ROTATION. The chain is
 * `{deviceId}-{sessionId}.ndjson` (seq 0), then `-1`, `-2`, … Only the highest
 * one is ever opened for writing; once the writer moves past a segment that
 * segment is sealed and is never rewritten, renamed, or deleted. So the rewrite
 * cost per append is bounded by MAX_OPEN_SEGMENT_BYTES instead of growing with
 * session length, while a reader still only ever tails one growing file per
 * writer session (the sealed ones stop changing size and stop producing tails).
 *
 * CRASH SAFETY. Sealing is not an operation — there is no seal marker, no
 * rename, and no second file touched during a rotation, so there is no
 * mid-rotation state to be caught in. A rotation is exactly one write of a new
 * name: it either landed (the events are durable in `seq+1`) or it did not (the
 * append reports failure to its caller, and the previous segment is untouched
 * either way). Two writers cannot end up appending to the same `seq` because
 * `deviceId`+`sessionId` is unique per running app instance and a crashed
 * process never resumes its own session id. And a resuming writer never
 * blind-overwrites: every append — including the one immediately after a
 * rotation — re-reads the file it is about to write and preserves whatever it
 * finds, so even a segment left behind by a crashed run or hidden from a stale
 * directory listing keeps its lines.
 */
export async function appendDistributionEventSegment(
  distributionDir: DirectoryHandleLike,
  events: DistributionEvent[],
  writer: SegmentWriter = {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
  }
): Promise<void> {
  if (events.length === 0) return;
  const eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  const base = segmentBaseName(writer.deviceId, writer.sessionId);
  const writerKey = segmentMemoKey(writer.scopeId, base);
  const addedText = events.map(encodeEventLine).join("");
  const addedBytes = utf8Length(addedText);

  // A read-modify-write full-file rewrite is only race-free against OTHER
  // writer sessions (different deviceId/sessionId, hence a different chain).
  // Within THIS session, two overlapping batch calls (e.g. two independent
  // UI actions firing close together) would otherwise both read the same
  // "existing" content and the second write would silently clobber the
  // first's lines. Lock per writer CHAIN -- not per file name -- so that the
  // rotation decision and the write it implies are one critical section:
  // locking per file would let two concurrent appends read the same full
  // segment, both decide to rotate, and race on `seq + 1`. Distinct chains
  // (distinct sessions/devices) never contend on this lock.
  await withResourceLock(`${DISTRIBUTION_EVENTS_DIR}/${base}`, async () => {
    let seq = openSegmentSeqByWriter.get(writerKey) ?? (await discoverHighestOwnSeq(eventsDir, base));
    let fileName = segmentFileNameForSeq(base, seq);
    let existing = await readExistingSegment(eventsDir, fileName, segmentMemoKey(writer.scopeId, fileName));
    let existingBytes = utf8Length(existing);

    if (seq < MAX_SEGMENT_SEQ && shouldRotate(existing, existingBytes, addedBytes, events.length)) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq);
      // Read the rotation target too. It is normally absent and this resolves
      // immediately (an unwritten segment is not in writtenSegmentsThisSession,
      // so a NotFoundError is taken at face value with no retry ladder) -- but
      // reading it is what makes "the previous run crashed after writing this
      // name" and "the directory listing had not caught up yet" non-destructive
      // instead of an overwrite.
      existing = await readExistingSegment(eventsDir, fileName, segmentMemoKey(writer.scopeId, fileName));
      existingBytes = utf8Length(existing);
    }

    const appended = existing + addedText;

    await retryTransientWrite(
      async () => {
        const handle = await eventsDir.getFileHandle(fileName, { create: true });
        if (!handle.createWritable) {
          throw taggedError("XQ-DIST-006", `Browser cannot write ${fileName}.`);
        }
        const writable = await handle.createWritable();
        await writable.write(appended);
        await writable.close();
      },
      { context: "distribution:append-segment", dir: eventsDir, fileName }
    );
    // Recorded before verification, deliberately: the bytes are already on the
    // share at this point, so the next append must continue in THIS segment
    // even if the post-close size check below fails and this call reports an
    // error. Pointing back at the previous segment there would strand the
    // lines just written outside the writer's own view of its chain.
    writtenSegmentsThisSession.add(segmentMemoKey(writer.scopeId, fileName));
    openSegmentSeqByWriter.set(writerKey, seq);

    await verifySegmentSize(eventsDir, fileName, existingBytes + addedBytes);
  });
}

/**
 * Segment file names this session has successfully written — the signal for
 * whether a NotFoundError on the pre-append re-read is worth retrying.
 *
 * Before this session's first append to a segment, absence is the expected,
 * correct answer (a fresh writer session always starts a new file) and must
 * resolve immediately: retrying would put dead wait in front of the first
 * distribution action of every session. After a successful append the file
 * exists, so a NotFoundError is far more likely to be UNC/SMB directory-listing
 * latency, and re-reading "" there would make this append rewrite the file
 * without the lines already in it.
 *
 * It only gates *retrying*, never the final answer.
 *
 * KEY IDENTITY (perf): the key is `{scopeId}|{fileName}`, where `scopeId` is the
 * caller's stable workspace+month identity — `appendDistributionEvents` passes
 * `workspaceScopeId(root)|month` from `inFlightReads.ts`, the same per-root
 * WeakMap id the dedupe/epoch keys already use. Keying by bare file name made
 * the memo carry across a workspace switch: the same {deviceId}-{sessionId}
 * segment legitimately does not exist in the newly mounted workspace, so the
 * first append there burned the entire ~630 ms retry ladder AND a
 * `classifyNotFound` write probe before falling back to "". With the scope in
 * the key that stale hit cannot happen at all.
 *
 * The fallback is unchanged and still load-bearing: an exhausted retry returns
 * "" rather than hard-failing, with a log entry recording that it happened.
 */
const writtenSegmentsThisSession = new Set<string>();

/** Optional workspace/month identity for the memo key — see `writtenSegmentsThisSession`. */
export type SegmentWriter = { deviceId: string; sessionId: string; scopeId?: string };

function segmentMemoKey(scopeId: string | undefined, fileName: string): string {
  return `${scopeId ?? "<unscoped>"}|${fileName}`;
}

/** @internal test-only — forget which segments this session has written, and
 *  which sequence each writer chain's open segment sits at (both are per-session
 *  writer state; a test that resets one without the other would leave a writer
 *  pointing at a segment it no longer believes it wrote). */
export function __resetWrittenSegmentsForTests(): void {
  writtenSegmentsThisSession.clear();
  openSegmentSeqByWriter.clear();
}

async function readExistingSegment(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  writtenKey: string
): Promise<string> {
  const knownWritten = writtenSegmentsThisSession.has(writtenKey);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const existingHandle = await eventsDir.getFileHandle(fileName, { create: false });
      return await (await existingHandle.getFile()).text();
    } catch (error) {
      const transient = knownWritten
        ? isTransientWriteError(error)
        : isNotReadableError(error);
      if (transient && attempt < TRANSIENT_WRITE_RETRY_DELAYS_MS.length) {
        await waitFor(TRANSIENT_WRITE_RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      if (knownWritten && isNotFoundError(error)) {
        // Retries exhausted on a segment this session wrote. Fall back to ""
        // (the long-standing behavior) rather than hard-failing, because the
        // memo can be stale after a workspace switch — but record it, since
        // the alternative reading is that this append is about to rewrite the
        // file without lines that are still on the share.
        await logExhaustedNotFound(
          "distribution:segment-reread",
          eventsDir,
          fileName,
          attempt + 1,
          error
        );
      }
      // No prior content for this writer session yet — start from empty.
      return "";
    }
  }
}

/**
 * Post-close size verification.
 *
 * Chrome's close() already finalizes the write (swap-file + verification
 * pipeline — see CLAUDE.md's task brief on Chromium bug 40899722); this is a
 * cheap existence/size check that catches silent truncation on a flaky network
 * share without re-reading and re-parsing the whole segment.
 *
 * It must never be the thing that fails the append, though. On a UNC/SMB share
 * the directory entry is not always visible to the next open after close()
 * returns, and the size the server reports can lag the bytes it already holds.
 * Unguarded, that threw NotFoundError *after the bytes had been written* and
 * surfaced to the user as "تمت إضافة البديل للعينة لكن فشل تسجيل الحدث" — a
 * write that had in fact succeeded. Both the missing entry and a short size are
 * therefore retried on the shared backoff before the write is called a failure.
 */
async function verifySegmentSize(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  expectedBytes: number
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const retriesLeft = attempt < TRANSIENT_WRITE_RETRY_DELAYS_MS.length;
    let observedSize: number;
    try {
      const verifyHandle = await eventsDir.getFileHandle(fileName, { create: false });
      observedSize = (await verifyHandle.getFile()).size;
      if (observedSize === expectedBytes) return;
    } catch (error) {
      if (!isTransientWriteError(error)) throw error;
      if (!retriesLeft) {
        if (isNotFoundError(error)) {
          await logExhaustedNotFound(
            "distribution:segment-verify",
            eventsDir,
            fileName,
            attempt + 1,
            error
          );
        }
        throw error;
      }
      await waitFor(TRANSIENT_WRITE_RETRY_DELAYS_MS[attempt]!);
      continue;
    }
    if (!retriesLeft) {
      throw new Error(
        `Distribution event segment write verification failed: ${fileName} ` +
          `(expected ${expectedBytes} bytes, saw ${observedSize})`
      );
    }
    await waitFor(TRANSIENT_WRITE_RETRY_DELAYS_MS[attempt]!);
  }
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
  // Sibling of the segment verification above: this reads back a file the line
  // before provably wrote, so a NotFoundError is share latency, not absence —
  // opt into the bounded retry rather than declaring a completed write failed.
  const verify = await safeReadJson<DistributionEvent>(eventsDir, fileName, {
    retryMissing: true,
  });
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
 * Prefix of the commutative event-set digest below. Present so a digest can
 * never be confused with the pre-v85 format, which was the literal
 * length-prefixed CONCATENATION of every event id (`"{count}:{len}:{id}…"`).
 * An old id and a new digest are therefore never `===`, which is exactly the
 * behaviour a cache validity check wants across the format change: it reads as
 * "stale", costs one full refold, and self-heals.
 */
const EVENT_SET_DIGEST_PREFIX = "d1";

function hashEventId(id: string): number {
  const hasher = createSimpleHasher();
  hasher.update(id);
  return Number.parseInt(hasher.digest(), 16) >>> 0;
}

/**
 * Same identity as distributionEventSetId, computed directly from ids so a
 * checkpoint holding `knownEventIds` (already-folded ids, small in-memory
 * array manipulation) can extend it without re-reading every event file.
 *
 * COMMUTATIVE DIGEST, not a concatenation. The previous format spelled out
 * every id in full: ~43 bytes per event, i.e. ~350 KB on a large month, stored
 * TWICE (in `distribution.log.json` and in `distribution.current.json`) and
 * re-read and re-written on essentially every load and every append. On the
 * UNC/SMB share this app is deployed to, that string cost more than the fold it
 * was guarding. It is now a fixed ~24-byte digest: each id is hashed on its own
 * with the codebase's existing {@link createSimpleHasher} (djb2 variant — no
 * new dependency), and the per-id hashes are combined with two commutative
 * operations, XOR and 32-bit modular addition, plus the element COUNT.
 *
 * Commutative on purpose: this is a SET identity, not a sequence identity. Two
 * clients that discovered the same events in different orders (a segment tail
 * read vs. a cold full read) must agree, and the caller-side `sort()` the old
 * format needed to get that agreement is now unnecessary.
 *
 * The count is what stops the cheap cancellation attack on XOR alone (a set and
 * that same set plus a pair of equal-hash ids collide under XOR but not under
 * count, and the additive term differs as well). This is a non-cryptographic
 * digest, so a collision is no longer impossible the way an exact concatenation
 * made it: a collision means a rebuildable CACHE (`distribution.current.json`)
 * is trusted when its event set has changed. Every mutation also bumps the
 * compat-log `revision`, which is compared alongside this value at the one call
 * site that gates the cache (`loadOrDeriveDistributionCurrent`), so a stale
 * cache needs BOTH a revision match and a digest collision to be accepted.
 */
export function distributionEventSetIdFromIds(ids: Iterable<string>): string {
  const seen = new Set<string>();
  let xor = 0;
  let sum = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const hash = hashEventId(id);
    xor ^= hash;
    sum = (sum + hash) >>> 0;
  }
  return `${EVENT_SET_DIGEST_PREFIX}:${seen.size}:${(xor >>> 0).toString(16)}:${sum.toString(16)}`;
}

export function distributionEventSetId(events: DistributionEvent[]): string {
  return distributionEventSetIdFromIds(events.map((event) => event.eventId));
}

/**
 * The fold's canonical event order: ascending `eventAt`, ties left in the order
 * they were supplied.
 *
 * Ties are the whole point. A bulk distribution builds its entire batch with
 * ONE shared timestamp (see buildAssignEvent's `eventAt` override), so hundreds
 * of events can share an `eventAt` and no timestamp comparison can order them.
 * Until v85 the tie was broken by `eventId` here, and the resulting scramble was
 * invisible because `distribution.log.json` carried a full copy of every event
 * and its stored array order won: the batch's own order survived through that
 * projection. With the projection now body-less (item 2.6), this ordering is the
 * only one left — so it must reproduce what the projection used to give, or the
 * default order of an employee's queue silently becomes "sorted by random
 * UUID".
 *
 * `Array#sort` is specified as stable, and every input this is handed is
 * already in a deterministic order: legacy per-event files and segment files
 * are both name-sorted by `directoryScan`, and lines within a segment are in
 * append order. So ties resolve to append order — the real causal order — and
 * two clients reading the same directory still agree.
 */
export function sortDistributionEventsForFold<T extends DistributionEvent>(events: T[]): T[] {
  return events.sort((a, b) => a.eventAt.localeCompare(b.eventAt));
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
  const additions = sortDistributionEventsForFold(
    immutableEvents.filter((event) => {
      if (compatibilityIds.has(event.eventId) || additionIds.has(event.eventId)) return false;
      additionIds.add(event.eventId);
      return true;
    })
  );
  return [...orderedBase, ...additions];
}
