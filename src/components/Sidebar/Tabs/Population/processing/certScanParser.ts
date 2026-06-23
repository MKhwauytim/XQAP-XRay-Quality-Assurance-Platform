import type { CertScanEntry } from "./populationProcessingTypes";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

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