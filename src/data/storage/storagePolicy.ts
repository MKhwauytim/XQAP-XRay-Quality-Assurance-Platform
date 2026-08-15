/**
 * Which workspace files are stored compressed, and which stay plain JSON.
 *
 * `safeWriteJson` can frame a file as `compressedEnvelope`'s plain-head-line +
 * gzip body, optionally columnar-encoding its row arrays first. Both are
 * measured wins on the handful of files that dominate a workspace, and a
 * measured *loss* on everything else — so this table exists to keep compression
 * an **explicit, per-file opt-in** rather than a silent global default. A caller
 * may also override it per call (`safeWriteJson(..., { policy })`).
 *
 * Reading never consults this table: the format is self-describing (the file
 * name does not change, the head line does), so `safeReadJson` reads plain and
 * compressed files through the same entry point, permanently and in both
 * directions. Removing a file from this table therefore changes only what the
 * *next* write produces — every file already on disk keeps working.
 *
 * ── Why these files and not others ──────────────────────────────────────────
 *
 * Measured on a real 117,336-row month (see the v86 benchmark):
 *
 * | file                          | plain   | columnar+gzip |
 * |-------------------------------|---------|---------------|
 * | `bi.raw.json`                 | 573 MB  | 3.4 MB        |
 * | `risk.raw.json`               | 211 MB  | 1.6 MB        |
 * | `population.final.json`       | 139 MB  | 0.9 MB        |
 *
 * Those three also carry the only fix for the parse ceiling: `bi.raw.json`
 * decodes to ~85% of V8's max string length, so the *plain* file is months away
 * from being unreadable at all.
 *
 * `sample.master.json`, `distribution.current.json`, `processing.summary.json`
 * and the large replacement-index buckets are MB-scale whole-file rewrites:
 * gzip pays for itself, but they are read back and re-written by CAS-style
 * read-modify-write flows where a columnar transform buys little and adds a
 * codec to the blast radius. They get **gzip only**.
 *
 * Everything else — manifests, permissions, notifications, the action log,
 * per-employee mirrors, `_index.json` — is KB-scale. Compressing them would
 * save kilobytes while costing inspectability (a human can still open a plain
 * file in an editor) and adding encode latency to files that are rewritten
 * constantly. They are deliberately absent from this table.
 *
 * ── The size gate ───────────────────────────────────────────────────────────
 *
 * Being in the table is necessary but not sufficient: a listed file is only
 * compressed once its payload is genuinely large ({@link COMPRESS_MIN_ROWS}).
 * A ten-row month, a fresh workspace, and every small fixture therefore keep
 * writing plain, inspectable JSON — which is both the right trade at that size
 * and the reason turning this on does not reformat the whole test suite. The
 * gate is O(1): it looks at array lengths, never at a serialized size, so it
 * costs nothing on the write path.
 */

export type StoragePolicy = {
  /** Frame the file as head line + gzip body (subject to {@link COMPRESS_MIN_ROWS}). */
  compress: boolean;
  /** Columnar-encode large top-level row arrays before serializing. */
  columnar: boolean;
};

/** Plain pretty/compact JSON — the default for every file not listed below. */
export const PLAIN_JSON_POLICY: StoragePolicy = { compress: false, columnar: false };

const GZIP_ONLY: StoragePolicy = { compress: true, columnar: false };
const GZIP_COLUMNAR: StoragePolicy = { compress: true, columnar: true };

/**
 * Minimum length of a top-level array in the payload before a listed file is
 * actually compressed. Below it the file stays plain JSON.
 *
 * 2,000 rows is roughly 1–2 MB of population/sample data: the point where the
 * write is dominated by bytes moved rather than by per-file overhead, and well
 * above every fixture and every hand-inspectable file.
 */
export const COMPRESS_MIN_ROWS = 2000;

/** Replacement-index buckets: `{certscan|noncertscan}.{stageKey}.json`. */
const REPLACEMENT_INDEX_BUCKET = /^(?:cert|noncert)scan\.[a-z]+\.json$/;

const BY_FILE_NAME = new Map<string, StoragePolicy>([
  // The three that dominate a workspace, and the only ones worth the codec.
  ["risk.raw.json", GZIP_COLUMNAR],
  ["bi.raw.json", GZIP_COLUMNAR],
  ["population.final.json", GZIP_COLUMNAR],
  // MB-scale whole-file rewrites — gzip only.
  ["sample.master.json", GZIP_ONLY],
  ["distribution.current.json", GZIP_ONLY],
  ["processing.summary.json", GZIP_ONLY],
]);

/** The storage policy for a file NAME (not a path — same name, same policy). */
export function resolveStoragePolicy(fileName: string): StoragePolicy {
  const byName = BY_FILE_NAME.get(fileName);
  if (byName) return byName;
  if (REPLACEMENT_INDEX_BUCKET.test(fileName)) return GZIP_ONLY;
  return PLAIN_JSON_POLICY;
}

/**
 * Is this payload big enough to be worth compressing? True when any top-level
 * property (or the payload itself) is an array of at least
 * {@link COMPRESS_MIN_ROWS} entries.
 *
 * Deliberately structural rather than byte-based: knowing the serialized size
 * would mean serializing the payload first, which for the very files this
 * exists for is the single most expensive step of the write.
 */
export function payloadQualifiesForCompression(data: unknown): boolean {
  if (Array.isArray(data)) return data.length >= COMPRESS_MIN_ROWS;
  if (!data || typeof data !== "object") return false;
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(value) && value.length >= COMPRESS_MIN_ROWS) return true;
  }
  return false;
}
