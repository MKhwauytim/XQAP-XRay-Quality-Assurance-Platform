/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";

import {
  __resetSubTabSelectionsForTests,
  clearSubTabSelections,
  getSubTabSelection,
  resolveInitialSubTab,
  setSubTabSelection,
} from "./subTabSelection";
import { useSubTabSelection } from "./useSubTabSelection";

/**
 * The regression these cover: the sidebar rail selects a sub-tab and announces
 * it on a `window` CustomEvent in the SAME synchronous handler that schedules
 * the owning tab's mount. A tab that is not mounted yet — every lazy tab's
 * first visit, and every tab the mount LRU has evicted — has no listener when
 * that event fires, so the click used to be dropped: the rail highlighted one
 * sub-tab while the tab opened on its own default.
 */

const KNOWN = new Set<string>(["users", "activity", "actions"]);

function TabProbe({ fallback = "users" }: { fallback?: string }) {
  const [section, setSection] = useState(() =>
    resolveInitialSubTab("user-management", KNOWN, fallback)
  );
  const apply = useCallback((subTabId: string) => setSection(subTabId), []);
  useSubTabSelection("user-management", KNOWN, apply);
  return <span data-testid="section">{section}</span>;
}

/** Exactly what Sidebar.handleSubTabClick does, in the same order. */
function railClick(parentTabId: string, subTabId: string): void {
  setSubTabSelection(parentTabId, subTabId);
  window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  window.dispatchEvent(
    new CustomEvent("sidebar-subtab-changed", { detail: { parentTabId, subTabId } })
  );
}

afterEach(() => {
  cleanup();
  __resetSubTabSelectionsForTests();
});

describe("sub-tab selection store", () => {
  it("keeps the last selection per parent tab, and nothing for a tab never clicked", () => {
    setSubTabSelection("user-management", "activity");
    setSubTabSelection("reports", "kpi");
    setSubTabSelection("user-management", "actions");

    expect(getSubTabSelection("user-management")).toBe("actions");
    expect(getSubTabSelection("reports")).toBe("kpi");
    expect(getSubTabSelection("population")).toBeUndefined();
  });

  it("resolveInitialSubTab falls back when the tab does not own the selection", () => {
    setSubTabSelection("user-management", "browse");
    expect(resolveInitialSubTab("user-management", KNOWN, "users")).toBe("users");
  });

  it("forgets everything when the session ends", () => {
    setSubTabSelection("user-management", "activity");
    clearSubTabSelections();
    expect(getSubTabSelection("user-management")).toBeUndefined();
  });

  it("resolveInitialSubTab is not consuming — StrictMode reads it twice", () => {
    setSubTabSelection("user-management", "activity");
    expect(resolveInitialSubTab("user-management", KNOWN, "users")).toBe("activity");
    expect(resolveInitialSubTab("user-management", KNOWN, "users")).toBe("activity");
  });
});

describe("a tab that mounts after the rail was clicked", () => {
  it("opens on the clicked sub-tab, not on its own default", () => {
    // The click happens while the tab is unmounted — the event lands on nothing.
    railClick("user-management", "actions");
    render(<TabProbe />);
    expect(screen.getByTestId("section").textContent).toBe("actions");
  });

  it("still opens on its own default when the rail never selected anything", () => {
    render(<TabProbe />);
    expect(screen.getByTestId("section").textContent).toBe("users");
  });

  it("ignores a selection that belongs to a different tab", () => {
    railClick("population", "browse");
    render(<TabProbe />);
    expect(screen.getByTestId("section").textContent).toBe("users");
  });

  it("replays the selection even when the mount happens between render and effect", () => {
    // The other half of the race: the component has rendered (so its state is
    // already fixed) but its listener is not attached yet. The replay in the
    // mount effect is what recovers this one.
    const { rerender } = render(<TabProbe />);
    expect(screen.getByTestId("section").textContent).toBe("users");
    act(() => {
      // No event at all — only the durable record, as if the dispatch had
      // happened while this component's effects were still pending.
      setSubTabSelection("user-management", "activity");
    });
    rerender(<TabProbe />);
    // A re-render alone must NOT re-apply it: the replay is a one-shot mount
    // recovery, not a subscription that fights the tab's own navigation.
    expect(screen.getByTestId("section").textContent).toBe("users");

    cleanup();
    render(<TabProbe />);
    expect(screen.getByTestId("section").textContent).toBe("activity");
  });
});

describe("a tab that is already mounted", () => {
  it("follows the live rail events", () => {
    render(<TabProbe />);
    act(() => railClick("user-management", "activity"));
    expect(screen.getByTestId("section").textContent).toBe("activity");
    act(() => railClick("user-management", "actions"));
    expect(screen.getByTestId("section").textContent).toBe("actions");
  });

  it("ignores another tab's sub-tab ids on the shared global events", () => {
    render(<TabProbe />);
    act(() => railClick("population", "browse"));
    expect(screen.getByTestId("section").textContent).toBe("users");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "actions" },
        })
      );
    });
    expect(screen.getByTestId("section").textContent).toBe("users");
  });

  it("detaches its listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<TabProbe />);
    unmount();
    const removed = remove.mock.calls.map(([name]) => name);
    expect(removed).toContain("pop-set-subtab");
    expect(removed).toContain("sidebar-subtab-changed");
    remove.mockRestore();
  });
});
