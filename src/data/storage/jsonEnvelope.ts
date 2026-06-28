export const ENVELOPE_SCHEMA_VERSION = 1;

export type JsonMetadata = {
  schemaVersion: number;
  revision: number;
  contentHash: string;
  writtenAt: string;
};

export type JsonEnvelope<TData> = {
  metadata: JsonMetadata;
  data: TData;
};

/**
 * Incremental form of {@link simpleHash}. Folding the same djb2-variant over a
 * value fed in chunks yields the identical digest as hashing the whole string —
 * which lets a payload far larger than V8's max string length be hashed without
 * ever materializing its full serialization (see `streamJsonStringify`).
 */
export function createSimpleHasher(): {
  update: (chunk: string) => void;
  digest: () => string;
} {
  let h = 5381;
  return {
    update(chunk: string) {
      for (let i = 0; i < chunk.length; i++) {
        h = ((h << 5) + h) ^ chunk.charCodeAt(i);
      }
    },
    digest() {
      return (h >>> 0).toString(16);
    },
  };
}

export function simpleHash(content: string): string {
  const hasher = createSimpleHasher();
  hasher.update(content);
  return hasher.digest();
}

type ResolvedJsonValue = { omit: boolean; value: unknown };

/**
 * Mirrors how `JSON.stringify` resolves a value before serializing it: applies
 * `toJSON()` if present, and flags values that serialize to nothing (they are
 * dropped as object members and rendered `null` as array elements).
 */
function resolveJsonValue(raw: unknown): ResolvedJsonValue {
  let value = raw;
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    value = (value as { toJSON: (key?: string) => unknown }).toJSON();
  }
  const omit =
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol";
  return { omit, value };
}

function* streamResolved(value: unknown): Generator<string, void, unknown> {
  if (Array.isArray(value)) {
    yield "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ",";
      const resolved = resolveJsonValue(value[i]);
      if (resolved.omit) {
        yield "null";
      } else {
        yield* streamResolved(resolved.value);
      }
    }
    yield "]";
    return;
  }

  if (value !== null && typeof value === "object") {
    yield "{";
    let first = true;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const resolved = resolveJsonValue((value as Record<string, unknown>)[key]);
      if (resolved.omit) continue;
      if (!first) yield ",";
      first = false;
      yield `${JSON.stringify(key)}:`;
      yield* streamResolved(resolved.value);
    }
    yield "}";
    return;
  }

  // Leaf (string, number, boolean, null): JSON.stringify renders it exactly and
  // each individual leaf is small, so this never approaches the string ceiling.
  yield JSON.stringify(value);
}

/**
 * Streams a **compact** `JSON.stringify(value)` as a sequence of small chunks.
 * The concatenation of every yielded chunk is byte-identical to
 * `JSON.stringify(value)` (no indentation), but arrays and objects are framed
 * by hand and only leaves go through `JSON.stringify`, so a value far larger
 * than V8's max string length can be serialized — and hashed via
 * {@link createSimpleHasher} — without ever building the whole string.
 *
 * Byte-identity matters: `validateEnvelope` recomputes
 * `simpleHash(JSON.stringify(data))` on read, so a streamed file's content hash
 * only validates if the streamed bytes equal `JSON.stringify(data)`.
 */
export function* streamJsonStringify(
  value: unknown
): Generator<string, void, unknown> {
  const resolved = resolveJsonValue(value);
  // Top-level undefined/function/symbol -> JSON.stringify returns `undefined`;
  // emit nothing (our payloads are always objects, so this is a guard).
  if (resolved.omit) return;
  yield* streamResolved(resolved.value);
}

/**
 * `simpleHash(JSON.stringify(value))` computed incrementally over streamed
 * chunks. The digest is identical to hashing the one-shot string (the chunks
 * concatenate to exactly `JSON.stringify(value)`), but no full-size
 * intermediate string is ever allocated — so it can't hit V8's max string
 * length and it lowers peak memory on every read and write that hashes a
 * payload.
 */
export function hashJsonValue(value: unknown): string {
  const hasher = createSimpleHasher();
  for (const chunk of streamJsonStringify(value)) {
    hasher.update(chunk);
  }
  return hasher.digest();
}

export function wrap<T>(
  data: T,
  previousRevision = 0
): JsonEnvelope<T> {
  return {
    metadata: {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      revision: previousRevision + 1,
      contentHash: hashJsonValue(data),
      writtenAt: new Date().toISOString(),
    },
    data,
  };
}

export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!("metadata" in v) || !("data" in v)) return false;
  const m = v["metadata"];
  if (!m || typeof m !== "object") return false;
  return "schemaVersion" in (m as object);
}

export function unwrap<T>(value: unknown): T {
  if (isEnvelope(value)) {
    return (value as JsonEnvelope<T>).data;
  }
  return value as T;
}

export function validateEnvelope(value: unknown): boolean {
  if (!isEnvelope(value)) {
    return true;
  }

  const envelope = value as JsonEnvelope<unknown>;

  // Workspace-management files use a richer metadata shape with a string
  // schemaVersion and their own SHA-256 hashing. They are validated by
  // fileSystemAccess.ts, so keep them readable here for compatibility.
  if (typeof envelope.metadata.schemaVersion === "string") {
    return true;
  }

  if (
    envelope.metadata.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
    typeof envelope.metadata.revision !== "number" ||
    !Number.isInteger(envelope.metadata.revision) ||
    envelope.metadata.revision < 1 ||
    typeof envelope.metadata.contentHash !== "string" ||
    typeof envelope.metadata.writtenAt !== "string"
  ) {
    return false;
  }

  return envelope.metadata.contentHash === hashJsonValue(envelope.data);
}
