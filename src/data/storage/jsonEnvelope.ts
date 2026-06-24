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

export function simpleHash(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) ^ content.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function wrap<T>(
  data: T,
  previousRevision = 0
): JsonEnvelope<T> {
  const serialized = JSON.stringify(data);
  return {
    metadata: {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      revision: previousRevision + 1,
      contentHash: simpleHash(serialized),
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

  return envelope.metadata.contentHash === simpleHash(JSON.stringify(envelope.data));
}
