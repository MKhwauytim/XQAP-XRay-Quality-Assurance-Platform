import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const EXPECTED_XLSX_SHA256 = "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8";
const archive = await readFile(new URL("../vendor/xlsx-0.20.3.tgz", import.meta.url));
const actual = createHash("sha256").update(archive).digest("hex");

if (actual !== EXPECTED_XLSX_SHA256) {
  throw new Error(`Vendored SheetJS checksum mismatch. Expected ${EXPECTED_XLSX_SHA256}, received ${actual}.`);
}

console.log("Vendored SheetJS checksum verified.");
