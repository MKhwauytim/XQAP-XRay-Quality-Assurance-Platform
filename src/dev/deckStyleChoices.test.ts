import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChoices, writeChoice } from "./deckStyleChoices";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("deckStyleChoices", () => {
  it("readChoices returns an empty envelope when the file doesn't exist", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
    expect(envelope.metadata.revision).toBe(0);
  });

  it("writeChoice creates the file and parent directories, and readChoices reads it back", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "6-templates", "choices.json");
    writeChoice(filePath, "slide-cover", 2);
    expect(existsSync(filePath)).toBe(true);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 2 });
    expect(envelope.metadata.revision).toBe(1);
  });

  it("writeChoice merges into existing choices and increments the revision", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-toc", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 1, "slide-toc": 3 });
    expect(envelope.metadata.revision).toBe(2);
  });

  it("writeChoice overwrites an existing slide's choice", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-cover", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 3 });
  });

  it("readChoices recovers an empty envelope if the file contains invalid JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    // Corrupt the file.
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(filePath, "{not json", "utf-8");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
  });
});
