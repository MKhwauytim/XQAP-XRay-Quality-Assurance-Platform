// PoC: pixel diff of out/pptx.png vs out/html.png, no dependencies (node:zlib PNG codec).
// Writes out/diff.png (red = differing pixel, faded grey = same) and prints the % differing.
// A pixel "differs" when any channel differs by more than THRESH (anti-aliasing noise floor).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const THRESH = Number(process.env.THRESH ?? 32);

function decode(buf) {
  let p = 8, w, h, bitDepth, colorType, interlace;
  const idat = [];
  let plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 3, 6].includes(colorType)) throw new Error(`unsupported PNG: depth ${bitDepth} type ${colorType} interlace ${interlace}`);
  const bpp = colorType === 6 ? 4 : colorType === 3 ? 1 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    if (colorType === 3) { const k = px[j] * 3; rgb[i * 3] = plte[k]; rgb[i * 3 + 1] = plte[k + 1]; rgb[i * 3 + 2] = plte[k + 2]; continue; } rgb[i * 3] = px[j]; rgb[i * 3 + 1] = px[j + 1]; rgb[i * 3 + 2] = px[j + 2]; }
  return { w, h, rgb };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function encode(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const A = decode(readFileSync(join(out, "pptx.png")));
const B = decode(readFileSync(join(out, "html.png")));
if (A.w !== B.w || A.h !== B.h) throw new Error(`size mismatch ${A.w}x${A.h} vs ${B.w}x${B.h}`);
const n = A.w * A.h, d = Buffer.alloc(n * 3);
let diff = 0, inkA = 0, inkB = 0;
const bg = [0xf9, 0xf8, 0xf5];
for (let i = 0; i < n; i++) {
  const o = i * 3;
  const m = Math.max(Math.abs(A.rgb[o] - B.rgb[o]), Math.abs(A.rgb[o + 1] - B.rgb[o + 1]), Math.abs(A.rgb[o + 2] - B.rgb[o + 2]));
  const isInk = (R) => Math.max(Math.abs(R.rgb[o] - bg[0]), Math.abs(R.rgb[o + 1] - bg[1]), Math.abs(R.rgb[o + 2] - bg[2])) > THRESH;
  if (isInk(A)) inkA++;
  if (isInk(B)) inkB++;
  if (m > THRESH) { diff++; d[o] = 220; d[o + 1] = 30; d[o + 2] = 30; }
  else { const g = 235 - ((A.rgb[o] + A.rgb[o + 1] + A.rgb[o + 2]) / 3 < 200 ? 40 : 0); d[o] = d[o + 1] = d[o + 2] = g; }
}
writeFileSync(join(out, "diff.png"), encode(A.w, A.h, d));
const inkUnion = Math.max(inkA, inkB);
console.log(JSON.stringify({
  threshold: THRESH,
  differingPixels: diff,
  totalPixels: n,
  diffPctOfSlide: +((diff / n) * 100).toFixed(3),
  inkPixelsPptx: inkA, inkPixelsHtml: inkB,
  diffPctOfInk: +((diff / inkUnion) * 100).toFixed(2),
}));
