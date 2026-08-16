import type { CertScanEntry } from "./populationProcessingTypes";
import { normalizeText } from "./textNormalization";

function normalizeHeader(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function normalizePortName(value: unknown): string {
  return normalizeText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function normalizeSerialText(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function cleanAlphaNumeric(value: string): string {
  return value.replace(/[^A-Z0-9]/g, "");
}

function splitSerialParts(serialNumber: string): string[] {
  return serialNumber
    .split(/[\s\-_/\\.,;:|()[\]{}]+/g)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function isUsefulSnippet(snippet: string): boolean {
  if (/^\d+$/.test(snippet)) {
    return snippet.length >= 4;
  }

  return snippet.length >= 5;
}

function extractSnippets(systemSerialNumber: string): string[] {
  const normalizedSerial = normalizeSerialText(systemSerialNumber);
  const cleanedFullSerial = cleanAlphaNumeric(normalizedSerial);
  const parts = splitSerialParts(normalizedSerial);

  const candidateSnippets = [
    cleanedFullSerial,
    ...parts,
    ...parts.map(cleanAlphaNumeric)
  ];

  return Array.from(
    new Set(candidateSnippets.filter((snippet) => isUsefulSnippet(snippet)))
  );
}

function detectColumnIndex(headers: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map(normalizeHeader);

  return headers.findIndex((header) =>
    normalizedCandidates.includes(normalizeHeader(header))
  );
}

function parseDelimitedRows(text: string): string[][] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("\t")) {
        return line.split("\t").map(normalizeText);
      }

      return line.split(",").map(normalizeText);
    });
}

export function parseCertScanPasteText(pasteText: string): CertScanEntry[] {
  const rows = parseDelimitedRows(pasteText);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];

  const portNameIndex = detectColumnIndex(headers, [
    "Port Name",
    "اسم المنفذ",
    "المنفذ"
  ]);

  const systemSerialNumberIndex = detectColumnIndex(headers, [
    "System S/N",
    "System SN",
    "System Serial Number",
    "Serial Number",
    "S/N",
    "SN",
    "الرقم التسلسلي",
    "رقم الجهاز"
  ]);

  if (portNameIndex === -1 || systemSerialNumberIndex === -1) {
    return [];
  }

  const entries = rows.slice(1).flatMap((row): CertScanEntry[] => {
    const portName = normalizePortName(row[portNameIndex]);
    const originalSystemSerialNumber = normalizeSerialText(
      row[systemSerialNumberIndex]
    );

    if (!portName || !originalSystemSerialNumber) {
      return [];
    }

    const snippets = extractSnippets(originalSystemSerialNumber);

    if (snippets.length === 0) {
      return [];
    }

    return [
      {
        portName,
        originalSystemSerialNumber,
        snippets
      }
    ];
  });

  return entries;
}

export function normalizeCertScanPortName(portName: string | null): string {
  return normalizePortName(portName);
}

export function normalizeCertScanXrayId(xrayImageId: string): string {
  return cleanAlphaNumeric(normalizeSerialText(xrayImageId));
}

// ── Port-name matching ladder ──────────────────────────────────────────────
//
// The port-grouped CertScan match (`matchCertScan` in populationProcessor.ts)
// used to be exact-match-only against `normalizeCertScanPortName`: if the
// pasted CertScan table spelled a port even slightly differently from the
// population's port names, that port's *entire* CertScan bucket silently
// missed every row. That is the exact failure class behind the ~30-vs-~30,000
// CertScan mismatch report — the paste and the population almost certainly
// disagree on a handful of port-name spellings, and there was no fallback.
//
// This ladder tries progressively looser comparisons and stops at the first
// one that matches, so behaviour stays deterministic and reproducible (same
// inputs -> same alignment, always) and every match records which tier it
// was found at:
//
//   1. "exact"      — identical after trim/whitespace-collapse only.
//   2. "normalized" — identical after the standard Arabic normalization set
//                     (alef variants, taa marbuta, hamza forms, tatweel/
//                     kashida removal, Arabic-Indic digits -> ASCII, case-fold).
//   3. "fuzzy"      — identical after additionally stripping common port-type
//                     descriptor words ("منفذ", "ميناء", "جمرك", "مطار", "جاف")
//                     and all remaining non-alphanumeric characters.
//
// A match at "normalized" or, especially, "fuzzy" is a looser tier than an
// exact spelling match and MUST be surfaced to the user (see
// certScanMatchPreview.ts) rather than applied silently — a wrong fuzzy port
// match would silently corrupt stratification the same way a missed one does.

