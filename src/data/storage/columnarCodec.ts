/**
 * Columnar codec for large arrays of homogeneous row objects.
 *
 * Purpose: `population.final.json`-shaped payloads repeat every field name on
 * every row and repeat a small set of string values (ports, results, codes)
 * hundreds of thousands of times. Writing the field names once and
 * dictionary-encoding the repeated strings shrinks the JSON text dramatically
 * before any general-purpose compressor is applied.
 *
 * ## Contract
 *
 * `decode(encode(rows))` is **canonically identical** to `rows`:
 *
 *     JSON.stringify(decode(encode(rows))) === JSON.stringify(rows)
 *
 * — not merely deep-equal. Key order is preserved, so re-encoding a decoded
 * payload produces the same bytes and `contentHash` stays meaningful.
 *
 * Two consequences of using `JSON.stringify` as the equality oracle, both
 * deliberate:
 *
 * - A key whose value is `undefined` is treated exactly like an absent key,
 *   because `JSON.stringify` erases it either way. Nothing that survives a
 *   trip through a JSON file can tell the two apart.
 * - Anything the codec cannot represent order-exactly is not encoded at all:
 *   `encode` returns the input array untouched (see "Fallback" below). A
 *   correct-but-unencoded payload is always preferable to a reordered one.
 *
 * ## Shape of the encoded form
 *
 *     {
 *       encoding: "columnar-v1",
 *       rowCount: 3,
 *       fields: [ { p: "id" }, { p: ["risk", "level"], k: "dict", d: [...] } ],
 *       rows: [ [ "A", 0 ], [ "B", 1 ], [ "C", 0 ] ]
 *     }
 *
 * Row `i` field `j` lives at `rows[i][j]`; `fields[j]` says how to read it.
 *
 * ### Paths are segment lists, never dotted strings
 *
 * Nested objects are flattened, but a flattened path is stored as an **array
 * of segments** (`["a", "b"]`), and a single-segment path as a plain string
 * (`"a"`) purely to save bytes. The codec never splits a key on any separator,
 * so a literal key `"a.b"` and the nested path `a → b` are distinct fields that
 * cannot collide. Dot-joined path strings would make that collision silent and
 * unrecoverable, which is why they are not used.
 *
 * ### Per-field encodings (`k`)
 *
 * - absent (`raw`): values are stored literally in the row array.
 * - `"dict"`: legal **only** when every present value is a string or `null`.
 *   Present strings become integer indices into `d`; `null` stays literal
 *   `null`. Numeric columns are excluded by construction, so an integer cell in
 *   a dict column is never ambiguous.
 * - `"arrayset"`: legal only when every present value is an array or `null`.
 *   Distinct arrays (compared by their JSON text) go into a set dictionary `d`
 *   capped at {@link ARRAY_SET_CAP} entries; values past the cap are inlined
 *   literally. The decoder discriminates on `Array.isArray`: an array cell is a
 *   literal, a number cell is an index into `d`.
 *
 * Absence is tracked out-of-band per field (`a` = absent row indices, or `pr` =
 * present row indices, whichever list is shorter), so the placeholder sitting
 * in an absent cell carries no meaning and never collides with a real value.
 *
 * ## Fallback
 *
 * `encode` returns the input array unchanged when the payload cannot be
 * represented exactly — a non-object row, or top-level keys that appear in
 * different orders in different rows. `decode` passes any array straight
 * through, so plain and legacy payloads work with no discriminator.
 *
 * This module is intentionally self-contained: no dependencies, no I/O, no
 * compression framing. Callers do the JSON serialisation and compression.
 */

/** Discriminator stamped on every encoded payload. */
export const COLUMNAR_ENCODING = "columnar-v1" as const;

/**
 * Deepest nested object level that is flattened into columns. Anything deeper
 * is stored as one opaque value, which is still exact, just less compact.
 */
const MAX_FLATTEN_DEPTH = 8;

/** Maximum distinct array values held in an `"arrayset"` dictionary. */
export const ARRAY_SET_CAP = 4096;

/** Maximum distinct strings held in a `"dict"` dictionary. */
const STRING_DICT_CAP = 1 << 16;

/**
 * A string column is dictionary-encoded only when distinct values are at most
 * this fraction of present values; above it the dictionary costs more than it
 * saves.
 */
const STRING_DICT_RATIO = 0.8;

export type ColumnarRow = Record<string, unknown>;

