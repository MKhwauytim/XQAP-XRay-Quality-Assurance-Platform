// TWO CONSUMERS SHARE THIS MODULE. Any change here requires the whole-repo
// `npm run test:run`, never a scoped run. (CI already runs it unscoped on every
// push — `.github/workflows/ci.yml` — but this note is here for whoever edits
// the file without reading CI config first.)
//
// Generic, durable, append-only event-log MECHANICS, extracted verbatim from
// `src/data/distribution/distributionEventStore.ts` (Stage 0 of
// `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md`). Everything in
// here was proven free of distribution-specific coupling by that proposal's
// round-3 line-by-line review, and is reproduced with its original reasoning
// intact — the comments are load-bearing history, not decoration: four rounds
// of SMB-safety fixes and two production incidents (XQ-IO-031, XQ-IO-032) are
// encoded in the branches below.
//
// What is deliberately NOT here, and stays with each consumer: the event TYPE,
// the fold's business rules, the durable-append fallback ladder (which is
// consumer-specific because its fallback file layout is), and the device/session
// id sources.

import type { DirectoryHandleLike } from "./fileSystemAccess";
import { createSimpleHasher } from "./jsonEnvelope";
import { listDirectoryEntries, readSegmentTails } from "./directoryScan";
import { directoryResourceKey, withResourceLock } from "./webLocks";
import { logError } from "./errorLogger";
import {
  classifyFileSystemError,
  logCodedError,
  tagError,
  taggedError,
  type ErrorCode,
} from "./errorCodes";
import { nextRetryDelayMs, type OperationDeadline } from "./operationDeadline";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
  isLockContentionError,
  isNotFoundError,
  isNotReadableError,
  isSnapshotStaleError,
  isTransientWriteError,
  logExhaustedNotFound,
  waitFor,
} from "./transientFileErrors";

/* ────────────────────────────── configuration ───────────────────────────── */

/**
 * Who is writing, and where the write is allowed to be memoized to.
 *
 * `deviceId` is a stable per-machine id; `sessionId` is fresh per app session
 * for a NON-stable writer (distribution) — so two machines, or two tabs on
 * the same machine, never share a segment file there, and concurrent writers
 * never target the same file.
 *
 * A `stable` writer (answers, A1) breaks that per-tab half of the invariant
 * on purpose: `sessionId` is the persisted chain id, so two tabs of the SAME
 * browser + user + month DO share one segment file across the page's whole
 * lifetime, not just one load. Safety there does not come from file
 * exclusivity — it comes from `withResourceLock` in `appendEventSegment`
 * serialising every append to that chain (including across tabs, since Web
 * Locks are per-origin, not per-tab) plus the under-lock re-read the stable
 * writer always does before writing (see `knownFor`/`readExistingSegment`):
 * whichever tab's append runs first reads and preserves the other's lines,
 * because it never has a stale in-memory view to trust instead of a fresh
 * read.
 *
 * R9: this cross-tab argument depends on the REAL `navigator.locks` being
 * available. `withResourceLock` (`webLocks.ts`) falls back to a per-tab
 * promise chain when it is not — that fallback serialises only WITHIN one
 * tab, not across tabs (see its own "serializing within this thread"
 * comment). On a browser/context without `navigator.locks`, two tabs of the
 * same stable chain are therefore not actually serialised against each
 * other by the lock; the under-lock re-read still narrows the window (each
 * tab still reads immediately before it writes) but cannot, on its own,
 * rule out both tabs racing to read-then-write in an interleaved order.
 *
 * `scopeId` is the caller's stable workspace+month identity. See
 * `writtenSegmentsThisSession` below for why the memo key needs it.
 */
export type SegmentWriterIdentity = {
  deviceId: string;
  sessionId: string;
  scopeId?: string;
  /**
   * True for a chain that outlives the page (answers, A1): its segments may
   * already exist on disk before this session writes them. See `knownFor` in
   * `appendEventSegment`. Omitted/false (distribution) keeps the per-session
   * rules exactly as they were.
   */
  stable?: boolean;
};

/** Per-call options for `appendEventSegment`. */
export type AppendEventSegmentOptions = {
  /**
   * The user action's total budget. Every inner ladder (pre-append re-read,
   * write, post-close verify) stops sleeping once it is spent, so ONE attempt
   * can no longer outlive the whole action (A1). Omitted: unbounded, as before.
   */
  deadline?: OperationDeadline;
};

/** Contexts and error codes the consumer wants this module's failures reported under. */
export type EventLogDiagnostics = {
  /** `logError`/`classifyNotFound` context for the segment WRITE retry ladder. */
  writeContext: string;
  /** Context for an exhausted pre-append re-read of a segment this session wrote. */
  rereadContext: string;
  /** Context for the post-close size verification. */
  verifyContext: string;
  /** Tagged onto "this browser has no createWritable". */
  cannotWriteCode: ErrorCode;
  /** Logged when a post-close read-back could not be confirmed but the baseline WAS reliable. */
  unverifiedCode: ErrorCode;
  /** Tagged onto a definite, successfully-read size mismatch. */
  sizeMismatchCode: ErrorCode;
  /** Message for a segment whose NDJSON cannot be parsed. */
  segmentParseError: (segmentName: string) => string;
  /** Message for a read-back whose size is definitely wrong. */
  verificationFailedError: (
    fileName: string,
    expectedBytes: number,
    observedBytes: number
  ) => string;
};

/**
 * One consumer's binding of this module.
 *
 * `consumerNamespace` is a SHORT FIXED LITERAL per consumer (`"dist"`, `"ans"`),
 * never user-controlled. It is what keeps two consumers writing in the same
 * tab/session from observing each other's module-level writer memos — see
 * `segmentMemoKey`. It is NOT automatically part of the segment file name:
 * `baseNamePrefix` controls that separately, because distribution's on-disk
 * names are frozen (see `assertSegmentBaseNameFits` for why every character in
 * a segment name is a correctness cost, not a cosmetic one).
 */
export type AppendOnlyEventLogConfig = {
  consumerNamespace: string;
  /** Child directory of the caller-supplied parent that holds the segments. */
  eventsDirName: string;
  /** Segment file suffix, e.g. `".ndjson"`. Readers discover segments by this alone. */
  segmentSuffix: string;
  /**
   * Optional extra leading component of the segment base name. Omitted by
   * distribution so its names stay byte-identical to what is already on disk.
   */
  baseNamePrefix?: string;
  diagnostics: EventLogDiagnostics;
};

/* ─────────────────────────── rotation thresholds ────────────────────────── */

/**
 * BOUNDED SEGMENT ROTATION — thresholds.
 *
 * The open segment is rewritten in full on every append (see
 * `appendEventSegment` for why the Like-handle contract leaves no cheaper
 * option), so the bytes pushed over the wire per append are
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
 * real distribution event reaches. It is belt-and-braces against a future, much
 * smaller event shape making a segment expensive to parse and dedupe rather
 * than expensive to transfer — not a threshold expected to fire today.
 */
export const MAX_OPEN_SEGMENT_BYTES = 131_072;
export const MAX_OPEN_SEGMENT_LINES = 2_000;

/**
 * Upper bound on the rotation counter. A writer that somehow reached this would
 * have written ~128 GiB in one session; the cap exists so a corrupt/hostile
 * name can never be parsed into an unbounded number, not because it is
 * reachable.
 */
export const MAX_SEGMENT_SEQ = 999_999;

/* ──────────────────────────── segment naming ────────────────────────────── */

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
 * states in `appendEventSegment` (one writer per seq); the name is what has to
 * keep it true.
 *
 * Compatibility is free: readers discover segments by suffix glob, so
 * long-named files written by earlier versions keep being read and folded. A
 * writer simply never appends to them again — its own chain is a new, short
 * base — and they are never renamed, so a checkpoint's `segmentOffsets` stays
 * valid.
 */
export const SEGMENT_DEVICE_ID_CHARS = 8;
export const SEGMENT_SESSION_ID_CHARS = 6;

/**
 * Longest single path component this app has ever written SUCCESSFULLY on the
 * shares where XQ-IO-031 was reported: the pre-segment per-event file
 * `{uuid}.json` (41 characters) plus Chromium's `.crswap` sibling — 48.
 *
 * The proven-UNSAFE datapoint on the same shares is 87 (`{uuid}-{uuid}.ndjson`
 * plus `.crswap`). The budget below is anchored on the safe number rather than
 * split between the two, because the failure mode is not graceful: a name one
 * character over the share's limit is a permanent `NotFoundError` in a folder
 * that probes as perfectly writable, which four rounds of extra retry patience
 * could not distinguish from share flake.
 */
const MAX_SEGMENT_PATH_COMPONENT_CHARS = 48;

/** `.crswap`, the sibling Chromium creates for every `createWritable` target. */
const CRSWAP_SIBLING_CHARS = ".crswap".length;