export type PortMatchTier = "exact" | "normalized" | "fuzzy";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const PORT_DESCRIPTOR_WORDS = ["منفذ", "ميناء", "جمرك", "مطار", "الجاف", "جاف"];

function normalizeArabicIndicDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndicIndex = ARABIC_INDIC_DIGITS.indexOf(digit);
    if (arabicIndicIndex !== -1) return String(arabicIndicIndex);
    const extendedIndex = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(digit);
    if (extendedIndex !== -1) return String(extendedIndex);
    return digit;
  });
}

/** Tier 1: trim + whitespace-collapse only (paste artifacts, not a real naming difference). */
function normalizeExactTier(value: unknown): string {
  return normalizeText(value);
}

/** Tier 2: the full Arabic-normalization set described above. */
function normalizeNormalizedTier(value: unknown): string {
  return normalizeArabicIndicDigits(normalizeText(value))
    .replace(/[ً-ْٰ]/g, "") // tashkeel / diacritics
    .replace(/[ـ]/g, "") // tatweel / kashida
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ء]/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Descriptor words run through the same tier-2 pipeline as the port name itself
// (e.g. "ميناء" loses its hamza under normalizeNormalizedTier) so the stripping
// below compares like with like instead of missing the word post-normalization.
const NORMALIZED_PORT_DESCRIPTOR_WORDS = PORT_DESCRIPTOR_WORDS.map((word) =>
  normalizeNormalizedTier(word)
).filter(Boolean);

/** Tier 3: normalized tier, minus descriptor words and any remaining punctuation/spacing. */
function normalizeFuzzyTier(value: unknown): string {
  const normalized = normalizeNormalizedTier(value);
  const withoutDescriptors = NORMALIZED_PORT_DESCRIPTOR_WORDS.reduce(
    (text, word) => text.split(word).join(" "),
    normalized
  );

  return withoutDescriptors.replace(/[^a-z0-9ء-ي]/g, "");
}

export type PortAlignment = {
  populationPortName: string;
  pastePortName: string;
  tier: PortMatchTier;
};

export type PortAlignmentResult = {
  /** One entry per population port name that found a CertScan-side match, at whichever tier. */
  alignments: PortAlignment[];
  /** Population port names present in the population but not matched to any pasted CertScan port. */
  unmatchedPopulationPorts: string[];
  /** Pasted CertScan port names not matched to any population port. */
  unmatchedPastePorts: string[];
};

/**
 * Aligns distinct population port names to distinct pasted CertScan port names
 * using the exact -> normalized -> fuzzy ladder above. Deterministic: for a
 * given pair of input lists, the same alignment is produced every time
 * (first-match-wins, in input order).
 */
