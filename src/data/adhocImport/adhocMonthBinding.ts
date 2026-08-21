/**
 * Month binding for an ad-hoc import (owner correction C3 — see
 * `adhocImportModel.ts` §5 and `docs/architecture/ADHOC_IMPORT_REWORK_PLAN_2026-08-21.md` §4.6).
 *
 * Two jobs live here:
 *
 * 1. `parseStudyMonth` — turn whatever an operator's `شهر الفحص` column actually
 *    holds into a canonical `{m}-{monthname}-{yyyy}` folder name.
 * 2. `resolveRowMonth` / `linkedMonthsOf` — answer "which month does this row
 *    link to" and "which months does this import touch" for the three binding
 *    kinds.
 *
 * A binding is a LABEL, never a write target: every ad-hoc import still stores
 * under `2-samples/adhoc-{importId}/`. Resolving a month here only decides which
 * month-scoped views the rows surface in.
 *
 * **The refusal policy is the point of this file.** Every parser below returns
 * `null` unless the input has exactly one plausible reading. A month guessed
 * wrong does not fail loudly — it files a whole study under the wrong period,
 * where it looks like real data for that month and quietly distorts every
 * month-scoped count downstream. An unparsed month, by contrast, costs the admin
 * one explicit mapping decision and leaves the row valid but isolated. Refusing
 * is therefore the cheap error and guessing is the expensive one.
 */

import { formatMonthFolderName, parseMonthFolderName } from "../population/monthFolder";
import { foldArabic, foldDigits } from "./adhocTextFolding";
import type { AdhocMappedRow, AdhocMonthBinding, AdhocRow } from "./adhocImportModel";

type MonthYear = { month: number; year: number };

/**
 * Sanity window for a 4-digit year. Wide enough for back-filled historical
 * studies and narrow enough that a stray 5-digit-looking token or a mis-split
 * serial cannot masquerade as a year.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

/**
 * Plausible window for an Excel date serial: ~1954-10 through ~2119. A bare
 * `2026` (a year on its own, which carries no month) and a bare `5` (a month
 * with no year) both fall outside it and are refused, which is the intent —
 * neither can produce a folder name without inventing the missing half.
 */
const MIN_EXCEL_SERIAL = 20_000;
const MAX_EXCEL_SERIAL = 80_000;

/**
 * Excel's 1900 date system: serial 1 is 1900-01-01, and the epoch is therefore
 * 1899-12-30 once Excel's phantom 1900-02-29 leap day is absorbed. Computed in
 * UTC so a machine east of Greenwich cannot shift a first-of-the-month serial
 * back into the previous month.
 *
 * The 1904 date system (old Mac workbooks, offset by 1,462 days) is deliberately
 * NOT handled: it is indistinguishable from a 1900-system serial by value alone,
 * so supporting it would mean guessing which system a bare number came from —
 * exactly the silent-wrong-month failure this module refuses everywhere else. A
 * 1904-system file lands four years early, which is visible in the pre-commit
 * "detected months" preview, and the admin can map the column explicitly.
 */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Month names accepted next to a 4-digit year, keyed by their folded form.
 *
 * Coverage decision: MSA/Gulf (the set `monthFolder.ts` already renders),
 * the Levantine/Iraqi series (`كانون الثاني` … `كانون الأول`), the Egyptian
 * `يونيه`/`يوليه` spellings, and English full names plus their 3-letter
 * abbreviations. All of these name exactly one Gregorian month, so accepting
 * them adds no ambiguity. Hijri month names are intentionally absent — they do
 * not map onto a Gregorian month at all.
 *
 * Keys are pre-folded (`foldArabic` also lowercases, which is what makes the
 * English entries case-insensitive).
 */
const MONTH_NAME_SOURCES: ReadonlyArray<readonly [string, number]> = [
  ["يناير", 1], ["فبراير", 2], ["مارس", 3], ["أبريل", 4], ["مايو", 5], ["يونيو", 6],
  ["يوليو", 7], ["أغسطس", 8], ["سبتمبر", 9], ["أكتوبر", 10], ["نوفمبر", 11], ["ديسمبر", 12],
  ["يونيه", 6], ["يوليه", 7],
  ["كانون الثاني", 1], ["شباط", 2], ["آذار", 3], ["نيسان", 4], ["أيار", 5], ["حزيران", 6],
  ["تموز", 7], ["آب", 8], ["أيلول", 9], ["تشرين الأول", 10], ["تشرين الثاني", 11],
  ["كانون الأول", 12],
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11],
  ["december", 12],
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["jun", 6], ["jul", 7], ["aug", 8],
  ["sep", 9], ["sept", 9], ["oct", 10], ["nov", 11], ["dec", 12],
];