/** Worst-case rotation suffix on a base name: `-999999`. */
const MAX_SEQ_SUFFIX_CHARS = `-${MAX_SEGMENT_SEQ}`.length;

/**
 * The character budget a constructed base name must stay inside, for a given
 * segment suffix. For `.ndjson` this is 48 − 7 − 7 − 7 = **27** characters —
 * distribution's own base is 15, so it has real room, and a consumer that wants
 * to spend some of that room on a namespace or a sortable time prefix can, up
 * to here and no further.
 */
export function maxSegmentBaseNameChars(segmentSuffix: string): number {
  return (
    MAX_SEGMENT_PATH_COMPONENT_CHARS -
    CRSWAP_SIBLING_CHARS -
    segmentSuffix.length -
    MAX_SEQ_SUFFIX_CHARS
  );
}

/**
 * A REAL CHECK, not a convention (round 3's Gap 1c).
 *
 * Throwing at name-construction time is the only place a too-long name is
 * cheaply distinguishable from a share fault: once the write is attempted, the
 * share reports the identical `NotFoundError` it reports for a stale directory
 * listing, and the app then spends the full ~11 s patient ladder plus a
 * multi-second `classifyNotFound` probe per attempt to reach a verdict this
 * function can give for free.
 */
function assertSegmentBaseNameFits(base: string, segmentSuffix: string): void {
  const budget = maxSegmentBaseNameChars(segmentSuffix);
  if (base.length > budget) {
    throw new Error(
      `Append-only event log segment base name is too long for a deep UNC path: ` +
        `"${base}" is ${base.length} characters, budget is ${budget} for suffix "${segmentSuffix}" ` +
        `(${MAX_SEGMENT_PATH_COMPONENT_CHARS} - ${CRSWAP_SIBLING_CHARS} .crswap - ` +
        `${segmentSuffix.length} suffix - ${MAX_SEQ_SUFFIX_CHARS} rotation). See XQ-IO-031.`
    );
  }
}

function segmentIdPart(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error(`Invalid append-only event log writer id component: ${value}`);
  }
  return value;
}

/**
 * Hash an id down to `chars` filename-safe hex characters.
 *
 * Hashing rather than slicing: see the SHORT NAMES note above — the head of an
 * `ephemeral-…` or `{Date.now()}-{random}` id carries little or no entropy, so
 * `slice()` would hand two machines the same base. The digest depends on the
 * whole value, so every id shape gets the same distribution.
 *
 * djb2 via {@link createSimpleHasher} — already used for the event set digest
 * below, so no new dependency. It is not a cryptographic hash and does not need
 * to be: this picks a filename, it does not authenticate one.
 */
export function shortenSegmentIdPart(value: string, chars: number): string {
  const hasher = createSimpleHasher();
  hasher.update(value);
  // digest() is 32-bit hex; pad so a small digest still fills the budget rather
  // than silently yielding a shorter, less distinct stem.
  return hasher.digest().padStart(chars, "0").slice(0, chars);
}

/**
 * `[{prefix}-]{deviceHash}-{sessionHash}` — the identity of one writer CHAIN.
 *
 * `prefix` is omitted by distribution (its names are already on disk and must
 * not change) and supplied by any consumer that wants its segments visually
 * attributable in a shared directory. Either way the result is length-checked.
 */
export function buildSegmentBaseName(
  writer: Pick<SegmentWriterIdentity, "deviceId" | "sessionId">,
  segmentSuffix: string,
  prefix?: string
): string {
  const device = shortenSegmentIdPart(writer.deviceId, SEGMENT_DEVICE_ID_CHARS);
  const session = shortenSegmentIdPart(writer.sessionId, SEGMENT_SESSION_ID_CHARS);
  const parts = prefix
    ? [segmentIdPart(prefix), segmentIdPart(device), segmentIdPart(session)]
    : [segmentIdPart(device), segmentIdPart(session)];
  const base = parts.join("-");
  assertSegmentBaseNameFits(base, segmentSuffix);
  return base;
}

export function segmentFileNameForSeq(base: string, seq: number, segmentSuffix: string): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEGMENT_SEQ) {
    throw new Error(`Invalid append-only event log segment sequence: ${seq}`);
  }
  // seq 0 IS the historical unsuffixed name, deliberately. A pre-rotation
  // writer's `{device}-{session}.ndjson` is then not a special case needing its
  // own branch anywhere — it is simply a chain whose first segment never
  // rotated, so it keeps being read AND appended to by the code below with no
  // migration, no rename, and no format flag. (Never renaming also protects the
  // two invariants the compatibility audit rests on: a checkpoint's
  // `segmentOffsets` and `readAppendOnlyDirectory`'s sibling invalidation both
  // key on the file NAME, so a rename would read as "old name vanished, new
  // name at offset 0" and re-fold those events.)
  return seq === 0 ? `${base}${segmentSuffix}` : `${base}-${seq}${segmentSuffix}`;
}

/** Full segment file name for a writer chain at `seq`, under one consumer's config. */
export function segmentFileName(
  config: AppendOnlyEventLogConfig,
  writer: Pick<SegmentWriterIdentity, "deviceId" | "sessionId">,
  seq = 0
): string {
  const base = buildSegmentBaseName(writer, config.segmentSuffix, config.baseNamePrefix);
  return segmentFileNameForSeq(base, seq, config.segmentSuffix);
}

/**
 * WRITER-SIDE ONLY name introspection: which sequence number, if any, this
 * name carries for THIS writer's own chain.
 *
 * The READ path must never gain a filter like this — every reader discovers
 * segments through a pure suffix glob (`readSegmentTails` → `directoryScan`'s
 * `entry.name.endsWith(suffix)`), and narrowing that to names matching a `-\d+`
 * shape would make older writers' files invisible and lose their events. This
 * function is deliberately confined to the writer deciding where its OWN next
 * line goes, and returns `null` for anything it does not positively recognize
 * (another writer's file, a stray name, a sequence with leading zeros or out of
 * range) so an unexpected shape can only ever make this writer start a fresh
 * chain, never claim someone else's file.
 */
function parseOwnSegmentSeq(name: string, base: string, segmentSuffix: string): number | null {
  if (!name.endsWith(segmentSuffix)) return null;
  const stem = name.slice(0, -segmentSuffix.length);
  if (stem === base) return 0;
  if (!stem.startsWith(`${base}-`)) return null;
  const tail = stem.slice(base.length + 1);
  if (!/^(0|[1-9][0-9]{0,5})$/.test(tail)) return null;
  const seq = Number(tail);
  return seq <= MAX_SEGMENT_SEQ ? seq : null;
}

/**
 * Highest sequence this writer chain has on disk, per ONE directory listing —
 * how a writer that lost its in-memory position (first append of a session, a
 * workspace switch, a module reload) resumes at the right place.
 *
 * `listed: true` means the listing itself succeeded (even if it found nothing,
 * so `highest` legitimately stays 0). `listed: false` means the listing THREW:
 * `highest` is then a meaningless 0, NOT evidence of anything, and the caller
 * must never read it as "nothing exists above this" — a thrown listing proves
 * no absence. `appendEventSegment` builds its `highestReliableSeq` (patience
 * threshold) and `listedHighestSeq` (the only source of trusted absence above
 * a seq) from this flag.
 */
type OwnSeqDiscovery = { highest: number; listed: boolean };

async function discoverHighestOwnSeq(
  eventsDir: DirectoryHandleLike,
  base: string,
  segmentSuffix: string
): Promise<OwnSeqDiscovery> {
  try {
    let highest = 0;
    for (const entry of await listDirectoryEntries(eventsDir)) {
      if (entry.kind !== "file") continue;
      const seq = parseOwnSegmentSeq(entry.name, base, segmentSuffix);
      if (seq !== null && seq > highest) highest = seq;
    }
    return { highest, listed: true };
  } catch {
    return { highest: 0, listed: false };
  }
}

/* ─────────────────────────── line codec + sizing ────────────────────────── */

const utf8 = new TextEncoder();

export function utf8Length(text: string): number {
  return utf8.encode(text).length;
}

function countLines(text: string): number {
  let lines = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    lines += 1;
  }
  return lines;
}

export function encodeEventLine(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}

export function decodeEventLines<TEvent>(
  text: string,
  segmentName: string,
  parseError: (segmentName: string) => string
): TEvent[] {
  const events: TEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as TEvent);
    } catch {
      throw new Error(parseError(segmentName));
    }
  }
  return events;
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
function shouldRotate(
  existing: string,
  existingBytes: number,
  addedBytes: number,
  addedLines: number
): boolean {
  if (existingBytes === 0) return false;
  if (existingBytes + addedBytes > MAX_OPEN_SEGMENT_BYTES) return true;
  return countLines(existing) + addedLines > MAX_OPEN_SEGMENT_LINES;
}