export function alignPortNames(
  pastePortNames: readonly (string | null | undefined)[],
  populationPortNames: readonly (string | null | undefined)[]
): PortAlignmentResult {
  const distinctPaste = Array.from(
    new Set(pastePortNames.map((p) => normalizeText(p)).filter(Boolean))
  );
  const distinctPopulation = Array.from(
    new Set(populationPortNames.map((p) => normalizeText(p)).filter(Boolean))
  );

  const pasteKeys = distinctPaste.map((pastePortName) => ({
    pastePortName,
    exact: normalizeExactTier(pastePortName),
    normalized: normalizeNormalizedTier(pastePortName),
    fuzzy: normalizeFuzzyTier(pastePortName)
  }));

  const alignments: PortAlignment[] = [];
  const matchedPastePorts = new Set<string>();

  for (const populationPortName of distinctPopulation) {
    const exactKey = normalizeExactTier(populationPortName);
    const exactHit = pasteKeys.find((candidate) => candidate.exact === exactKey);

    if (exactHit) {
      alignments.push({ populationPortName, pastePortName: exactHit.pastePortName, tier: "exact" });
      matchedPastePorts.add(exactHit.pastePortName);
      continue;
    }

    const normalizedKey = normalizeNormalizedTier(populationPortName);
    const normalizedHit = normalizedKey
      ? pasteKeys.find((candidate) => candidate.normalized === normalizedKey)
      : undefined;

    if (normalizedHit) {
      alignments.push({ populationPortName, pastePortName: normalizedHit.pastePortName, tier: "normalized" });
      matchedPastePorts.add(normalizedHit.pastePortName);
      continue;
    }

    const fuzzyKey = normalizeFuzzyTier(populationPortName);
    const fuzzyHit = fuzzyKey
      ? pasteKeys.find((candidate) => candidate.fuzzy === fuzzyKey)
      : undefined;

    if (fuzzyHit) {
      alignments.push({ populationPortName, pastePortName: fuzzyHit.pastePortName, tier: "fuzzy" });
      matchedPastePorts.add(fuzzyHit.pastePortName);
    }
  }

  const unmatchedPopulationPorts = distinctPopulation.filter(
    (populationPortName) =>
      !alignments.some((alignment) => alignment.populationPortName === populationPortName)
  );
  const unmatchedPastePorts = distinctPaste.filter(
    (pastePortName) => !matchedPastePorts.has(pastePortName)
  );

  return { alignments, unmatchedPopulationPorts, unmatchedPastePorts };
}

export type CertScanPortIndex = {
  /** Merged CertScan entries per population port, keyed by trim/whitespace-collapsed port name. */
  entriesByPopulationPort: Map<string, CertScanEntry[]>;
  alignment: PortAlignmentResult;
};

/**
 * Builds the port-level CertScan lookup index used by both the real
 * processing run (`matchCertScan`) and the pre-processing match preview, so
 * the two can never silently disagree about which ports were matched.
 */
export function buildCertScanPortIndex(
  certScanEntries: readonly CertScanEntry[],
  populationPortNames: readonly (string | null | undefined)[]
): CertScanPortIndex {
  const entriesByPastePort = new Map<string, CertScanEntry[]>();

  for (const entry of certScanEntries) {
    const key = normalizeExactTier(entry.portName);
    const list = entriesByPastePort.get(key) ?? [];
    list.push(entry);
    entriesByPastePort.set(key, list);
  }

  const alignment = alignPortNames(
    certScanEntries.map((entry) => entry.portName),
    populationPortNames
  );

  const entriesByPopulationPort = new Map<string, CertScanEntry[]>();

  for (const portAlignment of alignment.alignments) {
    const entries = entriesByPastePort.get(portAlignment.pastePortName) ?? [];
    entriesByPopulationPort.set(
      normalizeExactTier(portAlignment.populationPortName),
      entries
    );
  }

  return { entriesByPopulationPort, alignment };
}

// ── X-ray ID segmentation (device-code anchoring) ──────────────────────────
//
// Snippet matching used to be a bare `cleanedXrayId.includes(snippet)`. That is
// catastrophically wrong for the real ID shape, because every X-ray ID embeds
// the scan date, so ANY pasted serial containing a 4-digit run that also occurs
// in a date matches nearly the whole population. Measured on the owner's real
// month (117,337 candidate rows): a pasted serial containing "2026" or "0260"
// substring-matched 117,268 of them (99.94%). `certScanStatus` drives the
// stratified CertScan/NonCertScan split in the draw, so the month's sample
// composition was fabricated.
//
// The real IDs have exactly two shapes, both of which put the device code on a
// segment boundary around the embedded 8-digit date:
//
//   A. [deviceCode][YYYYMMDD][sequence]
//      96601PB04|20260501|0138,  6184|20260504|0021,  48|20260508|0419
//
//   B. [YYYYMMDD][deviceCode][sequence]
//      20260509|002368|0130,  20260527|851530|0519
//
// So: split the ID at the first valid embedded date into `head` (before it) and
// `tail` (after it), and require the snippet to be anchored at the start of one
// of those two segments. A snippet is never matched against the date itself, and
// never against the interior of the sequence number.
//
// Measured effect on the same real month, using every device code that actually
// occurs in that month's IDs as the pasted serial list:
//
//   rule                     legitimate paste     serial "2026"     serial "0260"
//   substring (old)                     20,315         117,268          117,268
//   startsWith only                        174 (loses all of shape B)         0
//   head/tail anchored (new)            20,239              10                10
//
// Every one of the 76 rows the old substring rule matched that the anchored rule
// does not is a demonstrable coincidence inside the sequence digits — e.g. serial
// `2366` "matching" `95|20260503|422366`, or `6184` "matching" `66|20260516|184616`.
// No legitimate match relies on the substring behaviour.
//
// Anchoring on the *start of a segment* rather than requiring whole-segment
// equality is deliberate: it keeps a serial family stem (`96601` pasted for the
// device `96601PB04`) matching, so tightening this cannot introduce the
// mirror-image false-negative bug. On the real month head-prefix and head-exact
// score identically, so the looser of the two is the safe choice.

