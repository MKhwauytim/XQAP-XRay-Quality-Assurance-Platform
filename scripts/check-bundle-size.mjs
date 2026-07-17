import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const MAX_BYTES = 3_600_000;
const MAX_GZIP_BYTES = 1_300_000;
const bundlePath = new URL("../dist/index.html", import.meta.url);

const bundle = await readFile(bundlePath);
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
console.log(`Bundle: ${formatKb(bundle.byteLength)} (${formatKb(gzipBytes)} gzip)`);

if (bundle.byteLength > MAX_BYTES || gzipBytes > MAX_GZIP_BYTES) {
  console.error(
    `Bundle budget exceeded. Limits: ${formatKb(MAX_BYTES)} (${formatKb(MAX_GZIP_BYTES)} gzip).`,
  );
  process.exitCode = 1;
}