/**
 * Split a batch so no single append rewrites more than one full segment's worth
 * of bytes or lines.
 *
 * `shouldRotate` deliberately lets an OVERSIZED batch exceed the cap once
 * (an empty segment must never rotate, or a large batch would rotate forever
 * without landing). That escape hatch is what puts a multi-megabyte single
 * write on the share for a whole-month bulk assignment — the largest, slowest,
 * most failure-prone write the app performs. Chunking here removes the escape
 * hatch at the source: each append is bounded, so a 9,000-event month is many
 * ~128 KiB writes instead of one ~2.3 MB write, and a failure costs one chunk
 * rather than the batch.
 *
 * Chunks preserve input order, so the fold order of the batch is unchanged.
 */
export function chunkEventsForSegmentAppends<TEvent>(events: TEvent[]): TEvent[][] {
  const chunks: TEvent[][] = [];
  let current: TEvent[] = [];
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

/* ───────────────────── module-level per-writer memo state ───────────────── */

/**
 * NAMESPACED PER CONSUMER — round 3's Gap 1a, and the single most important
 * correctness property of this extraction.
 *
 * Both memos below are module-level, so they are shared by every consumer of
 * this module inside one tab. Keyed on `{scopeId}|{fileName}` alone — as they
 * were while distribution was their only user — two consumers whose writers
 * share a device and a session (which they always do: one machine, one page
 * load) compute the SAME base name and would therefore read each other's
 * entries as their own. The consequences are not theoretical:
 *
 * - `writtenSegmentsThisSession`: consumer B's genuinely-first append would see
 *   consumer A's entry, conclude "this session already wrote that file", take
 *   the PATIENT ~11 s ladder on a `NotFoundError` that is simply the correct
 *   answer, and stall the first save of every session by eleven seconds.
 * - `openSegmentSeqByWriter`: consumer B would resume at consumer A's sequence
 *   number in its own, empty directory — producing a sparse chain whose earlier
 *   sequence numbers never exist, which §8 of the proposal's migration marker
 *   ("the earliest segment belonging to that writer's chain") depends on not
 *   happening.
 *
 * `consumerNamespace` is a short fixed literal per consumer, so this costs
 * nothing and cannot be influenced by user data.
 */
function segmentMemoKey(
  consumerNamespace: string,
  scopeId: string | undefined,
  name: string
): string {
  return `${consumerNamespace}|${scopeId ?? "<unscoped>"}|${name}`;
}

/**
 * The sequence number this writer chain's OPEN segment currently sits at, per
 * `{consumerNamespace}|{scopeId}|{base}`. Purely a round-trip saver: it lets
 * steady-state appends skip the directory listing that `discoverHighestOwnSeq`
 * would otherwise do. Losing it (a fresh session, a workspace switch, a module
 * reload) costs one listing and produces the same answer, and it is only ever
 * recorded for a segment a write actually landed in — so it can never point
 * ahead of what is on disk.
 */
const openSegmentSeqByWriter = new Map<string, number>();

/**
 * Segment file names this session has successfully written — the signal for
 * whether a NotFoundError on the pre-append re-read is worth retrying.
 *
 * Before this session's first append to a segment, absence is the expected,
 * correct answer (a fresh writer session always starts a new file) and must
 * resolve immediately: retrying would put dead wait in front of the first
 * action of every session. After a successful append the file exists, so a
 * NotFoundError is far more likely to be UNC/SMB directory-listing latency, and
 * re-reading "" there would make this append rewrite the file without the lines
 * already in it.
 *
 * It only gates *retrying*, never the final answer.
 *
 * KEY IDENTITY (perf): the key is `{consumerNamespace}|{scopeId}|{fileName}`,
 * where `scopeId` is the caller's stable workspace+month identity —
 * distribution passes `workspaceScopeId(root)|month` from `inFlightReads.ts`,
 * the same per-root WeakMap id the dedupe/epoch keys already use. Keying by
 * bare file name made the memo carry across a workspace switch: the same
 * segment legitimately does not exist in the newly mounted workspace, so the
 * first append there burned the entire ~630 ms retry ladder AND a
 * `classifyNotFound` write probe before falling back to "". With the scope in
 * the key that stale hit cannot happen at all. See `segmentMemoKey` for why the
 * consumer namespace is in there too.
 *
 * The fallback is unchanged and still load-bearing: an exhausted retry returns
 * "" rather than hard-failing, with a log entry recording that it happened.
 */
const writtenSegmentsThisSession = new Set<string>();

/**
 * @internal test-only — forget which segments this session has written, and
 * which sequence each writer chain's open segment sits at (both are per-session
 * writer state; a test that resets one without the other would leave a writer
 * pointing at a segment it no longer believes it wrote). Clears EVERY consumer
 * namespace, matching the whole-module reset distribution's own tests have
 * always had.
 */
export function __resetAppendOnlyEventLogMemosForTests(): void {
  writtenSegmentsThisSession.clear();
  openSegmentSeqByWriter.clear();
}

/* ───────────────────────────── the append path ──────────────────────────── */

/**
 * `reliable: false` means the "" is a FALLBACK, not an observation: this
 * session had already written the segment, the re-read exhausted its retries,
 * and the append is therefore about to rewrite the file without lines that may
 * still be on the share. That distinction is load-bearing — it decides whether
 * a later unverifiable post-close check may be treated as benign.
 */
type ExistingSegment = { text: string; reliable: boolean };

/**
 * How `readExistingSegment` should treat a name — WHICH LADDER and WHETHER
 * ABSENCE MAY BE TRUSTED are two separate questions (fix round 2, N1):
 * - `known`: this chain provably wrote/lists the name -> patient ladder, and an
 *   exhausted read is never a trusted absence.
 * - `distrust`: the name is "claimed" only because a directory listing THREW
 *   (no evidence either way). It gets the FAST ladder (so a broken listing
 *   cannot spin for minutes) but NotFound is retried on it and, once
 *   exhausted, is `reliable: false` — a thrown listing never makes an absent
 *   segment trustworthy, or a stale NotFound would overwrite a real segment.
 * - neither: absence is trusted (a listing SUCCEEDED without the name, or the
 *   seq is above the highest one a successful listing showed, or non-stable).
 */
type SegmentClaim = {
  known: boolean;
  distrust: boolean;
  /**
   * Hop-after-unreadable only: retry NotFound on the FAST ladder, then trust
   * the absence. Set by `asHopClaim` when the previous segment was already
   * unreadable, so a single stale NotFound on this target (another tab's, or
   * this tab's pre-reload, segment hidden by a stale but successful listing)
   * is re-probed (~630 ms worst case, only on an already-anomalous save)
   * before being believed. Never set on the healthy path.
   */
  retryAbsence?: boolean;
};

/** Mark a claim as belonging to a hop taken because the previous segment was unreadable. */
function asHopClaim(claim: SegmentClaim): SegmentClaim {
  return claim.known || claim.distrust ? claim : { ...claim, retryAbsence: true };
}

async function readExistingSegment(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  claim: SegmentClaim,
  diagnostics: EventLogDiagnostics,
  deadline: OperationDeadline | undefined
): Promise<ExistingSegment> {
  const knownWritten = claim.known;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const existingHandle = await eventsDir.getFileHandle(fileName, { create: false });
      return { text: await (await existingHandle.getFile()).text(), reliable: true };
    } catch (error) {
      const transient = knownWritten
        ? isTransientWriteError(error)
        : claim.distrust || claim.retryAbsence
          ? isNotReadableError(error) || isNotFoundError(error)
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
        const delay = nextRetryDelayMs(ladder[attempt]!, deadline);
        if (delay !== null) {
          await waitFor(delay);
          continue;
        }
        // The ladder had rungs left; we stopped only because the caller's
        // deadline ran out. Falls through to the `knownWritten || !isNotFoundError`
        // check below exactly like a rung-exhausted stop does — R1: that rule
        // already covers "deadline ran out on a knownWritten segment" (knownWritten
        // is true, so the check is true regardless of the error), so no separate
        // deadline-specific branch is needed here.
      }
      // E1 (production analysis: .superpowers/sdd/errorlog-2026-09-28/
      // unreadable-segments.md): this used to only treat an EXHAUSTED
      // `knownWritten && isNotFoundError` as unreliable. A `NotReadableError`
      // or `InvalidStateError` past the ladder fell through to the
      // "fresh, no segment yet" branch below and came back `reliable: true`
      // — so the caller happily REWROTE an existing segment (whose bytes are
      // still on the share, just not readable through this error) with only
      // the new batch, silently truncating everything already in it. With a
      // stable chain (A1) the first append after every reload targets a
      // segment that is very likely non-empty, which makes this reachable on
      // an ordinary reload rather than only on some rare edge case — so any
      // exhausted ladder for a writer that HAS a prior claim on this name
      // (knownWritten), or ANY non-`NotFoundError` outcome regardless of
      // `knownWritten`, must come back unreliable and force a rotation
      // instead. Only a `NotFoundError` on a name nothing has ever claimed
      // stays a genuine, reliable "no segment yet" observation. Applies to
      // every writer, stable or not — the bug was in the shared mechanics.
      if (knownWritten || claim.distrust || !isNotFoundError(error)) {
        // Retries exhausted. Fall back to "" (the long-standing behavior for
        // the covered case) rather than hard-failing, because the memo can be
        // stale after a workspace switch — but record it, and record what
        // kind of error this was, since the alternative reading is that this
        // append is about to rewrite the file without lines that are still on
        // the share. `logExhaustedNotFound` runs its NotFound-specific
        // directory probe (and its "NotFoundError persisted…" message) only
        // when the error genuinely IS one; a NotReadableError/InvalidStateError
        // gets a plain log entry instead — `logError` already records the
        // DOMException's own `name`, which is the detail that matters here.
        if (isNotFoundError(error)) {
          await logExhaustedNotFound(
            diagnostics.rereadContext,
            eventsDir,
            fileName,
            attempt + 1,
            error
          );
        } else {
          logError(diagnostics.rereadContext, error);
        }
        return { text: "", reliable: false };
      }
      // No prior content for this writer session yet — start from empty. This
      // IS an observation: a fresh writer session legitimately has no segment.
      //
      // Residual hazard: this still trusts a `NotFoundError` on an unclaimed
      // name at face value, and for a `stable` writer `knownFor` first trusts
      // a directory LISTING as proof of "claimed". A listing that is itself
      // stale (entry not yet visible) combined with a `getFileHandle` that
      // also still reports `NotFoundError` looks identical to "genuinely
      // never written" — both paths agree on `reliable: true`. Nothing here
      // can distinguish that combination from the real fresh-segment case; it
      // is bounded by the same share-visibility-lag assumption `knownFor`
      // already accepts.
      return { text: "", reliable: true };
    }
  }
}