/** First valid embedded `YYYYMMDD`; the year is bounded to 20xx as all real IDs are. */
const XRAY_ID_EMBEDDED_DATE = /(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/;

const EMBEDDED_DATE_LENGTH = 8;

export type XrayIdSegments = {
  /** Everything before the embedded date — shape A's device code. Empty for shape B. */
  head: string;
  /** Everything after the embedded date — shape B's device code, then the sequence. */
  tail: string;
  /** False when no valid date could be located; `head` then holds the whole ID. */
  hasEmbeddedDate: boolean;
};

/**
 * Splits a cleaned X-ray ID around its first embedded `YYYYMMDD`.
 *
 * IDs with no parseable date (68 of the real month's 117,337 rows, 0.06%)
 * degrade to `head` = the whole ID, so they still match by plain prefix rather
 * than becoming permanently unmatchable.
 */
export function splitXrayIdSegments(cleanedXrayId: string): XrayIdSegments {
  const match = XRAY_ID_EMBEDDED_DATE.exec(cleanedXrayId);

  if (!match) {
    return { head: cleanedXrayId, tail: "", hasEmbeddedDate: false };
  }

  return {
    head: cleanedXrayId.slice(0, match.index),
    tail: cleanedXrayId.slice(match.index + EMBEDDED_DATE_LENGTH),
    hasEmbeddedDate: true
  };
}

/** True when `snippet` is anchored at the start of the ID's head or tail segment. */
function snippetAnchorsToSegment(segments: XrayIdSegments, snippet: string): boolean {
  if (!snippet) return false;

  return (
    (segments.head !== "" && segments.head.startsWith(snippet)) ||
    (segments.tail !== "" && segments.tail.startsWith(snippet))
  );
}

export type SnippetMatchResult = {
  matched: boolean;
  snippet: string | null;
  originalSerial: string | null;
};

/**
 * Matches a single population X-ray ID against the CertScan entries already
 * resolved for its port (via `buildCertScanPortIndex`). Extracted as a
 * standalone function so the real processing run and the match preview share
 * the exact same matching semantics.
 */
export function matchXrayIdAgainstPortEntries(
  xrayImageId: string,
  entries: readonly CertScanEntry[]
): SnippetMatchResult {
  if (entries.length === 0) {
    return { matched: false, snippet: null, originalSerial: null };
  }

  const cleanedXrayId = normalizeCertScanXrayId(xrayImageId);
  const segments = splitXrayIdSegments(cleanedXrayId);

  const matchedSnippets: string[] = [];
  const matchedOriginalSerials: string[] = [];

  for (const entry of entries) {
    const entryMatchedSnippets = entry.snippets.filter((snippet) =>
      snippetAnchorsToSegment(segments, snippet)
    );

    if (entryMatchedSnippets.length > 0) {
      matchedSnippets.push(...entryMatchedSnippets);
      matchedOriginalSerials.push(entry.originalSystemSerialNumber);
    }
  }

  const uniqueMatchedSnippets = Array.from(new Set(matchedSnippets));
  const uniqueMatchedOriginalSerials = Array.from(new Set(matchedOriginalSerials));

  if (uniqueMatchedSnippets.length === 0) {
    return { matched: false, snippet: null, originalSerial: null };
  }

  return {
    matched: true,
    snippet: uniqueMatchedSnippets.join(" | "),
    originalSerial: uniqueMatchedOriginalSerials.join(" | ")
  };
}
