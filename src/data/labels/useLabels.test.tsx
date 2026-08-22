/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { resetAllLabels, resetLabel, setLabel } from "./labelsStore";
import { useIsCustomized } from "./useLabels";

/**
 * `useIsCustomized` exists because a component that both WRITES the label
 * store and reads it with a bare `isCustomized()` call never sees its own
 * write: the Settings editor row's «استعادة القيمة الافتراضية» button stayed
 * disabled until the page was remounted. The contract asserted here is the one
 * that fixes it — the value is recomputed whenever the store notifies, in the
 * same commit as any other subscriber.
 */

function Probe({ labelKey }: { labelKey: "sidebar_title" }) {
  const custom = useIsCustomized(labelKey);
  return <span data-testid="state">{custom ? "custom" : "default"}</span>;
}

afterEach(() => {
  cleanup();
  resetAllLabels();
});

describe("useIsCustomized", () => {
  it("starts false for an untouched key", () => {
    render(<Probe labelKey="sidebar_title" />);
    expect(screen.getByTestId("state").textContent).toBe("default");
  });

  it("re-renders the reader when the key gains an override", () => {
    render(<Probe labelKey="sidebar_title" />);
    act(() => {
      setLabel("sidebar_title", "لوحة اختبار");
    });
    expect(screen.getByTestId("state").textContent).toBe("custom");
  });

  it("re-renders the reader when the override is removed again", () => {
    setLabel("sidebar_title", "لوحة اختبار");
    render(<Probe labelKey="sidebar_title" />);
    expect(screen.getByTestId("state").textContent).toBe("custom");
    act(() => {
      resetLabel("sidebar_title");
    });
    expect(screen.getByTestId("state").textContent).toBe("default");
  });

  it("ignores a change to a different key", () => {
    render(<Probe labelKey="sidebar_title" />);
    act(() => {
      setLabel("sidebar_kicker", "شيء آخر");
    });
    expect(screen.getByTestId("state").textContent).toBe("default");
  });
});
