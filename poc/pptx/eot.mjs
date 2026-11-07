// PoC: read TTF metadata (OS/2 fsType etc.) and wrap a TTF in an uncompressed EOT header
// (Embedded OpenType, version 0x00020001), the container PowerPoint uses for ppt/fonts/*.fntdata.
function tables(buf) {
  const n = buf.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    t[buf.toString("latin1", o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  return t;
}
function names(buf, t) {
  const b = t.name.off, count = buf.readUInt16BE(b + 2), strOff = b + buf.readUInt16BE(b + 4), out = {};
  for (let i = 0; i < count; i++) {
    const r = b + 6 + i * 12;
    const pid = buf.readUInt16BE(r), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6), len = buf.readUInt16BE(r + 8), off = buf.readUInt16BE(r + 10);
    if (pid !== 3 || (lang !== 0x409 && out[id])) continue;
    const raw = buf.subarray(strOff + off, strOff + off + len);
    let s = "";
    for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode(raw.readUInt16BE(k));
    out[id] = s;
  }
  return out;
}
export function readFontInfo(buf) {
  const t = tables(buf), os2 = t["OS/2"].off, nm = names(buf, t);
  const fsType = buf.readUInt16BE(os2 + 8);
  const bits = [];
  if ((fsType & 0x000f) === 0) bits.push("installable (0)");
  if (fsType & 0x0002) bits.push("restricted license (2)");
  if (fsType & 0x0004) bits.push("preview & print (4)");
  if (fsType & 0x0008) bits.push("editable (8)");
  if (fsType & 0x0100) bits.push("no subsetting (0x100)");
  if (fsType & 0x0200) bits.push("bitmap only (0x200)");
  return { family: nm[1], style: nm[2], full: nm[4], version: nm[5], fsType, fsTypeHex: "0x" + fsType.toString(16).padStart(4, "0"), fsTypeMeaning: bits, weight: buf.readUInt16BE(os2 + 4) };
}
export function buildEot(ttf) {
  const t = tables(ttf), os2 = t["OS/2"].off, nm = names(ttf, t);
  const utf16 = (s) => { const b = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), i * 2); return b; };
  const fixed = Buffer.alloc(82);
  fixed.writeUInt32LE(ttf.length, 4); // FontDataSize
  fixed.writeUInt32LE(0x00020001, 8); // Version
  fixed.writeUInt32LE(0, 12); // Flags: no subset, no MTX compression, no XOR
  ttf.copy(fixed, 16, os2 + 32, os2 + 42); // PANOSE
  fixed.writeUInt8(1, 26); // Charset DEFAULT_CHARSET
  fixed.writeUInt8(ttf.readUInt16BE(os2 + 62) & 1, 27); // Italic from fsSelection
  fixed.writeUInt32LE(ttf.readUInt16BE(os2 + 4), 28); // Weight
  fixed.writeUInt16LE(ttf.readUInt16BE(os2 + 8), 32); // fsType
  fixed.writeUInt16LE(0x504c, 34); // MagicNumber
  for (let k = 0; k < 4; k++) fixed.writeUInt32LE(ttf.readUInt32BE(os2 + 42 + k * 4), 36 + k * 4); // UnicodeRange1-4
  for (let k = 0; k < 2; k++) fixed.writeUInt32LE(ttf.readUInt32BE(os2 + 78 + k * 4), 52 + k * 4); // CodePageRange1-2
  fixed.writeUInt32LE(ttf.readUInt32BE(t.head.off + 8), 60); // CheckSumAdjustment
  // 64..79 Reserved1-4 = 0, 80..81 Padding1 = 0
  const str = (s) => { const b = utf16(s || ""); const h = Buffer.alloc(2); h.writeUInt16LE(b.length); return Buffer.concat([h, b]); };
  const pad = Buffer.alloc(2);
  const body = Buffer.concat([str(nm[1]), pad, str(nm[2]), pad, str(nm[5]), pad, str(nm[4]), pad, Buffer.alloc(2) /* RootStringSize 0 */, ttf]);
  // Version 0x00020001 header: ... FullName, Padding5, RootStringSize, RootString, FontData
  const out = Buffer.concat([fixed, body]);
  out.writeUInt32LE(out.length, 0); // EOTSize
  return out;
}