export interface ColumnarField {
  /** Single-segment key, or the segment list of a flattened nested path. */
  p: string | string[];
  /** Column encoding; absent means the cells hold literal values. */
  k?: "dict" | "arrayset";
  /** Dictionary for `"dict"` / `"arrayset"` columns. */
  d?: unknown[];
  /** Row indices where the field is absent (used when shorter than `pr`). */
  a?: number[];
  /** Row indices where the field is present (used when shorter than `a`). */
  pr?: number[];
}

export interface ColumnarEncoded {
  encoding: typeof COLUMNAR_ENCODING;
  rowCount: number;
  fields: ColumnarField[];
  rows: unknown[][];
}

/** Thrown when an encoded payload is structurally invalid. */
export class ColumnarDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColumnarDecodeError";
  }
}

function isPlainObject(value: unknown): value is ColumnarRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `obj[key] = value`, safe for the `"__proto__"` key.
 *
 * Plain assignment of `"__proto__"` mutates the prototype instead of creating
 * an own property, so the key would silently vanish from the round trip (and,
 * worse, poison the object's prototype chain).
 */
function assignKey(target: ColumnarRow, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

/** True when the object has at least one own key whose value is not `undefined`. */
function hasDefinedKey(obj: ColumnarRow): boolean {
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Pass 1 — schema discovery
 *
 * Builds a trie of observed paths. Child insertion order is first-seen
 * document order, which is what keeps the emitted field order (and therefore
 * the decoded key order) identical to the input.
 * ------------------------------------------------------------------ */

interface SchemaNode {
  /** First-seen order among the parent's children. */
  order: number;
  children: Map<string, SchemaNode>;
  /** Present (non-`undefined`) occurrences that are NOT plain objects. */
  nonObject: number;
  /** Occurrences that are plain objects with no defined key. */
  emptyObject: number;
  /** Some row lists this node's children in a different relative order. */
  orderViolation: boolean;
}

function newNode(order: number): SchemaNode {
  return { order, children: new Map(), nonObject: 0, emptyObject: 0, orderViolation: false };
}

function scanObject(obj: ColumnarRow, node: SchemaNode, depth: number): void {
  let lastOrder = -1;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === undefined) continue; // indistinguishable from absent under JSON
    let child = node.children.get(key);
    if (child === undefined) {
      child = newNode(node.children.size);
      node.children.set(key, child);
    }
    if (child.order < lastOrder) node.orderViolation = true;
    lastOrder = child.order;

    if (isPlainObject(value) && depth + 1 < MAX_FLATTEN_DEPTH) {
      if (!hasDefinedKey(value)) child.emptyObject++;
      scanObject(value, child, depth + 1);
    } else {
      child.nonObject++;
    }
  }
}

/**
 * A node is flattened into its children only when every occurrence of it is a
 * non-empty plain object with a consistent key order. Otherwise it becomes a
 * leaf and its whole value is stored opaquely, which is trivially exact.
 *
 * Requiring "never empty" matters: an occurrence with no defined keys would
 * leave no child cell to write, so the decoder would drop the object entirely.
 */
function isFlattened(node: SchemaNode): boolean {
  return (
    node.children.size > 0 &&
    node.nonObject === 0 &&
    node.emptyObject === 0 &&
    !node.orderViolation
  );
}

function collectPaths(node: SchemaNode, prefix: string[], out: string[][]): void {
  for (const [key, child] of node.children) {
    const path = [...prefix, key];
    if (isFlattened(child)) collectPaths(child, path, out);
    else out.push(path);
  }
}

/* ------------------------------------------------------------------ *
 * Pass 2 — column extraction and per-column encoding
 * ------------------------------------------------------------------ */

/** Reads `path` out of `row`, reporting presence separately from the value. */
function probe(row: ColumnarRow, path: string[]): { value: unknown; present: boolean } {
  let current: unknown = row;
  for (let i = 0; i < path.length; i++) {
    if (!isPlainObject(current)) return { value: undefined, present: false };
    const key = path[i];
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { value: undefined, present: false };
    current = current[key];
  }
  if (current === undefined) return { value: undefined, present: false };
  return { value: current, present: true };
}

interface EncodedColumn {
  field: ColumnarField;
  cells: unknown[];
}

function classify(values: unknown[], presentIndices: number[]): "dict" | "arrayset" | "raw" {
  let allStringOrNull = true;
  let allArrayOrNull = true;
  let sawString = false;
  let sawArray = false;
  for (const i of presentIndices) {
    const v = values[i];
    if (v === null) continue;
    if (typeof v === "string") sawString = true;
    else allStringOrNull = false;
    if (Array.isArray(v)) sawArray = true;
    else allArrayOrNull = false;
    if (!allStringOrNull && !allArrayOrNull) return "raw";
  }
  if (allStringOrNull && sawString) return "dict";
  if (allArrayOrNull && sawArray) return "arrayset";
  return "raw";
}

function encodeStringDict(
  values: unknown[],
  presentIndices: number[],
  cells: unknown[],
  field: ColumnarField,
): boolean {
  const dict: string[] = [];
  const seen = new Map<string, number>();
  const indices = new Map<number, number>();
  for (const i of presentIndices) {
    const v = values[i];
    if (v === null) continue;
    const s = v as string;
    let at = seen.get(s);
    if (at === undefined) {
      if (dict.length >= STRING_DICT_CAP) return false;
      at = dict.length;
      dict.push(s);
      seen.set(s, at);
    }
    indices.set(i, at);
  }
  if (dict.length > indices.size * STRING_DICT_RATIO) return false;

  for (const i of presentIndices) {
    const at = indices.get(i);
    cells[i] = at === undefined ? null : at;
  }
  field.k = "dict";
  field.d = dict;
  return true;
}

function encodeArraySet(
  values: unknown[],
  presentIndices: number[],
  cells: unknown[],
  field: ColumnarField,
): void {
  const dict: unknown[] = [];
  const seen = new Map<string, number>();
  for (const i of presentIndices) {
    const v = values[i];
    if (v === null) {
      cells[i] = null;
      continue;
    }
    const key = JSON.stringify(v);
    let at = seen.get(key);
    if (at === undefined && dict.length < ARRAY_SET_CAP) {
      at = dict.length;
      dict.push(v);
      seen.set(key, at);
    }
    // Past the cap the value is inlined; the decoder tells the two apart with
    // Array.isArray, which is unambiguous because this column holds no numbers.
    cells[i] = at === undefined ? v : at;
  }
  field.k = "arrayset";
  field.d = dict;
}

function encodeColumn(path: string[], values: unknown[], present: boolean[], rowCount: number): EncodedColumn {
  const field: ColumnarField = { p: path.length === 1 ? path[0] : [...path] };

  const absentIndices: number[] = [];
  const presentIndices: number[] = [];
  for (let i = 0; i < rowCount; i++) (present[i] ? presentIndices : absentIndices).push(i);
  if (absentIndices.length > 0) {
    if (absentIndices.length <= presentIndices.length) field.a = absentIndices;
    else field.pr = presentIndices;
  }

  const cells: unknown[] = new Array<unknown>(rowCount).fill(null);
  const kind = classify(values, presentIndices);

  if (kind === "dict" && encodeStringDict(values, presentIndices, cells, field)) return { field, cells };
  if (kind === "arrayset") {
    encodeArraySet(values, presentIndices, cells, field);
    return { field, cells };
  }
  for (const i of presentIndices) cells[i] = values[i];
  return { field, cells };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** True when `value` looks like a payload produced by {@link encodeColumnar}. */
export function isColumnarEncoded(value: unknown): value is ColumnarEncoded {
  return (
    isPlainObject(value) &&
    (value as { encoding?: unknown }).encoding === COLUMNAR_ENCODING &&
    Array.isArray((value as { fields?: unknown }).fields) &&
    Array.isArray((value as { rows?: unknown }).rows)
  );
}

/**
 * Encodes an array of row objects columnar-wise.
 *
 * Returns the input array **unchanged** when the payload cannot be represented
 * with exact key order (non-object rows, or inconsistent top-level key order).
 * Callers should serialise whatever comes back and let {@link decodeColumnar}
 * discriminate on read.
 */
export function encodeColumnar(rows: ColumnarRow[]): ColumnarEncoded | ColumnarRow[] {
  if (!Array.isArray(rows)) throw new TypeError("encodeColumnar expects an array of row objects");

  const root = newNode(0);
  for (const row of rows) {
    if (!isPlainObject(row)) return rows; // not our shape — hand it back untouched
    scanObject(row, root, 0);
  }
  if (root.orderViolation) return rows; // top-level key order cannot be preserved

  const paths: string[][] = [];
  collectPaths(root, [], paths);

  const rowCount = rows.length;
  const fields: ColumnarField[] = [];
  const columns: unknown[][] = [];

  for (const path of paths) {
    const values = new Array<unknown>(rowCount);
    const present = new Array<boolean>(rowCount);
    for (let i = 0; i < rowCount; i++) {
      const hit = probe(rows[i], path);
      present[i] = hit.present;
      if (hit.present) values[i] = hit.value;
    }
    const column = encodeColumn(path, values, present, rowCount);
    fields.push(column.field);
    columns.push(column.cells);
  }

  const fieldCount = fields.length;
  const out: unknown[][] = new Array<unknown[]>(rowCount);
  for (let i = 0; i < rowCount; i++) {
    const cells = new Array<unknown>(fieldCount);
    for (let j = 0; j < fieldCount; j++) cells[j] = columns[j][i];
    out[i] = cells;
  }

  return { encoding: COLUMNAR_ENCODING, rowCount, fields, rows: out };
}

interface PreparedField {
  path: string[];
  kind: "dict" | "arrayset" | "raw";
  dict: unknown[];
  absent: Set<number> | null;
}

function prepareField(field: ColumnarField, index: number, rowCount: number): PreparedField {
  const p = field.p;
  const path = typeof p === "string" ? [p] : p;
  if (!Array.isArray(path) || path.length === 0 || path.some((s) => typeof s !== "string")) {
    throw new ColumnarDecodeError(`field ${index} has an invalid path`);
  }
  const kind = field.k ?? "raw";
  if (kind !== "raw" && kind !== "dict" && kind !== "arrayset") {
    throw new ColumnarDecodeError(`field ${index} has unknown encoding "${String(kind)}"`);
  }
  const dict = field.d ?? [];
  if (!Array.isArray(dict)) throw new ColumnarDecodeError(`field ${index} has a non-array dictionary`);

  let absent: Set<number> | null = null;
  if (Array.isArray(field.a)) {
    absent = new Set(field.a);
  } else if (Array.isArray(field.pr)) {
    const present = new Set(field.pr);
    absent = new Set<number>();
    for (let i = 0; i < rowCount; i++) if (!present.has(i)) absent.add(i);
  }
  return { path, kind, dict, absent };
}

function readCell(cell: unknown, prepared: PreparedField, index: number): unknown {
  if (prepared.kind === "dict") {
    if (cell === null) return null;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell >= prepared.dict.length) {
      throw new ColumnarDecodeError(`field ${index} has a dictionary index out of range`);
    }
    return prepared.dict[cell];
  }
  if (prepared.kind === "arrayset") {
    if (cell === null || Array.isArray(cell)) return cell;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell >= prepared.dict.length) {
      throw new ColumnarDecodeError(`field ${index} has a set-dictionary index out of range`);
    }
    return prepared.dict[cell];
  }
  return cell;
}

