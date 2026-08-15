import { describe, it, expect } from "vitest";
import {
  ARRAY_SET_CAP,
  COLUMNAR_ENCODING,
  ColumnarDecodeError,
  decodeColumnar,
  encodeColumnar,
  isColumnarEncoded,
  type ColumnarRow,
} from "./columnarCodec";

/* ------------------------------------------------------------------ *
 * Round-trip oracle
 *
 * The contract is canonical identity, not deep equality: key order has to
 * survive so that a re-encode is byte-stable and contentHash keeps meaning.
 * Every case is checked twice — in memory, and through a JSON serialisation of
 * the encoded payload, which is how it will actually be stored.
 * ------------------------------------------------------------------ */
function assertRoundTrip(rows: ColumnarRow[]): void {
  const expected = JSON.stringify(rows);
  const encoded = encodeColumnar(rows);
  expect(JSON.stringify(decodeColumnar(encoded))).toBe(expected);
  const reparsed: unknown = JSON.parse(JSON.stringify(encoded));
  expect(JSON.stringify(decodeColumnar(reparsed))).toBe(expected);
}

describe("columnarCodec — hand-written adversarial cases", () => {
  const cases: Record<string, ColumnarRow[]> = {
    "zero rows": [],
    "one row": [{ a: 1 }],
    "single column": [{ a: "x" }, { a: "y" }, { a: "x" }],
    "homogeneous scalars": [
      { a: 1, b: "x", c: null },
      { a: 2, b: "x", c: null },
    ],
    "absent key vs explicit null": [{ a: 1, b: null }, { a: 2 }, { a: 3, b: null }],
    "explicit undefined behaves like absent": [{ a: 1, b: undefined }, { a: 2, b: "v" }],
    "empty rows": [{}, {}, {}],
    "nested object uniformly present": [
      { id: "1", o: { r: "ok", e: null } },
      { id: "2", o: { r: "bad", e: "H1" } },
    ],
    "nested object null in some rows (must not flatten)": [
      { id: "1", o: { r: "ok" } },
      { id: "2", o: null },
      { id: "3", o: { r: "bad" } },
    ],
    "empty object value survives": [{ a: 1, o: {} }, { a: 2, o: { x: 1 } }],
    "object whose only key is undefined": [{ o: { a: undefined } }, { o: { a: 1 } }],
    "empty arrays and varying lengths": [
      { a: [], b: [1, 2] },
      { a: ["x"], b: [] },
      { a: ["x", "y", "z"], b: [3] },
    ],
    "heterogeneous column": [{ v: "s" }, { v: 1 }, { v: true }, { v: null }, { v: { o: 1 } }, { v: [1] }],
    "array column with a null": [{ v: [1] }, { v: null }, { v: [] }],
    "arrays mixed with numbers must not dictionary": [{ v: [1, 2] }, { v: 0 }, { v: 1 }],
    "Arabic keys and values": [
      { "رمز الجمرك": "٩٥", الحالة: "مطابق" },
      { "رمز الجمرك": "٩٠", الحالة: "غير مطابق" },
    ],
    "keys containing dots are not flattened paths": [
      { "a.b": 1, a: { b: 2 } },
      { "a.b": 3, a: { b: 4 } },
    ],
    "dotted key collides with a real nested path shape": [
      { "x.y.z": "flat", x: { y: { z: "nested" } } },
      { "x.y.z": "flat2", x: { y: { z: "nested2" } } },
    ],
    "__proto__ as a data key": [
      JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}') as ColumnarRow,
      JSON.parse('{"__proto__": {"polluted": false}, "safe": 2}') as ColumnarRow,
    ],
    "constructor / toString as data keys": [
      { constructor: "c", toString: "t", hasOwnProperty: "h" },
      { constructor: "c2", toString: "t2", hasOwnProperty: "h2" },
    ],
    "high-cardinality column defeats the dictionary": Array.from({ length: 200 }, (_, i) => ({
      id: `unique-${i}`,
    })),
    "deeply nested objects past the flatten cap": [
      { d: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } },
      { d: { a: { b: { c: { d: { e: { f: { g: { h: { i: 2 } } } } } } } } } },
    ],
    "inconsistent key order falls back": [
      { a: 1, b: 2 },
      { b: 3, a: 4 },
    ],
    "inconsistent nested key order still encodes the parent opaquely": [
      { id: "1", o: { a: 1, b: 2 } },
      { id: "2", o: { b: 3, a: 4 } },
    ],
    "numbers of every flavour": [
      { n: 0 },
      { n: -0 },
      { n: 1e21 },
      { n: -1.5 },
      { n: Number.MAX_SAFE_INTEGER },
      { n: 0.1 + 0.2 },
    ],
    "strings that look like indices": [{ v: "0" }, { v: "1" }, { v: "0" }, { v: "1" }],
  };

  for (const [name, rows] of Object.entries(cases)) {
    it(name, () => assertRoundTrip(rows));
  }

  it("does not pollute Object.prototype via a __proto__ data key", () => {
    const rows = [JSON.parse('{"__proto__": {"polluted": true}}') as ColumnarRow];
    const decoded = decodeColumnar(encodeColumnar(rows));
    expect(Object.prototype.hasOwnProperty.call(decoded[0], "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("columnarCodec — format guarantees", () => {
  it("stamps the encoding discriminator and writes fields once", () => {
    const rows = [
      { id: "a", port: "JED" },
      { id: "b", port: "JED" },
    ];
    const encoded = encodeColumnar(rows);
    expect(isColumnarEncoded(encoded)).toBe(true);
    if (!isColumnarEncoded(encoded)) throw new Error("unreachable");
    expect(encoded.encoding).toBe(COLUMNAR_ENCODING);
    expect(encoded.fields.map((f) => f.p)).toEqual(["id", "port"]);
    expect(encoded.rows).toHaveLength(2);
    expect(encoded.rows[0]).toHaveLength(2);
  });

  it("dictionary-encodes repeated strings but never numeric columns", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ port: i % 2 ? "JED" : "RUH", n: i % 2 }));
    const encoded = encodeColumnar(rows);
    if (!isColumnarEncoded(encoded)) throw new Error("expected columnar encoding");
    const [port, n] = encoded.fields;
    expect(port.k).toBe("dict");
    expect(port.d).toEqual(["RUH", "JED"]);
    expect(n.k).toBeUndefined();
  });

  it("keeps null literal inside a dictionary column", () => {
    const rows = [{ v: "a" }, { v: null }, { v: "a" }, { v: null }];
    const encoded = encodeColumnar(rows);
    if (!isColumnarEncoded(encoded)) throw new Error("expected columnar encoding");
    expect(encoded.fields[0].k).toBe("dict");
    expect(encoded.rows.map((r) => r[0])).toEqual([0, null, 0, null]);
    assertRoundTrip(rows);
  });

  it("stores flattened paths as segment lists, never dotted strings", () => {
    const rows = [{ a: { b: 1 } }, { a: { b: 2 } }];
    const encoded = encodeColumnar(rows);
    if (!isColumnarEncoded(encoded)) throw new Error("expected columnar encoding");
    expect(encoded.fields[0].p).toEqual(["a", "b"]);
  });

  it("inlines array values past the set-dictionary cap", () => {
    const rows = Array.from({ length: ARRAY_SET_CAP + 50 }, (_, i) => ({ tags: [`t${i}`] }));
    const encoded = encodeColumnar(rows);
    if (!isColumnarEncoded(encoded)) throw new Error("expected columnar encoding");
    expect(encoded.fields[0].k).toBe("arrayset");
    expect(encoded.fields[0].d).toHaveLength(ARRAY_SET_CAP);
    expect(Array.isArray(encoded.rows[ARRAY_SET_CAP + 10][0])).toBe(true);
    assertRoundTrip(rows);
  });

  it("reuses set-dictionary entries for repeated array combinations", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ tags: i % 2 ? ["a", "b"] : [] }));
    const encoded = encodeColumnar(rows);
    if (!isColumnarEncoded(encoded)) throw new Error("expected columnar encoding");
    expect(encoded.fields[0].d).toEqual([[], ["a", "b"]]);
    expect(encoded.rows.map((r) => r[0])).toEqual(rows.map((_, i) => (i % 2 ? 1 : 0)));
  });

  it("passes a plain array through decode untouched", () => {
    const rows = [{ a: 1 }];
    expect(decodeColumnar(rows)).toBe(rows);
  });

  it("re-encoding a decoded payload is byte-stable", () => {
    const rows = [
      { id: "1", o: { r: "ok", tags: ["x"] }, n: 1 },
      { id: "2", o: { r: "bad", tags: [] }, n: 2 },
    ];
    const once = JSON.stringify(encodeColumnar(rows));
    const twice = JSON.stringify(encodeColumnar(decodeColumnar(JSON.parse(once))));
    expect(twice).toBe(once);
  });

  it("rejects structurally invalid payloads", () => {
    expect(() => decodeColumnar({ encoding: "columnar-v1", rowCount: 1, fields: [], rows: [] })).toThrow(
      ColumnarDecodeError,
    );
    expect(() => decodeColumnar({ encoding: "nope" })).toThrow(ColumnarDecodeError);
    expect(() =>
      decodeColumnar({
        encoding: "columnar-v1",
        rowCount: 1,
        fields: [{ p: "a", k: "dict", d: ["x"] }],
        rows: [[7]],
      }),
    ).toThrow(ColumnarDecodeError);
    expect(() =>
      decodeColumnar({ encoding: "columnar-v1", rowCount: 1, fields: [{ p: "a" }], rows: [[]] }),
    ).toThrow(ColumnarDecodeError);
  });
});

