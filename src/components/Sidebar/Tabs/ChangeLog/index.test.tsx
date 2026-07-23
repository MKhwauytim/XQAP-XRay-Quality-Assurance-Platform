/* @vitest-environment jsdom */
// B10 — ChangeLog markdown rendering (medium visual, ChangeLog/index.tsx:134).
//
// Two independent bugs fixed together:
//  1. renderBody had no heading (#/##/###) or pipe-table handling, so real
//     edit-log entries that quote a heading or paste a markdown table leaked
//     the raw "###"/"|" syntax as literal visible text.
//  2. TAG_RE/TAG_LABELS_AR/tagClass implemented an old "(TAG)" trailing-suffix
//     convention that matches zero real headings (CLAUDE.md's actual
//     convention is a leading "Category:" prefix) -- no entry ever got a
//     colored badge. Repurposed to derive the badge from that real prefix.
//
// Uses a small synthetic fixture (mocking the "virtual:edit-log" module)
// instead of the live docs/edit logs/*.md corpus, so this test stays stable
// regardless of what gets appended to those files later.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const FIXTURE = [
  "## v3 — 2026-07-20 — Change (auth): scope example, heading and table check",
  "",
  "### Follow-up: nested heading check",
  "",
  "Some prose line before the table.",
  "",
  "| File | Location | Purpose |",
  "| --- | --- | --- |",
  "| `a.json` | `1-population/` | First row |",
  "| `b.json` | `2-samples/` | Second row |",
  "",
  "A header-less pasted slice:",
  "",
  "| `c.json` | `3-user-data/` | Third row |",
  "",
  "```ts",
  'type X = "a" | "b" | "c";',
  "# not a real heading -- inside a fenced block, must stay literal",
  "```",
  "",
  "## v2 — 2026-07-19 — Fix: plain category, no scope",
  "",
  "Just a plain paragraph, no special syntax.",
  "",
  "## v1 — 2026-07-18 — Docs: oldest entry",
  "",
  "Oldest entry body.",
].join("\n");

vi.mock("virtual:edit-log", () => ({ default: FIXTURE }));

afterEach(cleanup);

async function renderChangeLog() {
  const { default: ChangeLogTab } = await import("./index");
  return render(<ChangeLogTab />);
}

describe("ChangeLog markdown rendering", () => {
  it("renders a quoted '### heading' as a real heading, not literal '###' text", async () => {
    const { container } = await renderChangeLog();

    const heading = screen.getByRole("heading", { level: 6, name: "Follow-up: nested heading check" });
    expect(heading).toBeInTheDocument();
    // The literal markdown marker must not leak anywhere as visible text.
    expect(container.textContent).not.toContain("###");
  });

  it("renders a header + separator pipe-table as a real <table>, not literal '|' rows", async () => {
    const { container } = await renderChangeLog();

    const tables = container.querySelectorAll("table");
    expect(tables.length).toBe(2);

    const headerTable = tables[0]!;
    expect(headerTable.querySelector("thead")).not.toBeNull();
    expect(headerTable.querySelectorAll("tbody tr").length).toBe(2);
    expect(screen.getByRole("columnheader", { name: "File" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Location" })).toBeInTheDocument();
    expect(screen.getByText("First row")).toBeInTheDocument();
    expect(screen.getByText("Second row")).toBeInTheDocument();
    // Inline code spans inside table cells still render through renderInline.
    expect(screen.getByText("a.json").tagName).toBe("CODE");
  });

  it("renders a header-less run of pipe rows as a table body with no <thead>", async () => {
    const { container } = await renderChangeLog();

    const tables = container.querySelectorAll("table");
    const headerlessTable = tables[1]!;
    expect(headerlessTable.querySelector("thead")).toBeNull();
    expect(headerlessTable.querySelectorAll("tbody tr").length).toBe(1);
    expect(screen.getByText("Third row")).toBeInTheDocument();
  });

  it("leaves fenced code blocks untouched by heading/table parsing", async () => {
    const { container } = await renderChangeLog();

    const code = container.querySelector("pre.cl-code code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('type X = "a" | "b" | "c";');
    expect(code!.textContent).toContain("# not a real heading");
    // Only the two real markdown tables outside the fence -- the fenced
    // TS union-type pipes must not be parsed as a third table.
    expect(container.querySelectorAll("table").length).toBe(2);
  });

  it("derives the category badge from the leading 'Category:' prefix (with or without a scope)", async () => {
    await renderChangeLog();

    // v3: "Change (auth): ..." -- category with a scope in parens.
    const changeBadge = screen.getByText("تعديل");
    expect(changeBadge.className).toContain("cl-tag--feature");
    // Title text is left intact (not stripped) alongside the badge.
    expect(screen.getByText(/Change \(auth\): scope example/)).toBeInTheDocument();

    // v2: "Fix: ..." -- bare category, no scope.
    const fixBadge = screen.getByText("إصلاح");
    expect(fixBadge.className).toContain("cl-tag--fix");

    // v1: "Docs: ..." -- exercises the default/chore-colored branch.
    const docsBadge = screen.getByText("توثيق");
    expect(docsBadge.className).toContain("cl-tag--chore");
  });
});