/**
 * Post-close read-back check.
 *
 * Chrome's close() already finalizes the write (swap-file + verification
 * pipeline — Chromium bug 40899722); this is a cheap existence/size check that
 * catches silent truncation on a flaky network share without re-reading and
 * re-parsing the whole segment.
 *
 * Returns `"unverified"` rather than throwing when the file cannot be READ at
 * all after the retry ladder. That is not the same failure as a size we read
 * and found wrong, and conflating the two was a live data-integrity bug:
 *
 * `close()` had already resolved, so the bytes ARE committed — the code says so
 * itself, recording the segment in `writtenSegmentsThisSession` *before* this
 * check for exactly that reason. A NotFound/NotReadable here is the share not
 * yet showing an entry it already holds. Throwing aborted the caller before its
 * projection `casLoop`, so the events were durable on disk while
 * `distribution.log.json`'s revision never advanced — and revision is the
 * staleness authority everywhere. The assignee's mirror was therefore judged
 * current and the assignment stayed invisible to them *through reloads*, the
 * sync tick never fired, and an operator retry ran against a stale snapshot
 * whose idempotency guard no longer matched, emitting duplicate events.
 *
 * A definite size MISMATCH still throws: there we successfully read the file
 * and it is genuinely wrong, which is a real failed write.
 */
export type SegmentVerification = "verified" | "unverified";

async function verifySegmentSize(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  expectedBytes: number,
  /** Whether the pre-append re-read observed the file rather than falling back. */
  baselineReliable: boolean,
  diagnostics: EventLogDiagnostics,
  deadline: OperationDeadline | undefined
): Promise<SegmentVerification> {
  // The patient ladder: this reads back a segment whose `close()` already
  // resolved, so it provably exists and only the share's view is stale. Giving
  // up in ~630 ms was turning completed month-save writes into reported failures.
  for (let attempt = 0; ; attempt += 1) {
    const ladderDelay =
      attempt < VERIFY_READBACK_RETRY_DELAYS_MS.length ? VERIFY_READBACK_RETRY_DELAYS_MS[attempt]! : null;
    // F15: the very first retry always happens even if the deadline is
    // already spent by the time we get here, so a merely-STALE size read (SMB
    // visibility lag) gets one more look instead of being reported as a fatal
    // mismatch on the strength of a single observation. Only later retries are
    // gated by the remaining budget.
    const delay = ladderDelay === null ? null : attempt === 0 ? ladderDelay : nextRetryDelayMs(ladderDelay, deadline);
    const retriesLeft = delay !== null;
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
            diagnostics.verifyContext,
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
        // Inconclusive, not failed — commit the projection so the write is
        // visible to its consumers instead of stranded.
        //
        // Baseline UNRELIABLE: the pre-append re-read of a segment this session
        // wrote had already fallen back to "", so this append just rewrote the
        // file without lines that may still be on the share. That is a possible
        // data loss, and this check is the only thing that detects it — it must
        // stay fatal. Treating it as benign would silently drop events.
        if (!baselineReliable) throw error;
        logCodedError(diagnostics.verifyContext, diagnostics.unverifiedCode, error);
        return "unverified";
      }
      await waitFor(delay ?? 0);
      continue;
    }
    if (!retriesLeft) {
      // We READ the file and its size is wrong — a genuine bad write, not a
      // visibility artefact. Still fatal.
      throw tagError(
        new Error(diagnostics.verificationFailedError(fileName, expectedBytes, observedSize)),
        diagnostics.sizeMismatchCode
      );
    }
    await waitFor(delay ?? 0);
  }
}

/* ────────────────── rotate away from a blocked replace (E1b) ────────────── */

/**
 * At most this many attempts against the SAME target when the write's
 * `write`/`close` step fails with `InvalidStateError` or
 * `NoModificationAllowedError` — i.e. `close()`'s swap→target replace was
 * refused. R8(b): `NotReadableError`, and either of those same two error
 * names at the earlier `getFileHandle`/`createWritable` steps (before any
 * replace was even attempted), take the patient ladder instead — see
 * `writeSegmentOnce`'s own doc comment for why only `write`/`close` counts.
 *
 * This is deliberately much shorter than `VERIFY_READBACK_RETRY_DELAYS_MS`
 * (the ladder still used for a `NotFoundError` on this same step, and for the
 * pre-append re-read of a segment this session already wrote). The production
 * root cause this ladder exists for (see
 * `.superpowers/sdd/errorlog-2026-09-28/answer-save-invalidstate.md`) is that
 * EVERY retry — every inner rung, every `casLoop` attempt — targets the exact
 * same file name, because `seq` only advances on a successful write. When the
 * share refuses to replace that one file (another machine holding it open
 * without `FILE_SHARE_DELETE`, a denied delete, a delete-pending state), no
 * amount of patience against the SAME name helps: ~27 identical failed
 * `close()` calls were observed over ~34 s in production, and every later save
 * in the page session failed the same way. One length here — [20] — gives the
 * ordinary case (a reader briefly holding the file, releasing it within tens
 * of milliseconds) a real second chance, and then hands off to rotation, which
 * is the actual fix: a fresh segment has no reader contending for it.
 */
const SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS = [20] as const;

/** Which step inside one write attempt threw — for diagnostics only. */
type SegmentWriteStep = "getFileHandle" | "createWritable" | "write" | "close";

/** A write attempt that exhausted `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` on a blocked-replace error. */
type BlockedSegmentWrite = {
  step: SegmentWriteStep;
  attempts: number;
  error: unknown;
};

/**
 * One segment WRITE (create-or-open, `createWritable`, `write`, `close`),
 * with three independently-laddered retry behaviours depending on how it
 * failed:
 *
 * - `NotFoundError` — unrelated to a blocked REPLACE (that always means the
 *   target already existed); keeps the existing patient
 *   `VERIFY_READBACK_RETRY_DELAYS_MS` ladder and existing exhaustion handling
 *   (`logExhaustedNotFound`, then rethrow) untouched.
 * - `InvalidStateError` / `NoModificationAllowedError` — these are the two
 *   shapes Chromium actually raises for a REFUSED REPLACE at the `write`/
 *   `close` step (see `writeSegmentOnce`'s and the module's own evidence-doc
 *   citations). The short `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` ladder.
 *   Once that's spent (by rungs OR by the deadline — the caller reacts to the
 *   failure itself, not to whether the deadline happened to still have
 *   budget), this returns a `BlockedSegmentWrite` instead of throwing, so the
 *   caller can decide to rotate rather than have the whole append fail.
 * - R8(b): `NotReadableError` is deliberately EXCLUDED from the rotate-on-
 *   blocked-replace path, even though it is otherwise a "transient write"
 *   error (`isTransientWriteError`). It typically surfaces at `getFileHandle`/
 *   `createWritable` — i.e. before any replace was even attempted — and is
 *   not evidence that THIS target's replace is being refused, just that it is
 *   briefly unreadable. Rotating away from it would abandon a perfectly good
 *   segment on a transient hiccup. It gets the same patient
 *   `VERIFY_READBACK_RETRY_DELAYS_MS` ladder as `NotFoundError` instead.
 * - Any other, non-transient error rethrows immediately, exactly as before.
 */