/* ------------------------------------------------------------------ *
 * Property-based round trip
 *
 * fast-check is not a dependency of this repo and adding one was out of
 * scope, so the generator is hand-rolled on a seeded PRNG (mulberry32 — the
 * same generator the sampling layer uses). Every case is reproducible from its
 * seed alone, which is printed on failure.
 *
 * The generator draws a random SCHEMA first (column kinds, key names, nesting)
 * and then random rows against it, because the interesting bugs live in schema
 * discovery — flatten decisions, key order, dictionary legality — not in value
 * serialisation.
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];
const chance = (rng: Rng, p: number): boolean => rng() < p;
const int = (rng: Rng, maxExclusive: number): number => Math.floor(rng() * maxExclusive) % maxExclusive;

/** Key names chosen to stress path handling, not to look realistic. */
const KEY_POOL = [
  "id",
  "value",
  "a.b", // dotted: must never be read as a flattened path
  "a",
  "b",
  "x.y.z",
  "رمز الجمرك", // Arabic + space
  "الحالة",
  "__proto__",
  "constructor",
  "toString",
  "0",
  "1",
  " leading space",
  "trailing space ",
  "",
  "emoji🙂",
  "with\\backslash",
  'with"quote',
  "with null",
];

const STRING_POOL = ["JED", "RUH", "DMM", "مطابق", "غير مطابق", "", "0", "null", "🙂"];

