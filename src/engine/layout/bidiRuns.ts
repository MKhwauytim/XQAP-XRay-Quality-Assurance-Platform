/** A run of text with one direction. Latin and digit tokens are LTR runs (M5); everything else stays in the RTL paragraph. */
export interface Run {
  text: string;
  ltr: boolean;
}

// Hyphen last so it is a literal, not a range (C18).
const TOKEN = /[A-Za-z0-9][A-Za-z0-9.,%/:+-]*/g;
const CLUSTER_JOIN = " / ";

/** Split text into direction runs. Two tokens separated by exactly " / " form one LTR cluster. Concatenating the runs gives back the input. */
export function splitRuns(s: string): Run[] {
  const tokens: { start: number; end: number }[] = [];
  for (const match of s.matchAll(TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    const prev = tokens[tokens.length - 1];
    if (prev && s.slice(prev.end, start) === CLUSTER_JOIN) prev.end = end;
    else tokens.push({ start, end });
  }
  const runs: Run[] = [];
  let pos = 0;
  for (const t of tokens) {
    if (t.start > pos) runs.push({ text: s.slice(pos, t.start), ltr: false });
    runs.push({ text: s.slice(t.start, t.end), ltr: true });
    pos = t.end;
  }
  if (pos < s.length) runs.push({ text: s.slice(pos), ltr: false });
  return runs;
}
