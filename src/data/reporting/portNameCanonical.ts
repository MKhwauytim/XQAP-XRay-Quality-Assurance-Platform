/**
 * Report-side port-name canonicalization. The same port reaches the report
 * under several spellings (الوديعة / الوديعه / الودعيه / منفذ الوديعة), and every
 * per-port figure groups by the raw string — so one port showed up as 2–3
 * separate rows, each with a fraction of its real evidence.
 *
 * Three layers, applied in order:
 *  1. Letter folding — alef/yaa/taa-marbuta/hamza-carrier variants, diacritics,
 *     spacing and the «منفذ» prefix never make two ports different.
 *  2. Typo clustering — a name within ONE edit (swapped, dropped, added or
 *     changed letter) of a clearly more common name is that name's typo. Guarded
 *     so two real ports can't merge: both names ≥ 5 letters after the port-type word, and the typo must
 *     be at most a fifth as frequent as the name it joins.
 *  3. Curated aliases — typos too common for layer 2 to trust.
 *
 * Each group shows ONE spelling: a curated alias, else the group's most frequent
 * raw spelling (ties → alphabetical, so output is deterministic).
 */

/** Letter-folded comparison key. */
function foldKey(name: string): string {
  return name
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^منفذ /, "");
}

/** Folded key → display spelling, for typos clustering can't safely catch. */
const PORT_ALIASES: Record<string, string> = {
  // «الودعيه» is a transposed-letter typo of «الوديعة».
  [foldKey("الودعيه")]: "الوديعة",
  [foldKey("الوديعة")]: "الوديعة",
};

const MIN_TYPO_LENGTH = 5;

/** The distinguishing part of a name: «ميناء أ» / «ميناء ب» are two ports, not a typo, so the port-type word does not count toward the length guard. */
const coreOf = (key: string): string => key.replace(/^(ميناء|مطار|جسر|محافظه) /, "");
const TYPO_FREQUENCY_RATIO = 5;

/** True when `a` and `b` differ by exactly one insert / delete / substitute / adjacent swap. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** Maps every distinct raw port name to its canonical display spelling. */
export function buildPortNameMap(rawNames: Iterable<string | null>): Map<string, string> {
  const byKey = new Map<string, Map<string, number>>();
  for (const raw of rawNames) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = foldKey(raw);
    const spellings = byKey.get(key) ?? new Map<string, number>();
    spellings.set(raw, (spellings.get(raw) ?? 0) + 1);
    byKey.set(key, spellings);
  }
  const total = (s: Map<string, number>) => [...s.values()].reduce((a, b) => a + b, 0);
  // Most common first, so a typo always attaches to the name that outranks it.
  const keys = [...byKey.keys()].sort((a, b) => total(byKey.get(b)!) - total(byKey.get(a)!) || a.localeCompare(b, "ar"));

  const groupOf = new Map<string, string>(); // key → root key
  const roots: string[] = [];
  for (const key of keys) {
    const n = total(byKey.get(key)!);
    const root =
      PORT_ALIASES[key] !== undefined
        ? undefined
        : roots.find(
            (r) =>
              PORT_ALIASES[r] === undefined &&
              coreOf(key).length >= MIN_TYPO_LENGTH &&
              coreOf(r).length >= MIN_TYPO_LENGTH &&
              n * TYPO_FREQUENCY_RATIO <= total(byKey.get(r)!) &&
              withinOneEdit(key, r),
          );
    if (root === undefined) roots.push(key);
    groupOf.set(key, root ?? key);
  }

  const merged = new Map<string, Map<string, number>>(); // root key → all raw spellings
  for (const [key, spellings] of byKey) {
    const root = groupOf.get(key)!;
    const group = merged.get(root) ?? new Map<string, number>();
    for (const [raw, n] of spellings) group.set(raw, (group.get(raw) ?? 0) + n);
    merged.set(root, group);
  }

  const out = new Map<string, string>();
  for (const [root, spellings] of merged) {
    const alias = [...byKey.keys()].filter((k) => groupOf.get(k) === root).map((k) => PORT_ALIASES[k]).find((a) => a !== undefined);
    const display =
      alias ?? [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))[0][0];
    for (const raw of spellings.keys()) out.set(raw, display);
  }
  return out;
}

/** Returns `rows` with `portName` canonicalized; rows already canonical are
 *  passed through by reference, and the SAME array comes back when nothing changes. */
export function canonicalizePortNames<T extends { portName: string | null }>(rows: T[]): T[] {
  const map = buildPortNameMap(rows.map((r) => r.portName));
  let changed = false;
  const next = rows.map((r) => {
    if (typeof r.portName !== "string") return r;
    const display = map.get(r.portName);
    if (display === undefined || display === r.portName) return r;
    changed = true;
    return { ...r, portName: display };
  });
  return changed ? next : rows;
}
