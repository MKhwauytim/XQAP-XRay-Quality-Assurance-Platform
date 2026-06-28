import { describe, it, expect } from "vitest";
import {
  createSimpleHasher,
  hashJsonValue,
  isEnvelope,
  simpleHash,
  streamJsonStringify,
  unwrap,
  validateEnvelope,
  wrap,
} from "./jsonEnvelope";

function streamed(value: unknown): string {
  let out = "";
  for (const chunk of streamJsonStringify(value)) {
    out += chunk;
  }
  return out;
}

describe("jsonEnvelope", () => {
  it("wrap produces an envelope with metadata", () => {
    const result = wrap({ name: "test" });
    expect(result.metadata.schemaVersion).toBe(1);
    expect(result.metadata.revision).toBe(1);
    expect(result.data).toEqual({ name: "test" });
  });

  it("isEnvelope returns true for wrapped objects", () => {
    expect(isEnvelope(wrap({ x: 1 }))).toBe(true);
  });

  it("isEnvelope returns false for bare objects", () => {
    expect(isEnvelope({ name: "test" })).toBe(false);
  });

  it("unwrap returns data from envelope", () => {
    const env = wrap({ val: 42 });
    expect(unwrap(env)).toEqual({ val: 42 });
  });

  it("unwrap returns value as-is when not an envelope (legacy)", () => {
    expect(unwrap({ val: 42 })).toEqual({ val: 42 });
  });

  it("increments revision from previous", () => {
    const first = wrap({ x: 1 }, 0);
    const second = wrap({ x: 2 }, first.metadata.revision);
    expect(second.metadata.revision).toBe(2);
  });

  it("isEnvelope returns true for workspace-style envelope (string schemaVersion)", () => {
    const workspaceEnvelope = {
      metadata: {
        schemaVersion: "1.0.0",
        revision: 3,
        contentHash: "abc123",
        writtenAt: new Date().toISOString(),
      },
      data: { someField: "value" },
    };
    expect(isEnvelope(workspaceEnvelope)).toBe(true);
  });

  it("isEnvelope returns false for object missing metadata.schemaVersion", () => {
    expect(isEnvelope({ metadata: { revision: 1 }, data: {} })).toBe(false);
    expect(isEnvelope({ metadata: {}, data: {} })).toBe(false);
  });

  it("validateEnvelope rejects mismatched content hashes", () => {
    const env = wrap({ val: 1 });
    expect(validateEnvelope(env)).toBe(true);
    expect(validateEnvelope({ ...env, data: { val: 2 } })).toBe(false);
  });

  it("validateEnvelope preserves legacy bare JSON compatibility", () => {
    expect(validateEnvelope({ val: 1 })).toBe(true);
  });
});

describe("streamJsonStringify", () => {
  it("is byte-identical to compact JSON.stringify across mixed values", () => {
    const cases: unknown[] = [
      {},
      [],
      { a: 1, b: "two", c: true, d: null, e: 3.14 },
      [1, "x", false, null, { nested: [1, 2, 3] }],
      {
        rows: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `r${i}`,
          ok: i % 2 === 0,
        })),
      },
      { s: 'needs "escaping"\n\t and unicode é', arr: [undefined, 1] },
      { dropped: undefined, kept: 1, fn: () => 0 },
      { when: new Date("2026-06-28T00:00:00.000Z") },
      "top-level string",
      42,
      true,
      null,
      [undefined, null],
    ];
    for (const value of cases) {
      expect(streamed(value)).toBe(JSON.stringify(value));
    }
  });

  it("yields many chunks for a large array (never one giant string)", () => {
    const value = { rows: Array.from({ length: 1000 }, (_, i) => ({ i })) };
    let chunks = 0;
    let longest = 0;
    for (const chunk of streamJsonStringify(value)) {
      chunks += 1;
      longest = Math.max(longest, chunk.length);
    }
    // Framing + per-element chunks => thousands of small pieces, none large.
    expect(chunks).toBeGreaterThan(1000);
    expect(longest).toBeLessThan(64);
  });
});

describe("createSimpleHasher", () => {
  it("chunked hashing equals hashing the whole string", () => {
    const full = "the quick brown fox jumps over the lazy dog".repeat(37);
    const hasher = createSimpleHasher();
    for (let i = 0; i < full.length; i += 7) {
      hasher.update(full.slice(i, i + 7));
    }
    expect(hasher.digest()).toBe(simpleHash(full));
  });
});

describe("hashJsonValue", () => {
  it("equals simpleHash(JSON.stringify(value)) across mixed values", () => {
    const cases: unknown[] = [
      {},
      { a: 1, b: "two", c: [true, null, 3.14] },
      { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, ok: !!(i % 2) })) },
      [1, "x", { nested: { deep: [null, "é"] } }],
      "scalar",
      42,
    ];
    for (const value of cases) {
      expect(hashJsonValue(value)).toBe(simpleHash(JSON.stringify(value)));
    }
  });

  it("backs validateEnvelope: a wrapped large payload validates and rejects tampering", () => {
    const data = {
      rows: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `row-${i}`,
        score: i * 1.5,
      })),
    };
    const env = wrap(data);
    expect(env.metadata.contentHash).toBe(simpleHash(JSON.stringify(data)));
    expect(validateEnvelope(env)).toBe(true);
    expect(
      validateEnvelope({ ...env, data: { rows: [...data.rows, { id: -1 }] } })
    ).toBe(false);
  });
});
