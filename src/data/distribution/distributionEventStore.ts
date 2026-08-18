import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { createSimpleHasher } from "../storage/jsonEnvelope";
import { listDirectoryEntries, readJsonDirectory, readSegmentTails } from "../storage/directoryScan";
import { withResourceLock } from "../storage/webLocks";
import { logCodedError, tagError, taggedError } from "../storage/errorCodes";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
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

/**
 * SHORT NAMES ARE A CORRECTNESS PROPERTY ON A NETWORK SHARE, not tidiness.
 *
 * `deviceId` and `sessionId` are UUIDs (36 characters each), so the original
 * `{deviceId}-{sessionId}.ndjson` was **80 characters** — and Chromium writes
 * through a `{name}.crswap` sibling, making the real path 87. Windows caps a
 * path at 260 characters, so on a deep UNC workspace path
 * (`\\host\share\dept\…\2-samples\11-november-2026\1-main\distribution.events\`)
 * that name does not fit while every other file this app writes
 * (`distribution.log.json` — 21, `sample.master.json` — 18, and the pre-segment
 * `{eventId}.json` — 41) does. The failure surfaces as a permanent
 * `NotFoundError` in a directory that is genuinely writable, i.e. exactly the
 * XQ-IO-031 shape that four rounds of extra patience could not fix.
 *
 * 8 hex of device + 6 of session = a 15-character base, 22 with the suffix —
 * shorter than the legacy per-event names that worked for months, and 56 bits
 * of distinctness between concurrent writers.
 *
 * Those bits come from HASHING each id, not from slicing its head. Slicing looks
 * equivalent for a UUID and is not for the other two id shapes this app
 * produces: `ephemeral-{uuid}` (used when localStorage is unavailable) begins
 * with the literal `ephemera` in every case, and the no-`crypto.randomUUID`
 * fallback `{Date.now()}-{random}` yields a device part that is a 100-second
 * bucket and a session part that is a 2.78-hour one — two machines starting in
 * the same window would produce a byte-identical base. Hashing the whole value
 * spreads every shape across the full range.
 *
 * That matters because a collision is NOT benign. `withResourceLock` is Web
 * Locks: per-origin, per-browser, so it serialises nothing between two machines
 * on a share. Both would read the same segment text and each write
 * `existing + own lines`, and the second write would drop the first's events —
 * silent loss, not a shared chain. This is the same invariant CRASH SAFETY
 * states below (one writer per seq); the name is what has to keep it true.
 *
 * Compatibility is free: readers discover segments by `.ndjson` suffix glob, so
 * long-named files written by earlier versions keep being read and folded. A
 * writer simply never appends to them again — its own chain is a new, short
 * base — and they are never renamed, so `foldCheckpoint.segmentOffsets` stays
 * valid.
 */
const SEGMENT_DEVICE_ID_CHARS = 8;
const SEGMENT_SESSION_ID_CHARS = 6;

/**
 * Hash an id down to `chars` filename-safe hex characters.
 *
 * Hashing rather than slicing: see segmentBaseName's note above — the head of an
 * `ephemeral-…` or `{Date.now()}-{random}` id carries little or no entropy, so
 * `slice()` would hand two machines the same base. The digest depends on the
 * whole value, so every id shape gets the same distribution.
 *
 * djb2 via {@link createSimpleHasher} — already used in this file for the event
 * set digest, so no new dependency. It is not a cryptographic hash and does not
 * need to be: this picks a filename, it does not authenticate one.
 */
function shortenSegmentIdPart(value: string, chars: number): string {
  const hasher = createSimpleHasher();
  hasher.update(value);
  // digest() is 32-bit hex; pad so a small digest still fills the budget rather
  // than silently yielding a shorter, less distinct stem.
  return hasher.digest().padStart(chars, "0").slice(0, chars);
}