const MONTH_BY_FOLDED_NAME = new Map<string, number>(
  MONTH_NAME_SOURCES.map(([name, month]) => [foldArabic(name), month])
);

function isMonthNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

function isDayNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function isYearNumber(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR;
}

/** A 4-digit token in range — the only shape that is unambiguously a year. */
function asYear(part: string): number | null {
  if (!/^\d{4}$/.test(part)) {
    return null;
  }
  const year = Number(part);
  return isYearNumber(year) ? year : null;
}

/**
 * Accepts a set of candidate readings only when they all agree on the same
 * month and year. `05/05/2026` reads as both 5 May and May 5 — different days,
 * same month — so it resolves; `05/06/2026` does not.
 */
function singleAgreedReading(candidates: MonthYear[]): MonthYear | null {
  if (candidates.length === 0) {
    return null;
  }
  const first = candidates[0];
  const agreed = candidates.every(
    (candidate) => candidate.month === first.month && candidate.year === first.year
  );
  return agreed ? first : null;
}

/**
 * `2026-05`, `2026/5`, `05.2026`, `5-2026`.
 *
 * Requires one side to be an unambiguous 4-digit year. A purely numeric pair
 * like `05/06` is refused on purpose: it could be May 2006, June 2005 or the
 * 6th of May, and there is nothing in the value to choose between them.
 */
function readNumericPair(parts: string[]): MonthYear | null {
  const [left, right] = parts;
  const leftYear = asYear(left);
  const rightYear = asYear(right);
  const candidates: MonthYear[] = [];

  if (leftYear !== null && isMonthNumber(Number(right))) {
    candidates.push({ month: Number(right), year: leftYear });
  }
  if (rightYear !== null && isMonthNumber(Number(left))) {
    candidates.push({ month: Number(left), year: rightYear });
  }

  return singleAgreedReading(candidates);
}

/**
 * A full date, of which only the month and year are kept: `2026-05-17`,
 * `17/05/2026`, `05/17/2026`.
 *
 * Day-first and month-first are both tried when the year sits last, and the
 * result is taken only if they agree on the month — so `17/05/2026` resolves
 * (17 cannot be a month) while `05/06/2026` is refused (May vs June).
 */
function readNumericTriple(parts: string[]): MonthYear | null {
  const [first, second, third] = parts;
  const leadingYear = asYear(first);
  const trailingYear = asYear(third);
  const candidates: MonthYear[] = [];

  if (leadingYear !== null && isMonthNumber(Number(second)) && isDayNumber(Number(third))) {
    candidates.push({ month: Number(second), year: leadingYear });
  }
  if (trailingYear !== null) {
    if (isDayNumber(Number(first)) && isMonthNumber(Number(second))) {
      candidates.push({ month: Number(second), year: trailingYear });
    }
    if (isMonthNumber(Number(first)) && isDayNumber(Number(second))) {
      candidates.push({ month: Number(first), year: trailingYear });
    }
  }

  return singleAgreedReading(candidates);
}