type ColumnKind =
  | "lowCardString"
  | "highCardString"
  | "number"
  | "boolean"
  | "alwaysNull"
  | "mixed"
  | "objectFixed"
  | "objectOrNull"
  | "emptyObject"
  | "arraySmall"
  | "arrayHighCard"
  | "deepNested";

const COLUMN_KINDS: readonly ColumnKind[] = [
  "lowCardString",
  "highCardString",
  "number",
  "boolean",
  "alwaysNull",
  "mixed",
  "objectFixed",
  "objectOrNull",
  "emptyObject",
  "arraySmall",
  "arrayHighCard",
  "deepNested",
];

interface ColumnSpec {
  key: string;
  kind: ColumnKind;
  /** Probability the key is missing from a given row. */
  absentRate: number;
  /** Probability the value is an explicit `undefined` (canonically absent). */
  undefinedRate: number;
  /** Child keys, for object-shaped columns. */
  children: string[];
  /** When set, rows sometimes emit this column's children out of order. */
  shuffleChildren: boolean;
}

function makeSchema(rng: Rng): ColumnSpec[] {
  const columnCount = 1 + int(rng, 7);
  const used = new Set<string>();
  const columns: ColumnSpec[] = [];
  for (let i = 0; i < columnCount; i++) {
    let key = pick(rng, KEY_POOL);
    if (used.has(key)) key = `${key}#${i}`;
    used.add(key);
    const childCount = 1 + int(rng, 3);
    const children: string[] = [];
    const usedChildren = new Set<string>();
    for (let c = 0; c < childCount; c++) {
      let ck = pick(rng, KEY_POOL);
      if (usedChildren.has(ck)) ck = `${ck}#${c}`;
      usedChildren.add(ck);
      children.push(ck);
    }
    columns.push({
      key,
      kind: pick(rng, COLUMN_KINDS),
      absentRate: chance(rng, 0.4) ? rng() * 0.6 : 0,
      undefinedRate: chance(rng, 0.2) ? rng() * 0.3 : 0,
      children,
      shuffleChildren: chance(rng, 0.1),
    });
  }
  return columns;
}

