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
import { withResourceLock } from "./webLocks";
import { logCodedError, tagError, taggedError, type ErrorCode } from "./errorCodes";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
  isNotFoundError,
  isNotReadableError,
  isTransientWriteError,
  logExhaustedNotFound,
  retryTransientWrite,
  waitFor,
} from "./transientFileErrors";

/* ────────────────────────────── configuration ───────────────────────────── */

/**
 * Who is writing, and where the write is allowed to be memoized to.
 *
 * `deviceId` is a stable per-machine id; `sessionId` is fresh per app session.
 * Together they are the unit of write uniqueness that replaces per-event ids:
 * two machines — or two tabs on the same machine — never share a segment file,
 * so concurrent writers never target the same file.
 *
 * `scopeId` is the caller's stable workspace+month identity. See
 * `writtenSegmentsThisSession` below for why the memo key needs it.
 */
export type SegmentWriterIdentity = {
  deviceId: string;
  sessionId: string;
  scopeId?: string;
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
 * Highest sequence this writer chain already has on disk — how a writer that
 * lost its in-memory position (first append of a session, a workspace switch,
 * a module reload) resumes at the right place instead of overwriting.
 *
 * A listing failure resolves to 0 rather than throwing: the append that follows
 * always re-reads the segment it lands on before writing it (see
 * `appendEventSegment`), so the worst case of an under-read listing is
 * appending to an already-full segment, never losing a line.
 */
async function discoverHighestOwnSeq(
  eventsDir: DirectoryHandleLike,
  base: string,
  segmentSuffix: string
): Promise<number> {
  try {
    let highest = 0;
    for (const entry of await listDirectoryEntries(eventsDir)) {
      if (entry.kind !== "file") continue;
      const seq = parseOwnSegmentSeq(entry.name, base, segmentSuffix);
      if (seq !== null && seq > highest) highest = seq;
    }
    return highest;
  } catch {
    return 0;
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

async function readExistingSegment(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  writtenKey: string,
  diagnostics: EventLogDiagnostics
): Promise<ExistingSegment> {
  const knownWritten = writtenSegmentsThisSession.has(writtenKey);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const existingHandle = await eventsDir.getFileHandle(fileName, { create: false });
      return { text: await (await existingHandle.getFile()).text(), reliable: true };
    } catch (error) {
      const transient = knownWritten ? isTransientWriteError(error) : isNotReadableError(error);
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
          diagnostics.rereadContext,
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
  diagnostics: EventLogDiagnostics
): Promise<SegmentVerification> {
  // The patient ladder: this reads back a segment whose `close()` already
  // resolved, so it provably exists and only the share's view is stale. Giving
  // up in ~630 ms was turning completed month-save writes into reported failures.
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
      await waitFor(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!);
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
    await waitFor(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!);
  }
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
  config: AppendOnlyEventLogConfig
): Promise<SegmentVerification> {
  if (events.length === 0) return "verified";
  const { consumerNamespace, eventsDirName, segmentSuffix, diagnostics } = config;
  const eventsDir = await parentDir.getDirectoryHandle(eventsDirName, { create: true });
  const base = buildSegmentBaseName(writer, segmentSuffix, config.baseNamePrefix);
  const writerKey = segmentMemoKey(consumerNamespace, writer.scopeId, base);
  const addedText = events.map(encodeEventLine).join("");
  const addedBytes = utf8Length(addedText);
  const memoKeyFor = (name: string) => segmentMemoKey(consumerNamespace, writer.scopeId, name);

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
  //
  // The key needs no consumer namespace: it already carries `eventsDirName`,
  // and two consumers sharing a directory SHOULD share the lock (they would be
  // writing the same files), while two consumers with different directories
  // cannot collide.
  return withResourceLock(`${eventsDirName}/${base}`, async () => {
    let seq =
      openSegmentSeqByWriter.get(writerKey) ??
      (await discoverHighestOwnSeq(eventsDir, base, segmentSuffix));
    let fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
    let existing = await readExistingSegment(eventsDir, fileName, memoKeyFor(fileName), diagnostics);
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
    // The rotation target can never collide: the memo and
    // `openSegmentSeqByWriter` advance together, so `seq` is the highest this
    // session ever wrote, and no other writer shares this chain.
    if (!existing.reliable && seq < MAX_SEGMENT_SEQ) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
      existing = await readExistingSegment(eventsDir, fileName, memoKeyFor(fileName), diagnostics);
      existingBytes = utf8Length(existing.text);
    }

    if (seq < MAX_SEGMENT_SEQ && shouldRotate(existing.text, existingBytes, addedBytes, events.length)) {
      seq += 1;
      fileName = segmentFileNameForSeq(base, seq, segmentSuffix);
      // Read the rotation target too. It is normally absent and this resolves
      // immediately (an unwritten segment is not in writtenSegmentsThisSession,
      // so a NotFoundError is taken at face value with no retry ladder) -- but
      // reading it is what makes "the previous run crashed after writing this
      // name" and "the directory listing had not caught up yet" non-destructive
      // instead of an overwrite.
      existing = await readExistingSegment(eventsDir, fileName, memoKeyFor(fileName), diagnostics);
      existingBytes = utf8Length(existing.text);
    }

    const appended = existing.text + addedText;

    await retryTransientWrite(
      async () => {
        const handle = await eventsDir.getFileHandle(fileName, { create: true });
        if (!handle.createWritable) {
          throw taggedError(diagnostics.cannotWriteCode, `Browser cannot write ${fileName}.`);
        }
        const writable = await handle.createWritable();
        await writable.write(appended);
        await writable.close();
      },
      { context: diagnostics.writeContext, dir: eventsDir, fileName },
      // The PATIENT ladder (~11 s), not the short one (~630 ms). Failing here
      // aborts a whole month save, so there is nothing to be gained by giving
      // up quickly — the same reasoning the post-close read-back already
      // applies, which left the write itself as the odd one out.
      VERIFY_READBACK_RETRY_DELAYS_MS
    );
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
      diagnostics
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
};

/**
 * Read only the event lines appended past each segment's previously-known
 * byte offset (perf: fold-checkpoint). Passing `{}` reads every segment from
 * the start — the same function serves both a cold (full) read and a warm
 * (incremental) one.
 */
export async function readEventSegmentDelta<TEvent>(
  parentDir: DirectoryHandleLike,
  knownOffsets: Record<string, number>,
  config: AppendOnlyEventLogConfig
): Promise<SegmentEventsDelta<TEvent>> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await parentDir.getDirectoryHandle(config.eventsDirName, { create: false });
  } catch (error) {
    // Reject, don't invent. "No events directory" is a real answer; "I could
    // not open the events directory" is not, and returning an empty delta for
    // it makes a month's whole event history disappear from every fold that
    // reads through here.
    if (!isNotFoundError(error)) throw error;
    return { events: [], offsets: { ...knownOffsets }, segmentNames: [] };
  }

  const { tailTextByName, sizeByName, matchedNames } = await readSegmentTails(eventsDir, {
    suffix: config.segmentSuffix,
    knownOffsets,
  });

  const events: TEvent[] = [];
  for (const name of matchedNames) {
    const tailText = tailTextByName.get(name);
    if (tailText) {
      events.push(...decodeEventLines<TEvent>(tailText, name, config.diagnostics.segmentParseError));
    }
  }

  const offsets: Record<string, number> = { ...knownOffsets };
  for (const [name, size] of sizeByName) offsets[name] = size;

  return { events, offsets, segmentNames: matchedNames };
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
