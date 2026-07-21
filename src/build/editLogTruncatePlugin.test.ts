import { describe, expect, it } from "vitest";
import { countVersionHeadings, truncateEditLog } from "./editLogTruncatePlugin";

function makeLog(count: number): string {
  const header = "# EDIT_LOG.md\n\nVersion history.\n\n---\n\n";
  const entries = [];
  for (let i = count; i >= 1; i--) {
    entries.push(
      `## v${i}.0 — 2026-07-0${(i % 9) + 1} — entry number ${i}\n\n` +
        `**File:** \`some/file.ts\`\n\n**Before:**\n\`\`\`ts\nold\n\`\`\`\n\n**After:**\n\`\`\`ts\nnew\n\`\`\`\n\n`
    );
  }
  return header + entries.join("");
}

const HEADING_RE = /^## v[\d.]+ /gm;

describe("countVersionHeadings", () => {
  it("counts every version heading regardless of truncation", () => {
    expect(countVersionHeadings(makeLog(5))).toBe(5);
    expect(countVersionHeadings(makeLog(30))).toBe(30);
  });

  it("stays the true count even after the log is truncated", () => {
    const log = makeLog(30);
    const trueTotal = countVersionHeadings(log);
    const truncated = truncateEditLog(log, 20);
    expect(trueTotal).toBe(30);
    // The truncated string only has 21 headings (20 kept + notice) — counting it directly
    // would under-report, which is exactly the bug this constant exists to avoid.
    expect(countVersionHeadings(truncated)).toBe(21);
  });
});

describe("truncateEditLog", () => {
  it("is a no-op when the entry count is at or below the keep threshold", () => {
    const log = makeLog(5);
    expect(truncateEditLog(log, 20)).toBe(log);
    expect(truncateEditLog(log, 5)).toBe(log);
  });

  it("keeps exactly `keep` original headings plus one synthetic notice heading", () => {
    const log = makeLog(30);
    const result = truncateEditLog(log, 20);
    const headings = [...result.matchAll(HEADING_RE)];
    expect(headings.length).toBe(21); // 20 kept + 1 notice
  });

  it("never cuts mid-entry — every kept entry's body is intact up to the next heading", () => {
    const log = makeLog(30);
    const result = truncateEditLog(log, 20);
    // The 20 kept entries (numbers 30 down to 11) must each still contain their full
    // Before/After code block markers.
    for (let i = 30; i >= 11; i--) {
      expect(result).toContain(`entry number ${i}`);
      expect(result).toContain("**Before:**\n```ts\nold\n```");
      expect(result).toContain("**After:**\n```ts\nnew\n```");
    }
    // Entries older than the cutoff must be entirely absent (no partial/dangling text).
    // Use a trailing word boundary so "entry number 1" doesn't false-match inside the
    // still-present "entry number 11".
    for (let i = 10; i >= 1; i--) {
      expect(result).not.toMatch(new RegExp(`entry number ${i}\\b`));
    }
  });

  it("appends a synthetic v0.0 notice that mentions the omitted count and the full log path", () => {
    const log = makeLog(25);
    const result = truncateEditLog(log, 20);
    expect(result).toMatch(/## v0\.0 — \d{4}-\d{2}-\d{2} — /);
    expect(result).toContain("5"); // omitted count (25 - 20)
    expect(result).toContain("docs/EDIT_LOG.md");
  });

  it("the v0.0 notice sorts after every real version under numeric-descending order", () => {
    const log = makeLog(25);
    const result = truncateEditLog(log, 20);
    const headings = [...result.matchAll(/^## (v[\d.]+) /gm)].map((m) => m[1]!);
    // Sort descending the same way ChangeLog's compareVersionsDesc does: numeric segments.
    const versionKey = (v: string) => v.replace(/^v/, "").split(".").map(Number);
    const sorted = [...headings].sort((a, b) => {
      const av = versionKey(a);
      const bv = versionKey(b);
      const len = Math.max(av.length, bv.length);
      for (let i = 0; i < len; i++) {
        const diff = (bv[i] ?? 0) - (av[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    expect(sorted[sorted.length - 1]).toBe("v0.0");
  });
});