async function writeSegmentOnce(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  content: string,
  diagnostics: EventLogDiagnostics,
  deadline: OperationDeadline | undefined
): Promise<BlockedSegmentWrite | null> {
  for (let attempt = 0; ; attempt += 1) {
    let step: SegmentWriteStep = "getFileHandle";
    try {
      const handle = await eventsDir.getFileHandle(fileName, { create: true });
      if (!handle.createWritable) {
        throw taggedError(diagnostics.cannotWriteCode, `Browser cannot write ${fileName}.`);
      }
      step = "createWritable";
      const writable = await handle.createWritable();
      step = "write";
      await writable.write(content);
      step = "close";
      await writable.close();
      return null;
    } catch (error) {
      // R8(b): only InvalidStateError/NoModificationAllowedError AT THE
      // write/close STEP — the actual swap→target replace, and the write to
      // the swap file that feeds it — count as evidence of a REFUSED REPLACE.
      // The SAME two error names at the earlier getFileHandle/createWritable
      // steps happen before any replace is even attempted, so they are not
      // that evidence; NotReadableError at any step isn't either (it
      // typically fires before a replace was attempted too). All of those
      // get the patient ladder like NotFoundError, not the short
      // rotate-on-exhaustion one.
      const isBlockedReplaceShape = isSnapshotStaleError(error) || isLockContentionError(error);
      const isBlockedReplaceStep = step === "write" || step === "close";
      if (isNotFoundError(error) || isNotReadableError(error) || (isBlockedReplaceShape && !isBlockedReplaceStep)) {
        // The PATIENT ladder (~11 s), not the short one (~630 ms). Failing
        // here aborts a whole month save, so there is nothing to be gained by
        // giving up quickly — the same reasoning the post-close read-back
        // already applies, which left the write itself as the odd one out.
        if (attempt < VERIFY_READBACK_RETRY_DELAYS_MS.length) {
          const delay = nextRetryDelayMs(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!, deadline);
          if (delay !== null) {
            await waitFor(delay);
            continue;
          }
        }
        if (isNotFoundError(error)) {
          await logExhaustedNotFound(diagnostics.writeContext, eventsDir, fileName, attempt + 1, error);
        } else {
          logError(diagnostics.writeContext, error);
        }
        throw error;
      }
      // R8(b): only the two shapes Chromium actually raises for a REFUSED
      // REPLACE, AT the write/close step, trigger the short ladder + rotation.
      if (isBlockedReplaceShape && isBlockedReplaceStep) {
        if (attempt < SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS.length) {
          const delay = nextRetryDelayMs(
            SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS[attempt]!,
            deadline
          );
          if (delay !== null) {
            await waitFor(delay);
            continue;
          }
        }
        return { step, attempts: attempt + 1, error };
      }
      throw error;
    }
  }
}

/**
 * A write we could not CONFIRM via `close()` — did it land anyway? Chromium's
 * swap→target `MoveFileEx` is atomic (see the evidence doc cited above), so in
 * practice the target is either fully replaced or fully untouched. This is a
 * single, unretried defensive read regardless: if the current size already
 * matches what THIS write would have produced, the bytes MIGHT be there —
 * but R8(a): a size match alone is not proof. Another writer could have
 * coincidentally produced a file of the same total size (same batch length,
 * different content) in the same narrow window, and treating that as "landed"
 * would then rotate away and leave the actual batch unwritten anywhere. So
 * this also reads the tail and checks it literally ends with the bytes THIS
 * call was trying to write — not just that the file is the right length.
 * Any failure to even read it back answers "no" — the conservative default
 * everywhere else in this module — and the caller rotates.
 */
async function segmentReplaceMayHaveLanded(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  expectedBytes: number,
  addedText: string
): Promise<boolean> {
  try {
    const handle = await eventsDir.getFileHandle(fileName, { create: false });
    const file = await handle.getFile();
    if (file.size !== expectedBytes) return false;
    const text = await file.text();
    return text.endsWith(addedText);
  } catch {
    return false;
  }
}

/** Diagnostic for a blocked replace, whether or not it ends up being rotated away from. */
function logBlockedSegmentReplace(
  context: string,
  blocked: BlockedSegmentWrite,
  fileName: string
): void {
  const errorName =
    blocked.error && typeof blocked.error === "object"
      ? (blocked.error as { name?: unknown }).name
      : undefined;
  const detail = blocked.error instanceof Error ? blocked.error.message : String(blocked.error);
  const message =
    `Segment replace refused after ${blocked.attempts} attempt(s) at step "${blocked.step}" ` +
    `on "${fileName}" (${typeof errorName === "string" ? errorName : "unknown"}): ${detail}`;
  const code = classifyFileSystemError(blocked.error);
  if (code) {
    logCodedError(context, code, new Error(message));
  } else {
    logError(context, new Error(message));
  }
}

/**
 * Small, FIXED bound on how many extra rotation hops
 * `ensureReliableRotationTarget` will take looking for a reliably-readable
 * target, independent of `MAX_SEGMENT_SEQ`.
 *
 * Without this, a `stable` writer whose directory LISTING is itself
 * persistently broken (`knownFor`'s own conservative "listing failed ->
 * treat as claimed" fallback, see its doc comment) makes EVERY candidate
 * name look claimed — including names that were never actually written —
 * so each one takes the ~11 s patient ladder, exhausts it as a genuine
 * NotFoundError, and comes back unreliable too. Bounded only by
 * `MAX_SEGMENT_SEQ` (999,999), that combination spins for the better part
 * of an hour before finally throwing — reproduced in
 * `appendOnlyEventLog.test.ts`'s "treats a directory-listing failure inside
 * knownFor as claimed too" test, which took over 700 s before this bound was
 * added. A handful of hops is already far more patience than any real,
 * bounded contention (one blocked file, or a segment or two behind a slow
 * rotation) ever needs; beyond that the directory itself is unusable and
 * failing fast with a clear error is far better than hanging the save.
 *
 * Fix rounds 1-2: the broken-listing scenario is also bounded at its source —
 * `knownWrittenFor` gives a listing-failure-only claim the FAST ladder (never
 * the ~11 s patient one) — but such a claim is DISTRUSTED (an exhausted
 * NotFound is `reliable: false`), so it ends here, in XQ-IO-038, rather than
 * ever overwriting. This constant is what bounds that: five hops of a fast
 * ladder each, not a spin toward `MAX_SEGMENT_SEQ`.
 */
const MAX_UNRELIABLE_ROTATION_ATTEMPTS = 5;

/**
 * R2: never WRITE to a rotation target whose own pre-write baseline read was
 * unreliable. An unreliable read means "this name's real contents could not
 * be confirmed" — writing `existing.text + addedText` there anyway (where
 * `existing.text` is the unreliable fallback `""`) is exactly the truncation
 * hazard `readExistingSegment`'s own contract exists to prevent, just one
 * rotation hop later. This keeps rotating forward — bounded by BOTH
 * `MAX_SEGMENT_SEQ` and, well before that in practice,
 * `MAX_UNRELIABLE_ROTATION_ATTEMPTS` — until it finds a target it CAN read
 * reliably, or throws rather than ever landing on an unconfirmed one.
 */
async function ensureReliableRotationTarget(
  eventsDir: DirectoryHandleLike,
  base: string,
  segmentSuffix: string,
  seq: number,
  fileName: string,
  existing: ExistingSegment,
  knownWrittenFor: (name: string, candidateSeq: number) => Promise<SegmentClaim>,
  diagnostics: EventLogDiagnostics,
  deadline: OperationDeadline | undefined
): Promise<{ seq: number; fileName: string; existing: ExistingSegment }> {
  let attempts = 0;
  while (!existing.reliable) {
    if (seq >= MAX_SEGMENT_SEQ || attempts >= MAX_UNRELIABLE_ROTATION_ATTEMPTS) {
      throw taggedError(
        "XQ-IO-038",
        `Refusing to write segment "${fileName}": its pre-write baseline could not be read ` +
          `reliably, and the rotation ${
            seq >= MAX_SEGMENT_SEQ
              ? `ceiling (seq ${MAX_SEGMENT_SEQ})`
              : `attempt bound (${MAX_UNRELIABLE_ROTATION_ATTEMPTS})`
          } has been reached. Never overwriting a segment whose existing contents are unconfirmed.`
      );
    }
    attempts += 1;
    seq += 1;
    fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
    existing = await readExistingSegment(
      eventsDir,
      fileName,
      asHopClaim(await knownWrittenFor(fileName, seq)),
      diagnostics,
      deadline
    );
  }
  return { seq, fileName, existing };
}