function makeScalar(rng: Rng): unknown {
  const r = int(rng, 6);
  if (r === 0) return pick(rng, STRING_POOL);
  if (r === 1) return int(rng, 1000);
  if (r === 2) return chance(rng, 0.5);
  if (r === 3) return null;
  if (r === 4) return [int(rng, 3)];
  return { k: int(rng, 3) };
}

function makeDeep(rng: Rng, depth: number): unknown {
  if (depth === 0) return int(rng, 100);
  const obj: ColumnRecord = {};
  setKey(obj, pick(rng, ["n", "deep", "a.b"]), makeDeep(rng, depth - 1));
  return obj;
}

type ColumnRecord = Record<string, unknown>;

/** Assigns a key safely, so `__proto__` becomes an own property like JSON.parse gives. */
function setKey(target: ColumnRecord, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function makeValue(rng: Rng, spec: ColumnSpec, rowIndex: number): unknown {
  switch (spec.kind) {
    case "lowCardString":
      return pick(rng, STRING_POOL);
    case "highCardString":
      return `u-${rowIndex}-${int(rng, 1_000_000)}`;
    case "number":
      return chance(rng, 0.1) ? -0 : int(rng, 10_000) / (chance(rng, 0.3) ? 7 : 1);
    case "boolean":
      return chance(rng, 0.5);
    case "alwaysNull":
      return null;
    case "mixed":
      return makeScalar(rng);
    case "emptyObject":
      return chance(rng, 0.5) ? {} : { only: undefined };
    case "objectOrNull":
      if (chance(rng, 0.35)) return null;
      return makeObjectValue(rng, spec);
    case "objectFixed":
      return makeObjectValue(rng, spec);
    case "arraySmall": {
      const n = int(rng, 4);
      return Array.from({ length: n }, () => pick(rng, STRING_POOL));
    }
    case "arrayHighCard": {
      const n = int(rng, 4);
      return Array.from({ length: n }, () => int(rng, 1_000_000));
    }
    case "deepNested":
      return makeDeep(rng, 2 + int(rng, 9));
  }
}

function makeObjectValue(rng: Rng, spec: ColumnSpec): ColumnRecord {
  const obj: ColumnRecord = {};
  const keys = [...spec.children];
  // Occasionally emit the children in a different order: the codec must detect
  // that and fall back rather than silently reorder them.
  if (spec.shuffleChildren && chance(rng, 0.3)) keys.reverse();
  for (const key of keys) {
    if (chance(rng, 0.15)) continue;
    setKey(obj, key, chance(rng, 0.1) ? undefined : makeScalar(rng));
  }
  return obj;
}

const ROW_COUNTS = [0, 1, 2, 3, 5, 8, 17, 40];

function makeRows(rng: Rng, schema: ColumnSpec[]): ColumnarRow[] {
  const rowCount = pick(rng, ROW_COUNTS);
  // Decided once per row set, not per row: at a per-row probability a set of 40
  // rows would almost surely contain one shuffled row, so nearly every case
  // would take the order-violation fallback and the encoded path would go
  // largely untested.
  const shuffleRows = chance(rng, 0.12);
  const rows: ColumnarRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: ColumnRecord = {};
    const order = [...schema];
    // Top-level key order is usually stable and occasionally shuffled, which
    // exercises both the encoded path and the order-violation fallback.
    if (shuffleRows && chance(rng, 0.3)) order.reverse();
    for (const spec of order) {
      if (chance(rng, spec.absentRate)) continue;
      if (chance(rng, spec.undefinedRate)) {
        setKey(row, spec.key, undefined);
        continue;
      }
      setKey(row, spec.key, makeValue(rng, spec, i));
    }
    rows.push(row);
  }
  return rows;
}

interface Coverage {
  cases: number;
  fallback: number;
  encoded: number;
  dictColumns: number;
  arraySetColumns: number;
  rawColumns: number;
  flattenedPaths: number;
  emptyRowSets: number;
  absenceLists: number;
}

function record(coverage: Coverage, rows: ColumnarRow[]): void {
  coverage.cases++;
  if (rows.length === 0) coverage.emptyRowSets++;
  const encoded = encodeColumnar(rows);
  if (!isColumnarEncoded(encoded)) {
    coverage.fallback++;
    return;
  }
  coverage.encoded++;
  for (const field of encoded.fields) {
    if (field.k === "dict") coverage.dictColumns++;
    else if (field.k === "arrayset") coverage.arraySetColumns++;
    else coverage.rawColumns++;
    if (Array.isArray(field.p)) coverage.flattenedPaths++;
    if (field.a !== undefined || field.pr !== undefined) coverage.absenceLists++;
  }
}

