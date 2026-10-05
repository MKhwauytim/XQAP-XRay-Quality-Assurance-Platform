const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const codePoint = (g: string, orig: string) => {
  const n = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : orig;
};
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, g: string) =>
    g[0] === "#" ? codePoint(g, m) : (ENT[g] ?? m));
const textOf = (x: string) => {
  let o = ""; for (const m of x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) o += m[1]; return decode(o);
};

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(m[1] ? textOf(m[1]) : "");
  return out;
}

export function parseSheetRows(xml: string, shared: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rec: Record<string, string> = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? "";
      const col = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!col) continue;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let val: string | undefined;
      if (t === "inlineStr") val = textOf(inner);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) val = t === "s" ? shared[Number(v)] : decode(v);
      }
      if (val !== undefined && val !== "") rec[col] = val;
    }
    rows.push(rec);
  }
  return rows;
}

export function rowsByHeader(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const hdr = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (const [col, name] of Object.entries(hdr)) if (r[col] !== undefined) o[name] = r[col];
    return o;
  });
}