/**
 * Append a whole batch of events to the CURRENT writer session's own OPEN
 * NDJSON segment. deviceId+sessionId is unique per running app instance, so
 * this chain is never written by any other concurrent writer — uniqueness moved
 * from per-event to per-writer-session.
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
 * workspace folder at all. So the rewrite stays — what changes is that it is
 * BOUNDED.
 *
 * BOUNDED SEGMENT ROTATION. The chain is `{base}{suffix}` (seq 0), then `-1`,
 * `-2`, … Only the highest one is ever opened for writing; once the writer
 * moves past a segment that segment is sealed and is never rewritten, renamed,
 * or deleted. So the rewrite cost per append is bounded by
 * MAX_OPEN_SEGMENT_BYTES instead of growing with session length, while a reader
 * still only ever tails one growing file per writer session (the sealed ones
 * stop changing size and stop producing tails).
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
export async function appendEventSegment<TEvent>(
  parentDir: DirectoryHandleLike,
  events: TEvent[],
  writer: SegmentWriterIdentity,
  config: AppendOnlyEventLogConfig,
  options: AppendEventSegmentOptions = {}
): Promise<SegmentVerification> {
  if (events.length === 0) return "verified";
  const { deadline } = options;
  const { consumerNamespace, eventsDirName, segmentSuffix, diagnostics } = config;
  const eventsDir = await parentDir.getDirectoryHandle(eventsDirName, { create: true });
  const base = buildSegmentBaseName(writer, segmentSuffix, config.baseNamePrefix);
  const writerKey = segmentMemoKey(consumerNamespace, writer.scopeId, base);
  const addedText = events.map(encodeEventLine).join("");
  const addedBytes = utf8Length(addedText);
  const memoKeyFor = (name: string) => segmentMemoKey(consumerNamespace, writer.scopeId, name);

  // Has THIS chain already written `name`? For a per-session writer only this
  // session's memo can say so. A stable writer's chain may predate the page (or
  // be shared with another tab of the same browser, serialised by the lock
  // below), so a name the directory LISTS is treated as written: a stale
  // NotFound then takes the patient ladder and rotates away instead of
  // rewriting the file without its lines. A listing failure is treated as
  // "written" — the conservative answer, BUT (IMPORTANT 1 fix round) it also
  // reports whether that "written" verdict is backed by real evidence
  // (`positiveEvidence`) or is only the conservative fallback for a listing
  // that itself threw — `knownWrittenFor` below is what turns that into the
  // final answer `readExistingSegment` receives.
  const knownFor = async (name: string): Promise<{ claimed: boolean; positiveEvidence: boolean }> => {
    if (writtenSegmentsThisSession.has(memoKeyFor(name))) return { claimed: true, positiveEvidence: true };
    if (!writer.stable) return { claimed: false, positiveEvidence: false };
    try {
      const found = (await listDirectoryEntries(eventsDir)).some(
        (entry) => entry.kind === "file" && entry.name === name
      );
      // A successful listing is positive evidence EITHER way — "found" is
      // proof it's claimed, and "not found" is proof (for THIS moment) that
      // it isn't. Only a THROWN listing carries no evidence at all.
      return { claimed: found, positiveEvidence: true };
    } catch {
      return { claimed: true, positiveEvidence: false };
    }
  };

  // Two watermarks, both -1 when the source has nothing to say:
  // - `highestReliableSeq`: highest seq we have positive evidence EXISTS (this
  //   session's own last write, or a successful discovery listing). A
  //   listing-failure claim at or below it keeps the patient ladder.
  // - `listedHighestSeq`: highest seq a SUCCESSFUL listing showed. Only above
  //   it may a listing-failure claim be trusted as absent — a memoised seq is
  //   no evidence about what another tab wrote above it, and a thrown
  //   discovery listing is no evidence at all.
  // Fix round 2 (N1): a listing-failure claim above `highestReliableSeq` and not
  // provably absent gets the FAST ladder but `distrust` (exhausted NotFound is
  // unreliable), so a thrown listing can never turn a stale NotFound into a
  // trusted absence, yet cannot spin for ~11 s per hop either.
  let highestReliableSeq: number;
  let listedHighestSeq = -1;
  const knownWrittenFor = async (name: string, candidateSeq: number): Promise<SegmentClaim> => {
    const claim = await knownFor(name);
    if (!claim.claimed) return { known: false, distrust: false };
    if (claim.positiveEvidence || candidateSeq <= highestReliableSeq) return { known: true, distrust: false };
    if (listedHighestSeq >= 0 && candidateSeq > listedHighestSeq) return { known: false, distrust: false };
    return { known: false, distrust: true };
  };

  // A read-modify-write full-file rewrite is only race-free against OTHER
  // writer CHAINS (different base name). Within THIS session, two overlapping
  // batch calls (e.g. two independent UI actions firing close together) would
  // otherwise both read the same "existing" content and the second write
  // would silently clobber the first's lines. Lock per writer CHAIN -- not
  // per file name -- so that the rotation decision and the write it implies
  // are one critical section: locking per file would let two concurrent
  // appends read the same full segment, both decide to rotate, and race on
  // `seq + 1`. For a NON-stable writer, a chain is unique per (deviceId,
  // sessionId), so distinct sessions/devices never contend on this lock — each
  // page load is its own chain, hence its own lock name.
  //
  // A `stable` writer's chain (answers, A1) is keyed on (deviceId, persisted
  // chain id) instead, so two tabs of the same browser + user + month
  // deliberately DO share this lock name — that sharing is exactly what makes
  // it safe for them to also share one segment file: Web Locks are scoped per
  // ORIGIN, not per tab/page instance, so the lock still serialises their
  // appends into one critical section even though each tab is a separate JS
  // heap with its own `writtenSegmentsThisSession`/`openSegmentSeqByWriter`
  // memo. See the `stable` field's doc comment on `SegmentWriterIdentity` for
  // the full argument. R9: that cross-tab guarantee holds only when the REAL
  // `navigator.locks` is present — `withResourceLock`'s no-`navigator.locks`
  // fallback (`webLocks.ts`) serialises within one tab only, so on such a
  // browser/context two tabs sharing a stable chain are not actually
  // serialised against each other by this lock name.
  //
  // The key needs no consumer namespace: it already carries `eventsDirName`,
  // and two consumers sharing a directory SHOULD share the lock (they would be
  // writing the same files), while two consumers with different directories
  // cannot collide.
  return withResourceLock(`${eventsDirName}/${base}`, async () => {
    const memoizedSeq = openSegmentSeqByWriter.get(writerKey);
    let seq: number;
    if (memoizedSeq !== undefined) {
      // A prior successful write in this session — real evidence.
      seq = memoizedSeq;
      highestReliableSeq = memoizedSeq;
    } else {
      const discovered = await discoverHighestOwnSeq(eventsDir, base, segmentSuffix);
      seq = discovered.highest;
      highestReliableSeq = discovered.listed ? discovered.highest : -1;
      listedHighestSeq = discovered.listed ? discovered.highest : -1;
    }
    let fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
    let existing = await readExistingSegment(
      eventsDir,
      fileName,
      await knownWrittenFor(fileName, seq),
      diagnostics,
      deadline
    );
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
    // post-close check on the fresh segment is then benign instead of fatal.
    // The rotation target can never collide FOR A NON-STABLE WRITER: the memo
    // and `openSegmentSeqByWriter` advance together, so `seq` is the highest
    // this session ever wrote, and no other writer shares that chain (it is
    // unique per page load).
    //
    // A `stable` writer's chain CAN be shared by another tab of the same
    // browser + user + month (see `SegmentWriterIdentity.stable`'s doc
    // comment), so this tab's `openSegmentSeqByWriter` memo can be behind the
    // true on-disk state if the other tab has already rotated past it — this
    // tab simply has not discovered that yet. That is not a collision risk:
    // the lock above still serialises the two tabs' appends, and every write
    // re-reads (`readExistingSegment`/`knownFor`) its OWN target `fileName`
    // immediately before writing it, so whichever tab's append actually runs
    // sees and preserves whatever the other one already wrote there. Rotating
    // "one behind" the true state only means this tab's own segment fills up
    // slightly later than it otherwise would — never that two writers land on
    // the same rotation target at once. R9: "the lock above still serialises
    // the two tabs' appends" assumes the real `navigator.locks` — see the
    // caveat on the lock-name comment above and on `SegmentWriterIdentity.stable`.
    // IMPORTANT 1 fix round: this hop now goes through `ensureReliableRotationTarget`
    // too, exactly like the two branches below — a target reached from HERE is
    // no less capable of holding real content (e.g. another tab's segment, per
    // the reviewer's repro: seq0 unreadable, hop to seq1, and seq1 ALSO fails
    // its read while genuinely holding another tab's events) than one reached
    // from `shouldRotate` or a blocked replace, so it needs the same guarantee.
    // A listing that THREW makes `knownFor` claim every name; `knownWrittenFor`
    // gives such a claim the fast ladder (no ~11 s-per-hop spin) but distrusts
    // an exhausted NotFound (`reliable: false`), so this loop ends in a bounded
    // XQ-IO-038 instead of ever writing over a segment it could not read.
    if (!existing.reliable && seq < MAX_SEGMENT_SEQ) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
      existing = await readExistingSegment(
        eventsDir,
        fileName,
        asHopClaim(await knownWrittenFor(fileName, seq)),
        diagnostics,
        deadline
      );
      ({ seq, fileName, existing } = await ensureReliableRotationTarget(
        eventsDir,
        base,
        segmentSuffix,
        seq,
        fileName,
        existing,
        knownWrittenFor,
        diagnostics,
        deadline
      ));
      existingBytes = utf8Length(existing.text);
    }

    if (seq < MAX_SEGMENT_SEQ && shouldRotate(existing.text, existingBytes, addedBytes, events.length)) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
      // Read the rotation target too — reading it is what makes "the previous
      // run crashed after writing this name" and "the directory listing had
      // not caught up yet" non-destructive instead of an overwrite. How its
      // NotFound is treated depends on the claim: a target a successful
      // listing did NOT show (the normal case) is taken at face value with no
      // retry ladder; one the listing shows gets the patient ladder and an
      // exhausted NotFound is unreliable; one claimed only because the listing
      // threw gets the fast ladder and is likewise unreliable when exhausted.
      // (The hop taken after an UNREADABLE segment is stricter still — see
      // `asHopClaim`.)
      existing = await readExistingSegment(
        eventsDir,
        fileName,
        await knownWrittenFor(fileName, seq),
        diagnostics,
        deadline
      );
      // R2: an unreliable read on the rotation target itself must never be
      // written over — keep rotating (bounded) or throw instead.
      ({ seq, fileName, existing } = await ensureReliableRotationTarget(
        eventsDir,
        base,
        segmentSuffix,
        seq,
        fileName,
        existing,
        knownWrittenFor,
        diagnostics,
        deadline
      ));
      existingBytes = utf8Length(existing.text);
    }

    // ROTATE AWAY FROM A SEGMENT WHOSE REPLACE IS REFUSED (E1b). Unlike the
    // two rotation branches above — which react to a bad PRE-append READ —
    // this one reacts to the WRITE step itself failing on the target we
    // already decided to use. `writeSegmentOnce` retries `NotFoundError` AND
    // `NotReadableError` on its own patient ladder unchanged (R8(b): neither
    // is evidence of a refused REPLACE); it returns (rather than throws) only
    // once `InvalidStateError`/`NoModificationAllowedError` at the `write`/
    // `close` step specifically has exhausted the short
    // `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` ladder — i.e. the share is
    // refusing to replace THIS file specifically. At most one rotation happens
    // here per call: `rotatedForBlockedReplace` bounds the loop, so a second
    // blocked target rethrows instead of rotating forever.
    let rotatedForBlockedReplace = false;
    for (;;) {
      const blocked = await writeSegmentOnce(
        eventsDir,
        fileName,
        existing.text + addedText,
        diagnostics,
        deadline
      );
      if (!blocked) break;

      logBlockedSegmentReplace(diagnostics.writeContext, blocked, fileName);

      // `MoveFileEx` is atomic, so in the overwhelming case this reads false —
      // but a re-read here is what "verify by re-reading size/tail before
      // rotating" (E1b) means: never rotate away from a write whose bytes are
      // already sitting in this file, or the batch lands a second time in the
      // rotated segment too.
      const alreadyLanded = await segmentReplaceMayHaveLanded(
        eventsDir,
        fileName,
        existingBytes + addedBytes,
        addedText
      );
      if (alreadyLanded) break;

      if (rotatedForBlockedReplace || seq >= MAX_SEGMENT_SEQ) {
        // Never rewrite/overwrite the failed segment: leave it exactly as it
        // was and let the caller (casLoop) see the real underlying error.
        throw blocked.error;
      }
      rotatedForBlockedReplace = true;
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
      // Same non-destructive re-read every other rotation branch here does:
      // an unwritten target normally resolves immediately, and reading it is
      // what makes a segment left behind by a crashed run non-destructive
      // instead of an overwrite.
      existing = await readExistingSegment(
        eventsDir,
        fileName,
        await knownWrittenFor(fileName, seq),
        diagnostics,
        deadline
      );
      // R2: never write to a rotation target we could not read reliably —
      // keep rotating (bounded) or throw, same as the size-threshold branch.
      ({ seq, fileName, existing } = await ensureReliableRotationTarget(
        eventsDir,
        base,
        segmentSuffix,
        seq,
        fileName,
        existing,
        knownWrittenFor,
        diagnostics,
        deadline
      ));
      existingBytes = utf8Length(existing.text);
    }
    // Recorded before verification, deliberately: the bytes are already on the
    // share at this point, so the next append must continue in THIS segment
    // even if the post-close size check below fails and this call reports an
    // error. Pointing back at the previous segment there would strand the
    // lines just written outside the writer's own view of its chain.
    writtenSegmentsThisSession.add(memoKeyFor(fileName));
    openSegmentSeqByWriter.set(writerKey, seq);

    return verifySegmentSize(
      eventsDir,
      fileName,
      existingBytes + addedBytes,
      existing.reliable,
      diagnostics,
      deadline
    );
  });
}

/* ───────────────────────────── the read path ────────────────────────────── */

