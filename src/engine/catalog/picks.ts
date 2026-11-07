import type { RawSheet } from "../data/types";
import type { EngineIssue } from "../errors";
import { LIMITS } from "../limits";
import { ARABIC_INDIC_DIGITS, EXT_ARABIC_INDIC_DIGITS } from "../text";
import { CATALOG, getDesign } from "./registry";
import type { CatalogDesign } from "./types";

export type PicksResult = { ok: true; numbers: number[] } | { ok: false; issues: EngineIssue[] };

const ARABIC_DIGIT = new RegExp(`[${ARABIC_INDIC_DIGITS}]`, "gu");
const EXT_DIGIT = new RegExp(`[${EXT_ARABIC_INDIC_DIGITS}]`, "gu");
const SEPARATORS = /[,،;؛\s]+/u;

/** Arabic-Indic and extended digits to Latin digits; every other character is untouched. */
function latinDigits(s: string): string {
  return s
    .replace(ARABIC_DIGIT, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(EXT_DIGIT, (c) => String(c.charCodeAt(0) - 0x06f0));
}

function fromTokens(tokens: string[], catalog: readonly CatalogDesign[]): PicksResult {
  const issues: EngineIssue[] = [];
  const numbers: number[] = [];
  const seen = new Set<number>();
  if (tokens.length === 0) return { ok: false, issues: [{ rule: "picksEmpty" }] };
  if (tokens.length > LIMITS.maxSlides) {
    issues.push({ rule: "picksTooMany", detail: `${tokens.length} > ${LIMITS.maxSlides}` });
  }
  for (const raw of tokens) {
    const t = latinDigits(raw);
    if (!/^\d+$/.test(t)) {
      issues.push({ rule: "picksNotNumber", detail: `«${raw}»` });
      continue;
    }
    const n = Number(t);
    if (seen.has(n)) {
      if (!issues.some((i) => i.rule === "picksRepeated" && i.detail === String(n))) {
        issues.push({ rule: "picksRepeated", detail: String(n) });
      }
      continue;
    }
    seen.add(n);
    const d = getDesign(n, catalog);
    if (!d.ok) issues.push(d.issue);
    else numbers.push(n);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, numbers };
}

export function parsePicksText(text: string, catalog: readonly CatalogDesign[] = CATALOG): PicksResult {
  return fromTokens(text.split(SEPARATORS).filter((t) => t !== ""), catalog);
}

/** Reads the first column of `sheet.rows`; `headers` is already separate. */
export function parsePicksSheet(sheet: RawSheet, catalog: readonly CatalogDesign[] = CATALOG): PicksResult {
  const tokens: string[] = [];
  for (const row of sheet.rows) {
    const cell = row[0];
    if (cell === null || cell === undefined) continue;
    const s = String(cell).trim();
    if (s !== "") tokens.push(...s.split(SEPARATORS).filter((t) => t !== ""));
  }
  return fromTokens(tokens, catalog);
}
