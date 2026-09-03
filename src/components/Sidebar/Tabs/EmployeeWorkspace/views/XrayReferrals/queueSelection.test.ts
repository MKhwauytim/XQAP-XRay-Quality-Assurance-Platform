// `createQueueSelection` — the queue's row-selection transitions, tested
// against a stand-in for React's `useState` setter so the set semantics are
// pinned without rendering the page.

import { describe, expect, it } from "vitest";
import { createQueueSelection } from "./queueSelection";
import type { Dispatch, SetStateAction } from "react";

/** A minimal stand-in for `useState<Set<string>>`'s setter, batching-free. */
function stateStub(initial: string[] = []): {
  setter: Dispatch<SetStateAction<Set<string>>>;
  read: () => string[];
} {
  let value = new Set(initial);
  const setter: Dispatch<SetStateAction<Set<string>>> = (next) => {
    value = typeof next === "function" ? next(value) : next;
  };
  return { setter, read: () => [...value] };
}

describe("createQueueSelection", () => {
  it("adds an id on check and removes it on uncheck", () => {
    const { setter, read } = stateStub();
    const { toggleSelect } = createQueueSelection(setter);

    toggleSelect("A", true);
    expect(read()).toEqual(["A"]);
    toggleSelect("B", true);
    expect(read()).toEqual(["A", "B"]);
    toggleSelect("A", false);
    expect(read()).toEqual(["B"]);
  });

  it("is idempotent in both directions", () => {
    const { setter, read } = stateStub(["A"]);
    const { toggleSelect } = createQueueSelection(setter);

    toggleSelect("A", true);
    expect(read()).toEqual(["A"]);
    toggleSelect("Z", false);
    expect(read()).toEqual(["A"]);
  });

  it("never mutates the previous set in place — React must see a new identity", () => {
    let seen: Set<string> | null = null;
    const before = new Set(["A"]);
    let current = before;
    const setter: Dispatch<SetStateAction<Set<string>>> = (next) => {
      seen = typeof next === "function" ? next(current) : next;
      current = seen;
    };

    createQueueSelection(setter).toggleSelect("B", true);

    expect(seen).not.toBe(before);
    expect([...before]).toEqual(["A"]);
    expect([...(seen as unknown as Set<string>)]).toEqual(["A", "B"]);
  });

  it("selectAll REPLACES the selection rather than merging into it", () => {
    const { setter, read } = stateStub(["A", "B"]);
    createQueueSelection(setter).selectAll(["C", "D"]);
    expect(read()).toEqual(["C", "D"]);
  });

  it("clearSelection empties it", () => {
    const { setter, read } = stateStub(["A", "B"]);
    createQueueSelection(setter).clearSelection();
    expect(read()).toEqual([]);
  });

  it("applies a burst of toggles cumulatively — each one reads the pending set, not a stale render's", () => {
    // The regression the functional updater exists for: three checkbox clicks
    // inside one React batch must all survive, not just the last one.
    const { setter, read } = stateStub();
    const { toggleSelect } = createQueueSelection(setter);
    for (const id of ["A", "B", "C"]) toggleSelect(id, true);
    expect(read()).toEqual(["A", "B", "C"]);
  });
});