export type SegmentEventsDelta<TEvent> = {
  /** Newly-read events since `knownOffsets` (not globally sorted — callers sort). */
  events: TEvent[];
  /** Updated byte offset per segment file name (== current file size); persist this as the next call's knownOffsets. */
  offsets: Record<string, number>;
  /** Every segment file name seen in this listing. */
  segmentNames: string[];
  /**
   * Segments confirmed sealed by this read (S3, see `readSegmentTails`). A caller
   * that keeps an in-memory offsets cache hands this back as
   * `options.sealedConfirmed` so a sealed segment is not opened again. Absent
   * from a persisted checkpoint by design: losing it only costs one re-open.
   */
  sealedConfirmedNames: Set<string>;
};

/**
 * Thrown by `readEventSegmentDelta(..., { strict: true })` when one or more
 * matched segment files were listed but could not be read (the retry-then-
 * "vanished" tolerance `readSegmentTails` applies for every other caller —
 * see its own doc comment). A safety-critical caller cannot accept "listed,
 * unreadable, silently treated as if it never existed": a genuinely vanished
 * file (renamed, removed) and a persistently unreadable one are indistinguishable
 * from here, and the lenient default exists precisely to tolerate the SMB-share
 * flakiness that makes the former common — but a guard that must never miscount
 * an unreadable segment as "no events in it" needs the other read.
 */
export class EventSegmentUnreadableError extends Error {
  readonly segmentNames: string[];
  constructor(segmentNames: string[], options?: { cause?: unknown }) {
    super(
      `Event segment(s) listed but could not be read: ${segmentNames.join(", ")}`,
      options as ErrorOptions
    );
    this.name = "EventSegmentUnreadableError";
    this.segmentNames = segmentNames;
  }
}

/**
 * Read only the event lines appended past each segment's previously-known
 * byte offset (perf: fold-checkpoint). Passing `{}` reads every segment from
 * the start — the same function serves both a cold (full) read and a warm
 * (incremental) one.
 *
 * `options.strict` (default false, every existing caller unaffected): when a
 * matched segment was listed but its read was skipped as "vanished" (a
 * persistent `NotReadableError`/`NotFoundError` surviving `readSegmentTails`'
 * own short retry budget), the lenient default silently excludes it — correct
 * for ordinary share flakiness, wrong for a caller that must never read
 * "could not check this segment" as "this segment has no events". Strict mode
 * throws {@link EventSegmentUnreadableError} instead, and — load-bearing for
 * callers with their own incremental read cache — does so BEFORE building
 * `offsets`/`events`, so nothing here ever gets a chance to persist a partial
 * result as if it were complete.
 */