function segmentBaseName(deviceId: string, sessionId: string): string {
  const device = shortenSegmentIdPart(deviceId, SEGMENT_DEVICE_ID_CHARS);
  const session = shortenSegmentIdPart(sessionId, SEGMENT_SESSION_ID_CHARS);
  return `${segmentIdPart(device)}-${segmentIdPart(session)}`;
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
): Promise<SegmentVerification> {
  if (events.length === 0) return "verified";
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
  return withResourceLock(`${DISTRIBUTION_EVENTS_DIR}/${base}`, async () => {
    let seq = openSegmentSeqByWriter.get(writerKey) ?? (await discoverHighestOwnSeq(eventsDir, base));
    let fileName = segmentFileNameForSeq(base, seq);
    let existing = await readExistingSegment(eventsDir, fileName, segmentMemoKey(writer.scopeId, fileName));
    let existingBytes = utf8Length(existing.text);

    // ROTATE AWAY FROM A SEGMENT WE COULD NOT RE-READ. An unreliable baseline
    // means this session wrote `fileName` and the patient pre-append re-read
    // still could not see it (share visibility lag, or something outside the
    // browser holding/removing the entry). Writing here would REWRITE the file
    // without lines that may still be on the share — the data-loss window that
    // forced the post-close verify to stay fatal for this case (v97.1), and
    // the one path that still surfaced a completed Phase 4 save as a failure
    // (XQ-IO-031). Rotating removes the hazard instead of reporting it: the
    // unreadable segment is left untouched — its bytes are still on the
    // server, and every reader discovers segments by suffix glob, so its
    // events remain part of the log — while the batch lands in a fresh
    // segment whose empty baseline is trustworthy. An unconfirmable
    // post-close check on the fresh segment is then benign (XQ-DIST-007)
    // instead of fatal. The rotation target can never collide: the memo and
    // `openSegmentSeqByWriter` advance together, so `seq` is the highest this
    // session ever wrote, and no other writer shares this chain.
    if (!existing.reliable && seq < MAX_SEGMENT_SEQ) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq);
      existing = await readExistingSegment(eventsDir, fileName, segmentMemoKey(writer.scopeId, fileName));
      existingBytes = utf8Length(existing.text);
    }

    if (seq < MAX_SEGMENT_SEQ && shouldRotate(existing.text, existingBytes, addedBytes, events.length)) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq);
      // Read the rotation target too. It is normally absent and this resolves
      // immediately (an unwritten segment is not in writtenSegmentsThisSession,
      // so a NotFoundError is taken at face value with no retry ladder) -- but
      // reading it is what makes "the previous run crashed after writing this
      // name" and "the directory listing had not caught up yet" non-destructive
      // instead of an overwrite.
      existing = await readExistingSegment(eventsDir, fileName, segmentMemoKey(writer.scopeId, fileName));
      existingBytes = utf8Length(existing.text);
    }

    const appended = existing.text + addedText;

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
      { context: "distribution:append-segment", dir: eventsDir, fileName },
      // The PATIENT ladder (~11 s), not the short one (~630 ms). Failing here
      // aborts a whole Phase 4 save, so there is nothing to be gained by giving
      // up quickly — the same reasoning the post-close read-back already
      // applies, which left the write itself as the odd one out.
      VERIFY_READBACK_RETRY_DELAYS_MS
    );
    // Recorded before verification, deliberately: the bytes are already on the
    // share at this point, so the next append must continue in THIS segment
    // even if the post-close size check below fails and this call reports an
    // error. Pointing back at the previous segment there would strand the
    // lines just written outside the writer's own view of its chain.
    writtenSegmentsThisSession.add(segmentMemoKey(writer.scopeId, fileName));
    openSegmentSeqByWriter.set(writerKey, seq);

    return verifySegmentSize(
      eventsDir,
      fileName,
      existingBytes + addedBytes,
      existing.reliable
    );
  });
}