function writePath(row: ColumnarRow, path: string[], value: unknown): void {
  let current = row;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    let next = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
    if (!isPlainObject(next)) {
      next = {};
      assignKey(current, key, next);
    }
    current = next as ColumnarRow;
  }
  assignKey(current, path[path.length - 1], value);
}

/**
 * Decodes a payload produced by {@link encodeColumnar}.
 *
 * A plain array (legacy or fallback data) is returned untouched. Anything else
 * that is neither throws {@link ColumnarDecodeError}.
 */
export function decodeColumnar(payload: unknown): ColumnarRow[] {
  if (Array.isArray(payload)) return payload as ColumnarRow[];
  if (!isColumnarEncoded(payload)) {
    throw new ColumnarDecodeError("payload is neither a row array nor a columnar-v1 envelope");
  }

  const { fields, rows } = payload;
  const rowCount = typeof payload.rowCount === "number" ? payload.rowCount : rows.length;
  if (rows.length !== rowCount) {
    throw new ColumnarDecodeError(`rowCount ${rowCount} does not match ${rows.length} encoded rows`);
  }

  const prepared = fields.map((field, index) => prepareField(field, index, rowCount));
  const out: ColumnarRow[] = new Array<ColumnarRow>(rowCount);

  for (let i = 0; i < rowCount; i++) {
    const cells = rows[i];
    if (!Array.isArray(cells) || cells.length !== prepared.length) {
      throw new ColumnarDecodeError(`row ${i} has ${Array.isArray(cells) ? cells.length : "no"} cells, expected ${prepared.length}`);
    }
    const row: ColumnarRow = {};
    for (let j = 0; j < prepared.length; j++) {
      const field = prepared[j];
      if (field.absent !== null && field.absent.has(i)) continue;
      writePath(row, field.path, readCell(cells[j], field, j));
    }
    out[i] = row;
  }
  return out;
}