export async function readEventSegmentDelta<TEvent>(
  parentDir: DirectoryHandleLike,
  knownOffsets: Record<string, number>,
  config: AppendOnlyEventLogConfig,
  options?: { strict?: boolean; sealedConfirmed?: ReadonlySet<string> }
): Promise<SegmentEventsDelta<TEvent>> {
  const strict = options?.strict ?? false;
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await parentDir.getDirectoryHandle(config.eventsDirName, { create: false });
  } catch (error) {
    // Reject, don't invent. "No events directory" is a real answer; "I could
    // not open the events directory" is not, and returning an empty delta for
    // it makes a month's whole event history disappear from every fold that
    // reads through here.
    if (!isNotFoundError(error)) throw error;
    return { events: [], offsets: { ...knownOffsets }, segmentNames: [], sealedConfirmedNames: new Set() };
  }

  const { tailTextByName, sizeByName, matchedNames, sealedConfirmedNames } = await readSegmentTails(eventsDir, {
    suffix: config.segmentSuffix,
    knownOffsets,
    sealedConfirmed: options?.sealedConfirmed,
    // `eventsDir` comes from a raw getDirectoryHandle() (never path-registered),
    // and its name is the same in every month: scope the skip log by the parent.
    scopeKey: directoryResourceKey(parentDir, config.eventsDirName),
  });

  if (strict) {
    const skipped = matchedNames.filter((name) => !sizeByName.has(name));
    if (skipped.length > 0) {
      // Thrown before any of the reads below, and before the cache-shaped
      // `offsets`/`events` are built — a caller that persists an incremental
      // read cache (answerStorage.ts's own doc comment says so explicitly)
      // must never have a chance to write a checkpoint that silently treats
      // this segment as "read, found nothing new".
      throw new EventSegmentUnreadableError(skipped);
    }
  }

  const events: TEvent[] = [];
  for (const name of matchedNames) {
    const tailText = tailTextByName.get(name);
    if (tailText) {
      events.push(...decodeEventLines<TEvent>(tailText, name, config.diagnostics.segmentParseError));
    }
  }

  const offsets: Record<string, number> = { ...knownOffsets };
  for (const [name, size] of sizeByName) offsets[name] = size;

  return { events, offsets, segmentNames: matchedNames, sealedConfirmedNames };
}

/* ─────────────────────── event-set digest (fixed, not a parameter) ──────── */

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
 * ONE FIXED DIGEST FOR EVERY CONSUMER — deliberately not a parameter (round 3's
 * Finding 3). This function is already fully generic and pure (it assumes
 * nothing about what an id means), so letting a caller supply its own adds a
 * real risk — a wrong-but-plausible implementation could be non-commutative or
 * non-deterministic, silently breaking the cache-validity binding that depends
 * on it — for zero benefit.
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
 * made it: a collision means a rebuildable CACHE is trusted when its event set
 * has changed. Every mutation also bumps a `revision`, which is compared
 * alongside this value at the one call site that gates the cache, so a stale
 * cache needs BOTH a revision match and a digest collision to be accepted.
 */
export function eventSetDigest(ids: Iterable<string>): string {
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

/* ─────────────────── checkpoint shape + resume/dedup contract ───────────── */

/**
 * The resumable-fold checkpoint every consumer of this module shares.
 *
 * A consumer is free to add fields (distribution carries `legacyEventFileNames`
 * and `quotaFacts`), but these four are what the resume contract below reads.
 */
export type AppendOnlyFoldCheckpoint = {
  /** Byte size already folded, per segment file name. */
  segmentOffsets: Record<string, number>;
  /** Every eventId already folded into this checkpoint (sorted). */
  knownEventIds: string[];
  /** Fold/derive algorithm version this checkpoint was built with. */
  deriveVersion: number;
  /**
   * `eventSetDigest(knownEventIds)` — identical to the digest of the cache this
   * checkpoint was written with.
   *
   * LOAD-BEARING when the checkpoint lives in its own file. While a checkpoint
   * lives INSIDE the cache the two cannot disagree; as separate files they can
   * (a concurrent writer on an older build rewriting only the cache, a restore
   * that removed one and failed to remove the other, a half-landed write).
   * Resuming against a checkpoint whose `segmentOffsets` claim MORE has been
   * folded than the cache's entries actually reflect silently drops every event
   * in between. Optional only so a legacy inline checkpoint still type-checks.
   */
  eventSetId?: string;
};

export type CheckpointResumeVerdict =
  | { usable: true }
  | { usable: false; reason: "derive-version" | "digest-absent" | "digest-mismatch" };

/**
 * May this checkpoint be resumed onto that cache?
 *
 * Rejecting costs one full refold; accepting a wrong one loses data
 * permanently, because a checkpoint written on top of a wrong resume is
 * accepted forever after. Every "don't know" therefore answers no.
 */
export function checkpointResumeVerdict(
  checkpoint: Pick<AppendOnlyFoldCheckpoint, "deriveVersion" | "eventSetId">,
  expected: { deriveVersion: number; eventSetId: string | undefined }
): CheckpointResumeVerdict {
  if (checkpoint.deriveVersion !== expected.deriveVersion) {
    return { usable: false, reason: "derive-version" };
  }
  if (checkpoint.eventSetId === undefined) return { usable: false, reason: "digest-absent" };
  if (checkpoint.eventSetId !== expected.eventSetId) {
    return { usable: false, reason: "digest-mismatch" };
  }
  return { usable: true };
}

/**
 * DEDUP ACROSS THE CHECKPOINT BOUNDARY. `knownEventIds` is the set a checkpoint
 * has already folded; a fold is not idempotent, so re-absorbing an event
 * double-counts it. A per-batch `Map` dedupes a batch against ITSELF and cannot
 * see across the boundary at all — this is the filter that can.
 *
 * Every source can genuinely re-present a known event: a durable-append path
 * that retries a chunk and then degrades to a per-event file writes one event
 * twice, and a client that checkpointed in between meets the second copy as
 * brand-new bytes past its offset. A late-event guard does not catch it either
 * — a duplicate has the same ordering key AND the same id as the entry it
 * produced, so it reports "not late" and the resume path folds it again.
 *
 * Filtering is safe because a known id contributes nothing a re-read could add:
 * its content is immutable (a repeated id with conflicting content is a merge
 * error, not a silent overwrite), so the copy being skipped is byte-equal to
 * the one already folded.
 *
 * Returns first-seen order, so the caller's own concatenation order survives.
 */
export function filterAlreadyFolded<TEvent>(
  events: Iterable<TEvent>,
  knownEventIds: Iterable<string>,
  idOf: (event: TEvent) => string
): TEvent[] {
  const known = knownEventIds instanceof Set ? knownEventIds : new Set(knownEventIds);
  const deduped = new Map<string, TEvent>();
  for (const event of events) {
    const id = idOf(event);
    if (known.has(id)) continue;
    deduped.set(id, event);
  }
  return [...deduped.values()];
}

/* ───────────────────── ordering + late-event detection ──────────────────── */

/**
 * A comparison that may be UNDECIDABLE. `"unknown"` is what a marker that
 * predates a field (an older checkpoint format) yields — it is not "equal", and
 * conflating the two is what a conservative late-event guard exists to avoid.
 */
export type FoldOrderComparison = number | "unknown";

/**
 * The fold's canonical order, applied with the caller's own comparator.
 *
 * `Array#sort` is specified as stable, so a tie leaves the INPUT order — which
 * makes assembling that input the caller's responsibility, not this function's.
 * Mutates and returns `events`, matching `Array#sort`.
 */
export function sortEventsForFold<TEvent>(
  events: TEvent[],
  compare: (left: TEvent, right: TEvent) => number
): TEvent[] {
  return events.sort(compare);
}

/**
 * Correctness guard for the fold-checkpoint resume path. A fold that enforces
 * per-key state transitions is NOT commutative, so folding new events on top of
 * a resumed accumulator is only valid when every new event for an
 * already-known key sorts AFTER that key's last-folded event. On a shared
 * network-share workspace with several machines, an older event can
 * legitimately surface later (a straggling file write, a slow sync). When that
 * happens for a key the checkpoint already has an entry for, resuming would
 * silently risk folding out of order — **the caller MUST discard the checkpoint
 * and refold everything from scratch, never patch in place.**
 *
 * `compare` MUST be the same total order the caller's fold uses (round 3's Gap
 * 1b): a late-event guard that orders differently from the fold it guards is
 * not a guard. It is passed in rather than fixed to an `(eventAt, eventId)`
 * pair precisely so the two cannot drift apart — there is one comparator, and
 * both sides take it.
 *
 * An absent marker is NOT late: a key this fold has never seen has no prior
 * order to violate. An `"unknown"` comparison IS late: the marker exists but
 * cannot be ordered against, so the caller pays for one safe full refold rather
 * than risking a silent misordering.
 */
export function isEventOutOfOrder<TEvent, TMarker>(
  event: TEvent,
  marker: TMarker | undefined | null,
  compare: (event: TEvent, marker: TMarker) => FoldOrderComparison
): boolean {
  if (marker === undefined || marker === null) return false;
  const comparison = compare(event, marker);
  return comparison === "unknown" ? true : comparison < 0;
}
