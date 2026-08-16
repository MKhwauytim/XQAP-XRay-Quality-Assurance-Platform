/* @vitest-environment jsdom */
// Phase 1.2 — pins the contract that stops a hidden view from re-loading.
// The Population tab keeps Browse mounted-but-hidden; without this deferral,
// every distribution mutation bumped Browse's refreshKey and re-read the whole
// month while Browse was off screen.

import { describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";

import { useDeferredWhileHidden } from "./useDeferredWhileHidden";

afterEach(cleanup);

/** Renders the hook and records every value it returned, in order. */
function setup(initial: { value: number; visible: boolean }) {
  const seen: number[] = [];

  function Probe({ value, visible }: { value: number; visible: boolean }) {
    seen.push(useDeferredWhileHidden(value, visible));
    return null;
  }

  const view = render(<Probe value={initial.value} visible={initial.visible} />);
  return {
    seen,
    update(next: { value: number; visible: boolean }) {
      act(() => {
        view.rerender(<Probe value={next.value} visible={next.visible} />);
      });
    },
    /** The value the consumer is currently acting on. */
    current: () => seen[seen.length - 1],
  };
}

describe("useDeferredWhileHidden", () => {
  it("passes the value straight through while visible", () => {
    const h = setup({ value: 1, visible: true });
    expect(h.current()).toBe(1);

    h.update({ value: 2, visible: true });
    expect(h.current()).toBe(2);
  });

  it("holds the value steady while hidden", () => {
    const h = setup({ value: 1, visible: true });

    // Go hidden, then churn the value the way a run of distribution mutations
    // would. The consumer must keep seeing the value it last rendered with.
    h.update({ value: 1, visible: false });
    h.update({ value: 2, visible: false });
    h.update({ value: 3, visible: false });
    h.update({ value: 4, visible: false });

    expect(h.current()).toBe(1);
  });

  it("catches up on becoming visible, so it never shows stale data", () => {
    const h = setup({ value: 1, visible: true });

    h.update({ value: 5, visible: false });
    expect(h.current()).toBe(1);

    h.update({ value: 5, visible: true });
    expect(h.current()).toBe(5);
  });

  it("never emits an intermediate value between the held one and the latest", () => {
    // The consumer keys a data load on this value, so emitting 2 then 3 then 4
    // on the way to 4 would trigger three loads instead of one.
    const h = setup({ value: 1, visible: true });
    h.update({ value: 2, visible: false });
    h.update({ value: 3, visible: false });
    h.update({ value: 4, visible: false });

    const beforeReveal = h.seen.length;
    h.update({ value: 4, visible: true });

    const emittedOnReveal = h.seen.slice(beforeReveal);
    expect(emittedOnReveal.every((v) => v === 4)).toBe(true);
    expect(h.seen).not.toContain(2);
    expect(h.seen).not.toContain(3);
  });
});
