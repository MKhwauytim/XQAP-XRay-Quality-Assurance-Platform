/** A run of text with one direction. Latin and digit tokens are LTR runs (M5); everything else stays in the RTL paragraph. */
export interface Run {
  text: string;
  ltr: boolean;
}

// M5 token class, hyphen last so it is a literal (C18). A token ends on [A-Za-z0-9%] so sentence
// punctuation stays Arabic; a sign (-, +, U+2212) at a token boundary (start, whitespace or "(") belongs to it.
const TOKEN = /(?:(?<=^|[\s(])[-+\u2212](?=[0-9]))?[A-Za-z0-9](?:[A-Za-z0-9.,%/:+-]*[A-Za-z0-9%])?/g;
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