describe("columnarCodec — property-based round trip", () => {
  it("round-trips thousands of generated row sets byte-identically", () => {
    const coverage: Coverage = {
      cases: 0,
      fallback: 0,
      encoded: 0,
      dictColumns: 0,
      arraySetColumns: 0,
      rawColumns: 0,
      flattenedPaths: 0,
      emptyRowSets: 0,
      absenceLists: 0,
    };
    // Raise for a deeper sweep: COLUMNAR_PROPERTY_CASES=200000 npx vitest run …
    const CASES = Number(process.env.COLUMNAR_PROPERTY_CASES ?? 5000);
    for (let seed = 1; seed <= CASES; seed++) {
      const rng = mulberry32(seed * 2654435761);
      const rows = makeRows(rng, makeSchema(rng));
      const expected = JSON.stringify(rows);
      let actual: string;
      let reparsed: string;
      try {
        const encoded = encodeColumnar(rows);
        actual = JSON.stringify(decodeColumnar(encoded));
        reparsed = JSON.stringify(decodeColumnar(JSON.parse(JSON.stringify(encoded))));
      } catch (error) {
        throw new Error(`seed ${seed} threw: ${String(error)}\ninput: ${expected}`, { cause: error });
      }
      if (actual !== expected || reparsed !== expected) {
        throw new Error(
          `seed ${seed} round trip mismatch\ninput:    ${expected}\nin-memory:${actual}\nreparsed: ${reparsed}`,
        );
      }
      record(coverage, rows);
    }

    // Printed so the run reports what the generator actually reached, rather
    // than leaving "5000 passed" to mean an untested space.
    console.log("[columnarCodec] property coverage:", JSON.stringify(coverage));

    expect(coverage.cases).toBe(CASES);
    // Guard against the generator degenerating into cases the codec skips.
    expect(coverage.encoded).toBeGreaterThan(CASES * 0.7);
    expect(coverage.fallback).toBeGreaterThan(0);
    expect(coverage.dictColumns).toBeGreaterThan(0);
    expect(coverage.arraySetColumns).toBeGreaterThan(0);
    expect(coverage.rawColumns).toBeGreaterThan(0);
    expect(coverage.flattenedPaths).toBeGreaterThan(0);
    expect(coverage.absenceLists).toBeGreaterThan(0);
    expect(coverage.emptyRowSets).toBeGreaterThan(0);
    // Generous: the default 5000 cases finish in under a second, but the loop
    // is meant to be re-run at 200000 via COLUMNAR_PROPERTY_CASES.
  }, 600_000);

  /*
   * The main loop caps row sets at 40 rows, so it can never push a column past
   * ARRAY_SET_CAP — which is exactly where the set dictionary starts inlining
   * literals next to indices. Mutation testing proved the gap: a mutant that
   * illegally admitted numbers into an "arrayset" column survived the 5000-case
   * loop and is only caught once a column crosses the cap. Hence this second,
   * deliberately large-row-count loop.
   */
  it("round-trips row sets large enough to cross the set-dictionary cap", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed * 40503);
      const rowCount = ARRAY_SET_CAP + int(rng, 400) + 1;
      const rows: ColumnarRow[] = [];
      for (let i = 0; i < rowCount; i++) {
        const row: ColumnRecord = {};
        // Distinct-per-row arrays blow past the cap; the sibling columns mix
        // arrays with scalars so an inlined literal can never be confused with
        // a dictionary index.
        setKey(row, "tags", [`t-${i}`, i]);
        // High-cardinality AND mixed-typed: both halves must cross the cap for
        // an inlined literal to sit next to a dictionary index in one column.
        setKey(row, "mixed", chance(rng, 0.5) ? [i, "a"] : i);
        setKey(row, "port", pick(rng, STRING_POOL));
        if (chance(rng, 0.2)) setKey(row, "maybe", null);
        rows.push(row);
      }
      const expected = JSON.stringify(rows);
      const encoded = encodeColumnar(rows);
      if (!isColumnarEncoded(encoded)) throw new Error(`seed ${seed} unexpectedly fell back`);
      expect(encoded.fields[0].d).toHaveLength(ARRAY_SET_CAP);
      expect(JSON.stringify(decodeColumnar(encoded))).toBe(expected);
      expect(JSON.stringify(decodeColumnar(JSON.parse(JSON.stringify(encoded))))).toBe(expected);
    }
  });
});
