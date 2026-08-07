/* @vitest-environment jsdom */
// Regression coverage for the comma-cannot-be-typed bug (Task 1): a controlled input whose
// `value` is derived from `parsedArray.join(", ")` erases a trailing comma the instant it's
// typed, because parsing (`split(",").filter(Boolean)`) drops the empty trailing token and the
// next render rejoins the array back to its pre-comma string. `useDelimitedListInput` fixes this
// by keeping the typed text in local state and only parsing on commit (blur / Enter).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeEvent, KeyboardEvent } from "react";

import { useDelimitedListInput } from "./useDelimitedListInput";

function setup(initialValue: string[] = ["Alpha"]) {
  const onCommit = vi.fn();
  const hook = renderHook(
    (props: { value: string[] }) => useDelimitedListInput(props.value, onCommit),
    { initialProps: { value: initialValue } },
  );
  return { ...hook, onCommit };
}

function changeEvent(value: string) {
  return { target: { value } } as unknown as ChangeEvent<HTMLInputElement>;
}

describe("useDelimitedListInput — trailing comma survives while typing", () => {
  it("keeps a freshly typed trailing comma in the input's own text (not re-parsed/rejoined)", () => {
    const { result } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha,")));

    // The bug: a naive controlled input (value={parsed.join(", ")}) would collapse this back to
    // "Alpha" before the user could type a second alias. The fix keeps the raw text untouched.
    expect(result.current.value).toBe("Alpha,");
  });

  it("lets a second alias be typed after the trailing comma — the historically impossible case", () => {
    const { result } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha,")));
    act(() => result.current.onChange(changeEvent("Alpha, Beta")));

    expect(result.current.value).toBe("Alpha, Beta");
  });

  it("does not call onCommit while typing — only on blur", () => {
    const { result, onCommit } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha, Beta,")));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("parses and commits the canonical array on blur, dropping the empty trailing token", () => {
    const { result, onCommit } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha, Beta,")));
    act(() => result.current.onBlur());

    expect(onCommit).toHaveBeenCalledWith(["Alpha", "Beta"]);
  });

  it("commits on Enter as well as on blur", () => {
    const { result, onCommit } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha, Beta")));
    act(() =>
      result.current.onKeyDown({ key: "Enter" } as unknown as KeyboardEvent<HTMLInputElement>),
    );

    expect(onCommit).toHaveBeenCalledWith(["Alpha", "Beta"]);
  });

  it("does not clobber in-progress typing when the parent re-renders with the same committed value", () => {
    const { result, rerender } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha,")));
    act(() => result.current.onBlur()); // commits ["Alpha"] (trailing comma dropped)

    // Parent re-renders after onCommit — as it normally would once React state propagates back
    // down through props — with the exact same array content.
    rerender({ value: ["Alpha"] });

    // The just-typed text (post-commit) reflects the parsed/committed value, not raw "Alpha,"
    // hanging around — but critically, resuming typing afterward isn't blocked by a resync loop.
    act(() => result.current.onChange(changeEvent("Alpha, Gamma,")));
    expect(result.current.value).toBe("Alpha, Gamma,");
  });

  it("re-syncs the displayed text when the upstream value changes externally (e.g. a reset)", () => {
    const { result, rerender } = setup(["Alpha"]);

    act(() => result.current.onChange(changeEvent("Alpha, half-typed")));

    // An external reset (not caused by this hook's own commit) replaces the canonical value.
    rerender({ value: ["Reset One", "Reset Two"] });

    expect(result.current.value).toBe("Reset One, Reset Two");
  });
});
