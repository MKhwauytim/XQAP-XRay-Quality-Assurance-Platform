/**
 * Applies {@link encodeColumnar} to the row arrays of a whole file payload, and
 * undoes it on read.
 *
 * `columnarCodec.ts` encodes ONE array of row objects. A workspace payload is an
 * object wrapping such an array next to its scalar bookkeeping
 * (`{ sourceFileName, importedAt, rows: [...] }`), so this is the thin adapter
 * between the two: encode every top-level array that is big enough to be worth
 * it, leave everything else exactly as it was.
 *
 * ── Decoding is shape-driven, never policy-driven ───────────────────────────
 *
 * {@link decodePayloadColumns} looks for the `columnar-v1` discriminator and
 * decodes what it finds. It consults no table, no file name and no framing, so
 * a columnar payload decodes correctly however it got there — compressed or
 * plain, written by this version or a later one that changed the policy table.
 * A payload with no encoded array is returned untouched (identity), which is why
 * running it on every read is free.
 *
 * ── Key order ───────────────────────────────────────────────────────────────
 *
 * The re-assembled object is rebuilt in the SAME key order, and the codec itself
 * guarantees `JSON.stringify(decode(encode(rows))) === JSON.stringify(rows)`.
 * A decoded payload therefore re-serializes to the identical bytes, which is
 * what keeps `contentHash` and every golden master meaningful across the
 * transform.
 */
import {
  decodeColumnar,
  encodeColumnar,
  isColumnarEncoded,
  type ColumnarRow,
} from "./columnarCodec";

/**
 * Arrays shorter than this are left alone: the per-column dictionaries and the
 * field table cost more than they save on a handful of rows, and small payloads
 * are the ones a human might still open in an editor.
 */
export const COLUMNAR_MIN_ROWS = 2000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array worth encoding: long enough, and made of plain row objects. */
function isEncodableRowArray(value: unknown): value is ColumnarRow[] {
  if (!Array.isArray(value) || value.length < COLUMNAR_MIN_ROWS) return false;
  // `encodeColumnar` hands back a non-conforming array unchanged, so this is a
  // cheap pre-filter, not a correctness gate.
  return isPlainObject(value[0]);
}

/**
 * Columnar-encodes the payload's row arrays. Returns the input unchanged (same
 * reference) when there is nothing worth encoding, so callers can use it
 * unconditionally.
 */
export function encodePayloadColumns<T>(data: T): unknown {
  if (isEncodableRowArray(data)) return encodeColumnar(data);
  if (!isPlainObject(data)) return data;

  let changed = false;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (isEncodableRowArray(value)) {
      const encoded = encodeColumnar(value);
      // encodeColumnar returns the input array itself when it cannot represent
      // the payload exactly — that is not a change.
      if (encoded !== value) changed = true;
      out[key] = encoded;
    } else {
      out[key] = value;
    }
  }
  return changed ? out : data;
}

/**
 * Reverses {@link encodePayloadColumns}. Identity for any payload that carries
 * no `columnar-v1` array, which is every legacy and every plain file.
 */
export function decodePayloadColumns<T>(data: unknown): T {
  if (isColumnarEncoded(data)) return decodeColumnar(data) as T;
  if (!isPlainObject(data)) return data as T;

  let changed = false;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (isColumnarEncoded(value)) {
      out[key] = decodeColumnar(value);
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return (changed ? out : data) as T;
}