function readExcelSerial(part: string): MonthYear | null {
  if (!/^\d+(\.\d+)?$/.test(part)) {
    return null;
  }
  const serial = Math.floor(Number(part));
  if (serial < MIN_EXCEL_SERIAL || serial > MAX_EXCEL_SERIAL) {
    return null;
  }
  const date = new Date(EXCEL_EPOCH_UTC_MS + serial * MS_PER_DAY);
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

/** Splits on the separators spreadsheets actually produce, requiring digits throughout. */
function readNumericForm(text: string): MonthYear | null {
  // A serial is tried against the WHOLE string first, because `.` is both a
  // date separator and a decimal point: `46159.75` is one serial with a
  // time-of-day fraction, while `05.2026` is a month/year pair. Only the serial
  // window tells them apart, so range-check before splitting.
  const serial = readExcelSerial(text);
  if (serial) {
    return serial;
  }

  const parts = text.split(/[-/.\s]+/).filter((part) => part !== "");
  if (parts.length < 2 || !parts.every((part) => /^\d+$/.test(part))) {
    return null;
  }
  if (parts.length === 2) {
    return readNumericPair(parts);
  }
  if (parts.length === 3) {
    return readNumericTriple(parts);
  }
  return null;
}

/** `مايو 2026`, `أيار 2026`, `May 2026`, `may-2026`, `2026 كانون الأول`. */
function readNamedForm(text: string): MonthYear | null {
  const yearMatch = /\d{4}/.exec(text);
  if (!yearMatch) {
    return null;
  }
  const year = asYear(yearMatch[0]);
  if (year === null) {
    return null;
  }

  // Whatever is left once the year is removed must be the month name alone;
  // separators become spaces so `may-2026` and `مايو/2026` reduce to the name.
  const remainder = foldArabic(
    (text.slice(0, yearMatch.index) + " " + text.slice(yearMatch.index + yearMatch[0].length))
      .replace(/[-/.,]+/g, " ")
  );

  const month = MONTH_BY_FOLDED_NAME.get(remainder);
  return month === undefined ? null : { month, year };
}

/**
 * Canonical folder name for an operator-supplied month value, or `null` when it
 * cannot be resolved confidently.
 *
 * Accepted: an existing folder name (`5-May-2026`), `2026-05` / `05/2026` and
 * their `-` `.` `/` variants, a full date (`2026-05-17`, `17/05/2026`), a month
 * name plus a 4-digit year in Arabic or English, and an Excel date serial.
 * Arabic-Indic digits are folded first, so `٢٠٢٦-٠٥` works.
 */
export function parseStudyMonth(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const text = foldDigits(String(raw)).trim();
  if (text === "") {
    return null;
  }

  // A value that already IS a folder name round-trips rather than being
  // re-derived, so a re-projected import cannot drift onto a different name.
  const folder = parseMonthFolderName(text.toLowerCase());
  if (folder) {
    return folder.folderName;
  }

  const reading = /[A-Za-z\u0600-\u06ff]/.test(text) ? readNamedForm(text) : readNumericForm(text);
  if (!reading || !isMonthNumber(reading.month) || !isYearNumber(reading.year)) {
    return null;
  }

  return formatMonthFolderName(reading.month, reading.year);
}

/**
 * The month one row links to, or `undefined` when it links to none.
 *
 * A `column` row whose month cell was blank or unparseable stays VALID and
 * simply falls back to isolated (plan §4.6): one unreadable cell is not a reason
 * to withhold the row from assignment.
 */
export function resolveRowMonth(
  binding: AdhocMonthBinding,
  mapped: AdhocMappedRow
): string | undefined {
  switch (binding.kind) {
    case "isolated":
      return undefined;
    case "month":
      return binding.monthFolderName;
    case "column":
      return parseStudyMonth(mapped[binding.fieldKey]) ?? undefined;
  }
}

function chronologicalKey(folderName: string): number {
  const info = parseMonthFolderName(folderName);
  // An unparseable name can only come from a caller-supplied `kind: "month"`
  // binding; it sorts last rather than being dropped, so nothing disappears
  // from the index entry's `linkedMonths`.
  return info ? info.year * 12 + info.month : Number.MAX_SAFE_INTEGER;
}

/**
 * Every distinct month an import's rows link to, oldest first.
 *
 * Sorted by (year, month) rather than by name: lexicographic order would put
 * `10-october-2026` before `5-may-2026`, which reads as a bug in every list
 * that shows it.
 *
 * A `kind: "month"` import reports its bound month even with no rows — the
 * binding is a property of the import, not something its rows vote on.
 */
export function linkedMonthsOf(binding: AdhocMonthBinding, rows: AdhocRow[]): string[] {
  if (binding.kind === "isolated") {
    return [];
  }
  if (binding.kind === "month") {
    return [binding.monthFolderName];
  }

  const months = new Set<string>();
  for (const row of rows) {
    // Re-derived from `mapped` rather than read off `row.linkedMonthFolder`, so
    // a binding edited after projection reports what it now means.
    const month = resolveRowMonth(binding, row.mapped);
    if (month) {
      months.add(month);
    }
  }

  return [...months].sort((left, right) => {
    const delta = chronologicalKey(left) - chronologicalKey(right);
    return delta !== 0 ? delta : left.localeCompare(right);
  });
}