/**
 * Split a batch so no single append rewrites more than one full segment's worth
 * of bytes or lines.
 *
 * `shouldRotate` deliberately lets an OVERSIZED batch exceed the cap once
 * (an empty segment must never rotate, or a large batch would rotate forever
 * without landing). That escape hatch is what puts a multi-megabyte single
 * write on the share for a whole-month bulk assignment — the largest, slowest,
 * most failure-prone write the app performs, and the one the owner's Phase 4
 * save actually is. Chunking here removes the escape hatch at the source: each
 * append is bounded, so a 9,000-event month is many ~128 KiB writes instead of
 * one ~2.3 MB write, and a failure costs one chunk rather than the batch.
 *
 * Chunks preserve input order, so the fold order of the batch is unchanged.
 */
export function chunkEventsForSegmentAppends(
  events: DistributionEvent[]
): DistributionEvent[][] {
  const chunks: DistributionEvent[][] = [];
  let current: DistributionEvent[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const eventBytes = utf8Length(encodeEventLine(event));
    const wouldExceedBytes = currentBytes + eventBytes > MAX_OPEN_SEGMENT_BYTES;
    const wouldExceedLines = current.length + 1 > MAX_OPEN_SEGMENT_LINES;
    if (current.length > 0 && (wouldExceedBytes || wouldExceedLines)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += eventBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export type DurableAppendOptions = {
  writer?: SegmentWriter;
  /**
   * Re-resolve the distribution directory for ONE retry after a failed segment
   * write. `distributionStorage` passes a resolver that purges the workspace
   * directory-handle cache first, because a handle held since mount goes stale
   * when an SMB session idle-disconnects and every write through it then fails
   * `NotFoundError` — the "works after re-picking the folder" report. Omit to
   * skip that retry.
   */
  reopenDir?: () => Promise<DirectoryHandleLike>;
  /** Progress after each chunk lands, for the save-progress bar. */
  onChunk?: (completedEvents: number, totalEvents: number) => void;
};

/**
 * Durably write `events`, degrading through every option before failing.
 *
 * 1. **Chunked segment appends** (the fast path) — bounded writes, see
 *    `chunkEventsForSegmentAppends`.
 * 2. **One retry against a freshly-resolved directory handle** — covers a stale
 *    handle after an idle share disconnect.
 * 3. **Per-event `{eventId}.json` files** — the pre-segment layout, which every
 *    reader still merges (`loadImmutableDistributionEvents`, and the checkpoint
 *    path's `legacyEventFileNames`). Names are 41 characters and the extension
 *    is `.json`, so this survives both a path-length limit and an
 *    `.ndjson`-blocking scanner. Slower, and that is the correct trade: the
 *    alternative is refusing to distribute the month at all.
 *
 * Only when all three fail does the batch report failure. Retries and the
 * fallback can each write an event twice; every reader dedupes by `eventId`
 * (`mergeDistributionEvents`, `distributionEventSetIdFromIds`), so a duplicate
 * is harmless where a lost event is not.
 */
export async function appendDistributionEventsDurably(
  distributionDir: DirectoryHandleLike,
  events: DistributionEvent[],
  options?: DurableAppendOptions
): Promise<SegmentVerification> {
  if (events.length === 0) return "verified";
  const writer = options?.writer ?? {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
  };
  const chunks = chunkEventsForSegmentAppends(events);
  let verification: SegmentVerification = "verified";
  let completed = 0;
  let directory = distributionDir;
  let fallbackReported = false;
  // Once a chunk has exhausted the segment path AND the re-resolved handle AND
  // degraded, the remaining chunks of THIS save go straight to the fallback.
  //
  // The causes this degrades for are properties of the NAME, not of the moment:
  // a path too long for the share, or an extension a scanner removes, fails
  // identically for every chunk. Re-deriving that per chunk costs the full
  // ~11 s write ladder + ~1.2 s classification + a second ~11 s ladder on the
  // re-resolved handle EVERY time — roughly 24 s of pure sleeping per chunk, so
  // an 18-chunk month spent ~7 minutes asleep to reach the same conclusion 18
  // times, and paid it again before surfacing an error if the fallback also
  // failed. Deciding once turns that back into one diagnosis per save.
  //
  // Scoped to this call deliberately: a later save re-probes from scratch, so a
  // genuinely transient failure never latches beyond the operation it hit.
  let segmentPathUnusable = false;
  // The failure that caused the first degradation, kept across iterations —
  // later chunks skip the segment attempt and so produce no error of their own,
  // but a fallback failure must still report the original classified cause.
  let degradeCause: unknown = null;

  for (const chunk of chunks) {
    let chunkVerification: SegmentVerification | null = null;
    let firstFailure: unknown = null;
    try {
      if (segmentPathUnusable) throw degradeCause;
      chunkVerification = await appendDistributionEventSegment(directory, chunk, writer);
    } catch (error) {
      if (segmentPathUnusable) {
        // Not a fresh diagnosis — the standing one. Fall through to the
        // fallback without re-running the ladders or the reopen retry.
        firstFailure = degradeCause;
      } else {
      // Degrade ONLY for the failure shape a different handle or a different
      // file name could plausibly fix: a NotFound/NotReadable on a name the
      // share will not produce. A revoked grant (NotAllowedError), a full disk
      // (QuotaExceededError) or a browser with no `createWritable` fail the
      // per-event path in exactly the same way, so retrying them through it
      // would burn one write per event to reach the same error while hiding the
      // specific, already-classified code the user needs to read.
      if (!isNotFoundError(error) && !isNotReadableError(error)) throw error;
      firstFailure = error;
      }
    }

    if (chunkVerification === null && !segmentPathUnusable && options?.reopenDir) {
      try {
        directory = await options.reopenDir();
        chunkVerification = await appendDistributionEventSegment(directory, chunk, writer);
        logCodedError("distribution:append-segment-reopened", "XQ-DIST-007", firstFailure);
      } catch {
        // Keep `firstFailure` as the reported cause: the re-resolved handle
        // failing the same way says nothing new.
      }
    }

    if (chunkVerification === null) {
      try {
        for (const event of chunk) {
          await writeImmutableDistributionEvent(directory, event);
        }
      } catch {
        // The fallback failed too. Report the ORIGINAL cause: it is the one
        // that was classified (path length, blocked extension, unreachable
        // folder), and it is what the user must act on.
        throw firstFailure ?? degradeCause;
      }
      chunkVerification = "verified";
      segmentPathUnusable = true;
      degradeCause ??= firstFailure;
      if (!fallbackReported) {
        logCodedError("distribution:append-events-fallback", "XQ-DIST-009", firstFailure);
        fallbackReported = true;
      }
    }

    if (chunkVerification === "unverified") verification = "unverified";
    completed += chunk.length;
    options?.onChunk?.(completed, events.length);
  }

  return verification;
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

/**
 * `reliable: false` means the "" is a FALLBACK, not an observation: this
 * session had already written the segment, the re-read exhausted its retries,
 * and the append is therefore about to rewrite the file without lines that may
 * still be on the share. That distinction is load-bearing — it decides whether
 * a later unverifiable post-close check may be treated as benign.
 */
type ExistingSegment = { text: string; reliable: boolean };

async function readExistingSegment(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  writtenKey: string
): Promise<ExistingSegment> {
  const knownWritten = writtenSegmentsThisSession.has(writtenKey);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const existingHandle = await eventsDir.getFileHandle(fileName, { create: false });
      return { text: await (await existingHandle.getFile()).text(), reliable: true };
    } catch (error) {
      const transient = knownWritten
        ? isTransientWriteError(error)
        : isNotReadableError(error);
      // Patient ladder only when this session KNOWS it wrote the segment, so
      // absence is provably a stale view. That case also has teeth: exhausting
      // it falls back to "" and this append then rewrites the file without
      // lines still on the share, so more patience here directly reduces the
      // data-loss window. A fresh writer session keeps the short ladder —
      // absence there is the expected answer and must resolve promptly.
      const ladder = knownWritten
        ? VERIFY_READBACK_RETRY_DELAYS_MS
        : TRANSIENT_WRITE_RETRY_DELAYS_MS;
      if (transient && attempt < ladder.length) {
        await waitFor(ladder[attempt]!);
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
        return { text: "", reliable: false };
      }
      // No prior content for this writer session yet — start from empty. This
      // IS an observation: a fresh writer session legitimately has no segment.
      return { text: "", reliable: true };
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
/**
 * Post-close read-back check.
 *
 * Returns `"unverified"` rather than throwing when the file cannot be READ at
 * all after the retry ladder. That is not the same failure as a size we read
 * and found wrong, and conflating the two was a live data-integrity bug:
 *
 * `close()` had already resolved, so the bytes ARE committed — the code says so
 * itself, recording the segment in `writtenSegmentsThisSession` *before* this
 * check for exactly that reason. A NotFound/NotReadable here is the share not
 * yet showing an entry it already holds. Throwing aborted
 * `appendDistributionEvents` before its projection `casLoop`, so the events
 * were durable on disk while `distribution.log.json`'s revision never advanced
 * — and revision is the staleness authority everywhere. The assignee's mirror
 * was therefore judged current and the assignment stayed invisible to them
 * *through reloads*, the sync tick never fired, and an operator retry ran
 * against a stale snapshot whose idempotency guard no longer matched, emitting
 * duplicate events.
 *
 * A definite size MISMATCH still throws: there we successfully read the file
 * and it is genuinely wrong, which is a real failed write.
 */
type SegmentVerification = "verified" | "unverified";

async function verifySegmentSize(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  expectedBytes: number,
  /** Whether the pre-append re-read observed the file rather than falling back. */
  baselineReliable: boolean
): Promise<SegmentVerification> {
  // The patient ladder: this reads back a segment whose `close()` already
  // resolved, so it provably exists and only the share's view is stale. Giving
  // up in ~630 ms was turning completed Phase 4 writes into reported failures.
  for (let attempt = 0; ; attempt += 1) {
    const retriesLeft = attempt < VERIFY_READBACK_RETRY_DELAYS_MS.length;
    let observedSize: number;
    try {
      const verifyHandle = await eventsDir.getFileHandle(fileName, { create: false });
      observedSize = (await verifyHandle.getFile()).size;
      if (observedSize === expectedBytes) return "verified";
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
        // Could not READ it back. Whether that is benign depends entirely on
        // whether the baseline was trustworthy.
        //
        // Baseline reliable: `close()` resolved, so the bytes are committed and
        // this is only the share failing to show an entry it already holds.
        // Inconclusive, not failed — commit the projection so the assignment is
        // visible to its assignee instead of stranded.
        //
        // Baseline UNRELIABLE: the pre-append re-read of a segment this session
        // wrote had already fallen back to "", so this append just rewrote the
        // file without lines that may still be on the share. That is a possible
        // data loss, and this check is the only thing that detects it — it must
        // stay fatal. Treating it as benign would silently drop events.
        if (!baselineReliable) throw error;
        logCodedError("distribution:segment-verify", "XQ-DIST-007", error);
        return "unverified";
      }
      await waitFor(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!);
      continue;
    }
    if (!retriesLeft) {
      // We READ the file and its size is wrong — a genuine bad write, not a
      // visibility artefact. Still fatal.
      throw tagError(
        new Error(
          `Distribution event segment write verification failed: ${fileName} ` +
            `(expected ${expectedBytes} bytes, saw ${observedSize})`
        ),
        "XQ-DIST-008"
      );
    }
    await waitFor(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!);
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
  } catch (error) {
    // Same rule as `eventFileName` below: reject, don't invent. "No events
    // directory" is a real answer; "I could not open the events directory" is
    // not, and returning an empty delta for it makes a month's whole event
    // history disappear from every fold that reads through here.
    if (!isNotFoundError(error)) throw error;
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
